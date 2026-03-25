import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  createOrgUnit,
  createOrgUnitType,
  publishOrgStructure,
  validateOrgStructureDraft,
} from "@/lib/org-structure/service";
import { createPeriod } from "@/lib/kra-kpi/period-service";
import { activateKra, createKra } from "@/lib/kra-kpi/kra-service";
import { createKpi } from "@/lib/kra-kpi/kpi-service";
import { recordAchievement } from "@/lib/kra-kpi/achievement-service";
import { listKpiTemplates, applyTemplateToKpi } from "@/lib/kra-kpi/kpi-template-service";
import { createAllocation } from "@/lib/kra-kpi/target-service";
import { getMyReviewQueue } from "@/lib/kra-kpi/my-kpi-service";
import {
  cleanupTrackedData,
  createTenantActor,
  createTestMembership,
  createTestUser,
  newDbTracker,
  type DbTracker,
} from "./db";

type ActorContext = {
  tenantId: string;
  actorUserId: string;
  actorRole: Role;
};

type OrgStructureFixture = {
  versionId: string;
  rootUnitId: string;
  schoolUnitId: string;
  cseUnitId: string;
  eceUnitId: string;
};

type ScenarioUsers = {
  schoolHead: { id: string };
  cseHead: { id: string };
  eceHead: { id: string };
  extraCseHeads: Array<{ id: string }>;
  extraEceHeads: Array<{ id: string }>;
  facultyCse: { id: string };
  facultyEce: { id: string };
  outsider: { id: string };
};

export type WorkflowCoreFixture = {
  tracker: DbTracker;
  tenant: { id: string; code: string };
  actor: { id: string };
  context: ActorContext;
  structure: OrgStructureFixture;
  users: ScenarioUsers;
  period: { id: string; code: string };
  kra: { id: string; title: string };
  kpis: {
    direct: { id: string; title: string };
    twoStep: { id: string; title: string };
    keyOnly: { id: string; title: string };
    finalOnly: { id: string; title: string };
    department: { id: string; title: string };
    both: { id: string; title: string };
  };
};

export type PublicationRewardFixture = WorkflowCoreFixture & {
  publication: {
    kpi: { id: string; title: string };
    allocation: { id: string; targetValue: number | null };
    roles: {
      leadAuthor: { id: string };
      coAuthor: { id: string };
      corresponding: { id: string };
    };
  };
};

