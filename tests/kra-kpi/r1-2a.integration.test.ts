import type { Role } from "@prisma/client";
import { afterEach, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createOrgUnit,
  createOrgUnitType,
  publishOrgStructure,
  validateOrgStructureDraft,
} from "@/lib/org-structure/service";
import { createCategory } from "@/lib/kra-kpi/category-service";
import { createPeriod, transitionPeriodState } from "@/lib/kra-kpi/period-service";
import { activateKra, createKra } from "@/lib/kra-kpi/kra-service";
import { createKpi } from "@/lib/kra-kpi/kpi-service";
import { createAllocation } from "@/lib/kra-kpi/target-service";
import {
  recordAchievement,
  recordAdditionalAchievement,
  submitForVerification,
} from "@/lib/kra-kpi/achievement-service";
import {
  getAvailableKpis,
  getMyPendingCount,
  getMyReviewQueue,
} from "@/lib/kra-kpi/my-kpi-service";
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

type StructureFixture = {
  versionId: string;
  rootUnitId: string;
  schoolUnitId: string;
  cseUnitId: string;
  eceUnitId: string;
};

type R12aFixture = {
  context: ActorContext;
  actor: { id: string };
  tenant: { id: string };
  structure: StructureFixture;
  period: { id: string };
  categories: {
    research: { id: string; categoryKey: string };
    teaching: { id: string; categoryKey: string };
  };
  users: {
    dean: { id: string };
    cseHead: { id: string };
    eceHead: { id: string };
    faculty: { id: string };
  };
  kpiIds: {
    allocated: string;
    additional: string;
    teaching: string;
  };
};

