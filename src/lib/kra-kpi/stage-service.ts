import type { Role, EvidenceType } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { KpiStageView } from "./shared";

const tenantOwnerRole = "TENANT_OWNER" satisfies Role;
const tenantAdminRole = "TENANT_ADMIN" satisfies Role;

function isAdminOrOwner(role: Role): boolean {
  return (
    role === tenantOwnerRole ||
    role === tenantAdminRole ||
    role === "SUPERADMIN"
  );
}

const evidenceTypeEnum = z.enum([
  "DOCUMENT",
  "URL",
  "CERTIFICATE",
  "SELF_DECLARATION",
  "SYSTEM_GENERATED",
  "NONE",
]);

export const createStageInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(500).optional(),
  stageOrder: z.number().int().min(1).optional(),
  weight: z.number().min(0),
  isMandatory: z.boolean().optional(),
  evidenceRequired: z.boolean().optional(),
  evidenceTypes: z.array(evidenceTypeEnum).optional(),
  evidenceInstructions: z.string().trim().max(2000).optional(),
  deadline: z.coerce.date().optional(),
  gracePeriodDays: z.number().int().min(0).default(0).optional(),
  latePenaltyEnabled: z.boolean().default(false).optional(),
  latePenaltyPercentPerDay: z.number().min(0).max(100).default(0).optional(),
});

export const updateStageInputSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  weight: z.number().min(0).optional(),
  isMandatory: z.boolean().optional(),
  evidenceRequired: z.boolean().optional(),
  evidenceTypes: z.array(evidenceTypeEnum).optional(),
  evidenceInstructions: z.string().trim().max(2000).nullable().optional(),
  deadline: z.coerce.date().nullable().optional(),
  gracePeriodDays: z.number().int().min(0).default(0).optional(),
  latePenaltyEnabled: z.boolean().default(false).optional(),
  latePenaltyPercentPerDay: z.number().min(0).max(100).default(0).optional(),
});

export type CreateStageInput = z.infer<typeof createStageInputSchema>;
export type UpdateStageInput = z.infer<typeof updateStageInputSchema>;

export type StageServiceResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; message: string; code?: string };

async function getKpiForStages(
  kpiId: string,
  tenantId: string,
): Promise<{
  id: string;
  state: string;
  kraDefinition: { periodId: string; tenantId: string; period: { startDate: Date; endDate: Date } };
} | null> {
  return prisma.kpiDefinition.findFirst({
    where: { id: kpiId, kraDefinition: { tenantId } },
    select: {
      id: true,
      state: true,
      kraDefinition: {
        select: {
          periodId: true,
          tenantId: true,
          period: { select: { startDate: true, endDate: true } },
        },
      },
    },
  });
}

export async function createStage(
  kpiId: string,
  tenantId: string,
  input: CreateStageInput,
  actorUserId: string,
  actorRole: Role,
): Promise<StageServiceResult<{ id: string }>> {
  if (!isAdminOrOwner(actorRole)) {
    return { ok: false, message: "Insufficient permissions.", code: "FORBIDDEN" };
  }

  const parsed = createStageInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;

  const kpi = await getKpiForStages(kpiId, tenantId);
  if (!kpi) return { ok: false, message: "KPI not found." };
  if (kpi.state === "ARCHIVED") {
    return { ok: false, message: "Cannot add stages to an archived KPI." };
  }

  if (data.evidenceRequired && (!data.evidenceTypes || data.evidenceTypes.length === 0)) {
    return {
      ok: false,
      message: "Select at least one evidence type when evidence is required for this stage.",
    };
  }

  const { startDate, endDate } = kpi.kraDefinition.period;
  if (data.deadline) {
    if (data.deadline < startDate || data.deadline > endDate) {
      return {
        ok: false,
        message: "Stage deadline must fall within the assessment period.",
      };
    }
  }

  let stageOrder = data.stageOrder;
  if (stageOrder == null) {
    const max = await prisma.kpiStageDefinition.aggregate({
      where: { kpiDefinitionId: kpiId },
      _max: { stageOrder: true },
    });
    stageOrder = (max._max.stageOrder ?? 0) + 1;
  }

  const existingOrder = await prisma.kpiStageDefinition.findFirst({
    where: { kpiDefinitionId: kpiId, stageOrder },
  });
  if (existingOrder) {
    return { ok: false, message: `Stage order ${stageOrder} is already used for this KPI.` };
  }

  const stage = await prisma.$transaction(async (tx) => {
    const s = await tx.kpiStageDefinition.create({
      data: {
        kpiDefinitionId: kpiId,
        stageOrder,
        title: data.title,
        description: data.description,
        weight: data.weight,
        isMandatory: data.isMandatory ?? true,
        evidenceRequired: data.evidenceRequired ?? false,
        evidenceTypes: (data.evidenceTypes ?? []) as EvidenceType[],
        evidenceInstructions: data.evidenceInstructions,
        deadline: data.deadline,
        gracePeriodDays: data.gracePeriodDays ?? 0,
        latePenaltyEnabled: data.latePenaltyEnabled ?? false,
        latePenaltyPercentPerDay: data.latePenaltyPercentPerDay ?? 0,
      },
    });

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "KpiStageDefinition",
        targetId: s.id,
        action: "CREATE",
        newState: { kpiDefinitionId: kpiId, stageOrder, title: data.title },
      },
    });

    return s;
  });

  return { ok: true, data: { id: stage.id }, message: "Stage created." };
}

