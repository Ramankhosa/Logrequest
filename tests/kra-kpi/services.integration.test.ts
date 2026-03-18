import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  createOrgUnit,
  createOrgUnitType,
  listActiveStructureUnits,
  publishOrgStructure,
  validateOrgStructureDraft,
} from "@/lib/org-structure/service";
import { createCategory, listCategories } from "@/lib/kra-kpi/category-service";
import {
  createPeriod,
  transitionPeriodState,
  bulkLockTargets,
} from "@/lib/kra-kpi/period-service";
import {
  activateKra,
  createKra,
  updateKra,
  validateKraWeightages,
} from "@/lib/kra-kpi/kra-service";
import {
  createKpi,
  updateKpi,
  validateKpiWeightages,
} from "@/lib/kra-kpi/kpi-service";
import {
  createAllocation,
  createAllocations,
  cascadeTargets,
  listAllocations,
  unlockTarget,
  updateAllocation,
} from "@/lib/kra-kpi/target-service";
import {
  getPeriodSummary,
  recordAchievement,
  submitForVerification,
  verifyAchievement,
} from "@/lib/kra-kpi/achievement-service";
import {
  cleanupTrackedData,
  createTenantActor,
  createTestMembership,
  createTestUser,
  newDbTracker,
  type DbTracker,
} from "../helpers/db";

type ActorContext = {
  tenantId: string;
  actorUserId: string;
  actorRole: Role;
};

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
  expect(draft).toBeTruthy();

  const rootType = draft!.unitTypes.find((type) => type.typeKey === "ROOT");
  const deptType = draft!.unitTypes.find((type) => type.typeKey === "DEPT");
  expect(rootType).toBeTruthy();
  expect(deptType).toBeTruthy();

  await createOrgUnit({
    ...ctx,
    values: {
      typeId: rootType!.id,
      code: "UNIV",
      name: "University",
    },
  });

  const root = await prisma.orgUnit.findFirst({
    where: {
      version: { tenantId: ctx.tenantId, state: "DRAFT" },
      code: "UNIV",
    },
  });
  expect(root).toBeTruthy();

  await createOrgUnit({
    ...ctx,
    values: {
      typeId: deptType!.id,
      code: "CSE",
      name: "Computer Science",
      parentId: root!.id,
    },
  });

  const validation = await validateOrgStructureDraft(ctx.tenantId);
  expect(validation.errors).toHaveLength(0);

  const publishResult = await publishOrgStructure(ctx);
  expect(publishResult.status).toBe("success");

  const published = await prisma.orgStructureVersion.findFirst({
    where: { tenantId: ctx.tenantId, state: "PUBLISHED" },
    include: { units: true },
  });
  expect(published).toBeTruthy();

  return {
    versionId: published!.id,
    rootUnitId: published!.units.find((unit) => unit.code === "UNIV")!.id,
    cseUnitId: published!.units.find((unit) => unit.code === "CSE")!.id,
  };
}

