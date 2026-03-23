import type { Role, ContributorRole, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { KraKpiActionResult } from "./shared";

const tenantOwnerRole = "TENANT_OWNER" satisfies Role;
const tenantAdminRole = "TENANT_ADMIN" satisfies Role;

const CODE_RE = /^[A-Z0-9_]{2,80}$/;

const createContributorRoleSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(CODE_RE, "Code must be 2–80 uppercase letters, numbers, or underscores."),
  name: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).optional(),
  defaultCreditPercent: z.number().min(0).max(100),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});

const updateContributorRoleSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  defaultCreditPercent: z.number().min(0).max(100).optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
});

const applicableRoleEntrySchema = z.object({
  roleId: z.string().trim().min(1),
  isDefault: z.boolean(),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});

const setApplicableRolesSchema = z.object({
  roles: z.array(applicableRoleEntrySchema),
});

export type CreateContributorRoleInput = z.input<typeof createContributorRoleSchema>;
export type UpdateContributorRoleInput = z.input<typeof updateContributorRoleSchema>;
export type SetApplicableRolesInput = z.input<typeof setApplicableRolesSchema>;

export type ApplicableContributorRoleView = ContributorRole & {
  linkIsDefault: boolean;
  linkSortOrder: number;
};

function isTenantAdmin(role: Role): boolean {
  return (
    role === tenantOwnerRole ||
    role === tenantAdminRole ||
    role === "SUPERADMIN"
  );
}

const DEFAULT_CONTRIBUTOR_ROLES: Array<{
  code: string;
  name: string;
  defaultCreditPercent: number;
  sortOrder: number;
}> = [
  { code: "PI", name: "Principal Investigator", defaultCreditPercent: 50, sortOrder: 0 },
  { code: "CO_PI", name: "Co-Principal Investigator", defaultCreditPercent: 30, sortOrder: 1 },
  { code: "LEAD_AUTHOR", name: "Lead / First Author", defaultCreditPercent: 60, sortOrder: 2 },
  { code: "CO_AUTHOR", name: "Co-Author", defaultCreditPercent: 15, sortOrder: 3 },
  { code: "CORRESPONDING", name: "Corresponding Author", defaultCreditPercent: 50, sortOrder: 4 },
  { code: "MENTOR", name: "Mentor / Guide", defaultCreditPercent: 30, sortOrder: 5 },
  { code: "COORDINATOR", name: "Coordinator", defaultCreditPercent: 50, sortOrder: 6 },
  { code: "CO_COORDINATOR", name: "Co-Coordinator", defaultCreditPercent: 25, sortOrder: 7 },
  { code: "RESEARCH_STAFF", name: "Research Assistant", defaultCreditPercent: 15, sortOrder: 8 },
  { code: "SUPPORT", name: "Support Staff", defaultCreditPercent: 10, sortOrder: 9 },
  { code: "CONSULTANT", name: "Consultant", defaultCreditPercent: 40, sortOrder: 10 },
  { code: "MEMBER", name: "Team Member", defaultCreditPercent: 20, sortOrder: 11 },
];

type ContributorRoleArchiveImpact = {
  removedLinkCount: number;
  reassignedDefaultKpiCount: number;
  affectedKpiCount: number;
};

function buildLastApplicableRoleMessage(kpiCount: number): string {
  const noun = kpiCount === 1 ? "KPI" : "KPIs";
  return `This role is the only active applicable role for ${kpiCount} ${noun}. Assign another role first.`;
}

async function removeContributorRoleFromApplicableKpis(
  tx: Prisma.TransactionClient,
  contributorRoleId: string,
  tenantId: string,
): Promise<
  | { status: "ok"; impact: ContributorRoleArchiveImpact }
  | { status: "error"; result: KraKpiActionResult }
