import type { Role, BenefitType } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { KraKpiActionResult } from "./shared";
import { hasTenantCapability } from "@/lib/tenant-permissions/service";

const tenantOwnerRole = "TENANT_OWNER" satisfies Role;
const tenantAdminRole = "TENANT_ADMIN" satisfies Role;

const CODE_RE = /^[A-Z0-9_]{2,80}$/;

const createBenefitTypeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(CODE_RE, "Code must be 2–80 uppercase letters, numbers, or underscores."),
  name: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).optional(),
  unit: z.string().trim().min(1).max(80),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});

const updateBenefitTypeSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  unit: z.string().trim().min(1).max(80).optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
});

export type CreateBenefitTypeInput = z.input<typeof createBenefitTypeSchema>;
export type UpdateBenefitTypeInput = z.input<typeof updateBenefitTypeSchema>;

function isTenantAdmin(role: Role): boolean {
  return (
    role === tenantOwnerRole ||
    role === tenantAdminRole ||
    role === "SUPERADMIN"
  );
}

async function canManageBenefitTypes(
  tenantId: string,
  actorUserId: string,
  actorRole: Role,
) {
  return hasTenantCapability({
    tenantId,
    userId: actorUserId,
    baseRole: actorRole,
    capability: "MANAGE_REWARDS",
  });
}

const DEFAULT_BENEFIT_TYPES: Array<{
  code: string;
  name: string;
  unit: string;
  sortOrder: number;
}> = [
  { code: "MONETARY", name: "Monetary Incentive", unit: "INR", sortOrder: 0 },
  { code: "LEAVE_POINTS", name: "Leave Points", unit: "Points", sortOrder: 1 },
  { code: "RESEARCH_POINTS", name: "Research Points", unit: "Points", sortOrder: 2 },
  { code: "CREDIT_HOURS", name: "Credit Hours", unit: "Hours", sortOrder: 3 },
  { code: "AWARD_POINTS", name: "Award Points", unit: "Points", sortOrder: 4 },
  { code: "REVENUE_SHARE", name: "Revenue Share", unit: "INR", sortOrder: 5 },
  {
    code: "CERTIFICATE",
    name: "Certificate / Recognition",
    unit: "Certificate",
    sortOrder: 6,
  },
  {
    code: "PUBLICATION_ACHIEVEMENT_WEIGHTED",
    name: "Publication Achievement (Contribution-Wise)",
    unit: "Count",
    sortOrder: 7,
  },
  {
    code: "PUBLICATION_ACHIEVEMENT",
    name: "Publication Achievement",
    unit: "Count",
    sortOrder: 8,
  },
];

export async function seedDefaultBenefitTypes(tenantId: string): Promise<void> {
  for (const row of DEFAULT_BENEFIT_TYPES) {
    const existing = await prisma.benefitType.findUnique({
      where: { tenantId_code: { tenantId, code: row.code } },
    });
    if (existing) continue;
    await prisma.benefitType.create({
      data: {
        tenantId,
        code: row.code,
        name: row.name,
        unit: row.unit,
        sortOrder: row.sortOrder,
      },
    });
  }
}

export async function listBenefitTypes(
  tenantId: string,
  includeArchived = false,
): Promise<BenefitType[]> {
  await seedDefaultBenefitTypes(tenantId);
  return prisma.benefitType.findMany({
    where: {
      tenantId,
      ...(includeArchived ? {} : { isActive: true }),
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

export async function getBenefitType(
  id: string,
  tenantId: string,
): Promise<BenefitType | null> {
  return prisma.benefitType.findFirst({
    where: { id, tenantId },
  });
}

export async function createBenefitType(
  tenantId: string,
  input: CreateBenefitTypeInput,
  actorUserId: string,
  actorRole: Role,
): Promise<KraKpiActionResult> {
  if (!(await canManageBenefitTypes(tenantId, actorUserId, actorRole))) {
    return {
      status: "error",
      message: "Insufficient permissions.",
      code: "PERMISSION_DENIED",
    };
  }

  const parsed = createBenefitTypeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }
  const data = parsed.data;

  const dup = await prisma.benefitType.findUnique({
    where: { tenantId_code: { tenantId, code: data.code } },
  });
  if (dup) {
    return {
      status: "error",
      message: `Benefit type code "${data.code}" already exists.`,
      code: "DUPLICATE_CODE",
    };
  }

  const created = await prisma.benefitType.create({
    data: {
      tenantId,
      code: data.code,
      name: data.name,
      description: data.description,
      unit: data.unit,
      sortOrder: data.sortOrder,
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId,
      actorUserId,
      actorRole,
      targetType: "BenefitType",
      targetId: created.id,
      action: "CREATE",
      newState: { code: data.code, name: data.name } as object,
    },
  });

  return {
    status: "success",
    message: "Benefit type created.",
    id: created.id,
    code: created.code,
  };
}

export async function updateBenefitType(
  id: string,
  tenantId: string,
  input: UpdateBenefitTypeInput,
  actorUserId: string,
  actorRole: Role,
): Promise<KraKpiActionResult> {
  if (!(await canManageBenefitTypes(tenantId, actorUserId, actorRole))) {
    return {
      status: "error",
      message: "Insufficient permissions.",
      code: "PERMISSION_DENIED",
    };
  }

  const parsed = updateBenefitTypeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  const existing = await prisma.benefitType.findFirst({
    where: { id, tenantId },
  });
  if (!existing) {
    return {
      status: "error",
      message: "Benefit type not found.",
      code: "BENEFIT_TYPE_NOT_FOUND",
    };
  }

  const updated = await prisma.benefitType.update({
    where: { id },
    data: parsed.data,
  });

  await prisma.auditLog.create({
    data: {
      tenantId,
      actorUserId,
      actorRole,
      targetType: "BenefitType",
      targetId: id,
      action: "UPDATE",
      newState: parsed.data as object,
    },
  });

  return { status: "success", message: "Benefit type updated.", id: updated.id };
}

export async function archiveBenefitType(
  id: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role,
): Promise<KraKpiActionResult> {
  if (!(await canManageBenefitTypes(tenantId, actorUserId, actorRole))) {
    return {
      status: "error",
      message: "Insufficient permissions.",
      code: "PERMISSION_DENIED",
    };
  }

  const existing = await prisma.benefitType.findFirst({
    where: { id, tenantId },
  });
  if (!existing) {
    return {
      status: "error",
      message: "Benefit type not found.",
      code: "BENEFIT_TYPE_NOT_FOUND",
    };
  }

  await prisma.benefitType.update({
    where: { id },
    data: { isActive: false },
  });

  await prisma.auditLog.create({
    data: {
      tenantId,
      actorUserId,
      actorRole,
      targetType: "BenefitType",
      targetId: id,
      action: "ARCHIVE",
      newState: { isActive: false } as object,
    },
  });

  return { status: "success", message: "Benefit type archived." };
}
