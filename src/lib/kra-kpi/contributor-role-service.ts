import type { Role, ContributorRole, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { KraKpiActionResult } from "./shared";
import { parseContributionRoles } from "./kpi-service";
import { getTemplateApplicableRoleBaseline } from "./applicable-role-defaults";

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
  { code: "FIRST_AUTHOR", name: "First Author", defaultCreditPercent: 35, sortOrder: 12 },
  { code: "CORRESPONDING_AUTHOR", name: "Corresponding Author", defaultCreditPercent: 35, sortOrder: 13 },
  { code: "AUTHOR", name: "Author", defaultCreditPercent: 15, sortOrder: 14 },
  { code: "CHIEF_EDITOR", name: "Chief Editor", defaultCreditPercent: 50, sortOrder: 15 },
  { code: "CO_EDITOR", name: "Co-Editor", defaultCreditPercent: 50, sortOrder: 16 },
  { code: "SUPERVISOR", name: "Supervisor", defaultCreditPercent: 60, sortOrder: 17 },
  { code: "CO_SUPERVISOR", name: "Co-Supervisor", defaultCreditPercent: 20, sortOrder: 18 },
  { code: "INVENTOR", name: "Inventor", defaultCreditPercent: 100, sortOrder: 19 },
  { code: "CONVENOR", name: "Convenor", defaultCreditPercent: 100, sortOrder: 20 },
  { code: "LEAD_CONSULTANT", name: "Lead Consultant", defaultCreditPercent: 40, sortOrder: 21 },
  { code: "TEAM_MEMBER", name: "Team Member", defaultCreditPercent: 20, sortOrder: 22 },
];

function buildLastApplicableRoleMessage(kpiCount: number): string {
  const noun = kpiCount === 1 ? "KPI" : "KPIs";
  return `This role is the only active applicable role for ${kpiCount} ${noun}. Assign another role first.`;
}

type DbClient = Prisma.TransactionClient | typeof prisma;

function makeRoleCode(name: string): string {
  const normalized = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized.slice(0, 80) || "ROLE";
}