function rand(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

async function createPublishedHierarchy(ctx: ActorContext): Promise<OrgStructureFixture> {
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

  const draft = await prisma.orgStructureVersion.findFirstOrThrow({
    where: { tenantId: ctx.tenantId, state: "DRAFT" },
    include: { unitTypes: true },
  });

  const rootType = draft.unitTypes.find((type) => type.typeKey === "ROOT");
  const schoolType = draft.unitTypes.find((type) => type.typeKey === "SCH");
  const deptType = draft.unitTypes.find((type) => type.typeKey === "DEPT");
  if (!rootType || !schoolType || !deptType) {
    throw new Error("Expected ROOT, SCH, and DEPT unit types in the draft structure.");
  }

  await createOrgUnit({
    ...ctx,
    values: {
      typeId: rootType.id,
      code: "UNIV",
      name: "University",
    },
  });

  const root = await prisma.orgUnit.findFirstOrThrow({
    where: {
      version: { tenantId: ctx.tenantId, state: "DRAFT" },
      code: "UNIV",
    },
  });

  await createOrgUnit({
    ...ctx,
    values: {
      typeId: schoolType.id,
      code: "ENG",
      name: "School of Engineering",
      parentId: root.id,
    },
  });

  const school = await prisma.orgUnit.findFirstOrThrow({
    where: {
      version: { tenantId: ctx.tenantId, state: "DRAFT" },
      code: "ENG",
    },
  });

  for (const [code, name] of [
    ["CSE", "Computer Science"],
    ["ECE", "Electronics"],
  ] as const) {
    await createOrgUnit({
      ...ctx,
      values: {
        typeId: deptType.id,
        code,
        name,
        parentId: school.id,
      },
    });
  }

  const validation = await validateOrgStructureDraft(ctx.tenantId);
  if (validation.errors.length > 0) {
    throw new Error(`Draft org structure validation failed: ${validation.errors.join(", ")}`);
  }

  const publishResult = await publishOrgStructure(ctx);
  if (publishResult.status !== "success") {
    throw new Error(publishResult.message ?? "Failed to publish org structure.");
  }

  const published = await prisma.orgStructureVersion.findFirstOrThrow({
    where: { tenantId: ctx.tenantId, state: "PUBLISHED" },
    include: { units: true },
  });

  return {
    versionId: published.id,
    rootUnitId: published.units.find((unit) => unit.code === "UNIV")!.id,
    schoolUnitId: published.units.find((unit) => unit.code === "ENG")!.id,
    cseUnitId: published.units.find((unit) => unit.code === "CSE")!.id,
    eceUnitId: published.units.find((unit) => unit.code === "ECE")!.id,
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
      maxPerUnit: isUnitHead ? 3 : -1,
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

async function createStandardKpi(input: {
  context: ActorContext;
  kraId: string;
  title: string;
  allocationType: "INDIVIDUAL" | "DEPARTMENT" | "BOTH";
  startingUnitId: string;
  keyUnitId?: string;
  finalUnitId?: string;
  weightage: number;
}) {
  const result = await createKpi(
    input.context.tenantId,
    {
      kraDefinitionId: input.kraId,
      title: input.title,
      description: `${input.title} KPI`,
      measurementType: "NUMERIC",
      unitLabel: "units",
      weightage: input.weightage,
      defaultTarget: 10,
      measurementConfig: { type: "NUMERIC", decimalPlaces: 0 },
      scoringMethod: "LINEAR",
      scoringDirection: "ASCENDING",
      scoringConfig: { method: "LINEAR", capAt100: true },
      allocationType: input.allocationType,
      startingUnitId: input.startingUnitId,
      ...(input.keyUnitId ? { keyUnitId: input.keyUnitId } : {}),
      ...(input.finalUnitId ? { finalUnitId: input.finalUnitId } : {}),
      achievementTemplateKey: "GENERIC",
      achievementFormConfig: {
        templateKey: "GENERIC",
        fields: [
          { key: "description", label: "Description", type: "TEXTAREA", required: true, sortOrder: 0 },
        ],
      },
      sortOrder: input.weightage,
    },
    input.context.actorUserId,
    input.context.actorRole,
  );
  if (result.status !== "success") {
    throw new Error(result.message ?? `Failed to create KPI ${input.title}.`);
  }
  return prisma.kpiDefinition.findFirstOrThrow({
    where: {
      kraDefinitionId: input.kraId,
      title: input.title,
    },
    select: { id: true, title: true },
  });
}

export async function createWorkflowCoreFixture(
  tracker: DbTracker,
  options?: {
    extraCseHeadCount?: number;
    extraEceHeadCount?: number;
    periodStateAfterSetup?: "OPEN" | "IN_PROGRESS" | null;
  },
): Promise<WorkflowCoreFixture> {
  const { tenant, actor } = await createTenantActor(tracker, "TENANT_OWNER");
  const context: ActorContext = {
    tenantId: tenant.id,
    actorUserId: actor.id,
    actorRole: "TENANT_OWNER",
  };
  const structure = await createPublishedHierarchy(context);

  const users: ScenarioUsers = {
    schoolHead: await createTestUser(tracker, { firstName: "Dina", lastName: "Dean" }),
    cseHead: await createTestUser(tracker, { firstName: "Hari", lastName: "Head" }),
    eceHead: await createTestUser(tracker, { firstName: "Esha", lastName: "Head" }),
    extraCseHeads: [],
    extraEceHeads: [],
    facultyCse: await createTestUser(tracker, { firstName: "Cora", lastName: "Faculty" }),
    facultyEce: await createTestUser(tracker, { firstName: "Eli", lastName: "Faculty" }),
    outsider: await createTestUser(tracker, { firstName: "Otto", lastName: "Outsider" }),
  };

  for (let index = 0; index < (options?.extraCseHeadCount ?? 0); index += 1) {
    users.extraCseHeads.push(
      await createTestUser(tracker, { firstName: `CSE${index + 2}`, lastName: "Head" }),
    );
  }
  for (let index = 0; index < (options?.extraEceHeadCount ?? 0); index += 1) {
    users.extraEceHeads.push(
      await createTestUser(tracker, { firstName: `ECE${index + 2}`, lastName: "Head" }),
    );
  }

  for (const user of [
    users.schoolHead,
    users.cseHead,
    users.eceHead,
    ...users.extraCseHeads,
    ...users.extraEceHeads,
    users.facultyCse,
    users.facultyEce,
  ]) {
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
    userId: users.schoolHead.id,
    roleDefinitionId: deanRole.id,
    roleName: deanRole.displayLabel,
  });
  for (const user of [users.cseHead, ...users.extraCseHeads]) {
    await assignRole({
      versionId: structure.versionId,
      unitId: structure.cseUnitId,
      userId: user.id,
      roleDefinitionId: headRole.id,
      roleName: headRole.displayLabel,
    });
  }
  for (const user of [users.eceHead, ...users.extraEceHeads]) {
    await assignRole({
      versionId: structure.versionId,
      unitId: structure.eceUnitId,
      userId: user.id,
      roleDefinitionId: headRole.id,
      roleName: headRole.displayLabel,
    });
  }
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

  const periodCode = rand("PERIOD");
  const periodResult = await createPeriod(
    tenant.id,
    {
      name: "Scenario Period",
      code: periodCode,
      periodType: "SPECIFIC_RANGE",
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      endDate: new Date("2026-12-31T00:00:00.000Z"),
      reviewFrequency: "ANNUAL",
      targetSettingDeadline: new Date("2026-01-31T00:00:00.000Z"),
      achievementDeadline: new Date("2026-11-30T00:00:00.000Z"),
      reviewDeadline: new Date("2026-12-31T00:00:00.000Z"),
    },
    actor.id,
    "TENANT_OWNER",
  );
  if (periodResult.status !== "success") {
    throw new Error(periodResult.message ?? "Failed to create assessment period.");
  }
  const period = await prisma.assessmentPeriod.findUniqueOrThrow({
    where: { tenantId_code: { tenantId: tenant.id, code: periodCode } },
    select: { id: true, code: true },
  });

  const kraTitle = rand("WORKFLOW_CORE");
  const kraResult = await createKra(
    tenant.id,
    {
      periodId: period.id,
      title: kraTitle,
      description: "Workflow core DB scenario KRA",
      weightage: 100,
      sortOrder: 1,
    },
    actor.id,
    "TENANT_OWNER",
  );
  if (kraResult.status !== "success") {
    throw new Error(kraResult.message ?? "Failed to create workflow scenario KRA.");
  }
  const kra = await prisma.kraDefinition.findFirstOrThrow({
    where: {
      tenantId: tenant.id,
      periodId: period.id,
      title: kraTitle,
    },
    select: { id: true, title: true },
  });

  const direct = await createStandardKpi({
    context,
    kraId: kra.id,
    title: rand("DIRECT_KPI"),
    allocationType: "INDIVIDUAL",
    startingUnitId: structure.cseUnitId,
    weightage: 10,
  });
  const twoStep = await createStandardKpi({
    context,
    kraId: kra.id,
    title: rand("TWOSTEP_KPI"),
    allocationType: "INDIVIDUAL",
    startingUnitId: structure.cseUnitId,
    keyUnitId: structure.eceUnitId,
    finalUnitId: structure.cseUnitId,
    weightage: 15,
  });
  const keyOnly = await createStandardKpi({
    context,
    kraId: kra.id,
    title: rand("KEYONLY_KPI"),
    allocationType: "INDIVIDUAL",
    startingUnitId: structure.cseUnitId,
    keyUnitId: structure.eceUnitId,
    weightage: 15,
  });
  const finalOnly = await createStandardKpi({
    context,
    kraId: kra.id,
    title: rand("FINALONLY_KPI"),
    allocationType: "INDIVIDUAL",
    startingUnitId: structure.eceUnitId,
    finalUnitId: structure.cseUnitId,
    weightage: 15,
  });
  const department = await createStandardKpi({
    context,
    kraId: kra.id,
    title: rand("DEPARTMENT_KPI"),
    allocationType: "DEPARTMENT",
    startingUnitId: structure.schoolUnitId,
    weightage: 20,
  });
  const both = await createStandardKpi({
    context,
    kraId: kra.id,
    title: rand("BOTH_KPI"),
    allocationType: "BOTH",
    startingUnitId: structure.schoolUnitId,
    weightage: 25,
  });

  const activateResult = await activateKra(kra.id, tenant.id, actor.id, "TENANT_OWNER");
  if (activateResult.status !== "success") {
    throw new Error(activateResult.message ?? "Failed to activate workflow scenario KRA.");
  }

  const periodStateAfterSetup = options?.periodStateAfterSetup ?? "IN_PROGRESS";
  if (periodStateAfterSetup) {
    await prisma.assessmentPeriod.update({
      where: { id: period.id },
      data: { state: periodStateAfterSetup },
    });
  }

  return {
    tracker,
    tenant: { id: tenant.id, code: tenant.code },
    actor: { id: actor.id },
    context,
    structure,
    users,
    period,
    kra,
    kpis: { direct, twoStep, keyOnly, finalOnly, department, both },
  };
}

export async function createScenarioAllocation(input: {
  fixture: WorkflowCoreFixture;
  kpiId: string;
  assignedToUserId?: string | null;
  assignedToUnitId?: string | null;
  parentAllocationId?: string | null;
  targetValue?: number;
  notes?: string;
}) {
  const notes = input.notes ?? rand("ALLOC");
  const result = await createAllocation(
    input.fixture.tenant.id,
    {
      periodId: input.fixture.period.id,
      kpiDefinitionId: input.kpiId,
      ...(input.assignedToUserId ? { assignedToUserId: input.assignedToUserId } : {}),
      ...(input.assignedToUnitId ? { assignedToUnitId: input.assignedToUnitId } : {}),
      ...(input.parentAllocationId ? { parentAllocationId: input.parentAllocationId } : {}),
      ...(input.targetValue !== undefined ? { targetValue: input.targetValue } : {}),
      notes,
    },
    input.fixture.actor.id,
    "TENANT_OWNER",
  );
  if (result.status !== "success") {
    throw new Error(result.message ?? `Failed to create allocation ${notes}.`);
  }
  return prisma.targetAllocation.findFirstOrThrow({
    where: { tenantId: input.fixture.tenant.id, notes },
  });
}

export async function recordScenarioAchievement(input: {
  fixture: WorkflowCoreFixture;
  kpiId: string;
  targetAllocationId?: string;
  actorUserId: string;
  actorRole?: Role;
  actualValue?: number;
  actualDate?: Date;
  reportingDate?: Date;
  evidenceDescription?: string;
  evidenceLinks?: string[];
  achievementFormData?: Record<string, unknown>;
  contributors?: Array<Record<string, unknown>>;
  isOBO?: boolean;
  oboReportedForUserId?: string;
}) {
  const result = await recordAchievement(
    input.fixture.tenant.id,
    {
      periodId: input.fixture.period.id,
      kpiDefinitionId: input.kpiId,
      ...(input.targetAllocationId ? { targetAllocationId: input.targetAllocationId } : {}),
      actualValue: input.actualValue ?? 1,
      actualDate: input.actualDate,
      reportingDate: input.reportingDate,
      evidenceDescription: input.evidenceDescription ?? rand("EVIDENCE"),
      evidenceLinks: input.evidenceLinks ?? ["https://example.com/proof.pdf"],
      achievementFormData: input.achievementFormData ?? { description: "Scenario achievement" },
      contributors: input.contributors as never,
      ...(input.isOBO ? { isOBO: true } : {}),
      ...(input.oboReportedForUserId ? { oboReportedForUserId: input.oboReportedForUserId } : {}),
    },
    input.actorUserId,
    input.actorRole ?? "TENANT_USER",
  );
  return result;
}

export async function createPublicationRewardFixture(
  tracker: DbTracker,
): Promise<PublicationRewardFixture> {
  const base = await createWorkflowCoreFixture(tracker, { periodStateAfterSetup: "OPEN" });
  const templates = await listKpiTemplates(base.tenant.id);
  const publicationTemplate = templates.find(
    (row) => row.code === "SYSTEM_RESEARCH_PUBLICATION",
  );
  if (!publicationTemplate) {
    throw new Error("SYSTEM_RESEARCH_PUBLICATION template was not available.");
  }

  const applyResult = await applyTemplateToKpi(
    base.tenant.id,
    publicationTemplate.id,
    {
      kraDefinitionId: base.kra.id,
      titleOverride: rand("PUBLICATION_REWARD_KPI"),
      startingUnitId: base.structure.cseUnitId,
    },
    base.actor.id,
    "TENANT_OWNER",
  );
  if (applyResult.status !== "success" || !applyResult.id) {
    throw new Error(applyResult.message ?? "Failed to apply publication reward template.");
  }

  await prisma.kpiDefinition.update({
    where: { id: applyResult.id },
    data: { state: "ACTIVE" },
  });

  const publicationKpi = await prisma.kpiDefinition.findUniqueOrThrow({
    where: { id: applyResult.id },
    select: { id: true, title: true },
  });
  const publicationAllocation = await createScenarioAllocation({
    fixture: base,
    kpiId: publicationKpi.id,
    assignedToUserId: base.users.facultyCse.id,
    targetValue: 3,
    notes: rand("PUBLICATION_ALLOC"),
  });

  await prisma.assessmentPeriod.update({
    where: { id: base.period.id },
    data: { state: "IN_PROGRESS" },
  });

  const roles = await prisma.contributorRole.findMany({
    where: {
      tenantId: base.tenant.id,
      code: { in: ["LEAD_AUTHOR", "CO_AUTHOR", "CORRESPONDING"] },
    },
    select: { id: true, code: true },
  });
  const roleByCode = new Map(roles.map((role) => [role.code, role]));

  return {
    ...base,
    publication: {
      kpi: publicationKpi,
      allocation: {
        id: publicationAllocation.id,
        targetValue: publicationAllocation.targetValue,
      },
      roles: {
        leadAuthor: roleByCode.get("LEAD_AUTHOR")!,
        coAuthor: roleByCode.get("CO_AUTHOR")!,
        corresponding: roleByCode.get("CORRESPONDING")!,
      },
    },
  };
}

export async function loadTrailActions(achievementId: string) {
  const rows = await prisma.submissionTrail.findMany({
    where: { achievementId },
    orderBy: { createdAt: "asc" },
    select: { action: true, note: true, metadata: true },
  });
  return rows;
}

export async function loadQueueItem(input: {
  tenantId: string;
  userId: string;
  periodId: string;
  achievementId: string;
}) {
  const queue = await getMyReviewQueue(input.tenantId, input.userId, input.periodId);
  return queue.find((item) => item.achievementId === input.achievementId) ?? null;
}

export async function loadNotificationsForUser(input: {
  tenantId: string;
  userId: string;
  entityId?: string;
}) {
  return prisma.notification.findMany({
    where: {
      tenantId: input.tenantId,
      userId: input.userId,
      ...(input.entityId ? { entityId: input.entityId } : {}),
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      type: true,
      eventKey: true,
      entityId: true,
      isRead: true,
    },
  });
}

export async function loadActiveRewards(achievementId: string) {
  return prisma.contributorReward.findMany({
    where: {
      achievementId,
      state: { in: ["DRAFT", "PENDING", "RELEASED"] },
    },
    include: {
      benefitType: { select: { code: true, unit: true } },
      rewardTier: { select: { code: true, name: true } },
      rewardComponent: { select: { code: true, name: true } },
      events: {
        orderBy: { createdAt: "asc" },
        select: { action: true, fromState: true, toState: true, note: true },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

export async function moveUserPrimaryUnit(input: {
  versionId: string;
  userId: string;
  toUnitId: string;
}) {
  await prisma.userOrgAssignment.updateMany({
    where: { versionId: input.versionId, userId: input.userId, isPrimary: true },
    data: { isPrimary: false, assignmentType: "SECONDARY" },
  });

  const existing = await prisma.userOrgAssignment.findFirst({
    where: { versionId: input.versionId, userId: input.userId, unitId: input.toUnitId },
  });
  if (existing) {
    await prisma.userOrgAssignment.update({
      where: { id: existing.id },
      data: { isPrimary: true, assignmentType: "PRIMARY" },
    });
    return;
  }

  await prisma.userOrgAssignment.create({
    data: {
      versionId: input.versionId,
      userId: input.userId,
      unitId: input.toUnitId,
      isPrimary: true,
      assignmentType: "PRIMARY",
    },
  });
}

export async function withKraKpiScenarioDb(run: (tracker: DbTracker) => Promise<void>) {
  const tracker = newDbTracker();
  try {
    await run(tracker);
  } finally {
    await cleanupTrackedData(tracker);
  }
}
