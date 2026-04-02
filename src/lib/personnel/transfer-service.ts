import {
  MembershipStatus,
  OrgAssignmentType,
  OrgRoleScope,
  PersonnelStatus,
  Prisma,
  Role,
} from "@prisma/client";
import { z } from "zod";
import { formatTargetDisplay } from "@/lib/kra-kpi/measurement-display";
import { rebindOpenAchievementsForUserChange } from "@/lib/kra-kpi/workflow-service";
import {
  createBulkNotifications,
  createNotification,
} from "@/lib/notifications/notification-service";
import { deriveReportingLines } from "@/lib/org-structure/roles-service";
import {
  getRuntimeVersionId,
} from "@/lib/org-structure/hierarchy-utils";
import { prisma } from "@/lib/prisma";
import { getPersonnelPolicy } from "@/lib/personnel/policy";
import { hasTenantCapability } from "@/lib/tenant-permissions/service";
import type {
  OnboardingOptions,
  PersonnelActionResult,
  TransferFilters,
  TransferKpiDetail,
  TransferKpiPolicy,
  TransferKpiTargetAction,
  TransferMemberOption,
  TransferSetupOptions,
  TransferableTarget,
  TransferView,
} from "@/lib/personnel/shared";

const MANAGE_ROLES: Role[] = [Role.TENANT_OWNER, Role.TENANT_ADMIN];
const ACTIVE_MEMBERSHIP_STATUSES: MembershipStatus[] = [
  MembershipStatus.ACTIVE,
  MembershipStatus.PENDING_ACTIVATION,
  MembershipStatus.INVITED,
];

const transferDetailSchema = z.object({
  targetAllocationId: z.string().trim().min(1),
  action: z.enum(["CARRY", "LEAVE"]),
});

const initiateTransferSchema = z.object({
  membershipId: z.string().trim().min(1),
  sourceUnitId: z.string().trim().min(1),
  targetUnitId: z.string().trim().min(1),
  effectiveDate: z.coerce.date(),
  reason: z.string().trim().max(1000).optional(),
  newRoleDefinitionIds: z.array(z.string().trim().min(1)).default([]),
  kpiTransferPolicy: z.enum(["CARRY_ALL", "LEAVE_ALL", "SELECTIVE"]).optional(),
  kpiTransferDetails: z.array(transferDetailSchema).default([]),
});

const configureTransferSchema = z.object({
  kpiTransferPolicy: z.enum(["CARRY_ALL", "LEAVE_ALL", "SELECTIVE"]),
  kpiTransferDetails: z.array(transferDetailSchema).default([]),
});

const executeTransferSchema = z.object({
  completionNotes: z.string().trim().max(1000).optional(),
});

const reassignDetachedTargetSchema = z.object({
  transferId: z.string().trim().min(1),
  targetAllocationId: z.string().trim().min(1),
  newUserId: z.string().trim().min(1),
  note: z.string().trim().max(500).optional(),
});

const transferableTargetQuerySchema = z.object({
  membershipId: z.string().trim().min(1),
  sourceUnitId: z.string().trim().min(1).optional(),
  effectiveDate: z.coerce.date().optional(),
});

type DbClient = Prisma.TransactionClient | typeof prisma;

type TransferActionResult = PersonnelActionResult & {
  transferId?: string;
};

const transferViewInclude = {
  membership: {
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          officialEmail: true,
        },
      },
    },
  },
  sourceUnit: {
    select: {
      id: true,
      code: true,
      name: true,
    },
  },
  targetUnit: {
    select: {
      id: true,
      code: true,
      name: true,
    },
  },
  targetActions: {
    include: {
      targetAllocation: {
        select: {
          id: true,
          kpiDefinition: { select: { title: true } },
          period: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  },
  statusEvents: {
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.TransferRecordInclude;

type TransferRecordWithRelations = Prisma.TransferRecordGetPayload<{
  include: typeof transferViewInclude;
}>;

type VersionUnitMapping = {
  versionId: string;
  versionNumber: number;
  sourceUnit: {
    id: string;
    code: string;
    name: string;
  };
  targetUnit: {
    id: string;
    code: string;
    name: string;
  };
};

function canManageTransfers(role: Role): boolean {
  return MANAGE_ROLES.includes(role);
}

async function canManageTransferWorkspace(
  tenantId: string,
  actorUserId: string,
  actorRole: Role,
) {
  if (canManageTransfers(actorRole)) {
    return true;
  }

  return hasTenantCapability({
    tenantId,
    userId: actorUserId,
    baseRole: actorRole,
    capability: "MANAGE_PERSONNEL",
  });
}

function dedupeStrings(values: string[]) {
  return [...new Set(values)];
}

function parseTransferDetails(raw: Prisma.JsonValue | null | undefined): TransferKpiDetail[] {
  if (!raw) return [];
  const parsed = z.array(transferDetailSchema).safeParse(raw);
  return parsed.success ? parsed.data : [];
}

function mapTransferRecord(record: TransferRecordWithRelations): TransferView {
  const details = parseTransferDetails(record.kpiTransferDetails);
  const unitNames = new Map<string, string>([
    [record.sourceUnit.id, record.sourceUnit.name],
    [record.targetUnit.id, record.targetUnit.name],
  ]);

  return {
    id: record.id,
    tenantId: record.tenantId,
    membershipId: record.membershipId,
    userId: record.membership.user.id,
    userName: `${record.membership.user.firstName} ${record.membership.user.lastName}`.trim(),
    userEmail: record.membership.user.officialEmail,
    sourceUnitId: record.sourceUnit.id,
    sourceUnitName: record.sourceUnit.name,
    sourceUnitCode: record.sourceUnit.code,
    targetUnitId: record.targetUnit.id,
    targetUnitName: record.targetUnit.name,
    targetUnitCode: record.targetUnit.code,
    effectiveDate: record.effectiveDate,
    status: record.status,
    reason: record.reason,
    completionNotes: record.completionNotes,
    newRoleDefinitionIds: record.newRoleDefinitionIds,
    kpiTransferPolicy: record.kpiTransferPolicy,
    kpiTransferDetails: details,
    initiatedByUserId: record.initiatedByUserId,
    approvedByUserId: record.approvedByUserId,
    completedAt: record.completedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    targetActions: record.targetActions.map((action) => ({
      id: action.id,
      targetAllocationId: action.targetAllocationId,
      targetTitle: action.targetAllocation.kpiDefinition.title,
      periodName: action.targetAllocation.period.name,
      action: action.action,
      previousUnitId: action.previousUnitId,
      previousUnitName: action.previousUnitId
        ? unitNames.get(action.previousUnitId) ?? null
        : null,
      newUnitId: action.newUnitId,
      newUnitName: action.newUnitId ? unitNames.get(action.newUnitId) ?? null : null,
      notes: action.notes,
      createdAt: action.createdAt,
    })),
    statusEvents: record.statusEvents.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      actorUserId: event.actorUserId,
      note: event.note,
      metadata:
        event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)
          ? (event.metadata as Record<string, unknown>)
          : null,
      createdAt: event.createdAt,
    })),
  };
}

async function getUnitById(tenantId: string, unitId: string) {
  return prisma.orgUnit.findFirst({
    where: { id: unitId, tenantId },
    select: {
      id: true,
      code: true,
      name: true,
      versionId: true,
      state: true,
    },
  });
}

async function getRuntimeUnitByCode(tenantId: string, code: string) {
  const runtimeVersionId = await getRuntimeVersionId(tenantId);
  if (!runtimeVersionId) return null;

  return prisma.orgUnit.findFirst({
    where: {
      tenantId,
      versionId: runtimeVersionId,
      code,
    },
    select: {
      id: true,
      code: true,
      name: true,
      state: true,
      versionId: true,
    },
  });
}

