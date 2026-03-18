import type { Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { KraKpiActionResult, KraDefinitionView } from "./shared";

// ── Constants ────────────────────────────────────────────────────────────────

const tenantOwnerRole = "TENANT_OWNER" satisfies Role;
const tenantAdminRole = "TENANT_ADMIN" satisfies Role;

// ── Schemas ──────────────────────────────────────────────────────────────────

const createKraSchema = z.object({
  periodId: z.string().trim().min(1),
  categoryId: z.string().trim().min(1).optional(),
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(1000).optional(),
  weightage: z.number().int().min(0).max(100).default(0),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});

const updateKraSchema = z.object({
  categoryId: z.string().trim().min(1).nullable().optional(),
  title: z.string().trim().min(2).max(200).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  weightage: z.number().int().min(0).max(100).optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export type CreateKraInput = z.input<typeof createKraSchema>;
export type UpdateKraInput = z.input<typeof updateKraSchema>;

// ── Helpers ──────────────────────────────────────────────────────────────────

function isAdminOrOwner(role: Role): boolean {
  return (
    role === tenantOwnerRole ||
    role === tenantAdminRole ||
    role === "SUPERADMIN"
  );
}

// ── List KRAs ────────────────────────────────────────────────────────────────

export async function listKras(
  tenantId: string,
  periodId?: string
): Promise<KraDefinitionView[]> {
  const kras = await prisma.kraDefinition.findMany({
    where: {
      tenantId,
      ...(periodId && { periodId }),
    },
    include: {
      period: { select: { name: true } },
      category: { select: { displayLabel: true } },
      kpiDefinitions: { select: { weightage: true } },
    },
    orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
  });

  return kras.map((k) => ({
    id: k.id,
    tenantId: k.tenantId,
    periodId: k.periodId,
    periodName: k.period.name,
    categoryId: k.categoryId,
    categoryLabel: k.category?.displayLabel ?? null,
    title: k.title,
    description: k.description,
    weightage: k.weightage,
    state: k.state,
    sortOrder: k.sortOrder,
    kpiCount: k.kpiDefinitions.length,
    kpiWeightageSum: k.kpiDefinitions.reduce((sum, kpi) => sum + kpi.weightage, 0),
    createdAt: k.createdAt,
  }));
}

// ── Get KRA ──────────────────────────────────────────────────────────────────

export async function getKra(
  kraId: string,
  tenantId: string
): Promise<KraDefinitionView | null> {
  const k = await prisma.kraDefinition.findFirst({
    where: { id: kraId, tenantId },
    include: {
      period: { select: { name: true } },
      category: { select: { displayLabel: true } },
      kpiDefinitions: { select: { weightage: true } },
    },
  });
  if (!k) return null;

  return {
    id: k.id,
    tenantId: k.tenantId,
    periodId: k.periodId,
    periodName: k.period.name,
    categoryId: k.categoryId,
    categoryLabel: k.category?.displayLabel ?? null,
    title: k.title,
    description: k.description,
    weightage: k.weightage,
    state: k.state,
    sortOrder: k.sortOrder,
    kpiCount: k.kpiDefinitions.length,
    kpiWeightageSum: k.kpiDefinitions.reduce((sum, kpi) => sum + kpi.weightage, 0),
    createdAt: k.createdAt,
  };
}

// ── Create KRA ───────────────────────────────────────────────────────────────

export async function createKra(
  tenantId: string,
  input: CreateKraInput,
  actorUserId: string,
  actorRole: Role
): Promise<KraKpiActionResult> {
  if (!isAdminOrOwner(actorRole)) {
    return { status: "error", message: "Insufficient permissions to create KRAs." };
  }

  const parsed = createKraSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;

  // Verify period exists and belongs to tenant
  const period = await prisma.assessmentPeriod.findFirst({
    where: { id: data.periodId, tenantId },
  });
  if (!period) {
    return { status: "error", message: "Assessment period not found." };
  }

  // Period must be DRAFT or OPEN to add KRAs
  if (period.state !== "DRAFT" && period.state !== "OPEN") {
    return {
      status: "error",
      message: `Cannot add KRAs to a period in "${period.state}" state.`,
    };
  }

  // Verify category if provided
  if (data.categoryId) {
    const cat = await prisma.kraCategoryDefinition.findFirst({
      where: {
        id: data.categoryId,
        OR: [{ tenantId: null }, { tenantId }],
        isActive: true,
      },
    });
    if (!cat) {
      return { status: "error", message: "Category not found or inactive." };
    }
  }

  // Check weightage sum won't exceed 100
  const existingSum = await prisma.kraDefinition.aggregate({
    where: { periodId: data.periodId, tenantId, state: { not: "ARCHIVED" } },
    _sum: { weightage: true },
  });
  const currentSum = existingSum._sum.weightage ?? 0;
  if (currentSum + data.weightage > 100) {
    return {
      status: "error",
      message: `Adding weightage ${data.weightage} would exceed total 100. Current sum: ${currentSum}, remaining: ${100 - currentSum}.`,
    };
  }

  await prisma.$transaction(async (tx) => {
    const kra = await tx.kraDefinition.create({
      data: {
        tenantId,
        periodId: data.periodId,
        categoryId: data.categoryId,
        title: data.title,
        description: data.description,
        weightage: data.weightage,
        sortOrder: data.sortOrder,
        createdByUserId: actorUserId,
      },
    });

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "KraDefinition",
        targetId: kra.id,
        action: "CREATE",
        newState: { title: data.title, weightage: data.weightage },
      },
    });
  });

  return { status: "success", message: `KRA "${data.title}" created.` };
}

