import { Prisma, type Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getMyKpiContext } from "./my-kpi-service";
import { canRecord } from "./assignee-access";
import type { StageProgressView } from "./shared";
import { createNotification } from "@/lib/notifications/notification-service";

const tenantOwnerRole = "TENANT_OWNER" satisfies Role;
const tenantAdminRole = "TENANT_ADMIN" satisfies Role;

function isAdminOrOwner(role: Role): boolean {
  return (
    role === tenantOwnerRole ||
    role === tenantAdminRole ||
    role === "SUPERADMIN"
  );
}

const evidenceFileSchema = z.object({
  name: z.string().min(1).max(500),
  url: z.string().url().max(2000),
  type: z.string().min(1).max(50),
});

const markCompleteSchema = z.object({
  notes: z.string().trim().max(2000).optional(),
  evidenceFiles: z.array(evidenceFileSchema).max(20).optional(),
});

export type MarkStageCompleteInput = z.infer<typeof markCompleteSchema>;

export type StageProgressResult = { ok: true } | { ok: false; message: string };

export async function initializeStageProgress(
  achievementId: string,
  targetAllocationId: string,
  kpiId: string,
): Promise<void> {
  const stages = await prisma.kpiStageDefinition.findMany({
    where: { kpiDefinitionId: kpiId },
    orderBy: { stageOrder: "asc" },
    select: { id: true },
  });
  if (stages.length === 0) return;

  await prisma.kpiStageProgress.createMany({
    data: stages.map((s) => ({
      targetAllocationId,
      stageDefinitionId: s.id,
      achievementId,
    })),
  });
}

function evidenceTypesMatchStage(
  required: string[],
  files: { type: string }[],
): boolean {
  if (required.length === 0) return files.length > 0;
  return files.every((f) => required.includes(f.type));
}

export async function markStageComplete(
  progressId: string,
  tenantId: string,
  input: MarkStageCompleteInput,
  actorUserId: string,
  actorRole: Role,
): Promise<StageProgressResult> {
  const parsed = markCompleteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;

  const progress = await prisma.kpiStageProgress.findFirst({
    where: { id: progressId, targetAllocation: { tenantId } },
    include: {
      stageDefinition: true,
      achievement: {
        include: {
          targetAllocation: {
            include: { _count: { select: { childAllocations: true } } },
          },
          kpiDefinition: { select: { allocationType: true } },
        },
      },
      targetAllocation: {
        include: {
          period: { select: { state: true } },
          _count: { select: { childAllocations: true } },
        },
      },
    },
  });

  if (!progress || !progress.achievementId || !progress.achievement) {
    return { ok: false, message: "Progress record not found." };
  }

  const ach = progress.achievement;
  if (ach.tenantId !== tenantId) {
    return { ok: false, message: "Progress record not found." };
  }
  if (ach.state !== "DRAFT") {
    return { ok: false, message: "Stages can only be updated while the achievement is in draft." };
  }

  const periodState = progress.targetAllocation.period.state;
  if (periodState !== "IN_PROGRESS") {
    return { ok: false, message: "Submissions are closed for this period." };
  }

  if (ach.reportedByUserId !== actorUserId && !isAdminOrOwner(actorRole)) {
    const ctx = await getMyKpiContext(tenantId, actorUserId);
    const alloc = ach.targetAllocation;
    if (!alloc) {
      return { ok: false, message: "Only the reporter can update stage progress." };
    }
    const allowed = canRecord(
      {
        assignedToUnitId: alloc.assignedToUnitId,
        assignedToUserId: alloc.assignedToUserId,
        allocationType: ach.kpiDefinition.allocationType,
        state: alloc.state,
        childCount: alloc._count.childAllocations,
        parentAllocationId: alloc.parentAllocationId,
      },
      ctx,
      periodState,
    );
    if (!allowed) {
      return { ok: false, message: "Only the allocated employee can mark this stage complete." };
    }
  }

  const stage = progress.stageDefinition;
  const files = data.evidenceFiles ?? [];

  if (stage.evidenceRequired) {
    if (files.length === 0) {
      return { ok: false, message: "Evidence is required for this stage." };
    }
    const allowedTypes = stage.evidenceTypes as string[];
    if (!evidenceTypesMatchStage(allowedTypes, files)) {
      return {
        ok: false,
        message: "Each evidence file type must match one of the allowed types for this stage.",
      };
    }
  }

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.kpiStageProgress.update({
      where: { id: progressId },
      data: {
        isCompleted: true,
        completedAt: now,
        completedByUserId: actorUserId,
        notes: data.notes ?? null,
        evidenceFiles: files.length > 0 ? (files as object[]) : undefined,
      },
    });

    await calculateStageScore(ach.id, tx);

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "KpiStageProgress",
        targetId: progressId,
        action: "STAGE_COMPLETE",
        newState: { achievementId: ach.id, stageDefinitionId: stage.id },
      },
    });
  });

  if (stage.deadline && now > stage.deadline) {
    await createNotification(
      tenantId,
      ach.reportedByUserId,
      "STAGE_DEADLINE_OVERDUE",
      undefined,
      "Stage completed after deadline",
      `You completed "${stage.title}" after its deadline.`,
      "KpiStageProgress",
      progressId,
      "/my-kpis",
    );
  }

  return { ok: true };
}