async function withIsolatedDb(run: (tracker: DbTracker) => Promise<void>) {
  const tracker = newDbTracker();
  try {
    await run(tracker);
  } finally {
    await cleanupTrackedData(tracker);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-20T00:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

async function setupOwner(tracker: DbTracker) {
  const { tenant, actor } = await createTenantActor(tracker, "TENANT_OWNER");
  const context: ActorContext = {
    tenantId: tenant.id,
    actorUserId: actor.id,
    actorRole: "TENANT_OWNER",
  };

  return { tenant, actor, context };
}

async function createPublishedHierarchy(ctx: ActorContext): Promise<StructureFixture> {
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
      typeKey: "SCH",
      displayLabel: "School",
      internalCategory: "SCHOOL_LIKE_UNIT",
      allowRoot: false,
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
  const schoolType = draft!.unitTypes.find((type) => type.typeKey === "SCH");
  const deptType = draft!.unitTypes.find((type) => type.typeKey === "DEPT");
  expect(rootType).toBeTruthy();
  expect(schoolType).toBeTruthy();
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
      typeId: schoolType!.id,
      code: "ENG",
      name: "School of Engineering",
      parentId: root!.id,
    },
  });

  const school = await prisma.orgUnit.findFirst({
    where: {
      version: { tenantId: ctx.tenantId, state: "DRAFT" },
      code: "ENG",
    },
  });
  expect(school).toBeTruthy();

  await createOrgUnit({
    ...ctx,
    values: {
      typeId: deptType!.id,
      code: "CSE",
      name: "Computer Science",
      parentId: school!.id,
    },
  });
  await createOrgUnit({
    ...ctx,
    values: {
      typeId: deptType!.id,
      code: "ECE",
      name: "Electronics",
      parentId: school!.id,
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
    schoolUnitId: published!.units.find((unit) => unit.code === "ENG")!.id,
    cseUnitId: published!.units.find((unit) => unit.code === "CSE")!.id,
    eceUnitId: published!.units.find((unit) => unit.code === "ECE")!.id,
  };
}

async function createRoleDefinition(
  tenantId: string,
  createdByUserId: string,
  roleKey: string,
  displayLabel: string,
  isUnitHead: boolean,
) {
  return prisma.orgRoleDefinition.create({
    data: {
      tenantId,
      roleKey,
      displayLabel,
      isUnitHead,
      approvalAuthority: isUnitHead,
      maxPerUnit: isUnitHead ? 1 : -1,
      sortOrder: isUnitHead ? 10 : 50,
      createdByUserId,
    },
  });
}

async function assignRole(options: {
  versionId: string;
  unitId: string;
  userId: string;
  roleDefinitionId: string;
  roleName: string;
  isPrimary?: boolean;
}) {
  await prisma.userOrgAssignment.create({
    data: {
      versionId: options.versionId,
      unitId: options.unitId,
      userId: options.userId,
      assignmentType: options.isPrimary === false ? "SECONDARY" : "PRIMARY",
      isPrimary: options.isPrimary !== false,
    },
  });

  await prisma.orgRoleAssignment.create({
    data: {
      versionId: options.versionId,
      unitId: options.unitId,
      userId: options.userId,
      roleDefinitionId: options.roleDefinitionId,
      roleName: options.roleName,
      scope: "NODE",
    },
  });
}

async function createNumericKpi(input: {
  context: ActorContext;
  kraId: string;
  title: string;
  weightage: number;
  startingUnitId: string;
  defaultTarget: number;
  sortOrder: number;
}) {
  const result = await createKpi(
    input.context.tenantId,
    {
      kraDefinitionId: input.kraId,
      title: input.title,
      description: `${input.title} KPI`,
      measurementType: "NUMERIC",
      unitLabel: "items",
      weightage: input.weightage,
      defaultTarget: input.defaultTarget,
      measurementConfig: { type: "NUMERIC", decimalPlaces: 0 },
      scoringMethod: "LINEAR",
      scoringDirection: "ASCENDING",
      scoringConfig: { method: "LINEAR", capAt100: true },
      allocationType: "INDIVIDUAL",
      startingUnitId: input.startingUnitId,
      sortOrder: input.sortOrder,
    },
    input.context.actorUserId,
    input.context.actorRole,
  );
  expect(result.status, result.message).toBe("success");

  const kpi = await prisma.kpiDefinition.findFirst({
    where: {
      kraDefinitionId: input.kraId,
      title: input.title,
    },
    select: { id: true },
  });
  expect(kpi).toBeTruthy();

  return kpi!.id;
}

async function createTaggedAllocation(input: {
  fixture: R12aFixture;
  kpiDefinitionId: string;
  assignedToUserId?: string;
  assignedToUnitId?: string;
  targetValue: number;
  notes: string;
}) {
  const result = await createAllocation(
    input.fixture.context.tenantId,
    {
      periodId: input.fixture.period.id,
      kpiDefinitionId: input.kpiDefinitionId,
      assignedToUserId: input.assignedToUserId,
      assignedToUnitId: input.assignedToUnitId,
      targetValue: input.targetValue,
      notes: input.notes,
    },
    input.fixture.context.actorUserId,
    input.fixture.context.actorRole,
  );
  expect(result.status, result.message).toBe("success");

  const allocation = await prisma.targetAllocation.findFirst({
    where: {
      tenantId: input.fixture.context.tenantId,
      periodId: input.fixture.period.id,
      kpiDefinitionId: input.kpiDefinitionId,
      notes: input.notes,
    },
    orderBy: { createdAt: "desc" },
  });
  expect(allocation).toBeTruthy();

  return allocation!;
}

async function createR12aFixture(tracker: DbTracker): Promise<R12aFixture> {
  const suffix = Date.now().toString(36).toUpperCase();
  const { tenant, actor, context } = await setupOwner(tracker);
  const structure = await createPublishedHierarchy(context);

  const users = {
    dean: await createTestUser(tracker, { firstName: "Dina", lastName: "Dean" }),
    cseHead: await createTestUser(tracker, { firstName: "Hari", lastName: "Head" }),
    eceHead: await createTestUser(tracker, { firstName: "Esha", lastName: "Head" }),
    faculty: await createTestUser(tracker, { firstName: "Cora", lastName: "Faculty" }),
  };

  for (const user of Object.values(users)) {
    await createTestMembership({
      tenantId: tenant.id,
      userId: user.id,
      role: "TENANT_USER",
      createdByUserId: actor.id,
    });
  }

  const deanRole = await createRoleDefinition(
    tenant.id,
    actor.id,
    `DEAN_${suffix}`,
    "Dean",
    true,
  );
  const headRole = await createRoleDefinition(
    tenant.id,
    actor.id,
    `HEAD_${suffix}`,
    "Department Head",
    true,
  );
  const facultyRole = await createRoleDefinition(
    tenant.id,
    actor.id,
    `PROF_${suffix}`,
    "Professor",
    false,
  );

  await assignRole({
    versionId: structure.versionId,
    unitId: structure.schoolUnitId,
    userId: users.dean.id,
    roleDefinitionId: deanRole.id,
    roleName: deanRole.displayLabel,
  });
  await assignRole({
    versionId: structure.versionId,
    unitId: structure.cseUnitId,
    userId: users.cseHead.id,
    roleDefinitionId: headRole.id,
    roleName: headRole.displayLabel,
  });
  await assignRole({
    versionId: structure.versionId,
    unitId: structure.eceUnitId,
    userId: users.eceHead.id,
    roleDefinitionId: headRole.id,
    roleName: headRole.displayLabel,
  });
  await assignRole({
    versionId: structure.versionId,
    unitId: structure.cseUnitId,
    userId: users.faculty.id,
    roleDefinitionId: facultyRole.id,
    roleName: facultyRole.displayLabel,
  });
  await assignRole({
    versionId: structure.versionId,
    unitId: structure.eceUnitId,
    userId: users.faculty.id,
    roleDefinitionId: facultyRole.id,
    roleName: facultyRole.displayLabel,
    isPrimary: false,
  });

  const researchKey = `R12A_RESEARCH_${suffix}`;
  const teachingKey = `R12A_TEACHING_${suffix}`;

  expect(
    await createCategory(
      context.tenantId,
      {
        categoryKey: researchKey,
        displayLabel: "Research",
      },
      context.actorUserId,
      context.actorRole,
    ),
  ).toMatchObject({ status: "success" });
  expect(
    await createCategory(
      context.tenantId,
      {
        categoryKey: teachingKey,
        displayLabel: "Teaching",
      },
      context.actorUserId,
      context.actorRole,
    ),
  ).toMatchObject({ status: "success" });

  const categories = await prisma.kraCategoryDefinition.findMany({
    where: {
      tenantId: context.tenantId,
      categoryKey: { in: [researchKey, teachingKey] },
    },
    select: { id: true, categoryKey: true },
  });
  const researchCategory = categories.find((category) => category.categoryKey === researchKey);
  const teachingCategory = categories.find((category) => category.categoryKey === teachingKey);
  expect(researchCategory).toBeTruthy();
  expect(teachingCategory).toBeTruthy();

  const periodResult = await createPeriod(
    context.tenantId,
    {
      name: "AY 2026-27",
      code: `AY2026_27_${suffix}`,
      periodType: "SPECIFIC_RANGE",
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      endDate: new Date("2026-12-31T00:00:00.000Z"),
      reviewFrequency: "MONTHLY",
      targetSettingDeadline: new Date("2026-01-31T00:00:00.000Z"),
      achievementDeadline: new Date("2026-12-20T00:00:00.000Z"),
      reviewDeadline: new Date("2026-12-31T00:00:00.000Z"),
    },
    context.actorUserId,
    context.actorRole,
  );
  expect(periodResult.status).toBe("success");

  const period = await prisma.assessmentPeriod.findUnique({
    where: {
      tenantId_code: {
        tenantId: context.tenantId,
        code: `AY2026_27_${suffix}`,
      },
    },
    select: { id: true },
  });
  expect(period).toBeTruthy();

  const researchKraResult = await createKra(
    context.tenantId,
    {
      periodId: period!.id,
      title: "Research Contributions",
      description: "R1.2a research KRA",
      weightage: 70,
      sortOrder: 1,
      categoryId: researchCategory!.id,
    },
    context.actorUserId,
    context.actorRole,
  );
  expect(researchKraResult.status).toBe("success");

  const teachingKraResult = await createKra(
    context.tenantId,
    {
      periodId: period!.id,
      title: "Teaching Contributions",
      description: "R1.2a teaching KRA",
      weightage: 30,
      sortOrder: 2,
      categoryId: teachingCategory!.id,
    },
    context.actorUserId,
    context.actorRole,
  );
  expect(teachingKraResult.status).toBe("success");

  const kras = await prisma.kraDefinition.findMany({
    where: {
      tenantId: context.tenantId,
      periodId: period!.id,
    },
    select: { id: true, title: true },
  });
  const researchKra = kras.find((kra) => kra.title === "Research Contributions");
  const teachingKra = kras.find((kra) => kra.title === "Teaching Contributions");
  expect(researchKra).toBeTruthy();
  expect(teachingKra).toBeTruthy();

  const allocatedKpiId = await createNumericKpi({
    context,
    kraId: researchKra!.id,
    title: "Allocated KPI",
    weightage: 30,
    startingUnitId: structure.cseUnitId,
    defaultTarget: 10,
    sortOrder: 1,
  });
  const additionalKpiId = await createNumericKpi({
    context,
    kraId: researchKra!.id,
    title: "Additional KPI",
    weightage: 40,
    startingUnitId: structure.schoolUnitId,
    defaultTarget: 5,
    sortOrder: 2,
  });
  const teachingKpiId = await createNumericKpi({
    context,
    kraId: teachingKra!.id,
    title: "Teaching KPI",
    weightage: 30,
    startingUnitId: structure.schoolUnitId,
    defaultTarget: 2,
    sortOrder: 1,
  });

  expect(
    await activateKra(
      researchKra!.id,
      context.tenantId,
      context.actorUserId,
      context.actorRole,
    ),
  ).toMatchObject({ status: "success" });
  expect(
    await activateKra(
      teachingKra!.id,
      context.tenantId,
      context.actorUserId,
      context.actorRole,
    ),
  ).toMatchObject({ status: "success" });
  expect(
    await transitionPeriodState(
      period!.id,
      context.tenantId,
      "OPEN",
      context.actorUserId,
      context.actorRole,
    ),
  ).toMatchObject({ status: "success" });

  return {
    context,
    actor,
    tenant,
    structure,
    period: period!,
    categories: {
      research: researchCategory!,
      teaching: teachingCategory!,
    },
    users,
    kpiIds: {
      allocated: allocatedKpiId,
      additional: additionalKpiId,
      teaching: teachingKpiId,
    },
  };
}

describe("R1.2a additional achievement integration", () => {
  test("period transitions notify allocation recipients in the period", async () => {
    await withIsolatedDb(async (tracker) => {
      const fixture = await createR12aFixture(tracker);

      await createTaggedAllocation({
        fixture,
        kpiDefinitionId: fixture.kpiIds.allocated,
        assignedToUserId: fixture.users.faculty.id,
        targetValue: 10,
        notes: "r12a-direct-allocation",
      });
      await createTaggedAllocation({
        fixture,
        kpiDefinitionId: fixture.kpiIds.additional,
        assignedToUnitId: fixture.structure.cseUnitId,
        targetValue: 12,
        notes: "r12a-unit-allocation",
      });

      const transition = await transitionPeriodState(
        fixture.period.id,
        fixture.context.tenantId,
        "IN_PROGRESS",
        fixture.context.actorUserId,
        fixture.context.actorRole,
      );
      expect(transition.status).toBe("success");

      const notifications = await prisma.notification.findMany({
        where: {
          tenantId: fixture.context.tenantId,
          type: "PERIOD_STATE_CHANGED",
        },
        select: { userId: true, title: true },
      });

      expect(notifications.map((notification) => notification.userId)).toEqual(
        expect.arrayContaining([fixture.users.faculty.id, fixture.users.cseHead.id]),
      );
      expect(notifications.every((notification) => notification.title === "Assessment period state changed")).toBe(true);
    });
  });

  test("only the reporting assignee can submit an achievement draft", async () => {
    await withIsolatedDb(async (tracker) => {
      const fixture = await createR12aFixture(tracker);
      const allocation = await createTaggedAllocation({
        fixture,
        kpiDefinitionId: fixture.kpiIds.allocated,
        assignedToUserId: fixture.users.faculty.id,
        targetValue: 10,
        notes: "r12a-submit-allocation",
      });

      expect(
        await transitionPeriodState(
          fixture.period.id,
          fixture.context.tenantId,
          "IN_PROGRESS",
          fixture.context.actorUserId,
          fixture.context.actorRole,
        ),
      ).toMatchObject({ status: "success" });

      const recordResult = await recordAchievement(
        fixture.context.tenantId,
        {
          periodId: fixture.period.id,
          kpiDefinitionId: fixture.kpiIds.allocated,
          targetAllocationId: allocation.id,
          actualValue: 9,
          evidenceDescription: "Faculty draft",
        },
        fixture.users.faculty.id,
        "TENANT_USER",
      );
      expect(recordResult.status).toBe("success");

      const achievement = await prisma.achievement.findFirst({
        where: {
          tenantId: fixture.context.tenantId,
          targetAllocationId: allocation.id,
          reportedByUserId: fixture.users.faculty.id,
        },
        select: { id: true },
      });
      expect(achievement).toBeTruthy();

      const ownerSubmit = await submitForVerification(
        achievement!.id,
        fixture.context.tenantId,
        fixture.context.actorUserId,
        fixture.context.actorRole,
      );
      expect(ownerSubmit).toMatchObject({
        status: "error",
        message: "Only the reporter can submit.",
      });

      const reporterSubmit = await submitForVerification(
        achievement!.id,
        fixture.context.tenantId,
        fixture.users.faculty.id,
        "TENANT_USER",
      );
      expect(reporterSubmit.status).toBe("success");
    });
  });

  test("additional achievements honor cycle rules, category filters, and primary-unit review routing", async () => {
    await withIsolatedDb(async (tracker) => {
      const fixture = await createR12aFixture(tracker);

      await createTaggedAllocation({
        fixture,
        kpiDefinitionId: fixture.kpiIds.allocated,
        assignedToUserId: fixture.users.faculty.id,
        targetValue: 10,
        notes: "r12a-allocated-filter",
      });

      expect(
        await transitionPeriodState(
          fixture.period.id,
          fixture.context.tenantId,
          "IN_PROGRESS",
          fixture.context.actorUserId,
          fixture.context.actorRole,
        ),
      ).toMatchObject({ status: "success" });

      const previousCycle = await recordAdditionalAchievement(
        fixture.context.tenantId,
        {
          periodId: fixture.period.id,
          kpiDefinitionId: fixture.kpiIds.teaching,
          actualValue: 2,
          evidenceDescription: "January teaching contribution",
          reportingDate: new Date("2026-01-15T00:00:00.000Z"),
        },
        fixture.users.faculty.id,
        "TENANT_USER",
      );
      expect(previousCycle.status).toBe("success");

      const previousCycleAchievement = await prisma.achievement.findFirst({
        where: {
          tenantId: fixture.context.tenantId,
          periodId: fixture.period.id,
          kpiDefinitionId: fixture.kpiIds.teaching,
          reportedByUserId: fixture.users.faculty.id,
          targetAllocationId: null,
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      expect(previousCycleAchievement).toBeTruthy();

      await prisma.achievement.update({
        where: { id: previousCycleAchievement!.id },
        data: {
          state: "VERIFIED",
          verifiedByUserId: fixture.users.dean.id,
          verifiedAt: new Date("2026-01-20T00:00:00.000Z"),
        },
      });

      const currentCycle = await recordAdditionalAchievement(
        fixture.context.tenantId,
        {
          periodId: fixture.period.id,
          kpiDefinitionId: fixture.kpiIds.additional,
          actualValue: 4,
          evidenceDescription: "March cross-unit contribution",
          reportingDate: new Date("2026-03-10T00:00:00.000Z"),
        },
        fixture.users.faculty.id,
        "TENANT_USER",
      );
      expect(currentCycle.status).toBe("success");

      const currentCycleAchievement = await prisma.achievement.findFirst({
        where: {
          tenantId: fixture.context.tenantId,
          periodId: fixture.period.id,
          kpiDefinitionId: fixture.kpiIds.additional,
          reportedByUserId: fixture.users.faculty.id,
          targetAllocationId: null,
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      expect(currentCycleAchievement).toBeTruthy();

      const availableAll = await getAvailableKpis(
        fixture.context.tenantId,
        fixture.users.faculty.id,
        fixture.period.id,
      );
      expect(availableAll.map((kpi) => kpi.kpiTitle)).toEqual(["Teaching KPI"]);

      const availableResearch = await getAvailableKpis(
        fixture.context.tenantId,
        fixture.users.faculty.id,
        fixture.period.id,
        undefined,
        fixture.categories.research.categoryKey,
      );
      expect(availableResearch).toHaveLength(0);

      const availableTeaching = await getAvailableKpis(
        fixture.context.tenantId,
        fixture.users.faculty.id,
        fixture.period.id,
        undefined,
        fixture.categories.teaching.categoryKey,
      );
      expect(availableTeaching.map((kpi) => kpi.kpiTitle)).toEqual(["Teaching KPI"]);

      const submitResult = await submitForVerification(
        currentCycleAchievement!.id,
        fixture.context.tenantId,
        fixture.users.faculty.id,
        "TENANT_USER",
      );
      expect(submitResult.status).toBe("success");

      const submitNotifications = await prisma.notification.findMany({
        where: {
          tenantId: fixture.context.tenantId,
          type: "ACHIEVEMENT_SUBMITTED",
          entityId: currentCycleAchievement!.id,
        },
        select: { userId: true },
      });
      expect(submitNotifications.map((notification) => notification.userId)).toEqual([
        fixture.users.cseHead.id,
      ]);

      const cseQueue = await getMyReviewQueue(
        fixture.context.tenantId,
        fixture.users.cseHead.id,
        fixture.period.id,
      );
      expect(cseQueue).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            achievementId: currentCycleAchievement!.id,
            reviewLevel: "RECOMMEND",
          }),
        ]),
      );

      const eceQueue = await getMyReviewQueue(
        fixture.context.tenantId,
        fixture.users.eceHead.id,
        fixture.period.id,
      );
      expect(eceQueue.some((item) => item.achievementId === currentCycleAchievement!.id)).toBe(
        false,
      );

      expect(
        await getMyPendingCount(fixture.context.tenantId, fixture.users.cseHead.id),
      ).toBe(1);
      expect(
        await getMyPendingCount(fixture.context.tenantId, fixture.users.eceHead.id),
      ).toBe(0);

      const duplicateCurrentCycle = await recordAdditionalAchievement(
        fixture.context.tenantId,
        {
          periodId: fixture.period.id,
          kpiDefinitionId: fixture.kpiIds.additional,
          actualValue: 5,
          evidenceDescription: "Duplicate March entry",
          reportingDate: new Date("2026-03-20T00:00:00.000Z"),
        },
        fixture.users.faculty.id,
        "TENANT_USER",
      );
      expect(duplicateCurrentCycle.status).toBe("error");
      expect(duplicateCurrentCycle.message).toContain("current review cycle");

      const nextCycleAfterVerified = await recordAdditionalAchievement(
        fixture.context.tenantId,
        {
          periodId: fixture.period.id,
          kpiDefinitionId: fixture.kpiIds.teaching,
          actualValue: 3,
          evidenceDescription: "March teaching contribution",
          reportingDate: new Date("2026-03-20T00:00:00.000Z"),
        },
        fixture.users.faculty.id,
        "TENANT_USER",
      );
      expect(nextCycleAfterVerified.status).toBe("success");
    });
  });

  test("additional achievements reject KPIs from another period", async () => {
    await withIsolatedDb(async (tracker) => {
      const fixture = await createR12aFixture(tracker);

      expect(
        await transitionPeriodState(
          fixture.period.id,
          fixture.context.tenantId,
          "IN_PROGRESS",
          fixture.context.actorUserId,
          fixture.context.actorRole,
        ),
      ).toMatchObject({ status: "success" });

      const foreignPeriodCode = `AY2027_28_${Date.now().toString(36).toUpperCase()}`;
      expect(
        await createPeriod(
          fixture.context.tenantId,
          {
            name: "AY 2027-28",
            code: foreignPeriodCode,
            periodType: "SPECIFIC_RANGE",
            startDate: new Date("2027-01-01T00:00:00.000Z"),
            endDate: new Date("2027-12-31T00:00:00.000Z"),
            reviewFrequency: "ANNUAL",
            targetSettingDeadline: new Date("2027-01-31T00:00:00.000Z"),
          },
          fixture.context.actorUserId,
          fixture.context.actorRole,
        ),
      ).toMatchObject({ status: "success" });

      const foreignPeriod = await prisma.assessmentPeriod.findUnique({
        where: {
          tenantId_code: {
            tenantId: fixture.context.tenantId,
            code: foreignPeriodCode,
          },
        },
        select: { id: true },
      });
      expect(foreignPeriod).toBeTruthy();

      expect(
        await createKra(
          fixture.context.tenantId,
          {
            periodId: foreignPeriod!.id,
            title: "Foreign Period KRA",
            description: "Foreign period KRA",
            weightage: 100,
            sortOrder: 1,
          },
          fixture.context.actorUserId,
          fixture.context.actorRole,
        ),
      ).toMatchObject({ status: "success" });

      const foreignKra = await prisma.kraDefinition.findFirst({
        where: {
          tenantId: fixture.context.tenantId,
          periodId: foreignPeriod!.id,
          title: "Foreign Period KRA",
        },
        select: { id: true },
      });
      expect(foreignKra).toBeTruthy();

      const foreignKpiId = await createNumericKpi({
        context: fixture.context,
        kraId: foreignKra!.id,
        title: "Foreign Period KPI",
        weightage: 100,
        startingUnitId: fixture.structure.schoolUnitId,
        defaultTarget: 8,
        sortOrder: 1,
      });

      expect(
        await activateKra(
          foreignKra!.id,
          fixture.context.tenantId,
          fixture.context.actorUserId,
          fixture.context.actorRole,
        ),
      ).toMatchObject({ status: "success" });

      const mismatchedPeriodResult = await recordAdditionalAchievement(
        fixture.context.tenantId,
        {
          periodId: fixture.period.id,
          kpiDefinitionId: foreignKpiId,
          actualValue: 6,
          evidenceDescription: "Wrong-period KPI",
          reportingDate: new Date("2026-03-20T00:00:00.000Z"),
        },
        fixture.users.faculty.id,
        "TENANT_USER",
      );
      expect(mismatchedPeriodResult).toMatchObject({
        status: "error",
        message: "KPI not found.",
      });
    });
  });
});
