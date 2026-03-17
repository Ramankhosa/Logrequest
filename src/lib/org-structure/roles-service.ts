import { Prisma } from "@prisma/client";
import type { Role, OrgRoleScope } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { OrgStructureActionResult } from "@/lib/org-structure/shared";

// ── Constants ─────────────────────────────────────────────────────────────────

const tenantOwnerRole = "TENANT_OWNER" satisfies Role;
const tenantAdminRole = "TENANT_ADMIN" satisfies Role;

const ROLE_KEY_RE = /^[A-Z0-9_]{2,50}$/;

// ── Schemas ───────────────────────────────────────────────────────────────────

const roleDefinitionSchema = z.object({
  roleKey: z
    .string()
    .trim()
    .min(2)
    .max(50)
    .regex(ROLE_KEY_RE, "Role key must be 2-50 uppercase letters, numbers, or underscores"),
  displayLabel: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
  isUnitHead: z.boolean().default(false),
  approvalAuthority: z.boolean().default(false),
  maxPerUnit: z.number().int().min(-1).max(1000).default(-1),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});

const updateRoleDefinitionSchema = z.object({
  displayLabel: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  isUnitHead: z.boolean().optional(),
  approvalAuthority: z.boolean().optional(),
  maxPerUnit: z.number().int().min(-1).max(1000).optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
});

const roleAssignmentSchema = z.object({
  unitId: z.string().trim().min(1),
  userId: z.string().trim().min(1),
  roleDefinitionId: z.string().trim().min(1),
  scope: z.enum(["NODE", "DESCENDANTS"]).default("NODE"),
});

export type CreateRoleDefinitionInput = z.input<typeof roleDefinitionSchema>;
export type UpdateRoleDefinitionInput = z.input<typeof updateRoleDefinitionSchema>;
export type CreateRoleAssignmentInput = z.input<typeof roleAssignmentSchema>;

// ── Types ─────────────────────────────────────────────────────────────────────

export type RoleDefinitionView = {
  id: string;
  roleKey: string;
  displayLabel: string;
  description: string | null;
  isUnitHead: boolean;
  approvalAuthority: boolean;
  maxPerUnit: number;
  sortOrder: number;
  isActive: boolean;
  assignmentCount: number;
  createdAt: Date;
};

export type RoleAssignmentView = {
  id: string;
  unitId: string;
  unitName: string;
  unitCode: string;
  userId: string;
  userName: string;
  userEmail: string;
  roleName: string;
  roleKey: string;
  roleDefinitionId: string | null;
  isUnitHead: boolean;
  scope: OrgRoleScope;
  isActive: boolean;
};

