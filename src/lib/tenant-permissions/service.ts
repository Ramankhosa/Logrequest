import {
  MembershipStatus,
  PersonnelStatus,
  Prisma,
  Role,
  TenantPermissionRole,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type TenantCapability =
  | "MANAGE_KRA"
  | "MANAGE_KPI"
  | "MANAGE_TARGETS"
  | "MANAGE_WORKFLOW"
  | "MANAGE_REWARDS"
  | "MANAGE_ACCESS"
  | "MANAGE_PERSONNEL";

export type TenantPermissionRoleDefinition = {
  code: TenantPermissionRole;
  label: string;
  description: string;
  capabilities: TenantCapability[];
};

export type TenantPermissionAccessContext = {
  baseRole: Role | null | undefined;
  permissionRoles: TenantPermissionRole[];
  capabilities: TenantCapability[];
  isFullAccess: boolean;
};

export type TenantPermissionAssignmentView = {
  id: string;
  userId: string;
  membershipId: string;
  name: string;
  email: string;
  employeeId: string | null;
  designation: string | null;
  baseRole: Role;
  membershipStatus: MembershipStatus;
  primaryUnitName: string | null;
  primaryUnitCode: string | null;
  permissionRoles: TenantPermissionRole[];
};

const FULL_ACCESS_ROLES = new Set<Role>([
  Role.SUPERADMIN,
  Role.TENANT_OWNER,
  Role.TENANT_ADMIN,
]);

const ACCESSIBLE_MEMBERSHIP_STATUSES = [
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

const ALL_CAPABILITIES: TenantCapability[] = [
  "MANAGE_KRA",
  "MANAGE_KPI",
  "MANAGE_TARGETS",
  "MANAGE_WORKFLOW",
  "MANAGE_REWARDS",
  "MANAGE_ACCESS",
  "MANAGE_PERSONNEL",
];

const ROLE_DEFINITIONS: TenantPermissionRoleDefinition[] = [
  {
    code: TenantPermissionRole.KRA_MANAGER,
    label: "KRA Manager",
    description: "Manage periods, tenant KRA categories, and KRAs.",
    capabilities: ["MANAGE_KRA"],
  },
  {
    code: TenantPermissionRole.KPI_EDITOR,
    label: "KPI Editor",
    description: "Manage KPI definitions, templates, contributor policies, and workflow defaults.",
    capabilities: ["MANAGE_KPI"],
  },
  {
    code: TenantPermissionRole.TARGET_MANAGER,
    label: "Target Manager",
    description: "Manage target allocation, locking, and cascade distribution.",
    capabilities: ["MANAGE_TARGETS"],
  },
  {
    code: TenantPermissionRole.WORKFLOW_MANAGER,
    label: "Workflow Manager",
    description: "Manage KPI workflow ownership and live request reassignment.",
    capabilities: ["MANAGE_WORKFLOW"],
  },
  {
    code: TenantPermissionRole.REWARD_MANAGER,
    label: "Reward Manager",
    description: "Manage reward console, reconciliation, and reward state transitions.",
    capabilities: ["MANAGE_REWARDS"],
  },
  {
    code: TenantPermissionRole.ACCESS_ADMIN,
    label: "Access Admin",
    description: "Assign and revoke tenant permission roles.",
    capabilities: ["MANAGE_ACCESS"],
  },
  {
    code: TenantPermissionRole.PERSONNEL_MANAGER,
    label: "Personnel Manager",
    description: "Manage onboarding, placement, transfers, and personnel status changes.",
    capabilities: ["MANAGE_PERSONNEL"],
  },
];

const CAPABILITY_BY_ROLE = new Map<TenantPermissionRole, TenantCapability[]>(
  ROLE_DEFINITIONS.map((definition) => [definition.code, definition.capabilities]),
);

export function listTenantPermissionRoleDefinitions(): TenantPermissionRoleDefinition[] {
  return ROLE_DEFINITIONS;
}

export function isFullAccessTenantRole(role: Role | null | undefined): boolean {
  return !!role && FULL_ACCESS_ROLES.has(role);
}

export function resolveCapabilitiesFromPermissionRoles(
  roleCodes: readonly TenantPermissionRole[],
): TenantCapability[] {
  const capabilities = new Set<TenantCapability>();
  for (const roleCode of roleCodes) {
    for (const capability of CAPABILITY_BY_ROLE.get(roleCode) ?? []) {
      capabilities.add(capability);
    }
  }
  return [...capabilities];
}

export async function listTenantPermissionRolesForUser(
  tenantId: string,
  userId: string,
): Promise<TenantPermissionRole[]> {
  const assignments = await prisma.tenantPermissionAssignment.findMany({
    where: { tenantId, userId },
    orderBy: { roleCode: "asc" },
    select: { roleCode: true },
  });
  return assignments.map((assignment) => assignment.roleCode);
}

export async function getTenantPermissionAccessContext(input: {
  tenantId: string;
  userId: string;
  baseRole: Role | null | undefined;
}): Promise<TenantPermissionAccessContext> {
  if (isFullAccessTenantRole(input.baseRole)) {
    return {
      baseRole: input.baseRole,
      permissionRoles: ROLE_DEFINITIONS.map((definition) => definition.code),
      capabilities: ALL_CAPABILITIES,
      isFullAccess: true,
    };
  }

  const membership = await prisma.membership.findFirst({
    where: {
      tenantId: input.tenantId,
      userId: input.userId,
      status: { in: ACCESSIBLE_MEMBERSHIP_STATUSES },
      personnelStatus: { in: ACTIVE_PERSONNEL_STATUSES },
    },
    select: { id: true },
  });

  if (!membership) {
    return {
      baseRole: input.baseRole,
      permissionRoles: [],
      capabilities: [],
      isFullAccess: false,
    };
  }

  const permissionRoles = await listTenantPermissionRolesForUser(input.tenantId, input.userId);
  return {
    baseRole: input.baseRole,
    permissionRoles,
    capabilities: resolveCapabilitiesFromPermissionRoles(permissionRoles),
    isFullAccess: false,
  };
}

export async function hasTenantCapability(input: {
  tenantId: string;
  userId: string;
  baseRole: Role | null | undefined;
  capability: TenantCapability;
}): Promise<boolean> {
  const context = await getTenantPermissionAccessContext(input);
  return context.isFullAccess || context.capabilities.includes(input.capability);
}

export async function hasAnyTenantCapability(input: {
  tenantId: string;
  userId: string;
  baseRole: Role | null | undefined;
  capabilities: TenantCapability[];
}): Promise<boolean> {
  const context = await getTenantPermissionAccessContext(input);
  return context.isFullAccess
    || input.capabilities.some((capability) => context.capabilities.includes(capability));
}

export async function listTenantPermissionAssignments(
  tenantId: string,
): Promise<TenantPermissionAssignmentView[]> {
  const version = await prisma.orgStructureVersion.findFirst({
    where: {
      tenantId,
      state: { in: ["PUBLISHED", "VALIDATED", "DRAFT"] },
    },
    orderBy: { versionNumber: "desc" },
    select: { id: true },
  });

  const [memberships, primaryAssignments, permissionAssignments] = await Promise.all([
    prisma.membership.findMany({
      where: { tenantId },
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
      orderBy: [{ role: "asc" }, { createdAt: "desc" }],
    }),
    version
      ? prisma.userOrgAssignment.findMany({
          where: { versionId: version.id, isPrimary: true },
          include: { unit: { select: { name: true, code: true } } },
        })
      : Promise.resolve([]),
    prisma.tenantPermissionAssignment.findMany({
      where: { tenantId },
      orderBy: { roleCode: "asc" },
      select: {
        userId: true,
        roleCode: true,
      },
    }),
  ]);

  const primaryByUserId = new Map(
    primaryAssignments.map((assignment) => [assignment.userId, assignment]),
  );
  const permissionsByUserId = new Map<string, TenantPermissionRole[]>();
  for (const assignment of permissionAssignments) {
    const current = permissionsByUserId.get(assignment.userId) ?? [];
    current.push(assignment.roleCode);
    permissionsByUserId.set(assignment.userId, current);
  }

  return memberships.map((membership) => ({
    id: membership.userId,
    userId: membership.userId,
    membershipId: membership.id,
    name: `${membership.user.firstName} ${membership.user.lastName}`.trim(),
    email: membership.user.officialEmail,
    employeeId: membership.employeeId,
    designation: membership.designation,
    baseRole: membership.role,
    membershipStatus: membership.status,
    primaryUnitName: primaryByUserId.get(membership.userId)?.unit.name ?? null,
    primaryUnitCode: primaryByUserId.get(membership.userId)?.unit.code ?? null,
    permissionRoles: permissionsByUserId.get(membership.userId) ?? [],
  }));
}

function canManageAccess(
  baseRole: Role | null | undefined,
  permissionRoles: readonly TenantPermissionRole[],
): boolean {
  return isFullAccessTenantRole(baseRole) || permissionRoles.includes(TenantPermissionRole.ACCESS_ADMIN);
}

function validateManagedRoles(input: {
  actorBaseRole: Role | null | undefined;
  actorPermissionRoles: readonly TenantPermissionRole[];
  nextRoleCodes: readonly TenantPermissionRole[];
}): string | null {
  if (!canManageAccess(input.actorBaseRole, input.actorPermissionRoles)) {
    return "You do not have permission to manage tenant access roles.";
  }

  if (
    !isFullAccessTenantRole(input.actorBaseRole)
    && input.nextRoleCodes.includes(TenantPermissionRole.ACCESS_ADMIN)
  ) {
    return "Only a tenant owner or tenant admin can grant the Access Admin role.";
  }

  return null;
}

export async function replaceTenantPermissionAssignments(input: {
  tenantId: string;
  actorUserId: string;
  actorRole: Role | null | undefined;
  targetUserId: string;
  roleCodes: TenantPermissionRole[];
}): Promise<{ status: "success" | "error"; message: string }> {
  const actorPermissionRoles = await listTenantPermissionRolesForUser(input.tenantId, input.actorUserId);
  const normalizedRoleCodes = [...new Set(input.roleCodes)].sort();
  const validationError = validateManagedRoles({
    actorBaseRole: input.actorRole,
    actorPermissionRoles,
    nextRoleCodes: normalizedRoleCodes,
  });
  if (validationError) {
    return { status: "error", message: validationError };
  }

  if (
    !isFullAccessTenantRole(input.actorRole)
    && input.actorUserId === input.targetUserId
    && normalizedRoleCodes.includes(TenantPermissionRole.ACCESS_ADMIN)
  ) {
    return {
      status: "error",
      message: "Access Admin cannot assign the Access Admin role to themselves.",
    };
  }

  const targetMembership = await prisma.membership.findFirst({
    where: {
      tenantId: input.tenantId,
      userId: input.targetUserId,
      status: { in: ACCESSIBLE_MEMBERSHIP_STATUSES },
    },
    select: { id: true },
  });
  if (!targetMembership) {
    return { status: "error", message: "Target user does not have an eligible tenant membership." };
  }

  const currentAssignments = await prisma.tenantPermissionAssignment.findMany({
    where: { tenantId: input.tenantId, userId: input.targetUserId },
    select: { id: true, roleCode: true },
  });
  const currentRoleCodes = new Set(currentAssignments.map((assignment) => assignment.roleCode));
  const nextRoleCodeSet = new Set(normalizedRoleCodes);

  const toDelete = currentAssignments
    .filter((assignment) => !nextRoleCodeSet.has(assignment.roleCode))
    .map((assignment) => assignment.id);
  const toCreate = normalizedRoleCodes.filter((roleCode) => !currentRoleCodes.has(roleCode));

  await prisma.$transaction(async (tx) => {
    if (toDelete.length > 0) {
      await tx.tenantPermissionAssignment.deleteMany({
        where: { id: { in: toDelete } },
      });
    }

    if (toCreate.length > 0) {
      await tx.tenantPermissionAssignment.createMany({
        data: toCreate.map((roleCode) => ({
          tenantId: input.tenantId,
          userId: input.targetUserId,
          roleCode,
          createdByUserId: input.actorUserId,
        })),
      });
    }

    await tx.auditLog.create({
      data: {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole ?? Role.TENANT_USER,
        targetType: "TenantPermissionAssignment",
        targetId: input.targetUserId,
        action: "tenant.permission_roles.replaced",
        previousState: {
          roleCodes: [...currentRoleCodes],
        } as Prisma.InputJsonValue,
        newState: {
          roleCodes: normalizedRoleCodes,
        } as Prisma.InputJsonValue,
      },
    });
  });

  return { status: "success", message: "Permission roles updated." };
}
