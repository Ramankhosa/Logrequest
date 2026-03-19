import type { Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canRecord } from "./assignee-access";
import { getMyKpiContext } from "./my-kpi-service";
import { getUserAssignments } from "@/lib/org-structure/roles-service";
import { computeReviewCycles } from "./period-service";
import type {
  KraKpiActionResult,
  AchievementView,
  VerificationLogEntry,
  AchievementFormConfig,
} from "./shared";
import { computeScore } from "./scoring-service";
import type { MeasurementConfig, ScoringConfig } from "./shared";
import { buildFormDataValidator } from "./shared";
import {
  createNotification,
  resolveUnitHead,
} from "@/lib/notifications/notification-service";

// ── Constants ────────────────────────────────────────────────────────────────

const tenantOwnerRole = "TENANT_OWNER" satisfies Role;
const tenantAdminRole = "TENANT_ADMIN" satisfies Role;

// ── Schemas ──────────────────────────────────────────────────────────────────

const createAchievementSchema = z.object({
  periodId: z.string().trim().min(1),
  kpiDefinitionId: z.string().trim().min(1),
  targetAllocationId: z.string().trim().min(1).optional(),
  actualValue: z.number().optional(),
  actualDate: z.coerce.date().optional(),
  actualMilestone: z.enum(["NOT_STARTED", "IN_PROGRESS", "COMPLETED"]).optional(),
  actualGrade: z
    .enum(["OUTSTANDING", "VERY_GOOD", "GOOD", "SATISFACTORY", "NEEDS_IMPROVEMENT", "POOR"])
    .optional(),
  actualBoolean: z.boolean().optional(),
  actualRating: z.number().int().min(1).max(10).optional(),
  evidenceDescription: z.string().trim().max(2000).optional(),
  evidenceLinks: z.array(z.string().url()).max(10).default([]),
  achievementFormData: z.record(z.string(), z.unknown()).optional(),
  reportingDate: z.coerce.date().optional(),
});

const updateAchievementSchema = z.object({
  actualValue: z.number().optional(),
  actualDate: z.coerce.date().optional(),
  actualMilestone: z.enum(["NOT_STARTED", "IN_PROGRESS", "COMPLETED"]).optional(),
  actualGrade: z
    .enum(["OUTSTANDING", "VERY_GOOD", "GOOD", "SATISFACTORY", "NEEDS_IMPROVEMENT", "POOR"])
    .optional(),
  actualBoolean: z.boolean().optional(),
  actualRating: z.number().int().min(1).max(10).optional(),
  evidenceDescription: z.string().trim().max(2000).nullable().optional(),
  evidenceLinks: z.array(z.string().url()).max(10).optional(),
  achievementFormData: z.record(z.string(), z.unknown()).optional(),
});

export type CreateAchievementInput = z.input<typeof createAchievementSchema>;
export type UpdateAchievementInput = z.input<typeof updateAchievementSchema>;

// ── Helpers ──────────────────────────────────────────────────────────────────

function isAdminOrOwner(role: Role): boolean {
  return (
    role === tenantOwnerRole ||
    role === tenantAdminRole ||
    role === "SUPERADMIN"
  );
}

function hasConfiguredTarget(allocation: {
  targetValue?: number | null;
  targetDate?: Date | null;
  targetMilestone?: string | null;
  targetGrade?: string | null;
  targetBoolean?: boolean | null;
  targetRating?: number | null;
} | null): boolean {
  if (!allocation) return false;

  return (
    allocation.targetValue != null ||
    allocation.targetDate != null ||
    allocation.targetMilestone != null ||
    allocation.targetGrade != null ||
    allocation.targetBoolean != null ||
    allocation.targetRating != null
  );
}

function validateAchievementFormData(
  formConfig: AchievementFormConfig | null,
  formData: Record<string, unknown> | undefined,
): string | null {
  if (!formConfig) return null;

  const validator = buildFormDataValidator(formConfig.fields);
  const parsed = validator.safeParse(formData ?? {});
  if (parsed.success) {
    return null;
  }

  return parsed.error.issues[0]?.message ?? "Invalid form data.";
}

function findCycleNumberForDate(
  reportingDate: Date,
  period: { startDate: Date; endDate: Date; reviewFrequency: string },
): number {
  const cycles = computeReviewCycles(
    period.startDate,
    period.endDate,
    period.reviewFrequency,
  );
  const cycle = cycles.find(
    (item) =>
      reportingDate >= item.startDate &&
      (reportingDate < item.endDate ||
        reportingDate.getTime() === item.endDate.getTime()),
  );

  return cycle?.cycleNumber ?? 1;
}

async function getAchievementAssigneeUnitIds(
  tenantId: string,
  achievement: {
    reportedByUserId: string;
    targetAllocation: {
      assignedToUnitId: string | null;
      assignedToUserId: string | null;
    } | null;
  },
): Promise<string[]> {
  const unitIds = new Set<string>();

  if (achievement.targetAllocation?.assignedToUnitId) {
    unitIds.add(achievement.targetAllocation.assignedToUnitId);
  }

  const assigneeUserId =
    achievement.targetAllocation?.assignedToUserId ?? achievement.reportedByUserId;
  const assignments = await getUserAssignments(tenantId, assigneeUserId);
  for (const assignment of assignments) {
    unitIds.add(assignment.unitId);
  }

  return [...unitIds];
}