> {
  const linksToRemove = await tx.kpiApplicableRole.findMany({
    where: {
      contributorRoleId,
      kpiDefinition: {
        kraDefinition: { tenantId },
      },
    },
    select: {
      id: true,
      kpiDefinitionId: true,
      isDefault: true,
    },
  });

  if (linksToRemove.length === 0) {
    return {
      status: "ok",
      impact: {
        removedLinkCount: 0,
        reassignedDefaultKpiCount: 0,
        affectedKpiCount: 0,
      },
    };
  }

  const affectedKpiIds = [...new Set(linksToRemove.map((row) => row.kpiDefinitionId))];
  const remainingLinks = await tx.kpiApplicableRole.findMany({
    where: {
      kpiDefinitionId: { in: affectedKpiIds },
      contributorRoleId: { not: contributorRoleId },
      contributorRole: { isActive: true },
    },
    select: {
      id: true,
      kpiDefinitionId: true,
      isDefault: true,
      sortOrder: true,
    },
    orderBy: [{ kpiDefinitionId: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
  });

  const remainingByKpi = new Map<string, typeof remainingLinks>();
  for (const row of remainingLinks) {
    const existing = remainingByKpi.get(row.kpiDefinitionId) ?? [];
    existing.push(row);
    remainingByKpi.set(row.kpiDefinitionId, existing);
  }

  const blockingKpiIds = affectedKpiIds.filter(
    (kpiDefinitionId) => (remainingByKpi.get(kpiDefinitionId) ?? []).length === 0,
  );
  if (blockingKpiIds.length > 0) {
    return {
      status: "error",
      result: {
        status: "error",
        message: buildLastApplicableRoleMessage(blockingKpiIds.length),
        code: "ROLE_LAST_APPLICABLE",
      },
    };
  }

  await tx.kpiApplicableRole.deleteMany({
    where: { id: { in: linksToRemove.map((row) => row.id) } },
  });

  let reassignedDefaultKpiCount = 0;
  for (const kpiDefinitionId of affectedKpiIds) {
    const remaining = remainingByKpi.get(kpiDefinitionId) ?? [];
    const removedWasDefault = linksToRemove.some(
      (row) => row.kpiDefinitionId === kpiDefinitionId && row.isDefault,
    );
    const defaultCount = remaining.filter((row) => row.isDefault).length;
    if (!removedWasDefault && defaultCount === 1) {
      continue;
    }

    const nextDefault = remaining.find((row) => row.isDefault) ?? remaining[0];
    await tx.kpiApplicableRole.updateMany({
      where: { kpiDefinitionId },
      data: { isDefault: false },
    });
    await tx.kpiApplicableRole.update({
      where: { id: nextDefault.id },
      data: { isDefault: true },
    });
    reassignedDefaultKpiCount += 1;
  }

  return {
    status: "ok",
    impact: {
      removedLinkCount: linksToRemove.length,
      reassignedDefaultKpiCount,
      affectedKpiCount: affectedKpiIds.length,
    },
  };
}

export async function seedDefaultContributorRoles(tenantId: string): Promise<void> {
  for (const row of DEFAULT_CONTRIBUTOR_ROLES) {
    const existing = await prisma.contributorRole.findUnique({
      where: { tenantId_code: { tenantId, code: row.code } },
    });
    if (existing) continue;
    await prisma.contributorRole.create({
      data: {
        tenantId,
        code: row.code,
        name: row.name,
        defaultCreditPercent: row.defaultCreditPercent,
        sortOrder: row.sortOrder,
      },
    });
  }
}

export async function listContributorRoles(
  tenantId: string,
  includeArchived = false,
): Promise<ContributorRole[]> {
  await seedDefaultContributorRoles(tenantId);
  return prisma.contributorRole.findMany({
    where: {
      tenantId,
      ...(includeArchived ? {} : { isActive: true }),
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

export async function getContributorRole(
  id: string,
  tenantId: string,
): Promise<ContributorRole | null> {
  return prisma.contributorRole.findFirst({
    where: { id, tenantId },
  });
}

export async function createContributorRole(
  tenantId: string,
  input: CreateContributorRoleInput,
  actorUserId: string,
  actorRole: Role,
): Promise<KraKpiActionResult> {
  if (!isTenantAdmin(actorRole)) {
    return {
      status: "error",
      message: "Insufficient permissions.",
      code: "PERMISSION_DENIED",
    };
  }

  const parsed = createContributorRoleSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }
  const data = parsed.data;

  const dup = await prisma.contributorRole.findUnique({
    where: { tenantId_code: { tenantId, code: data.code } },
  });
  if (dup) {
    return {
      status: "error",
      message: `Contributor role code "${data.code}" already exists.`,
      code: "DUPLICATE_CODE",
    };
  }

  const created = await prisma.contributorRole.create({
    data: {
      tenantId,
      code: data.code,
      name: data.name,
      description: data.description,
      defaultCreditPercent: data.defaultCreditPercent,
      sortOrder: data.sortOrder,
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId,
      actorUserId,
      actorRole,
      targetType: "ContributorRole",
      targetId: created.id,
      action: "CREATE",
      newState: { code: data.code, name: data.name } as object,
    },
  });

  return {
    status: "success",
    message: "Contributor role created.",
    id: created.id,
    code: created.code,
  };
}

export async function updateContributorRole(
  id: string,
  tenantId: string,
  input: UpdateContributorRoleInput,
  actorUserId: string,
  actorRole: Role,
): Promise<KraKpiActionResult> {
  if (!isTenantAdmin(actorRole)) {
    return {
      status: "error",
      message: "Insufficient permissions.",
      code: "PERMISSION_DENIED",
    };
  }

  const parsed = updateContributorRoleSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  const existing = await prisma.contributorRole.findFirst({
    where: { id, tenantId },
  });
  if (!existing) {
    return {
      status: "error",
      message: "Contributor role not found.",
      code: "CONTRIBUTOR_ROLE_NOT_FOUND",
    };
  }

  const isDeactivating = parsed.data.isActive === false && existing.isActive;

  return prisma.$transaction(async (tx) => {
    let impact: ContributorRoleArchiveImpact = {
      removedLinkCount: 0,
      reassignedDefaultKpiCount: 0,
      affectedKpiCount: 0,
    };

    if (isDeactivating) {
      const removal = await removeContributorRoleFromApplicableKpis(tx, id, tenantId);
      if (removal.status === "error") {
        return removal.result;
      }
      impact = removal.impact;
    }

    const updated = await tx.contributorRole.update({
      where: { id },
      data: parsed.data,
    });

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "ContributorRole",
        targetId: id,
        action: "UPDATE",
        newState: {
          ...parsed.data,
          removedApplicableLinks: impact.removedLinkCount,
          reassignedDefaultKpis: impact.reassignedDefaultKpiCount,
        } as object,
      },
    });

    const message =
      impact.removedLinkCount > 0
        ? `Contributor role updated and removed from ${impact.affectedKpiCount} KPI(s).`
        : "Contributor role updated.";

    return { status: "success", message, id: updated.id } satisfies KraKpiActionResult;
  });
}

export async function archiveContributorRole(
  id: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role,
): Promise<KraKpiActionResult> {
  if (!isTenantAdmin(actorRole)) {
    return {
      status: "error",
      message: "Insufficient permissions.",
      code: "PERMISSION_DENIED",
    };
  }

  const existing = await prisma.contributorRole.findFirst({
    where: { id, tenantId },
  });
  if (!existing) {
    return {
      status: "error",
      message: "Contributor role not found.",
      code: "CONTRIBUTOR_ROLE_NOT_FOUND",
    };
  }

  return prisma.$transaction(async (tx) => {
    const removal = await removeContributorRoleFromApplicableKpis(tx, id, tenantId);
    if (removal.status === "error") {
      return removal.result;
    }

    await tx.contributorRole.update({
      where: { id },
      data: { isActive: false },
    });

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "ContributorRole",
        targetId: id,
        action: "ARCHIVE",
        newState: {
          isActive: false,
          removedApplicableLinks: removal.impact.removedLinkCount,
          reassignedDefaultKpis: removal.impact.reassignedDefaultKpiCount,
        } as object,
      },
    });

    const message =
      removal.impact.removedLinkCount > 0
        ? `Contributor role archived and removed from ${removal.impact.affectedKpiCount} KPI(s).`
        : "Contributor role archived.";

    return { status: "success", message } satisfies KraKpiActionResult;
  });
}