// ── Update KRA ───────────────────────────────────────────────────────────────

export async function updateKra(
  kraId: string,
  tenantId: string,
  input: UpdateKraInput,
  actorUserId: string,
  actorRole: Role
): Promise<KraKpiActionResult> {
  if (!isAdminOrOwner(actorRole)) {
    return { status: "error", message: "Insufficient permissions." };
  }

  const parsed = updateKraSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;

  const kra = await prisma.kraDefinition.findFirst({
    where: { id: kraId, tenantId },
    include: { period: { select: { state: true } } },
  });
  if (!kra) {
    return { status: "error", message: "KRA not found." };
  }

  // Can only edit DRAFT KRAs, or ACTIVE KRAs in DRAFT/OPEN periods
  if (kra.state === "ARCHIVED") {
    return { status: "error", message: "Cannot edit an archived KRA." };
  }
  if (kra.period.state !== "DRAFT" && kra.period.state !== "OPEN") {
    return {
      status: "error",
      message: `Cannot edit KRA — period is in "${kra.period.state}" state.`,
    };
  }

  // If changing weightage, verify sum doesn't exceed 100
  if (data.weightage !== undefined && data.weightage !== kra.weightage) {
    const otherSum = await prisma.kraDefinition.aggregate({
      where: {
        periodId: kra.periodId,
        tenantId,
        id: { not: kraId },
        state: { not: "ARCHIVED" },
      },
      _sum: { weightage: true },
    });
    const otherTotal = otherSum._sum.weightage ?? 0;
    if (otherTotal + data.weightage > 100) {
      return {
        status: "error",
        message: `Weightage ${data.weightage} would exceed total 100. Other KRAs sum to ${otherTotal}, remaining: ${100 - otherTotal}.`,
      };
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.kraDefinition.update({
      where: { id: kraId },
      data: {
        ...(data.categoryId !== undefined && { categoryId: data.categoryId }),
        ...(data.title !== undefined && { title: data.title }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.weightage !== undefined && { weightage: data.weightage }),
        ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
      },
    });

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "KraDefinition",
        targetId: kraId,
        action: "UPDATE",
        previousState: { title: kra.title, weightage: kra.weightage },
        newState: data as object,
      },
    });
  });

  return { status: "success", message: "KRA updated." };
}

// ── Activate KRA ─────────────────────────────────────────────────────────────