async function canActorRecommendAchievement(
  tenantId: string,
  actorUserId: string,
  achievement: {
    reportedByUserId: string;
    targetAllocation: {
      assignedToUnitId: string | null;
      assignedToUserId: string | null;
    } | null;
  },
): Promise<boolean> {
  const context = await getMyKpiContext(tenantId, actorUserId);
  if (context.headOfUnits.length === 0) {
    return false;
  }

  const headUnitIds = new Set(context.headOfUnits.map((unit) => unit.unitId));
  const assigneeUnitIds = await getAchievementAssigneeUnitIds(tenantId, achievement);

  return assigneeUnitIds.some((unitId) => headUnitIds.has(unitId));
}

async function canActorVerifyAchievement(
  tenantId: string,
  actorUserId: string,
  startingUnitId: string,
): Promise<boolean> {
  const context = await getMyKpiContext(tenantId, actorUserId);

  return context.headOfUnits.some((unit) => unit.unitId === startingUnitId);
}

async function usesSameDepartmentShortcut(
  tenantId: string,
  achievement: {
    reportedByUserId: string;
    kpiDefinition: { startingUnitId: string };
    targetAllocation: {
      assignedToUnitId: string | null;
      assignedToUserId: string | null;
    } | null;
  },
): Promise<boolean> {
  const assigneeUnitIds = await getAchievementAssigneeUnitIds(tenantId, achievement);

  return assigneeUnitIds.includes(achievement.kpiDefinition.startingUnitId);
}

function mapAchievementView(
  a: NonNullable<Awaited<ReturnType<typeof prisma.achievement.findFirst>>> & {
    kpiDefinition: { title: string };
  },
  reportedByUserName: string
): AchievementView {
  return {
    id: a.id,
    tenantId: a.tenantId,
    periodId: a.periodId,
    kpiDefinitionId: a.kpiDefinitionId,
    kpiTitle: a.kpiDefinition.title,
    targetAllocationId: a.targetAllocationId,
    reportedByUserId: a.reportedByUserId,
    reportedByUserName,
    actualValue: a.actualValue,
    actualDate: a.actualDate,
    actualMilestone: a.actualMilestone,
    actualGrade: a.actualGrade,
    actualBoolean: a.actualBoolean,
    actualRating: a.actualRating,
    evidenceDescription: a.evidenceDescription,
    evidenceLinks: a.evidenceLinks,
    achievementFormData: a.achievementFormData as Record<string, unknown> | null,
    computedScore: a.computedScore,
    state: a.state,
    recommendedByUserId: a.recommendedByUserId,
    recommendedAt: a.recommendedAt,
    recommendationNote: a.recommendationNote,
    verifiedByUserId: a.verifiedByUserId,
    verifiedAt: a.verifiedAt,
    verificationNote: a.verificationNote,
    rejectionReason: a.rejectionReason,
    verificationLog: (a.verificationLog as VerificationLogEntry[]) ?? [],
    reportingDate: a.reportingDate,
    createdAt: a.createdAt,
  };
}

// ── List Achievements ────────────────────────────────────────────────────────

export async function listAchievements(
  tenantId: string,
  filters: {
    periodId?: string;
    kpiDefinitionId?: string;
    targetAllocationId?: string;
    reportedByUserId?: string;
    state?: string;
  } = {}
): Promise<AchievementView[]> {
  const achievements = await prisma.achievement.findMany({
    where: {
      tenantId,
      ...(filters.periodId && { periodId: filters.periodId }),
      ...(filters.kpiDefinitionId && { kpiDefinitionId: filters.kpiDefinitionId }),
      ...(filters.targetAllocationId && { targetAllocationId: filters.targetAllocationId }),
      ...(filters.reportedByUserId && { reportedByUserId: filters.reportedByUserId }),
      ...(filters.state && { state: filters.state as "DRAFT" | "SUBMITTED" | "RECOMMENDED" | "VERIFIED" | "REJECTED" }),
    },
    include: {
      kpiDefinition: { select: { title: true } },
    },
    orderBy: { reportingDate: "desc" },
  });

  // Batch fetch user names
  const userIds = [...new Set(achievements.map((a) => a.reportedByUserId))];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, firstName: true, lastName: true },
  });
  const userMap = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));

  return achievements.map((a) =>
    mapAchievementView(a, userMap.get(a.reportedByUserId) ?? "Unknown")
  );
}

// ── Record Achievement ───────────────────────────────────────────────────────

