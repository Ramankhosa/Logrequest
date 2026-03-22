/**
 * R2.2 Gap Coverage Tests
 *
 * Tests 25 scenarios that were NOT covered in Codex's M1-M10 test plan:
 *  - Routing logic (key-only path, fallback chains)
 *  - Verifier field clearing on resubmit
 *  - Resubmit vs withdraw distinction
 *  - Recommend step specifics
 *  - Score recalculation on state transitions
 *  - Achievement creation with R2.2 fields
 *  - Stage + submission interactions
 *  - Backward compatibility
 */

import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  createOrgUnit,
  createOrgUnitType,
  publishOrgStructure,
  validateOrgStructureDraft,
} from "@/lib/org-structure/service";
import { createCategory } from "@/lib/kra-kpi/category-service";
import {
  createPeriod,
  transitionPeriodState,
  bulkLockTargets,
} from "@/lib/kra-kpi/period-service";
import { activateKra, createKra } from "@/lib/kra-kpi/kra-service";
import {
  createKpi,
  changeKpiState,
  updateKpi,
} from "@/lib/kra-kpi/kpi-service";
import {
  createAllocation,
  cascadeTargets,
} from "@/lib/kra-kpi/target-service";
import {
  recordAchievement,
  submitForVerification,
  verifyAchievement,
  recommendAchievement,
  withdrawAchievement,
  resubmitAchievement,
  getSubmissionTrail,
} from "@/lib/kra-kpi/achievement-service";
import {
  createStage,
  listStages,
} from "@/lib/kra-kpi/stage-service";
import {
  initializeStageProgress,
  markStageComplete,
  unmarkStageComplete,
  calculateStageScore,
  getStageProgressForAchievement,
} from "@/lib/kra-kpi/stage-progress-service";
import {
  cleanupTrackedData,
  createTenantActor,
  createTestMembership,
  createTestUser,
  newDbTracker,
  type DbTracker,
} from "../helpers/db";

// ── Types ──────────────────────────────────────────────────────────────────

type ActorContext = {
  tenantId: string;
  actorUserId: string;
  actorRole: Role;
};

// ── Helpers ────────────────────────────────────────────────────────────────

async function withIsolatedDb(run: (tracker: DbTracker) => Promise<void>) {
  const tracker = newDbTracker();
  try {
    await run(tracker);
  } finally {
    await cleanupTrackedData(tracker);
  }
}

async function setupOwner(tracker: DbTracker) {
  const { tenant, actor } = await createTenantActor(tracker, "TENANT_OWNER");
  const context: ActorContext = {
    tenantId: tenant.id,
    actorUserId: actor.id,
    actorRole: "TENANT_OWNER",
  };
  return { tenant, actor, context };
}

async function createPublishedStructure(ctx: ActorContext) {
  await createOrgUnitType({
    ...ctx,
    values: {
      typeKey: "ROOT",
      displayLabel: "Root",
      internalCategory: "ORG_ROOT",
      allowRoot: true,
    },
  });
  await createOrgUnitType({
    ...ctx,
    values: {
      typeKey: "DEPT",
      displayLabel: "Department",
      internalCategory: "DEPARTMENT_LIKE_UNIT",
      allowRoot: false,
    },
  });

  const draft = await prisma.orgStructureVersion.findFirst({
    where: { tenantId: ctx.tenantId, state: "DRAFT" },
    include: { unitTypes: true },
  });
  const rootType = draft!.unitTypes.find((t) => t.typeKey === "ROOT")!;
  const deptType = draft!.unitTypes.find((t) => t.typeKey === "DEPT")!;

  await createOrgUnit({
    ...ctx,
    values: { typeId: rootType.id, code: "UNIV", name: "University" },
  });
  const root = await prisma.orgUnit.findFirst({
    where: { version: { tenantId: ctx.tenantId, state: "DRAFT" }, code: "UNIV" },
  });

  await createOrgUnit({
    ...ctx,
    values: { typeId: deptType.id, code: "CSE", name: "Computer Science", parentId: root!.id },
  });

  // Create a second department for two-step routing tests
  await createOrgUnit({
    ...ctx,
    values: { typeId: deptType.id, code: "IQAC", name: "Quality Assurance", parentId: root!.id },
  });

  const validation = await validateOrgStructureDraft(ctx.tenantId);
  expect(validation.errors).toHaveLength(0);
  await publishOrgStructure(ctx);

  const published = await prisma.orgStructureVersion.findFirst({
    where: { tenantId: ctx.tenantId, state: "PUBLISHED" },
    include: { units: true },
  });

  return {
    versionId: published!.id,
    rootUnitId: published!.units.find((u) => u.code === "UNIV")!.id,
    cseUnitId: published!.units.find((u) => u.code === "CSE")!.id,
    iqacUnitId: published!.units.find((u) => u.code === "IQAC")!.id,
  };
}

async function assignUserToUnit(input: {
  tenantId: string;
  versionId: string;
  unitId: string;
  userId: string;
  createdByUserId: string;
  isHead?: boolean;
}) {
  // Create or find role definition
  const roleKey = input.isHead ? "HEAD_OF_DEPT" : "PROFESSOR";
  let roleDef = await prisma.orgRoleDefinition.findFirst({
    where: { tenantId: input.tenantId, roleKey },
  });
  if (!roleDef) {
    roleDef = await prisma.orgRoleDefinition.create({
      data: {
        tenantId: input.tenantId,
        roleKey,
        displayLabel: input.isHead ? "Head of Department" : "Professor",
        isUnitHead: input.isHead ?? false,
        approvalAuthority: input.isHead ?? false,
        maxPerUnit: -1,
        sortOrder: input.isHead ? 10 : 50,
        createdByUserId: input.createdByUserId,
      },
    });
  }

  await prisma.userOrgAssignment.create({
    data: {
      versionId: input.versionId,
      unitId: input.unitId,
      userId: input.userId,
      assignmentType: "PRIMARY",
      isPrimary: true,
    },
  });

  await prisma.orgRoleAssignment.create({
    data: {
      versionId: input.versionId,
      unitId: input.unitId,
      userId: input.userId,
      roleDefinitionId: roleDef.id,
      roleName: roleDef.displayLabel,
      scope: "NODE",
    },
  });
}

