import type { GradeValue, MilestoneStatus, Prisma, Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canRecord } from "./assignee-access";
import { getMyKpiContext, isUserHeadOfUnit } from "./my-kpi-service";
import {
  computeReviewCycles,
  isDateWithinInclusiveUtcRange,
} from "./period-service";
import type {
  KraKpiActionResult,
  AchievementView,
  VerificationLogEntry,
  AchievementFormConfig,
  SubmissionTrailView,
} from "./shared";
import { computeScore } from "./scoring-service";
import type { MeasurementConfig, ScoringConfig } from "./shared";
import { buildFormDataValidator } from "./shared";
import {
  createNotification,
  createBulkNotifications,
  resolveUnitHead,
  resolveUnitHeadUserIds,
} from "@/lib/notifications/notification-service";
import { initializeStageProgress, calculateStageScore } from "./stage-progress-service";
import {
  achievementContributorInclude,
  achievementContributorInputSchema,
  buildStarterContributorInputs,
  contributorMutationToActionResult,
  ensureAchievementContributorRows,
  mapAchievementContributors,
  setAchievementContributors,
} from "./achievement-contributor-service";
import { runDuplicateDetection } from "./duplicate-detection-service";
import { ensureApplicableRolesBaseline } from "./contributor-role-service";
import { syncContributorRewardsForAchievement } from "./reward-service";

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
  title: z.string().trim().max(200).optional(),
  contributionRole: z.string().trim().max(100).optional(),
  isOBO: z.boolean().default(false),
  oboReportedForUserId: z.string().trim().min(1).optional(),
  contributors: z.array(achievementContributorInputSchema).optional(),
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
  title: z.string().trim().max(200).nullable().optional(),
  contributionRole: z.string().trim().max(100).nullable().optional(),
  contributors: z.array(achievementContributorInputSchema).optional(),
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

function roleToTrailLabel(role: Role): string {
  switch (role) {
    case "TENANT_OWNER":
      return "Tenant Owner";
    case "TENANT_ADMIN":
      return "IQAC Admin";
    case "SUPERADMIN":
      return "Superadmin";
    default:
      return "Employee";
  }
}

async function getActorUnitName(
  tenantId: string,
  userId: string,
): Promise<string | null> {
  const publishedVersion = await prisma.orgStructureVersion.findFirst({
    where: { tenantId, state: { in: ["PUBLISHED", "VALIDATED"] } },
    orderBy: { versionNumber: "desc" },
    select: { id: true },
  });
  if (!publishedVersion) return null;
  const primary = await prisma.userOrgAssignment.findFirst({
    where: { versionId: publishedVersion.id, userId, isPrimary: true },
    include: { unit: { select: { name: true } } },
  });
  return primary?.unit?.name ?? null;
}

async function appendSubmissionTrailEntry(
  tx: Prisma.TransactionClient,
  input: {
    achievementId: string;
    action: string;
    actorUserId: string;
    actorName: string;
    actorRole: string;
    actorUnitName: string | null;
    note?: string | null;
    scoreAtAction?: number | null;
    metadata?: Record<string, unknown> | null;
  },
): Promise<void> {
  await tx.submissionTrail.create({
    data: {
      achievementId: input.achievementId,
      action: input.action,
      actorUserId: input.actorUserId,
      actorName: input.actorName,
      actorRole: input.actorRole,
      actorUnitName: input.actorUnitName,
      note: input.note ?? null,
      scoreAtAction: input.scoreAtAction ?? null,
      metadata: input.metadata as object | undefined,
    },
  });
}

export async function getSubmissionTrail(
  achievementId: string,
  tenantId: string,
): Promise<SubmissionTrailView[]> {
  const ach = await prisma.achievement.findFirst({
    where: { id: achievementId, tenantId },
    select: { id: true },
  });
  if (!ach) return [];

  const rows = await prisma.submissionTrail.findMany({
    where: { achievementId },
    orderBy: { createdAt: "asc" },
  });

  return mapSubmissionTrailRows(rows);
}

function approvingUnitIdForKpi(kpi: {
  finalUnitId: string | null;
  keyUnitId: string | null;
  startingUnitId: string;
}): string {
  return kpi.finalUnitId ?? kpi.keyUnitId ?? kpi.startingUnitId;
}

function initialReviewUnitIdForKpi(kpi: {
  startingUnitId: string;
  keyUnitId: string | null;
  finalUnitId: string | null;
}): string {
  if (kpi.keyUnitId && kpi.finalUnitId) {
    return kpi.keyUnitId;
  }

  return approvingUnitIdForKpi(kpi);
}

function finalReviewUnitIdForKpi(kpi: {
  startingUnitId: string;
  keyUnitId: string | null;
  finalUnitId: string | null;
}): string {
  return approvingUnitIdForKpi(kpi);
}

function kpiHasTwoStepReview(kpi: {
  keyUnitId: string | null;
  finalUnitId: string | null;
}): boolean {
  return !!(kpi.keyUnitId && kpi.finalUnitId);
}

function currentReviewUnitIdForAchievement(achievement: {
  state: "SUBMITTED" | "RECOMMENDED";
  currentVerifierUnitId: string | null;
  kpiDefinition: {
    startingUnitId: string;
    keyUnitId: string | null;
    finalUnitId: string | null;
  };
}): string {
  if (achievement.currentVerifierUnitId) {
    return achievement.currentVerifierUnitId;
  }

  if (achievement.state === "RECOMMENDED") {
    return finalReviewUnitIdForKpi(achievement.kpiDefinition);
  }

  return initialReviewUnitIdForKpi(achievement.kpiDefinition);
}

