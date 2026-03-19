import type { Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type {
  KraKpiActionResult,
  AchievementView,
  VerificationLogEntry,
  AchievementFormConfig,
} from "./shared";
import { computeScore } from "./scoring-service";
import type { MeasurementConfig, ScoringConfig } from "./shared";
import { buildFormDataValidator } from "./shared";

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

  // Verify period
  const period = await prisma.assessmentPeriod.findFirst({
    where: { id: data.periodId, tenantId },
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
  });
  if (!kpi) {
    return { status: "error", message: "KPI not found." };
  }

  // Verify target allocation if provided
  let allocation: Awaited<ReturnType<typeof prisma.targetAllocation.findFirst>> = null;
  if (data.targetAllocationId) {
    allocation = await prisma.targetAllocation.findFirst({
      where: { id: data.targetAllocationId, tenantId },
    });
    if (!allocation) {
      return { status: "error", message: "Target allocation not found." };
    }
  }

  // Duplicate prevention: block if a non-VERIFIED achievement already exists for this allocation
  if (data.targetAllocationId) {
    const existing = await prisma.achievement.findFirst({
      where: {
        targetAllocationId: data.targetAllocationId,
        reportedByUserId: actorUserId,
        state: { in: ["DRAFT", "SUBMITTED", "RECOMMENDED"] },
      },
    });
    if (existing) {
      return {
        status: "error",
        message: "Achievement already exists for this allocation. Edit the existing one.",
      };
    }
  }

  // Validate achievementFormData against KPI's form config if present
  const formConfig = kpi.achievementFormConfig as AchievementFormConfig | null;
  if (formConfig && data.achievementFormData) {
    const validator = buildFormDataValidator(formConfig.fields);
    const formResult = validator.safeParse(data.achievementFormData);
    if (!formResult.success) {
      return {
        status: "error",
        message: formResult.error.issues[0]?.message ?? "Invalid form data.",
      };
    }
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
        reportingDate: data.reportingDate ?? new Date(),
      },
    });

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

  return { status: "success", message: "Achievement recorded." };
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

  // Recompute score if actuals changed and we have a target allocation
  let newScore = achievement.computedScore;
  if (achievement.targetAllocationId) {
    const allocation = await prisma.targetAllocation.findFirst({
      where: { id: achievement.targetAllocationId },
    });
    const kpi = await prisma.kpiDefinition.findFirst({
      where: { id: achievement.kpiDefinitionId },
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
      kpiDefinition: { select: { measurementType: true, scoringMethod: true, scoringDirection: true, scoringConfig: true, measurementConfig: true } },
      targetAllocation: true,
    },
  });
  if (!achievement) {
    return { status: "error", message: "Achievement not found." };
  }

  // Admins can verify from SUBMITTED or RECOMMENDED
  if (achievement.state !== "SUBMITTED" && achievement.state !== "RECOMMENDED") {
    return {
      status: "error",
      message: `Cannot verify — achievement is in "${achievement.state}" state.`,
    };
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
      message: `Cannot recommend — achievement is in "${achievement.state}" state.`,
    };
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
          actorRole: "TENANT_USER",
          targetType: "Achievement",
          targetId: achievementId,
          action: "RECOMMEND",
          previousState: { state: "SUBMITTED" },
          newState: { state: "RECOMMENDED", note },
        },
      });
    });

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
        actorRole: "TENANT_USER",
        targetType: "Achievement",
        targetId: achievementId,
        action: "SEND_BACK",
        previousState: { state: "SUBMITTED" },
        newState: { state: "DRAFT", note },
      },
    });
  });

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
        where: { periodId, tenantId, state: { not: "ARCHIVED" } },
      }),
      prisma.kpiDefinition.count({
        where: { kraDefinition: { periodId, tenantId, state: { not: "ARCHIVED" } } },
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