export async function recordAchievement(
  tenantId: string,
  input: CreateAchievementInput,
  actorUserId: string,
  actorRole: Role
): Promise<KraKpiActionResult> {
  const parsed = createAchievementSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;
  const reportingDate = data.reportingDate ?? new Date();

  // Verify period
  const period = await prisma.assessmentPeriod.findFirst({
    where: { id: data.periodId, tenantId },
    select: {
      id: true,
      state: true,
      startDate: true,
      endDate: true,
      reviewFrequency: true,
    },
  });
  if (!period) {
    return { status: "error", message: "Period not found." };
  }
  if (period.state !== "IN_PROGRESS" && period.state !== "UNDER_REVIEW") {
    return {
      status: "error",
      message: `Cannot record achievements in "${period.state}" period.`,
    };
  }

  // Verify KPI
  const kpi = await prisma.kpiDefinition.findFirst({
    where: { id: data.kpiDefinitionId, kraDefinition: { tenantId } },
    include: {
      kraDefinition: {
        select: { state: true },
      },
    },
  });
  if (!kpi) {
    return { status: "error", message: "KPI not found." };
  }
  if (kpi.state !== "ACTIVE") {
    return { status: "error", message: "Cannot record achievements for a KPI that is not ACTIVE." };
  }
  if (kpi.kraDefinition.state !== "ACTIVE") {
    return { status: "error", message: "Cannot record achievements while the parent KRA is not ACTIVE." };
  }

  // Verify target allocation if provided
  let allocation:
    | (Awaited<ReturnType<typeof prisma.targetAllocation.findFirst>> & {
        _count: { childAllocations: number };
      })
    | null = null;
  if (data.targetAllocationId) {
    allocation = await prisma.targetAllocation.findFirst({
      where: { id: data.targetAllocationId, tenantId },
      include: {
        _count: { select: { childAllocations: true } },
      },
    });
    if (!allocation) {
      return { status: "error", message: "Target allocation not found." };
    }
    if (
      allocation.periodId !== data.periodId ||
      allocation.kpiDefinitionId !== data.kpiDefinitionId
    ) {
      return {
        status: "error",
        message: "Target allocation does not match the selected period or KPI.",
      };
    }
  }

  if (!allocation && !isAdminOrOwner(actorRole)) {
    return {
      status: "error",
      message: "Assignee achievements must be recorded against a target allocation.",
    };
  }

  if (allocation && !hasConfiguredTarget(allocation)) {
    return {
      status: "error",
      message: "Target not set yet. Achievement recording is disabled.",
    };
  }

  if (allocation && !isAdminOrOwner(actorRole)) {
    const context = await getMyKpiContext(tenantId, actorUserId);
    const allowed = canRecord(
      {
        assignedToUnitId: allocation.assignedToUnitId,
        assignedToUserId: allocation.assignedToUserId,
        allocationType: kpi.allocationType,
        state: allocation.state,
        childCount: allocation._count.childAllocations,
        parentAllocationId: allocation.parentAllocationId,
      },
      context,
      period.state,
    );
    if (!allowed) {
      return {
        status: "error",
        message: "You are not allowed to record an achievement for this allocation.",
      };
    }
  }

  // Duplicate prevention: only one achievement per allocation per review cycle
  if (data.targetAllocationId) {
    const newCycleNumber = findCycleNumberForDate(reportingDate, period);
    const existingAchievements = await prisma.achievement.findMany({
      where: {
        targetAllocationId: data.targetAllocationId,
        periodId: data.periodId,
      },
      select: {
        id: true,
        reportingDate: true,
      },
    });

    for (const existingAchievement of existingAchievements) {
      const existingCycleNumber = findCycleNumberForDate(
        existingAchievement.reportingDate,
        period,
      );
      if (existingCycleNumber === newCycleNumber) {
        return {
          status: "error",
          message:
            "Achievement already exists for this allocation and review cycle. Edit the existing one.",
        };
      }
    }
  }

  // Validate achievementFormData against KPI's form config if present
  const formConfig = kpi.achievementFormConfig as AchievementFormConfig | null;
  const formValidationError = validateAchievementFormData(
    formConfig,
    data.achievementFormData,
  );
  if (formValidationError) {
    return {
      status: "error",
      message: formValidationError,
    };
  }

  // Compute score if we have target data
  let computedScoreValue: number | null = null;
  if (allocation) {
    computedScoreValue = computeScore(
      kpi.measurementType,
      kpi.scoringMethod,
      kpi.scoringDirection,
      kpi.scoringConfig as ScoringConfig | null,
      kpi.measurementConfig as MeasurementConfig | null,
      {
        targetValue: allocation.targetValue,
        targetDate: allocation.targetDate,
        targetMilestone: allocation.targetMilestone,
        targetGrade: allocation.targetGrade,
        targetBoolean: allocation.targetBoolean,
        targetRating: allocation.targetRating,
        actualValue: data.actualValue,
        actualDate: data.actualDate,
        actualMilestone: data.actualMilestone,
        actualGrade: data.actualGrade,
        actualBoolean: data.actualBoolean,
        actualRating: data.actualRating,
      }
    );
  }

  let createdAchievementId: string | undefined;
  await prisma.$transaction(async (tx) => {
    const achievement = await tx.achievement.create({
      data: {
        tenantId,
        periodId: data.periodId,
        kpiDefinitionId: data.kpiDefinitionId,
        targetAllocationId: data.targetAllocationId,
        reportedByUserId: actorUserId,
        actualValue: data.actualValue,
        actualDate: data.actualDate,
        actualMilestone: data.actualMilestone,
        actualGrade: data.actualGrade,
        actualBoolean: data.actualBoolean,
        actualRating: data.actualRating,
        evidenceDescription: data.evidenceDescription,
        evidenceLinks: data.evidenceLinks,
        achievementFormData: data.achievementFormData as object | undefined,
        computedScore: computedScoreValue,
        reportingDate,
      },
    });
    createdAchievementId = achievement.id;

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "Achievement",
        targetId: achievement.id,
        action: "CREATE",
        newState: {
          kpiDefinitionId: data.kpiDefinitionId,
          actualValue: data.actualValue,
          computedScore: computedScoreValue,
        },
      },
    });
  });

  return {
    status: "success",
    message: "Achievement recorded.",
    id: createdAchievementId,
  };
}

// ── Update Achievement ───────────────────────────────────────────────────────