async function createOpenNumericFixture(
  tracker: DbTracker,
  options: { kraWeightage?: number; kpiWeightage?: number } = {},
) {
  const kraWeightage = options.kraWeightage ?? 100;
  const kpiWeightage = options.kpiWeightage ?? kraWeightage;
  const { tenant, actor, context } = await setupOwner(tracker);
  const structure = await createPublishedStructure(context);

  const createPeriodResult = await createPeriod(
    context.tenantId,
    {
      name: "AY 2025-26",
      code: "AY2025_26",
      periodType: "SPECIFIC_RANGE",
      startDate: new Date("2025-04-01T00:00:00.000Z"),
      endDate: new Date("2026-03-31T00:00:00.000Z"),
      reviewFrequency: "ANNUAL",
      targetSettingDeadline: new Date("2025-04-30T00:00:00.000Z"),
    },
    context.actorUserId,
    context.actorRole,
  );
  expect(createPeriodResult.status).toBe("success");

  const period = await prisma.assessmentPeriod.findUnique({
    where: {
      tenantId_code: {
        tenantId: context.tenantId,
        code: "AY2025_26",
      },
    },
  });
  expect(period).toBeTruthy();

  const createKraResult = await createKra(
    context.tenantId,
    {
      periodId: period!.id,
      title: "Research Excellence",
      description: "Seeded integration KRA",
      weightage: kraWeightage,
      sortOrder: 1,
    },
    context.actorUserId,
    context.actorRole,
  );
  expect(createKraResult.status).toBe("success");

  const kra = await prisma.kraDefinition.findFirst({
    where: {
      tenantId: context.tenantId,
      periodId: period!.id,
      title: "Research Excellence",
    },
  });
  expect(kra).toBeTruthy();

  const createKpiResult = await createKpi(
    context.tenantId,
    {
      kraDefinitionId: kra!.id,
      title: "Indexed Publications",
      description: "Count of indexed research papers",
      measurementType: "NUMERIC",
      unitLabel: "papers",
      weightage: kpiWeightage,
      defaultTarget: 12,
      measurementConfig: {
        type: "NUMERIC",
        decimalPlaces: 0,
      },
      scoringMethod: "LINEAR",
      scoringDirection: "ASCENDING",
      scoringConfig: {
        method: "LINEAR",
        capAt100: true,
      },
      allocationType: "BOTH",
      startingUnitId: structure.cseUnitId,
      guidanceNotes: "Integration test KPI",
      sortOrder: 1,
    },
    context.actorUserId,
    context.actorRole,
  );
  expect(createKpiResult.status).toBe("success");

  const kpi = await prisma.kpiDefinition.findFirst({
    where: {
      kraDefinitionId: kra!.id,
      title: "Indexed Publications",
    },
  });
  expect(kpi).toBeTruthy();

  const activateResult = await activateKra(
    kra!.id,
    context.tenantId,
    context.actorUserId,
    context.actorRole,
  );
  expect(activateResult.status).toBe("success");

  const openResult = await transitionPeriodState(
    period!.id,
    context.tenantId,
    "OPEN",
    context.actorUserId,
    context.actorRole,
  );
  expect(openResult.status).toBe("success");

  return {
    tenant,
    actor,
    context,
    structure,
    period: period!,
    kra: kra!,
    kpi: kpi!,
  };
}

