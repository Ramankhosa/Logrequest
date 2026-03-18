import type { Role, KpiMeasurementType } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { KraKpiActionResult, TargetAllocationView } from "./shared";

// ── Constants ────────────────────────────────────────────────────────────────

const tenantOwnerRole = "TENANT_OWNER" satisfies Role;
const tenantAdminRole = "TENANT_ADMIN" satisfies Role;

// ── Schemas ──────────────────────────────────────────────────────────────────

const createAllocationSchema = z.object({
  periodId: z.string().trim().min(1),
  kpiDefinitionId: z.string().trim().min(1),
  assignedToUnitId: z.string().trim().min(1).optional(),
  assignedToUserId: z.string().trim().min(1).optional(),
  targetValue: z.number().optional(),
  targetDate: z.coerce.date().optional(),
  targetMilestone: z.enum(["NOT_STARTED", "IN_PROGRESS", "COMPLETED"]).optional(),
  targetGrade: z
    .enum(["OUTSTANDING", "VERY_GOOD", "GOOD", "SATISFACTORY", "NEEDS_IMPROVEMENT", "POOR"])
    .optional(),
  targetBoolean: z.boolean().optional(),
  targetRating: z.number().int().min(1).max(10).optional(),
  parentAllocationId: z.string().trim().min(1).optional(),
  notes: z.string().trim().max(500).optional(),
});