export async function updateAchievement(
  achievementId: string,
  tenantId: string,
  input: UpdateAchievementInput,
  actorUserId: string,
  actorRole: Role
): Promise<KraKpiActionResult> {
  const parsed = updateAchievementSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;

  const achievement = await prisma.achievement.findFirst({
    where: { id: achievementId, tenantId },
  });
  if (!achievement) {
    return { status: "error", message: "Achievement not found." };
  }

  // Can only edit DRAFT or REJECTED achievements
  if (achievement.state !== "DRAFT" && achievement.state !== "REJECTED") {
    return {
      status: "error",
      message: `Cannot edit achievement in "${achievement.state}" state.`,
    };
  }

  // Only the reporter or admin can edit
  if (achievement.reportedByUserId !== actorUserId && !isAdminOrOwner(actorRole)) {
    return { status: "error", message: "Only the reporter or admin can edit this achievement." };
  }

  const kpi = await prisma.kpiDefinition.findFirst({
    where: { id: achievement.kpiDefinitionId, kraDefinition: { tenantId } },
  });
  const mergedFormData =
    data.achievementFormData !== undefined
      ? data.achievementFormData
      : ((achievement.achievementFormData as Record<string, unknown> | null) ?? undefined);
  const formValidationError = validateAchievementFormData(
    (kpi?.achievementFormConfig as AchievementFormConfig | null) ?? null,
    mergedFormData,
  );
  if (formValidationError) {
    return {
      status: "error",
      message: formValidationError,
    };
  }

  // Recompute score if actuals changed and we have a target allocation
  let newScore = achievement.computedScore;
  if (achievement.targetAllocationId) {
    const allocation = await prisma.targetAllocation.findFirst({
      where: { id: achievement.targetAllocationId, tenantId },
    });
    if (allocation && kpi) {
      newScore = computeScore(
        kpi.measurementType,
        kpi.scoringMethod,
        kpi.scoringDirection,
        kpi.scoringConfig as ScoringConfig | null,
        kpi.measurementConfig as MeasurementConfig | null,
        {
          targetValue: allocation.targetValue,
          targetDate: allocation.targetDate,
          targetMilestone: allocation.targetMilestone,
          targetGrade: allocation.targetGrade,
          targetBoolean: allocation.targetBoolean,
          targetRating: allocation.targetRating,
          actualValue: data.actualValue ?? achievement.actualValue,
          actualDate: data.actualDate ?? achievement.actualDate,
          actualMilestone: data.actualMilestone ?? achievement.actualMilestone,
          actualGrade: data.actualGrade ?? achievement.actualGrade,
          actualBoolean: data.actualBoolean ?? achievement.actualBoolean,
          actualRating: data.actualRating ?? achievement.actualRating,
        }
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.achievement.update({
      where: { id: achievementId },
      data: {
        ...(data.actualValue !== undefined && { actualValue: data.actualValue }),
        ...(data.actualDate !== undefined && { actualDate: data.actualDate }),
        ...(data.actualMilestone !== undefined && { actualMilestone: data.actualMilestone }),
        ...(data.actualGrade !== undefined && { actualGrade: data.actualGrade }),
        ...(data.actualBoolean !== undefined && { actualBoolean: data.actualBoolean }),
        ...(data.actualRating !== undefined && { actualRating: data.actualRating }),
        ...(data.evidenceDescription !== undefined && {
          evidenceDescription: data.evidenceDescription,
        }),
        ...(data.evidenceLinks !== undefined && { evidenceLinks: data.evidenceLinks }),
        ...(data.achievementFormData !== undefined && {
          achievementFormData: data.achievementFormData as object,
        }),
        computedScore: newScore,
        state: "DRAFT",
        rejectionReason: null,
      },
    });

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "Achievement",
        targetId: achievementId,
        action: "UPDATE",
        newState: data as object,
      },
    });
  });

  return { status: "success", message: "Achievement updated." };
}

// ── Submit for Verification ──────────────────────────────────────────────────