describe("KRA/KPI service integration", () => {
  test("lists merged global and tenant categories", async () => {
    const globalKey = `GLOBAL_${Date.now()}`;

    try {
      await withIsolatedDb(async (tracker) => {
        const { context } = await setupOwner(tracker);

        await prisma.kraCategoryDefinition.create({
          data: {
            scope: "GLOBAL",
            categoryKey: globalKey,
            displayLabel: "Global Research",
            isActive: true,
          },
        });

        const created = await createCategory(
          context.tenantId,
          {
            categoryKey: "TENANT_RESEARCH",
            displayLabel: "Tenant Research",
            colorHex: "#0F766E",
          },
          context.actorUserId,
          context.actorRole,
        );
        expect(created.status).toBe("success");

        const categories = await listCategories(context.tenantId);
        expect(categories.some((category) => category.categoryKey === globalKey)).toBe(true);
        expect(
          categories.some((category) => category.categoryKey === "TENANT_RESEARCH"),
        ).toBe(true);
      });
    } finally {
      await prisma.kraCategoryDefinition.deleteMany({
        where: {
          tenantId: null,
          categoryKey: globalKey,
        },
      });
    }
  });

  test("runs the core R1 flow from period setup to verified achievement summary", async () => {
    await withIsolatedDb(async (tracker) => {
      const fixture = await createOpenNumericFixture(tracker);

      const facultyOne = await createTestUser(tracker, {
        firstName: "Anita",
        lastName: "Faculty",
      });
      const facultyTwo = await createTestUser(tracker, {
        firstName: "Bharat",
        lastName: "Faculty",
      });
      await createTestMembership({
        tenantId: fixture.tenant.id,
        userId: facultyOne.id,
        role: "TENANT_USER",
        createdByUserId: fixture.actor.id,
      });
      await createTestMembership({
        tenantId: fixture.tenant.id,
        userId: facultyTwo.id,
        role: "TENANT_USER",
        createdByUserId: fixture.actor.id,
      });

      const kraWeights = await validateKraWeightages(
        fixture.period.id,
        fixture.context.tenantId,
      );
      expect(kraWeights).toEqual({
        valid: true,
        sum: 100,
        remaining: 0,
      });

      const kpiWeights = await validateKpiWeightages(
        fixture.kra.id,
        fixture.context.tenantId,
      );
      expect(kpiWeights).toMatchObject({
        valid: true,
        sum: 100,
        kraWeightage: 100,
        remaining: 0,
      });

      const createParentAllocation = await createAllocation(
        fixture.context.tenantId,
        {
          periodId: fixture.period.id,
          kpiDefinitionId: fixture.kpi.id,
          assignedToUnitId: fixture.structure.cseUnitId,
          targetValue: 12,
          notes: "integration-parent-allocation",
        },
        fixture.context.actorUserId,
        fixture.context.actorRole,
      );
      expect(createParentAllocation.status).toBe("success");

      const parentAllocation = await prisma.targetAllocation.findFirst({
        where: {
          tenantId: fixture.context.tenantId,
          periodId: fixture.period.id,
          kpiDefinitionId: fixture.kpi.id,
          parentAllocationId: null,
          notes: "integration-parent-allocation",
        },
      });
      expect(parentAllocation).toBeTruthy();

      const cascadeResult = await cascadeTargets(
        parentAllocation!.id,
        fixture.context.tenantId,
        {
          distributions: [
            {
              assignedToUserId: facultyOne.id,
              targetValue: 6,
              notes: "integration-child-1",
            },
            {
              assignedToUserId: facultyTwo.id,
              targetValue: 6,
              notes: "integration-child-2",
            },
          ],
        },
        fixture.context.actorUserId,
        fixture.context.actorRole,
      );
      expect(cascadeResult.status).toBe("success");

      const allocations = await listAllocations(fixture.context.tenantId, {
        periodId: fixture.period.id,
        kpiDefinitionId: fixture.kpi.id,
      });
      expect(allocations).toHaveLength(3);
      expect(
        allocations.find((allocation) => allocation.id === parentAllocation!.id)?.childCount,
      ).toBe(2);

      const inProgressResult = await transitionPeriodState(
        fixture.period.id,
        fixture.context.tenantId,
        "IN_PROGRESS",
        fixture.context.actorUserId,
        fixture.context.actorRole,
      );
      expect(inProgressResult.status).toBe("success");

      const lockResult = await bulkLockTargets(
        fixture.period.id,
        fixture.context.tenantId,
        fixture.context.actorUserId,
        fixture.context.actorRole,
      );
      expect(lockResult.status).toBe("success");
      expect(lockResult.message).toContain("3");

      const lockedUpdate = await updateAllocation(
        parentAllocation!.id,
        fixture.context.tenantId,
        {
          targetValue: 15,
        },
        fixture.context.actorUserId,
        fixture.context.actorRole,
      );
      expect(lockedUpdate.status).toBe("error");
      expect(lockedUpdate.message).toContain("locked");

      const unlockResult = await unlockTarget(
        parentAllocation!.id,
        fixture.context.tenantId,
        fixture.context.actorUserId,
        fixture.context.actorRole,
      );
      expect(unlockResult.status).toBe("success");

      const unlockedUpdate = await updateAllocation(
        parentAllocation!.id,
        fixture.context.tenantId,
        {
          targetValue: 15,
          notes: "corrected after unlock",
        },
        fixture.context.actorUserId,
        fixture.context.actorRole,
      );
      expect(unlockedUpdate.status).toBe("success");

      const updatedParentAllocation = await prisma.targetAllocation.findUnique({
        where: { id: parentAllocation!.id },
      });
      expect(updatedParentAllocation?.state).toBe("ACTIVE");
      expect(updatedParentAllocation?.lockedAt).toBeNull();
      expect(updatedParentAllocation?.targetValue).toBe(15);
      expect(updatedParentAllocation?.notes).toBe("corrected after unlock");

      const childAllocation = await prisma.targetAllocation.findFirst({
        where: {
          tenantId: fixture.context.tenantId,
          parentAllocationId: parentAllocation!.id,
          assignedToUserId: facultyOne.id,
        },
      });
      expect(childAllocation).toBeTruthy();

      const achievementResult = await recordAchievement(
        fixture.context.tenantId,
        {
          periodId: fixture.period.id,
          kpiDefinitionId: fixture.kpi.id,
          targetAllocationId: childAllocation!.id,
          actualValue: 7,
          evidenceDescription: "Integration evidence",
        },
        facultyOne.id,
        "TENANT_USER",
      );
      expect(achievementResult.status).toBe("success");

      const achievement = await prisma.achievement.findFirst({
        where: {
          tenantId: fixture.context.tenantId,
          targetAllocationId: childAllocation!.id,
          reportedByUserId: facultyOne.id,
        },
      });
      expect(achievement?.computedScore).toBe(100);

      const submitResult = await submitForVerification(
        achievement!.id,
        fixture.context.tenantId,
        facultyOne.id,
        "TENANT_USER",
      );
      expect(submitResult.status).toBe("success");

      const verifyResult = await verifyAchievement(
        achievement!.id,
        fixture.context.tenantId,
        true,
        "Reviewed",
        fixture.context.actorUserId,
        fixture.context.actorRole,
      );
      expect(verifyResult.status).toBe("success");

      const summary = await getPeriodSummary(
        fixture.period.id,
        fixture.context.tenantId,
      );
      expect(summary).toMatchObject({
        totalKras: 1,
        totalKpis: 1,
        totalAllocations: 3,
        totalAchievements: 1,
        verifiedAchievements: 1,
        pendingVerification: 0,
        overallWeightedScore: 100,
        maxPossibleScore: 100,
        overallPercentage: 100,
      });
    });
  });

  test("creates multiple target allocations in a single batch request", async () => {
    await withIsolatedDb(async (tracker) => {
      const fixture = await createOpenNumericFixture(tracker);

      const facultyOne = await createTestUser(tracker, {
        firstName: "Selena",
        lastName: "Batch",
      });
      const facultyTwo = await createTestUser(tracker, {
        firstName: "Vikram",
        lastName: "Batch",
      });
      await createTestMembership({
        tenantId: fixture.tenant.id,
        userId: facultyOne.id,
        role: "TENANT_USER",
        createdByUserId: fixture.actor.id,
      });
      await createTestMembership({
        tenantId: fixture.tenant.id,
        userId: facultyTwo.id,
        role: "TENANT_USER",
        createdByUserId: fixture.actor.id,
      });

      const batchResult = await createAllocations(
        fixture.context.tenantId,
        {
          periodId: fixture.period.id,
          kpiDefinitionId: fixture.kpi.id,
          allocations: [
            {
              assignedToUnitId: fixture.structure.cseUnitId,
              targetValue: 8,
              notes: "batch-unit",
            },
            {
              assignedToUserId: facultyOne.id,
              targetValue: 4,
              notes: "batch-user-1",
            },
            {
              assignedToUserId: facultyTwo.id,
              targetValue: 4,
              notes: "batch-user-2",
            },
          ],
        },
        fixture.context.actorUserId,
        fixture.context.actorRole,
      );

      expect(batchResult.status).toBe("success");

      const allocations = await listAllocations(fixture.context.tenantId, {
        periodId: fixture.period.id,
        kpiDefinitionId: fixture.kpi.id,
      });
      expect(allocations).toHaveLength(3);
      expect(allocations.some((allocation) => allocation.assignedToUserId === facultyOne.id)).toBe(true);
      expect(allocations.some((allocation) => allocation.assignedToUserId === facultyTwo.id)).toBe(true);
    });
  });

  test("shows draft KRAs can accept KPIs before activation, while activation still validates KPI completeness", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupOwner(tracker);
      const structure = await createPublishedStructure(context);

      const createPeriodResult = await createPeriod(
        context.tenantId,
        {
          name: "AY 2026-27",
          code: "AY2026_27",
          periodType: "SPECIFIC_RANGE",
          startDate: new Date("2026-04-01T00:00:00.000Z"),
          endDate: new Date("2027-03-31T00:00:00.000Z"),
          reviewFrequency: "ANNUAL",
          targetSettingDeadline: new Date("2026-04-30T00:00:00.000Z"),
        },
        context.actorUserId,
        context.actorRole,
      );
      expect(createPeriodResult.status).toBe("success");

      const period = await prisma.assessmentPeriod.findUnique({
        where: {
          tenantId_code: {
            tenantId: context.tenantId,
            code: "AY2026_27",
          },
        },
      });
      expect(period).toBeTruthy();

      const createKraResult = await createKra(
        context.tenantId,
        {
          periodId: period!.id,
          title: "Number of Publications",
          description: "Draft KRA without KPIs yet",
          weightage: 10,
          sortOrder: 1,
        },
        context.actorUserId,
        context.actorRole,
      );
      expect(createKraResult.status).toBe("success");

      const kra = await prisma.kraDefinition.findFirst({
        where: {
          tenantId: context.tenantId,
          periodId: period!.id,
          title: "Number of Publications",
        },
      });
      expect(kra).toBeTruthy();

      const prematureActivateResult = await activateKra(
        kra!.id,
        context.tenantId,
        context.actorUserId,
        context.actorRole,
      );
      expect(prematureActivateResult.status).toBe("error");
      expect(prematureActivateResult.message).toContain("has no KPIs yet");

      const createKpiResult = await createKpi(
        context.tenantId,
        {
          kraDefinitionId: kra!.id,
          title: "Indexed Publications",
          description: "KPI added before activation",
          measurementType: "NUMERIC",
          unitLabel: "papers",
          weightage: 10,
          defaultTarget: 5,
          measurementConfig: {
            type: "NUMERIC",
            decimalPlaces: 0,
          },
          scoringMethod: "LINEAR",
          scoringDirection: "ASCENDING",
          scoringConfig: {
            method: "LINEAR",
            capAt100: true,
          },
          allocationType: "BOTH",
          startingUnitId: structure.cseUnitId,
          guidanceNotes: "Activation dependency regression",
          sortOrder: 1,
        },
        context.actorUserId,
        context.actorRole,
      );
      expect(createKpiResult.status).toBe("success");

      const createdKpi = await prisma.kpiDefinition.findFirst({
        where: {
          kraDefinitionId: kra!.id,
          title: "Indexed Publications",
        },
      });
      expect(createdKpi).toBeTruthy();

      const activateResult = await activateKra(
        kra!.id,
        context.tenantId,
        context.actorUserId,
        context.actorRole,
      );
      expect(activateResult.status).toBe("success");
    });
  });

  test("returns a friendly error when KPI creation is attempted without selecting a starting unit", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupOwner(tracker);
      await createPublishedStructure(context);

      const availableUnits = await listActiveStructureUnits(context.tenantId);
      expect(availableUnits.some((unit) => unit.code === "CSE")).toBe(true);

      const createPeriodResult = await createPeriod(
        context.tenantId,
        {
          name: "AY 2027-28",
          code: "AY2027_28",
          periodType: "SPECIFIC_RANGE",
          startDate: new Date("2027-04-01T00:00:00.000Z"),
          endDate: new Date("2028-03-31T00:00:00.000Z"),
          reviewFrequency: "ANNUAL",
          targetSettingDeadline: new Date("2027-04-30T00:00:00.000Z"),
        },
        context.actorUserId,
        context.actorRole,
      );
      expect(createPeriodResult.status).toBe("success");

      const period = await prisma.assessmentPeriod.findUnique({
        where: {
          tenantId_code: {
            tenantId: context.tenantId,
            code: "AY2027_28",
          },
        },
      });
      expect(period).toBeTruthy();

      const createKraResult = await createKra(
        context.tenantId,
        {
          periodId: period!.id,
          title: "Community Outreach",
          description: "KRA for missing starting-unit validation",
          weightage: 10,
          sortOrder: 1,
        },
        context.actorUserId,
        context.actorRole,
      );
      expect(createKraResult.status).toBe("success");

      const kra = await prisma.kraDefinition.findFirst({
        where: {
          tenantId: context.tenantId,
          periodId: period!.id,
          title: "Community Outreach",
        },
      });
      expect(kra).toBeTruthy();

      const createKpiResult = await createKpi(
        context.tenantId,
        {
          kraDefinitionId: kra!.id,
          title: "Workshops Delivered",
          description: "KPI without a starting unit",
          measurementType: "NUMERIC",
          unitLabel: "workshops",
          weightage: 10,
          defaultTarget: 4,
          scoringMethod: "LINEAR",
          scoringDirection: "ASCENDING",
          allocationType: "BOTH",
          startingUnitId: "",
          sortOrder: 1,
        },
        context.actorUserId,
        context.actorRole,
      );

      expect(createKpiResult.status).toBe("error");
      expect(createKpiResult.message).toBe("Select a starting unit.");
    });
  });

  test("allows tenant admins to create and update KRAs and KPIs while a period is under review", async () => {
    await withIsolatedDb(async (tracker) => {
      const fixture = await createOpenNumericFixture(tracker, {
        kraWeightage: 60,
        kpiWeightage: 60,
      });

      const admin = await createTestUser(tracker, {
        firstName: "Uma",
        lastName: "Admin",
      });
      await createTestMembership({
        tenantId: fixture.tenant.id,
        userId: admin.id,
        role: "TENANT_ADMIN",
        createdByUserId: fixture.actor.id,
      });

      const adminContext: ActorContext = {
        tenantId: fixture.context.tenantId,
        actorUserId: admin.id,
        actorRole: "TENANT_ADMIN",
      };

      const inProgressResult = await transitionPeriodState(
        fixture.period.id,
        fixture.context.tenantId,
        "IN_PROGRESS",
        fixture.context.actorUserId,
        fixture.context.actorRole,
      );
      expect(inProgressResult.status).toBe("success");

      const underReviewResult = await transitionPeriodState(
        fixture.period.id,
        fixture.context.tenantId,
        "UNDER_REVIEW",
        fixture.context.actorUserId,
        fixture.context.actorRole,
      );
      expect(underReviewResult.status).toBe("success");

      const createKraResult = await createKra(
        adminContext.tenantId,
        {
          periodId: fixture.period.id,
          title: "Teaching Quality",
          description: "Added while the period is under review",
          weightage: 40,
          sortOrder: 2,
        },
        adminContext.actorUserId,
        adminContext.actorRole,
      );
      expect(createKraResult.status).toBe("success");

      const reviewKra = await prisma.kraDefinition.findFirst({
        where: {
          tenantId: adminContext.tenantId,
          periodId: fixture.period.id,
          title: "Teaching Quality",
        },
      });
      expect(reviewKra).toBeTruthy();

      const updateKraResult = await updateKra(
        fixture.kra.id,
        adminContext.tenantId,
        {
          title: "Research Excellence Revised",
        },
        adminContext.actorUserId,
        adminContext.actorRole,
      );
      expect(updateKraResult.status).toBe("success");

      const createKpiResult = await createKpi(
        adminContext.tenantId,
        {
          kraDefinitionId: reviewKra!.id,
          title: "Course Outcomes",
          description: "Added while the period is under review",
          measurementType: "NUMERIC",
          unitLabel: "courses",
          weightage: 40,
          defaultTarget: 8,
          measurementConfig: {
            type: "NUMERIC",
            decimalPlaces: 0,
          },
          scoringMethod: "LINEAR",
          scoringDirection: "ASCENDING",
          scoringConfig: {
            method: "LINEAR",
            capAt100: true,
          },
          allocationType: "BOTH",
          startingUnitId: fixture.structure.cseUnitId,
          guidanceNotes: "Created in under review",
          sortOrder: 1,
        },
        adminContext.actorUserId,
        adminContext.actorRole,
      );
      expect(createKpiResult.status).toBe("success");

      const updateKpiResult = await updateKpi(
        fixture.kpi.id,
        adminContext.tenantId,
        {
          guidanceNotes: "Updated during under review",
        },
        adminContext.actorUserId,
        adminContext.actorRole,
      );
      expect(updateKpiResult.status).toBe("success");

      const updatedKra = await prisma.kraDefinition.findUnique({
        where: { id: fixture.kra.id },
      });
      expect(updatedKra?.title).toBe("Research Excellence Revised");

      const createdKpi = await prisma.kpiDefinition.findFirst({
        where: {
          kraDefinitionId: reviewKra!.id,
          title: "Course Outcomes",
        },
      });
      expect(createdKpi).toBeTruthy();

      const updatedKpi = await prisma.kpiDefinition.findUnique({
        where: { id: fixture.kpi.id },
      });
      expect(updatedKpi?.guidanceNotes).toBe("Updated during under review");
    });
  });

  test("rejects numeric cascades when child totals do not match the parent target", async () => {
    await withIsolatedDb(async (tracker) => {
      const fixture = await createOpenNumericFixture(tracker);

      const createParentAllocation = await createAllocation(
        fixture.context.tenantId,
        {
          periodId: fixture.period.id,
          kpiDefinitionId: fixture.kpi.id,
          assignedToUnitId: fixture.structure.cseUnitId,
          targetValue: 10,
          notes: "integration-invalid-cascade-parent",
        },
        fixture.context.actorUserId,
        fixture.context.actorRole,
      );
      expect(createParentAllocation.status).toBe("success");

      const parentAllocation = await prisma.targetAllocation.findFirst({
        where: {
          tenantId: fixture.context.tenantId,
          notes: "integration-invalid-cascade-parent",
        },
      });
      expect(parentAllocation).toBeTruthy();

      const faculty = await createTestUser(tracker, {
        firstName: "Cascade",
        lastName: "Mismatch",
      });
      await createTestMembership({
        tenantId: fixture.tenant.id,
        userId: faculty.id,
        role: "TENANT_USER",
        createdByUserId: fixture.actor.id,
      });

      const cascadeResult = await cascadeTargets(
        parentAllocation!.id,
        fixture.context.tenantId,
        {
          distributions: [
            {
              assignedToUserId: faculty.id,
              targetValue: 9,
            },
          ],
        },
        fixture.context.actorUserId,
        fixture.context.actorRole,
      );

      expect(cascadeResult.status).toBe("error");
      expect(cascadeResult.message).toContain("must sum to parent");
    });
  });

  test("rejects cascading from an individual allocation", async () => {
    await withIsolatedDb(async (tracker) => {
      const fixture = await createOpenNumericFixture(tracker);

      const faculty = await createTestUser(tracker, {
        firstName: "Ira",
        lastName: "Individual",
      });
      await createTestMembership({
        tenantId: fixture.tenant.id,
        userId: faculty.id,
        role: "TENANT_USER",
        createdByUserId: fixture.actor.id,
      });

      const allocationResult = await createAllocation(
        fixture.context.tenantId,
        {
          periodId: fixture.period.id,
          kpiDefinitionId: fixture.kpi.id,
          assignedToUserId: faculty.id,
          targetValue: 5,
          notes: "individual-parent-allocation",
        },
        fixture.context.actorUserId,
        fixture.context.actorRole,
      );
      expect(allocationResult.status).toBe("success");

      const individualAllocation = await prisma.targetAllocation.findFirst({
        where: {
          tenantId: fixture.context.tenantId,
          assignedToUserId: faculty.id,
          notes: "individual-parent-allocation",
        },
      });
      expect(individualAllocation).toBeTruthy();

      const cascadeResult = await cascadeTargets(
        individualAllocation!.id,
        fixture.context.tenantId,
        {
          distributions: [
            {
              assignedToUnitId: fixture.structure.cseUnitId,
              targetValue: 5,
            },
          ],
        },
        fixture.context.actorUserId,
        fixture.context.actorRole,
      );

      expect(cascadeResult.status).toBe("error");
      expect(cascadeResult.message).toBe("Individual allocations cannot be cascaded.");
    });
  });

  test("allows admins to move an archived period back to OPEN", async () => {
    await withIsolatedDb(async (tracker) => {
      const fixture = await createOpenNumericFixture(tracker);

      const archivedResult = await transitionPeriodState(
        fixture.period.id,
        fixture.context.tenantId,
        "ARCHIVED",
        fixture.context.actorUserId,
        fixture.context.actorRole,
      );
      expect(archivedResult.status).toBe("success");

      const reopenResult = await transitionPeriodState(
        fixture.period.id,
        fixture.context.tenantId,
        "OPEN",
        fixture.context.actorUserId,
        fixture.context.actorRole,
      );
      expect(reopenResult.status).toBe("success");

      const period = await prisma.assessmentPeriod.findUnique({
        where: { id: fixture.period.id },
      });
      expect(period?.state).toBe("OPEN");
    });
  });
});
