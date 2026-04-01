import type { GradeValue, MilestoneStatus } from "@prisma/client";
import { computeScore } from "./scoring-service";
import type {
  AllocationAchievementAggregateView,
  KpiDefinitionView,
  MeasurementConfig,
  ScoringConfig,
} from "./shared";

type AchievementLike = {
  id?: string;
  state: "DRAFT" | "SUBMITTED" | "RECOMMENDED" | "VERIFIED" | "REJECTED" | string;
  title?: string | null;
  actualValue?: number | null;
  actualRating?: number | null;
  effectiveScore?: number | null;
  stageCompletionScore?: number | null;
  computedScore?: number | null;
  reportingDate?: Date | null;
  createdAt?: Date | null;
  stageProgress?: Array<{ isCompleted: boolean }>;
};

export type AggregateAllocationTarget = {
  targetValue: number | null;
  targetDate?: Date | null;
  targetMilestone?: MilestoneStatus | null;
  targetGrade?: GradeValue | null;
  targetBoolean?: boolean | null;
  targetRating?: number | null;
};

export function scoreFromAchievement(
  achievement: Pick<AchievementLike, "effectiveScore" | "stageCompletionScore" | "computedScore"> | null | undefined,
): number {
  return achievement?.effectiveScore
    ?? achievement?.stageCompletionScore
    ?? achievement?.computedScore
    ?? 0;
}

export function deriveAchievementTitle(input: {
  explicitTitle?: string | null;
  formData?: Record<string, unknown> | null | undefined;
  kpiTitle: string;
  reportingDate?: Date | null | undefined;
}): string {
  const formData = input.formData ?? {};
  const preferredKeys = [
    "paperTitle",
    "patentTitle",
    "bookTitle",
    "projectTitle",
    "conferenceName",
  ];

  for (const key of preferredKeys) {
    const value = formData[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim().slice(0, 200);
    }
  }

  if (typeof input.explicitTitle === "string" && input.explicitTitle.trim()) {
    return input.explicitTitle.trim().slice(0, 200);
  }

  const formTitle = formData.title;
  if (typeof formTitle === "string" && formTitle.trim()) {
    return formTitle.trim().slice(0, 200);
  }

  const date = input.reportingDate ?? new Date();
  const dateLabel = Number.isNaN(date.getTime()) ? "" : ` - ${date.toISOString().slice(0, 10)}`;
  return `${input.kpiTitle}${dateLabel}`.slice(0, 200);
}

export function buildAllocationAchievementAggregate(input: {
  allowMultipleAchievementsPerAllocation: boolean;
  achievements: AchievementLike[];
  measurementType: KpiDefinitionView["measurementType"];
  scoringMethod: KpiDefinitionView["scoringMethod"];
  scoringDirection: KpiDefinitionView["scoringDirection"];
  scoringConfig: ScoringConfig | null;
  measurementConfig: MeasurementConfig | null;
  target: AggregateAllocationTarget;
}): AllocationAchievementAggregateView {
  const countsByState = {
    draft: 0,
    submitted: 0,
    recommended: 0,
    verified: 0,
    rejected: 0,
  };

  for (const achievement of input.achievements) {
    switch (achievement.state) {
      case "DRAFT":
        countsByState.draft += 1;
        break;
      case "SUBMITTED":
        countsByState.submitted += 1;
        break;
      case "RECOMMENDED":
        countsByState.recommended += 1;
        break;
      case "VERIFIED":
        countsByState.verified += 1;
        break;
      case "REJECTED":
        countsByState.rejected += 1;
        break;
      default:
        break;
    }
  }

  if (!input.allowMultipleAchievementsPerAllocation) {
    const latest = input.achievements[0] ?? null;
    return {
      isMultiRequestEnabled: false,
      officialActualValue: latest?.actualRating ?? latest?.actualValue ?? 0,
      officialScore: latest ? scoreFromAchievement(latest) : null,
      totalRequests: input.achievements.length,
      countsByState,
    };
  }

  let officialScore: number | null = null;
  if (
    input.measurementType === "NUMERIC" &&
    input.target.targetValue != null
  ) {
    officialScore = computeScore(
      input.measurementType,
      input.scoringMethod,
      input.scoringDirection,
      input.scoringConfig,
      input.measurementConfig,
      {
        targetValue: input.target.targetValue,
        targetDate: input.target.targetDate ?? null,
        targetMilestone: input.target.targetMilestone ?? null,
        targetGrade: input.target.targetGrade ?? null,
        targetBoolean: input.target.targetBoolean ?? null,
        targetRating: input.target.targetRating ?? null,
        actualValue: countsByState.verified,
        actualDate: null,
        actualMilestone: null,
        actualGrade: null,
        actualBoolean: null,
        actualRating: null,
      },
    );
  }

  return {
    isMultiRequestEnabled: true,
    officialActualValue: countsByState.verified,
    officialScore,
    totalRequests: input.achievements.length,
    countsByState,
  };
}

export function isAllocationOfficiallyComplete(input: {
  allowMultipleAchievementsPerAllocation: boolean;
  aggregate: AllocationAchievementAggregateView;
  targetValue: number | null;
  achievements?: AchievementLike[];
}): boolean {
  if (!input.allowMultipleAchievementsPerAllocation) {
    return (input.achievements ?? []).some((achievement) => achievement.state === "VERIFIED");
  }

  if (input.targetValue != null && input.targetValue > 0) {
    return input.aggregate.officialActualValue >= input.targetValue;
  }

  return input.aggregate.countsByState.verified > 0;
}

export function summarizeAllocationLifecycle(input: {
  allowMultipleAchievementsPerAllocation: boolean;
  achievements: AchievementLike[];
  aggregate?: AllocationAchievementAggregateView | null;
  targetValue?: number | null;
}): "notStarted" | "inProgress" | "pendingReview" | "completed" | "notApproved" {
  const aggregate =
    input.aggregate
    ?? buildAllocationAchievementAggregate({
      allowMultipleAchievementsPerAllocation: input.allowMultipleAchievementsPerAllocation,
      achievements: input.achievements,
      measurementType: "NUMERIC",
      scoringMethod: "LINEAR",
      scoringDirection: "ASCENDING",
      scoringConfig: null,
      measurementConfig: null,
      target: { targetValue: null },
    });

  if (aggregate.totalRequests === 0) {
    return "notStarted";
  }
  if (isAllocationOfficiallyComplete({
    allowMultipleAchievementsPerAllocation: input.allowMultipleAchievementsPerAllocation,
    aggregate,
    targetValue: input.targetValue ?? null,
    achievements: input.achievements,
  })) {
    return "completed";
  }
  if (aggregate.countsByState.submitted > 0 || aggregate.countsByState.recommended > 0) {
    return "pendingReview";
  }
  if (aggregate.countsByState.draft > 0 || aggregate.countsByState.verified > 0) {
    return "inProgress";
  }
  return "notApproved";
}