export type ApprovalChainNode = {
  unitId: string;
  unitName: string;
  unitCode: string;
  level: number;
  headUserId: string | null;
  headUserName: string | null;
  headUserEmail: string | null;
  headRoleName: string | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function canManageStructure(role: Role) {
  return role === tenantOwnerRole || role === tenantAdminRole;
}

async function getPublishedVersionId(tenantId: string): Promise<string | null> {
  const v = await prisma.orgStructureVersion.findFirst({
    where: { tenantId, state: "PUBLISHED" },
    orderBy: { versionNumber: "desc" },
    select: { id: true },
  });
  return v?.id ?? null;
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

// ── Role Definition CRUD ──────────────────────────────────────────────────────

export async function listRoleDefinitions(
  tenantId: string,
): Promise<RoleDefinitionView[]> {
  const definitions = await prisma.orgRoleDefinition.findMany({
    where: { tenantId },
    orderBy: [{ sortOrder: "asc" }, { displayLabel: "asc" }],
    include: {
      _count: { select: { roleAssignments: true } },
    },
  });

  return definitions.map((d) => ({
    id: d.id,
    roleKey: d.roleKey,
    displayLabel: d.displayLabel,
    description: d.description,
    isUnitHead: d.isUnitHead,
    approvalAuthority: d.approvalAuthority,
    maxPerUnit: d.maxPerUnit,
    sortOrder: d.sortOrder,
    isActive: d.isActive,
    assignmentCount: d._count.roleAssignments,
    createdAt: d.createdAt,
  }));
}

export async function createRoleDefinition(input: {
  tenantId: string;
  actorUserId: string;
  actorRole: Role;
  values: CreateRoleDefinitionInput;
}): Promise<OrgStructureActionResult> {
  if (!canManageStructure(input.actorRole)) {
    return {
      status: "error",
      message: "You do not have permission to manage role definitions.",
    };
  }

  const parsed = roleDefinitionSchema.safeParse(input.values);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid role definition.",
    };
  }

  const values = parsed.data;
  const normalizedKey = values.roleKey.toUpperCase();

  const existing = await prisma.orgRoleDefinition.findUnique({
    where: {
      tenantId_roleKey: {
        tenantId: input.tenantId,
        roleKey: normalizedKey,
      },
    },
  });

  if (existing) {
    return {
      status: "error",
      message: `Role key "${normalizedKey}" already exists.`,
    };
  }

  const created = await prisma.orgRoleDefinition.create({
    data: {
      tenantId: input.tenantId,
      roleKey: normalizedKey,
      displayLabel: values.displayLabel,
      description: values.description ?? null,
      isUnitHead: values.isUnitHead,
      approvalAuthority: values.approvalAuthority,
      maxPerUnit: values.maxPerUnit,
      sortOrder: values.sortOrder,
      createdByUserId: input.actorUserId,
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      targetType: "OrgRoleDefinition",
      targetId: created.id,
      action: "org_role_definition.created",
      newState: {
        roleKey: created.roleKey,
        displayLabel: created.displayLabel,
        isUnitHead: created.isUnitHead,
        maxPerUnit: created.maxPerUnit,
        sortOrder: created.sortOrder,
      },
    },
  });

  return { status: "success", message: `Role "${values.displayLabel}" created.` };
}

export async function updateRoleDefinition(input: {
  tenantId: string;
  actorUserId: string;
  actorRole: Role;
  roleId: string;
  values: UpdateRoleDefinitionInput;
}): Promise<OrgStructureActionResult> {
  if (!canManageStructure(input.actorRole)) {
    return {
      status: "error",
      message: "You do not have permission to manage role definitions.",
    };
  }

  const parsed = updateRoleDefinitionSchema.safeParse(input.values);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid update values.",
    };
  }

  const values = parsed.data;

  const existing = await prisma.orgRoleDefinition.findFirst({
    where: { id: input.roleId, tenantId: input.tenantId },
  });

  if (!existing) {
    return { status: "error", message: "Role definition not found." };
  }

  // If deactivating, warn about active assignments
  if (values.isActive === false && existing.isActive) {
    const activeAssignments = await prisma.orgRoleAssignment.count({
      where: { roleDefinitionId: input.roleId, isActive: true },
    });
    if (activeAssignments > 0) {
      return {
        status: "error",
        message: `Cannot deactivate: ${activeAssignments} active assignment(s) use this role. Remove assignments first.`,
      };
    }
  }

  // If toggling isUnitHead off, check no units depend on this as their sole head
  if (values.isUnitHead === false && existing.isUnitHead) {
    const headAssignments = await prisma.orgRoleAssignment.findMany({
      where: { roleDefinitionId: input.roleId, isActive: true },
      select: { id: true, unitId: true, versionId: true },
    });

    for (const ha of headAssignments) {
      const otherHeads = await prisma.orgRoleAssignment.count({
        where: {
          versionId: ha.versionId,
          unitId: ha.unitId,
          isActive: true,
          id: { not: ha.id },
          roleDefinition: { isUnitHead: true },
        },
      });
      if (otherHeads === 0) {
        return {
          status: "error",
          message:
            "Cannot remove unit-head flag: some units have this as their only head role. Assign another head role first.",
        };
      }
    }
  }

  const data: Prisma.OrgRoleDefinitionUpdateInput = {};
  if (values.displayLabel !== undefined) data.displayLabel = values.displayLabel;
  if (values.description !== undefined) data.description = values.description;
  if (values.isUnitHead !== undefined) data.isUnitHead = values.isUnitHead;
  if (values.approvalAuthority !== undefined) data.approvalAuthority = values.approvalAuthority;
  if (values.maxPerUnit !== undefined) data.maxPerUnit = values.maxPerUnit;
  if (values.sortOrder !== undefined) data.sortOrder = values.sortOrder;
  if (values.isActive !== undefined) data.isActive = values.isActive;

  await prisma.$transaction(async (tx) => {
    await tx.orgRoleDefinition.update({
      where: { id: input.roleId },
      data,
    });

    // If displayLabel changed, update denormalized roleName on assignments
    if (values.displayLabel !== undefined && values.displayLabel !== existing.displayLabel) {
      await tx.orgRoleAssignment.updateMany({
        where: { roleDefinitionId: input.roleId },
        data: { roleName: values.displayLabel },
      });
    }

    await tx.auditLog.create({
      data: {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        targetType: "OrgRoleDefinition",
        targetId: input.roleId,
        action: "org_role_definition.updated",
        previousState: {
          displayLabel: existing.displayLabel,
          isUnitHead: existing.isUnitHead,
          isActive: existing.isActive,
        },
        newState: values,
      },
    });
  });

  return { status: "success", message: "Role definition updated." };
}

