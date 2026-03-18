import type { Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { KraKpiActionResult, KpiDefinitionView } from "./shared";
import { measurementConfigSchema, scoringConfigSchema } from "./shared";

// ── Constants ────────────────────────────────────────────────────────────────

const tenantOwnerRole = "TENANT_OWNER" satisfies Role;
const tenantAdminRole = "TENANT_ADMIN" satisfies Role;

// ── Schemas ──────────────────────────────────────────────────────────────────

const createKpiSchema = z.object({
  kraDefinitionId: z.string().trim().min(1, "Select a KRA before creating a KPI."),
  title: z.string().trim().min(2, "KPI title must be at least 2 characters.").max(200),
  description: z.string().trim().max(1000).optional(),
  measurementType: z.enum([
    "NUMERIC",
    "PERCENTAGE",
    "CURRENCY",
    "BOOLEAN",
    "RATING",
    "MILESTONE",
    "DATE_TARGET",
    "GRADE",
  ]),
  unitLabel: z.string().trim().max(30).optional(),
  weightage: z.number().int().min(0).max(100).default(0),
  defaultTarget: z.number().optional(),
  measurementConfig: measurementConfigSchema.optional(),
  scoringMethod: z.enum(["LINEAR", "THRESHOLD", "SLAB"]).default("LINEAR"),
  scoringDirection: z.enum(["ASCENDING", "DESCENDING"]).default("ASCENDING"),
  scoringConfig: scoringConfigSchema.optional(),
  isPerCapita: z.boolean().default(false),
  allocationType: z.enum(["DEPARTMENT", "INDIVIDUAL", "BOTH"]).default("BOTH"),
  startingUnitId: z.string().trim().min(1, "Select a starting unit."),
  guidanceNotes: z.string().trim().max(2000).optional(),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});

const updateKpiSchema = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  measurementType: z
    .enum([
      "NUMERIC",
      "PERCENTAGE",
      "CURRENCY",
      "BOOLEAN",
      "RATING",
      "MILESTONE",
      "DATE_TARGET",
      "GRADE",
    ])
    .optional(),
  unitLabel: z.string().trim().max(30).nullable().optional(),
  weightage: z.number().int().min(0).max(100).optional(),
  defaultTarget: z.number().nullable().optional(),
  measurementConfig: measurementConfigSchema.nullable().optional(),
  scoringMethod: z.enum(["LINEAR", "THRESHOLD", "SLAB"]).optional(),
  scoringDirection: z.enum(["ASCENDING", "DESCENDING"]).optional(),
  scoringConfig: scoringConfigSchema.nullable().optional(),
  isPerCapita: z.boolean().optional(),
  allocationType: z.enum(["DEPARTMENT", "INDIVIDUAL", "BOTH"]).optional(),
  startingUnitId: z.string().trim().min(1, "Select a starting unit.").optional(),
  guidanceNotes: z.string().trim().max(2000).nullable().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export type CreateKpiInput = z.input<typeof createKpiSchema>;
export type UpdateKpiInput = z.input<typeof updateKpiSchema>;

// ── Helpers ──────────────────────────────────────────────────────────────────

function isAdminOrOwner(role: Role): boolean {
  return (
    role === tenantOwnerRole ||
    role === tenantAdminRole ||
    role === "SUPERADMIN"
  );
}

function canModifyKpiInPeriodState(state: string): boolean {
  return state === "DRAFT" || state === "OPEN" || state === "UNDER_REVIEW";
}

// ── List KPIs ────────────────────────────────────────────────────────────────

export async function listKpis(
  tenantId: string,
  kraDefinitionId?: string
): Promise<KpiDefinitionView[]> {
  const kpis = await prisma.kpiDefinition.findMany({
    where: {
      kraDefinition: { tenantId },
      ...(kraDefinitionId && { kraDefinitionId }),
    },
    include: {
      kraDefinition: { select: { title: true, tenantId: true } },
      startingUnit: { select: { name: true } },
      _count: { select: { targetAllocations: true } },
    },
    orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
  });

  return kpis.map((k) => ({
    id: k.id,
    kraDefinitionId: k.kraDefinitionId,
    kraTitle: k.kraDefinition.title,
    title: k.title,
    description: k.description,
    measurementType: k.measurementType,
    unitLabel: k.unitLabel,
    weightage: k.weightage,
    defaultTarget: k.defaultTarget,
    measurementConfig: k.measurementConfig as KpiDefinitionView["measurementConfig"],
    scoringMethod: k.scoringMethod,
    scoringDirection: k.scoringDirection,
    scoringConfig: k.scoringConfig as KpiDefinitionView["scoringConfig"],
    isPerCapita: k.isPerCapita,
    allocationType: k.allocationType,
    startingUnitId: k.startingUnitId,
    startingUnitName: k.startingUnit.name,
    state: k.state,
    sortOrder: k.sortOrder,
    guidanceNotes: k.guidanceNotes,
    allocationCount: k._count.targetAllocations,
    createdAt: k.createdAt,
  }));
}

// ── Get KPI ──────────────────────────────────────────────────────────────────

export async function getKpi(
  kpiId: string,
  tenantId: string
): Promise<KpiDefinitionView | null> {
  const k = await prisma.kpiDefinition.findFirst({
    where: { id: kpiId, kraDefinition: { tenantId } },
    include: {
      kraDefinition: { select: { title: true, tenantId: true } },
      startingUnit: { select: { name: true } },
      _count: { select: { targetAllocations: true } },
    },
  });
  if (!k) return null;

  return {
    id: k.id,
    kraDefinitionId: k.kraDefinitionId,
    kraTitle: k.kraDefinition.title,
    title: k.title,
    description: k.description,
    measurementType: k.measurementType,
    unitLabel: k.unitLabel,
    weightage: k.weightage,
    defaultTarget: k.defaultTarget,
    measurementConfig: k.measurementConfig as KpiDefinitionView["measurementConfig"],
    scoringMethod: k.scoringMethod,
    scoringDirection: k.scoringDirection,
    scoringConfig: k.scoringConfig as KpiDefinitionView["scoringConfig"],
    isPerCapita: k.isPerCapita,
    allocationType: k.allocationType,
    startingUnitId: k.startingUnitId,
    startingUnitName: k.startingUnit.name,
    state: k.state,
    sortOrder: k.sortOrder,
    guidanceNotes: k.guidanceNotes,
    allocationCount: k._count.targetAllocations,
    createdAt: k.createdAt,
  };
}

// ── Create KPI ───────────────────────────────────────────────────────────────

export async function createKpi(
  tenantId: string,
  input: CreateKpiInput,
  actorUserId: string,
  actorRole: Role
): Promise<KraKpiActionResult> {
  if (!isAdminOrOwner(actorRole)) {
    return { status: "error", message: "Insufficient permissions to create KPIs." };
  }

  const parsed = createKpiSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;

  // Verify KRA exists and belongs to tenant
  const kra = await prisma.kraDefinition.findFirst({
    where: { id: data.kraDefinitionId, tenantId },
    include: {
      period: { select: { state: true } },
      kpiDefinitions: {
        where: { state: { not: "ARCHIVED" } },
        select: { weightage: true },
      },
    },
  });
  if (!kra) {
    return { status: "error", message: "KRA not found." };
  }

  // Period must be editable
  if (!canModifyKpiInPeriodState(kra.period.state)) {
    return {
      status: "error",
      message: `Cannot add KPIs — period is in "${kra.period.state}" state.`,
    };
  }

  // KRA must not be archived
  if (kra.state === "ARCHIVED") {
    return { status: "error", message: "Cannot add KPIs to an archived KRA." };
  }

  // Verify starting unit exists
  const unit = await prisma.orgUnit.findFirst({
    where: { id: data.startingUnitId, tenantId },
  });
  if (!unit) {
    return { status: "error", message: "Starting unit not found." };
  }

  // Check KPI weightage sum won't exceed KRA's weightage
  const currentKpiSum = kra.kpiDefinitions.reduce((s, k) => s + k.weightage, 0);
  if (currentKpiSum + data.weightage > kra.weightage) {
    return {
      status: "error",
      message: `Adding weightage ${data.weightage} would exceed KRA weightage (${kra.weightage}). Current KPI sum: ${currentKpiSum}, remaining: ${kra.weightage - currentKpiSum}.`,
    };
  }

  // Validate measurementConfig matches measurementType
  if (data.measurementConfig) {
    if (data.measurementConfig.type !== data.measurementType) {
      return {
        status: "error",
        message: `Measurement config type "${data.measurementConfig.type}" does not match measurement type "${data.measurementType}".`,
      };
    }
  }

  // Validate scoringConfig matches scoringMethod
  if (data.scoringConfig) {
    if (data.scoringConfig.method !== data.scoringMethod) {
      return {
        status: "error",
        message: `Scoring config method "${data.scoringConfig.method}" does not match scoring method "${data.scoringMethod}".`,
      };
    }
  }

  await prisma.$transaction(async (tx) => {
    const kpi = await tx.kpiDefinition.create({
      data: {
        kraDefinitionId: data.kraDefinitionId,
        title: data.title,
        description: data.description,
        measurementType: data.measurementType,
        unitLabel: data.unitLabel,
        weightage: data.weightage,
        defaultTarget: data.defaultTarget,
        measurementConfig: data.measurementConfig as object | undefined,
        scoringMethod: data.scoringMethod,
        scoringDirection: data.scoringDirection,
        scoringConfig: data.scoringConfig as object | undefined,
        isPerCapita: data.isPerCapita,
        allocationType: data.allocationType,
        startingUnitId: data.startingUnitId,
        guidanceNotes: data.guidanceNotes,
        sortOrder: data.sortOrder,
      },
    });

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "KpiDefinition",
        targetId: kpi.id,
        action: "CREATE",
        newState: {
          title: data.title,
          weightage: data.weightage,
          measurementType: data.measurementType,
        },
      },
    });
  });

  return { status: "success", message: `KPI "${data.title}" created.` };
}