function calculateEffectiveScore(
  baseScore: number | null,
  _creditPercent: number | null,
): number | null {
  return baseScore;
}

function mapSubmissionTrailRows(
  rows: Array<{
    id: string;
    achievementId: string;
    action: string;
    actorUserId: string;
    actorName: string;
    actorRole: string;
    actorUnitName: string | null;
    note: string | null;
    scoreAtAction: number | null;
    metadata: Prisma.JsonValue;
    createdAt: Date;
  }>,
): SubmissionTrailView[] {
  return rows.map((row) => ({
    id: row.id,
    achievementId: row.achievementId,
    action: row.action,
    actorUserId: row.actorUserId,
    actorName: row.actorName,
    actorRole: row.actorRole,
    actorUnitName: row.actorUnitName,
    note: row.note,
    scoreAtAction: row.scoreAtAction,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt,
  }));
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
    (item) => isDateWithinInclusiveUtcRange(reportingDate, item.startDate, item.endDate),
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
  if (!achievement.targetAllocation) {
    const primaryUnitId = await getPrimaryMemberUnitId(
      tenantId,
      achievement.reportedByUserId,
    );
    return primaryUnitId ? [primaryUnitId] : [];
  }

  const unitIds = new Set<string>();

  if (achievement.targetAllocation?.assignedToUnitId) {
    unitIds.add(achievement.targetAllocation.assignedToUnitId);
  }

  if (!achievement.targetAllocation?.assignedToUnitId) {
    const assigneeUserId =
      achievement.targetAllocation?.assignedToUserId ?? achievement.reportedByUserId;
    const primaryUnitId = await getPrimaryMemberUnitId(tenantId, assigneeUserId);
    if (primaryUnitId) {
      unitIds.add(primaryUnitId);
    }
  }

  return [...unitIds];
}

async function getPrimaryMemberUnitId(
  tenantId: string,
  userId: string,
): Promise<string | null> {
  const publishedVersion = await prisma.orgStructureVersion.findFirst({
    where: {
      tenantId,
      state: { in: ["PUBLISHED", "VALIDATED"] },
    },
    orderBy: { versionNumber: "desc" },
    select: { id: true },
  });

  if (publishedVersion) {
    const primaryAssignment = await prisma.userOrgAssignment.findFirst({
      where: {
        versionId: publishedVersion.id,
        userId,
        isPrimary: true,
      },
      select: { unitId: true },
    });

    if (primaryAssignment?.unitId) {
      return primaryAssignment.unitId;
    }

    const fallbackAssignment = await prisma.userOrgAssignment.findFirst({
      where: {
        versionId: publishedVersion.id,
        userId,
      },
      orderBy: { isPrimary: "desc" },
      select: { unitId: true },
    });

    if (fallbackAssignment?.unitId) {
      return fallbackAssignment.unitId;
    }
  }

  const context = await getMyKpiContext(tenantId, userId);
  return context.memberOfUnits[0]?.unitId ?? null;
}

function getCreditedUserId(input: {
  reportedByUserId: string;
  oboReportedForUserId?: string | null;
}): string {
  return input.oboReportedForUserId ?? input.reportedByUserId;
}

async function validateOboRequest(input: {
  tenantId: string;
  actorUserId: string;
  actorRole: Role;
  isOBO: boolean;
  oboReportedForUserId?: string | null;
}): Promise<KraKpiActionResult | null> {
  if (!input.isOBO) {
    return null;
  }

  if (!input.oboReportedForUserId) {
    return {
      status: "error",
      message: "Select the user you are reporting for.",
      code: "OBO_BENEFICIARY_REQUIRED",
    };
  }

  if (input.oboReportedForUserId === input.actorUserId) {
    return null;
  }

  if (isAdminOrOwner(input.actorRole)) {
    return null;
  }

  const beneficiaryUnitId = await getPrimaryMemberUnitId(
    input.tenantId,
    input.oboReportedForUserId,
  );
  if (!beneficiaryUnitId) {
    return {
      status: "error",
      message: "The selected beneficiary has no active unit assignment.",
      code: "CONTRIBUTOR_NOT_FOUND",
    };
  }

  const canReportForBeneficiary = await isUserHeadOfUnit(
    input.tenantId,
    input.actorUserId,
    beneficiaryUnitId,
  );
  if (!canReportForBeneficiary) {
    return {
      status: "error",
      message: "Only tenant admins or the beneficiary's unit head can report on behalf of another user.",
      code: "PERMISSION_DENIED",
    };
  }

  return null;
}

async function findExistingAdditionalAchievementForCycle(input: {
  tenantId: string;
  periodId: string;
  kpiDefinitionId: string;
  subjectUserId: string;
  reportingDate: Date;
  period: { startDate: Date; endDate: Date; reviewFrequency: string };
  excludeAchievementId?: string;
}) {
  const cycleNumber = findCycleNumberForDate(input.reportingDate, input.period);
  const achievements = await prisma.achievement.findMany({
    where: {
      tenantId: input.tenantId,
      periodId: input.periodId,
      kpiDefinitionId: input.kpiDefinitionId,
      OR: [
        { reportedByUserId: input.subjectUserId },
        { oboReportedForUserId: input.subjectUserId },
      ],
      targetAllocationId: null,
      ...(input.excludeAchievementId ? { id: { not: input.excludeAchievementId } } : {}),
    },
    select: {
      id: true,
      state: true,
      reportingDate: true,
    },
  });

  return achievements.find(
    (achievement) =>
      findCycleNumberForDate(achievement.reportingDate, input.period) === cycleNumber,
  ) ?? null;
}