export async function deleteRoleDefinition(input: {
  tenantId: string;
  actorUserId: string;
  actorRole: Role;
  roleId: string;
}): Promise<OrgStructureActionResult> {
  if (!canManageStructure(input.actorRole)) {
    return {
      status: "error",
      message: "You do not have permission to manage role definitions.",
    };
  }

  const existing = await prisma.orgRoleDefinition.findFirst({
    where: { id: input.roleId, tenantId: input.tenantId },
    include: { _count: { select: { roleAssignments: true } } },
  });

  if (!existing) {
    return { status: "error", message: "Role definition not found." };
  }

  if (existing._count.roleAssignments > 0) {
    return {
      status: "error",
      message: `Cannot delete: ${existing._count.roleAssignments} assignment(s) reference this role. Deactivate it instead, or remove all assignments first.`,
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.orgRoleDefinition.delete({ where: { id: input.roleId } });

    await tx.auditLog.create({
      data: {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        targetType: "OrgRoleDefinition",
        targetId: input.roleId,
        action: "org_role_definition.deleted",
        previousState: {
          roleKey: existing.roleKey,
          displayLabel: existing.displayLabel,
        },
      },
    });
  });

  return { status: "success", message: `Role "${existing.displayLabel}" deleted.` };
}

// ── Role Assignment ───────────────────────────────────────────────────────────