type DbClient = Prisma.TransactionClient | typeof prisma;

export async function calculateStageScore(
  achievementId: string,
  tx: DbClient = prisma,
): Promise<{ stageCompletionScore: number; effectiveScore: number | null }> {
  const achievement = await tx.achievement.findFirst({
    where: { id: achievementId },
    select: {
      kpiDefinition: {
        select: {
          id: true,
          stages: { select: { id: true, weight: true } },
        },
      },
    },
  });

  if (!achievement) {
    return { stageCompletionScore: 0, effectiveScore: null };
  }

  const stageIds = achievement.kpiDefinition.stages.map((s) => s.id);
  const weightByStage = new Map(achievement.kpiDefinition.stages.map((s) => [s.id, s.weight]));

  if (stageIds.length === 0) {
    return { stageCompletionScore: 0, effectiveScore: null };
  }

  const completed = await tx.kpiStageProgress.findMany({
    where: {
      achievementId,
      isCompleted: true,
      stageDefinitionId: { in: stageIds },
    },
    select: { stageDefinitionId: true },
  });

  let stageCompletionScore = 0;
  for (const row of completed) {
    stageCompletionScore += weightByStage.get(row.stageDefinitionId) ?? 0;
  }

  const effectiveScore = stageCompletionScore;

  await tx.achievement.update({
    where: { id: achievementId },
    data: { stageCompletionScore, effectiveScore },
  });

  return { stageCompletionScore, effectiveScore };
}

export async function unmarkStageComplete(
  progressId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role,
): Promise<StageProgressResult> {
  const progress = await prisma.kpiStageProgress.findFirst({
    where: { id: progressId, targetAllocation: { tenantId } },
    include: {
      achievement: { select: { id: true, state: true, reportedByUserId: true } },
    },
  });
  if (!progress?.achievement) {
    return { ok: false, message: "Progress record not found." };
  }

  if (progress.achievement.state !== "DRAFT") {
    return { ok: false, message: "Cannot undo stage completion after submit." };
  }

  if (progress.achievement.reportedByUserId !== actorUserId && !isAdminOrOwner(actorRole)) {
    return { ok: false, message: "Only the reporter can undo stage completion." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.kpiStageProgress.update({
      where: { id: progressId },
      data: {
        isCompleted: false,
        completedAt: null,
        completedByUserId: null,
        notes: null,
        evidenceFiles: Prisma.DbNull,
      },
    });

    await calculateStageScore(progress.achievement!.id, tx);

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "KpiStageProgress",
        targetId: progressId,
        action: "STAGE_UNCOMPLETE",
        newState: { achievementId: progress.achievement!.id },
      },
    });
  });

  return { ok: true };
}