async function canActorReviewUnit(
  tenantId: string,
  actorUserId: string,
  unitId: string | null,
): Promise<boolean> {
  if (!unitId) {
    return false;
  }

  return isUserHeadOfUnit(tenantId, actorUserId, unitId);
}

function mapAchievementView(
  a: {
    id: string;
    tenantId: string;
    periodId: string;
    kpiDefinitionId: string;
    targetAllocationId: string | null;
    reportedByUserId: string;
    oboReportedForUserId: string | null;
    isOBO: boolean;
    title: string | null;
    contributionRole: string | null;
    creditPercent: number | null;
    effectiveScore: number | null;
    stageCompletionScore: number | null;
    actualValue: number | null;
    actualDate: Date | null;
    actualMilestone: MilestoneStatus | null;
    actualGrade: GradeValue | null;
    actualBoolean: boolean | null;
    actualRating: number | null;
    evidenceDescription: string | null;
    evidenceLinks: string[];
    achievementFormData: Prisma.JsonValue;
    computedScore: number | null;
    state: "DRAFT" | "SUBMITTED" | "RECOMMENDED" | "VERIFIED" | "REJECTED";
    recommendedByUserId: string | null;
    recommendedAt: Date | null;
    recommendationNote: string | null;
    verifiedByUserId: string | null;
    verifiedAt: Date | null;
    verificationNote: string | null;
    rejectionReason: string | null;
    verificationLog: Prisma.JsonValue;
    duplicateCheckResult: Prisma.JsonValue;
    contributors: Array<{
      id: string;
      type: "INTERNAL" | "EXTERNAL";
      userId: string | null;
      externalName: string | null;
      externalAffiliation: string | null;
      externalScope: "NATIONAL" | "INTERNATIONAL" | null;
      externalData: Prisma.JsonValue;
      contributorRoleId: string;
      selectorTags: string[];
      creditPercent: number;
      isExcludedFromReward: boolean;
      note: string | null;
      user?: { id: string; firstName: string; lastName: string } | null;
      contributorRole?: { id: string; name: string } | null;
    }>;
    reportingDate: Date;
    createdAt: Date;
    submissionTrail: Array<{
      id: string;
      achievementId: string;
      action: string;
      actorUserId: string;
      actorName: string;
      actorRole: string;
      actorUnitName: string | null;
      note: string | null;
      scoreAtAction: number | null;
      metadata: Prisma.JsonValue;
      createdAt: Date;
    }>;
    kpiDefinition: { title: string };
  },
  reportedByUserName: string
): AchievementView {
  const mappedContributors =
    a.contributors.length > 0
      ? mapAchievementContributors(a.contributors)
      : a.contributionRole
        ? [{
            id: `legacy-inline-${a.id}`,
            type: "INTERNAL" as const,
            userId: getCreditedUserId({
              reportedByUserId: a.reportedByUserId,
              oboReportedForUserId: a.oboReportedForUserId,
            }),
            userName: !a.isOBO ? reportedByUserName : null,
            externalName: null,
            externalAffiliation: null,
            externalScope: null,
            externalData: null,
            contributorRoleId: "legacy-inline",
            roleName: a.contributionRole,
            selectorTags: [],
            creditPercent: a.creditPercent ?? 0,
            isExcludedFromReward: false,
            note: null,
          }]
        : [];

  return {
    id: a.id,
    tenantId: a.tenantId,
    periodId: a.periodId,
    kpiDefinitionId: a.kpiDefinitionId,
    kpiTitle: a.kpiDefinition.title,
    targetAllocationId: a.targetAllocationId,
    reportedByUserId: a.reportedByUserId,
    reportedByUserName,
    isOBO: a.isOBO,
    oboReportedForUserId: a.oboReportedForUserId,
    title: a.title ?? null,
    contributionRole: a.contributionRole ?? null,
    creditPercent: a.creditPercent ?? null,
    effectiveScore: a.effectiveScore ?? null,
    stageCompletionScore: a.stageCompletionScore ?? null,
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
    contributors: mappedContributors,
    duplicateCheckResult: (a.duplicateCheckResult as AchievementView["duplicateCheckResult"]) ?? null,
    submissionTrail: mapSubmissionTrailRows(a.submissionTrail),
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
      contributors: { include: achievementContributorInclude },
      submissionTrail: { orderBy: { createdAt: "asc" } },
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
  const oboValidation = await validateOboRequest({
    tenantId,
    actorUserId,
    actorRole,
    isOBO: data.isOBO,
    oboReportedForUserId: data.oboReportedForUserId,
  });
  if (oboValidation) {
    return oboValidation;
  }
  const creditedUserId = getCreditedUserId({
    reportedByUserId: actorUserId,
    oboReportedForUserId: data.isOBO ? (data.oboReportedForUserId ?? null) : null,
  });

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
      _count: { select: { stages: true } },
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
    const actorContext = await getMyKpiContext(tenantId, actorUserId);
    let allowed = canRecord(
      {
        assignedToUnitId: allocation.assignedToUnitId,
        assignedToUserId: allocation.assignedToUserId,
        allocationType: kpi.allocationType,
        state: allocation.state,
        childCount: allocation._count.childAllocations,
        parentAllocationId: allocation.parentAllocationId,
      },
      actorContext,
      period.state,
    );
    if (!allowed && data.isOBO && data.oboReportedForUserId) {
      const beneficiaryContext = await getMyKpiContext(
        tenantId,
        data.oboReportedForUserId,
      );
      allowed = canRecord(
        {
          assignedToUnitId: allocation.assignedToUnitId,
          assignedToUserId: allocation.assignedToUserId,
          allocationType: kpi.allocationType,
          state: allocation.state,
          childCount: allocation._count.childAllocations,
          parentAllocationId: allocation.parentAllocationId,
        },
        beneficiaryContext,
        period.state,
      );
    }
    if (!allowed) {
      return {
        status: "error",
        message: "You are not allowed to record an achievement for this allocation.",
      };
    }
  }

  // Duplicate prevention (R1 / KPIs without stages): one achievement per allocation per review cycle
  if (data.targetAllocationId && kpi._count.stages === 0) {
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

  const result = await prisma.$transaction(async (tx) => {
    await ensureApplicableRolesBaseline(
      data.kpiDefinitionId,
      tenantId,
      kpi.contributionRoles,
      tx,
    );

    const achievement = await tx.achievement.create({
      data: {
        tenantId,
        periodId: data.periodId,
        kpiDefinitionId: data.kpiDefinitionId,
        targetAllocationId: data.targetAllocationId,
        reportedByUserId: actorUserId,
        oboReportedForUserId: data.isOBO ? data.oboReportedForUserId ?? null : null,
        isOBO: data.isOBO,
        title: data.title,
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
        effectiveScore:
          kpi._count.stages > 0
            ? null
            : calculateEffectiveScore(computedScoreValue, null),
        reportingDate,
      },
    });

    const contributorInputs =
      data.contributors ??
      (await buildStarterContributorInputs({
        tenantId,
        kpiDefinitionId: data.kpiDefinitionId,
        legacyContributionRoles: kpi.contributionRoles,
        userId: creditedUserId,
        preferredRoleName: data.contributionRole ?? null,
        tx,
      }));

    const contributorResult = await setAchievementContributors({
      achievementId: achievement.id,
      tenantId,
      kpiDefinitionId: data.kpiDefinitionId,
      legacyContributionRoles: kpi.contributionRoles,
      reportedByUserId: actorUserId,
      oboReportedForUserId: data.isOBO ? data.oboReportedForUserId ?? null : null,
      contributors: contributorInputs,
      tx,
    });
    const contributorError = contributorMutationToActionResult(contributorResult);
    if (contributorError) {
      return contributorError;
    }

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
          isOBO: data.isOBO,
        },
      },
    });

    return {
      status: "success",
      message: "Achievement recorded.",
      id: achievement.id,
    } satisfies KraKpiActionResult;
  });

  if (result.status !== "success") {
    return result;
  }

  if (
    result.id &&
    data.targetAllocationId &&
    kpi._count.stages > 0
  ) {
    await initializeStageProgress(
      result.id,
      data.targetAllocationId,
      data.kpiDefinitionId,
    );
    await calculateStageScore(result.id);
  }

  return result;
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
    include: {
      contributors: {
        select: { id: true },
      },
    },
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
    select: {
      measurementType: true,
      scoringMethod: true,
      scoringDirection: true,
      scoringConfig: true,
      measurementConfig: true,
      achievementFormConfig: true,
      contributionRoles: true,
      _count: { select: { stages: true } },
    },
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

  const stageBaseScore =
    achievement.stageCompletionScore != null ? achievement.stageCompletionScore : null;
  const effectiveScore =
    kpi && kpi._count.stages > 0
      ? calculateEffectiveScore(stageBaseScore, achievement.creditPercent)
      : calculateEffectiveScore(newScore, achievement.creditPercent);

  const result = await prisma.$transaction(async (tx) => {
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
        ...(data.title !== undefined && { title: data.title }),
        effectiveScore,
        computedScore: newScore,
        state: "DRAFT",
        rejectionReason: null,
        currentVerifierUnitId: null,
        currentVerifierUserId: null,
        verifiedByUserId: null,
        verifiedAt: null,
        verificationNote: null,
      },
    });

    await ensureApplicableRolesBaseline(
      achievement.kpiDefinitionId,
      tenantId,
      kpi?.contributionRoles ?? null,
      tx,
    );

    if (data.contributors !== undefined) {
      const contributorResult = await setAchievementContributors({
        achievementId,
        tenantId,
        kpiDefinitionId: achievement.kpiDefinitionId,
        legacyContributionRoles: kpi?.contributionRoles ?? null,
        reportedByUserId: achievement.reportedByUserId,
        oboReportedForUserId: achievement.oboReportedForUserId,
        contributors: data.contributors,
        tx,
      });
      const contributorError = contributorMutationToActionResult(contributorResult);
      if (contributorError) {
        return contributorError;
      }
    } else if (achievement.contributors.length === 0 && data.contributionRole !== undefined) {
      const starter = await buildStarterContributorInputs({
        tenantId,
        kpiDefinitionId: achievement.kpiDefinitionId,
        legacyContributionRoles: kpi?.contributionRoles ?? null,
        userId: getCreditedUserId({
          reportedByUserId: achievement.reportedByUserId,
          oboReportedForUserId: achievement.oboReportedForUserId,
        }),
        preferredRoleName: data.contributionRole,
        tx,
      });
      const contributorResult = await setAchievementContributors({
        achievementId,
        tenantId,
        kpiDefinitionId: achievement.kpiDefinitionId,
        legacyContributionRoles: kpi?.contributionRoles ?? null,
        reportedByUserId: achievement.reportedByUserId,
        oboReportedForUserId: achievement.oboReportedForUserId,
        contributors: starter,
        tx,
      });
      const contributorError = contributorMutationToActionResult(contributorResult);
      if (contributorError) {
        return contributorError;
      }
    }

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

    return { status: "success", message: "Achievement updated." } satisfies KraKpiActionResult;
  });

  return result;
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
    include: {
      kpiDefinition: {
        select: {
          title: true,
          startingUnitId: true,
          keyUnitId: true,
          finalUnitId: true,
          allowPartialCompletion: true,
          contributionRoles: true,
          achievementFormConfig: true,
          evidenceRequired: true,
          stages: { select: { id: true } },
        },
      },
      contributors: { include: achievementContributorInclude },
      targetAllocation: {
        select: { assignedToUnitId: true, assignedToUserId: true },
      },
    },
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

  if (achievement.reportedByUserId !== actorUserId) {
    return { status: "error", message: "Only the reporter can submit." };
  }

  const period = await prisma.assessmentPeriod.findFirst({
    where: { id: achievement.periodId, tenantId },
    select: { state: true },
  });
  if (!period || period.state !== "IN_PROGRESS") {
    return { status: "error", message: "Submissions are closed for this period." };
  }

  const kpi = achievement.kpiDefinition;
  const stageCount = kpi.stages.length;

  if (stageCount > 0) {
    const progresses = await prisma.kpiStageProgress.findMany({
      where: { achievementId },
    });
    const completed = progresses.filter((p) => p.isCompleted).length;
    if (!kpi.allowPartialCompletion && completed < stageCount) {
      return { status: "error", message: "Complete all stages before submitting." };
    }
    if (completed < 1) {
      return { status: "error", message: "Complete at least one stage before submitting." };
    }
    await calculateStageScore(achievementId);
  }

  if (kpi.evidenceRequired) {
    const files = achievement.evidenceFiles;
    const hasFiles = Array.isArray(files) && files.length > 0;
    const hasEvidence =
      achievement.evidenceLinks.length > 0
      || hasFiles
      || Boolean(achievement.evidenceDescription?.trim());
    if (!hasEvidence) {
      return { status: "error", message: "Evidence is required for this KPI." };
    }
  }

  const shouldBackfillLegacyContributors =
    achievement.contributors.length === 0 &&
    (achievement.contributionRole != null || achievement.creditPercent != null);
  if (!shouldBackfillLegacyContributors && achievement.contributors.length === 0) {
    return {
      status: "error",
      message: "Add at least one contributor before submitting.",
      code: "CONTRIBUTORS_REQUIRED",
    };
  }

  const duplicateCheckResult = await runDuplicateDetection({
    tenantId,
    periodId: achievement.periodId,
    kpiDefinitionId: achievement.kpiDefinitionId,
    achievementId,
    achievementTitle: achievement.title,
    achievementFormData:
      (achievement.achievementFormData as Record<string, unknown> | null) ?? null,
    formConfig:
      (kpi.achievementFormConfig as AchievementFormConfig | null) ?? null,
  });

  const actor = await prisma.user.findUnique({
    where: { id: actorUserId },
    select: { firstName: true, lastName: true },
  });
  const actorName = actor ? `${actor.firstName} ${actor.lastName}` : "Unknown";
  const actorUnitName = await getActorUnitName(tenantId, actorUserId);

  const existingLog = (achievement.verificationLog as VerificationLogEntry[]) ?? [];
  const newLogEntry: VerificationLogEntry = {
    level: "SUBMIT",
    userId: actorUserId,
    userName: actorName,
    action: "submitted",
    at: new Date().toISOString(),
  };

  const reviewUnitId = initialReviewUnitIdForKpi(kpi);
  const headIds = await resolveUnitHeadUserIds(tenantId, reviewUnitId);
  const firstHead = headIds[0] ?? null;

  const latest = await prisma.achievement.findFirst({
    where: { id: achievementId },
    select: {
      stageCompletionScore: true,
      effectiveScore: true,
      computedScore: true,
      creditPercent: true,
    },
  });

  const baseScore =
    stageCount > 0
      ? (latest?.stageCompletionScore ?? 0)
      : (latest?.computedScore ?? 0);
  const scoreForTrail = baseScore;

  const nextEffective =
    stageCount === 0
      ? calculateEffectiveScore(latest?.computedScore ?? null, latest?.creditPercent ?? null)
      : latest?.effectiveScore ?? null;

  const result = await prisma.$transaction(async (tx) => {
    await ensureApplicableRolesBaseline(
      achievement.kpiDefinitionId,
      tenantId,
      kpi.contributionRoles,
      tx,
    );

    if (shouldBackfillLegacyContributors) {
      const ensureResult = await ensureAchievementContributorRows({
        achievementId,
        tenantId,
        kpiDefinitionId: achievement.kpiDefinitionId,
        legacyContributionRoles: kpi.contributionRoles,
        reportedByUserId: achievement.reportedByUserId,
        oboReportedForUserId: achievement.oboReportedForUserId,
        contributionRole: achievement.contributionRole,
        tx,
      });
      const ensureError = contributorMutationToActionResult(ensureResult);
      if (ensureError) {
        return ensureError;
      }
    } else {
      const contributorResult = await setAchievementContributors({
        achievementId,
        tenantId,
        kpiDefinitionId: achievement.kpiDefinitionId,
        legacyContributionRoles: kpi.contributionRoles,
        reportedByUserId: achievement.reportedByUserId,
        oboReportedForUserId: achievement.oboReportedForUserId,
        contributors: achievement.contributors.map((contributor) => ({
          type: contributor.type,
          userId: contributor.userId ?? undefined,
          externalName: contributor.externalName ?? undefined,
          externalAffiliation: contributor.externalAffiliation ?? undefined,
          externalScope: contributor.externalScope ?? undefined,
          externalData:
            (contributor.externalData as Record<string, unknown> | null) ?? undefined,
          contributorRoleId: contributor.contributorRoleId,
          isExcludedFromReward: contributor.isExcludedFromReward,
          note: contributor.note ?? undefined,
        })),
        tx,
      });
      const contributorError = contributorMutationToActionResult(contributorResult);
      if (contributorError) {
        return contributorError;
      }
    }

    const contributorCount = await tx.achievementContributor.count({
      where: { achievementId },
    });
    if (contributorCount === 0) {
      return {
        status: "error",
        message: "Add at least one contributor before submitting.",
        code: "CONTRIBUTORS_REQUIRED",
      } satisfies KraKpiActionResult;
    }

    await tx.achievement.update({
      where: { id: achievementId },
      data: {
        state: "SUBMITTED",
        verificationLog: [...existingLog, newLogEntry] as unknown as object[],
        currentVerifierUnitId: reviewUnitId,
        currentVerifierUserId: firstHead,
        duplicateCheckResult: duplicateCheckResult as unknown as object,
        ...(stageCount === 0
          ? { effectiveScore: nextEffective, stageCompletionScore: null }
          : {
              effectiveScore: latest?.effectiveScore,
              stageCompletionScore: latest?.stageCompletionScore,
            }),
      },
    });

    await appendSubmissionTrailEntry(tx, {
      achievementId,
      action: "SUBMITTED",
      actorUserId,
      actorName,
      actorRole: roleToTrailLabel(actorRole),
      actorUnitName,
      scoreAtAction: scoreForTrail,
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

    return {
      status: "success",
      message: "Achievement submitted for verification.",
    } satisfies KraKpiActionResult;
  });

  if (result.status !== "success") {
    return result;
  }

  try {
    const title = achievement.title ?? kpi.title;
    const notifyIds = headIds.filter((id) => id !== actorUserId);
    if (notifyIds.length > 0) {
      await createBulkNotifications(
        tenantId,
        notifyIds,
        "ACHIEVEMENT_SUBMITTED",
        "Achievement submitted for review",
        `${actorName} submitted "${title}" for review`,
        "Achievement",
        achievementId,
        "/my-kpis",
      );
    }
  } catch (err) {
    console.warn("[achievement-service] submitForVerification notification failed:", err);
  }

  return result;
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
          keyUnitId: true,
          finalUnitId: true,
          title: true,
          stages: { select: { id: true } },
        },
      },
      targetAllocation: {
        select: {
          targetValue: true,
          targetDate: true,
          targetMilestone: true,
          targetGrade: true,
          targetBoolean: true,
          targetRating: true,
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

  const twoStep = kpiHasTwoStepReview(achievement.kpiDefinition);
  const reviewUnitId = currentReviewUnitIdForAchievement({
    state: achievement.state,
    currentVerifierUnitId: achievement.currentVerifierUnitId,
    kpiDefinition: achievement.kpiDefinition,
  });

  if (!isAdminOrOwner(actorRole)) {
    if (twoStep && achievement.state === "SUBMITTED") {
      return {
        status: "error",
        message: "This achievement must be recommended before final verification.",
      };
    }

    const canVerify = await canActorReviewUnit(
      tenantId,
      actorUserId,
      reviewUnitId,
    );
    if (!canVerify) {
      return {
        status: "error",
        message: "You do not have permission to verify this achievement.",
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

  const stageCount = achievement.kpiDefinition.stages.length;

  // Recompute score on approve for non-stage KPIs.
  let finalScore = achievement.computedScore;
  if (approved && stageCount === 0 && achievement.targetAllocation) {
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
  const finalEffectiveScore = approved
    ? (stageCount > 0
        ? calculateEffectiveScore(achievement.stageCompletionScore, achievement.creditPercent)
        : calculateEffectiveScore(finalScore, achievement.creditPercent))
    : achievement.effectiveScore;

  const actorUnitNameV = await getActorUnitName(tenantId, actorUserId);

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
        effectiveScore: approved ? finalEffectiveScore : achievement.effectiveScore,
        verificationLog: [...existingLog, logEntry] as unknown as object[],
        currentVerifierUnitId: null,
        currentVerifierUserId: null,
      },
    });

    await appendSubmissionTrailEntry(tx, {
      achievementId,
      action: approved ? "APPROVED" : "REJECTED",
      actorUserId,
      actorName,
      actorRole: roleToTrailLabel(actorRole),
      actorUnitName: actorUnitNameV,
      note,
      scoreAtAction: approved
        ? (finalEffectiveScore ?? finalScore)
        : (achievement.effectiveScore
            ?? achievement.stageCompletionScore
            ?? achievement.computedScore),
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
        const scoreToDisplay = finalEffectiveScore ?? finalScore;
        const scoreText =
          scoreToDisplay != null ? ` Score: ${Math.round(scoreToDisplay)}` : "";
        await createNotification(
          tenantId,
          reporterId,
          "ACHIEVEMENT_APPROVED",
          "Achievement approved",
          `'${kpiTitle}' achievement has been approved!${scoreText}`,
          "Achievement",
          achievementId,
          "/my-kpis",
        );
      } else {
        await createNotification(
          tenantId,
          reporterId,
          "ACHIEVEMENT_REJECTED",
          "Achievement rejected",
          `'${kpiTitle}' was rejected.${note ? ` Reason: ${note}` : ""}`,
          "Achievement",
          achievementId,
          "/my-kpis",
        );
      }
    }
  } catch (err) {
    console.warn("[achievement-service] verifyAchievement notification failed:", err);
  }

  if (approved) {
    try {
      await syncContributorRewardsForAchievement(
        achievementId,
        tenantId,
        actorUserId,
        actorRole,
      );
    } catch (err) {
      console.warn("[achievement-service] verifyAchievement reward sync failed:", err);
    }
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
      kpiDefinition: {
        select: {
          startingUnitId: true,
          title: true,
          keyUnitId: true,
          finalUnitId: true,
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

  const twoStep = kpiHasTwoStepReview(achievement.kpiDefinition);
  if (!twoStep) {
    return {
      status: "error",
      message: "This achievement should be verified directly.",
    };
  }

  if (!isAdminOrOwner(actorRole)) {
    const canRecommend = await canActorReviewUnit(
      tenantId,
      actorUserId,
      currentReviewUnitIdForAchievement({
        state: achievement.state,
        currentVerifierUnitId: achievement.currentVerifierUnitId,
        kpiDefinition: achievement.kpiDefinition,
      }),
    );
    if (!canRecommend) {
      return {
        status: "error",
        message: "Only the configured first-review unit head can recommend this achievement.",
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

    const finalUnitId = finalReviewUnitIdForKpi(achievement.kpiDefinition);
    const finalHeadIds = await resolveUnitHeadUserIds(tenantId, finalUnitId);
    const nextVerifier = finalHeadIds[0] ?? null;

    const actorUnitNameR = await getActorUnitName(tenantId, actorUserId);

    await prisma.$transaction(async (tx) => {
      await tx.achievement.update({
        where: { id: achievementId },
        data: {
          state: "RECOMMENDED",
          recommendedByUserId: actorUserId,
          recommendedAt: new Date(),
          recommendationNote: note,
          verificationLog: [...existingLog, logEntry] as unknown as object[],
          currentVerifierUnitId: finalUnitId,
          currentVerifierUserId: nextVerifier,
        },
      });

      await appendSubmissionTrailEntry(tx, {
        achievementId,
        action: "RECOMMENDED",
        actorUserId,
        actorName,
        actorRole: roleToTrailLabel(actorRole),
        actorUnitName: actorUnitNameR,
        note: note ?? "Recommended",
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

    try {
      const notifyIds = finalHeadIds.filter((id) => id !== actorUserId);
      if (notifyIds.length > 0) {
        await createBulkNotifications(
          tenantId,
          notifyIds,
          "ACHIEVEMENT_RECOMMENDED",
          "Achievement recommended for verification",
          `${actorName} recommended '${achievement.kpiDefinition?.title ?? ""}' — ready for verification`,
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

  const logEntry: VerificationLogEntry = {
    level: "REJECT",
    userId: actorUserId,
    userName: actorName,
    action: "rejected",
    note: note ?? undefined,
    at: new Date().toISOString(),
  };

  const actorUnitNameR = await getActorUnitName(tenantId, actorUserId);

  await prisma.$transaction(async (tx) => {
    await tx.achievement.update({
      where: { id: achievementId },
      data: {
        state: "REJECTED",
        rejectionReason: note ?? "Rejected during recommendation",
        verificationLog: [...existingLog, logEntry] as unknown as object[],
        currentVerifierUnitId: null,
        currentVerifierUserId: null,
      },
    });

    await appendSubmissionTrailEntry(tx, {
      achievementId,
      action: "REJECTED",
      actorUserId,
      actorName,
      actorRole: roleToTrailLabel(actorRole),
      actorUnitName: actorUnitNameR,
      note,
      scoreAtAction:
        achievement.effectiveScore
        ?? achievement.stageCompletionScore
        ?? achievement.computedScore,
    });

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "Achievement",
        targetId: achievementId,
        action: "REJECT",
        previousState: { state: "SUBMITTED" },
        newState: { state: "REJECTED", note },
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
        "ACHIEVEMENT_REJECTED",
        "Achievement rejected",
        `Your '${kpiTitle}' submission was rejected. ${note ? `Reason: ${note}` : "Please revise and resubmit."}`,
        "Achievement",
        achievementId,
        "/my-kpis",
      );
    }
  } catch (err) {
    console.warn("[achievement-service] recommendAchievement rejection notification failed:", err);
  }

  return { status: "success", message: "Achievement rejected. Reporter can revise and resubmit." };
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
  const actorUnitName = await getActorUnitName(tenantId, actorUserId);
  const reviewHeadIds = achievement.currentVerifierUnitId
    ? await resolveUnitHeadUserIds(tenantId, achievement.currentVerifierUnitId)
    : [];

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
        currentVerifierUnitId: null,
        currentVerifierUserId: null,
      },
    });

    await appendSubmissionTrailEntry(tx, {
      achievementId,
      action: "WITHDRAWN",
      actorUserId,
      actorName,
      actorRole: "Employee",
      actorUnitName,
      scoreAtAction:
        achievement.effectiveScore
        ?? achievement.stageCompletionScore
        ?? achievement.computedScore,
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

  try {
    const notifyIds = reviewHeadIds.filter((id) => id !== actorUserId);
    if (notifyIds.length > 0) {
      await createBulkNotifications(
        tenantId,
        notifyIds,
        "ACHIEVEMENT_WITHDRAWN",
        "Achievement withdrawn",
        `${actorName} withdrew a submission that was awaiting review.`,
        "Achievement",
        achievementId,
        "/my-kpis",
      );
    }
  } catch (err) {
    console.warn("[achievement-service] withdrawAchievement notification failed:", err);
  }

  return { status: "success", message: "Submission withdrawn. You can edit and resubmit." };
}

// ── Dashboard Summary ────────────────────────────────────────────────────────

export async function resubmitAchievement(
  achievementId: string,
  tenantId: string,
  actorUserId: string,
): Promise<KraKpiActionResult> {
  const achievement = await prisma.achievement.findFirst({
    where: { id: achievementId, tenantId },
    include: {
      kpiDefinition: { select: { title: true } },
    },
  });
  if (!achievement) {
    return { status: "error", message: "Achievement not found." };
  }

  if (achievement.state !== "REJECTED") {
    return {
      status: "error",
      message: `Only rejected achievements can be resubmitted from "${achievement.state}".`,
    };
  }

  if (achievement.reportedByUserId !== actorUserId) {
    return { status: "error", message: "Only the reporter can resubmit." };
  }

  const period = await prisma.assessmentPeriod.findFirst({
    where: { id: achievement.periodId, tenantId },
    select: { state: true },
  });
  if (!period || period.state !== "IN_PROGRESS") {
    return {
      status: "error",
      message: "Resubmission is only allowed while the period is in progress.",
    };
  }

  const actor = await prisma.user.findUnique({
    where: { id: actorUserId },
    select: { firstName: true, lastName: true },
  });
  const actorName = actor ? `${actor.firstName} ${actor.lastName}` : "Unknown";
  const actorUnitName = await getActorUnitName(tenantId, actorUserId);
  const log = (achievement.verificationLog as VerificationLogEntry[]) ?? [];
  const logEntry: VerificationLogEntry = {
    level: "RESUBMIT",
    userId: actorUserId,
    userName: actorName,
    action: "resubmitted",
    at: new Date().toISOString(),
  };

  await prisma.$transaction(async (tx) => {
    await tx.achievement.update({
      where: { id: achievementId },
      data: {
        state: "DRAFT",
        rejectionReason: null,
        recommendedByUserId: null,
        recommendedAt: null,
        recommendationNote: null,
        verifiedByUserId: null,
        verifiedAt: null,
        verificationNote: null,
        currentVerifierUnitId: null,
        currentVerifierUserId: null,
        verificationLog: [...log, logEntry] as unknown as object[],
      },
    });

    await appendSubmissionTrailEntry(tx, {
      achievementId,
      action: "RESUBMITTED",
      actorUserId,
      actorName,
      actorRole: "Employee",
      actorUnitName,
      scoreAtAction:
        achievement.effectiveScore
        ?? achievement.stageCompletionScore
        ?? achievement.computedScore,
    });

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole: "TENANT_USER",
        targetType: "Achievement",
        targetId: achievementId,
        action: "RESUBMIT",
        previousState: { state: "REJECTED" },
        newState: { state: "DRAFT" },
      },
    });
  });

  return {
    status: "success",
    message: "Achievement moved back to draft. Review changes and submit again.",
  };
}

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
  const oboValidation = await validateOboRequest({
    tenantId,
    actorUserId,
    actorRole,
    isOBO: data.isOBO,
    oboReportedForUserId: data.oboReportedForUserId,
  });
  if (oboValidation) {
    return oboValidation;
  }
  const creditedUserId = getCreditedUserId({
    reportedByUserId: actorUserId,
    oboReportedForUserId: data.isOBO ? (data.oboReportedForUserId ?? null) : null,
  });

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
    where: {
      id: data.kpiDefinitionId,
      kraDefinition: {
        tenantId,
        periodId: data.periodId,
      },
    },
    include: {
      kraDefinition: { select: { state: true } },
      _count: { select: { stages: true } },
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

  // Block if user already has an allocated target for this KPI
  const ctx = await getMyKpiContext(tenantId, creditedUserId);
  const headUnitIds = ctx.headOfUnits.map((u) => u.unitId);
  const existingAllocation = await prisma.targetAllocation.findFirst({
    where: {
      tenantId,
      periodId: data.periodId,
      kpiDefinitionId: data.kpiDefinitionId,
      OR: [
        { assignedToUserId: creditedUserId },
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

  const existingAdditional = await findExistingAdditionalAchievementForCycle({
    tenantId,
    periodId: data.periodId,
    kpiDefinitionId: data.kpiDefinitionId,
    subjectUserId: creditedUserId,
    reportingDate,
    period,
  });
  if (existingAdditional) {
    return {
      status: "error",
      message:
        "You already have an additional achievement for this KPI in the current review cycle. Edit the existing one.",
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

  const result = await prisma.$transaction(async (tx) => {
    await ensureApplicableRolesBaseline(
      data.kpiDefinitionId,
      tenantId,
      kpi.contributionRoles,
      tx,
    );

    const achievement = await tx.achievement.create({
      data: {
        tenantId,
        periodId: data.periodId,
        kpiDefinitionId: data.kpiDefinitionId,
        targetAllocationId: null,
        reportedByUserId: actorUserId,
        oboReportedForUserId: data.isOBO ? data.oboReportedForUserId ?? null : null,
        isOBO: data.isOBO,
        title: data.title,
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
        effectiveScore:
          kpi._count.stages > 0
            ? null
            : calculateEffectiveScore(computedScoreValue, null),
        reportingDate,
      },
    });

    const contributorInputs =
      data.contributors ??
      (await buildStarterContributorInputs({
        tenantId,
        kpiDefinitionId: data.kpiDefinitionId,
        legacyContributionRoles: kpi.contributionRoles,
        userId: creditedUserId,
        preferredRoleName: data.contributionRole ?? null,
        tx,
      }));
    const contributorResult = await setAchievementContributors({
      achievementId: achievement.id,
      tenantId,
      kpiDefinitionId: data.kpiDefinitionId,
      legacyContributionRoles: kpi.contributionRoles,
      reportedByUserId: actorUserId,
      oboReportedForUserId: data.isOBO ? data.oboReportedForUserId ?? null : null,
      contributors: contributorInputs,
      tx,
    });
    const contributorError = contributorMutationToActionResult(contributorResult);
    if (contributorError) {
      return contributorError;
    }

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
          isOBO: data.isOBO,
        },
      },
    });

    return {
      status: "success",
      message: "Additional achievement recorded.",
      id: achievement.id,
    } satisfies KraKpiActionResult;
  });

  return result;
}