export async function assignRoleToUser(input: {
  tenantId: string;
  actorUserId: string;
  actorRole: Role;
  values: CreateRoleAssignmentInput;
}): Promise<OrgStructureActionResult> {
  if (!canManageStructure(input.actorRole)) {
    return {
      status: "error",
      message: "You do not have permission to assign roles.",
    };
  }

  const parsed = roleAssignmentSchema.safeParse(input.values);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid assignment.",
    };
  }

  const values = parsed.data;

  // Validate role definition exists and is active
  const roleDef = await prisma.orgRoleDefinition.findFirst({
    where: { id: values.roleDefinitionId, tenantId: input.tenantId },
  });

  if (!roleDef) {
    return { status: "error", message: "Role definition not found." };
  }

  if (!roleDef.isActive) {
    return { status: "error", message: "Cannot assign a deactivated role." };
  }

  // Get active version
  const versionId = await getActiveVersionId(input.tenantId);
  if (!versionId) {
    return { status: "error", message: "No active structure version found. Create a structure first." };
  }

  // Validate unit exists in the version
  const unit = await prisma.orgUnit.findFirst({
    where: { id: values.unitId, versionId, tenantId: input.tenantId },
  });

  if (!unit) {
    return { status: "error", message: "Unit not found in the active structure." };
  }

  if (unit.state === "INACTIVE" || unit.state === "ARCHIVED") {
    return { status: "error", message: "Cannot assign roles to an inactive or archived unit." };
  }

  // Validate user exists and has a membership in this tenant
  const membership = await prisma.membership.findFirst({
    where: { tenantId: input.tenantId, userId: values.userId },
  });

  if (!membership) {
    return {
      status: "error",
      message: "User is not a member of this tenant. Add them as a member first.",
    };
  }

  // Check duplicate: same user + same role + same unit in this version
  const existingAssignment = await prisma.orgRoleAssignment.findFirst({
    where: {
      versionId,
      unitId: values.unitId,
      userId: values.userId,
      roleName: roleDef.displayLabel,
      isActive: true,
    },
  });

  if (existingAssignment) {
    return {
      status: "error",
      message: `User already has the "${roleDef.displayLabel}" role at this unit.`,
    };
  }

  // Enforce maxPerUnit (-1 = unlimited)
  if (roleDef.maxPerUnit > 0) {
    const currentCount = await prisma.orgRoleAssignment.count({
      where: {
        versionId,
        unitId: values.unitId,
        roleDefinitionId: roleDef.id,
        isActive: true,
      },
    });

    if (currentCount >= roleDef.maxPerUnit) {
      return {
        status: "error",
        message: `This unit already has ${currentCount} "${roleDef.displayLabel}" assignment(s) (max: ${roleDef.maxPerUnit}).`,
      };
    }
  }

  // Enforce single isUnitHead per unit: if this role is a unit head,
  // check no other unit-head role is already assigned at this unit
  if (roleDef.isUnitHead) {
    const existingHead = await prisma.orgRoleAssignment.findFirst({
      where: {
        versionId,
        unitId: values.unitId,
        isActive: true,
        roleDefinition: { isUnitHead: true },
      },
      include: {
        user: { select: { firstName: true, lastName: true } },
        roleDefinition: { select: { displayLabel: true } },
      },
    });

    if (existingHead) {
      const name = `${existingHead.user.firstName} ${existingHead.user.lastName}`;
      return {
        status: "error",
        message: `Unit already has a head: ${name} as "${existingHead.roleDefinition?.displayLabel ?? existingHead.roleName}". Remove that assignment first.`,
      };
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.orgRoleAssignment.create({
      data: {
        versionId,
        unitId: values.unitId,
        userId: values.userId,
        roleDefinitionId: roleDef.id,
        roleName: roleDef.displayLabel,
        scope: values.scope as OrgRoleScope,
      },
    });

    // Also ensure a UserOrgAssignment exists (places user in the unit)
    const existingPlacement = await tx.userOrgAssignment.findFirst({
      where: { versionId, unitId: values.unitId, userId: values.userId },
    });

    if (!existingPlacement) {
      await tx.userOrgAssignment.create({
        data: {
          versionId,
          unitId: values.unitId,
          userId: values.userId,
          assignmentType: "PRIMARY",
          isPrimary: true,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        targetType: "OrgRoleAssignment",
        targetId: values.userId,
        action: "org_role.assigned",
        newState: {
          unitId: values.unitId,
          roleKey: roleDef.roleKey,
          roleName: roleDef.displayLabel,
          scope: values.scope,
        },
      },
    });
  });

  return { status: "success", message: `Assigned "${roleDef.displayLabel}" role.` };
}