export async function activateKra(
  kraId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role
): Promise<KraKpiActionResult> {
  if (!isAdminOrOwner(actorRole)) {
    return { status: "error", message: "Insufficient permissions." };
  }

  const kra = await prisma.kraDefinition.findFirst({
    where: { id: kraId, tenantId },
    include: {
      kpiDefinitions: { where: { state: { not: "ARCHIVED" } }, select: { weightage: true } },
    },
  });
  if (!kra) {
    return { status: "error", message: "KRA not found." };
  }

  if (kra.state !== "DRAFT") {
    return { status: "error", message: `KRA is already in "${kra.state}" state.` };
  }

  // Validate: KPI weightages must sum to KRA's weightage
  const kpiSum = kra.kpiDefinitions.reduce((s, k) => s + k.weightage, 0);
  if (kpiSum !== kra.weightage) {
    return {
      status: "error",
      message: `Cannot activate: KPI weightages sum to ${kpiSum}, but KRA weightage is ${kra.weightage}. They must match.`,
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.kraDefinition.update({
      where: { id: kraId },
      data: { state: "ACTIVE" },
    });

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "KraDefinition",
        targetId: kraId,
        action: "ACTIVATE",
        previousState: { state: "DRAFT" },
        newState: { state: "ACTIVE" },
      },
    });
  });

  return { status: "success", message: `KRA "${kra.title}" activated.` };
}

// ── Archive KRA ──────────────────────────────────────────────────────────────

export async function archiveKra(
  kraId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role
): Promise<KraKpiActionResult> {
  if (!isAdminOrOwner(actorRole)) {
    return { status: "error", message: "Insufficient permissions." };
  }

  const kra = await prisma.kraDefinition.findFirst({
    where: { id: kraId, tenantId },
    include: {
      kpiDefinitions: {
        include: {
          targetAllocations: { where: { state: "ACTIVE" }, select: { id: true } },
        },
      },
    },
  });
  if (!kra) {
    return { status: "error", message: "KRA not found." };
  }

  // Check for active allocations
  const hasActiveAllocations = kra.kpiDefinitions.some(
    (kpi) => kpi.targetAllocations.length > 0
  );
  if (hasActiveAllocations) {
    return {
      status: "error",
      message: "Cannot archive KRA — it has KPIs with active target allocations. Lock or remove them first.",
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.kraDefinition.update({
      where: { id: kraId },
      data: { state: "ARCHIVED" },
    });

    // Also archive all KPIs under this KRA
    await tx.kpiDefinition.updateMany({
      where: { kraDefinitionId: kraId },
      data: { state: "ARCHIVED" },
    });

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "KraDefinition",
        targetId: kraId,
        action: "ARCHIVE",
        previousState: { state: kra.state },
        newState: { state: "ARCHIVED" },
      },
    });
  });

  return { status: "success", message: `KRA "${kra.title}" archived.` };
}

// ── Delete KRA ───────────────────────────────────────────────────────────────

export async function deleteKra(
  kraId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role
): Promise<KraKpiActionResult> {
  if (!isAdminOrOwner(actorRole)) {
    return { status: "error", message: "Insufficient permissions." };
  }

  const kra = await prisma.kraDefinition.findFirst({
    where: { id: kraId, tenantId },
    include: {
      kpiDefinitions: {
        include: {
          _count: { select: { targetAllocations: true } },
        },
      },
    },
  });
  if (!kra) {
    return { status: "error", message: "KRA not found." };
  }

  // Cannot delete if any KPI has allocations
  const hasAllocations = kra.kpiDefinitions.some(
    (kpi) => kpi._count.targetAllocations > 0
  );
  if (hasAllocations) {
    return {
      status: "error",
      message: "Cannot delete KRA — it has KPIs with target allocations. Archive it instead.",
    };
  }

  await prisma.$transaction(async (tx) => {
    // Cascade will delete KPIs
    await tx.kraDefinition.delete({ where: { id: kraId } });

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "KraDefinition",
        targetId: kraId,
        action: "DELETE",
        previousState: { title: kra.title, weightage: kra.weightage },
      },
    });
  });

  return { status: "success", message: `KRA "${kra.title}" deleted.` };
}

// ── Validate Weightages ──────────────────────────────────────────────────────

export async function validateKraWeightages(
  periodId: string,
  tenantId: string
): Promise<{ valid: boolean; sum: number; remaining: number }> {
  const result = await prisma.kraDefinition.aggregate({
    where: { periodId, tenantId, state: { not: "ARCHIVED" } },
    _sum: { weightage: true },
  });
  const sum = result._sum.weightage ?? 0;
  return {
    valid: sum === 100,
    sum,
    remaining: 100 - sum,
  };
}