// ── Update KPI ───────────────────────────────────────────────────────────────

export async function updateKpi(
  kpiId: string,
  tenantId: string,
  input: UpdateKpiInput,
  actorUserId: string,
  actorRole: Role
): Promise<KraKpiActionResult> {
  if (!isAdminOrOwner(actorRole)) {
    return { status: "error", message: "Insufficient permissions." };
  }

  const parsed = updateKpiSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;

  const kpi = await prisma.kpiDefinition.findFirst({
    where: { id: kpiId, kraDefinition: { tenantId } },
    include: {
      kraDefinition: {
        select: {
          weightage: true,
          period: { select: { state: true } },
          kpiDefinitions: {
            where: { state: { not: "ARCHIVED" } },
            select: { id: true, weightage: true },
          },
        },
      },
    },
  });
  if (!kpi) {
    return { status: "error", message: "KPI not found." };
  }

  if (kpi.state === "ARCHIVED") {
    return { status: "error", message: "Cannot edit an archived KPI." };
  }

  const periodState = kpi.kraDefinition.period.state;
  if (!canModifyKpiInPeriodState(periodState)) {
    return {
      status: "error",
      message: `Cannot edit KPI — period is in "${periodState}" state.`,
    };
  }

  // Check weightage
  if (data.weightage !== undefined && data.weightage !== kpi.weightage) {
    const otherKpiSum = kpi.kraDefinition.kpiDefinitions
      .filter((k) => k.id !== kpiId)
      .reduce((s, k) => s + k.weightage, 0);
    if (otherKpiSum + data.weightage > kpi.kraDefinition.weightage) {
      return {
        status: "error",
        message: `Weightage ${data.weightage} would exceed KRA weightage (${kpi.kraDefinition.weightage}). Other KPIs sum to ${otherKpiSum}.`,
      };
    }
  }

  // Validate starting unit if changing
  if (data.startingUnitId) {
    const unit = await prisma.orgUnit.findFirst({
      where: { id: data.startingUnitId, tenantId },
    });
    if (!unit) {
      return { status: "error", message: "Starting unit not found." };
    }
  }

  await prisma.$transaction(async (tx) => {
    // Build update payload — use Prisma's unchecked input to avoid relation type conflicts
    const updateData: Record<string, unknown> = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.measurementType !== undefined) updateData.measurementType = data.measurementType;
    if (data.unitLabel !== undefined) updateData.unitLabel = data.unitLabel;
    if (data.weightage !== undefined) updateData.weightage = data.weightage;
    if (data.defaultTarget !== undefined) updateData.defaultTarget = data.defaultTarget;
    if (data.measurementConfig !== undefined)
      updateData.measurementConfig = data.measurementConfig as object | null;
    if (data.scoringMethod !== undefined) updateData.scoringMethod = data.scoringMethod;
    if (data.scoringDirection !== undefined) updateData.scoringDirection = data.scoringDirection;
    if (data.scoringConfig !== undefined)
      updateData.scoringConfig = data.scoringConfig as object | null;
    if (data.isPerCapita !== undefined) updateData.isPerCapita = data.isPerCapita;
    if (data.allocationType !== undefined) updateData.allocationType = data.allocationType;
    if (data.startingUnitId !== undefined) updateData.startingUnitId = data.startingUnitId;
    if (data.guidanceNotes !== undefined) updateData.guidanceNotes = data.guidanceNotes;
    if (data.sortOrder !== undefined) updateData.sortOrder = data.sortOrder;

    await tx.kpiDefinition.update({
      where: { id: kpiId },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: updateData as any,
    });

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "KpiDefinition",
        targetId: kpiId,
        action: "UPDATE",
        previousState: { title: kpi.title, weightage: kpi.weightage },
        newState: data as object,
      },
    });
  });

  return { status: "success", message: "KPI updated." };
}