export async function removeRoleAssignment(input: {
  tenantId: string;
  actorUserId: string;
  actorRole: Role;
  assignmentId: string;
}): Promise<OrgStructureActionResult> {
  if (!canManageStructure(input.actorRole)) {
    return {
      status: "error",
      message: "You do not have permission to manage role assignments.",
    };
  }

  const assignment = await prisma.orgRoleAssignment.findFirst({
    where: { id: input.assignmentId },
    include: {
      unit: { select: { tenantId: true, name: true } },
      user: { select: { firstName: true, lastName: true } },
    },
  });

  if (!assignment) {
    return { status: "error", message: "Assignment not found." };
  }

  if (assignment.unit.tenantId !== input.tenantId) {
    return { status: "error", message: "Assignment does not belong to your tenant." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.orgRoleAssignment.delete({ where: { id: input.assignmentId } });

    // Check if user still has any other role at this unit; if not, remove UserOrgAssignment too
    const otherRoles = await tx.orgRoleAssignment.count({
      where: {
        versionId: assignment.versionId,
        unitId: assignment.unitId,
        userId: assignment.userId,
      },
    });

    if (otherRoles === 0) {
      await tx.userOrgAssignment.deleteMany({
        where: {
          versionId: assignment.versionId,
          unitId: assignment.unitId,
          userId: assignment.userId,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        targetType: "OrgRoleAssignment",
        targetId: input.assignmentId,
        action: "org_role.removed",
        previousState: {
          unitName: assignment.unit.name,
          userName: `${assignment.user.firstName} ${assignment.user.lastName}`,
          roleName: assignment.roleName,
        },
      },
    });
  });

  const userName = `${assignment.user.firstName} ${assignment.user.lastName}`;
  return {
    status: "success",
    message: `Removed "${assignment.roleName}" from ${userName} at "${assignment.unit.name}".`,
  };
}

// ── Query functions ───────────────────────────────────────────────────────────

export async function getUnitMembers(
  tenantId: string,
  unitId: string,
): Promise<RoleAssignmentView[]> {
  const versionId = await getActiveVersionId(tenantId);
  if (!versionId) return [];

  const assignments = await prisma.orgRoleAssignment.findMany({
    where: { versionId, unitId, isActive: true },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, officialEmail: true } },
      unit: { select: { name: true, code: true } },
      roleDefinition: { select: { roleKey: true, isUnitHead: true } },
    },
    orderBy: [{ roleDefinition: { sortOrder: "asc" } }, { roleName: "asc" }],
  });

  return assignments.map((a) => ({
    id: a.id,
    unitId: a.unitId,
    unitName: a.unit.name,
    unitCode: a.unit.code,
    userId: a.userId,
    userName: `${a.user.firstName} ${a.user.lastName}`,
    userEmail: a.user.officialEmail,
    roleName: a.roleName,
    roleKey: a.roleDefinition?.roleKey ?? a.roleName,
    roleDefinitionId: a.roleDefinitionId,
    isUnitHead: a.roleDefinition?.isUnitHead ?? false,
    scope: a.scope,
    isActive: a.isActive,
  }));
}

export async function getUserAssignments(
  tenantId: string,
  userId: string,
): Promise<RoleAssignmentView[]> {
  const versionId = await getActiveVersionId(tenantId);
  if (!versionId) return [];

  const assignments = await prisma.orgRoleAssignment.findMany({
    where: { versionId, userId, isActive: true },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, officialEmail: true } },
      unit: { select: { name: true, code: true } },
      roleDefinition: { select: { roleKey: true, isUnitHead: true } },
    },
    orderBy: [{ unit: { level: "asc" } }, { roleName: "asc" }],
  });

  return assignments.map((a) => ({
    id: a.id,
    unitId: a.unitId,
    unitName: a.unit.name,
    unitCode: a.unit.code,
    userId: a.userId,
    userName: `${a.user.firstName} ${a.user.lastName}`,
    userEmail: a.user.officialEmail,
    roleName: a.roleName,
    roleKey: a.roleDefinition?.roleKey ?? a.roleName,
    roleDefinitionId: a.roleDefinitionId,
    isUnitHead: a.roleDefinition?.isUnitHead ?? false,
    scope: a.scope,
    isActive: a.isActive,
  }));
}