export async function submitForVerification(
  achievementId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role
): Promise<KraKpiActionResult> {
  const achievement = await prisma.achievement.findFirst({
    where: { id: achievementId, tenantId },
  });
  if (!achievement) {
    return { status: "error", message: "Achievement not found." };
  }

  if (achievement.state !== "DRAFT") {
    return {
      status: "error",
      message: `Cannot submit — achievement is in "${achievement.state}" state.`,
    };
  }

  if (achievement.reportedByUserId !== actorUserId && !isAdminOrOwner(actorRole)) {
    return { status: "error", message: "Only the reporter or admin can submit." };
  }

  const actor = await prisma.user.findUnique({
    where: { id: actorUserId },
    select: { firstName: true, lastName: true },
  });
  const actorName = actor ? `${actor.firstName} ${actor.lastName}` : "Unknown";

  const existingLog = (achievement.verificationLog as VerificationLogEntry[]) ?? [];
  const newLogEntry: VerificationLogEntry = {
    level: "SUBMIT",
    userId: actorUserId,
    userName: actorName,
    action: "submitted",
    at: new Date().toISOString(),
  };

  await prisma.$transaction(async (tx) => {
    await tx.achievement.update({
      where: { id: achievementId },
      data: {
        state: "SUBMITTED",
        verificationLog: [...existingLog, newLogEntry] as unknown as object[],
      },
    });

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "Achievement",
        targetId: achievementId,
        action: "SUBMIT_FOR_VERIFICATION",
        previousState: { state: "DRAFT" },
        newState: { state: "SUBMITTED" },
      },
    });
  });

  // Notify dept head (recommender) — find the unit head for the assignee's unit
  try {
    const fullAchievement = await prisma.achievement.findFirst({
      where: { id: achievementId },
      include: {
        kpiDefinition: { select: { title: true, startingUnitId: true } },
        targetAllocation: {
          select: { assignedToUnitId: true, assignedToUserId: true },
        },
      },
    });
    if (fullAchievement) {
      const kpiTitle = fullAchievement.kpiDefinition.title;
      // Determine the dept head to notify
      let deptHeadUserId: string | null = null;
      const alloc = fullAchievement.targetAllocation;
      if (alloc?.assignedToUnitId) {
        deptHeadUserId = await resolveUnitHead(tenantId, alloc.assignedToUnitId);
      } else if (alloc?.assignedToUserId) {
        // Find units the assignee belongs to and get their head
        const assignments = await prisma.orgRoleAssignment.findMany({
          where: {
            userId: alloc.assignedToUserId,
            isActive: true,
            version: { tenantId, state: { in: ["PUBLISHED", "VALIDATED"] } },
          },
          select: { unitId: true },
          take: 1,
        });
        if (assignments[0]) {
          deptHeadUserId = await resolveUnitHead(tenantId, assignments[0].unitId);
        }
      } else {
        // Additional achievement — use reporter's primary unit
        const assignments = await prisma.orgRoleAssignment.findMany({
          where: {
            userId: fullAchievement.reportedByUserId,
            isActive: true,
            version: { tenantId, state: { in: ["PUBLISHED", "VALIDATED"] } },
          },
          select: { unitId: true },
          take: 1,
        });
        if (assignments[0]) {
          deptHeadUserId = await resolveUnitHead(tenantId, assignments[0].unitId);
        }
      }

      if (deptHeadUserId && deptHeadUserId !== actorUserId) {
        await createNotification(
          tenantId,
          deptHeadUserId,
          "ACHIEVEMENT_SUBMITTED",
          "Achievement submitted for review",
          `${actorName} submitted an achievement for '${kpiTitle}'`,
          "Achievement",
          achievementId,
          "/my-kpis",
        );
      }
    }
  } catch (err) {
    console.warn("[achievement-service] submitForVerification notification failed:", err);
  }

  return { status: "success", message: "Achievement submitted for verification." };
}

// ── Verify Achievement (admin path — still works for R1 admin verify) ────────

export async function verifyAchievement(
  achievementId: string,
  tenantId: string,
  approved: boolean,
  note: string | null,
  actorUserId: string,
  actorRole: Role
): Promise<KraKpiActionResult> {
  const achievement = await prisma.achievement.findFirst({
    where: { id: achievementId, tenantId },
    include: {
      kpiDefinition: {
        select: {
          measurementType: true,
          scoringMethod: true,
          scoringDirection: true,
          scoringConfig: true,
          measurementConfig: true,
          startingUnitId: true,
          title: true,
        },
      },
      targetAllocation: {
        include: {
          parentAllocation: {
            select: { assignedToUnitId: true },
          },
        },
      },
    },
  });
  if (!achievement) {
    return { status: "error", message: "Achievement not found." };
  }

  if (achievement.state !== "SUBMITTED" && achievement.state !== "RECOMMENDED") {
    return {
      status: "error",
      message: `Cannot verify — achievement is in "${achievement.state}" state.`,
    };
  }

  const isShortcut = await usesSameDepartmentShortcut(tenantId, achievement);

  if (!isAdminOrOwner(actorRole)) {
    const canVerify = await canActorVerifyAchievement(
      tenantId,
      actorUserId,
      achievement.kpiDefinition.startingUnitId,
    );
    if (!canVerify) {
      return {
        status: "error",
        message: "Only the source department head can verify this achievement.",
      };
    }
    if (achievement.state === "SUBMITTED" && !isShortcut) {
      return {
        status: "error",
        message: "This achievement must be recommended before final verification.",
      };
    }
  }

  const actor = await prisma.user.findUnique({
    where: { id: actorUserId },
    select: { firstName: true, lastName: true },
  });
  const actorName = actor ? `${actor.firstName} ${actor.lastName}` : "Unknown";

  const newState = approved ? "VERIFIED" : "REJECTED";
  const existingLog = (achievement.verificationLog as VerificationLogEntry[]) ?? [];
  const logEntry: VerificationLogEntry = {
    level: "VERIFY",
    userId: actorUserId,
    userName: actorName,
    action: approved ? "verified" : "not approved",
    note: note ?? undefined,
    at: new Date().toISOString(),
  };

  // Recompute score on verify
  let finalScore = achievement.computedScore;
  if (approved && achievement.targetAllocation) {
    const kpi = achievement.kpiDefinition;
    const alloc = achievement.targetAllocation;
    finalScore = computeScore(
      kpi.measurementType,
      kpi.scoringMethod,
      kpi.scoringDirection,
      kpi.scoringConfig as ScoringConfig | null,
      kpi.measurementConfig as MeasurementConfig | null,
      {
        targetValue: alloc.targetValue,
        targetDate: alloc.targetDate,
        targetMilestone: alloc.targetMilestone,
        targetGrade: alloc.targetGrade,
        targetBoolean: alloc.targetBoolean,
        targetRating: alloc.targetRating,
        actualValue: achievement.actualValue,
        actualDate: achievement.actualDate,
        actualMilestone: achievement.actualMilestone,
        actualGrade: achievement.actualGrade,
        actualBoolean: achievement.actualBoolean,
        actualRating: achievement.actualRating,
      }
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.achievement.update({
      where: { id: achievementId },
      data: {
        state: newState,
        verifiedByUserId: approved ? actorUserId : null,
        verifiedAt: approved ? new Date() : null,
        verificationNote: approved ? note : null,
        rejectionReason: !approved ? (note ?? "No reason provided") : null,
        computedScore: approved ? finalScore : achievement.computedScore,
        verificationLog: [...existingLog, logEntry] as unknown as object[],
      },
    });

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "Achievement",
        targetId: achievementId,
        action: approved ? "VERIFY" : "REJECT",
        previousState: { state: achievement.state },
        newState: { state: newState, note },
      },
    });
  });

  // Notify reporter
  try {
    const kpiTitle = achievement.kpiDefinition.title;
    const reporterId = achievement.reportedByUserId;
    if (reporterId !== actorUserId) {
      if (approved) {
        const scoreText = finalScore != null ? ` Score: ${Math.round(finalScore)}` : "";
        await createNotification(
          tenantId,
          reporterId,
          "ACHIEVEMENT_VERIFIED",
          "Achievement verified",
          `'${kpiTitle}' achievement has been verified!${scoreText}`,
          "Achievement",
          achievementId,
          "/my-kpis",
        );
      } else {
        await createNotification(
          tenantId,
          reporterId,
          "ACHIEVEMENT_NOT_APPROVED",
          "Achievement not approved",
          `'${kpiTitle}' was not approved.${note ? ` Reason: ${note}` : ""}`,
          "Achievement",
          achievementId,
          "/my-kpis",
        );
      }
    }
  } catch (err) {
    console.warn("[achievement-service] verifyAchievement notification failed:", err);
  }

  return {
    status: "success",
    message: approved
      ? "Achievement verified."
      : "Achievement not approved. Reporter can revise and resubmit.",
  };
}