async function assertKpiInTenant(
  kpiDefinitionId: string,
  tenantId: string,
): Promise<boolean> {
  const kpi = await prisma.kpiDefinition.findFirst({
    where: { id: kpiDefinitionId, kraDefinition: { tenantId } },
    select: { id: true },
  });
  return kpi != null;
}

export async function getApplicableRoles(
  kpiDefinitionId: string,
  tenantId: string,
): Promise<ApplicableContributorRoleView[]> {
  const ok = await assertKpiInTenant(kpiDefinitionId, tenantId);
  if (!ok) return [];

  const links = await prisma.kpiApplicableRole.findMany({
    where: { kpiDefinitionId },
    include: { contributorRole: true },
    orderBy: [{ sortOrder: "asc" }, { contributorRole: { name: "asc" } }],
  });

  return links.map((l) => ({
    ...l.contributorRole,
    linkIsDefault: l.isDefault,
    linkSortOrder: l.sortOrder,
  }));
}

export async function setApplicableRoles(
  kpiDefinitionId: string,
  tenantId: string,
  input: SetApplicableRolesInput,
  actorUserId: string,
  actorRole: Role,
): Promise<KraKpiActionResult> {
  if (!isTenantAdmin(actorRole)) {
    return {
      status: "error",
      message: "Insufficient permissions.",
      code: "PERMISSION_DENIED",
    };
  }

  const parsed = setApplicableRolesSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  const roles = parsed.data.roles;
  const ok = await assertKpiInTenant(kpiDefinitionId, tenantId);
  if (!ok) {
    return {
      status: "error",
      message: "KPI not found.",
      code: "KPI_NOT_FOUND",
    };
  }

  if (roles.length === 0) {
    return {
      status: "error",
      message: "Select at least one applicable role. Every KPI needs a default reporter role.",
      code: "APPLICABLE_ROLES_REQUIRED",
    };
  }

  const defaultCount = roles.filter((r) => r.isDefault).length;
  if (defaultCount !== 1) {
    return {
      status: "error",
      message: "Exactly one applicable role must be marked as default (reporter role).",
      code: "APPLICABLE_ROLES_DEFAULT",
    };
  }

  const roleIds = [...new Set(roles.map((r) => r.roleId))];
  if (roleIds.length !== roles.length) {
    return {
      status: "error",
      message: "Duplicate role entries are not allowed.",
      code: "APPLICABLE_ROLES_DUPLICATE",
    };
  }

  if (roleIds.length > 0) {
    const dbRoles = await prisma.contributorRole.findMany({
      where: { id: { in: roleIds }, tenantId },
    });
    if (dbRoles.length !== roleIds.length) {
      return {
        status: "error",
        message: "One or more roles are invalid or belong to another tenant.",
        code: "ROLE_WRONG_TENANT",
      };
    }
    const archived = dbRoles.filter((r) => !r.isActive);
    if (archived.length > 0) {
      return {
        status: "error",
        message: "Archived roles cannot be assigned to a KPI.",
        code: "ROLE_ARCHIVED",
      };
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.kpiApplicableRole.deleteMany({ where: { kpiDefinitionId } });
    if (roles.length === 0) return;
    await tx.kpiApplicableRole.createMany({
      data: roles.map((r) => ({
        kpiDefinitionId,
        contributorRoleId: r.roleId,
        isDefault: r.isDefault,
        sortOrder: r.sortOrder,
      })),
    });
  });

  await prisma.auditLog.create({
    data: {
      tenantId,
      actorUserId,
      actorRole,
      targetType: "KpiApplicableRole",
      targetId: kpiDefinitionId,
      action: "SET_APPLICABLE_ROLES",
      newState: { count: roles.length } as object,
    },
  });

  return { status: "success", message: "Applicable roles updated." };
}