async function getCurrentPrimaryAssignment(
  db: DbClient,
  tenantId: string,
  userId: string,
) {
  const runtimeVersionId = await getRuntimeVersionId(tenantId);
  if (!runtimeVersionId) return null;

  return db.userOrgAssignment.findFirst({
    where: {
      versionId: runtimeVersionId,
      userId,
      isPrimary: true,
    },
    include: {
      unit: {
        select: {
          id: true,
          code: true,
          name: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
}

async function resolveHeadUserIdsByUnitCode(
  tenantId: string,
  unitCode: string,
) {
  const latestReviewableVersion = await prisma.orgStructureVersion.findFirst({
    where: {
      tenantId,
      state: { in: ["PUBLISHED", "VALIDATED"] },
    },
    orderBy: { versionNumber: "desc" },
    select: { id: true },
  });

  const versionId =
    latestReviewableVersion?.id ?? (await getRuntimeVersionId(tenantId));

  if (!versionId) return [];

  const unit = await prisma.orgUnit.findFirst({
    where: {
      tenantId,
      versionId,
      code: unitCode,
    },
    select: { id: true },
  });

  if (!unit) return [];

  const assignments = await prisma.orgRoleAssignment.findMany({
    where: {
      versionId,
      unitId: unit.id,
      isActive: true,
      roleDefinition: { isUnitHead: true },
    },
    select: { userId: true },
  });

  return dedupeStrings(assignments.map((assignment) => assignment.userId));
}

async function isActorSourceUnitHead(
  tenantId: string,
  actorUserId: string,
  sourceUnitCode: string,
) {
  const headIds = await resolveHeadUserIdsByUnitCode(tenantId, sourceUnitCode);
  return headIds.includes(actorUserId);
}

async function getTransferVersions(tenantId: string) {
  const latestPublished = await prisma.orgStructureVersion.findFirst({
    where: {
      tenantId,
      state: "PUBLISHED",
    },
    orderBy: { versionNumber: "desc" },
    select: {
      id: true,
      versionNumber: true,
    },
  });

  if (latestPublished) {
    const newerVersions = await prisma.orgStructureVersion.findMany({
      where: {
        tenantId,
        state: { in: ["DRAFT", "VALIDATED"] },
        versionNumber: { gt: latestPublished.versionNumber },
      },
      orderBy: { versionNumber: "asc" },
      select: {
        id: true,
        versionNumber: true,
      },
    });

    return [latestPublished, ...newerVersions];
  }

  return prisma.orgStructureVersion.findMany({
    where: {
      tenantId,
      state: { in: ["DRAFT", "VALIDATED", "PUBLISHED"] },
    },
    orderBy: { versionNumber: "asc" },
    select: {
      id: true,
      versionNumber: true,
    },
  });
}

async function mapTransferUnitsForVersions(
  tenantId: string,
  sourceCode: string,
  targetCode: string,
) {
  const versions = await getTransferVersions(tenantId);
  if (versions.length === 0) {
    throw new Error("No active organization structure version is available.");
  }

  const units = await prisma.orgUnit.findMany({
    where: {
      tenantId,
      versionId: { in: versions.map((version) => version.id) },
      code: { in: [sourceCode, targetCode] },
    },
    select: {
      id: true,
      code: true,
      name: true,
      versionId: true,
    },
  });

  const byVersion = new Map<string, { sourceUnit?: typeof units[number]; targetUnit?: typeof units[number] }>();
  for (const unit of units) {
    const current = byVersion.get(unit.versionId) ?? {};
    if (unit.code === sourceCode) current.sourceUnit = unit;
    if (unit.code === targetCode) current.targetUnit = unit;
    byVersion.set(unit.versionId, current);
  }

  return versions.map((version) => {
    const mapped = byVersion.get(version.id);
    if (!mapped?.sourceUnit || !mapped.targetUnit) {
      throw new Error(
        `Version ${version.versionNumber} is missing the source or target unit mapping needed for transfer execution.`,
      );
    }

    return {
      versionId: version.id,
      versionNumber: version.versionNumber,
      sourceUnit: mapped.sourceUnit,
      targetUnit: mapped.targetUnit,
    } satisfies VersionUnitMapping;
  });
}

async function appendStatusEvent(
  tx: Prisma.TransactionClient,
  input: {
    transferRecordId: string;
    eventType:
      | "INITIATED"
      | "APPROVED"
      | "REJECTED"
      | "CANCELLED"
      | "EXECUTED"
      | "CONFIGURED";
    actorUserId?: string | null;
    note?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  await tx.transferStatusEvent.create({
    data: {
      transferRecordId: input.transferRecordId,
      eventType: input.eventType,
      actorUserId: input.actorUserId ?? null,
      note: input.note ?? null,
      metadata: (input.metadata ?? null) as Prisma.InputJsonValue,
    },
  });
}

function validateTransferDetails(
  policy: TransferKpiPolicy,
  details: TransferKpiDetail[],
  targets: TransferableTarget[],
) {
  const duplicates = new Set<string>();
  const seen = new Set<string>();
  for (const detail of details) {
    if (seen.has(detail.targetAllocationId)) {
      duplicates.add(detail.targetAllocationId);
    }
    seen.add(detail.targetAllocationId);
  }

  if (duplicates.size > 0) {
    return `Duplicate target decisions were provided for ${duplicates.size} allocation(s).`;
  }

  if (policy !== "SELECTIVE" && details.length > 0) {
    return "Detailed KPI transfer actions are only allowed for SELECTIVE policy.";
  }

  const editableTargets = targets.filter((target) => !target.isLocked);
  const editableIds = new Set(editableTargets.map((target) => target.targetAllocationId));

  if (policy === "SELECTIVE") {
    const unknown = details.filter((detail) => !editableIds.has(detail.targetAllocationId));
    if (unknown.length > 0) {
      return "Selective portability includes unknown or locked targets.";
    }

    const missing = editableTargets.filter(
      (target) => !details.some((detail) => detail.targetAllocationId === target.targetAllocationId),
    );
    if (missing.length > 0) {
      return "Selective portability must specify an action for every editable KPI target.";
    }
  }

  return null;
}

function getTargetDecision(
  target: TransferableTarget,
  policy: TransferKpiPolicy,
  details: TransferKpiDetail[],
): TransferKpiTargetAction {
  if (target.isLocked) return "LEAVE";
  if (policy === "CARRY_ALL") return "CARRY";
  if (policy === "LEAVE_ALL") return "LEAVE";

  const detail = details.find((entry) => entry.targetAllocationId === target.targetAllocationId);
  if (!detail) {
    throw new Error(`Missing selective transfer action for allocation ${target.targetAllocationId}.`);
  }
  return detail.action;
}

async function loadTransferableTargets(
  db: DbClient,
  tenantId: string,
  userId: string,
  effectiveDate: Date,
) {
  const allocations = await db.targetAllocation.findMany({
    where: {
      tenantId,
      assignedToUserId: userId,
      period: { endDate: { gte: effectiveDate } },
    },
    include: {
      period: {
        select: {
          id: true,
          name: true,
          endDate: true,
        },
      },
      kpiDefinition: {
        select: {
          id: true,
          title: true,
          measurementType: true,
          unitLabel: true,
        },
      },
      achievements: {
        select: {
          state: true,
        },
      },
    },
    orderBy: [{ period: { endDate: "asc" } }, { kpiDefinition: { title: "asc" } }],
  });

  return allocations.map((allocation) => {
    const counts = allocation.achievements.reduce(
      (acc, achievement) => {
        acc.achievementCount += 1;
        if (achievement.state === "SUBMITTED") acc.submittedCount += 1;
        if (achievement.state === "RECOMMENDED") acc.recommendedCount += 1;
        if (achievement.state === "VERIFIED") acc.verifiedCount += 1;
        return acc;
      },
      {
        achievementCount: 0,
        submittedCount: 0,
        recommendedCount: 0,
        verifiedCount: 0,
      },
    );

    const isLocked = allocation.state === "LOCKED";

    return {
      targetAllocationId: allocation.id,
      kpiDefinitionId: allocation.kpiDefinition.id,
      kpiTitle: allocation.kpiDefinition.title,
      periodId: allocation.period.id,
      periodName: allocation.period.name,
      state: allocation.state,
      targetDisplay: formatTargetDisplay(
        allocation.kpiDefinition.measurementType,
        {
          targetValue: allocation.targetValue,
          targetDate: allocation.targetDate,
          targetMilestone: allocation.targetMilestone,
          targetGrade: allocation.targetGrade,
          targetBoolean: allocation.targetBoolean,
          targetRating: allocation.targetRating,
        },
        allocation.kpiDefinition.unitLabel,
      ),
      achievementCount: counts.achievementCount,
      submittedCount: counts.submittedCount,
      recommendedCount: counts.recommendedCount,
      verifiedCount: counts.verifiedCount,
      isLocked,
      defaultAction: null,
    } satisfies TransferableTarget;
  });
}

async function ensureTransferMembership(
  tenantId: string,
  membershipId: string,
) {
  return prisma.membership.findFirst({
    where: {
      id: membershipId,
      tenantId,
      status: { notIn: [MembershipStatus.REVOKED, MembershipStatus.ARCHIVED] },
      personnelStatus: { not: PersonnelStatus.SEPARATED },
    },
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          officialEmail: true,
        },
      },
    },
  });
}

async function loadTransferRecord(tenantId: string, transferId: string) {
  return prisma.transferRecord.findFirst({
    where: { id: transferId, tenantId },
    include: transferViewInclude,
  });
}

async function validateRoleDefinitions(
  tenantId: string,
  roleDefinitionIds: string[],
): Promise<
  | {
      roles: {
        id: string;
        displayLabel: string;
        isUnitHead: boolean;
        maxPerUnit: number;
      }[];
    }
  | { error: string }
> {
  if (roleDefinitionIds.length === 0) return { roles: [] };

  const roles = await prisma.orgRoleDefinition.findMany({
    where: {
      tenantId,
      id: { in: roleDefinitionIds },
      isActive: true,
    },
    orderBy: [{ sortOrder: "asc" }, { displayLabel: "asc" }],
  });

  if (roles.length !== roleDefinitionIds.length) {
    return { error: "One or more selected target roles are missing or inactive." };
  }

  const headRoles = roles.filter((role) => role.isUnitHead);
  if (headRoles.length > 1) {
    return { error: "Only one unit-head role can be assigned during a transfer." };
  }

  return { roles };
}

async function moveUserPrimaryAssignment(
  tx: Prisma.TransactionClient,
  input: {
    membershipUserId: string;
    effectiveDate: Date;
    mapping: VersionUnitMapping;
  },
) {
  const assignments = await tx.userOrgAssignment.findMany({
    where: {
      versionId: input.mapping.versionId,
      userId: input.membershipUserId,
    },
    include: {
      unit: {
        select: {
          code: true,
        },
      },
    },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });

  const primaryAssignments = assignments.filter(
    (assignment) => assignment.isPrimary || assignment.assignmentType === OrgAssignmentType.PRIMARY,
  );

  const hasUnexpectedPrimary = primaryAssignments.some(
    (assignment) =>
      assignment.unit.code !== input.mapping.sourceUnit.code &&
      assignment.unit.code !== input.mapping.targetUnit.code,
  );
  if (hasUnexpectedPrimary) {
    throw new Error(
      `Version ${input.mapping.versionNumber} no longer has the member assigned to the expected source or target unit.`,
    );
  }

  const hasSourcePlacement = assignments.some(
    (assignment) => assignment.unit.code === input.mapping.sourceUnit.code,
  );
  const hasTargetPlacement = assignments.some(
    (assignment) => assignment.unit.code === input.mapping.targetUnit.code,
  );
  if (!hasSourcePlacement && !hasTargetPlacement) {
    throw new Error(
      `Version ${input.mapping.versionNumber} is missing both source and target placements for the transferred member.`,
    );
  }

  await tx.userOrgAssignment.updateMany({
    where: {
      versionId: input.mapping.versionId,
      userId: input.membershipUserId,
      isPrimary: true,
    },
    data: {
      assignmentType: OrgAssignmentType.SECONDARY,
      isPrimary: false,
    },
  });

  await tx.userOrgAssignment.deleteMany({
    where: {
      versionId: input.mapping.versionId,
      userId: input.membershipUserId,
      unitId: input.mapping.sourceUnit.id,
    },
  });

  const targetAssignments = await tx.userOrgAssignment.findMany({
    where: {
      versionId: input.mapping.versionId,
      userId: input.membershipUserId,
      unitId: input.mapping.targetUnit.id,
    },
    orderBy: [{ createdAt: "asc" }],
  });

  if (targetAssignments.length > 0) {
    const [keep, ...extra] = targetAssignments;

    await tx.userOrgAssignment.update({
      where: { id: keep.id },
      data: {
        assignmentType: OrgAssignmentType.PRIMARY,
        isPrimary: true,
        effectiveFrom: input.effectiveDate,
        effectiveTo: null,
      },
    });

    if (extra.length > 0) {
      await tx.userOrgAssignment.deleteMany({
        where: { id: { in: extra.map((assignment) => assignment.id) } },
      });
    }
  } else {
    await tx.userOrgAssignment.create({
      data: {
        versionId: input.mapping.versionId,
        unitId: input.mapping.targetUnit.id,
        userId: input.membershipUserId,
        assignmentType: OrgAssignmentType.PRIMARY,
        isPrimary: true,
        effectiveFrom: input.effectiveDate,
      },
    });
  }
}

async function moveUnitRoles(
  tx: Prisma.TransactionClient,
  input: {
    membershipUserId: string;
    effectiveDate: Date;
    mapping: VersionUnitMapping;
    roleDefinitions: {
      id: string;
      displayLabel: string;
      isUnitHead: boolean;
      maxPerUnit: number;
    }[];
  },
) {
  const sourceRoles = await tx.orgRoleAssignment.findMany({
    where: {
      versionId: input.mapping.versionId,
      unitId: input.mapping.sourceUnit.id,
      userId: input.membershipUserId,
      isActive: true,
    },
    select: {
      roleDefinitionId: true,
      scope: true,
    },
  });

  const sourceScopeByRoleId = new Map<string, OrgRoleScope>();
  for (const role of sourceRoles) {
    if (role.roleDefinitionId) {
      sourceScopeByRoleId.set(role.roleDefinitionId, role.scope);
    }
  }

  for (const roleDef of input.roleDefinitions) {
    const existingUserRole = await tx.orgRoleAssignment.findFirst({
      where: {
        versionId: input.mapping.versionId,
        unitId: input.mapping.targetUnit.id,
        userId: input.membershipUserId,
        isActive: true,
        OR: [{ roleDefinitionId: roleDef.id }, { roleName: roleDef.displayLabel }],
      },
      select: { id: true },
    });

    if (roleDef.maxPerUnit > 0 && !existingUserRole) {
      const currentCount = await tx.orgRoleAssignment.count({
        where: {
          versionId: input.mapping.versionId,
          unitId: input.mapping.targetUnit.id,
          roleDefinitionId: roleDef.id,
          isActive: true,
        },
      });
      if (currentCount >= roleDef.maxPerUnit) {
        throw new Error(
          `Unit "${input.mapping.targetUnit.name}" already has the maximum number of "${roleDef.displayLabel}" assignments.`,
        );
      }
    }

    if (roleDef.isUnitHead) {
      const existingHead = await tx.orgRoleAssignment.findFirst({
        where: {
          versionId: input.mapping.versionId,
          unitId: input.mapping.targetUnit.id,
          isActive: true,
          roleDefinition: { isUnitHead: true },
        },
        include: {
          user: {
            select: { firstName: true, lastName: true },
          },
          roleDefinition: {
            select: { displayLabel: true },
          },
        },
      });

      if (
        existingHead &&
        (existingHead.userId !== input.membershipUserId ||
          existingHead.roleDefinitionId !== roleDef.id)
      ) {
        const existingName = `${existingHead.user.firstName} ${existingHead.user.lastName}`;
        throw new Error(
          `Unit "${input.mapping.targetUnit.name}" already has a head assignment: ${existingName} as "${existingHead.roleDefinition?.displayLabel ?? existingHead.roleName}".`,
        );
      }
    }
  }

  await tx.orgRoleAssignment.deleteMany({
    where: {
      versionId: input.mapping.versionId,
      unitId: input.mapping.sourceUnit.id,
      userId: input.membershipUserId,
    },
  });

  for (const roleDef of input.roleDefinitions) {
    const scope = sourceScopeByRoleId.get(roleDef.id) ?? OrgRoleScope.NODE;
    const existing = await tx.orgRoleAssignment.findFirst({
      where: {
        versionId: input.mapping.versionId,
        unitId: input.mapping.targetUnit.id,
        userId: input.membershipUserId,
        OR: [{ roleDefinitionId: roleDef.id }, { roleName: roleDef.displayLabel }],
      },
      select: { id: true },
    });

    if (existing) {
      await tx.orgRoleAssignment.update({
        where: { id: existing.id },
        data: {
          roleDefinitionId: roleDef.id,
          roleName: roleDef.displayLabel,
          scope,
          isActive: true,
          effectiveFrom: input.effectiveDate,
          effectiveTo: null,
        },
      });
    } else {
      await tx.orgRoleAssignment.create({
        data: {
          versionId: input.mapping.versionId,
          unitId: input.mapping.targetUnit.id,
          userId: input.membershipUserId,
          roleDefinitionId: roleDef.id,
          roleName: roleDef.displayLabel,
          scope,
          effectiveFrom: input.effectiveDate,
        },
      });
    }
  }
}

async function sendTransferInitiatedNotifications(
  transfer: TransferRecordWithRelations,
) {
  const employeeUserId = transfer.membership.user.id;
  const [sourceHeadIds, targetHeadIds] = await Promise.all([
    resolveHeadUserIdsByUnitCode(transfer.tenantId, transfer.sourceUnit.code),
    resolveHeadUserIdsByUnitCode(transfer.tenantId, transfer.targetUnit.code),
  ]);

  await Promise.all([
    createNotification(
      transfer.tenantId,
      employeeUserId,
      "TRANSFER_INITIATED",
      `transfer:${transfer.id}:initiated:${employeeUserId}`,
      "Department transfer initiated",
      `Your transfer from ${transfer.sourceUnit.name} to ${transfer.targetUnit.name} has been initiated.`,
      "TransferRecord",
      transfer.id,
      `/tenant-admin/personnel/transfers/${transfer.id}`,
    ),
    createBulkNotifications(
      transfer.tenantId,
      sourceHeadIds.filter((id) => id !== employeeUserId),
      "TRANSFER_INITIATED",
      `transfer:${transfer.id}:source-heads:initiated`,
      "Department transfer initiated",
      `${transfer.membership.user.firstName} ${transfer.membership.user.lastName} has a pending transfer out of ${transfer.sourceUnit.name}.`,
      "TransferRecord",
      transfer.id,
      `/tenant-admin/personnel/transfers/${transfer.id}`,
    ),
    createBulkNotifications(
      transfer.tenantId,
      targetHeadIds.filter((id) => id !== employeeUserId),
      "TRANSFER_INITIATED",
      `transfer:${transfer.id}:target-heads:initiated`,
      "Department transfer initiated",
      `${transfer.membership.user.firstName} ${transfer.membership.user.lastName} has a pending transfer into ${transfer.targetUnit.name}.`,
      "TransferRecord",
      transfer.id,
      `/tenant-admin/personnel/transfers/${transfer.id}`,
    ),
  ]);
}

async function sendTransferDecisionNotification(
  transfer: TransferRecordWithRelations,
  type: "TRANSFER_APPROVED" | "TRANSFER_REJECTED" | "TRANSFER_CANCELLED",
  title: string,
  message: string,
) {
  await createNotification(
    transfer.tenantId,
    transfer.membership.user.id,
    type,
    `transfer:${transfer.id}:${type.toLowerCase()}:${transfer.membership.user.id}`,
    title,
    message,
    "TransferRecord",
    transfer.id,
    `/tenant-admin/personnel/transfers/${transfer.id}`,
  );
}

async function sendTransferExecutedNotifications(
  transfer: TransferRecordWithRelations,
  summary: { carried: number; leftBehind: number; lockedSourceOnly: number },
) {
  const employeeUserId = transfer.membership.user.id;
  const [sourceHeadIds, targetHeadIds] = await Promise.all([
    resolveHeadUserIdsByUnitCode(transfer.tenantId, transfer.sourceUnit.code),
    resolveHeadUserIdsByUnitCode(transfer.tenantId, transfer.targetUnit.code),
  ]);

  await Promise.all([
    createNotification(
      transfer.tenantId,
      employeeUserId,
      "TRANSFER_EXECUTED",
      `transfer:${transfer.id}:executed:${employeeUserId}`,
      "Department transfer executed",
      `Your transfer to ${transfer.targetUnit.name} is complete. ${summary.carried} KPI target(s) carried, ${summary.leftBehind} left behind, ${summary.lockedSourceOnly} locked at source.`,
      "TransferRecord",
      transfer.id,
      `/tenant-admin/personnel/transfers/${transfer.id}`,
    ),
    summary.carried > 0
      ? createBulkNotifications(
          transfer.tenantId,
          targetHeadIds.filter((id) => id !== employeeUserId),
          "TRANSFER_EXECUTED",
          `transfer:${transfer.id}:target-heads:executed`,
          "Transfer executed",
          `${transfer.membership.user.firstName} ${transfer.membership.user.lastName} transferred into ${transfer.targetUnit.name} with ${summary.carried} carried KPI target(s).`,
          "TransferRecord",
          transfer.id,
          `/tenant-admin/personnel/transfers/${transfer.id}`,
        )
      : Promise.resolve(),
    summary.leftBehind + summary.lockedSourceOnly > 0
      ? createBulkNotifications(
          transfer.tenantId,
          sourceHeadIds.filter((id) => id !== employeeUserId),
          "TRANSFER_EXECUTED",
          `transfer:${transfer.id}:source-heads:executed`,
          "Transfer executed",
          `${transfer.membership.user.firstName} ${transfer.membership.user.lastName} left ${summary.leftBehind} active KPI target(s) and ${summary.lockedSourceOnly} locked KPI target(s) with ${transfer.sourceUnit.name}.`,
          "TransferRecord",
          transfer.id,
          `/tenant-admin/personnel/transfers/${transfer.id}`,
        )
      : Promise.resolve(),
  ]);
}

async function sendDetachedTargetReassignedNotification(input: {
  tenantId: string;
  transferId: string;
  targetTitle: string;
  targetPeriodName: string;
  reassignedUserId: string;
}) {
  await createNotification(
    input.tenantId,
    input.reassignedUserId,
    "TRANSFER_TARGET_REASSIGNED",
    `transfer:${input.transferId}:reassigned:${input.reassignedUserId}:${input.targetTitle}`,
    "KPI target reassigned",
    `You have been assigned the detached KPI target "${input.targetTitle}" for ${input.targetPeriodName}.`,
    "TransferRecord",
    input.transferId,
    `/tenant-admin/personnel/transfers/${input.transferId}`,
  );
}

export async function getTransferSetupOptions(
  tenantId: string,
): Promise<TransferSetupOptions> {
  const runtimeVersionId = await getRuntimeVersionId(tenantId);

  const [roles, memberships, units, primaryAssignments] = await Promise.all([
    prisma.orgRoleDefinition.findMany({
      where: { tenantId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { displayLabel: "asc" }],
      select: {
        id: true,
        roleKey: true,
        displayLabel: true,
        isUnitHead: true,
        maxPerUnit: true,
      },
    }),
    prisma.membership.findMany({
      where: {
        tenantId,
        status: { notIn: [MembershipStatus.REVOKED, MembershipStatus.ARCHIVED] },
        personnelStatus: { not: PersonnelStatus.SEPARATED },
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            officialEmail: true,
          },
        },
      },
      orderBy: [{ createdAt: "desc" }],
    }),
    runtimeVersionId
      ? prisma.orgUnit.findMany({
          where: {
            tenantId,
            versionId: runtimeVersionId,
            state: { in: ["DRAFT", "ACTIVE"] },
          },
          include: { type: { select: { displayLabel: true } } },
          orderBy: [{ level: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
        })
      : Promise.resolve([]),
    runtimeVersionId
      ? prisma.userOrgAssignment.findMany({
          where: {
            versionId: runtimeVersionId,
            isPrimary: true,
          },
          include: {
            unit: {
              select: {
                id: true,
                code: true,
                name: true,
              },
            },
          },
        })
      : Promise.resolve([]),
  ]);

  const primaryByUserId = new Map(primaryAssignments.map((assignment) => [assignment.userId, assignment]));

  return {
    units: units.map((unit) => ({
      id: unit.id,
      code: unit.code,
      name: unit.name,
      level: unit.level,
      path: unit.path,
      state: unit.state,
      typeName: unit.type.displayLabel,
    })) satisfies OnboardingOptions["units"],
    roles,
    members: memberships
      .map((membership) => {
        const primary = primaryByUserId.get(membership.userId);
        if (!primary) return null;

        return {
          membershipId: membership.id,
          userId: membership.userId,
          name: `${membership.user.firstName} ${membership.user.lastName}`.trim(),
          email: membership.user.officialEmail,
          employeeId: membership.employeeId,
          designation: membership.designation,
          personnelStatus: String(membership.personnelStatus),
          membershipStatus: String(membership.status),
          sourceUnitId: primary.unit.id,
          sourceUnitCode: primary.unit.code,
          sourceUnitName: primary.unit.name,
        } satisfies TransferMemberOption;
      })
      .filter((member): member is NonNullable<typeof member> => member !== null),
  };
}

export async function getTransferableTargets(input: {
  tenantId: string;
  membershipId: string;
  sourceUnitId?: string;
  effectiveDate?: Date;
}) {
  const parsed = transferableTargetQuerySchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid transfer preview input.",
      targets: [] as TransferableTarget[],
    };
  }

  const membership = await ensureTransferMembership(input.tenantId, parsed.data.membershipId);
  if (!membership) {
    return {
      status: "error",
      message: "Member not found.",
      targets: [] as TransferableTarget[],
    };
  }

  const currentPrimary = await getCurrentPrimaryAssignment(prisma, input.tenantId, membership.userId);
  if (!currentPrimary) {
    return {
      status: "error",
      message: "The selected member has no runtime primary unit assignment.",
      targets: [] as TransferableTarget[],
    };
  }

  if (parsed.data.sourceUnitId) {
    const sourceUnit = await getUnitById(input.tenantId, parsed.data.sourceUnitId);
    if (!sourceUnit || sourceUnit.code !== currentPrimary.unit.code) {
      return {
        status: "error",
        message: "The selected source unit does not match the member's current runtime primary unit.",
        targets: [] as TransferableTarget[],
      };
    }
  }

  const effectiveDate = parsed.data.effectiveDate ?? new Date();
  const targets = await loadTransferableTargets(
    prisma,
    input.tenantId,
    membership.userId,
    effectiveDate,
  );

  return {
    status: "success",
    message: "Transferable targets loaded.",
    targets,
  };
}

export async function initiateTransfer(input: {
  tenantId: string;
  actorUserId: string;
  actorRole: Role;
  values: z.input<typeof initiateTransferSchema>;
}): Promise<TransferActionResult> {
  if (!(await canManageTransferWorkspace(input.tenantId, input.actorUserId, input.actorRole))) {
    return { status: "error", message: "Permission denied." };
  }

  const parsed = initiateTransferSchema.safeParse(input.values);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid transfer request." };
  }

  const values = parsed.data;
  const membership = await ensureTransferMembership(input.tenantId, values.membershipId);
  if (!membership) {
    return { status: "error", message: "Member not found." };
  }

  const [sourceUnitInput, targetUnitInput, currentPrimary, policy] = await Promise.all([
    getUnitById(input.tenantId, values.sourceUnitId),
    getUnitById(input.tenantId, values.targetUnitId),
    getCurrentPrimaryAssignment(prisma, input.tenantId, membership.userId),
    getPersonnelPolicy(input.tenantId),
  ]);

  if (!sourceUnitInput || !targetUnitInput) {
    return { status: "error", message: "Source or target unit not found." };
  }

  if (sourceUnitInput.code === targetUnitInput.code) {
    return { status: "error", message: "Source and target unit must be different." };
  }

  if (!currentPrimary) {
    return { status: "error", message: "Member has no runtime primary unit assignment." };
  }

  if (currentPrimary.unit.code !== sourceUnitInput.code) {
    return {
      status: "error",
      message: "The selected source unit does not match the member's current runtime primary unit.",
    };
  }

  const [runtimeSourceUnit, runtimeTargetUnit] = await Promise.all([
    getRuntimeUnitByCode(input.tenantId, sourceUnitInput.code),
    getRuntimeUnitByCode(input.tenantId, targetUnitInput.code),
  ]);

  if (!runtimeSourceUnit || !runtimeTargetUnit) {
    return {
      status: "error",
      message: "Source or target unit is not available in the runtime organization structure.",
    };
  }

  if (runtimeTargetUnit.state === "INACTIVE" || runtimeTargetUnit.state === "ARCHIVED") {
    return {
      status: "error",
      message: "Target unit is inactive or archived in the runtime organization structure.",
    };
  }

  const openTransfers = await prisma.transferRecord.count({
    where: {
      tenantId: input.tenantId,
      membershipId: membership.id,
      status: { in: ["PROPOSED", "APPROVED", "IN_PROGRESS"] },
    },
  });
  if (openTransfers > 0) {
    return { status: "error", message: "This member already has an open transfer." };
  }

  const uniqueRoleIds = dedupeStrings(values.newRoleDefinitionIds);
  const roleValidation = await validateRoleDefinitions(input.tenantId, uniqueRoleIds);
  if ("error" in roleValidation) {
    return { status: "error", message: roleValidation.error };
  }

  let kpiTransferDetails: TransferKpiDetail[] = [];
  if (values.kpiTransferPolicy) {
    kpiTransferDetails = values.kpiTransferDetails;
    const targets = await loadTransferableTargets(
      prisma,
      input.tenantId,
      membership.userId,
      values.effectiveDate,
    );
    const validationMessage = validateTransferDetails(
      values.kpiTransferPolicy,
      kpiTransferDetails,
      targets,
    );
    if (validationMessage) {
      return { status: "error", message: validationMessage };
    }
  }

  const autoApproved = policy?.requireTransferApproval === false;

  const created = await prisma.$transaction(async (tx) => {
    const transfer = await tx.transferRecord.create({
      data: {
        tenantId: input.tenantId,
        membershipId: membership.id,
        sourceUnitId: runtimeSourceUnit.id,
        targetUnitId: runtimeTargetUnit.id,
        effectiveDate: values.effectiveDate,
        status: autoApproved ? "APPROVED" : "PROPOSED",
        reason: values.reason ?? null,
        newRoleDefinitionIds: uniqueRoleIds,
        initiatedByUserId: input.actorUserId,
        approvedByUserId: autoApproved ? input.actorUserId : null,
        kpiTransferPolicy: values.kpiTransferPolicy ?? null,
        kpiTransferDetails: values.kpiTransferPolicy
          ? (kpiTransferDetails as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
      include: transferViewInclude,
    });

    await appendStatusEvent(tx, {
      transferRecordId: transfer.id,
      eventType: "INITIATED",
      actorUserId: input.actorUserId,
      note: values.reason ?? null,
      metadata: {
        sourceUnitCode: runtimeSourceUnit.code,
        targetUnitCode: runtimeTargetUnit.code,
      },
    });

    if (values.kpiTransferPolicy) {
      await appendStatusEvent(tx, {
        transferRecordId: transfer.id,
        eventType: "CONFIGURED",
        actorUserId: input.actorUserId,
        metadata: {
          kpiTransferPolicy: values.kpiTransferPolicy,
          targetCount: kpiTransferDetails.length,
        },
      });
    }

    if (autoApproved) {
      await appendStatusEvent(tx, {
        transferRecordId: transfer.id,
        eventType: "APPROVED",
        actorUserId: input.actorUserId,
        note: "Auto-approved by personnel policy.",
        metadata: { autoApproved: true },
      });
    }

    await tx.personnelAction.create({
      data: {
        tenantId: input.tenantId,
        membershipId: membership.id,
        actionType: "TRANSFER_INITIATE",
        effectiveDate: values.effectiveDate,
        actorUserId: input.actorUserId,
        reason: values.reason ?? null,
        metadata: {
          sourceUnitCode: runtimeSourceUnit.code,
          targetUnitCode: runtimeTargetUnit.code,
          autoApproved,
          kpiTransferPolicy: values.kpiTransferPolicy ?? null,
        } as Prisma.InputJsonValue,
      },
    });

    return transfer;
  });

  try {
    await sendTransferInitiatedNotifications(created);
  } catch (error) {
    console.warn("[transfer-service] Failed to send initiation notifications:", error);
  }

  return {
    status: "success",
    message: autoApproved ? "Transfer created and auto-approved." : "Transfer created.",
    transferId: created.id,
  };
}

export async function approveTransfer(input: {
  tenantId: string;
  actorUserId: string;
  actorRole: Role;
  transferId: string;
}): Promise<TransferActionResult> {
  if (!(await canManageTransferWorkspace(input.tenantId, input.actorUserId, input.actorRole))) {
    return { status: "error", message: "Permission denied." };
  }

  const transfer = await loadTransferRecord(input.tenantId, input.transferId);
  if (!transfer) {
    return { status: "error", message: "Transfer not found." };
  }

  if (transfer.status !== "PROPOSED") {
    return { status: "error", message: "Only proposed transfers can be approved." };
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.transferRecord.update({
      where: { id: transfer.id },
      data: {
        status: "APPROVED",
        approvedByUserId: input.actorUserId,
      },
    });

    await appendStatusEvent(tx, {
      transferRecordId: transfer.id,
      eventType: "APPROVED",
      actorUserId: input.actorUserId,
    });

    return loadTransferRecord(input.tenantId, transfer.id);
  });

  if (updated) {
    try {
      await sendTransferDecisionNotification(
        updated,
        "TRANSFER_APPROVED",
        "Department transfer approved",
        `Your transfer to ${updated.targetUnit.name} has been approved.`,
      );
    } catch (error) {
      console.warn("[transfer-service] Failed to send approval notification:", error);
    }
  }

  return {
    status: "success",
    message: "Transfer approved.",
    transferId: transfer.id,
  };
}

export async function rejectTransfer(input: {
  tenantId: string;
  actorUserId: string;
  actorRole: Role;
  transferId: string;
  reason?: string;
}): Promise<TransferActionResult> {
  if (!(await canManageTransferWorkspace(input.tenantId, input.actorUserId, input.actorRole))) {
    return { status: "error", message: "Permission denied." };
  }

  const transfer = await loadTransferRecord(input.tenantId, input.transferId);
  if (!transfer) {
    return { status: "error", message: "Transfer not found." };
  }

  if (transfer.status !== "PROPOSED" && transfer.status !== "APPROVED") {
    return { status: "error", message: "Only proposed or approved transfers can be rejected." };
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.transferRecord.update({
      where: { id: transfer.id },
      data: {
        status: "REJECTED",
      },
    });

    await appendStatusEvent(tx, {
      transferRecordId: transfer.id,
      eventType: "REJECTED",
      actorUserId: input.actorUserId,
      note: input.reason ?? null,
    });

    return loadTransferRecord(input.tenantId, transfer.id);
  });

  if (updated) {
    try {
      await sendTransferDecisionNotification(
        updated,
        "TRANSFER_REJECTED",
        "Department transfer rejected",
        input.reason
          ? `Your transfer was rejected. Reason: ${input.reason}`
          : "Your transfer was rejected.",
      );
    } catch (error) {
      console.warn("[transfer-service] Failed to send rejection notification:", error);
    }
  }

  return {
    status: "success",
    message: "Transfer rejected.",
    transferId: transfer.id,
  };
}