// ── Recommend Achievement (Dept Head) ────────────────────────────────────────

export async function recommendAchievement(
  achievementId: string,
  tenantId: string,
  approved: boolean,
  note: string | null,
  actorUserId: string,
  actorRole: Role,
): Promise<KraKpiActionResult> {
  const achievement = await prisma.achievement.findFirst({
    where: { id: achievementId, tenantId },
    include: {
      kpiDefinition: { select: { startingUnitId: true, title: true } },
      targetAllocation: {
        include: {
          parentAllocation: {
            select: { assignedToUnitId: true },
          },
        },
      },
    },
  });
  if (!achievement) {
    return { status: "error", message: "Achievement not found." };
  }

  if (achievement.state !== "SUBMITTED") {
    return {
      status: "error",
      message: `Cannot recommend — achievement is in "${achievement.state}" state.`,
    };
  }

  if (!isAdminOrOwner(actorRole)) {
    const canRecommend = await canActorRecommendAchievement(
      tenantId,
      actorUserId,
      achievement,
    );
    if (!canRecommend) {
      return {
        status: "error",
        message: "Only the assignee's department head can recommend this achievement.",
      };
    }
    if (await usesSameDepartmentShortcut(tenantId, achievement)) {
      return {
        status: "error",
        message:
          "This achievement should be verified directly because the assignee and source unit are the same.",
      };
    }
  }

  const actor = await prisma.user.findUnique({
    where: { id: actorUserId },
    select: { firstName: true, lastName: true },
  });
  const actorName = actor ? `${actor.firstName} ${actor.lastName}` : "Unknown";

  const existingLog = (achievement.verificationLog as VerificationLogEntry[]) ?? [];

  if (approved) {
    const logEntry: VerificationLogEntry = {
      level: "RECOMMEND",
      userId: actorUserId,
      userName: actorName,
      action: "recommended",
      note: note ?? undefined,
      at: new Date().toISOString(),
    };

    await prisma.$transaction(async (tx) => {
      await tx.achievement.update({
        where: { id: achievementId },
        data: {
          state: "RECOMMENDED",
          recommendedByUserId: actorUserId,
          recommendedAt: new Date(),
          recommendationNote: note,
          verificationLog: [...existingLog, logEntry] as unknown as object[],
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          actorUserId,
          actorRole,
          targetType: "Achievement",
          targetId: achievementId,
          action: "RECOMMEND",
          previousState: { state: "SUBMITTED" },
          newState: { state: "RECOMMENDED", note },
        },
      });
    });

    // Notify source dept head (verifier)
    try {
      const sourceHeadUserId = await resolveUnitHead(
        tenantId,
        achievement.kpiDefinition.startingUnitId,
      );
      if (sourceHeadUserId && sourceHeadUserId !== actorUserId) {
        await createNotification(
          tenantId,
          sourceHeadUserId,
          "ACHIEVEMENT_RECOMMENDED",
          "Achievement recommended for verification",
          `${actorName} recommended an achievement for '${achievement.kpiDefinition?.title ?? ""}' — ready for your verification`,
          "Achievement",
          achievementId,
          "/my-kpis",
        );
      }
    } catch (err) {
      console.warn("[achievement-service] recommendAchievement notify source head failed:", err);
    }

    return { status: "success", message: "Achievement recommended for final verification." };
  }

  // Send back
  const logEntry: VerificationLogEntry = {
    level: "SEND_BACK",
    userId: actorUserId,
    userName: actorName,
    action: "sent back",
    note: note ?? undefined,
    at: new Date().toISOString(),
  };

  await prisma.$transaction(async (tx) => {
      await tx.achievement.update({
        where: { id: achievementId },
        data: {
        state: "DRAFT",
        rejectionReason: note ?? "Sent back by department head",
        verificationLog: [...existingLog, logEntry] as unknown as object[],
      },
    });

    await tx.auditLog.create({
        data: {
          tenantId,
          actorUserId,
          actorRole,
          targetType: "Achievement",
          targetId: achievementId,
        action: "SEND_BACK",
        previousState: { state: "SUBMITTED" },
        newState: { state: "DRAFT", note },
      },
    });
  });

  // Notify reporter
  try {
    const kpiTitle = achievement.kpiDefinition.title;
    const reporterId = achievement.reportedByUserId;
    if (reporterId !== actorUserId) {
      await createNotification(
        tenantId,
        reporterId,
        "ACHIEVEMENT_SENT_BACK",
        "Achievement sent back for revision",
        `Your '${kpiTitle}' submission was sent back. ${note ? `Reason: ${note}` : "Please revise and resubmit."}`,
        "Achievement",
        achievementId,
        "/my-kpis",
      );
    }
  } catch (err) {
    console.warn("[achievement-service] send-back notification failed:", err);
  }

  return { status: "success", message: "Achievement sent back to reporter." };
}