// ── Approval Chain ────────────────────────────────────────────────────────────

/**
 * Walk up the org tree from a given unit, collecting the unit head at each level.
 * Returns the chain from the immediate unit up to root.
 * Handles: missing heads (gaps), inactive units (skipped), circular references (visited set).
 */
export async function getApprovalChain(
  tenantId: string,
  unitId: string,
): Promise<ApprovalChainNode[]> {
  const versionId = await getPublishedVersionId(tenantId);
  if (!versionId) return [];

  const chain: ApprovalChainNode[] = [];
  const visited = new Set<string>();
  let currentUnitId: string | null = unitId;

  while (currentUnitId) {
    // Guard against circular references (should not happen in a tree, but be safe)
    if (visited.has(currentUnitId)) break;
    visited.add(currentUnitId);

    const unit: {
      id: string;
      name: string;
      code: string;
      level: number;
      parentId: string | null;
      state: string;
    } | null = await prisma.orgUnit.findFirst({
      where: { id: currentUnitId, versionId },
      select: { id: true, name: true, code: true, level: true, parentId: true, state: true },
    });

    if (!unit) break;

    // Skip inactive units — they don't participate in approval
    if (unit.state === "INACTIVE" || unit.state === "ARCHIVED") {
      currentUnitId = unit.parentId;
      continue;
    }

    // Find the unit head: role assignment where the linked definition has isUnitHead=true
    const headAssignment = await prisma.orgRoleAssignment.findFirst({
      where: {
        versionId,
        unitId: unit.id,
        isActive: true,
        roleDefinition: { isUnitHead: true },
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, officialEmail: true } },
      },
      orderBy: { roleDefinition: { sortOrder: "asc" } },
    });

    chain.push({
      unitId: unit.id,
      unitName: unit.name,
      unitCode: unit.code,
      level: unit.level,
      headUserId: headAssignment?.user.id ?? null,
      headUserName: headAssignment
        ? `${headAssignment.user.firstName} ${headAssignment.user.lastName}`
        : null,
      headUserEmail: headAssignment?.user.officialEmail ?? null,
      headRoleName: headAssignment?.roleName ?? null,
    });

    currentUnitId = unit.parentId;
  }

  return chain;
}

// ── Reporting Line Derivation ─────────────────────────────────────────────────

/**
 * Regenerate ReportingLine records for a structure version based on role assignments.
 *
 * Logic:
 *   1. For each unit, find the unit head (isUnitHead role assignment).
 *   2. All non-head members at that unit report to the unit head.
 *   3. The unit head reports to the head of the parent unit.
 *
 * Edge cases handled:
 *   - Units without a head: members have no reporting line (gap logged as warning).
 *   - Units with no members: no reporting lines needed.
 *   - Root unit head: has no manager (top of chain).
 *   - Inactive units: skipped entirely.
 */
