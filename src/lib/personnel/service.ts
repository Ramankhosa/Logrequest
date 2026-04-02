import {
  InvitationStatus,
  MembershipStatus,
  OrgAssignmentType,
  PersonnelStatus,
  Role,
  TenantPermissionRole,
  UserLifecycleState,
  type PersonnelActionType,
} from "@prisma/client";
import { addDays } from "date-fns";
import { z } from "zod";
import { getBaseUrl, sendAuthEmail } from "@/lib/auth/email";
import { createRawToken } from "@/lib/auth/password";
import { normalizeEmail } from "@/lib/auth/utils";
import { prisma } from "@/lib/prisma";
import type {
  OnboardingOptions,
  PersonnelActionResult,
  PlacementSummary,
  PlacementSummaryUnit,
} from "@/lib/personnel/shared";
import {
  hasTenantCapability,
  listTenantPermissionRoleDefinitions,
  listTenantPermissionRolesForUser,
  replaceTenantPermissionAssignments,
} from "@/lib/tenant-permissions/service";
import {
  rebindOpenAchievementsForUserChange,
  resolveWorkflowReviewerForUnit,
} from "@/lib/kra-kpi/workflow-service";

// ── Constants ────────────────────────────────────────────────────────────────

const MANAGE_ROLES: Role[] = [Role.TENANT_OWNER, Role.TENANT_ADMIN];

// ── Schemas ──────────────────────────────────────────────────────────────────

const onboardSchema = z.object({
  firstName: z.string().trim().min(2),
  lastName: z.string().trim().min(2),
  officialEmail: z.string().trim().email(),
  employeeId: z.string().trim().optional(),
  designation: z.string().trim().max(200).optional(),
  dateOfJoining: z.coerce.date().optional(),
  role: z.enum(["TENANT_ADMIN", "TENANT_USER"]).default("TENANT_USER"),
  primaryUnitCode: z.string().trim().min(1),
  secondaryUnitCodes: z.array(z.string().trim().min(1)).default([]),
  roleKeys: z.array(z.string().trim().min(1)).default([]),
  permissionRoleCodes: z.array(z.nativeEnum(TenantPermissionRole)).default([]),
});

export type OnboardInput = z.input<typeof onboardSchema>;

const assignUnitSchema = z.object({
  membershipId: z.string().trim().min(1),
  unitCode: z.string().trim().min(1),
  assignmentType: z.enum(["PRIMARY", "SECONDARY"]).default("SECONDARY"),
});

export type AssignUnitInput = z.input<typeof assignUnitSchema>;

// ── Helpers ──────────────────────────────────────────────────────────────────

function canManagePersonnel(role: Role): boolean {
  return MANAGE_ROLES.includes(role);
}

async function canManagePersonnelWorkspace(
  tenantId: string,
  actorUserId: string,
  actorRole: Role,
) {
  if (canManagePersonnel(actorRole)) {
    return true;
  }

  return hasTenantCapability({
    tenantId,
    userId: actorUserId,
    baseRole: actorRole,
    capability: "MANAGE_PERSONNEL",
  });
}

async function getActiveVersionId(tenantId: string): Promise<string | null> {
  const v = await prisma.orgStructureVersion.findFirst({
    where: {
      tenantId,
      state: { in: ["DRAFT", "VALIDATED", "PUBLISHED"] },
    },
    orderBy: { versionNumber: "desc" },
    select: { id: true },
  });
  return v?.id ?? null;
}

async function getPersonnelPolicy(tenantId: string) {
  return prisma.tenantPersonnelPolicy.findUnique({
    where: { tenantId },
  });
}

// ── Onboarding Options ───────────────────────────────────────────────────────