// ── Withdraw Submission ──────────────────────────────────────────────────────

export async function withdrawAchievement(
  achievementId: string,
  tenantId: string,
  actorUserId: string,
): Promise<KraKpiActionResult> {
  const achievement = await prisma.achievement.findFirst({
    where: { id: achievementId, tenantId },
  });
  if (!achievement) {
    return { status: "error", message: "Achievement not found." };
  }

  if (achievement.state !== "SUBMITTED") {
    return {
      status: "error",
      message: "Can only withdraw submissions that have not been acted on.",
    };
  }

  if (achievement.reportedByUserId !== actorUserId) {
    return { status: "error", message: "Only the reporter can withdraw." };
  }

  // Block if recommender has already acted
  const log = (achievement.verificationLog as VerificationLogEntry[]) ?? [];
  const hasRecommendation = log.some((e) => e.level === "RECOMMEND");
  if (hasRecommendation) {
    return {
      status: "error",
      message: "Cannot withdraw — already recommended by department head.",
    };
  }

  const actor = await prisma.user.findUnique({
    where: { id: actorUserId },
    select: { firstName: true, lastName: true },
  });
  const actorName = actor ? `${actor.firstName} ${actor.lastName}` : "Unknown";

  const logEntry: VerificationLogEntry = {
    level: "WITHDRAW",
    userId: actorUserId,
    userName: actorName,
    action: "withdrawn",
    at: new Date().toISOString(),
  };

  await prisma.$transaction(async (tx) => {
    await tx.achievement.update({
      where: { id: achievementId },
      data: {
        state: "DRAFT",
        verificationLog: [...log, logEntry] as unknown as object[],
      },
    });

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole: "TENANT_USER",
        targetType: "Achievement",
        targetId: achievementId,
        action: "WITHDRAW",
        previousState: { state: "SUBMITTED" },
        newState: { state: "DRAFT" },
      },
    });
  });

  return { status: "success", message: "Submission withdrawn. You can edit and resubmit." };
}

// ── Dashboard Summary ────────────────────────────────────────────────────────

export type PeriodSummary = {
  periodId: string;
  periodName: string;
  totalKras: number;
  totalKpis: number;
  totalAllocations: number;
  totalAchievements: number;
  verifiedAchievements: number;
  pendingVerification: number;
  overallWeightedScore: number;
  maxPossibleScore: number;
  overallPercentage: number;
};

export async function getPeriodSummary(
  periodId: string,
  tenantId: string
): Promise<PeriodSummary | null> {
  const period = await prisma.assessmentPeriod.findFirst({
    where: { id: periodId, tenantId },
  });
  if (!period) return null;

  const [kraCount, kpiCount, allocationCount, achievementCounts, verifiedAchievements] =
    await Promise.all([
      prisma.kraDefinition.count({
        where: { periodId, tenantId, state: "ACTIVE" },
      }),
      prisma.kpiDefinition.count({
        where: {
          state: "ACTIVE",
          kraDefinition: { periodId, tenantId, state: { not: "ARCHIVED" } },
        },
      }),
      prisma.targetAllocation.count({
        where: { periodId, tenantId },
      }),
      prisma.achievement.count({
        where: { periodId, tenantId },
      }),
      prisma.achievement.findMany({
        where: { periodId, tenantId, state: "VERIFIED" },
        include: {
          kpiDefinition: {
            select: { weightage: true },
          },
        },
      }),
    ]);

  const pendingCount = await prisma.achievement.count({
    where: { periodId, tenantId, state: "SUBMITTED" },
  });

  // Compute weighted score from verified achievements
  let weightedScore = 0;
  let maxPossible = 0;
  const kpiScoreMap = new Map<string, { totalScore: number; count: number; weightage: number }>();

  for (const ach of verifiedAchievements) {
    const existing = kpiScoreMap.get(ach.kpiDefinitionId);
    if (existing) {
      existing.totalScore += ach.computedScore ?? 0;
      existing.count += 1;
    } else {
      kpiScoreMap.set(ach.kpiDefinitionId, {
        totalScore: ach.computedScore ?? 0,
        count: 1,
        weightage: ach.kpiDefinition.weightage,
      });
    }
  }

  for (const [, data] of kpiScoreMap) {
    const avgScore = data.totalScore / data.count;
    weightedScore += (avgScore * data.weightage) / 100;
    maxPossible += data.weightage;
  }

  const overallPercentage =
    maxPossible > 0
      ? Math.round((weightedScore / maxPossible) * 100 * 100) / 100
      : 0;

  return {
    periodId,
    periodName: period.name,
    totalKras: kraCount,
    totalKpis: kpiCount,
    totalAllocations: allocationCount,
    totalAchievements: achievementCounts,
    verifiedAchievements: verifiedAchievements.length,
    pendingVerification: pendingCount,
    overallWeightedScore: Math.round(weightedScore * 100) / 100,
    maxPossibleScore: maxPossible,
    overallPercentage,
  };
}

