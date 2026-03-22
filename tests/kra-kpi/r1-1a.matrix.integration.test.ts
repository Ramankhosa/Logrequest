import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  createOrgUnit,
  createOrgUnitType,
  publishOrgStructure,
  validateOrgStructureDraft,
} from "@/lib/org-structure/service";
import { createPeriod, transitionPeriodState } from "@/lib/kra-kpi/period-service";
import { activateKra, createKra } from "@/lib/kra-kpi/kra-service";
import { createKpi } from "@/lib/kra-kpi/kpi-service";
import { createAllocation, cascadeTargets } from "@/lib/kra-kpi/target-service";
import {
  recordAchievement,
  recommendAchievement,
  submitForVerification,
  verifyAchievement,
  withdrawAchievement,
} from "@/lib/kra-kpi/achievement-service";
import {
  getMyAllocations,
  getMyChildUnits,
  getMyDashboardSummary,
  getMyPendingCount,
  getMyReviewQueue,
  getMyUnitMembers,
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

type UserFixture = {
  dean: { id: string };
  cseHead: { id: string };
  eceHead: { id: string };
  facultyCse: { id: string };
  facultyEce: { id: string };
  outsider: { id: string };
};

type R11aFixture = {
  context: ActorContext;
  structure: StructureFixture;
  users: UserFixture;
  periodId: string;
  kraId: string;
  kpiIds: Record<string, string>;
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

async function createMainKpis(fixture: {
  context: ActorContext;
  kraId: string;
  structure: StructureFixture;
}) {
  const defs = [
    {
      title: "Publications",
      measurementType: "NUMERIC" as const,
      weightage: 20,
      allocationType: "INDIVIDUAL" as const,
      startingUnitId: fixture.structure.schoolUnitId,
      measurementConfig: { type: "NUMERIC" as const, decimalPlaces: 0 },
      scoringConfig: { method: "LINEAR" as const, capAt100: true },
      unitLabel: "papers",
      defaultTarget: 10,
    },
    {
      title: "Patents",
      measurementType: "BOOLEAN" as const,
      weightage: 15,
      allocationType: "BOTH" as const,
      startingUnitId: fixture.structure.schoolUnitId,
      measurementConfig: { type: "BOOLEAN" as const, trueLabel: "Filed", falseLabel: "Not filed" },
      scoringConfig: { method: "THRESHOLD" as const, thresholdValue: 1, belowScore: 0, aboveScore: 100 },
      unitLabel: null,
      defaultTarget: undefined,
    },
    {
      title: "Grants",
      measurementType: "CURRENCY" as const,
      weightage: 15,
      allocationType: "DEPARTMENT" as const,
      startingUnitId: fixture.structure.schoolUnitId,
      measurementConfig: { type: "CURRENCY" as const, currencyCode: "INR", decimalPlaces: 2 },
      scoringConfig: { method: "LINEAR" as const, capAt100: true },
      unitLabel: "INR",
      defaultTarget: 100000,
    },
    {
      title: "Feedback",
      measurementType: "PERCENTAGE" as const,
      weightage: 10,
      allocationType: "DEPARTMENT" as const,
      startingUnitId: fixture.structure.cseUnitId,
      measurementConfig: { type: "PERCENTAGE" as const, decimalPlaces: 1 },
      scoringConfig: { method: "LINEAR" as const, capAt100: true },
      unitLabel: "%",
      defaultTarget: 90,
    },
    {
      title: "Ratings",
      measurementType: "RATING" as const,
      weightage: 10,
      allocationType: "INDIVIDUAL" as const,
      startingUnitId: fixture.structure.cseUnitId,
      measurementConfig: { type: "RATING" as const, minRating: 1, maxRating: 5 },
      scoringConfig: { method: "LINEAR" as const, capAt100: true },
      unitLabel: null,
      defaultTarget: undefined,
    },
    {
      title: "Milestones",
      measurementType: "MILESTONE" as const,
      weightage: 10,
      allocationType: "INDIVIDUAL" as const,
      startingUnitId: fixture.structure.cseUnitId,
      measurementConfig: { type: "MILESTONE" as const },
      scoringConfig: { method: "THRESHOLD" as const, thresholdValue: 1, belowScore: 0, aboveScore: 100 },
      unitLabel: null,
      defaultTarget: undefined,
    },
    {
      title: "Deadlines",
      measurementType: "DATE_TARGET" as const,
      weightage: 10,
      allocationType: "INDIVIDUAL" as const,
      startingUnitId: fixture.structure.cseUnitId,
      measurementConfig: { type: "DATE_TARGET" as const, allowEarly: true, gracePeriodDays: 0 },
      scoringConfig: { method: "THRESHOLD" as const, thresholdValue: 1, belowScore: 0, aboveScore: 100 },
      unitLabel: null,
      defaultTarget: undefined,
    },
    {
      title: "Grades",
      measurementType: "GRADE" as const,
      weightage: 10,
      allocationType: "INDIVIDUAL" as const,
      startingUnitId: fixture.structure.cseUnitId,
      measurementConfig: { type: "GRADE" as const },
      scoringConfig: { method: "THRESHOLD" as const, thresholdValue: 1, belowScore: 0, aboveScore: 100 },
      unitLabel: null,
      defaultTarget: undefined,
    },
  ];

  for (const def of defs) {
    const result = await createKpi(
      fixture.context.tenantId,
      {
        kraDefinitionId: fixture.kraId,
        title: def.title,
        description: `${def.title} KPI`,
        measurementType: def.measurementType,
        unitLabel: def.unitLabel ?? undefined,
        weightage: def.weightage,
        defaultTarget: def.defaultTarget,
        measurementConfig: def.measurementConfig,
        scoringMethod: def.scoringConfig.method,
        scoringDirection: "ASCENDING",
        scoringConfig: def.scoringConfig,
        allocationType: def.allocationType,
        startingUnitId: def.startingUnitId,
        achievementTemplateKey: "GENERIC",
        achievementFormConfig: {
          templateKey: "GENERIC",
          fields: [
            { key: "description", label: "Description", type: "TEXTAREA", required: true, sortOrder: 0 },
          ],
        },
        sortOrder: 1,
      },
      fixture.context.actorUserId,
      fixture.context.actorRole,
    );
    expect(result.status).toBe("success");
  }
}

async function createR11aFixture(tracker: DbTracker): Promise<R11aFixture> {
  const { tenant, actor, context } = await setupOwner(tracker);
  const structure = await createPublishedHierarchy(context);

  const users = {
    dean: await createTestUser(tracker, { firstName: "Dina", lastName: "Dean" }),
    cseHead: await createTestUser(tracker, { firstName: "Hari", lastName: "Head" }),
    eceHead: await createTestUser(tracker, { firstName: "Esha", lastName: "Head" }),
    facultyCse: await createTestUser(tracker, { firstName: "Cora", lastName: "Faculty" }),
    facultyEce: await createTestUser(tracker, { firstName: "Eli", lastName: "Faculty" }),
    outsider: await createTestUser(tracker, { firstName: "Otto", lastName: "Outsider" }),
  };

  for (const user of Object.values(users)) {
    await createTestMembership({
      tenantId: tenant.id,
      userId: user.id,
      role: "TENANT_USER",
      createdByUserId: actor.id,
    });
  }

  const deanRole = await createRoleDefinition(tenant.id, actor.id, "DEAN", "Dean", true);
  const headRole = await createRoleDefinition(
    tenant.id,
    actor.id,
    "DEPARTMENT_HEAD",
    "Department Head",
    true,
  );
  const facultyRole = await createRoleDefinition(
    tenant.id,
    actor.id,
    "PROFESSOR",
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
    userId: users.facultyCse.id,
    roleDefinitionId: facultyRole.id,
    roleName: facultyRole.displayLabel,
  });
  await assignRole({
    versionId: structure.versionId,
    unitId: structure.eceUnitId,
    userId: users.facultyEce.id,
    roleDefinitionId: facultyRole.id,
    roleName: facultyRole.displayLabel,
  });

  const periodResult = await createPeriod(
    context.tenantId,
    {
      name: "AY 2026-27",
      code: `AY2026_27_${Date.now()}`,
      periodType: "SPECIFIC_RANGE",
      startDate: new Date("2026-04-01T00:00:00.000Z"),
      endDate: new Date("2027-03-31T00:00:00.000Z"),
      reviewFrequency: "ANNUAL",
      targetSettingDeadline: new Date("2026-04-30T00:00:00.000Z"),
      achievementDeadline: new Date("2027-03-10T00:00:00.000Z"),
      reviewDeadline: new Date("2027-03-31T00:00:00.000Z"),
    },
    context.actorUserId,
    context.actorRole,
  );
  expect(periodResult.status).toBe("success");

  const period = await prisma.assessmentPeriod.findFirst({
    where: { tenantId: context.tenantId },
    orderBy: { createdAt: "desc" },
  });
  expect(period).toBeTruthy();

  const createKraResult = await createKra(
    context.tenantId,
    {
      periodId: period!.id,
      title: "R1.1a Matrix",
      description: "Integration KRA",
      weightage: 100,
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
      title: "R1.1a Matrix",
    },
  });
  expect(kra).toBeTruthy();

  await createMainKpis({ context, kraId: kra!.id, structure });

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

  const zeroWeightResult = await createKpi(
    context.tenantId,
    {
      kraDefinitionId: kra!.id,
      title: "Zero Weight",
      description: "Should be hidden",
      measurementType: "NUMERIC",
      unitLabel: "items",
      weightage: 0,
      defaultTarget: 1,
      measurementConfig: { type: "NUMERIC", decimalPlaces: 0 },
      scoringMethod: "LINEAR",
      scoringDirection: "ASCENDING",
      scoringConfig: { method: "LINEAR", capAt100: true },
      allocationType: "INDIVIDUAL",
      startingUnitId: structure.cseUnitId,
      sortOrder: 99,
    },
    context.actorUserId,
    context.actorRole,
  );
  expect(zeroWeightResult.status).toBe("success");

  const draftHiddenResult = await createKpi(
    context.tenantId,
    {
      kraDefinitionId: kra!.id,
      title: "Draft Hidden",
      description: "Should be hidden",
      measurementType: "NUMERIC",
      unitLabel: "items",
      weightage: 0,
      defaultTarget: 1,
      measurementConfig: { type: "NUMERIC", decimalPlaces: 0 },
      scoringMethod: "LINEAR",
      scoringDirection: "ASCENDING",
      scoringConfig: { method: "LINEAR", capAt100: true },
      allocationType: "INDIVIDUAL",
      startingUnitId: structure.cseUnitId,
      sortOrder: 100,
    },
    context.actorUserId,
    context.actorRole,
  );
  expect(draftHiddenResult.status).toBe("success");

  const allKpis = await prisma.kpiDefinition.findMany({
    where: { kraDefinitionId: kra!.id },
    select: { id: true, title: true },
  });
  const kpiIds = Object.fromEntries(allKpis.map((kpi) => [kpi.title, kpi.id]));

  await prisma.kpiDefinition.update({
    where: { id: kpiIds["Zero Weight"] },
    data: { state: "ACTIVE" },
  });

  return {
    context,
    structure,
    users,
    periodId: period!.id,
    kraId: kra!.id,
    kpiIds,
  };
}