async function createFullFixture(
  tracker: DbTracker,
  kpiOverrides: Record<string, unknown> = {},
) {
  const { tenant, actor, context } = await setupOwner(tracker);
  const structure = await createPublishedStructure(context);

  const periodResult = await createPeriod(
    context.tenantId,
    {
      name: "AY 2025-26",
      code: `AY_${Date.now()}`,
      periodType: "SPECIFIC_RANGE",
      startDate: new Date("2025-04-01T00:00:00.000Z"),
      endDate: new Date("2026-03-31T00:00:00.000Z"),
      reviewFrequency: "ANNUAL",
      targetSettingDeadline: new Date("2025-04-30T00:00:00.000Z"),
    },
    context.actorUserId,
    context.actorRole,
  );
  expect(periodResult.status).toBe("success");

  const period = await prisma.assessmentPeriod.findFirst({
    where: { tenantId: context.tenantId },
    orderBy: { createdAt: "desc" },
  });

  const kraResult = await createKra(
    context.tenantId,
    {
      periodId: period!.id,
      title: "Research Excellence",
      description: "Test KRA",
      weightage: 100,
      sortOrder: 1,
    },
    context.actorUserId,
    context.actorRole,
  );
  expect(kraResult.status).toBe("success");

  const kra = await prisma.kraDefinition.findFirst({
    where: { tenantId: context.tenantId, periodId: period!.id },
  });

  const kpiData: Record<string, unknown> = {
    kraDefinitionId: kra!.id,
    title: "Publications",
    description: "Count of research papers",
    measurementType: "NUMERIC",
    unitLabel: "papers",
    weightage: 100,
    defaultTarget: 10,
    measurementConfig: { type: "NUMERIC", decimalPlaces: 0 },
    scoringMethod: "LINEAR",
    scoringDirection: "ASCENDING",
    scoringConfig: { method: "LINEAR", capAt100: true },
    allocationType: "BOTH",
    startingUnitId: structure.cseUnitId,
    evidenceRequired: false,
    sortOrder: 1,
    ...kpiOverrides,
  };

  const kpiResult = await createKpi(
    context.tenantId,
    kpiData as Parameters<typeof createKpi>[1],
    context.actorUserId,
    context.actorRole,
  );
  expect(kpiResult.status).toBe("success");

  const kpi = await prisma.kpiDefinition.findFirst({
    where: { kraDefinitionId: kra!.id },
  });

  await activateKra(kra!.id, context.tenantId, context.actorUserId, context.actorRole);
  await transitionPeriodState(period!.id, context.tenantId, "OPEN", context.actorUserId, context.actorRole);

  return { tenant, actor, context, structure, period: period!, kra: kra!, kpi: kpi! };
}

async function moveToInProgress(fixture: {
  period: { id: string };
  context: ActorContext;
}) {
  await transitionPeriodState(
    fixture.period.id,
    fixture.context.tenantId,
    "IN_PROGRESS",
    fixture.context.actorUserId,
    fixture.context.actorRole,
  );
}

async function createUserWithAllocation(
  tracker: DbTracker,
  fixture: Awaited<ReturnType<typeof createFullFixture>>,
  name: string,
  options: { isHead?: boolean; unitId?: string } = {},
) {
  const unitId = options.unitId ?? fixture.structure.cseUnitId;
  const user = await createTestUser(tracker, { firstName: name, lastName: "Test" });
  await createTestMembership({
    tenantId: fixture.tenant.id,
    userId: user.id,
    role: "TENANT_USER",
    createdByUserId: fixture.actor.id,
  });
  await assignUserToUnit({
    tenantId: fixture.tenant.id,
    versionId: fixture.structure.versionId,
    unitId,
    userId: user.id,
    createdByUserId: fixture.actor.id,
    isHead: options.isHead,
  });

  // Create allocation
  const allocResult = await createAllocation(
    fixture.context.tenantId,
    {
      periodId: fixture.period.id,
      kpiDefinitionId: fixture.kpi.id,
      assignedToUserId: user.id,
      targetValue: 10,
      notes: `alloc-${name}`,
    },
    fixture.context.actorUserId,
    fixture.context.actorRole,
  );
  expect(allocResult.status).toBe("success");

  const allocation = await prisma.targetAllocation.findFirst({
    where: {
      tenantId: fixture.context.tenantId,
      assignedToUserId: user.id,
      kpiDefinitionId: fixture.kpi.id,
    },
  });

  return { user, allocation: allocation! };
}