export async function updateStage(
  stageId: string,
  kpiId: string,
  tenantId: string,
  input: UpdateStageInput,
  actorUserId: string,
  actorRole: Role,
): Promise<StageServiceResult> {
  if (!isAdminOrOwner(actorRole)) {
    return { ok: false, message: "Insufficient permissions.", code: "FORBIDDEN" };
  }

  const parsed = updateStageInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;

  const stage = await prisma.kpiStageDefinition.findFirst({
    where: { id: stageId, kpiDefinitionId: kpiId, kpiDefinition: { kraDefinition: { tenantId } } },
    include: { kpiDefinition: { select: { state: true, kraDefinition: { select: { period: true } } } } },
  });
  if (!stage) return { ok: false, message: "Stage not found." };
  if (stage.kpiDefinition.state === "ARCHIVED") {
    return { ok: false, message: "Cannot edit stages on an archived KPI." };
  }

  const evidenceRequired = data.evidenceRequired ?? stage.evidenceRequired;
  const nextTypes = data.evidenceTypes ?? stage.evidenceTypes;
  if (evidenceRequired && nextTypes.length === 0) {
    return {
      ok: false,
      message: "Select at least one evidence type when evidence is required for this stage.",
    };
  }

  const period = stage.kpiDefinition.kraDefinition.period;
  const nextDeadline = data.deadline !== undefined ? data.deadline : stage.deadline;
  if (nextDeadline) {
    if (nextDeadline < period.startDate || nextDeadline > period.endDate) {
      return {
        ok: false,
        message: "Stage deadline must fall within the assessment period.",
      };
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.kpiStageDefinition.update({
      where: { id: stageId },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.weight !== undefined && { weight: data.weight }),
        ...(data.isMandatory !== undefined && { isMandatory: data.isMandatory }),
        ...(data.evidenceRequired !== undefined && { evidenceRequired: data.evidenceRequired }),
        ...(data.evidenceTypes !== undefined && {
          evidenceTypes: data.evidenceTypes as EvidenceType[],
        }),
        ...(data.evidenceInstructions !== undefined && {
          evidenceInstructions: data.evidenceInstructions,
        }),
        ...(data.deadline !== undefined && { deadline: data.deadline }),
        ...(data.gracePeriodDays !== undefined && { gracePeriodDays: data.gracePeriodDays }),
        ...(data.latePenaltyEnabled !== undefined && { latePenaltyEnabled: data.latePenaltyEnabled }),
        ...(data.latePenaltyPercentPerDay !== undefined && { latePenaltyPercentPerDay: data.latePenaltyPercentPerDay }),
      },
    });

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "KpiStageDefinition",
        targetId: stageId,
        action: "UPDATE",
        newState: data as object,
      },
    });
  });

  return { ok: true, message: "Stage updated." };
}

