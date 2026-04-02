import { MembershipStatus, PersonnelStatus, Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  createBulkNotifications,
  resolveUnitHeadUserIds,
} from "@/lib/notifications/notification-service";
import { getRuntimeVersionId } from "@/lib/org-structure/hierarchy-utils";
import { hasAnyTenantCapability } from "@/lib/tenant-permissions/service";

const OPEN_ACHIEVEMENT_STATES = ["SUBMITTED", "RECOMMENDED"] as const;
const ACTIVE_MEMBERSHIP_STATUSES = [
  MembershipStatus.ACTIVE,
  MembershipStatus.PENDING_ACTIVATION,
  MembershipStatus.INVITED,
  MembershipStatus.LOCKED,
  MembershipStatus.SUSPENDED,
] satisfies MembershipStatus[];
const ACTIVE_PERSONNEL_STATUSES = [
  PersonnelStatus.ONBOARDING,
  PersonnelStatus.ACTIVE,
  PersonnelStatus.ON_LEAVE,
  PersonnelStatus.NOTICE_PERIOD,
] satisfies PersonnelStatus[];

type WorkflowStep = "INITIAL" | "FINAL";

type WorkflowKpiConfig = {
  id: string;
  title?: string | null;
  startingUnitId: string;
  keyUnitId: string | null;
  finalUnitId: string | null;
  keyReviewerUserId: string | null;
  finalReviewerUserId: string | null;
};

export type WorkflowReviewerResolution = {
  unitId: string | null;
  requestedUserId: string | null;
  resolvedUserId: string | null;
  requestedUserName: string | null;
  resolvedUserName: string | null;
  mode: "named" | "fallback" | "unassigned";
  isRequestedUserValid: boolean;
  warning: string | null;
};

export type WorkflowReviewerOption = {
  userId: string;
  name: string;
  email: string;
  employeeId: string | null;
  designation: string | null;
  membershipStatus: MembershipStatus;
  unitIds: string[];
  unitLabels: string[];
};

export type KpiWorkflowResponsibilityView = {
  kpiId: string;
  kpiTitle: string;
  kraTitle: string;
  periodName: string;
  startingUnitId: string;
  startingUnitName: string;
  keyUnitId: string | null;
  keyUnitName: string | null;
  finalUnitId: string | null;
  finalUnitName: string | null;
  keyReviewerUserId: string | null;
  finalReviewerUserId: string | null;
  keyReviewer: WorkflowReviewerResolution | null;
  finalReviewer: WorkflowReviewerResolution | null;
  workflowWarnings: string[];
};

export type OpenWorkflowAssignmentView = {
  achievementId: string;
  achievementTitle: string | null;
  periodName: string;
  kraTitle: string;
  kpiTitle: string;
  reporterUserId: string;
  reporterName: string;
  state: "SUBMITTED" | "RECOMMENDED";
  reviewLevel: "RECOMMEND" | "VERIFY";
  currentVerifierUnitId: string | null;
  currentVerifierUnitName: string | null;
  currentVerifierUserId: string | null;
  currentVerifierUserName: string | null;
  reportingDate: Date;
};

async function canManageWorkflow(
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  return hasAnyTenantCapability({
    tenantId,
    userId: actorUserId,
    baseRole: actorRole,
    capabilities: ["MANAGE_WORKFLOW"],
  });
}

async function canManageWorkflowDefaults(
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  return hasAnyTenantCapability({
    tenantId,
    userId: actorUserId,
    baseRole: actorRole,
    capabilities: ["MANAGE_KPI", "MANAGE_WORKFLOW"],
  });
}