// ── Record Additional Achievement (no target allocation required) ─────────────

export async function recordAdditionalAchievement(
  tenantId: string,
  input: CreateAchievementInput,
  actorUserId: string,
  actorRole: Role,
): Promise<KraKpiActionResult> {
  const parsed = createAchievementSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;
  const reportingDate = data.reportingDate ?? new Date();

  // Verify period
  const period = await prisma.assessmentPeriod.findFirst({
    where: { id: data.periodId, tenantId },
    select: { id: true, state: true, startDate: true, endDate: true, reviewFrequency: true },
  });
  if (!period) {
    return { status: "error", message: "Period not found." };
  }
  if (period.state !== "IN_PROGRESS" && period.state !== "UNDER_REVIEW") {
    return {
      status: "error",
      message: `Cannot record achievements in "${period.state}" period.`,
    };
  }

  // Verify KPI
  const kpi = await prisma.kpiDefinition.findFirst({
    where: { id: data.kpiDefinitionId, kraDefinition: { tenantId } },
    include: { kraDefinition: { select: { state: true } } },
  });
  if (!kpi) {
    return { status: "error", message: "KPI not found." };
  }
  if (kpi.state !== "ACTIVE") {
    return { status: "error", message: "Cannot record achievements for a KPI that is not ACTIVE." };
  }
  if (kpi.kraDefinition.state !== "ACTIVE") {
    return { status: "error", message: "Cannot record achievements while the parent KRA is not ACTIVE." };
  }

  // Block if user already has an allocated target for this KPI
  const ctx = await getMyKpiContext(tenantId, actorUserId);
  const headUnitIds = ctx.headOfUnits.map((u) => u.unitId);
  const existingAllocation = await prisma.targetAllocation.findFirst({
    where: {
      tenantId,
      periodId: data.periodId,
      kpiDefinitionId: data.kpiDefinitionId,
      OR: [
        { assignedToUserId: actorUserId },
        ...(headUnitIds.length > 0 ? [{ assignedToUnitId: { in: headUnitIds } }] : []),
      ],
    },
  });
  if (existingAllocation) {
    return {
      status: "error",
      message: "You have an allocated target for this KPI. Use My Targets tab instead.",
    };
  }

  // Block if user already has an existing (non-rejected) additional achievement for this KPI
  const existingAdditional = await prisma.achievement.findFirst({
    where: {
      tenantId,
      periodId: data.periodId,
      kpiDefinitionId: data.kpiDefinitionId,
      reportedByUserId: actorUserId,
      targetAllocationId: null,
      state: { not: "REJECTED" },
    },
  });
  if (existingAdditional) {
    return {
      status: "error",
      message: "You already have an additional achievement for this KPI. Edit the existing one.",
    };
  }

  // Validate form data
  const formConfig = kpi.achievementFormConfig as AchievementFormConfig | null;
  const formValidationError = validateAchievementFormData(formConfig, data.achievementFormData);
  if (formValidationError) {
    return { status: "error", message: formValidationError };
  }

  // Compute score using defaultTarget if available (no allocation target)
  let computedScoreValue: number | null = null;
  if (kpi.defaultTarget != null && data.actualValue != null) {
    computedScoreValue = computeScore(
      kpi.measurementType,
      kpi.scoringMethod,
      kpi.scoringDirection,
      kpi.scoringConfig as ScoringConfig | null,
      kpi.measurementConfig as MeasurementConfig | null,
      {
        targetValue: kpi.defaultTarget,
        targetDate: null,
        targetMilestone: null,
        targetGrade: null,
        targetBoolean: null,
        targetRating: null,
        actualValue: data.actualValue,
        actualDate: data.actualDate,
        actualMilestone: data.actualMilestone,
        actualGrade: data.actualGrade,
        actualBoolean: data.actualBoolean,
        actualRating: data.actualRating,
      },
    );
  }

  let createdAchievementId: string | undefined;
  await prisma.$transaction(async (tx) => {
    const achievement = await tx.achievement.create({
      data: {
        tenantId,
        periodId: data.periodId,
        kpiDefinitionId: data.kpiDefinitionId,
        targetAllocationId: null,
        reportedByUserId: actorUserId,
        actualValue: data.actualValue,
        actualDate: data.actualDate,
        actualMilestone: data.actualMilestone,
        actualGrade: data.actualGrade,
        actualBoolean: data.actualBoolean,
        actualRating: data.actualRating,
        evidenceDescription: data.evidenceDescription,
        evidenceLinks: data.evidenceLinks,
        achievementFormData: data.achievementFormData as object | undefined,
        computedScore: computedScoreValue,
        reportingDate,
      },
    });
    createdAchievementId = achievement.id;

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "Achievement",
        targetId: achievement.id,
        action: "CREATE",
        newState: {
          kpiDefinitionId: data.kpiDefinitionId,
          actualValue: data.actualValue,
          computedScore: computedScoreValue,
          isAdditional: true,
        },
      },
    });
  });

  return {
    status: "success",
    message: "Additional achievement recorded.",
    id: createdAchievementId,
  };
}