async function createTaggedAllocation(
  fixture: R11aFixture,
  kpiTitle: string,
  values: {
    assignedToUnitId?: string;
    assignedToUserId?: string;
    parentAllocationId?: string;
    targetValue?: number;
    targetBoolean?: boolean;
    targetRating?: number;
    targetMilestone?: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
    targetDate?: Date;
    targetGrade?: "OUTSTANDING" | "VERY_GOOD" | "GOOD" | "SATISFACTORY" | "NEEDS_IMPROVEMENT" | "POOR";
    notes: string;
  },
) {
  const result = await createAllocation(
    fixture.context.tenantId,
    {
      periodId: fixture.periodId,
      kpiDefinitionId: fixture.kpiIds[kpiTitle],
      ...values,
    },
    fixture.context.actorUserId,
    fixture.context.actorRole,
  );
  expect(result.status, result.message).toBe("success");

  const allocation = await prisma.targetAllocation.findFirst({
    where: {
      tenantId: fixture.context.tenantId,
      periodId: fixture.periodId,
      kpiDefinitionId: fixture.kpiIds[kpiTitle],
      notes: values.notes,
    },
    orderBy: { createdAt: "desc" },
  });
  expect(allocation).toBeTruthy();
  return allocation!;
}

async function recordAndSubmit(
  fixture: R11aFixture,
  options: {
    allocationId: string;
    reporterUserId: string;
    kpiTitle: string;
    actualValue?: number;
    actualBoolean?: boolean;
    actualRating?: number;
    actualMilestone?: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
    actualDate?: Date;
    actualGrade?: "OUTSTANDING" | "VERY_GOOD" | "GOOD" | "SATISFACTORY" | "NEEDS_IMPROVEMENT" | "POOR";
    reportingDate?: Date;
    evidenceDescription: string;
  },
) {
  const result = await recordAchievement(
    fixture.context.tenantId,
    {
      periodId: fixture.periodId,
      kpiDefinitionId: fixture.kpiIds[options.kpiTitle],
      targetAllocationId: options.allocationId,
      actualValue: options.actualValue,
      actualBoolean: options.actualBoolean,
      actualRating: options.actualRating,
      actualMilestone: options.actualMilestone,
      actualDate: options.actualDate,
      actualGrade: options.actualGrade,
      reportingDate: options.reportingDate,
      evidenceDescription: options.evidenceDescription,
      achievementFormData: { description: options.evidenceDescription },
    },
    options.reporterUserId,
    "TENANT_USER",
  );
  expect(result.status, result.message).toBe("success");
  expect(result.id).toBeTruthy();

  const submitResult = await submitForVerification(
    result.id!,
    fixture.context.tenantId,
    options.reporterUserId,
    "TENANT_USER",
  );
  expect(submitResult.status).toBe("success");

  return result.id!;
}