function getWorkflowStepConfig(kpi: WorkflowKpiConfig, step: WorkflowStep) {
  if (step === "INITIAL") {
    if (kpi.keyUnitId && kpi.finalUnitId) {
      return {
        unitId: kpi.keyUnitId,
        reviewerUserId: kpi.keyReviewerUserId,
      };
    }

    if (kpi.finalUnitId) {
      return {
        unitId: kpi.finalUnitId,
        reviewerUserId: kpi.finalReviewerUserId,
      };
    }

    if (kpi.keyUnitId) {
      return {
        unitId: kpi.keyUnitId,
        reviewerUserId: kpi.keyReviewerUserId,
      };
    }

    return {
      unitId: kpi.startingUnitId,
      reviewerUserId: null,
    };
  }

  return {
    unitId: kpi.finalUnitId ?? kpi.keyUnitId ?? kpi.startingUnitId,
    reviewerUserId: kpi.finalUnitId
      ? kpi.finalReviewerUserId
      : kpi.keyUnitId
        ? kpi.keyReviewerUserId
        : null,
  };
}

async function loadUserNameById(userId: string | null | undefined) {
  if (!userId) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true },
  });
  return user ? `${user.firstName} ${user.lastName}`.trim() : null;
}

export async function isUserEligibleForWorkflowUnit(
  tenantId: string,
  userId: string,
  unitId: string,
  tx?: Prisma.TransactionClient,
): Promise<boolean> {
  const db = tx ?? prisma;
  const runtimeVersionId = await getRuntimeVersionId(tenantId);
  if (!runtimeVersionId) return false;

  const [membership, assignment] = await Promise.all([
    db.membership.findFirst({
      where: {
        tenantId,
        userId,
        status: { in: ACTIVE_MEMBERSHIP_STATUSES },
        personnelStatus: { in: ACTIVE_PERSONNEL_STATUSES },
      },
      select: { id: true },
    }),
    db.userOrgAssignment.findFirst({
      where: {
        versionId: runtimeVersionId,
        unitId,
        userId,
      },
      select: { id: true },
    }),
  ]);

  return !!membership && !!assignment;
}

export async function validateWorkflowReviewerSelection(input: {
  tenantId: string;
  keyUnitId: string | null;
  finalUnitId: string | null;
  keyReviewerUserId: string | null;
  finalReviewerUserId: string | null;
  tx?: Prisma.TransactionClient;
}): Promise<string | null> {
  if (input.keyReviewerUserId && !input.keyUnitId) {
    return "Key reviewer requires a key unit.";
  }
  if (input.finalReviewerUserId && !input.finalUnitId) {
    return "Final reviewer requires a final unit.";
  }

  if (
    input.keyReviewerUserId
    && input.keyUnitId
    && !(await isUserEligibleForWorkflowUnit(input.tenantId, input.keyReviewerUserId, input.keyUnitId, input.tx))
  ) {
    return "Selected key reviewer is not an active member of the key unit.";
  }

  if (
    input.finalReviewerUserId
    && input.finalUnitId
    && !(await isUserEligibleForWorkflowUnit(input.tenantId, input.finalReviewerUserId, input.finalUnitId, input.tx))
  ) {
    return "Selected final reviewer is not an active member of the final unit.";
  }

  return null;
}