export async function cancelTransfer(input: {
  tenantId: string;
  actorUserId: string;
  actorRole: Role;
  transferId: string;
  reason?: string;
}): Promise<TransferActionResult> {
  if (!(await canManageTransferWorkspace(input.tenantId, input.actorUserId, input.actorRole))) {
    return { status: "error", message: "Permission denied." };
  }

  const transfer = await loadTransferRecord(input.tenantId, input.transferId);
  if (!transfer) {
    return { status: "error", message: "Transfer not found." };
  }

  if (transfer.status !== "PROPOSED" && transfer.status !== "APPROVED") {
    return { status: "error", message: "Only proposed or approved transfers can be cancelled." };
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.transferRecord.update({
      where: { id: transfer.id },
      data: {
        status: "CANCELLED",
      },
    });

    await appendStatusEvent(tx, {
      transferRecordId: transfer.id,
      eventType: "CANCELLED",
      actorUserId: input.actorUserId,
      note: input.reason ?? null,
    });

    await tx.personnelAction.create({
      data: {
        tenantId: input.tenantId,
        membershipId: transfer.membershipId,
        actionType: "TRANSFER_CANCEL",
        effectiveDate: new Date(),
        actorUserId: input.actorUserId,
        reason: input.reason ?? null,
        metadata: {
          transferId: transfer.id,
        } as Prisma.InputJsonValue,
      },
    });

    return loadTransferRecord(input.tenantId, transfer.id);
  });

  if (updated) {
    try {
      await sendTransferDecisionNotification(
        updated,
        "TRANSFER_CANCELLED",
        "Department transfer cancelled",
        input.reason
          ? `Your transfer was cancelled. Reason: ${input.reason}`
          : "Your transfer was cancelled.",
      );
    } catch (error) {
      console.warn("[transfer-service] Failed to send cancellation notification:", error);
    }
  }

  return {
    status: "success",
    message: "Transfer cancelled.",
    transferId: transfer.id,
  };
}