export async function deleteStage(
  stageId: string,
  kpiId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role,
): Promise<StageServiceResult> {
  if (!isAdminOrOwner(actorRole)) {
    return { ok: false, message: "Insufficient permissions.", code: "FORBIDDEN" };
  }

  const stage = await prisma.kpiStageDefinition.findFirst({
    where: { id: stageId, kpiDefinitionId: kpiId, kpiDefinition: { kraDefinition: { tenantId } } },
  });
  if (!stage) return { ok: false, message: "Stage not found." };

  const completed = await prisma.kpiStageProgress.count({
    where: { stageDefinitionId: stageId, isCompleted: true },
  });
  if (completed > 0) {
    return {
      ok: false,
      message:
        "Stage has completed progress records. Delete progress first or archive the stage.",
      code: "CONFLICT",
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.kpiStageProgress.deleteMany({ where: { stageDefinitionId: stageId } });
    await tx.kpiStageDefinition.delete({ where: { id: stageId } });

    const remaining = await tx.kpiStageDefinition.findMany({
      where: { kpiDefinitionId: kpiId },
      orderBy: { stageOrder: "asc" },
      select: { id: true },
    });
    for (let i = 0; i < remaining.length; i++) {
      await tx.kpiStageDefinition.update({
        where: { id: remaining[i].id },
        data: { stageOrder: i + 1 },
      });
    }

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "KpiStageDefinition",
        targetId: stageId,
        action: "DELETE",
        previousState: { title: stage.title },
      },
    });
  });

  return { ok: true, message: "Stage deleted." };
}

export async function listStages(
  kpiId: string,
  tenantId: string,
): Promise<KpiStageView[]> {
  const kpi = await prisma.kpiDefinition.findFirst({
    where: { id: kpiId, kraDefinition: { tenantId } },
    select: { id: true },
  });
  if (!kpi) return [];

  const stages = await prisma.kpiStageDefinition.findMany({
    where: { kpiDefinitionId: kpiId },
    orderBy: { stageOrder: "asc" },
  });

  const counts = await prisma.kpiStageProgress.groupBy({
    by: ["stageDefinitionId"],
    where: {
      stageDefinitionId: { in: stages.map((s) => s.id) },
      isCompleted: true,
    },
    _count: { _all: true },
  });
  const countMap = new Map(counts.map((c) => [c.stageDefinitionId, c._count._all]));

  return stages.map((s) => ({
    id: s.id,
    kpiDefinitionId: s.kpiDefinitionId,
    stageOrder: s.stageOrder,
    title: s.title,
    description: s.description,
    isMandatory: s.isMandatory,
    weight: s.weight,
    evidenceRequired: s.evidenceRequired,
    evidenceTypes: s.evidenceTypes as string[],
    evidenceInstructions: s.evidenceInstructions,
    deadline: s.deadline,
    gracePeriodDays: s.gracePeriodDays,
    latePenaltyEnabled: s.latePenaltyEnabled,
    latePenaltyPercentPerDay: s.latePenaltyPercentPerDay,
    completedProgressCount: countMap.get(s.id) ?? 0,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  }));
}

export async function reorderStages(
  kpiId: string,
  tenantId: string,
  orderedIds: string[],
  actorUserId: string,
  actorRole: Role,
): Promise<StageServiceResult> {
  if (!isAdminOrOwner(actorRole)) {
    return { ok: false, message: "Insufficient permissions.", code: "FORBIDDEN" };
  }

  const kpi = await prisma.kpiDefinition.findFirst({
    where: { id: kpiId, kraDefinition: { tenantId } },
    select: { id: true },
  });
  if (!kpi) return { ok: false, message: "KPI not found." };

  const existing = await prisma.kpiStageDefinition.findMany({
    where: { kpiDefinitionId: kpiId },
    select: { id: true },
  });
  const idSet = new Set(existing.map((e) => e.id));
  if (orderedIds.length !== idSet.size || orderedIds.some((id) => !idSet.has(id))) {
    return { ok: false, message: "Ordered IDs must match all stages for this KPI exactly." };
  }

  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx.kpiStageDefinition.update({
        where: { id: orderedIds[i] },
        data: { stageOrder: i + 1 },
      });
    }
    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "KpiDefinition",
        targetId: kpiId,
        action: "REORDER_STAGES",
        newState: { orderedIds },
      },
    });
  });

  return { ok: true, message: "Stages reordered." };
}

export async function getStageWeightSummary(
  kpiId: string,
  tenantId: string,
): Promise<{ totalWeight: number; stages: { title: string; weight: number; percentage: number }[] }> {
  const stages = await listStages(kpiId, tenantId);
  const totalWeight = stages.reduce((s, x) => s + x.weight, 0);
  const denom = totalWeight > 0 ? totalWeight : 1;
  return {
    totalWeight,
    stages: stages.map((st) => ({
      title: st.title,
      weight: st.weight,
      percentage: Math.round((st.weight / denom) * 10000) / 100,
    })),
  };
}