// ── Delete KPI ───────────────────────────────────────────────────────────────

export async function deleteKpi(
  kpiId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role
): Promise<KraKpiActionResult> {
  if (!isAdminOrOwner(actorRole)) {
    return { status: "error", message: "Insufficient permissions." };
  }

  const kpi = await prisma.kpiDefinition.findFirst({
    where: { id: kpiId, kraDefinition: { tenantId } },
    include: { _count: { select: { targetAllocations: true } } },
  });
  if (!kpi) {
    return { status: "error", message: "KPI not found." };
  }

  if (kpi._count.targetAllocations > 0) {
    return {
      status: "error",
      message: "Cannot delete KPI with target allocations. Archive it instead.",
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.kpiDefinition.delete({ where: { id: kpiId } });

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "KpiDefinition",
        targetId: kpiId,
        action: "DELETE",
        previousState: { title: kpi.title, weightage: kpi.weightage },
      },
    });
  });

  return { status: "success", message: `KPI "${kpi.title}" deleted.` };
}

// ── Validate KPI Weightages ──────────────────────────────────────────────────

export async function validateKpiWeightages(
  kraDefinitionId: string,
  tenantId: string
): Promise<{ valid: boolean; sum: number; kraWeightage: number; remaining: number }> {
  const kra = await prisma.kraDefinition.findFirst({
    where: { id: kraDefinitionId, tenantId },
    include: {
      kpiDefinitions: {
        where: { state: { not: "ARCHIVED" } },
        select: { weightage: true },
      },
    },
  });

  if (!kra) {
    return { valid: false, sum: 0, kraWeightage: 0, remaining: 0 };
  }

  const sum = kra.kpiDefinitions.reduce((s, k) => s + k.weightage, 0);
  return {
    valid: sum === kra.weightage,
    sum,
    kraWeightage: kra.weightage,
    remaining: kra.weightage - sum,
  };
}