export async function resolveWorkflowReviewerForUnit(input: {
  tenantId: string;
  unitId: string | null;
  requestedUserId: string | null;
  tx?: Prisma.TransactionClient;
}): Promise<WorkflowReviewerResolution> {
  const requestedUserName = await loadUserNameById(input.requestedUserId);

  if (!input.unitId) {
    return {
      unitId: null,
      requestedUserId: input.requestedUserId,
      resolvedUserId: null,
      requestedUserName,
      resolvedUserName: null,
      mode: "unassigned",
      isRequestedUserValid: false,
      warning: input.requestedUserId ? "Reviewer is configured without a routed unit." : null,
    };
  }

  if (input.requestedUserId) {
    const isValid = await isUserEligibleForWorkflowUnit(
      input.tenantId,
      input.requestedUserId,
      input.unitId,
      input.tx,
    );
    if (isValid) {
      return {
        unitId: input.unitId,
        requestedUserId: input.requestedUserId,
        resolvedUserId: input.requestedUserId,
        requestedUserName,
        resolvedUserName: requestedUserName,
        mode: "named",
        isRequestedUserValid: true,
        warning: null,
      };
    }
  }

  const fallbackUserIds = await resolveUnitHeadUserIds(input.tenantId, input.unitId);
  let fallbackUserId: string | null = null;
  for (const candidateUserId of fallbackUserIds) {
    if (await isUserEligibleForWorkflowUnit(input.tenantId, candidateUserId, input.unitId, input.tx)) {
      fallbackUserId = candidateUserId;
      break;
    }
  }
  const fallbackUserName = await loadUserNameById(fallbackUserId);

  return {
    unitId: input.unitId,
    requestedUserId: input.requestedUserId,
    resolvedUserId: fallbackUserId,
    requestedUserName,
    resolvedUserName: fallbackUserName,
    mode: fallbackUserId ? "fallback" : "unassigned",
    isRequestedUserValid: !input.requestedUserId,
    warning: input.requestedUserId
      ? "Configured reviewer is inactive or no longer belongs to the routed unit. Falling back to the unit head."
      : fallbackUserId
        ? null
        : "No reviewer is configured and the routed unit has no active head.",
  };
}

export async function resolveWorkflowAssigneeForKpiStep(
  tenantId: string,
  kpi: WorkflowKpiConfig,
  step: WorkflowStep,
  tx?: Prisma.TransactionClient,
) {
  const config = getWorkflowStepConfig(kpi, step);
  return resolveWorkflowReviewerForUnit({
    tenantId,
    unitId: config.unitId,
    requestedUserId: config.reviewerUserId,
    tx,
  });
}

export async function listWorkflowReviewerOptions(
  tenantId: string,
): Promise<WorkflowReviewerOption[]> {
  const runtimeVersionId = await getRuntimeVersionId(tenantId);
  if (!runtimeVersionId) return [];

  const [memberships, assignments] = await Promise.all([
    prisma.membership.findMany({
      where: {
        tenantId,
        status: { in: ACTIVE_MEMBERSHIP_STATUSES },
        personnelStatus: { in: ACTIVE_PERSONNEL_STATUSES },
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, officialEmail: true } },
      },
      orderBy: [{ role: "asc" }, { employeeId: "asc" }],
    }),
    prisma.userOrgAssignment.findMany({
      where: { versionId: runtimeVersionId },
      include: { unit: { select: { id: true, name: true, code: true } } },
    }),
  ]);

  const unitLabelsByUserId = new Map<string, { ids: string[]; labels: string[] }>();
  for (const assignment of assignments) {
    const current = unitLabelsByUserId.get(assignment.userId) ?? { ids: [], labels: [] };
    current.ids.push(assignment.unitId);
    current.labels.push(`${assignment.unit.name} (${assignment.unit.code})`);
    unitLabelsByUserId.set(assignment.userId, current);
  }

  return memberships.map((membership) => ({
    userId: membership.userId,
    name: `${membership.user.firstName} ${membership.user.lastName}`.trim(),
    email: membership.user.officialEmail,
    employeeId: membership.employeeId,
    designation: membership.designation,
    membershipStatus: membership.status,
    unitIds: unitLabelsByUserId.get(membership.userId)?.ids ?? [],
    unitLabels: unitLabelsByUserId.get(membership.userId)?.labels ?? [],
  }));
}