describe("R1.1a matrix integration", () => {
  test("activating a KRA also activates its KPIs so assignee views can see allocations", async () => {
    await withIsolatedDb(async (tracker) => {
      const fixture = await createR11aFixture(tracker);

      const allocation = await createTaggedAllocation(fixture, "Feedback", {
        assignedToUnitId: fixture.structure.cseUnitId,
        targetValue: 90,
        notes: "visible-feedback",
      });

      const allocations = await getMyAllocations(
        fixture.context.tenantId,
        fixture.users.cseHead.id,
        fixture.periodId,
      );

      expect(
        allocations.find((item) => item.id === allocation.id),
      ).toMatchObject({
        id: allocation.id,
        kpiTitle: "Feedback",
        periodState: "OPEN",
      });
    });
  });

  test("filters out draft and zero-weight KPIs while keeping duplicate parent allocations visible", async () => {
    await withIsolatedDb(async (tracker) => {
      const fixture = await createR11aFixture(tracker);

      const parentOne = await createTaggedAllocation(fixture, "Publications", {
        assignedToUnitId: fixture.structure.cseUnitId,
        targetValue: 4,
        notes: "publications-parent-one",
      });
      const parentTwo = await createTaggedAllocation(fixture, "Publications", {
        assignedToUnitId: fixture.structure.cseUnitId,
        targetValue: 6,
        notes: "publications-parent-two",
      });

      const cascadeOne = await cascadeTargets(
        parentOne.id,
        fixture.context.tenantId,
        { distributions: [{ assignedToUserId: fixture.users.facultyCse.id, targetValue: 4, notes: "child-one" }] },
        fixture.context.actorUserId,
        fixture.context.actorRole,
      );
      const cascadeTwo = await cascadeTargets(
        parentTwo.id,
        fixture.context.tenantId,
        { distributions: [{ assignedToUserId: fixture.users.facultyCse.id, targetValue: 6, notes: "child-two" }] },
        fixture.context.actorUserId,
        fixture.context.actorRole,
      );
      expect(cascadeOne.status).toBe("success");
      expect(cascadeTwo.status).toBe("success");

      const hiddenZero = await createTaggedAllocation(fixture, "Zero Weight", {
        assignedToUserId: fixture.users.facultyCse.id,
        targetValue: 1,
        notes: "hidden-zero",
      });
      const hiddenDraft = await createAllocation(
        fixture.context.tenantId,
        {
          periodId: fixture.periodId,
          kpiDefinitionId: fixture.kpiIds["Draft Hidden"],
          assignedToUserId: fixture.users.facultyCse.id,
          targetValue: 1,
          notes: "hidden-draft",
        },
        fixture.context.actorUserId,
        fixture.context.actorRole,
      );
      expect(hiddenDraft.status).toBe("error");
      expect(hiddenDraft.message).toContain("not ACTIVE");

      const allocations = await getMyAllocations(
        fixture.context.tenantId,
        fixture.users.facultyCse.id,
        fixture.periodId,
      );

      const publicationAllocations = allocations.filter((item) => item.kpiTitle === "Publications");
      expect(publicationAllocations).toHaveLength(2);
      expect(publicationAllocations.map((item) => item.parentTargetValue).sort()).toEqual([4, 6]);
      expect(allocations.some((item) => item.id === hiddenZero.id)).toBe(false);
    });
  });

  test("review queue and pending counts cover same-department shortcut and cross-department recommendation", async () => {
    await withIsolatedDb(async (tracker) => {
      const fixture = await createR11aFixture(tracker);
      const transition = await transitionPeriodState(
        fixture.periodId,
        fixture.context.tenantId,
        "IN_PROGRESS",
        fixture.context.actorUserId,
        fixture.context.actorRole,
      );
      expect(transition.status).toBe("success");

      const sameDept = await createTaggedAllocation(fixture, "Ratings", {
        assignedToUserId: fixture.users.facultyCse.id,
        targetRating: 5,
        notes: "same-dept",
      });
      const crossDept = await createTaggedAllocation(fixture, "Publications", {
        assignedToUserId: fixture.users.facultyCse.id,
        targetValue: 5,
        notes: "cross-dept",
      });

      const sameDeptAchievementId = await recordAndSubmit(fixture, {
        allocationId: sameDept.id,
        reporterUserId: fixture.users.facultyCse.id,
        kpiTitle: "Ratings",
        actualRating: 4,
        evidenceDescription: "same department submission",
      });
      const crossDeptAchievementId = await recordAndSubmit(fixture, {
        allocationId: crossDept.id,
        reporterUserId: fixture.users.facultyCse.id,
        kpiTitle: "Publications",
        actualValue: 5,
        evidenceDescription: "cross department submission",
      });

      const cseQueue = await getMyReviewQueue(
        fixture.context.tenantId,
        fixture.users.cseHead.id,
        fixture.periodId,
      );
      expect(
        cseQueue.find((item) => item.achievementId === sameDeptAchievementId),
      ).toMatchObject({ reviewLevel: "VERIFY", achievementState: "SUBMITTED" });
      expect(
        cseQueue.find((item) => item.achievementId === crossDeptAchievementId),
      ).toBeUndefined();

      expect(
        await getMyPendingCount(
          fixture.context.tenantId,
          fixture.users.cseHead.id,
        ),
      ).toBe(1);

      expect(
        await getMyPendingCount(
          fixture.context.tenantId,
          fixture.users.dean.id,
        ),
      ).toBe(1);

      const deanQueue = await getMyReviewQueue(
        fixture.context.tenantId,
        fixture.users.dean.id,
        fixture.periodId,
      );
      expect(
        deanQueue.find((item) => item.achievementId === crossDeptAchievementId),
      ).toMatchObject({ reviewLevel: "VERIFY", achievementState: "SUBMITTED" });

      const sameVerifyResult = await verifyAchievement(
        sameDeptAchievementId,
        fixture.context.tenantId,
        true,
        "Directly verified",
        fixture.users.cseHead.id,
        "TENANT_USER",
      );
      expect(sameVerifyResult.status).toBe("success");

      const finalVerifyResult = await verifyAchievement(
        crossDeptAchievementId,
        fixture.context.tenantId,
        true,
        "Dean verified",
        fixture.users.dean.id,
        "TENANT_USER",
      );
      expect(finalVerifyResult.status).toBe("success");
    });
  });

  test("withdraw works before recommendation and is blocked after recommendation", async () => {
    await withIsolatedDb(async (tracker) => {
      const fixture = await createR11aFixture(tracker);
      const transition = await transitionPeriodState(
        fixture.periodId,
        fixture.context.tenantId,
        "IN_PROGRESS",
        fixture.context.actorUserId,
        fixture.context.actorRole,
      );
      expect(transition.status).toBe("success");

      const allocation = await createTaggedAllocation(fixture, "Publications", {
        assignedToUserId: fixture.users.facultyCse.id,
        targetValue: 5,
        notes: "withdraw-flow",
      });

      const createResult = await recordAchievement(
        fixture.context.tenantId,
        {
          periodId: fixture.periodId,
          kpiDefinitionId: fixture.kpiIds.Publications,
          targetAllocationId: allocation.id,
          actualValue: 5,
          evidenceDescription: "withdraw flow",
          achievementFormData: { description: "withdraw flow" },
        },
        fixture.users.facultyCse.id,
        "TENANT_USER",
      );
      expect(createResult.status).toBe("success");

      const submitResult = await submitForVerification(
        createResult.id!,
        fixture.context.tenantId,
        fixture.users.facultyCse.id,
        "TENANT_USER",
      );
      expect(submitResult.status).toBe("success");

      const firstWithdraw = await withdrawAchievement(
        createResult.id!,
        fixture.context.tenantId,
        fixture.users.facultyCse.id,
      );
      expect(firstWithdraw.status).toBe("success");

      const resubmit = await submitForVerification(
        createResult.id!,
        fixture.context.tenantId,
        fixture.users.facultyCse.id,
        "TENANT_USER",
      );
      expect(resubmit.status).toBe("success");

      const verifyResult = await verifyAchievement(
        createResult.id!,
        fixture.context.tenantId,
        true,
        "Verified after resubmit",
        fixture.users.dean.id,
        "TENANT_USER",
      );
      expect(verifyResult.status).toBe("success");

      const blockedWithdraw = await withdrawAchievement(
        createResult.id!,
        fixture.context.tenantId,
        fixture.users.facultyCse.id,
      );
      expect(blockedWithdraw.status).toBe("error");
      expect(blockedWithdraw.message).toContain("Can only withdraw");
    });
  });

  test("duplicate prevention is enforced within a review cycle and relaxed for the next cycle", async () => {
    await withIsolatedDb(async (tracker) => {
      const fixture = await createR11aFixture(tracker);

      await prisma.assessmentPeriod.update({
        where: { id: fixture.periodId },
        data: {
          startDate: new Date("2026-01-01T00:00:00.000Z"),
          endDate: new Date("2026-03-31T00:00:00.000Z"),
          reviewFrequency: "MONTHLY",
          state: "IN_PROGRESS",
        },
      });

      const allocation = await createTaggedAllocation(fixture, "Publications", {
        assignedToUserId: fixture.users.facultyCse.id,
        targetValue: 5,
        notes: "monthly-dup",
      });

      const first = await recordAchievement(
        fixture.context.tenantId,
        {
          periodId: fixture.periodId,
          kpiDefinitionId: fixture.kpiIds.Publications,
          targetAllocationId: allocation.id,
          actualValue: 2,
          reportingDate: new Date("2026-01-15T00:00:00.000Z"),
          evidenceDescription: "jan entry",
          achievementFormData: { description: "jan entry" },
        },
        fixture.users.facultyCse.id,
        "TENANT_USER",
      );
      expect(first.status).toBe("success");

      const duplicate = await recordAchievement(
        fixture.context.tenantId,
        {
          periodId: fixture.periodId,
          kpiDefinitionId: fixture.kpiIds.Publications,
          targetAllocationId: allocation.id,
          actualValue: 3,
          reportingDate: new Date("2026-01-20T00:00:00.000Z"),
          evidenceDescription: "jan duplicate",
          achievementFormData: { description: "jan duplicate" },
        },
        fixture.users.facultyCse.id,
        "TENANT_USER",
      );
      expect(duplicate.status).toBe("error");
      expect(duplicate.message).toContain("review cycle");

      const nextCycle = await recordAchievement(
        fixture.context.tenantId,
        {
          periodId: fixture.periodId,
          kpiDefinitionId: fixture.kpiIds.Publications,
          targetAllocationId: allocation.id,
          actualValue: 4,
          reportingDate: new Date("2026-02-10T00:00:00.000Z"),
          evidenceDescription: "feb entry",
          achievementFormData: { description: "feb entry" },
        },
        fixture.users.facultyCse.id,
        "TENANT_USER",
      );
      expect(nextCycle.status).toBe("success");
    });
  });

  test("cascade validation covers child-unit scope, outsider rejection, head rejection, and replicated targets", async () => {
    await withIsolatedDb(async (tracker) => {
      const fixture = await createR11aFixture(tracker);

      const schoolBooleanParent = await createTaggedAllocation(fixture, "Patents", {
        assignedToUnitId: fixture.structure.schoolUnitId,
        targetBoolean: true,
        notes: "school-boolean-parent",
      });

      const validCascade = await cascadeTargets(
        schoolBooleanParent.id,
        fixture.context.tenantId,
        {
          distributions: [
            { assignedToUnitId: fixture.structure.cseUnitId, notes: "to-cse" },
            { assignedToUnitId: fixture.structure.eceUnitId, notes: "to-ece" },
          ],
        },
        fixture.context.actorUserId,
        fixture.context.actorRole,
      );
      expect(validCascade.status).toBe("success");

      const replicatedChildren = await prisma.targetAllocation.findMany({
        where: { parentAllocationId: schoolBooleanParent.id },
        select: { assignedToUnitId: true, targetBoolean: true },
      });
      expect(replicatedChildren).toHaveLength(2);
      expect(replicatedChildren.every((child) => child.targetBoolean === true)).toBe(true);

      const invalidUnitParent = await createTaggedAllocation(fixture, "Patents", {
        assignedToUnitId: fixture.structure.schoolUnitId,
        targetBoolean: true,
        notes: "invalid-unit-parent",
      });
      const invalidUnitCascade = await cascadeTargets(
        invalidUnitParent.id,
        fixture.context.tenantId,
        {
          distributions: [{ assignedToUnitId: fixture.structure.rootUnitId, notes: "to-root" }],
        },
        fixture.context.actorUserId,
        fixture.context.actorRole,
      );
      expect(invalidUnitCascade.status).toBe("error");
      expect(invalidUnitCascade.message).toContain("direct child units");

      const cseNumericParent = await createTaggedAllocation(fixture, "Publications", {
        assignedToUnitId: fixture.structure.cseUnitId,
        targetValue: 10,
        notes: "cse-numeric-parent",
      });

      const outsiderCascade = await cascadeTargets(
        cseNumericParent.id,
        fixture.context.tenantId,
        {
          distributions: [{ assignedToUserId: fixture.users.outsider.id, targetValue: 10, notes: "outsider" }],
        },
        fixture.context.actorUserId,
        fixture.context.actorRole,
      );
      expect(outsiderCascade.status).toBe("error");
      expect(outsiderCascade.message).toContain("belong to the parent unit");

      const headCascade = await cascadeTargets(
        cseNumericParent.id,
        fixture.context.tenantId,
        {
          distributions: [{ assignedToUserId: fixture.users.cseHead.id, targetValue: 10, notes: "head" }],
        },
        fixture.context.actorUserId,
        fixture.context.actorRole,
      );
      expect(headCascade.status).toBe("error");
      expect(headCascade.message).toContain("unit heads");

      const mixedTargetCascade = await cascadeTargets(
        cseNumericParent.id,
        fixture.context.tenantId,
        {
          distributions: [{
            assignedToUserId: fixture.users.facultyCse.id,
            assignedToUnitId: fixture.structure.eceUnitId,
            targetValue: 10,
            notes: "mixed",
          }],
        },
        fixture.context.actorUserId,
        fixture.context.actorRole,
      );
      expect(mixedTargetCascade.status).toBe("error");
      expect(mixedTargetCascade.message).toContain("exactly one user or one child unit");
    });
  });

  test("dashboard and org helper services reflect R1.1a statuses and scope", async () => {
    await withIsolatedDb(async (tracker) => {
      const fixture = await createR11aFixture(tracker);
      await prisma.assessmentPeriod.update({
        where: { id: fixture.periodId },
        data: { state: "IN_PROGRESS" },
      });

      await createTaggedAllocation(fixture, "Publications", {
        assignedToUnitId: fixture.structure.cseUnitId,
        targetValue: 10,
        notes: "dashboard-publications",
      });
      await createTaggedAllocation(fixture, "Patents", {
        assignedToUnitId: fixture.structure.cseUnitId,
        targetBoolean: true,
        notes: "dashboard-patents",
      });
      const grants = await createTaggedAllocation(fixture, "Grants", {
        assignedToUnitId: fixture.structure.cseUnitId,
        targetValue: 100000,
        notes: "dashboard-grants",
      });
      const feedback = await createTaggedAllocation(fixture, "Feedback", {
        assignedToUnitId: fixture.structure.cseUnitId,
        targetValue: 90,
        notes: "dashboard-feedback",
      });
      const rating = await createTaggedAllocation(fixture, "Ratings", {
        assignedToUserId: fixture.users.cseHead.id,
        targetRating: 5,
        notes: "dashboard-rating",
      });
      const milestone = await createTaggedAllocation(fixture, "Milestones", {
        assignedToUserId: fixture.users.cseHead.id,
        targetMilestone: "COMPLETED",
        notes: "dashboard-milestone",
      });
      await createTaggedAllocation(fixture, "Grades", {
        assignedToUserId: fixture.users.cseHead.id,
        targetGrade: "GOOD",
        notes: "dashboard-grade",
      });

      const draftResult = await recordAchievement(
        fixture.context.tenantId,
        {
          periodId: fixture.periodId,
          kpiDefinitionId: fixture.kpiIds.Grants,
          targetAllocationId: grants.id,
          actualValue: 50000,
          evidenceDescription: "draft grant",
          achievementFormData: { description: "draft grant" },
        },
        fixture.users.cseHead.id,
        "TENANT_USER",
      );
      expect(draftResult.status).toBe("success");

      await recordAndSubmit(fixture, {
        allocationId: feedback.id,
        reporterUserId: fixture.users.cseHead.id,
        kpiTitle: "Feedback",
        actualValue: 93,
        evidenceDescription: "pending feedback",
      });

      const rejectedAchievementId = await recordAndSubmit(fixture, {
        allocationId: rating.id,
        reporterUserId: fixture.users.cseHead.id,
        kpiTitle: "Ratings",
        actualRating: 3,
        evidenceDescription: "rejected rating",
      });
      const rejectResult = await verifyAchievement(
        rejectedAchievementId,
        fixture.context.tenantId,
        false,
        "Needs work",
        fixture.users.cseHead.id,
        "TENANT_USER",
      );
      expect(rejectResult.status).toBe("success");

      const verifiedAchievementId = await recordAndSubmit(fixture, {
        allocationId: milestone.id,
        reporterUserId: fixture.users.cseHead.id,
        kpiTitle: "Milestones",
        actualMilestone: "COMPLETED",
        evidenceDescription: "verified milestone",
      });
      const verifyResult = await verifyAchievement(
        verifiedAchievementId,
        fixture.context.tenantId,
        true,
        "Completed",
        fixture.users.cseHead.id,
        "TENANT_USER",
      );
      expect(verifyResult.status).toBe("success");

      const summary = await getMyDashboardSummary(
        fixture.context.tenantId,
        fixture.users.cseHead.id,
        fixture.periodId,
      );
      expect(summary).not.toBeNull();
      expect(summary?.totalAllocations).toBe(7);
      expect(summary?.statusCounts).toMatchObject({
        needsCascade: 2,
        inProgress: 1,
        pendingReview: 1,
        completed: 1,
        notApproved: 1,
        notStarted: 1,
      });

      const members = await getMyUnitMembers(
        fixture.context.tenantId,
        fixture.structure.cseUnitId,
      );
      expect(members.map((member) => member.userId)).toEqual(
        expect.arrayContaining([fixture.users.cseHead.id, fixture.users.facultyCse.id]),
      );

      const childUnits = await getMyChildUnits(
        fixture.context.tenantId,
        fixture.structure.schoolUnitId,
      );
      expect(childUnits.map((unit) => unit.unitCode).sort()).toEqual(["CSE", "ECE"]);
    });
  });

  test("recordAchievement supports all R1.1a measurement types on direct assignee allocations", async () => {
    await withIsolatedDb(async (tracker) => {
      const fixture = await createR11aFixture(tracker);
      await prisma.assessmentPeriod.update({
        where: { id: fixture.periodId },
        data: { state: "IN_PROGRESS" },
      });

      const allocations = {
        Publications: await createTaggedAllocation(fixture, "Publications", {
          assignedToUserId: fixture.users.facultyCse.id,
          targetValue: 5,
          notes: "measure-publications",
        }),
        Patents: await createTaggedAllocation(fixture, "Patents", {
          assignedToUserId: fixture.users.facultyCse.id,
          targetBoolean: true,
          notes: "measure-patents",
        }),
        Grants: await createTaggedAllocation(fixture, "Grants", {
          assignedToUnitId: fixture.structure.cseUnitId,
          targetValue: 250000,
          notes: "measure-grants",
        }),
        Feedback: await createTaggedAllocation(fixture, "Feedback", {
          assignedToUnitId: fixture.structure.cseUnitId,
          targetValue: 90,
          notes: "measure-feedback",
        }),
        Ratings: await createTaggedAllocation(fixture, "Ratings", {
          assignedToUserId: fixture.users.facultyCse.id,
          targetRating: 5,
          notes: "measure-ratings",
        }),
        Milestones: await createTaggedAllocation(fixture, "Milestones", {
          assignedToUserId: fixture.users.facultyCse.id,
          targetMilestone: "COMPLETED",
          notes: "measure-milestones",
        }),
        Deadlines: await createTaggedAllocation(fixture, "Deadlines", {
          assignedToUserId: fixture.users.facultyCse.id,
          targetDate: new Date("2027-02-01T00:00:00.000Z"),
          notes: "measure-deadlines",
        }),
        Grades: await createTaggedAllocation(fixture, "Grades", {
          assignedToUserId: fixture.users.facultyCse.id,
          targetGrade: "VERY_GOOD",
          notes: "measure-grades",
        }),
      };

      const results = await Promise.all([
        recordAchievement(
          fixture.context.tenantId,
          {
            periodId: fixture.periodId,
            kpiDefinitionId: fixture.kpiIds.Publications,
            targetAllocationId: allocations.Publications.id,
            actualValue: 6,
            evidenceDescription: "numeric",
            achievementFormData: { description: "numeric" },
          },
          fixture.users.facultyCse.id,
          "TENANT_USER",
        ),
        recordAchievement(
          fixture.context.tenantId,
          {
            periodId: fixture.periodId,
            kpiDefinitionId: fixture.kpiIds.Patents,
            targetAllocationId: allocations.Patents.id,
            actualBoolean: true,
            evidenceDescription: "boolean",
            achievementFormData: { description: "boolean" },
          },
          fixture.users.facultyCse.id,
          "TENANT_USER",
        ),
        recordAchievement(
          fixture.context.tenantId,
          {
            periodId: fixture.periodId,
            kpiDefinitionId: fixture.kpiIds.Grants,
            targetAllocationId: allocations.Grants.id,
            actualValue: 260000,
            evidenceDescription: "currency",
            achievementFormData: { description: "currency" },
          },
          fixture.users.cseHead.id,
          "TENANT_USER",
        ),
        recordAchievement(
          fixture.context.tenantId,
          {
            periodId: fixture.periodId,
            kpiDefinitionId: fixture.kpiIds.Feedback,
            targetAllocationId: allocations.Feedback.id,
            actualValue: 94,
            evidenceDescription: "percentage",
            achievementFormData: { description: "percentage" },
          },
          fixture.users.cseHead.id,
          "TENANT_USER",
        ),
        recordAchievement(
          fixture.context.tenantId,
          {
            periodId: fixture.periodId,
            kpiDefinitionId: fixture.kpiIds.Ratings,
            targetAllocationId: allocations.Ratings.id,
            actualRating: 4,
            evidenceDescription: "rating",
            achievementFormData: { description: "rating" },
          },
          fixture.users.facultyCse.id,
          "TENANT_USER",
        ),
        recordAchievement(
          fixture.context.tenantId,
          {
            periodId: fixture.periodId,
            kpiDefinitionId: fixture.kpiIds.Milestones,
            targetAllocationId: allocations.Milestones.id,
            actualMilestone: "COMPLETED",
            evidenceDescription: "milestone",
            achievementFormData: { description: "milestone" },
          },
          fixture.users.facultyCse.id,
          "TENANT_USER",
        ),
        recordAchievement(
          fixture.context.tenantId,
          {
            periodId: fixture.periodId,
            kpiDefinitionId: fixture.kpiIds.Deadlines,
            targetAllocationId: allocations.Deadlines.id,
            actualDate: new Date("2027-01-25T00:00:00.000Z"),
            evidenceDescription: "date",
            achievementFormData: { description: "date" },
          },
          fixture.users.facultyCse.id,
          "TENANT_USER",
        ),
        recordAchievement(
          fixture.context.tenantId,
          {
            periodId: fixture.periodId,
            kpiDefinitionId: fixture.kpiIds.Grades,
            targetAllocationId: allocations.Grades.id,
            actualGrade: "GOOD",
            evidenceDescription: "grade",
            achievementFormData: { description: "grade" },
          },
          fixture.users.facultyCse.id,
          "TENANT_USER",
        ),
      ]);

      for (const result of results) {
        expect(result.status).toBe("success");
        expect(result.id).toBeTruthy();
      }

      const achievements = await prisma.achievement.findMany({
        where: {
          id: { in: results.map((result) => result.id!).filter(Boolean) },
        },
        select: {
          evidenceDescription: true,
          actualValue: true,
          actualBoolean: true,
          actualRating: true,
          actualMilestone: true,
          actualDate: true,
          actualGrade: true,
        },
      });

      expect(achievements).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ evidenceDescription: "numeric", actualValue: 6 }),
          expect.objectContaining({ evidenceDescription: "boolean", actualBoolean: true }),
          expect.objectContaining({ evidenceDescription: "currency", actualValue: 260000 }),
          expect.objectContaining({ evidenceDescription: "percentage", actualValue: 94 }),
          expect.objectContaining({ evidenceDescription: "rating", actualRating: 4 }),
          expect.objectContaining({ evidenceDescription: "milestone", actualMilestone: "COMPLETED" }),
          expect.objectContaining({ evidenceDescription: "date", actualDate: new Date("2027-01-25T00:00:00.000Z") }),
          expect.objectContaining({ evidenceDescription: "grade", actualGrade: "GOOD" }),
        ]),
      );
    });
  });
});