export async function deriveReportingLines(input: {
  tenantId: string;
  versionId: string;
  actorUserId: string;
  actorRole: Role;
}): Promise<{ created: number; warnings: string[] }> {
  if (!canManageStructure(input.actorRole)) {
    return { created: 0, warnings: ["Permission denied."] };
  }

  const warnings: string[] = [];

  // Load all units in tree order (level ASC)
  const units = await prisma.orgUnit.findMany({
    where: { versionId: input.versionId, state: { not: "INACTIVE" } },
    orderBy: { level: "asc" },
    select: { id: true, name: true, code: true, parentId: true, level: true },
  });

  // Load all active role assignments for this version
  const allAssignments = await prisma.orgRoleAssignment.findMany({
    where: { versionId: input.versionId, isActive: true },
    include: {
      roleDefinition: { select: { isUnitHead: true, sortOrder: true } },
    },
  });

  // Index: unitId -> assignments
  const unitAssignments = new Map<string, typeof allAssignments>();
  for (const a of allAssignments) {
    const list = unitAssignments.get(a.unitId) ?? [];
    list.push(a);
    unitAssignments.set(a.unitId, list);
  }

  // Find unit head userId per unit
  const unitHeadMap = new Map<string, string>();
  for (const unit of units) {
    const assignments = unitAssignments.get(unit.id) ?? [];
    const headAssignment = assignments
      .filter((a) => a.roleDefinition?.isUnitHead)
      .sort((a, b) => (a.roleDefinition?.sortOrder ?? 0) - (b.roleDefinition?.sortOrder ?? 0))[0];

    if (headAssignment) {
      unitHeadMap.set(unit.id, headAssignment.userId);
    } else if (assignments.length > 0) {
      warnings.push(`Unit "${unit.name}" (${unit.code}) has members but no unit head.`);
    }
  }

  // Build reporting lines
  const lines: Array<{
    versionId: string;
    unitId: string;
    managerUserId: string;
    memberUserId: string;
    lineType: string;
  }> = [];

  const seenPairs = new Set<string>();

  for (const unit of units) {
    const headUserId = unitHeadMap.get(unit.id);
    const assignments = unitAssignments.get(unit.id) ?? [];

    if (!headUserId) continue;

    // All non-head members at this unit → report to unit head
    for (const a of assignments) {
      if (a.userId === headUserId) continue;
      const key = `${headUserId}:${a.userId}:${unit.id}`;
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);

      lines.push({
        versionId: input.versionId,
        unitId: unit.id,
        managerUserId: headUserId,
        memberUserId: a.userId,
        lineType: "SOLID",
      });
    }

    // Unit head → reports to parent unit's head
    if (unit.parentId) {
      const parentHeadUserId = unitHeadMap.get(unit.parentId);
      if (parentHeadUserId && parentHeadUserId !== headUserId) {
        const key = `${parentHeadUserId}:${headUserId}:${unit.parentId}`;
        if (!seenPairs.has(key)) {
          seenPairs.add(key);
          lines.push({
            versionId: input.versionId,
            unitId: unit.parentId,
            managerUserId: parentHeadUserId,
            memberUserId: headUserId,
            lineType: "SOLID",
          });
        }
      } else if (!parentHeadUserId) {
        const parentUnit = units.find((u) => u.id === unit.parentId);
        if (parentUnit) {
          warnings.push(
            `Unit head of "${unit.name}" has no manager: parent "${parentUnit.name}" has no head assigned.`,
          );
        }
      }
    }
  }

  // Replace all existing reporting lines for this version, then create new ones
  await prisma.$transaction(async (tx) => {
    await tx.reportingLine.deleteMany({
      where: { versionId: input.versionId },
    });

    if (lines.length > 0) {
      await tx.reportingLine.createMany({ data: lines });
    }

    await tx.auditLog.create({
      data: {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        targetType: "OrgStructureVersion",
        targetId: input.versionId,
        action: "reporting_lines.derived",
        newState: {
          linesCreated: lines.length,
          warnings,
        },
      },
    });
  });

  return { created: lines.length, warnings };
}

// ── Bulk assign (used by user import) ─────────────────────────────────────────