export async function configureTransferPortability(input: {
  tenantId: string;
  actorUserId: string;
  actorRole: Role;
  transferId: string;
  values: z.input<typeof configureTransferSchema>;
}): Promise<TransferActionResult> {
  if (!(await canManageTransferWorkspace(input.tenantId, input.actorUserId, input.actorRole))) {
    return { status: "error", message: "Permission denied." };
  }

  const parsed = configureTransferSchema.safeParse(input.values);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid portability settings." };
  }

  const transfer = await loadTransferRecord(input.tenantId, input.transferId);
  if (!transfer) {
    return { status: "error", message: "Transfer not found." };
  }

  if (transfer.status !== "PROPOSED" && transfer.status !== "APPROVED") {
    return { status: "error", message: "Transfer portability can only be configured before execution." };
  }

  const targets = await loadTransferableTargets(
    prisma,
    input.tenantId,
    transfer.membership.user.id,
    transfer.effectiveDate,
  );
  const validationMessage = validateTransferDetails(
    parsed.data.kpiTransferPolicy,
    parsed.data.kpiTransferDetails,
    targets,
  );
  if (validationMessage) {
    return { status: "error", message: validationMessage };
  }

  await prisma.$transaction(async (tx) => {
    await tx.transferRecord.update({
      where: { id: transfer.id },
      data: {
        kpiTransferPolicy: parsed.data.kpiTransferPolicy,
        kpiTransferDetails: parsed.data.kpiTransferDetails as Prisma.InputJsonValue,
      },
    });

    await appendStatusEvent(tx, {
      transferRecordId: transfer.id,
      eventType: "CONFIGURED",
      actorUserId: input.actorUserId,
      metadata: {
        kpiTransferPolicy: parsed.data.kpiTransferPolicy,
        targetCount: parsed.data.kpiTransferDetails.length,
      },
    });
  });

  return {
    status: "success",
    message: "Transfer portability updated.",
    transferId: transfer.id,
  };
}