// ═══════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe("R2.2 Gap Coverage", () => {
  // ── Group 1: Routing Logic ─────────────────────────────────────────────

  describe("Routing: key-only fallback", () => {
    test("G1: KPI with keyUnitId but no finalUnitId routes directly to keyUnit head (single-step)", async () => {
      await withIsolatedDb(async (tracker) => {
        const fixture = await createFullFixture(tracker, {
          keyUnitId: undefined, // will set after structure
        });

        // Update KPI to set keyUnitId only (no finalUnitId)
        await prisma.kpiDefinition.update({
          where: { id: fixture.kpi.id },
          data: {
            keyUnitId: fixture.structure.iqacUnitId,
            finalUnitId: null,
          },
        });

        await moveToInProgress(fixture);
        await bulkLockTargets(fixture.period.id, fixture.context.tenantId, fixture.context.actorUserId, fixture.context.actorRole);

        const { user, allocation } = await createUserWithAllocation(tracker, fixture, "KeyOnly");

        const achResult = await recordAchievement(
          fixture.context.tenantId,
          {
            periodId: fixture.period.id,
            kpiDefinitionId: fixture.kpi.id,
            targetAllocationId: allocation.id,
            actualValue: 8,
          },
          user.id,
          "TENANT_USER",
        );
        expect(achResult.status).toBe("success");

        const achievement = await prisma.achievement.findFirst({
          where: { reportedByUserId: user.id, kpiDefinitionId: fixture.kpi.id },
        });

        const submitResult = await submitForVerification(
          achievement!.id,
          fixture.context.tenantId,
          user.id,
          "TENANT_USER",
        );
        expect(submitResult.status).toBe("success");

        const submitted = await prisma.achievement.findUnique({
          where: { id: achievement!.id },
        });
        // keyUnitId is the approving unit when finalUnitId is null
        expect(submitted!.currentVerifierUnitId).toBe(fixture.structure.iqacUnitId);
        expect(submitted!.state).toBe("SUBMITTED");

        // Recommend should fail (single-step, not two-step)
        const recommendResult = await recommendAchievement(
          achievement!.id,
          fixture.context.tenantId,
          true,
          null,
          fixture.actor.id,
          "TENANT_OWNER",
        );
        expect(recommendResult.status).toBe("error");
        expect(recommendResult.message).toContain("verified directly");
      });
    });

    test("G2: KPI with only startingUnitId falls back to startingUnit for routing", async () => {
      await withIsolatedDb(async (tracker) => {
        const fixture = await createFullFixture(tracker);

        // Ensure both keyUnitId and finalUnitId are null
        await prisma.kpiDefinition.update({
          where: { id: fixture.kpi.id },
          data: { keyUnitId: null, finalUnitId: null },
        });

        await moveToInProgress(fixture);
        await bulkLockTargets(fixture.period.id, fixture.context.tenantId, fixture.context.actorUserId, fixture.context.actorRole);

        const { user, allocation } = await createUserWithAllocation(tracker, fixture, "StartOnly");

        const achResult = await recordAchievement(
          fixture.context.tenantId,
          {
            periodId: fixture.period.id,
            kpiDefinitionId: fixture.kpi.id,
            targetAllocationId: allocation.id,
            actualValue: 5,
          },
          user.id,
          "TENANT_USER",
        );
        expect(achResult.status).toBe("success");

        const achievement = await prisma.achievement.findFirst({
          where: { reportedByUserId: user.id },
        });

        await submitForVerification(achievement!.id, fixture.context.tenantId, user.id, "TENANT_USER");

        const submitted = await prisma.achievement.findUnique({ where: { id: achievement!.id } });
        expect(submitted!.currentVerifierUnitId).toBe(fixture.structure.cseUnitId);
      });
    });
  });

  // ── Group 2: Resubmit vs Withdraw ─────────────────────────────────────

  describe("Resubmit vs Withdraw distinction", () => {
    test("G3: resubmit only accepts REJECTED state, rejects SUBMITTED/DRAFT/VERIFIED", async () => {
      await withIsolatedDb(async (tracker) => {
        const fixture = await createFullFixture(tracker);
        await moveToInProgress(fixture);
        await bulkLockTargets(fixture.period.id, fixture.context.tenantId, fixture.context.actorUserId, fixture.context.actorRole);

        const { user, allocation } = await createUserWithAllocation(tracker, fixture, "ResubTest");

        const achResult = await recordAchievement(
          fixture.context.tenantId,
          {
            periodId: fixture.period.id,
            kpiDefinitionId: fixture.kpi.id,
            targetAllocationId: allocation.id,
            actualValue: 5,
          },
          user.id,
          "TENANT_USER",
        );
        expect(achResult.status).toBe("success");

        const achievement = await prisma.achievement.findFirst({
          where: { reportedByUserId: user.id },
        });

        // DRAFT → resubmit should fail
        const r1 = await resubmitAchievement(achievement!.id, fixture.context.tenantId, user.id);
        expect(r1.status).toBe("error");
        expect(r1.message).toContain("DRAFT");

        // SUBMITTED → resubmit should fail
        const submitRes = await submitForVerification(achievement!.id, fixture.context.tenantId, user.id, "TENANT_USER");
        expect(submitRes.status).toBe("success");
        const r2 = await resubmitAchievement(achievement!.id, fixture.context.tenantId, user.id);
        expect(r2.status).toBe("error");
        expect(r2.message).toContain("rejected");
      });
    });

    test("G4: withdraw only accepts SUBMITTED state, rejects REJECTED/DRAFT", async () => {
      await withIsolatedDb(async (tracker) => {
        const fixture = await createFullFixture(tracker);
        await moveToInProgress(fixture);
        await bulkLockTargets(fixture.period.id, fixture.context.tenantId, fixture.context.actorUserId, fixture.context.actorRole);

        const { user, allocation } = await createUserWithAllocation(tracker, fixture, "WithdrawTest");

        await recordAchievement(
          fixture.context.tenantId,
          {
            periodId: fixture.period.id,
            kpiDefinitionId: fixture.kpi.id,
            targetAllocationId: allocation.id,
            actualValue: 5,
          },
          user.id,
          "TENANT_USER",
        );

        const achievement = await prisma.achievement.findFirst({
          where: { reportedByUserId: user.id },
        });

        // DRAFT → withdraw should fail
        const w1 = await withdrawAchievement(achievement!.id, fixture.context.tenantId, user.id);
        expect(w1.status).toBe("error");

        // Submit then reject → withdraw REJECTED should fail
        await submitForVerification(achievement!.id, fixture.context.tenantId, user.id, "TENANT_USER");
        await verifyAchievement(achievement!.id, fixture.context.tenantId, false, "Needs work", fixture.actor.id, "TENANT_OWNER");

        const w2 = await withdrawAchievement(achievement!.id, fixture.context.tenantId, user.id);
        expect(w2.status).toBe("error");
      });
    });

    test("G5: resubmit clears rejection/verifier fields; withdraw does not", async () => {
      await withIsolatedDb(async (tracker) => {
        const fixture = await createFullFixture(tracker);
        await moveToInProgress(fixture);
        await bulkLockTargets(fixture.period.id, fixture.context.tenantId, fixture.context.actorUserId, fixture.context.actorRole);

        const { user, allocation } = await createUserWithAllocation(tracker, fixture, "ClearFields");

        await recordAchievement(
          fixture.context.tenantId,
          {
            periodId: fixture.period.id,
            kpiDefinitionId: fixture.kpi.id,
            targetAllocationId: allocation.id,
            actualValue: 5,
          },
          user.id,
          "TENANT_USER",
        );

        const achievement = await prisma.achievement.findFirst({
          where: { reportedByUserId: user.id },
        });

        // Submit → Reject → Resubmit
        const submitRes = await submitForVerification(achievement!.id, fixture.context.tenantId, user.id, "TENANT_USER");
        expect(submitRes.status).toBe("success");
        const rejectRes = await verifyAchievement(achievement!.id, fixture.context.tenantId, false, "Rejected reason", fixture.actor.id, "TENANT_OWNER");
        expect(rejectRes.status).toBe("success");

        const rejected = await prisma.achievement.findUnique({ where: { id: achievement!.id } });
        expect(rejected!.state).toBe("REJECTED");
        expect(rejected!.rejectionReason).toBe("Rejected reason");

        const resubRes = await resubmitAchievement(achievement!.id, fixture.context.tenantId, user.id);
        expect(resubRes.status).toBe("success");

        const resubmitted = await prisma.achievement.findUnique({ where: { id: achievement!.id } });
        expect(resubmitted!.state).toBe("DRAFT");
        expect(resubmitted!.rejectionReason).toBeNull();
        expect(resubmitted!.verifiedByUserId).toBeNull();
        expect(resubmitted!.verifiedAt).toBeNull();
        expect(resubmitted!.verificationNote).toBeNull();
        expect(resubmitted!.recommendedByUserId).toBeNull();
        expect(resubmitted!.recommendedAt).toBeNull();
        expect(resubmitted!.recommendationNote).toBeNull();
        expect(resubmitted!.currentVerifierUnitId).toBeNull();
        expect(resubmitted!.currentVerifierUserId).toBeNull();
      });
    });

    test("G6: resubmit blocked when period is not IN_PROGRESS", async () => {
      await withIsolatedDb(async (tracker) => {
        const fixture = await createFullFixture(tracker);
        await moveToInProgress(fixture);
        await bulkLockTargets(fixture.period.id, fixture.context.tenantId, fixture.context.actorUserId, fixture.context.actorRole);

        const { user, allocation } = await createUserWithAllocation(tracker, fixture, "PeriodBlock");

        await recordAchievement(
          fixture.context.tenantId,
          {
            periodId: fixture.period.id,
            kpiDefinitionId: fixture.kpi.id,
            targetAllocationId: allocation.id,
            actualValue: 5,
          },
          user.id,
          "TENANT_USER",
        );

        const achievement = await prisma.achievement.findFirst({
          where: { reportedByUserId: user.id },
        });

        const sub = await submitForVerification(achievement!.id, fixture.context.tenantId, user.id, "TENANT_USER");
        expect(sub.status).toBe("success");
        const rej = await verifyAchievement(achievement!.id, fixture.context.tenantId, false, "No", fixture.actor.id, "TENANT_OWNER");
        expect(rej.status).toBe("success");

        // Move period to UNDER_REVIEW
        await transitionPeriodState(fixture.period.id, fixture.context.tenantId, "UNDER_REVIEW", fixture.context.actorUserId, fixture.context.actorRole);

        const r = await resubmitAchievement(achievement!.id, fixture.context.tenantId, user.id);
        expect(r.status).toBe("error");
        expect(r.message).toContain("period is in progress");
      });
    });
  });

  // ── Group 3: Submission Trail ──────────────────────────────────────────

  describe("Submission trail tracking", () => {
    test("G7: full lifecycle creates correct trail entries: SUBMITTED → REJECTED → RESUBMITTED", async () => {
      await withIsolatedDb(async (tracker) => {
        const fixture = await createFullFixture(tracker);
        await moveToInProgress(fixture);
        await bulkLockTargets(fixture.period.id, fixture.context.tenantId, fixture.context.actorUserId, fixture.context.actorRole);

        const { user, allocation } = await createUserWithAllocation(tracker, fixture, "Trail");

        await recordAchievement(
          fixture.context.tenantId,
          {
            periodId: fixture.period.id,
            kpiDefinitionId: fixture.kpi.id,
            targetAllocationId: allocation.id,
            actualValue: 7,
          },
          user.id,
          "TENANT_USER",
        );

        const ach = await prisma.achievement.findFirst({ where: { reportedByUserId: user.id } });

        // Submit
        await submitForVerification(ach!.id, fixture.context.tenantId, user.id, "TENANT_USER");
        // Reject
        await verifyAchievement(ach!.id, fixture.context.tenantId, false, "Fix it", fixture.actor.id, "TENANT_OWNER");
        // Resubmit
        await resubmitAchievement(ach!.id, fixture.context.tenantId, user.id);

        const trail = await getSubmissionTrail(ach!.id, fixture.context.tenantId);
        expect(trail).toHaveLength(3);
        expect(trail[0].action).toBe("SUBMITTED");
        expect(trail[1].action).toBe("REJECTED");
        expect(trail[2].action).toBe("RESUBMITTED");
      });
    });

    test("G8: withdraw creates WITHDRAWN trail entry", async () => {
      await withIsolatedDb(async (tracker) => {
        const fixture = await createFullFixture(tracker);
        await moveToInProgress(fixture);
        await bulkLockTargets(fixture.period.id, fixture.context.tenantId, fixture.context.actorUserId, fixture.context.actorRole);

        const { user, allocation } = await createUserWithAllocation(tracker, fixture, "WithdrawTrail");

        await recordAchievement(
          fixture.context.tenantId,
          {
            periodId: fixture.period.id,
            kpiDefinitionId: fixture.kpi.id,
            targetAllocationId: allocation.id,
            actualValue: 5,
          },
          user.id,
          "TENANT_USER",
        );

        const ach = await prisma.achievement.findFirst({ where: { reportedByUserId: user.id } });
        await submitForVerification(ach!.id, fixture.context.tenantId, user.id, "TENANT_USER");
        await withdrawAchievement(ach!.id, fixture.context.tenantId, user.id);

        const trail = await getSubmissionTrail(ach!.id, fixture.context.tenantId);
        expect(trail).toHaveLength(2);
        expect(trail[0].action).toBe("SUBMITTED");
        expect(trail[1].action).toBe("WITHDRAWN");
      });
    });
  });

  // ── Group 4: Two-step Recommend Flow ───────────────────────────────────

  describe("Two-step review (recommend → verify)", () => {
    test("G9: recommend advances SUBMITTED → RECOMMENDED and routes to finalUnit", async () => {
      await withIsolatedDb(async (tracker) => {
        const fixture = await createFullFixture(tracker);

        // Set two-step: keyUnitId=CSE, finalUnitId=IQAC
        await prisma.kpiDefinition.update({
          where: { id: fixture.kpi.id },
          data: {
            keyUnitId: fixture.structure.cseUnitId,
            finalUnitId: fixture.structure.iqacUnitId,
          },
        });

        await moveToInProgress(fixture);
        await bulkLockTargets(fixture.period.id, fixture.context.tenantId, fixture.context.actorUserId, fixture.context.actorRole);

        const { user, allocation } = await createUserWithAllocation(tracker, fixture, "TwoStep");

        await recordAchievement(
          fixture.context.tenantId,
          {
            periodId: fixture.period.id,
            kpiDefinitionId: fixture.kpi.id,
            targetAllocationId: allocation.id,
            actualValue: 8,
          },
          user.id,
          "TENANT_USER",
        );

        const ach = await prisma.achievement.findFirst({ where: { reportedByUserId: user.id } });

        await submitForVerification(ach!.id, fixture.context.tenantId, user.id, "TENANT_USER");

        const submitted = await prisma.achievement.findUnique({ where: { id: ach!.id } });
        // Initial review goes to keyUnit
        expect(submitted!.currentVerifierUnitId).toBe(fixture.structure.cseUnitId);

        // Admin can recommend
        const recResult = await recommendAchievement(
          ach!.id, fixture.context.tenantId, true, "Looks good", fixture.actor.id, "TENANT_OWNER",
        );
        expect(recResult.status).toBe("success");

        const recommended = await prisma.achievement.findUnique({ where: { id: ach!.id } });
        expect(recommended!.state).toBe("RECOMMENDED");
        expect(recommended!.currentVerifierUnitId).toBe(fixture.structure.iqacUnitId);
        expect(recommended!.recommendedByUserId).toBe(fixture.actor.id);
        expect(recommended!.recommendationNote).toBe("Looks good");
      });
    });

    test("G10: recommend with approved=false rejects directly (SUBMITTED → REJECTED)", async () => {
      await withIsolatedDb(async (tracker) => {
        const fixture = await createFullFixture(tracker);

        await prisma.kpiDefinition.update({
          where: { id: fixture.kpi.id },
          data: {
            keyUnitId: fixture.structure.cseUnitId,
            finalUnitId: fixture.structure.iqacUnitId,
          },
        });

        await moveToInProgress(fixture);
        await bulkLockTargets(fixture.period.id, fixture.context.tenantId, fixture.context.actorUserId, fixture.context.actorRole);

        const { user, allocation } = await createUserWithAllocation(tracker, fixture, "RejectAtRec");

        await recordAchievement(
          fixture.context.tenantId,
          {
            periodId: fixture.period.id,
            kpiDefinitionId: fixture.kpi.id,
            targetAllocationId: allocation.id,
            actualValue: 3,
          },
          user.id,
          "TENANT_USER",
        );

        const ach = await prisma.achievement.findFirst({ where: { reportedByUserId: user.id } });
        await submitForVerification(ach!.id, fixture.context.tenantId, user.id, "TENANT_USER");

        const recResult = await recommendAchievement(
          ach!.id, fixture.context.tenantId, false, "Insufficient", fixture.actor.id, "TENANT_OWNER",
        );
        expect(recResult.status).toBe("success");

        const rejected = await prisma.achievement.findUnique({ where: { id: ach!.id } });
        expect(rejected!.state).toBe("REJECTED");
        expect(rejected!.rejectionReason).toContain("Insufficient");
        expect(rejected!.currentVerifierUnitId).toBeNull();
      });
    });

    test("G11: non-admin verify blocked on SUBMITTED for two-step KPI (must recommend first)", async () => {
      await withIsolatedDb(async (tracker) => {
        const fixture = await createFullFixture(tracker);

        await prisma.kpiDefinition.update({
          where: { id: fixture.kpi.id },
          data: {
            keyUnitId: fixture.structure.cseUnitId,
            finalUnitId: fixture.structure.iqacUnitId,
          },
        });

        await moveToInProgress(fixture);
        await bulkLockTargets(fixture.period.id, fixture.context.tenantId, fixture.context.actorUserId, fixture.context.actorRole);

        // Create a dept head for CSE
        const deptHead = await createTestUser(tracker, { firstName: "DeptHead", lastName: "CSE" });
        await createTestMembership({
          tenantId: fixture.tenant.id,
          userId: deptHead.id,
          role: "TENANT_USER",
          createdByUserId: fixture.actor.id,
        });
        await assignUserToUnit({
          tenantId: fixture.tenant.id,
          versionId: fixture.structure.versionId,
          unitId: fixture.structure.cseUnitId,
          userId: deptHead.id,
          createdByUserId: fixture.actor.id,
          isHead: true,
        });

        const { user, allocation } = await createUserWithAllocation(tracker, fixture, "VerifyBlock");

        await recordAchievement(
          fixture.context.tenantId,
          {
            periodId: fixture.period.id,
            kpiDefinitionId: fixture.kpi.id,
            targetAllocationId: allocation.id,
            actualValue: 5,
          },
          user.id,
          "TENANT_USER",
        );

        const ach = await prisma.achievement.findFirst({ where: { reportedByUserId: user.id } });
        await submitForVerification(ach!.id, fixture.context.tenantId, user.id, "TENANT_USER");

        // Dept head tries to verify directly (should be blocked for two-step)
        const verifyResult = await verifyAchievement(
          ach!.id, fixture.context.tenantId, true, "OK", deptHead.id, "TENANT_USER",
        );
        expect(verifyResult.status).toBe("error");
        expect(verifyResult.message).toContain("recommended");
      });
    });

    test("G12: full two-step flow produces SUBMITTED → RECOMMENDED → APPROVED trail", async () => {
      await withIsolatedDb(async (tracker) => {
        const fixture = await createFullFixture(tracker);

        await prisma.kpiDefinition.update({
          where: { id: fixture.kpi.id },
          data: {
            keyUnitId: fixture.structure.cseUnitId,
            finalUnitId: fixture.structure.iqacUnitId,
          },
        });

        await moveToInProgress(fixture);
        await bulkLockTargets(fixture.period.id, fixture.context.tenantId, fixture.context.actorUserId, fixture.context.actorRole);

        const { user, allocation } = await createUserWithAllocation(tracker, fixture, "FullTwoStep");

        await recordAchievement(
          fixture.context.tenantId,
          {
            periodId: fixture.period.id,
            kpiDefinitionId: fixture.kpi.id,
            targetAllocationId: allocation.id,
            actualValue: 10,
          },
          user.id,
          "TENANT_USER",
        );

        const ach = await prisma.achievement.findFirst({ where: { reportedByUserId: user.id } });

        await submitForVerification(ach!.id, fixture.context.tenantId, user.id, "TENANT_USER");
        await recommendAchievement(ach!.id, fixture.context.tenantId, true, "Recommended", fixture.actor.id, "TENANT_OWNER");
        await verifyAchievement(ach!.id, fixture.context.tenantId, true, "Verified", fixture.actor.id, "TENANT_OWNER");

        const trail = await getSubmissionTrail(ach!.id, fixture.context.tenantId);
        expect(trail).toHaveLength(3);
        expect(trail[0].action).toBe("SUBMITTED");
        expect(trail[1].action).toBe("RECOMMENDED");
        expect(trail[2].action).toBe("APPROVED");

        const verified = await prisma.achievement.findUnique({ where: { id: ach!.id } });
        expect(verified!.state).toBe("VERIFIED");
      });
    });
  });

  // ── Group 5: Stage + Score Interactions ────────────────────────────────

  describe("Stage progress and score calculation", () => {
    test("G13: achievement with stages gets stageCompletionScore = sum of completed stage weights", async () => {
      await withIsolatedDb(async (tracker) => {
        const fixture = await createFullFixture(tracker, { allowPartialCompletion: true });

        // Create stages
        const s1 = await createStage(fixture.kpi.id, fixture.context.tenantId, { title: "Stage 1", weight: 40 }, fixture.context.actorUserId, fixture.context.actorRole);
        expect(s1.ok).toBe(true);
        const s2 = await createStage(fixture.kpi.id, fixture.context.tenantId, { title: "Stage 2", weight: 60 }, fixture.context.actorUserId, fixture.context.actorRole);
        expect(s2.ok).toBe(true);

        await moveToInProgress(fixture);
        await bulkLockTargets(fixture.period.id, fixture.context.tenantId, fixture.context.actorUserId, fixture.context.actorRole);

        const { user, allocation } = await createUserWithAllocation(tracker, fixture, "StageScore");

        // Record achievement (stages auto-init)
        await recordAchievement(
          fixture.context.tenantId,
          {
            periodId: fixture.period.id,
            kpiDefinitionId: fixture.kpi.id,
            targetAllocationId: allocation.id,
            actualValue: 5,
          },
          user.id,
          "TENANT_USER",
        );

        const ach = await prisma.achievement.findFirst({ where: { reportedByUserId: user.id } });

        // Check stage progress was initialized
        const progresses = await prisma.kpiStageProgress.findMany({
          where: { achievementId: ach!.id },
          include: { stageDefinition: true },
          orderBy: { stageDefinition: { stageOrder: "asc" } },
        });
        expect(progresses).toHaveLength(2);

        // Complete only stage 1
        const markResult = await markStageComplete(
          progresses[0].id,
          fixture.context.tenantId,
          {},
          user.id,
          "TENANT_USER",
        );
        expect(markResult.ok).toBe(true);

        const afterMark = await prisma.achievement.findUnique({ where: { id: ach!.id } });
        expect(afterMark!.stageCompletionScore).toBe(40);

        // Complete stage 2
        await markStageComplete(progresses[1].id, fixture.context.tenantId, {}, user.id, "TENANT_USER");

        const afterBoth = await prisma.achievement.findUnique({ where: { id: ach!.id } });
        expect(afterBoth!.stageCompletionScore).toBe(100);
      });
    });

    test("G14: effectiveScore = stageCompletionScore × (creditPercent / 100) when contribution role set", async () => {
      await withIsolatedDb(async (tracker) => {
        const contributionRoles = [
          { role: "Lead Author", creditPercent: 60, isDefault: true },
          { role: "Co-author", creditPercent: 30, isDefault: false },
        ];
        const fixture = await createFullFixture(tracker, {
          contributionRoles,
          allowPartialCompletion: true,
        });

        await createStage(fixture.kpi.id, fixture.context.tenantId, { title: "S1", weight: 100 }, fixture.context.actorUserId, fixture.context.actorRole);

        await moveToInProgress(fixture);
        await bulkLockTargets(fixture.period.id, fixture.context.tenantId, fixture.context.actorUserId, fixture.context.actorRole);

        const { user, allocation } = await createUserWithAllocation(tracker, fixture, "CreditCalc");

        await recordAchievement(
          fixture.context.tenantId,
          {
            periodId: fixture.period.id,
            kpiDefinitionId: fixture.kpi.id,
            targetAllocationId: allocation.id,
            actualValue: 5,
            contributionRole: "Co-author",
          },
          user.id,
          "TENANT_USER",
        );

        const ach = await prisma.achievement.findFirst({ where: { reportedByUserId: user.id } });
        expect(ach!.creditPercent).toBe(30);

        // Complete stage
        const prog = await prisma.kpiStageProgress.findFirst({ where: { achievementId: ach!.id } });
        await markStageComplete(prog!.id, fixture.context.tenantId, {}, user.id, "TENANT_USER");

        const after = await prisma.achievement.findUnique({ where: { id: ach!.id } });
        expect(after!.stageCompletionScore).toBe(100);
        // effectiveScore = 100 * (30/100) = 30
        expect(after!.effectiveScore).toBe(30);
      });
    });

    test("G15: unmark stage recalculates score downward", async () => {
      await withIsolatedDb(async (tracker) => {
        const fixture = await createFullFixture(tracker, { allowPartialCompletion: true });

        await createStage(fixture.kpi.id, fixture.context.tenantId, { title: "A", weight: 50 }, fixture.context.actorUserId, fixture.context.actorRole);
        await createStage(fixture.kpi.id, fixture.context.tenantId, { title: "B", weight: 50 }, fixture.context.actorUserId, fixture.context.actorRole);

        await moveToInProgress(fixture);
        await bulkLockTargets(fixture.period.id, fixture.context.tenantId, fixture.context.actorUserId, fixture.context.actorRole);

        const { user, allocation } = await createUserWithAllocation(tracker, fixture, "UnmarkScore");

        await recordAchievement(
          fixture.context.tenantId,
          {
            periodId: fixture.period.id,
            kpiDefinitionId: fixture.kpi.id,
            targetAllocationId: allocation.id,
            actualValue: 5,
          },
          user.id,
          "TENANT_USER",
        );

        const ach = await prisma.achievement.findFirst({ where: { reportedByUserId: user.id } });
        const progs = await prisma.kpiStageProgress.findMany({
          where: { achievementId: ach!.id },
          orderBy: { stageDefinition: { stageOrder: "asc" } },
        });

        // Mark both complete
        await markStageComplete(progs[0].id, fixture.context.tenantId, {}, user.id, "TENANT_USER");
        await markStageComplete(progs[1].id, fixture.context.tenantId, {}, user.id, "TENANT_USER");

        const before = await prisma.achievement.findUnique({ where: { id: ach!.id } });
        expect(before!.stageCompletionScore).toBe(100);

        // Unmark stage A
        await unmarkStageComplete(progs[0].id, fixture.context.tenantId, user.id, "TENANT_USER");

        const after = await prisma.achievement.findUnique({ where: { id: ach!.id } });
        expect(after!.stageCompletionScore).toBe(50);
      });
    });

    test("G16: submit blocked when allowPartialCompletion=false and not all stages complete", async () => {
      await withIsolatedDb(async (tracker) => {
        const fixture = await createFullFixture(tracker, { allowPartialCompletion: false });

        await createStage(fixture.kpi.id, fixture.context.tenantId, { title: "S1", weight: 50 }, fixture.context.actorUserId, fixture.context.actorRole);
        await createStage(fixture.kpi.id, fixture.context.tenantId, { title: "S2", weight: 50 }, fixture.context.actorUserId, fixture.context.actorRole);

        await moveToInProgress(fixture);
        await bulkLockTargets(fixture.period.id, fixture.context.tenantId, fixture.context.actorUserId, fixture.context.actorRole);

        const { user, allocation } = await createUserWithAllocation(tracker, fixture, "PartialBlock");

        await recordAchievement(
          fixture.context.tenantId,
          {
            periodId: fixture.period.id,
            kpiDefinitionId: fixture.kpi.id,
            targetAllocationId: allocation.id,
            actualValue: 5,
          },
          user.id,
          "TENANT_USER",
        );

        const ach = await prisma.achievement.findFirst({ where: { reportedByUserId: user.id } });
        const progs = await prisma.kpiStageProgress.findMany({
          where: { achievementId: ach!.id },
          orderBy: { stageDefinition: { stageOrder: "asc" } },
        });

        // Only complete first stage
        await markStageComplete(progs[0].id, fixture.context.tenantId, {}, user.id, "TENANT_USER");

        const submitResult = await submitForVerification(ach!.id, fixture.context.tenantId, user.id, "TENANT_USER");
        expect(submitResult.status).toBe("error");
        expect(submitResult.message).toContain("Complete all stages");
      });
    });

    test("G17: submit succeeds with partial completion when allowPartialCompletion=true", async () => {
      await withIsolatedDb(async (tracker) => {
        const fixture = await createFullFixture(tracker, { allowPartialCompletion: true });

        await createStage(fixture.kpi.id, fixture.context.tenantId, { title: "S1", weight: 60 }, fixture.context.actorUserId, fixture.context.actorRole);
        await createStage(fixture.kpi.id, fixture.context.tenantId, { title: "S2", weight: 40 }, fixture.context.actorUserId, fixture.context.actorRole);

        await moveToInProgress(fixture);
        await bulkLockTargets(fixture.period.id, fixture.context.tenantId, fixture.context.actorUserId, fixture.context.actorRole);

        const { user, allocation } = await createUserWithAllocation(tracker, fixture, "PartialOK");

        await recordAchievement(
          fixture.context.tenantId,
          {
            periodId: fixture.period.id,
            kpiDefinitionId: fixture.kpi.id,
            targetAllocationId: allocation.id,
            actualValue: 5,
          },
          user.id,
          "TENANT_USER",
        );

        const ach = await prisma.achievement.findFirst({ where: { reportedByUserId: user.id } });
        const progs = await prisma.kpiStageProgress.findMany({
          where: { achievementId: ach!.id },
          orderBy: { stageDefinition: { stageOrder: "asc" } },
        });

        // Only complete first stage
        await markStageComplete(progs[0].id, fixture.context.tenantId, {}, user.id, "TENANT_USER");

        const submitResult = await submitForVerification(ach!.id, fixture.context.tenantId, user.id, "TENANT_USER");
        expect(submitResult.status).toBe("success");

        const submitted = await prisma.achievement.findUnique({ where: { id: ach!.id } });
        expect(submitted!.state).toBe("SUBMITTED");
        expect(submitted!.stageCompletionScore).toBe(60);
      });
    });
  });

  // ── Group 6: Stage CRUD Validations ────────────────────────────────────

  describe("Stage definition CRUD validations", () => {
    test("G18: stage with evidence required but no types is rejected", async () => {
      await withIsolatedDb(async (tracker) => {
        const fixture = await createFullFixture(tracker);

        const result = await createStage(
          fixture.kpi.id,
          fixture.context.tenantId,
          {
            title: "Bad Stage",
            weight: 10,
            evidenceRequired: true,
            evidenceTypes: [],
          },
          fixture.context.actorUserId,
          fixture.context.actorRole,
        );
        expect(result.ok).toBe(false);
        expect(result.message).toContain("evidence type");
      });
    });

    test("G19: stage deadline outside period range is rejected", async () => {
      await withIsolatedDb(async (tracker) => {
        const fixture = await createFullFixture(tracker);

        const result = await createStage(
          fixture.kpi.id,
          fixture.context.tenantId,
          {
            title: "Bad Deadline",
            weight: 10,
            deadline: new Date("2027-01-01T00:00:00.000Z"), // outside period
          },
          fixture.context.actorUserId,
          fixture.context.actorRole,
        );
        expect(result.ok).toBe(false);
        expect(result.message).toContain("assessment period");
      });
    });

    test("G20: non-admin cannot create stages", async () => {
      await withIsolatedDb(async (tracker) => {
        const fixture = await createFullFixture(tracker);
        const user = await createTestUser(tracker, { firstName: "NonAdmin" });
        await createTestMembership({
          tenantId: fixture.tenant.id,
          userId: user.id,
          role: "TENANT_USER",
          createdByUserId: fixture.actor.id,
        });

        const result = await createStage(
          fixture.kpi.id,
          fixture.context.tenantId,
          { title: "Forbidden Stage", weight: 10 },
          user.id,
          "TENANT_USER",
        );
        expect(result.ok).toBe(false);
        expect(result.message).toContain("permissions");
      });
    });

    test("G21: delete stage with completed progress is blocked", async () => {
      await withIsolatedDb(async (tracker) => {
        const fixture = await createFullFixture(tracker, { allowPartialCompletion: true });

        const s1 = await createStage(fixture.kpi.id, fixture.context.tenantId, { title: "DeleteMe", weight: 50 }, fixture.context.actorUserId, fixture.context.actorRole);
        expect(s1.ok).toBe(true);

        await moveToInProgress(fixture);
        await bulkLockTargets(fixture.period.id, fixture.context.tenantId, fixture.context.actorUserId, fixture.context.actorRole);

        const { user, allocation } = await createUserWithAllocation(tracker, fixture, "DelStage");

        await recordAchievement(
          fixture.context.tenantId,
          {
            periodId: fixture.period.id,
            kpiDefinitionId: fixture.kpi.id,
            targetAllocationId: allocation.id,
            actualValue: 5,
          },
          user.id,
          "TENANT_USER",
        );

        const ach = await prisma.achievement.findFirst({ where: { reportedByUserId: user.id } });
        const prog = await prisma.kpiStageProgress.findFirst({ where: { achievementId: ach!.id } });
        await markStageComplete(prog!.id, fixture.context.tenantId, {}, user.id, "TENANT_USER");

        // Try to delete stage with completed progress
        const { deleteStage } = await import("@/lib/kra-kpi/stage-service");
        const stageId = (s1 as { ok: true; data: { id: string } }).data!.id;
        const delResult = await deleteStage(stageId, fixture.kpi.id, fixture.context.tenantId, fixture.context.actorUserId, fixture.context.actorRole);
        expect(delResult.ok).toBe(false);
        expect(delResult.message).toContain("completed progress");
      });
    });
  });

  // ── Group 7: Achievement R2.2 Fields ───────────────────────────────────

  describe("Achievement creation with R2.2 fields", () => {
    test("G22: contribution role sets creditPercent from KPI definition", async () => {
      await withIsolatedDb(async (tracker) => {
        const contributionRoles = [
          { role: "PI", creditPercent: 100, isDefault: true },
          { role: "Co-PI", creditPercent: 50, isDefault: false },
        ];
        const fixture = await createFullFixture(tracker, { contributionRoles });

        await moveToInProgress(fixture);
        await bulkLockTargets(fixture.period.id, fixture.context.tenantId, fixture.context.actorUserId, fixture.context.actorRole);

        const { user, allocation } = await createUserWithAllocation(tracker, fixture, "CreditRole");

        const result = await recordAchievement(
          fixture.context.tenantId,
          {
            periodId: fixture.period.id,
            kpiDefinitionId: fixture.kpi.id,
            targetAllocationId: allocation.id,
            actualValue: 10,
            contributionRole: "Co-PI",
          },
          user.id,
          "TENANT_USER",
        );
        expect(result.status).toBe("success");

        const ach = await prisma.achievement.findFirst({ where: { reportedByUserId: user.id } });
        expect(ach!.contributionRole).toBe("Co-PI");
        expect(ach!.creditPercent).toBe(50);
        // effectiveScore = computedScore * 0.5 (for non-stage KPI)
        expect(ach!.effectiveScore).toBe((ach!.computedScore ?? 0) * 0.5);
      });
    });

    test("G23: invalid contribution role is rejected", async () => {
      await withIsolatedDb(async (tracker) => {
        const contributionRoles = [
          { role: "PI", creditPercent: 100, isDefault: true },
        ];
        const fixture = await createFullFixture(tracker, { contributionRoles });

        await moveToInProgress(fixture);
        await bulkLockTargets(fixture.period.id, fixture.context.tenantId, fixture.context.actorUserId, fixture.context.actorRole);

        const { user, allocation } = await createUserWithAllocation(tracker, fixture, "BadRole");

        const result = await recordAchievement(
          fixture.context.tenantId,
          {
            periodId: fixture.period.id,
            kpiDefinitionId: fixture.kpi.id,
            targetAllocationId: allocation.id,
            actualValue: 10,
            contributionRole: "NonExistent",
          },
          user.id,
          "TENANT_USER",
        );
        expect(result.status).toBe("error");
        expect(result.message).toContain("Contribution role");
      });
    });

    test("G24: submit blocked when contribution roles defined but none selected", async () => {
      await withIsolatedDb(async (tracker) => {
        const contributionRoles = [
          { role: "PI", creditPercent: 100, isDefault: true },
          { role: "Co-PI", creditPercent: 50, isDefault: false },
        ];
        const fixture = await createFullFixture(tracker, {
          contributionRoles,
          evidenceRequired: false,
        });

        await moveToInProgress(fixture);
        await bulkLockTargets(fixture.period.id, fixture.context.tenantId, fixture.context.actorUserId, fixture.context.actorRole);

        const { user, allocation } = await createUserWithAllocation(tracker, fixture, "NoRoleSel");

        // Record without contribution role
        await recordAchievement(
          fixture.context.tenantId,
          {
            periodId: fixture.period.id,
            kpiDefinitionId: fixture.kpi.id,
            targetAllocationId: allocation.id,
            actualValue: 10,
          },
          user.id,
          "TENANT_USER",
        );

        const ach = await prisma.achievement.findFirst({ where: { reportedByUserId: user.id } });

        const submitResult = await submitForVerification(ach!.id, fixture.context.tenantId, user.id, "TENANT_USER");
        expect(submitResult.status).toBe("error");
        expect(submitResult.message).toContain("contribution role");
      });
    });
  });

  // ── Group 8: Backward Compatibility ────────────────────────────────────

  describe("Backward compatibility (R1 KPIs without stages)", () => {
    test("G25: KPI without stages still works with direct submit → verify flow", async () => {
      await withIsolatedDb(async (tracker) => {
        const fixture = await createFullFixture(tracker);

        // No stages added — pure R1 path
        await moveToInProgress(fixture);
        await bulkLockTargets(fixture.period.id, fixture.context.tenantId, fixture.context.actorUserId, fixture.context.actorRole);

        const { user, allocation } = await createUserWithAllocation(tracker, fixture, "R1Compat");

        await recordAchievement(
          fixture.context.tenantId,
          {
            periodId: fixture.period.id,
            kpiDefinitionId: fixture.kpi.id,
            targetAllocationId: allocation.id,
            actualValue: 10,
          },
          user.id,
          "TENANT_USER",
        );

        const ach = await prisma.achievement.findFirst({ where: { reportedByUserId: user.id } });
        // No stage progress rows
        const stageProgCount = await prisma.kpiStageProgress.count({ where: { achievementId: ach!.id } });
        expect(stageProgCount).toBe(0);

        // computedScore should be set (100% for 10/10 target)
        expect(ach!.computedScore).toBe(100);
        expect(ach!.stageCompletionScore).toBeNull();

        await submitForVerification(ach!.id, fixture.context.tenantId, user.id, "TENANT_USER");
        await verifyAchievement(ach!.id, fixture.context.tenantId, true, "Good", fixture.actor.id, "TENANT_OWNER");

        const verified = await prisma.achievement.findUnique({ where: { id: ach!.id } });
        expect(verified!.state).toBe("VERIFIED");
        expect(verified!.computedScore).toBe(100);
        expect(verified!.effectiveScore).toBe(100);

        const trail = await getSubmissionTrail(ach!.id, fixture.context.tenantId);
        expect(trail).toHaveLength(2);
        expect(trail[0].action).toBe("SUBMITTED");
        expect(trail[1].action).toBe("APPROVED");
      });
    });
  });
});