export async function bulkAssignRoles(input: {
  tenantId: string;
  actorUserId: string;
  actorRole: Role;
  assignments: Array<{
    userId: string;
    unitCode: string;
    roleKey: string;
  }>;
}): Promise<OrgStructureActionResult & { details?: { created: number; skipped: number; errors: string[] } }> {
  if (!canManageStructure(input.actorRole)) {
    return { status: "error", message: "Permission denied." };
  }

  const versionId = await getActiveVersionId(input.tenantId);
  if (!versionId) {
    return { status: "error", message: "No active structure version. Create a structure first." };
  }

  // Load role definitions keyed by roleKey
  const roleDefs = await prisma.orgRoleDefinition.findMany({
    where: { tenantId: input.tenantId, isActive: true },
  });
  const roleDefMap = new Map(roleDefs.map((r) => [r.roleKey, r]));

  // Load units keyed by code
  const units = await prisma.orgUnit.findMany({
    where: { versionId },
    select: { id: true, code: true, state: true },
  });
  const unitMap = new Map(units.map((u) => [u.code, u]));

  // Track per-unit role counts for maxPerUnit enforcement
  const unitRoleCounts = new Map<string, number>();

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const row of input.assignments) {
    const roleDef = roleDefMap.get(row.roleKey);
    if (!roleDef) {
      errors.push(`Role "${row.roleKey}" not found.`);
      continue;
    }

    const unit = unitMap.get(row.unitCode);
    if (!unit) {
      errors.push(`Unit "${row.unitCode}" not found in structure.`);
      continue;
    }

    if (unit.state === "INACTIVE" || unit.state === "ARCHIVED") {
      errors.push(`Unit "${row.unitCode}" is ${unit.state.toLowerCase()}.`);
      continue;
    }

    // Check duplicate
    const existing = await prisma.orgRoleAssignment.findFirst({
      where: {
        versionId,
        unitId: unit.id,
        userId: row.userId,
        roleName: roleDef.displayLabel,
        isActive: true,
      },
    });

    if (existing) {
      skipped++;
      continue;
    }

    // maxPerUnit enforcement
    if (roleDef.maxPerUnit > 0) {
      const countKey = `${unit.id}:${roleDef.id}`;
      const current = unitRoleCounts.get(countKey) ?? 0;

      if (current === 0) {
        const dbCount = await prisma.orgRoleAssignment.count({
          where: { versionId, unitId: unit.id, roleDefinitionId: roleDef.id, isActive: true },
        });
        unitRoleCounts.set(countKey, dbCount);
        if (dbCount >= roleDef.maxPerUnit) {
          errors.push(
            `Unit "${row.unitCode}" already has max "${roleDef.displayLabel}" assignments (${roleDef.maxPerUnit}).`,
          );
          continue;
        }
      } else if (current >= roleDef.maxPerUnit) {
        errors.push(
          `Unit "${row.unitCode}" would exceed max "${roleDef.displayLabel}" assignments (${roleDef.maxPerUnit}).`,
        );
        continue;
      }
      unitRoleCounts.set(countKey, (unitRoleCounts.get(countKey) ?? 0) + 1);
    }

    // isUnitHead uniqueness
    if (roleDef.isUnitHead) {
      const existingHead = await prisma.orgRoleAssignment.findFirst({
        where: {
          versionId,
          unitId: unit.id,
          isActive: true,
          roleDefinition: { isUnitHead: true },
        },
      });
      if (existingHead) {
        errors.push(
          `Unit "${row.unitCode}" already has a unit head. Skipping "${roleDef.displayLabel}" for this unit.`,
        );
        continue;
      }
    }

    await prisma.orgRoleAssignment.create({
      data: {
        versionId,
        unitId: unit.id,
        userId: row.userId,
        roleDefinitionId: roleDef.id,
        roleName: roleDef.displayLabel,
        scope: "NODE",
      },
    });

    // Ensure UserOrgAssignment
    const existingPlacement = await prisma.userOrgAssignment.findFirst({
      where: { versionId, unitId: unit.id, userId: row.userId },
    });
    if (!existingPlacement) {
      await prisma.userOrgAssignment.create({
        data: {
          versionId,
          unitId: unit.id,
          userId: row.userId,
          assignmentType: "PRIMARY",
          isPrimary: true,
        },
      });
    }

    created++;
  }

  return {
    status: errors.length > 0 && created === 0 ? "error" : "success",
    message: `Assigned ${created} role(s)${skipped ? `, ${skipped} skipped` : ""}${errors.length ? `, ${errors.length} error(s)` : ""}.`,
    details: { created, skipped, errors },
  };
}