export async function getStageProgressForAchievement(
  achievementId: string,
  tenantId: string,
): Promise<StageProgressView[]> {
  const achievement = await prisma.achievement.findFirst({
    where: { id: achievementId, tenantId },
    select: { id: true, targetAllocationId: true, kpiDefinitionId: true },
  });
  if (!achievement?.targetAllocationId) return [];

  const rows = await prisma.kpiStageProgress.findMany({
    where: { achievementId, targetAllocationId: achievement.targetAllocationId },
    include: { stageDefinition: true },
    orderBy: { stageDefinition: { stageOrder: "asc" } },
  });

  const completedByIds = [
    ...new Set(
      rows
        .map((row) => row.completedByUserId)
        .filter((userId): userId is string => Boolean(userId)),
    ),
  ];
  const completedByUsers =
    completedByIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: completedByIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
  const completedByNameMap = new Map(
    completedByUsers.map((user) => [user.id, `${user.firstName} ${user.lastName}`]),
  );

  const now = new Date();

  return rows.map((r) => {
    const d = r.stageDefinition;
    const deadline = d.deadline;
    const isOverdue = !!(deadline && !r.isCompleted && now > deadline);
    let daysRemaining: number | null = null;
    if (deadline && !r.isCompleted) {
      daysRemaining = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    }

    const rawFiles = r.evidenceFiles as unknown;
    const evidenceFiles = Array.isArray(rawFiles)
      ? (rawFiles as StageProgressView["evidenceFiles"])
      : null;

    return {
      progressId: r.id,
      stageDefinitionId: d.id,
      stageOrder: d.stageOrder,
      title: d.title,
      description: d.description,
      weight: d.weight,
      isMandatory: d.isMandatory,
      evidenceRequired: d.evidenceRequired,
      evidenceTypes: d.evidenceTypes as string[],
      evidenceInstructions: d.evidenceInstructions,
      deadline: d.deadline,
      isCompleted: r.isCompleted,
      completedAt: r.completedAt,
      completedByUserId: r.completedByUserId,
      completedByName:
        r.completedByUserId != null
          ? (completedByNameMap.get(r.completedByUserId) ?? null)
          : null,
      notes: r.notes,
      evidenceFiles,
      isOverdue,
      daysRemaining,
    };
  });
}

export async function getStageProgressSummary(
  targetAllocationId: string,
  tenantId: string,
): Promise<
  Array<{
    achievementId: string;
    title: string | null;
    completedStages: number;
    totalStages: number;
    completionPercent: number;
    stageScore: number;
    totalWeight: number;
  }>
> {
  const allocation = await prisma.targetAllocation.findFirst({
    where: { id: targetAllocationId, tenantId },
    include: {
      kpiDefinition: {
        select: {
          stages: { select: { id: true, weight: true } },
        },
      },
      achievements: {
        select: { id: true, title: true, stageCompletionScore: true },
      },
    },
  });
  if (!allocation) return [];

  const stages = allocation.kpiDefinition.stages;
  const totalWeight = stages.reduce((s, x) => s + x.weight, 0);
  const totalStages = stages.length;
  if (totalStages === 0) return [];

  const stageIds = new Set(stages.map((s) => s.id));

  const result: Array<{
    achievementId: string;
    title: string | null;
    completedStages: number;
    totalStages: number;
    completionPercent: number;
    stageScore: number;
    totalWeight: number;
  }> = [];

  for (const ach of allocation.achievements) {
    const completed = await prisma.kpiStageProgress.count({
      where: {
        achievementId: ach.id,
        isCompleted: true,
        stageDefinitionId: { in: [...stageIds] },
      },
    });
    const stageScore = ach.stageCompletionScore ?? 0;
    result.push({
      achievementId: ach.id,
      title: ach.title,
      completedStages: completed,
      totalStages,
      completionPercent:
        totalStages > 0 ? Math.round((completed / totalStages) * 10000) / 100 : 0,
      stageScore,
      totalWeight,
    });
  }

  return result;
}