export async function listKpiWorkflowResponsibilities(input: {
  tenantId: string;
  actorUserId: string;
  actorRole: Role | null | undefined;
  periodId?: string;
  kraDefinitionId?: string;
}): Promise<KpiWorkflowResponsibilityView[]> {
  const allowed = await canManageWorkflowDefaults(input.tenantId, input.actorUserId, input.actorRole);
  if (!allowed) {
    throw new Error("You do not have permission to manage KPI workflow defaults.");
  }

  const kpis = await prisma.kpiDefinition.findMany({
    where: {
      kraDefinition: {
        tenantId: input.tenantId,
        ...(input.periodId ? { periodId: input.periodId } : {}),
      },
      ...(input.kraDefinitionId ? { kraDefinitionId: input.kraDefinitionId } : {}),
    },
    include: {
      kraDefinition: {
        select: {
          title: true,
          period: { select: { name: true } },
        },
      },
      startingUnit: { select: { id: true, name: true } },
      keyUnit: { select: { id: true, name: true } },
      finalUnit: { select: { id: true, name: true } },
    },
    orderBy: [
      { kraDefinition: { period: { startDate: "desc" } } },
      { kraDefinition: { title: "asc" } },
      { title: "asc" },
    ],
  });

  const rows = await Promise.all(
    kpis.map(async (kpi) => {
      const keyReviewer = kpi.keyUnitId
        ? await resolveWorkflowReviewerForUnit({
            tenantId: input.tenantId,
            unitId: kpi.keyUnitId,
            requestedUserId: kpi.keyReviewerUserId,
          })
        : null;
      const finalReviewer = kpi.finalUnitId
        ? await resolveWorkflowReviewerForUnit({
            tenantId: input.tenantId,
            unitId: kpi.finalUnitId,
            requestedUserId: kpi.finalReviewerUserId,
          })
        : null;

      const workflowWarnings = [keyReviewer?.warning, finalReviewer?.warning].filter(
        (warning): warning is string => !!warning,
      );

      return {
        kpiId: kpi.id,
        kpiTitle: kpi.title,
        kraTitle: kpi.kraDefinition.title,
        periodName: kpi.kraDefinition.period.name,
        startingUnitId: kpi.startingUnitId,
        startingUnitName: kpi.startingUnit.name,
        keyUnitId: kpi.keyUnitId,
        keyUnitName: kpi.keyUnit?.name ?? null,
        finalUnitId: kpi.finalUnitId,
        finalUnitName: kpi.finalUnit?.name ?? null,
        keyReviewerUserId: kpi.keyReviewerUserId,
        finalReviewerUserId: kpi.finalReviewerUserId,
        keyReviewer,
        finalReviewer,
        workflowWarnings,
      } satisfies KpiWorkflowResponsibilityView;
    }),
  );

  return rows;
}