const updateAllocationSchema = z.object({
  targetValue: z.number().optional(),
  targetDate: z.coerce.date().optional(),
  targetMilestone: z.enum(["NOT_STARTED", "IN_PROGRESS", "COMPLETED"]).optional(),
  targetGrade: z
    .enum(["OUTSTANDING", "VERY_GOOD", "GOOD", "SATISFACTORY", "NEEDS_IMPROVEMENT", "POOR"])
    .optional(),
  targetBoolean: z.boolean().optional(),
  targetRating: z.number().int().min(1).max(10).optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

const cascadeDistributionSchema = z.object({
  distributions: z.array(
    z.object({
      assignedToUnitId: z.string().trim().min(1).optional(),
      assignedToUserId: z.string().trim().min(1).optional(),
      targetValue: z.number().optional(),
      targetDate: z.coerce.date().optional(),
      targetMilestone: z.enum(["NOT_STARTED", "IN_PROGRESS", "COMPLETED"]).optional(),
      targetGrade: z
        .enum(["OUTSTANDING", "VERY_GOOD", "GOOD", "SATISFACTORY", "NEEDS_IMPROVEMENT", "POOR"])
        .optional(),
      targetBoolean: z.boolean().optional(),
      targetRating: z.number().int().min(1).max(10).optional(),
      notes: z.string().trim().max(500).optional(),
    })
  ).min(1),
});

export type CreateAllocationInput = z.input<typeof createAllocationSchema>;
export type UpdateAllocationInput = z.input<typeof updateAllocationSchema>;
export type CascadeDistributionInput = z.input<typeof cascadeDistributionSchema>;

// ── Helpers ──────────────────────────────────────────────────────────────────

function isAdminOrOwner(role: Role): boolean {
  return (
    role === tenantOwnerRole ||
    role === tenantAdminRole ||
    role === "SUPERADMIN"
  );
}

/** Types where child target values must sum to parent */
const SUMMABLE_TYPES: KpiMeasurementType[] = ["NUMERIC", "CURRENCY"];

// ── List Allocations ─────────────────────────────────────────────────────────

export async function listAllocations(
  tenantId: string,
  filters: {
    periodId?: string;
    kpiDefinitionId?: string;
    assignedToUnitId?: string;
    assignedToUserId?: string;
    parentAllocationId?: string | null;
  } = {}
): Promise<TargetAllocationView[]> {
  const allocations = await prisma.targetAllocation.findMany({
    where: {
      tenantId,
      ...(filters.periodId && { periodId: filters.periodId }),
      ...(filters.kpiDefinitionId && { kpiDefinitionId: filters.kpiDefinitionId }),
      ...(filters.assignedToUnitId && { assignedToUnitId: filters.assignedToUnitId }),
      ...(filters.assignedToUserId && { assignedToUserId: filters.assignedToUserId }),
      ...(filters.parentAllocationId !== undefined && {
        parentAllocationId: filters.parentAllocationId,
      }),
    },
    include: {
      kpiDefinition: { select: { title: true } },
      assignedToUnit: { select: { name: true } },
      assignedToUser: { select: { firstName: true, lastName: true } },
      _count: { select: { childAllocations: true, achievements: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return allocations.map((a) => ({
    id: a.id,
    tenantId: a.tenantId,
    periodId: a.periodId,
    kpiDefinitionId: a.kpiDefinitionId,
    kpiTitle: a.kpiDefinition.title,
    assignedToUnitId: a.assignedToUnitId,
    assignedToUnitName: a.assignedToUnit?.name ?? null,
    assignedToUserId: a.assignedToUserId,
    assignedToUserName: a.assignedToUser
      ? `${a.assignedToUser.firstName} ${a.assignedToUser.lastName}`
      : null,
    allocatedByUserId: a.allocatedByUserId,
    targetValue: a.targetValue,
    targetDate: a.targetDate,
    targetMilestone: a.targetMilestone,
    targetGrade: a.targetGrade,
    targetBoolean: a.targetBoolean,
    targetRating: a.targetRating,
    state: a.state,
    lockedAt: a.lockedAt,
    parentAllocationId: a.parentAllocationId,
    notes: a.notes,
    childCount: a._count.childAllocations,
    achievementCount: a._count.achievements,
    createdAt: a.createdAt,
  }));
}

// ── Create Allocation ────────────────────────────────────────────────────────

export async function createAllocation(
  tenantId: string,
  input: CreateAllocationInput,
  actorUserId: string,
  actorRole: Role
): Promise<KraKpiActionResult> {
  if (!isAdminOrOwner(actorRole)) {
    return { status: "error", message: "Insufficient permissions." };
  }

  const parsed = createAllocationSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;

  // Must assign to either unit or user
  if (!data.assignedToUnitId && !data.assignedToUserId) {
    return { status: "error", message: "Must assign to either a unit or a user." };
  }

  // Verify period
  const period = await prisma.assessmentPeriod.findFirst({
    where: { id: data.periodId, tenantId },
  });
  if (!period) {
    return { status: "error", message: "Period not found." };
  }
  if (period.state !== "OPEN" && period.state !== "IN_PROGRESS") {
    return {
      status: "error",
      message: `Cannot allocate targets in "${period.state}" period. Period must be OPEN or IN_PROGRESS.`,
    };
  }

  // Verify KPI
  const kpi = await prisma.kpiDefinition.findFirst({
    where: { id: data.kpiDefinitionId, kraDefinition: { tenantId } },
  });
  if (!kpi) {
    return { status: "error", message: "KPI not found." };
  }

  // Verify parent allocation if cascading
  if (data.parentAllocationId) {
    const parent = await prisma.targetAllocation.findFirst({
      where: { id: data.parentAllocationId, tenantId },
    });
    if (!parent) {
      return { status: "error", message: "Parent allocation not found." };
    }
  }

  await prisma.$transaction(async (tx) => {
    const allocation = await tx.targetAllocation.create({
      data: {
        tenantId,
        periodId: data.periodId,
        kpiDefinitionId: data.kpiDefinitionId,
        assignedToUnitId: data.assignedToUnitId,
        assignedToUserId: data.assignedToUserId,
        allocatedByUserId: actorUserId,
        targetValue: data.targetValue,
        targetDate: data.targetDate,
        targetMilestone: data.targetMilestone,
        targetGrade: data.targetGrade,
        targetBoolean: data.targetBoolean,
        targetRating: data.targetRating,
        parentAllocationId: data.parentAllocationId,
        notes: data.notes,
      },
    });

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "TargetAllocation",
        targetId: allocation.id,
        action: "CREATE",
        newState: {
          kpiDefinitionId: data.kpiDefinitionId,
          targetValue: data.targetValue,
          assignedToUnitId: data.assignedToUnitId,
          assignedToUserId: data.assignedToUserId,
        },
      },
    });
  });

  return { status: "success", message: "Target allocated successfully." };
}

// ── Update Allocation ────────────────────────────────────────────────────────

export async function updateAllocation(
  allocationId: string,
  tenantId: string,
  input: UpdateAllocationInput,
  actorUserId: string,
  actorRole: Role
): Promise<KraKpiActionResult> {
  if (!isAdminOrOwner(actorRole)) {
    return { status: "error", message: "Insufficient permissions." };
  }

  const parsed = updateAllocationSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;

  const allocation = await prisma.targetAllocation.findFirst({
    where: { id: allocationId, tenantId },
  });
  if (!allocation) {
    return { status: "error", message: "Allocation not found." };
  }

  if (allocation.state === "LOCKED") {
    return { status: "error", message: "Cannot update a locked allocation." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.targetAllocation.update({
      where: { id: allocationId },
      data: {
        ...(data.targetValue !== undefined && { targetValue: data.targetValue }),
        ...(data.targetDate !== undefined && { targetDate: data.targetDate }),
        ...(data.targetMilestone !== undefined && { targetMilestone: data.targetMilestone }),
        ...(data.targetGrade !== undefined && { targetGrade: data.targetGrade }),
        ...(data.targetBoolean !== undefined && { targetBoolean: data.targetBoolean }),
        ...(data.targetRating !== undefined && { targetRating: data.targetRating }),
        ...(data.notes !== undefined && { notes: data.notes }),
      },
    });

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "TargetAllocation",
        targetId: allocationId,
        action: "UPDATE",
        previousState: { targetValue: allocation.targetValue },
        newState: data as object,
      },
    });
  });

  return { status: "success", message: "Allocation updated." };
}

// ── Lock Target ──────────────────────────────────────────────────────────────

export async function lockTarget(
  allocationId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role
): Promise<KraKpiActionResult> {
  if (!isAdminOrOwner(actorRole)) {
    return { status: "error", message: "Insufficient permissions." };
  }

  const allocation = await prisma.targetAllocation.findFirst({
    where: { id: allocationId, tenantId },
  });
  if (!allocation) {
    return { status: "error", message: "Allocation not found." };
  }
  if (allocation.state === "LOCKED") {
    return { status: "error", message: "Already locked." };
  }

  await prisma.targetAllocation.update({
    where: { id: allocationId },
    data: { state: "LOCKED", lockedAt: new Date() },
  });

  return { status: "success", message: "Target locked." };
}

// ── Cascade Targets ──────────────────────────────────────────────────────────

/**
 * Split a parent allocation into child allocations.
 * For NUMERIC/CURRENCY: child target values must sum to parent.
 * For others: target value is replicated to each child.
 */
export async function cascadeTargets(
  parentAllocationId: string,
  tenantId: string,
  input: CascadeDistributionInput,
  actorUserId: string,
  actorRole: Role
): Promise<KraKpiActionResult> {
  if (!isAdminOrOwner(actorRole)) {
    return { status: "error", message: "Insufficient permissions." };
  }

  const parsed = cascadeDistributionSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { distributions } = parsed.data;

  const parent = await prisma.targetAllocation.findFirst({
    where: { id: parentAllocationId, tenantId },
    include: {
      kpiDefinition: { select: { measurementType: true, allocationType: true } },
    },
  });
  if (!parent) {
    return { status: "error", message: "Parent allocation not found." };
  }
  if (parent.state === "LOCKED") {
    return { status: "error", message: "Cannot cascade a locked allocation." };
  }

  const { measurementType, allocationType } = parent.kpiDefinition;

  // Validate allocation type allows individual assignment
  if (allocationType === "DEPARTMENT") {
    const hasUserAssignments = distributions.some((d) => d.assignedToUserId);
    if (hasUserAssignments) {
      return {
        status: "error",
        message: "This KPI's allocation type is DEPARTMENT — cannot assign to individuals.",
      };
    }
  }

  // For summable types, validate child values sum to parent
  if (SUMMABLE_TYPES.includes(measurementType) && parent.targetValue != null) {
    const childSum = distributions.reduce((sum, d) => sum + (d.targetValue ?? 0), 0);
    if (Math.abs(childSum - parent.targetValue) > 0.01) {
      return {
        status: "error",
        message: `Child target values must sum to parent (${parent.targetValue}). Current sum: ${childSum}.`,
      };
    }
  }

  await prisma.$transaction(async (tx) => {
    for (const dist of distributions) {
      await tx.targetAllocation.create({
        data: {
          tenantId,
          periodId: parent.periodId,
          kpiDefinitionId: parent.kpiDefinitionId,
          assignedToUnitId: dist.assignedToUnitId,
          assignedToUserId: dist.assignedToUserId,
          allocatedByUserId: actorUserId,
          targetValue: dist.targetValue ?? parent.targetValue,
          targetDate: dist.targetDate ?? parent.targetDate,
          targetMilestone: dist.targetMilestone ?? parent.targetMilestone,
          targetGrade: dist.targetGrade ?? parent.targetGrade,
          targetBoolean: dist.targetBoolean ?? parent.targetBoolean,
          targetRating: dist.targetRating ?? parent.targetRating,
          parentAllocationId: parentAllocationId,
          notes: dist.notes,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "TargetAllocation",
        targetId: parentAllocationId,
        action: "CASCADE",
        metadata: { childCount: distributions.length },
      },
    });
  });

  return {
    status: "success",
    message: `Target cascaded to ${distributions.length} allocation(s).`,
  };
}

// ── Delete Allocation ────────────────────────────────────────────────────────

export async function deleteAllocation(
  allocationId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role
): Promise<KraKpiActionResult> {
  if (!isAdminOrOwner(actorRole)) {
    return { status: "error", message: "Insufficient permissions." };
  }

  const allocation = await prisma.targetAllocation.findFirst({
    where: { id: allocationId, tenantId },
    include: {
      _count: { select: { achievements: true, childAllocations: true } },
    },
  });
  if (!allocation) {
    return { status: "error", message: "Allocation not found." };
  }

  if (allocation._count.achievements > 0) {
    return {
      status: "error",
      message: "Cannot delete allocation with recorded achievements.",
    };
  }

  if (allocation._count.childAllocations > 0) {
    return {
      status: "error",
      message: "Cannot delete allocation with child allocations. Delete children first.",
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.targetAllocation.delete({ where: { id: allocationId } });

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "TargetAllocation",
        targetId: allocationId,
        action: "DELETE",
        previousState: {
          kpiDefinitionId: allocation.kpiDefinitionId,
          targetValue: allocation.targetValue,
        },
      },
    });
  });

  return { status: "success", message: "Allocation deleted." };
}