export async function executeTransfer(input: {
  tenantId: string;
  actorUserId: string;
  actorRole: Role;
  transferId: string;
  values?: z.input<typeof executeTransferSchema>;
}): Promise<TransferActionResult> {
  if (!(await canManageTransferWorkspace(input.tenantId, input.actorUserId, input.actorRole))) {
    return { status: "error", message: "Permission denied." };
  }

  const parsed = executeTransferSchema.safeParse(input.values ?? {});
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid execution input." };
  }

  const transfer = await loadTransferRecord(input.tenantId, input.transferId);
  if (!transfer) {
    return { status: "error", message: "Transfer not found." };
  }

  if (transfer.status !== "APPROVED") {
    return { status: "error", message: "Only approved transfers can be executed." };
  }

  if (!transfer.kpiTransferPolicy) {
    return { status: "error", message: "Configure KPI portability before executing the transfer." };
  }

  const currentPrimary = await getCurrentPrimaryAssignment(
    prisma,
    input.tenantId,
    transfer.membership.user.id,
  );
  if (!currentPrimary || currentPrimary.unit.code !== transfer.sourceUnit.code) {
    return {
      status: "error",
      message: "The member's current runtime primary unit no longer matches the transfer source.",
    };
  }

  const roleValidation = await validateRoleDefinitions(
    input.tenantId,
    transfer.newRoleDefinitionIds,
  );
  if ("error" in roleValidation) {
    return { status: "error", message: roleValidation.error };
  }

  let versionMappings: VersionUnitMapping[];
  try {
    versionMappings = await mapTransferUnitsForVersions(
      input.tenantId,
      transfer.sourceUnit.code,
      transfer.targetUnit.code,
    );
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Failed to map transfer units across org versions.",
    };
  }

  const detailEntries = parseTransferDetails(transfer.kpiTransferDetails);

  let summary:
    | {
        carried: number;
        leftBehind: number;
        lockedSourceOnly: number;
      }
    | null = null;

  try {
    summary = await prisma.$transaction(async (tx) => {
      const lock = await tx.transferRecord.updateMany({
        where: {
          id: transfer.id,
          tenantId: input.tenantId,
          status: "APPROVED",
        },
        data: { status: "IN_PROGRESS" },
      });

      if (lock.count !== 1) {
        throw new Error("This transfer was already updated by another process.");
      }

      const runtimePrimary = await getCurrentPrimaryAssignment(
        tx,
        input.tenantId,
        transfer.membership.user.id,
      );
      if (!runtimePrimary || runtimePrimary.unit.code !== transfer.sourceUnit.code) {
        throw new Error("The member's runtime primary unit changed before execution.");
      }

      const targets = await loadTransferableTargets(
        tx,
        input.tenantId,
        transfer.membership.user.id,
        transfer.effectiveDate,
      );
      const validationMessage = validateTransferDetails(
        transfer.kpiTransferPolicy!,
        detailEntries,
        targets,
      );
      if (validationMessage) {
        throw new Error(validationMessage);
      }

      for (const mapping of versionMappings) {
        await moveUserPrimaryAssignment(tx, {
          membershipUserId: transfer.membership.user.id,
          effectiveDate: transfer.effectiveDate,
          mapping,
        });

        await moveUnitRoles(tx, {
          membershipUserId: transfer.membership.user.id,
          effectiveDate: transfer.effectiveDate,
          mapping,
          roleDefinitions: roleValidation.roles.map((role) => ({
            id: role.id,
            displayLabel: role.displayLabel,
            isUnitHead: role.isUnitHead,
            maxPerUnit: role.maxPerUnit,
          })),
        });
      }

      const allocations = await tx.targetAllocation.findMany({
        where: {
          tenantId: input.tenantId,
          assignedToUserId: transfer.membership.user.id,
          period: { endDate: { gte: transfer.effectiveDate } },
        },
        select: {
          id: true,
          state: true,
        },
      });

      const targetMap = new Map(targets.map((target) => [target.targetAllocationId, target]));
      const counts = {
        carried: 0,
        leftBehind: 0,
        lockedSourceOnly: 0,
      };

      for (const allocation of allocations) {
        const target = targetMap.get(allocation.id);
        if (!target) continue;

        if (allocation.state === "LOCKED") {
          await tx.targetAllocation.update({
            where: { id: allocation.id },
            data: {
              assignedToUserId: null,
              assignedToUnitId: transfer.sourceUnitId,
            },
          });

          await tx.transferTargetAction.create({
            data: {
              transferRecordId: transfer.id,
              targetAllocationId: allocation.id,
              action: "LOCKED_SOURCE_ONLY",
              previousUnitId: transfer.sourceUnitId,
              newUnitId: transfer.sourceUnitId,
              notes: "Locked target remained with the source unit.",
            },
          });

          counts.lockedSourceOnly += 1;
          continue;
        }

        const decision = getTargetDecision(target, transfer.kpiTransferPolicy!, detailEntries);
        if (decision === "LEAVE") {
          await tx.targetAllocation.update({
            where: { id: allocation.id },
            data: {
              assignedToUserId: null,
              assignedToUnitId: transfer.sourceUnitId,
            },
          });

          await tx.transferTargetAction.create({
            data: {
              transferRecordId: transfer.id,
              targetAllocationId: allocation.id,
              action: "LEFT_BEHIND",
              previousUnitId: transfer.sourceUnitId,
              newUnitId: transfer.sourceUnitId,
              notes: "Target converted to source-unit ownership during transfer.",
            },
          });
          counts.leftBehind += 1;
          continue;
        }

        await tx.transferTargetAction.create({
          data: {
            transferRecordId: transfer.id,
            targetAllocationId: allocation.id,
            action: "CARRIED",
            previousUnitId: transfer.sourceUnitId,
            newUnitId: transfer.targetUnitId,
            notes: "Target stayed user-owned and moved with the member's primary unit.",
          },
        });
        counts.carried += 1;
      }

      await tx.membership.update({
        where: { id: transfer.membershipId },
        data: {
          department: transfer.targetUnit.name,
        },
      });

      await tx.transferRecord.update({
        where: { id: transfer.id },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          completionNotes: parsed.data.completionNotes ?? null,
        },
      });

      await appendStatusEvent(tx, {
        transferRecordId: transfer.id,
        eventType: "EXECUTED",
        actorUserId: input.actorUserId,
        note: parsed.data.completionNotes ?? null,
        metadata: counts,
      });

      await tx.personnelAction.create({
        data: {
          tenantId: input.tenantId,
          membershipId: transfer.membershipId,
          actionType: "TRANSFER_COMPLETE",
          effectiveDate: transfer.effectiveDate,
          actorUserId: input.actorUserId,
          metadata: {
            transferId: transfer.id,
            ...counts,
          } as Prisma.InputJsonValue,
        },
      });

      return counts;
    });
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Transfer execution failed.",
    };
  }

  try {
    for (const mapping of versionMappings) {
      await deriveReportingLines({
        tenantId: input.tenantId,
        versionId: mapping.versionId,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
      });
    }
  } catch (error) {
    console.warn("[transfer-service] Failed to derive reporting lines after transfer:", error);
  }

  try {
    const updatedTransfer = await loadTransferRecord(input.tenantId, transfer.id);
    if (updatedTransfer && summary) {
      await sendTransferExecutedNotifications(updatedTransfer, summary);
    }
  } catch (error) {
    console.warn("[transfer-service] Failed to send execution notifications:", error);
  }

  try {
    await rebindOpenAchievementsForUserChange({
      tenantId: input.tenantId,
      affectedUserId: transfer.membership.user.id,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      note: `Reviewer auto-rebound because the reviewer was transferred to ${transfer.targetUnit.name}.`,
    });
  } catch (error) {
    console.warn("[transfer-service] Failed to rebind workflow reviewers after transfer:", error);
  }

  return {
    status: "success",
    message: "Transfer executed.",
    transferId: transfer.id,
  };
}