export async function listOpenWorkflowAssignments(input: {
  tenantId: string;
  actorUserId: string;
  actorRole: Role | null | undefined;
  periodId?: string;
}): Promise<OpenWorkflowAssignmentView[]> {
  const allowed = await canManageWorkflow(input.tenantId, input.actorUserId, input.actorRole);
  if (!allowed) {
    throw new Error("You do not have permission to manage live workflow assignments.");
  }

  const achievements = await prisma.achievement.findMany({
    where: {
      tenantId: input.tenantId,
      state: { in: [...OPEN_ACHIEVEMENT_STATES] },
      ...(input.periodId ? { periodId: input.periodId } : {}),
    },
    include: {
      kpiDefinition: {
        select: {
          title: true,
          keyUnitId: true,
          finalUnitId: true,
          kraDefinition: {
            select: {
              title: true,
              period: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      },
    },
    orderBy: [{ reportingDate: "desc" }, { createdAt: "desc" }],
  });

  const userIds = [...new Set([
    ...achievements.map((achievement) => achievement.reportedByUserId),
    ...achievements.map((achievement) => achievement.currentVerifierUserId).filter((value): value is string => !!value),
  ])];
  const unitIds = [...new Set(achievements.map((achievement) => achievement.currentVerifierUnitId).filter((value): value is string => !!value))];

  const [users, units] = await Promise.all([
    userIds.length > 0
      ? prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : Promise.resolve([]),
    unitIds.length > 0
      ? prisma.orgUnit.findMany({
          where: { id: { in: unitIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  const userNameById = new Map(users.map((user) => [user.id, `${user.firstName} ${user.lastName}`.trim()]));
  const unitNameById = new Map(units.map((unit) => [unit.id, unit.name]));

  return achievements.map((achievement) => {
    const state = achievement.state === "RECOMMENDED" ? "RECOMMENDED" : "SUBMITTED";
    return {
      achievementId: achievement.id,
      achievementTitle: achievement.title ?? null,
      periodName: achievement.kpiDefinition.kraDefinition.period.name,
      kraTitle: achievement.kpiDefinition.kraDefinition.title,
      kpiTitle: achievement.kpiDefinition.title,
      reporterUserId: achievement.reportedByUserId,
      reporterName: userNameById.get(achievement.reportedByUserId) ?? "Unknown",
      state,
      reviewLevel:
        state === "SUBMITTED"
        && achievement.kpiDefinition.keyUnitId
        && achievement.kpiDefinition.finalUnitId
          ? "RECOMMEND"
          : "VERIFY",
      currentVerifierUnitId: achievement.currentVerifierUnitId,
      currentVerifierUnitName: achievement.currentVerifierUnitId
        ? unitNameById.get(achievement.currentVerifierUnitId) ?? null
        : null,
      currentVerifierUserId: achievement.currentVerifierUserId,
      currentVerifierUserName: achievement.currentVerifierUserId
        ? userNameById.get(achievement.currentVerifierUserId) ?? null
        : null,
      reportingDate: achievement.reportingDate,
    } satisfies OpenWorkflowAssignmentView;
  });
}

async function appendWorkflowTrailEntry(tx: Prisma.TransactionClient, input: {
  achievementId: string;
  actorUserId: string;
  actorName: string;
  actorRole: string;
  note: string | null;
  metadata?: Prisma.InputJsonValue;
}) {
  await tx.submissionTrail.create({
    data: {
      achievementId: input.achievementId,
      action: "REVIEWER_REASSIGNED",
      actorUserId: input.actorUserId,
      actorName: input.actorName,
      actorRole: input.actorRole,
      actorUnitName: null,
      note: input.note,
      metadata: input.metadata,
    },
  });
}

export async function reassignAchievementWorkflowReviewer(input: {
  achievementId: string;
  tenantId: string;
  actorUserId: string;
  actorRole: Role | null | undefined;
  nextReviewerUserId: string;
  note?: string | null;
}): Promise<{ status: "success" | "error"; message: string }> {
  const allowed = await canManageWorkflow(input.tenantId, input.actorUserId, input.actorRole);
  if (!allowed) {
    return { status: "error", message: "You do not have permission to reassign workflow owners." };
  }

  const achievement = await prisma.achievement.findFirst({
    where: {
      id: input.achievementId,
      tenantId: input.tenantId,
      state: { in: [...OPEN_ACHIEVEMENT_STATES] },
    },
    include: {
      kpiDefinition: { select: { title: true } },
    },
  });
  if (!achievement) {
    return { status: "error", message: "Open achievement not found." };
  }
  if (!achievement.currentVerifierUnitId) {
    return { status: "error", message: "This achievement does not have an active verifier unit." };
  }

  const eligible = await isUserEligibleForWorkflowUnit(
    input.tenantId,
    input.nextReviewerUserId,
    achievement.currentVerifierUnitId,
  );
  if (!eligible) {
    return { status: "error", message: "Selected reviewer must be an active member of the current verifier unit." };
  }

  const [actor, nextReviewer] = await Promise.all([
    prisma.user.findUnique({
      where: { id: input.actorUserId },
      select: { firstName: true, lastName: true },
    }),
    prisma.user.findUnique({
      where: { id: input.nextReviewerUserId },
      select: { firstName: true, lastName: true },
    }),
  ]);

  const actorName = actor ? `${actor.firstName} ${actor.lastName}`.trim() : "Unknown";
  const nextReviewerName = nextReviewer ? `${nextReviewer.firstName} ${nextReviewer.lastName}`.trim() : "Unknown";

  await prisma.$transaction(async (tx) => {
    await tx.achievement.update({
      where: { id: achievement.id },
      data: {
        currentVerifierUserId: input.nextReviewerUserId,
      },
    });

    await appendWorkflowTrailEntry(tx, {
      achievementId: achievement.id,
      actorUserId: input.actorUserId,
      actorName,
      actorRole: "Workflow Manager",
      note: input.note?.trim() || `Reassigned to ${nextReviewerName}`,
      metadata: {
        nextReviewerUserId: input.nextReviewerUserId,
        nextReviewerName,
      },
    });

    await tx.auditLog.create({
      data: {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole ?? Role.TENANT_USER,
        targetType: "Achievement",
        targetId: achievement.id,
        action: "REASSIGN_REVIEWER",
        previousState: {
          currentVerifierUserId: achievement.currentVerifierUserId,
        } as Prisma.InputJsonValue,
        newState: {
          currentVerifierUserId: input.nextReviewerUserId,
        } as Prisma.InputJsonValue,
        reason: input.note?.trim() || null,
      },
    });
  });

  if (input.nextReviewerUserId !== input.actorUserId) {
    try {
      await createBulkNotifications(
        input.tenantId,
        [input.nextReviewerUserId],
        "ACHIEVEMENT_REASSIGNED",
        `achievement:${achievement.id}:reassigned:${input.nextReviewerUserId}`,
        "Achievement review reassigned",
        `${actorName} assigned '${achievement.kpiDefinition.title}' to you for review.`,
        "Achievement",
        achievement.id,
        "/my-kpis",
      );
    } catch (error) {
      console.warn("[workflow-service] reassignAchievementWorkflowReviewer notification failed:", error);
    }
  }

  return { status: "success", message: "Reviewer reassigned." };
}

export async function rebindOpenAchievementsForUserChange(input: {
  tenantId: string;
  affectedUserId: string;
  actorUserId: string;
  actorRole: Role | null | undefined;
  note: string;
}) {
  const achievements = await prisma.achievement.findMany({
    where: {
      tenantId: input.tenantId,
      state: { in: [...OPEN_ACHIEVEMENT_STATES] },
      currentVerifierUserId: input.affectedUserId,
      currentVerifierUnitId: { not: null },
    },
    select: {
      id: true,
      currentVerifierUnitId: true,
      currentVerifierUserId: true,
    },
  });

  if (achievements.length === 0) {
    return { reboundCount: 0 };
  }

  const actor = await prisma.user.findUnique({
    where: { id: input.actorUserId },
    select: { firstName: true, lastName: true },
  });
  const actorName = actor ? `${actor.firstName} ${actor.lastName}`.trim() : "Unknown";

  let reboundCount = 0;
  for (const achievement of achievements) {
    if (!achievement.currentVerifierUnitId) continue;
    const fallback = await resolveWorkflowReviewerForUnit({
      tenantId: input.tenantId,
      unitId: achievement.currentVerifierUnitId,
      requestedUserId: null,
    });
    const fallbackUserId = fallback.resolvedUserId;
    if (fallbackUserId === achievement.currentVerifierUserId) continue;

    await prisma.$transaction(async (tx) => {
      await tx.achievement.update({
        where: { id: achievement.id },
        data: { currentVerifierUserId: fallbackUserId },
      });

      await appendWorkflowTrailEntry(tx, {
        achievementId: achievement.id,
        actorUserId: input.actorUserId,
        actorName,
        actorRole: "Workflow Manager",
        note: input.note,
        metadata: {
          previousReviewerUserId: achievement.currentVerifierUserId,
          reboundReviewerUserId: fallbackUserId,
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: input.tenantId,
          actorUserId: input.actorUserId,
          actorRole: input.actorRole ?? Role.TENANT_USER,
          targetType: "Achievement",
          targetId: achievement.id,
          action: "REBOUND_REVIEWER",
          previousState: {
            currentVerifierUserId: achievement.currentVerifierUserId,
          } as Prisma.InputJsonValue,
          newState: {
            currentVerifierUserId: fallbackUserId,
          } as Prisma.InputJsonValue,
          reason: input.note,
        },
      });
    });

    reboundCount += 1;
  }

  return { reboundCount };
}