async function ensureDefaultContributorRolesInTx(
  tx: DbClient,
  tenantId: string,
): Promise<void> {
  for (const row of DEFAULT_CONTRIBUTOR_ROLES) {
    const existing = await tx.contributorRole.findUnique({
      where: { tenantId_code: { tenantId, code: row.code } },
    });
    if (existing) continue;
    await tx.contributorRole.create({
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

async function findOrCreateRoleForLegacyEntry(
  tx: DbClient,
  tenantId: string,
  entry: { role: string; creditPercent: number },
): Promise<ContributorRole> {
  const desiredCode = makeRoleCode(entry.role);
  const existing = await tx.contributorRole.findFirst({
    where: {
      tenantId,
      OR: [
        { name: entry.role },
        { code: desiredCode },
      ],
    },
    orderBy: { createdAt: "asc" },
  });
  if (existing) {
    return existing;
  }

  let code = desiredCode;
  let suffix = 2;
  while (await tx.contributorRole.findUnique({ where: { tenantId_code: { tenantId, code } } })) {
    const suffixText = `_${suffix}`;
    code = `${desiredCode.slice(0, Math.max(1, 80 - suffixText.length))}${suffixText}`;
    suffix += 1;
  }

  return tx.contributorRole.create({
    data: {
      tenantId,
      code,
      name: entry.role,
      defaultCreditPercent: entry.creditPercent,
      sortOrder: 999,
    },
  });
}

async function buildBaselineApplicableRoles(
  tx: DbClient,
  kpiDefinitionId: string,
  tenantId: string,
  legacyContributionRoles: unknown,
): Promise<Array<{ contributorRoleId: string; isDefault: boolean; sortOrder: number }>> {
  await ensureDefaultContributorRolesInTx(tx, tenantId);

  const legacyRoles = parseContributionRoles(legacyContributionRoles) ?? [];
  if (legacyRoles.length > 0) {
    const rows: Array<{ contributorRoleId: string; isDefault: boolean; sortOrder: number }> = [];
    const seen = new Set<string>();
    let defaultAssigned = false;

    for (const [index, legacyRole] of legacyRoles.entries()) {
      const role = await findOrCreateRoleForLegacyEntry(tx, tenantId, legacyRole);
      if (seen.has(role.id)) continue;
      const isDefault = legacyRole.isDefault || (!defaultAssigned && index === 0);
      rows.push({
        contributorRoleId: role.id,
        isDefault,
        sortOrder: index,
      });
      seen.add(role.id);
      if (isDefault) defaultAssigned = true;
    }

    if (!defaultAssigned && rows.length > 0) {
      rows[0] = { ...rows[0], isDefault: true };
    }
    return rows;
  }

  const kpiDefinition = await tx.kpiDefinition.findUnique({
    where: { id: kpiDefinitionId },
    select: { achievementTemplateKey: true },
  });
  const templateRoles = getTemplateApplicableRoleBaseline(
    kpiDefinition?.achievementTemplateKey ?? null,
  );
  if (templateRoles.length > 0) {
    const rows: Array<{ contributorRoleId: string; isDefault: boolean; sortOrder: number }> = [];

    for (const templateRole of templateRoles) {
      const role = await tx.contributorRole.findUnique({
        where: {
          tenantId_code: {
            tenantId,
            code: templateRole.roleCode,
          },
        },
      });
      if (!role) continue;
      rows.push({
        contributorRoleId: role.id,
        isDefault: templateRole.isDefault,
        sortOrder: templateRole.sortOrder,
      });
    }

    if (rows.length > 0) {
      if (!rows.some((row) => row.isDefault)) {
        rows[0] = { ...rows[0], isDefault: true };
      }
      return rows;
    }
  }

  const memberRole = await tx.contributorRole.findUnique({
    where: { tenantId_code: { tenantId, code: "MEMBER" } },
  });
  if (!memberRole) {
    throw new Error("Default MEMBER contributor role could not be resolved.");
  }
  return [
    {
      contributorRoleId: memberRole.id,
      isDefault: true,
      sortOrder: 0,
    },
  ];
}

export async function ensureApplicableRolesBaseline(
  kpiDefinitionId: string,
  tenantId: string,
  legacyContributionRoles: unknown = null,
  tx: DbClient = prisma,
): Promise<ApplicableContributorRoleView[]> {
  const existing = await tx.kpiApplicableRole.findMany({
    where: { kpiDefinitionId },
    include: { contributorRole: true },
    orderBy: [{ sortOrder: "asc" }, { contributorRole: { name: "asc" } }],
  });

  if (existing.length > 0) {
    const hasDefault = existing.some((row) => row.isDefault);
    if (!hasDefault) {
      const first = existing[0]!;
      await tx.kpiApplicableRole.updateMany({
        where: { kpiDefinitionId },
        data: { isDefault: false },
      });
      await tx.kpiApplicableRole.update({
        where: { id: first.id },
        data: { isDefault: true },
      });
      return existing.map((row, index) => ({
        ...row.contributorRole,
        linkIsDefault: index === 0,
        linkSortOrder: row.sortOrder,
      }));
    }

    return existing.map((row) => ({
      ...row.contributorRole,
      linkIsDefault: row.isDefault,
      linkSortOrder: row.sortOrder,
    }));
  }

  const baseline = await buildBaselineApplicableRoles(
    tx,
    kpiDefinitionId,
    tenantId,
    legacyContributionRoles,
  );

  await tx.kpiApplicableRole.createMany({
    data: baseline.map((row) => ({
      kpiDefinitionId,
      contributorRoleId: row.contributorRoleId,
      isDefault: row.isDefault,
      sortOrder: row.sortOrder,
    })),
  });

  const linked = await tx.kpiApplicableRole.findMany({
    where: { kpiDefinitionId },
    include: { contributorRole: true },
    orderBy: [{ sortOrder: "asc" }, { contributorRole: { name: "asc" } }],
  });

  return linked.map((row) => ({
    ...row.contributorRole,
    linkIsDefault: row.isDefault,
    linkSortOrder: row.sortOrder,
  }));
}

async function validateRoleDeactivation(
  tx: DbClient,
  contributorRoleId: string,
  tenantId: string,
): Promise<KraKpiActionResult | null> {
  const achievementUsage = await tx.achievementContributor.count({
    where: { contributorRoleId },
  });
  if (achievementUsage > 0) {
    return {
      status: "error",
      message: `Cannot archive role — referenced by ${achievementUsage} achievement contributor(s).`,
      code: "ROLE_IN_USE_ACHIEVEMENTS",
    };
  }

  const links = await tx.kpiApplicableRole.findMany({
    where: {
      contributorRoleId,
      kpiDefinition: { kraDefinition: { tenantId } },
    },
    select: { kpiDefinitionId: true },
  });
  if (links.length === 0) {
    return null;
  }

  const affectedKpiIds = [...new Set(links.map((row) => row.kpiDefinitionId))];
  for (const kpiDefinitionId of affectedKpiIds) {
    const otherActiveRoles = await tx.kpiApplicableRole.count({
      where: {
        kpiDefinitionId,
        contributorRoleId: { not: contributorRoleId },
        contributorRole: { isActive: true },
      },
    });
    if (otherActiveRoles === 0) {
      return {
        status: "error",
        message: buildLastApplicableRoleMessage(1),
        code: "ROLE_LAST_APPLICABLE",
      };
    }
  }

  return null;
}

async function promoteReplacementDefaults(
  tx: DbClient,
  contributorRoleId: string,
  tenantId: string,
): Promise<void> {
  const defaultLinks = await tx.kpiApplicableRole.findMany({
    where: {
      contributorRoleId,
      isDefault: true,
      kpiDefinition: { kraDefinition: { tenantId } },
    },
    select: {
      id: true,
      kpiDefinitionId: true,
    },
  });

  for (const link of defaultLinks) {
    const replacement = await tx.kpiApplicableRole.findFirst({
      where: {
        kpiDefinitionId: link.kpiDefinitionId,
        contributorRoleId: { not: contributorRoleId },
        contributorRole: { isActive: true },
      },
      orderBy: [{ sortOrder: "asc" }, { contributorRole: { name: "asc" } }],
      select: { id: true },
    });

    if (!replacement) {
      continue;
    }

    await tx.kpiApplicableRole.update({
      where: { id: link.id },
      data: { isDefault: false },
    });
    await tx.kpiApplicableRole.update({
      where: { id: replacement.id },
      data: { isDefault: true },
    });
  }
}

export async function seedDefaultContributorRoles(tenantId: string): Promise<void> {
  await ensureDefaultContributorRolesInTx(prisma, tenantId);
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
    if (isDeactivating) {
      const blockingResult = await validateRoleDeactivation(tx, id, tenantId);
      if (blockingResult) {
        return blockingResult;
      }
      await promoteReplacementDefaults(tx, id, tenantId);
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
        newState: parsed.data as object,
      },
    });

    return { status: "success", message: "Contributor role updated.", id: updated.id } satisfies KraKpiActionResult;
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
    const blockingResult = await validateRoleDeactivation(tx, id, tenantId);
    if (blockingResult) {
      return blockingResult;
    }

    await promoteReplacementDefaults(tx, id, tenantId);

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
        newState: { isActive: false } as object,
      },
    });
    return { status: "success", message: "Contributor role archived." } satisfies KraKpiActionResult;
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