export async function getOnboardingOptions(
  tenantId: string,
): Promise<OnboardingOptions> {
  const versionId = await getActiveVersionId(tenantId);
  if (!versionId) {
    return {
      units: [],
      roles: [],
      permissionRoles: listTenantPermissionRoleDefinitions().map((definition) => ({
        code: definition.code,
        label: definition.label,
        description: definition.description,
      })),
    };
  }

  const [units, roles] = await Promise.all([
    prisma.orgUnit.findMany({
      where: {
        versionId,
        tenantId,
        state: { in: ["DRAFT", "ACTIVE"] },
      },
      include: { type: { select: { displayLabel: true } } },
      orderBy: [{ level: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.orgRoleDefinition.findMany({
      where: { tenantId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { displayLabel: "asc" }],
    }),
  ]);

  return {
    units: units.map((u) => ({
      id: u.id,
      code: u.code,
      name: u.name,
      level: u.level,
      path: u.path,
      state: u.state,
      typeName: u.type.displayLabel,
    })),
    roles: roles.map((r) => ({
      id: r.id,
      roleKey: r.roleKey,
      displayLabel: r.displayLabel,
      isUnitHead: r.isUnitHead,
      maxPerUnit: r.maxPerUnit,
    })),
    permissionRoles: listTenantPermissionRoleDefinitions().map((definition) => ({
      code: definition.code,
      label: definition.label,
      description: definition.description,
    })),
  };
}

// ── Onboard Member ───────────────────────────────────────────────────────────

export async function onboardMember(input: {
  tenantId: string;
  actorUserId: string;
  actorRole: Role;
  values: OnboardInput;
}): Promise<PersonnelActionResult> {
  if (!(await canManagePersonnelWorkspace(input.tenantId, input.actorUserId, input.actorRole))) {
    return { status: "error", message: "You do not have permission to onboard members." };
  }

  const parsed = onboardSchema.safeParse(input.values);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const v = parsed.data;
  const email = normalizeEmail(v.officialEmail);
  const trimmedEmployeeId = v.employeeId?.trim() || null;
  const appRole = v.role === "TENANT_ADMIN" ? Role.TENANT_ADMIN : Role.TENANT_USER;
  const canManageAccess = v.permissionRoleCodes.length === 0
    || (await hasTenantCapability({
      tenantId: input.tenantId,
      userId: input.actorUserId,
      baseRole: input.actorRole,
      capability: "MANAGE_ACCESS",
    }));

  if (appRole === Role.TENANT_ADMIN && input.actorRole !== Role.TENANT_OWNER) {
    return { status: "error", message: "Only the tenant owner can create a tenant admin." };
  }
  if (!canManageAccess) {
    return {
      status: "error",
      message: "Only Access Admin, Tenant Admin, or Tenant Owner can assign permission roles during onboarding.",
    };
  }

  const versionId = await getActiveVersionId(input.tenantId);
  if (!versionId) {
    return { status: "error", message: "No active structure version. Create a structure first." };
  }

  // Validate primary unit
  const primaryUnit = await prisma.orgUnit.findFirst({
    where: { versionId, tenantId: input.tenantId, code: v.primaryUnitCode },
  });
  if (!primaryUnit) {
    return { status: "error", message: `Unit "${v.primaryUnitCode}" not found in the structure.` };
  }
  if (primaryUnit.state === "INACTIVE" || primaryUnit.state === "ARCHIVED") {
    return { status: "error", message: `Unit "${v.primaryUnitCode}" is ${primaryUnit.state.toLowerCase()}.` };
  }

  // Validate secondary units
  const secondaryUnits: { id: string; code: string; state: string }[] = [];
  const policy = await getPersonnelPolicy(input.tenantId);
  const maxSecondary = policy?.maxSecondaryUnits ?? 5;

  if (v.secondaryUnitCodes.length > maxSecondary) {
    return { status: "error", message: `Maximum ${maxSecondary} secondary unit(s) allowed.` };
  }

  for (const code of v.secondaryUnitCodes) {
    if (code === v.primaryUnitCode) {
      return { status: "error", message: `"${code}" is already the primary unit.` };
    }
    const unit = await prisma.orgUnit.findFirst({
      where: { versionId, tenantId: input.tenantId, code },
    });
    if (!unit) {
      return { status: "error", message: `Secondary unit "${code}" not found.` };
    }
    if (unit.state === "INACTIVE" || unit.state === "ARCHIVED") {
      return { status: "error", message: `Secondary unit "${code}" is ${unit.state.toLowerCase()}.` };
    }
    secondaryUnits.push(unit);
  }

  // Validate role keys
  const roleDefs: { id: string; displayLabel: string }[] = [];
  for (const key of v.roleKeys) {
    const def = await prisma.orgRoleDefinition.findFirst({
      where: { tenantId: input.tenantId, roleKey: key, isActive: true },
    });
    if (!def) {
      return { status: "error", message: `Role "${key}" not found or is inactive.` };
    }
    roleDefs.push(def);
  }

  // Check for existing user / membership
  const existingUser = await prisma.user.findUnique({
    where: { officialEmail: email },
    include: {
      memberships: { where: { tenantId: input.tenantId } },
    },
  });

  if (existingUser?.memberships.length) {
    const existing = existingUser.memberships[0]!;
    if (existing.status !== MembershipStatus.REVOKED && existing.status !== MembershipStatus.ARCHIVED) {
      return { status: "error", message: "This email already has an active membership in this tenant." };
    }
    // Rehire: old membership is historical, we create a new one below
  }

  if (trimmedEmployeeId) {
    const eidConflict = await prisma.membership.findUnique({
      where: { tenantId_employeeId: { tenantId: input.tenantId, employeeId: trimmedEmployeeId } },
    });
    if (eidConflict && eidConflict.status !== MembershipStatus.REVOKED && eidConflict.status !== MembershipStatus.ARCHIVED) {
      return { status: "error", message: "This employee ID is already in use." };
    }
  }

  const activationToken = createRawToken();
  const activationUrl = `${getBaseUrl()}/activate/${activationToken}`;

  const created = await prisma.$transaction(async (tx) => {
    const user =
      existingUser ??
      (await tx.user.create({
        data: {
          firstName: v.firstName.trim(),
          lastName: v.lastName.trim(),
          officialEmail: email,
          lifecycleState: UserLifecycleState.PENDING_ACTIVATION,
          allowedLoginMethods: ["PASSWORD", "GOOGLE", "MICROSOFT"],
        },
      }));

    const membership = await tx.membership.create({
      data: {
        tenantId: input.tenantId,
        userId: user.id,
        role: appRole,
        employeeId: trimmedEmployeeId,
        designation: v.designation?.trim() ?? null,
        dateOfJoining: v.dateOfJoining ?? null,
        personnelStatus: PersonnelStatus.ONBOARDING,
        status: MembershipStatus.PENDING_ACTIVATION,
        invitationState: InvitationStatus.PENDING,
        invitedAt: new Date(),
        createdByUserId: input.actorUserId,
      },
    });

    // Primary unit assignment
    await tx.userOrgAssignment.create({
      data: {
        versionId,
        unitId: primaryUnit.id,
        userId: user.id,
        assignmentType: OrgAssignmentType.PRIMARY,
        isPrimary: true,
        effectiveFrom: v.dateOfJoining ?? new Date(),
      },
    });

    // Secondary unit assignments
    for (const secUnit of secondaryUnits) {
      await tx.userOrgAssignment.create({
        data: {
          versionId,
          unitId: secUnit.id,
          userId: user.id,
          assignmentType: OrgAssignmentType.SECONDARY,
          isPrimary: false,
          effectiveFrom: v.dateOfJoining ?? new Date(),
        },
      });
    }

    // Role assignments — assign each role at the primary unit by default
    for (const roleDef of roleDefs) {
      await tx.orgRoleAssignment.create({
        data: {
          versionId,
          unitId: primaryUnit.id,
          userId: user.id,
          roleDefinitionId: roleDef.id,
          roleName: roleDef.displayLabel,
          scope: "NODE",
          effectiveFrom: v.dateOfJoining ?? new Date(),
        },
      });
    }

    await tx.invitation.create({
      data: {
        token: activationToken,
        tenantId: input.tenantId,
        userId: user.id,
        membershipId: membership.id,
        status: InvitationStatus.PENDING,
        invitedByUserId: input.actorUserId,
        expiresAt: addDays(new Date(), 7),
      },
    });

    await tx.personnelAction.create({
      data: {
        tenantId: input.tenantId,
        membershipId: membership.id,
        actionType: "ONBOARD",
        effectiveDate: v.dateOfJoining ?? new Date(),
        actorUserId: input.actorUserId,
        metadata: {
          primaryUnitCode: v.primaryUnitCode,
          secondaryUnitCodes: v.secondaryUnitCodes,
          roleKeys: v.roleKeys,
          designation: v.designation ?? null,
        },
      },
    });

    await tx.auditLog.create({
      data: {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        targetType: "Membership",
        targetId: membership.id,
        action: "personnel.onboarded",
        newState: {
          email,
          role: appRole,
          primaryUnit: v.primaryUnitCode,
          secondaryUnits: v.secondaryUnitCodes,
          roles: v.roleKeys,
        },
      },
    });

    return { email: user.officialEmail, userId: user.id };
  });

  let message = "Member onboarded successfully.";
  if (v.permissionRoleCodes.length > 0) {
    const permissionResult = await replaceTenantPermissionAssignments({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      targetUserId: created.userId,
      roleCodes: v.permissionRoleCodes,
    });
    if (permissionResult.status === "error") {
      return permissionResult;
    }
    message += " Permission roles assigned.";
  }
  try {
    await sendAuthEmail({
      to: created.email,
      subject: "Your account is ready",
      text: `Activate your account using this link: ${activationUrl}`,
      html: `<p>Activate your account:</p><p><a href="${activationUrl}">${activationUrl}</a></p>`,
    });
    message += " Invitation sent.";
  } catch {
    message += " Invitation email was not sent.";
  }

  return { status: "success", message };
}

// ── Assign to Unit ───────────────────────────────────────────────────────────

export async function assignToUnit(input: {
  tenantId: string;
  actorUserId: string;
  actorRole: Role;
  values: AssignUnitInput;
}): Promise<PersonnelActionResult> {
  if (!(await canManagePersonnelWorkspace(input.tenantId, input.actorUserId, input.actorRole))) {
    return { status: "error", message: "Permission denied." };
  }

  const parsed = assignUnitSchema.safeParse(input.values);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const v = parsed.data;
  const versionId = await getActiveVersionId(input.tenantId);
  if (!versionId) {
    return { status: "error", message: "No active structure version." };
  }

  const membership = await prisma.membership.findFirst({
    where: { id: v.membershipId, tenantId: input.tenantId },
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
  });
  if (!membership) {
    return { status: "error", message: "Membership not found." };
  }
  if (membership.personnelStatus === "SEPARATED") {
    return { status: "error", message: "Cannot assign units to a separated member." };
  }

  const unit = await prisma.orgUnit.findFirst({
    where: { versionId, tenantId: input.tenantId, code: v.unitCode },
  });
  if (!unit) {
    return { status: "error", message: `Unit "${v.unitCode}" not found.` };
  }
  if (unit.state === "INACTIVE" || unit.state === "ARCHIVED") {
    return { status: "error", message: `Unit "${v.unitCode}" is ${unit.state.toLowerCase()}.` };
  }

  const existing = await prisma.userOrgAssignment.findFirst({
    where: { versionId, unitId: unit.id, userId: membership.userId },
  });
  if (existing) {
    return { status: "error", message: "User is already assigned to this unit." };
  }

  const assignmentType =
    v.assignmentType === "PRIMARY" ? OrgAssignmentType.PRIMARY : OrgAssignmentType.SECONDARY;
  const isPrimary = assignmentType === OrgAssignmentType.PRIMARY;

  if (assignmentType === OrgAssignmentType.SECONDARY) {
    const policy = await getPersonnelPolicy(input.tenantId);
    const maxSecondary = policy?.maxSecondaryUnits ?? 5;
    const currentSecondary = await prisma.userOrgAssignment.count({
      where: {
        versionId,
        userId: membership.userId,
        assignmentType: OrgAssignmentType.SECONDARY,
      },
    });
    if (currentSecondary >= maxSecondary) {
      return { status: "error", message: `Maximum ${maxSecondary} secondary unit(s) reached.` };
    }
  }

  await prisma.$transaction(async (tx) => {
    // If assigning as PRIMARY, demote any existing PRIMARY to SECONDARY
    if (isPrimary) {
      await tx.userOrgAssignment.updateMany({
        where: {
          versionId,
          userId: membership.userId,
          assignmentType: OrgAssignmentType.PRIMARY,
        },
        data: {
          assignmentType: OrgAssignmentType.SECONDARY,
          isPrimary: false,
        },
      });
    }

    await tx.userOrgAssignment.create({
      data: {
        versionId,
        unitId: unit.id,
        userId: membership.userId,
        assignmentType,
        isPrimary,
        effectiveFrom: new Date(),
      },
    });

    await tx.personnelAction.create({
      data: {
        tenantId: input.tenantId,
        membershipId: membership.id,
        actionType: "ASSIGN_UNIT",
        effectiveDate: new Date(),
        actorUserId: input.actorUserId,
        metadata: { unitCode: v.unitCode, assignmentType: v.assignmentType },
      },
    });
  });

  return {
    status: "success",
    message: `Assigned ${membership.user.firstName} ${membership.user.lastName} to "${unit.name}" as ${v.assignmentType.toLowerCase()}.`,
  };
}

// ── Remove from Unit ─────────────────────────────────────────────────────────

export async function removeFromUnit(input: {
  tenantId: string;
  actorUserId: string;
  actorRole: Role;
  membershipId: string;
  unitCode: string;
}): Promise<PersonnelActionResult> {
  if (!(await canManagePersonnelWorkspace(input.tenantId, input.actorUserId, input.actorRole))) {
    return { status: "error", message: "Permission denied." };
  }

  const versionId = await getActiveVersionId(input.tenantId);
  if (!versionId) {
    return { status: "error", message: "No active structure version." };
  }

  const membership = await prisma.membership.findFirst({
    where: { id: input.membershipId, tenantId: input.tenantId },
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
  });
  if (!membership) {
    return { status: "error", message: "Membership not found." };
  }

  const unit = await prisma.orgUnit.findFirst({
    where: { versionId, tenantId: input.tenantId, code: input.unitCode },
  });
  if (!unit) {
    return { status: "error", message: `Unit "${input.unitCode}" not found.` };
  }

  const assignment = await prisma.userOrgAssignment.findFirst({
    where: { versionId, unitId: unit.id, userId: membership.userId },
  });
  if (!assignment) {
    return { status: "error", message: "User is not assigned to this unit." };
  }

  // Guard: cannot remove last PRIMARY for an active member
  if (
    assignment.isPrimary &&
    membership.personnelStatus !== "SEPARATED" &&
    membership.personnelStatus !== "SUSPENDED_HR"
  ) {
    const otherPrimary = await prisma.userOrgAssignment.count({
      where: {
        versionId,
        userId: membership.userId,
        assignmentType: OrgAssignmentType.PRIMARY,
        id: { not: assignment.id },
      },
    });
    if (otherPrimary === 0) {
      return {
        status: "error",
        message: "Cannot remove last primary unit for an active member. Change primary unit first or assign another primary.",
      };
    }
  }

  await prisma.$transaction(async (tx) => {
    // Remove all role assignments at this unit for this user
    await tx.orgRoleAssignment.deleteMany({
      where: { versionId, unitId: unit.id, userId: membership.userId },
    });

    await tx.userOrgAssignment.delete({ where: { id: assignment.id } });

    await tx.personnelAction.create({
      data: {
        tenantId: input.tenantId,
        membershipId: membership.id,
        actionType: "REMOVE_UNIT",
        effectiveDate: new Date(),
        actorUserId: input.actorUserId,
        metadata: { unitCode: input.unitCode, wasPrimary: assignment.isPrimary },
      },
    });
  });

  return {
    status: "success",
    message: `Removed ${membership.user.firstName} ${membership.user.lastName} from "${unit.name}".`,
  };
}

// ── Change Primary Unit ──────────────────────────────────────────────────────

export async function changePrimaryUnit(input: {
  tenantId: string;
  actorUserId: string;
  actorRole: Role;
  membershipId: string;
  newPrimaryUnitCode: string;
}): Promise<PersonnelActionResult> {
  if (!(await canManagePersonnelWorkspace(input.tenantId, input.actorUserId, input.actorRole))) {
    return { status: "error", message: "Permission denied." };
  }

  const versionId = await getActiveVersionId(input.tenantId);
  if (!versionId) {
    return { status: "error", message: "No active structure version." };
  }

  const membership = await prisma.membership.findFirst({
    where: { id: input.membershipId, tenantId: input.tenantId },
    include: { user: { select: { id: true } } },
  });
  if (!membership) {
    return { status: "error", message: "Membership not found." };
  }

  const unit = await prisma.orgUnit.findFirst({
    where: { versionId, tenantId: input.tenantId, code: input.newPrimaryUnitCode },
  });
  if (!unit) {
    return { status: "error", message: `Unit "${input.newPrimaryUnitCode}" not found.` };
  }

  const targetAssignment = await prisma.userOrgAssignment.findFirst({
    where: { versionId, unitId: unit.id, userId: membership.userId },
  });

  await prisma.$transaction(async (tx) => {
    // Demote current primary(s) to secondary
    await tx.userOrgAssignment.updateMany({
      where: {
        versionId,
        userId: membership.userId,
        assignmentType: OrgAssignmentType.PRIMARY,
      },
      data: {
        assignmentType: OrgAssignmentType.SECONDARY,
        isPrimary: false,
      },
    });

    if (targetAssignment) {
      // Promote existing assignment
      await tx.userOrgAssignment.update({
        where: { id: targetAssignment.id },
        data: {
          assignmentType: OrgAssignmentType.PRIMARY,
          isPrimary: true,
        },
      });
    } else {
      // Create new primary assignment
      await tx.userOrgAssignment.create({
        data: {
          versionId,
          unitId: unit.id,
          userId: membership.userId,
          assignmentType: OrgAssignmentType.PRIMARY,
          isPrimary: true,
          effectiveFrom: new Date(),
        },
      });
    }

    await tx.personnelAction.create({
      data: {
        tenantId: input.tenantId,
        membershipId: membership.id,
        actionType: "CHANGE_PRIMARY_UNIT",
        effectiveDate: new Date(),
        actorUserId: input.actorUserId,
        metadata: { newPrimaryUnitCode: input.newPrimaryUnitCode },
      },
    });
  });

  return { status: "success", message: `Primary unit changed to "${unit.name}".` };
}

// ── Placement Summary ────────────────────────────────────────────────────────

export async function getUserPlacementSummary(
  tenantId: string,
  membershipId: string,
): Promise<PlacementSummary | null> {
  const membership = await prisma.membership.findFirst({
    where: { id: membershipId, tenantId },
    include: {
      user: {
        select: { id: true, firstName: true, lastName: true, officialEmail: true },
      },
    },
  });
  if (!membership) return null;

  const permissionRoles = await listTenantPermissionRolesForUser(tenantId, membership.userId);

  const versionId = await getActiveVersionId(tenantId);
  if (!versionId) {
    return {
      membershipId: membership.id,
      userId: membership.userId,
      userName: `${membership.user.firstName} ${membership.user.lastName}`,
      userEmail: membership.user.officialEmail,
      employeeId: membership.employeeId,
      designation: membership.designation,
      personnelStatus: membership.personnelStatus,
      membershipStatus: membership.status,
      dateOfJoining: membership.dateOfJoining,
      permissionRoles,
      workflowWarnings: [],
      units: [],
    };
  }

  const assignments = await prisma.userOrgAssignment.findMany({
    where: { versionId, userId: membership.userId },
    include: {
      unit: {
        select: { id: true, code: true, name: true, level: true, path: true },
      },
    },
    orderBy: [{ isPrimary: "desc" }, { unit: { level: "asc" } }],
  });

  const roleAssignments = await prisma.orgRoleAssignment.findMany({
    where: { versionId, userId: membership.userId, isActive: true },
    include: {
      roleDefinition: { select: { roleKey: true, isUnitHead: true } },
    },
  });

  const rolesByUnit = new Map<string, typeof roleAssignments>();
  for (const ra of roleAssignments) {
    const list = rolesByUnit.get(ra.unitId) ?? [];
    list.push(ra);
    rolesByUnit.set(ra.unitId, list);
  }

  const units: PlacementSummaryUnit[] = assignments.map((a) => {
    const unitRoles = rolesByUnit.get(a.unitId) ?? [];
    return {
      assignmentId: a.id,
      unitId: a.unit.id,
      unitCode: a.unit.code,
      unitName: a.unit.name,
      unitLevel: a.unit.level,
      unitPath: a.unit.path,
      assignmentType: a.assignmentType as "PRIMARY" | "SECONDARY",
      isPrimary: a.isPrimary,
      effectiveFrom: a.effectiveFrom,
      effectiveTo: a.effectiveTo,
      roles: unitRoles.map((r) => ({
        assignmentId: r.id,
        roleDefinitionId: r.roleDefinitionId,
        roleKey: r.roleDefinition?.roleKey ?? r.roleName,
        roleName: r.roleName,
        isUnitHead: r.roleDefinition?.isUnitHead ?? false,
        scope: r.scope,
        isActive: r.isActive,
      })),
    };
  });

  const workflowAssignments = await prisma.kpiDefinition.findMany({
    where: {
      kraDefinition: { tenantId },
      OR: [
        { keyReviewerUserId: membership.userId },
        { finalReviewerUserId: membership.userId },
      ],
    },
    include: {
      kraDefinition: {
        select: {
          title: true,
          period: { select: { name: true } },
        },
      },
      keyUnit: { select: { name: true } },
      finalUnit: { select: { name: true } },
    },
    orderBy: [{ title: "asc" }],
  });

  const workflowWarnings: string[] = [];
  for (const workflowAssignment of workflowAssignments) {
    if (workflowAssignment.keyReviewerUserId === membership.userId && workflowAssignment.keyUnitId) {
      const resolution = await resolveWorkflowReviewerForUnit({
        tenantId,
        unitId: workflowAssignment.keyUnitId,
        requestedUserId: membership.userId,
      });
      if (resolution.warning) {
        workflowWarnings.push(
          `${workflowAssignment.title} (${workflowAssignment.kraDefinition.period.name}) - key reviewer warning: ${resolution.warning}`,
        );
      }
    }
    if (workflowAssignment.finalReviewerUserId === membership.userId && workflowAssignment.finalUnitId) {
      const resolution = await resolveWorkflowReviewerForUnit({
        tenantId,
        unitId: workflowAssignment.finalUnitId,
        requestedUserId: membership.userId,
      });
      if (resolution.warning) {
        workflowWarnings.push(
          `${workflowAssignment.title} (${workflowAssignment.kraDefinition.period.name}) - final reviewer warning: ${resolution.warning}`,
        );
      }
    }
  }

  return {
    membershipId: membership.id,
    userId: membership.userId,
    userName: `${membership.user.firstName} ${membership.user.lastName}`,
    userEmail: membership.user.officialEmail,
    employeeId: membership.employeeId,
    designation: membership.designation,
    personnelStatus: membership.personnelStatus,
    membershipStatus: membership.status,
    dateOfJoining: membership.dateOfJoining,
    permissionRoles,
    workflowWarnings,
    units,
  };
}

// ── Update Personnel Status ──────────────────────────────────────────────────

const VALID_STATUS_VALUES: PersonnelStatus[] = [
  PersonnelStatus.ACTIVE,
  PersonnelStatus.ON_LEAVE,
  PersonnelStatus.NOTICE_PERIOD,
  PersonnelStatus.SEPARATED,
  PersonnelStatus.SUSPENDED_HR,
];

export async function updatePersonnelStatus(input: {
  tenantId: string;
  actorUserId: string;
  actorRole: Role;
  membershipId: string;
  newStatus: PersonnelStatus;
  reason?: string;
}): Promise<PersonnelActionResult> {
  if (!(await canManagePersonnelWorkspace(input.tenantId, input.actorUserId, input.actorRole))) {
    return { status: "error", message: "Permission denied." };
  }

  if (!VALID_STATUS_VALUES.includes(input.newStatus)) {
    return { status: "error", message: "Invalid personnel status." };
  }

  const membership = await prisma.membership.findFirst({
    where: { id: input.membershipId, tenantId: input.tenantId },
    include: { user: { select: { firstName: true, lastName: true } } },
  });
  if (!membership) {
    return { status: "error", message: "Membership not found." };
  }

  if (membership.personnelStatus === input.newStatus) {
    return { status: "error", message: "Member already has this status." };
  }

  // Block status change on TENANT_OWNER to SEPARATED without special handling
  if (input.newStatus === PersonnelStatus.SEPARATED && membership.role === Role.TENANT_OWNER) {
    return { status: "error", message: "Cannot mark the tenant owner as separated." };
  }

  const actionTypeMap: Record<string, string> = {
    ACTIVE: "ACTIVATE",
    ON_LEAVE: "LEAVE_START",
    NOTICE_PERIOD: "RESIGN",
    SEPARATED: "TERMINATE",
    SUSPENDED_HR: "TERMINATE",
  };

  const previousStatus = membership.personnelStatus;

  await prisma.$transaction(async (tx) => {
    await tx.membership.update({
      where: { id: membership.id },
      data: { personnelStatus: input.newStatus },
    });

    // When marking as SEPARATED, deactivate all org role assignments
    if (input.newStatus === PersonnelStatus.SEPARATED) {
      const versionId = await getActiveVersionId(input.tenantId);
      if (versionId) {
        await tx.orgRoleAssignment.updateMany({
          where: { versionId, userId: membership.userId, isActive: true },
          data: { isActive: false, effectiveTo: new Date() },
        });

        await tx.userOrgAssignment.updateMany({
          where: { versionId, userId: membership.userId },
          data: { effectiveTo: new Date() },
        });
      }
    }

    await tx.personnelAction.create({
      data: {
        tenantId: input.tenantId,
        membershipId: membership.id,
        actionType: (actionTypeMap[input.newStatus] ?? "ACTIVATE") as PersonnelActionType,
        effectiveDate: new Date(),
        actorUserId: input.actorUserId,
        reason: input.reason ?? null,
        metadata: { previousStatus, newStatus: input.newStatus },
      },
    });
  });

  if (
    input.newStatus === PersonnelStatus.SEPARATED
    || input.newStatus === PersonnelStatus.SUSPENDED_HR
  ) {
    await rebindOpenAchievementsForUserChange({
      tenantId: input.tenantId,
      affectedUserId: membership.userId,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      note: `Reviewer auto-rebound because personnel status changed to ${input.newStatus}.`,
    });
  }

  const name = `${membership.user.firstName} ${membership.user.lastName}`;
  const label = input.newStatus.replace(/_/g, " ").toLowerCase();
  return { status: "success", message: `${name} marked as ${label}.` };
}

// ── Personnel Directory ──────────────────────────────────────────────────────

export type PersonnelDirectoryRow = {
  membershipId: string;
  userId: string;
  firstName: string;
  lastName: string;
  name: string;
  email: string;
  employeeId: string | null;
  designation: string | null;
  appRole: string;
  personnelStatus: string;
  membershipStatus: string;
  primaryUnit: string | null;
  primaryUnitCode: string | null;
  permissionRoles: TenantPermissionRole[];
  dateOfJoining: string | null;
  lastAccess: string | null;
};

export async function getPersonnelDirectory(
  tenantId: string,
): Promise<PersonnelDirectoryRow[]> {
  const versionId = await getActiveVersionId(tenantId);

  const [memberships, primaryAssignments, permissionAssignments] = await Promise.all([
    prisma.membership.findMany({
      where: { tenantId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, officialEmail: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    versionId
      ? prisma.userOrgAssignment.findMany({
          where: { versionId, isPrimary: true },
          include: { unit: { select: { name: true, code: true } } },
        })
      : Promise.resolve([]),
    prisma.tenantPermissionAssignment.findMany({
      where: { tenantId },
      orderBy: { roleCode: "asc" },
      select: { userId: true, roleCode: true },
    }),
  ]);

  const primaryByUser = new Map(
    primaryAssignments.map((a) => [a.userId, a]),
  );
  const permissionRolesByUser = new Map<string, TenantPermissionRole[]>();
  for (const assignment of permissionAssignments) {
    const current = permissionRolesByUser.get(assignment.userId) ?? [];
    current.push(assignment.roleCode);
    permissionRolesByUser.set(assignment.userId, current);
  }

  return memberships.map((m) => {
    const primary = primaryByUser.get(m.userId);
    return {
      membershipId: m.id,
      userId: m.userId,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
      name: `${m.user.firstName} ${m.user.lastName}`,
      email: m.user.officialEmail,
      employeeId: m.employeeId,
      designation: m.designation,
      appRole: m.role,
      personnelStatus: m.personnelStatus,
      membershipStatus: m.status,
      primaryUnit: primary?.unit.name ?? null,
      primaryUnitCode: primary?.unit.code ?? null,
      permissionRoles: permissionRolesByUser.get(m.userId) ?? [],
      dateOfJoining: m.dateOfJoining?.toISOString() ?? null,
      lastAccess: m.lastAccessTimestamp?.toISOString() ?? null,
    };
  });
}

// ── Personnel Timeline ───────────────────────────────────────────────────────

export type PersonnelTimelineEntry = {
  id: string;
  actionType: string;
  effectiveDate: string;
  reason: string | null;
  metadata: unknown;
  actorUserId: string;
  createdAt: string;
};

export async function getPersonnelTimeline(
  tenantId: string,
  membershipId: string,
): Promise<PersonnelTimelineEntry[]> {
  const actions = await prisma.personnelAction.findMany({
    where: { tenantId, membershipId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return actions.map((a) => ({
    id: a.id,
    actionType: a.actionType,
    effectiveDate: a.effectiveDate.toISOString(),
    reason: a.reason,
    metadata: a.metadata,
    actorUserId: a.actorUserId,
    createdAt: a.createdAt.toISOString(),
  }));
}

// ── Dashboard Counts ─────────────────────────────────────────────────────────

export type PersonnelDashboardCounts = {
  total: number;
  active: number;
  onLeave: number;
  noticePeriod: number;
  separated: number;
  onboarding: number;
  suspended: number;
};

export async function getPersonnelDashboardCounts(
  tenantId: string,
): Promise<PersonnelDashboardCounts> {
  const [total, active, onLeave, noticePeriod, separated, onboarding, suspended] =
    await Promise.all([
      prisma.membership.count({ where: { tenantId } }),
      prisma.membership.count({ where: { tenantId, personnelStatus: PersonnelStatus.ACTIVE } }),
      prisma.membership.count({ where: { tenantId, personnelStatus: PersonnelStatus.ON_LEAVE } }),
      prisma.membership.count({ where: { tenantId, personnelStatus: PersonnelStatus.NOTICE_PERIOD } }),
      prisma.membership.count({ where: { tenantId, personnelStatus: PersonnelStatus.SEPARATED } }),
      prisma.membership.count({ where: { tenantId, personnelStatus: PersonnelStatus.ONBOARDING } }),
      prisma.membership.count({ where: { tenantId, personnelStatus: PersonnelStatus.SUSPENDED_HR } }),
    ]);

  return { total, active, onLeave, noticePeriod, separated, onboarding, suspended };
}