export async function listTransfers(
  tenantId: string,
  filters: TransferFilters = {},
): Promise<TransferView[]> {
  const transfers = await prisma.transferRecord.findMany({
    where: {
      tenantId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.sourceUnitId ? { sourceUnitId: filters.sourceUnitId } : {}),
      ...(filters.targetUnitId ? { targetUnitId: filters.targetUnitId } : {}),
      ...(filters.membershipId ? { membershipId: filters.membershipId } : {}),
    },
    include: transferViewInclude,
    orderBy: [{ createdAt: "desc" }],
  });

  return transfers.map(mapTransferRecord);
}

export async function getTransferWithDetails(
  tenantId: string,
  transferId: string,
): Promise<TransferView | null> {
  const transfer = await loadTransferRecord(tenantId, transferId);
  return transfer ? mapTransferRecord(transfer) : null;
}

export async function reassignDetachedTarget(input: {
  tenantId: string;
  actorUserId: string;
  actorRole: Role;
  values: z.input<typeof reassignDetachedTargetSchema>;
}): Promise<TransferActionResult> {
  const parsed = reassignDetachedTargetSchema.safeParse(input.values);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid reassignment request." };
  }

  const transfer = await loadTransferRecord(input.tenantId, parsed.data.transferId);
  if (!transfer) {
    return { status: "error", message: "Transfer not found." };
  }

  const canManage =
    canManageTransfers(input.actorRole) ||
    (await isActorSourceUnitHead(input.tenantId, input.actorUserId, transfer.sourceUnit.code));
  if (!canManage) {
    return { status: "error", message: "Permission denied." };
  }

  if (transfer.status !== "COMPLETED") {
    return { status: "error", message: "Detached targets can only be reassigned after transfer completion." };
  }

  const allocation = await prisma.targetAllocation.findFirst({
    where: {
      id: parsed.data.targetAllocationId,
      tenantId: input.tenantId,
    },
    include: {
      period: { select: { name: true } },
      kpiDefinition: { select: { title: true } },
    },
  });

  if (
    !allocation ||
    allocation.assignedToUserId ||
    !allocation.assignedToUnitId ||
    allocation.assignedToUnitId !== transfer.sourceUnitId
  ) {
    return { status: "error", message: "The selected KPI target is not currently detached at a source unit." };
  }

  const eligibleAction = await prisma.transferTargetAction.findFirst({
    where: {
      transferRecordId: transfer.id,
      targetAllocationId: allocation.id,
      action: { in: ["LEFT_BEHIND", "LOCKED_SOURCE_ONLY"] },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!eligibleAction) {
    return { status: "error", message: "The selected KPI target was not left behind by this transfer." };
  }

  const alreadyReassigned = await prisma.transferTargetAction.findFirst({
    where: {
      transferRecordId: transfer.id,
      targetAllocationId: allocation.id,
      action: "REASSIGNED_AFTER_TRANSFER",
    },
    orderBy: { createdAt: "desc" },
  });

  if (alreadyReassigned) {
    return { status: "error", message: "This detached KPI target has already been reassigned." };
  }

  const targetMembership = await prisma.membership.findFirst({
    where: {
      tenantId: input.tenantId,
      userId: parsed.data.newUserId,
      status: { in: ACTIVE_MEMBERSHIP_STATUSES },
      personnelStatus: { not: PersonnelStatus.SEPARATED },
    },
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  });

  if (!targetMembership) {
    return { status: "error", message: "The reassigned user is not an active member of this tenant." };
  }

  const currentPrimary = await getCurrentPrimaryAssignment(
    prisma,
    input.tenantId,
    parsed.data.newUserId,
  );
  if (!currentPrimary || currentPrimary.unit.code !== transfer.sourceUnit.code) {
    return {
      status: "error",
      message: "Detached KPI targets can only be reassigned to a user whose runtime primary unit is the source unit.",
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.targetAllocation.update({
      where: { id: allocation.id },
      data: {
        assignedToUserId: parsed.data.newUserId,
        assignedToUnitId: null,
      },
    });

    await tx.transferTargetAction.create({
      data: {
        transferRecordId: transfer.id,
        targetAllocationId: allocation.id,
        action: "REASSIGNED_AFTER_TRANSFER",
        previousUnitId: transfer.sourceUnitId,
        newUnitId: transfer.sourceUnitId,
        notes:
          parsed.data.note ??
          `Reassigned to ${targetMembership.user.firstName} ${targetMembership.user.lastName}.`,
      },
    });

    await appendStatusEvent(tx, {
      transferRecordId: transfer.id,
      eventType: "CONFIGURED",
      actorUserId: input.actorUserId,
      note: `Detached target reassigned to ${targetMembership.user.firstName} ${targetMembership.user.lastName}.`,
      metadata: {
        targetAllocationId: allocation.id,
        reassignedUserId: parsed.data.newUserId,
      },
    });
  });

  try {
    await sendDetachedTargetReassignedNotification({
      tenantId: input.tenantId,
      transferId: transfer.id,
      targetTitle: allocation.kpiDefinition.title,
      targetPeriodName: allocation.period.name,
      reassignedUserId: parsed.data.newUserId,
    });
  } catch (error) {
    console.warn("[transfer-service] Failed to send detached target reassignment notification:", error);
  }

  return {
    status: "success",
    message: "Detached KPI target reassigned.",
    transferId: transfer.id,
  };
}
