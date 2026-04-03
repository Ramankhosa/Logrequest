import type {
  KpiMeasurementType,
  KraCategoryScope,
  AssessmentPeriodState,
  AssessmentPeriodType,
  ReviewCycleFrequency,
  KraDefinitionState,
  KpiDefinitionState,
  KpiAllocationType,
  TargetAllocationState,
  AchievementState,
  ScoringMethod,
  ScoringDirection,
  MilestoneStatus,
  GradeValue,
} from "@prisma/client";
import { z } from "zod";

// ── Action Result ────────────────────────────────────────────────────────────

export type KraKpiActionResult = {
  status: "idle" | "success" | "error";
  message: string;
  id?: string;
  code?: string;
};

export const initialKraKpiActionResult: KraKpiActionResult = {
  status: "idle",
  message: "",
};

const kraKpiErrorStatusMap: Record<string, number> = {
  PERMISSION_DENIED: 403,
  KPI_NOT_FOUND: 404,
  PERIOD_NOT_FOUND: 404,
  UNIT_NOT_FOUND: 404,
  TARGET_UNIT_NOT_FOUND: 404,
  DUPLICATE_TARGET_UNIT: 409,
  TARGET_UNIT_HAS_ALLOCATIONS: 409,
  TARGET_UNITS_NOT_CONFIGURED: 409,
  KPI_ARCHIVED: 409,
  KPI_INACTIVE: 409,
  KRA_INACTIVE: 409,
  PERIOD_STATE_CONFLICT: 409,
  SOURCE_PERIOD_EMPTY: 409,
  TARGET_PERIOD_NOT_EMPTY: 409,
  TARGET_UNIT_ORIGIN_CONFLICT: 409,
  REVIEW_CYCLE_CONFLICT: 409,
  DUPLICATE_CODE: 409,
  ROLE_IN_USE: 409,
  ROLE_IN_USE_ACHIEVEMENTS: 409,
  ROLE_LAST_APPLICABLE: 409,
  BENEFIT_TYPE_NOT_FOUND: 404,
  CONTRIBUTOR_ROLE_NOT_FOUND: 404,
  CONTRIBUTOR_NOT_FOUND: 404,
  APPLICABLE_ROLES_REQUIRED: 400,
  ROLE_WRONG_TENANT: 400,
  APPLICABLE_ROLES_DEFAULT: 400,
  APPLICABLE_ROLES_DUPLICATE: 400,
  ROLE_ARCHIVED: 400,
  CONTRIBUTOR_DRAFT_ONLY: 409,
  CONTRIBUTOR_DUPLICATE_USER: 409,
  CONTRIBUTOR_EXTERNAL_NOT_ALLOWED: 403,
  CONTRIBUTOR_ROLE_NOT_APPLICABLE: 400,
  CONTRIBUTORS_REQUIRED: 400,
  OBO_BENEFICIARY_REQUIRED: 400,
  EXTERNAL_TEMPLATE_NOT_FOUND: 404,
  EXTERNAL_TEMPLATE_IN_USE: 409,
  EXTERNAL_TEMPLATE_LAST_DEFAULT: 409,
  EXTERNAL_TEMPLATE_WRONG_TENANT: 400,
  EXTERNAL_TEMPLATE_ARCHIVED: 400,
  KPI_TEMPLATE_NOT_FOUND: 404,
  KPI_TEMPLATE_WRONG_TENANT: 400,
  KPI_COPY_SOURCE_NOT_FOUND: 404,
  REWARD_CONFIG_INVALID: 400,
};

export function getKraKpiActionHttpStatus(
  result: KraKpiActionResult,
  successStatus = 200,
): number {
  if (result.status === "success") {
    return successStatus;
  }

  if (result.code && result.code in kraKpiErrorStatusMap) {
    return kraKpiErrorStatusMap[result.code];
  }

  return 400;
}

// ── Measurement Config Zod Schemas (discriminated unions) ────────────────────

export const numericMeasurementConfigSchema = z.object({
  type: z.literal("NUMERIC"),
  minValue: z.number().optional(),
  maxValue: z.number().optional(),
  decimalPlaces: z.number().int().min(0).max(4).default(0),
});

export const percentageMeasurementConfigSchema = z.object({
  type: z.literal("PERCENTAGE"),
  minValue: z.number().min(0).default(0),
  maxValue: z.number().max(100).default(100),
  decimalPlaces: z.number().int().min(0).max(2).default(1),
});

export const currencyMeasurementConfigSchema = z.object({
  type: z.literal("CURRENCY"),
  currencyCode: z.string().length(3).default("INR"),
  minValue: z.number().min(0).default(0),
  maxValue: z.number().optional(),
  decimalPlaces: z.number().int().min(0).max(2).default(2),
});

export const booleanMeasurementConfigSchema = z.object({
  type: z.literal("BOOLEAN"),
  trueLabel: z.string().default("Yes"),
  falseLabel: z.string().default("No"),
});

export const ratingMeasurementConfigSchema = z.object({
  type: z.literal("RATING"),
  minRating: z.number().int().min(1).default(1),
  maxRating: z.number().int().min(2).max(10).default(5),
  labels: z.record(z.string(), z.string()).optional(), // {"1": "Poor", "5": "Excellent"}
});

export const milestoneMeasurementConfigSchema = z.object({
  type: z.literal("MILESTONE"),
  // No extra config needed — uses MilestoneStatus enum
});

export const dateTargetMeasurementConfigSchema = z.object({
  type: z.literal("DATE_TARGET"),
  allowEarly: z.boolean().default(true),
  gracePeriodDays: z.number().int().min(0).default(0),
  latePenaltyEnabled: z.boolean().default(false),
  latePenaltyPercentPerDay: z.number().min(0).max(100).default(5),
});

export const gradeMeasurementConfigSchema = z.object({
  type: z.literal("GRADE"),
  // Uses GradeValue enum. Optional custom labels:
  customLabels: z.record(z.string(), z.string()).optional(),
});

export const measurementConfigSchema = z.discriminatedUnion("type", [
  numericMeasurementConfigSchema,
  percentageMeasurementConfigSchema,
  currencyMeasurementConfigSchema,
  booleanMeasurementConfigSchema,
  ratingMeasurementConfigSchema,
  milestoneMeasurementConfigSchema,
  dateTargetMeasurementConfigSchema,
  gradeMeasurementConfigSchema,
]);

export type MeasurementConfig = z.infer<typeof measurementConfigSchema>;

export function supportsMeasurementCap(
  measurementType: KpiMeasurementType | string,
): boolean {
  return (
    measurementType === "NUMERIC" ||
    measurementType === "PERCENTAGE" ||
    measurementType === "CURRENCY" ||
    measurementType === "RATING"
  );
}

export function getMeasurementCapValue(
  measurementType: KpiMeasurementType | string,
  measurementConfig: MeasurementConfig | null | undefined,
): number | null {
  if (!measurementConfig) return null;

  switch (measurementType) {
    case "NUMERIC":
      return measurementConfig.type === "NUMERIC" && measurementConfig.maxValue != null
        ? measurementConfig.maxValue
        : null;
    case "PERCENTAGE":
      return measurementConfig.type === "PERCENTAGE" && measurementConfig.maxValue != null
        ? measurementConfig.maxValue
        : null;
    case "CURRENCY":
      return measurementConfig.type === "CURRENCY" && measurementConfig.maxValue != null
        ? measurementConfig.maxValue
        : null;
    case "RATING":
      return measurementConfig.type === "RATING" && measurementConfig.maxRating != null
        ? measurementConfig.maxRating
        : null;
    default:
      return null;
  }
}

export function getMeasurementCapField(
  measurementType: KpiMeasurementType | string,
): "targetValue" | "targetRating" | null {
  if (
    measurementType === "NUMERIC" ||
    measurementType === "PERCENTAGE" ||
    measurementType === "CURRENCY"
  ) {
    return "targetValue";
  }
  if (measurementType === "RATING") {
    return "targetRating";
  }
  return null;
}

// ── Scoring Config Zod Schemas (discriminated unions) ────────────────────────

export const linearScoringConfigSchema = z.object({
  method: z.literal("LINEAR"),
  capAt100: z.boolean().default(true), // cap score at 100 even if over-achieved
});

export const thresholdScoringConfigSchema = z.object({
  method: z.literal("THRESHOLD"),
  thresholdValue: z.number(),
  belowScore: z.number().min(0).max(100).default(0),
  aboveScore: z.number().min(0).max(100).default(100),
});

export const slabScoringConfigSchema = z.object({
  method: z.literal("SLAB"),
  slabs: z.array(
    z.object({
      minPercent: z.number().min(0),
      maxPercent: z.number().min(0),
      score: z.number().min(0).max(100),
    })
  ).min(1),
});

export const scoringConfigSchema = z.discriminatedUnion("method", [
  linearScoringConfigSchema,
  thresholdScoringConfigSchema,
  slabScoringConfigSchema,
]);

export type ScoringConfig = z.infer<typeof scoringConfigSchema>;

// ── View Types ───────────────────────────────────────────────────────────────

export type KraCategoryView = {
  id: string;
  tenantId: string | null;
  scope: KraCategoryScope;
  categoryKey: string;
  displayLabel: string;
  description: string | null;
  iconName: string | null;
  colorHex: string | null;
  sortOrder: number;
  isActive: boolean;
  kraCount: number;
  createdAt: Date;
};

export type AssessmentPeriodView = {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  periodType: AssessmentPeriodType;
  startDate: Date;
  endDate: Date;
  state: AssessmentPeriodState;
  reviewFrequency: ReviewCycleFrequency;
  targetSettingDeadline: Date | null;
  achievementDeadline: Date | null;
  reviewDeadline: Date | null;
  description: string | null;
  kraCount: number;
  reviewCycleCount: number;
  createdAt: Date;
};

export type KraDefinitionView = {
  id: string;
  tenantId: string;
  periodId: string;
  periodName: string;
  categoryId: string | null;
  categoryLabel: string | null;
  title: string;
  description: string | null;
  weightage: number;
  state: KraDefinitionState;
  sortOrder: number;
  kpiCount: number;
  kpiWeightageSum: number;
  activeKpiCount: number;
  activeKpiWeightageSum: number;
  draftKpiCount: number;
  createdAt: Date;
};

export type KpiDefinitionView = {
  id: string;
  kraDefinitionId: string;
  kraTitle: string;
  kraState: KraDefinitionState;
  title: string;
  description: string | null;
  measurementType: KpiMeasurementType;
  unitLabel: string | null;
  weightage: number;
  defaultTarget: number | null;
  measurementConfig: MeasurementConfig | null;
  scoringMethod: ScoringMethod;
  scoringDirection: ScoringDirection;
  scoringConfig: ScoringConfig | null;
  isPerCapita: boolean;
  allocationType: KpiAllocationType;
  startingUnitId: string;
  startingUnitName: string;
  achievementTemplateKey: string | null;
  achievementFormConfig: AchievementFormConfig | null;
  state: KpiDefinitionState;
  sortOrder: number;
  guidanceNotes: string | null;
  allocationCount: number;
  // ── R2 fields ──
  keyUnitId: string | null;
  keyUnitName: string | null;
  finalUnitId: string | null;
  finalUnitName: string | null;
  keyReviewerUserId: string | null;
  keyReviewerUserName: string | null;
  keyReviewerValid: boolean;
  keyReviewerWarning: string | null;
  finalReviewerUserId: string | null;
  finalReviewerUserName: string | null;
  finalReviewerValid: boolean;
  finalReviewerWarning: string | null;
  workflowWarnings: string[];
  targetUnitCount: number;
  accreditationLinkCount: number;
  evidenceRequired: boolean;
  evidenceTypes: string[];
  evidenceInstructions: string | null;
  sopDescription: string | null;
  isTeamKpi: boolean;
  teamCreditMethod: string;
  allowPartialCompletion: boolean;
  allowMultipleAchievementsPerAllocation: boolean;
  contributionRoles: ContributionRoleDefinition[] | null;
  createdAt: Date;
};

export type ContributionRoleDefinition = {
  role: string;
  creditPercent: number;
  isDefault: boolean;
};

export type KpiStageView = {
  id: string;
  kpiDefinitionId: string;
  stageOrder: number;
  title: string;
  description: string | null;
  isMandatory: boolean;
  weight: number;
  evidenceRequired: boolean;
  evidenceTypes: string[];
  evidenceInstructions: string | null;
  deadline: Date | null;
  gracePeriodDays: number;
  latePenaltyEnabled: boolean;
  latePenaltyPercentPerDay: number;
  completedProgressCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type StageProgressView = {
  progressId: string;
  stageDefinitionId: string;
  stageOrder: number;
  title: string;
  description: string | null;
  weight: number;
  isMandatory: boolean;
  evidenceRequired: boolean;
  evidenceTypes: string[];
  evidenceInstructions: string | null;
  deadline: Date | null;
  isCompleted: boolean;
  completedAt: Date | null;
  completedByUserId: string | null;
  completedByName: string | null;
  notes: string | null;
  evidenceFiles: Array<{ name: string; url: string; type: string; uploadedAt?: string }> | null;
  isOverdue: boolean;
  daysRemaining: number | null;
};

export type SubmissionTrailView = {
  id: string;
  achievementId: string;
  action: string;
  actorUserId: string;
  actorName: string;
  actorRole: string;
  actorUnitName: string | null;
  note: string | null;
  scoreAtAction: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
};

export type ContributorRewardStateView = "DRAFT" | "PENDING" | "RELEASED" | "REVOKED";

export type ContributorRewardEventView = {
  id: string;
  rewardId: string;
  action: string;
  actorUserId: string | null;
  actorName: string | null;
  actorRole: string | null;
  fromState: ContributorRewardStateView | null;
  toState: ContributorRewardStateView | null;
  note: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
};

export type ContributorRewardView = {
  id: string;
  achievementId: string;
  kpiDefinitionId: string;
  kraDefinitionId: string;
  kraTitle: string;
  kpiTitle: string;
  reportedByUserId: string;
  reportedByUserName: string;
  contributorUserId: string | null;
  contributorUserName: string | null;
  contributorDisplayName: string;
  benefitTypeId: string;
  benefitTypeCode: string;
  benefitTypeName: string;
  benefitUnit: string;
  rewardTierCode: string | null;
  rewardTierName: string | null;
  rewardComponentCode: string;
  rewardComponentName: string;
  state: ContributorRewardStateView;
  baseAmount: number;
  finalAmount: number;
  roundingAdjustment: number;
  statusRemark: string | null;
  releaseReference: string | null;
  releasedAt: Date | null;
  releasedByUserId: string | null;
  releasedByUserName: string | null;
  revokedAt: Date | null;
  revokedByUserId: string | null;
  revokedByUserName: string | null;
  revocationReason: string | null;
  rewardOwnerUnitId: string | null;
  rewardOwnerUnitName: string | null;
  reporterUnitId: string | null;
  reporterUnitName: string | null;
  createdAt: Date;
  updatedAt: Date;
  supersedesRewardId: string | null;
  replacedByRewardId: string | null;
  events: ContributorRewardEventView[];
};

export type RewardConsoleFilterOption = {
  value: string;
  label: string;
};

export type RewardConsoleFilterOptions = {
  benefitTypes: Array<{
    benefitTypeCode: string;
    benefitTypeName: string;
    unit: string;
  }>;
  units: RewardConsoleFilterOption[];
  kras: RewardConsoleFilterOption[];
};

export type RewardConsoleTotals = {
  benefitTypeCode: string;
  benefitTypeName: string;
  unit: string;
  totalCount: number;
  draftCount: number;
  pendingCount: number;
  releasedCount: number;
  revokedCount: number;
  totalAmount: number;
  draftAmount: number;
  pendingAmount: number;
  releasedAmount: number;
  revokedAmount: number;
};

export type RewardConsoleListResult = {
  rewards: ContributorRewardView[];
  totals: RewardConsoleTotals[];
  totalRows: number;
  filterOptions: RewardConsoleFilterOptions;
};

export type RewardReconciliationGroupBy = "benefitType" | "unit" | "kra";

export type RewardReconciliationAmountBucket = {
  unit: string;
  totalAmount: number;
  draftAmount: number;
  pendingAmount: number;
  releasedAmount: number;
  revokedAmount: number;
};

export type RewardReconciliationRow = {
  groupKey: string;
  label: string;
  code: string | null;
  totalCount: number;
  draftCount: number;
  pendingCount: number;
  releasedCount: number;
  revokedCount: number;
  totalAmount: number | null;
  unit: string | null;
  isMixedUnits: boolean;
  amountBuckets: RewardReconciliationAmountBucket[];
};

export type RewardReconciliationResult = {
  groupBy: RewardReconciliationGroupBy;
  rows: RewardReconciliationRow[];
  totals: RewardReconciliationRow;
};

export type RewardStateTotalsView = {
  benefitTypeCode: string;
  benefitTypeName: string;
  unit: string;
  count: number;
  totalAmount: number;
};

export type MyRewardsTotalsByState = Record<
  ContributorRewardStateView,
  RewardStateTotalsView[]
>;

export type MyRewardsView = {
  rewards: ContributorRewardView[];
  totalsByState: MyRewardsTotalsByState;
};

export type TargetAllocationView = {
  id: string;
  tenantId: string;
  periodId: string;
  kpiDefinitionId: string;
  kpiTitle: string;
  assignedToUnitId: string | null;
  assignedToUnitName: string | null;
  assignedToUserId: string | null;
  assignedToUserName: string | null;
  allocatedByUserId: string;
  targetValue: number | null;
  targetDate: Date | null;
  targetMilestone: MilestoneStatus | null;
  targetGrade: GradeValue | null;
  targetBoolean: boolean | null;
  targetRating: number | null;
  state: TargetAllocationState;
  lockedAt: Date | null;
  parentAllocationId: string | null;
  notes: string | null;
  childCount: number;
  achievementCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type AchievementSubmissionRoleView = {
  id: string;
  code: string;
  name: string;
  defaultCreditPercent: number;
  isDefault: boolean;
};

export type AchievementSubmissionConfig = {
  participantMode: "SINGLE_OWNER" | "OPTIONAL_TEAM" | "REQUIRED_TEAM";
  evidenceRequired: boolean;
  evidenceTypes: string[];
  evidenceInstructions: string | null;
  applicableRoles: AchievementSubmissionRoleView[];
  allowExternalContributors: boolean;
  creditSumMode: "MUST_EQUAL_100" | "MAX_100" | "UNCAPPED";
  externalContributorFields: AchievementFieldConfig[] | null;
  contributorSelectorTags: string[];
  manualCreditEntryEnabled: boolean;
};

export type AllocationAchievementStateCounts = {
  draft: number;
  submitted: number;
  recommended: number;
  verified: number;
  rejected: number;
};

export type AllocationAchievementAggregateView = {
  isMultiRequestEnabled: boolean;
  officialActualValue: number;
  officialScore: number | null;
  totalRequests: number;
  countsByState: AllocationAchievementStateCounts;
};

export type AchievementView = {
  id: string;
  tenantId: string;
  periodId: string;
  kpiDefinitionId: string;
  kpiTitle: string;
  targetAllocationId: string | null;
  reportedByUserId: string;
  reportedByUserName: string;
  isOBO: boolean;
  oboReportedForUserId: string | null;
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
  achievementFormData: Record<string, unknown> | null;
  computedScore: number | null;
  state: AchievementState;
  recommendedByUserId: string | null;
  recommendedAt: Date | null;
  recommendationNote: string | null;
  verifiedByUserId: string | null;
  verifiedAt: Date | null;
  verificationNote: string | null;
  rejectionReason: string | null;
  verificationLog: VerificationLogEntry[];
  contributors: AchievementContributorView[];
  duplicateCheckResult: DuplicateCheckResult | null;
  submissionTrail: SubmissionTrailView[];
  reportingDate: Date;
  createdAt: Date;
};

export type AchievementContributorView = {
  id: string;
  type: "INTERNAL" | "EXTERNAL";
  userId: string | null;
  userName: string | null;
  externalName: string | null;
  externalAffiliation: string | null;
  externalScope: "NATIONAL" | "INTERNATIONAL" | null;
  externalData: Record<string, unknown> | null;
  contributorRoleId: string;
  roleName: string;
  creditPercent: number;
  isExcludedFromReward: boolean;
  selectorTags: string[];
  note: string | null;
};

export type DuplicateMatch = {
  achievementId: string;
  matchedField: string;
  matchedValue: string;
  reportedByName: string;
  reportedByUserId: string;
  sameReporter: boolean;
  achievementState: string;
  achievementTitle: string | null;
  periodId: string;
  samePeriod: boolean;
  similarity: "EXACT" | "FUZZY";
  matchType?: "DUPLICATE" | "POLICY_WARNING";
  note?: string | null;
  relatedKpiTitle?: string | null;
};

export type DuplicateCheckResult = {
  checked: boolean;
  hasDuplicates: boolean;
  matches: DuplicateMatch[];
};

export type AdditionalAchievementView = AchievementView & {
  kraTitle: string;
  categoryLabel: string | null;
  categoryKey: string | null;
  measurementType: KpiMeasurementType;
  unitLabel: string | null;
  defaultTarget: number | null;
  achievementTemplateKey: string | null;
  achievementFormConfig: AchievementFormConfig | null;
  startingUnitId: string;
  startingUnitName: string;
  stagesComplete: number;
  stagesTotal: number;
  allowPartialCompletion: boolean;
  stagesDefinedCount: number;
  submissionConfig: AchievementSubmissionConfig;
};

export type AdditionalAchievementSummaryItem = {
  id: string;
  kpiTitle: string;
  state: AchievementState;
  reportingDate: Date;
};

// ── Computed Review Cycle (no DB table in R1) ────────────────────────────────

export type ComputedReviewCycle = {
  cycleNumber: number;
  label: string;
  startDate: Date;
  endDate: Date;
  isCurrent: boolean;
};

// ── Stored Review Cycle (R2 — persisted in DB) ──────────────────────────────

export type StoredReviewCycleView = {
  id: string;
  periodId: string;
  cycleNumber: number;
  label: string;
  startDate: Date;
  endDate: Date;
  reviewDeadline: Date | null;
  isCurrent: boolean;
  createdAt: Date;
};

// ── KPI Target Unit (R2) ────────────────────────────────────────────────────

export type KpiTargetUnitView = {
  id: string;
  kpiDefinitionId: string;
  unitId: string;
  unitName: string;
  unitCode: string;
  targetShare: number | null;
  notes: string | null;
  createdAt: Date;
};

// ── Tooltip Constants ────────────────────────────────────────────────────────

export const TOOLTIPS = {
  KRA_WEIGHTAGE:
    "Integer value. All KRA weightages for a period must sum to exactly 100.",
  KPI_WEIGHTAGE:
    "Integer value. All KPI weightages under a KRA must sum to the KRA's weightage.",
  MEASUREMENT_TYPE:
    "How this KPI is measured: count, percentage, currency, yes/no, rating scale, milestone, date deadline, or grade.",
  SCORING_METHOD:
    "LINEAR: proportional score. THRESHOLD: pass/fail at a cutoff. SLAB: banded score ranges.",
  SCORING_DIRECTION:
    "ASCENDING: higher actual is better (publications, revenue). DESCENDING: lower actual is better (attrition, costs).",
  ALLOCATION_TYPE:
    "DEPARTMENT: target stays at department level. INDIVIDUAL: must be split to members. BOTH: head decides.",
  IS_PER_CAPITA:
    "When enabled, display shows per-person values (e.g., papers per faculty).",
  TARGET_CASCADE:
    "Split a parent target to child units/individuals. For NUMERIC/CURRENCY: children must sum to parent. For others: target is replicated.",
  ASSESSMENT_PERIOD_STATE:
    "DRAFT: being configured. OPEN: targets can be set. IN_PROGRESS: targets locked, achievements recorded. UNDER_REVIEW: verification. CLOSED: finalized. ARCHIVED: historical.",
  CATEGORY_SCOPE:
    "GLOBAL: superadmin-managed, visible to all tenants. TENANT: created by tenant admin.",
} as const;

// ── Valid State Transitions ──────────────────────────────────────────────────

export const ASSESSMENT_PERIOD_TRANSITIONS: Record<
  AssessmentPeriodState,
  AssessmentPeriodState[]
> = {
  DRAFT: ["OPEN"],
  OPEN: ["IN_PROGRESS"],
  IN_PROGRESS: ["UNDER_REVIEW"],
  UNDER_REVIEW: ["CLOSED"],
  CLOSED: ["ARCHIVED"],
  ARCHIVED: [],
};

// ── Grade Score Mapping (for scoring engine) ─────────────────────────────────

export const GRADE_SCORE_MAP: Record<GradeValue, number> = {
  OUTSTANDING: 100,
  VERY_GOOD: 85,
  GOOD: 70,
  SATISFACTORY: 55,
  NEEDS_IMPROVEMENT: 35,
  POOR: 15,
};

// ── Milestone Score Mapping ──────────────────────────────────────────────────

export const MILESTONE_SCORE_MAP: Record<MilestoneStatus, number> = {
  NOT_STARTED: 0,
  IN_PROGRESS: 50,
  COMPLETED: 100,
};

// ── Achievement Form Field / Template Config (R1.1a) ─────────────────────────

export const ACHIEVEMENT_FIELD_TYPES = [
  "TEXT", "TEXTAREA", "NUMBER", "DATE", "URL", "EMAIL",
  "SELECT", "MULTI_SELECT", "BOOLEAN", "DECLARATION", "FILE_LINK",
] as const;

export const achievementFieldMarkerSchema = z.enum([
  "VALUE_FIELD",
  "CATEGORY_FIELD",
  "UNIT_FIELD",
  "SCORE_FIELD",
  "UNIQUE_CHECK",
  "POLICY_DATE_FIELD",
  "TEAM_SIZE",
]);

export type AchievementFieldMarker = z.infer<typeof achievementFieldMarkerSchema>;

export const fieldConditionOperatorSchema = z.enum([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "in",
  "has_any",
  "has_all",
  "not_in",
  "not_contains",
]);

export type FieldConditionOperator = z.infer<typeof fieldConditionOperatorSchema>;

export const fieldConditionSchema = z.object({
  fieldKey: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/).optional(),
  systemMetricKey: z.string().trim().min(1).optional(),
  operator: fieldConditionOperatorSchema,
  value: z.unknown(),
});

export type FieldCondition = z.infer<typeof fieldConditionSchema>;

export const achievementFieldValidationSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  minLength: z.number().int().min(0).optional(),
  maxLength: z.number().int().min(0).optional(),
  patternMessage: z.string().max(200).optional(),
});

export type AchievementFieldValidation = z.infer<typeof achievementFieldValidationSchema>;

export const achievementFieldSchema = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
  label: z.string().min(1).max(100),
  type: z.enum([
    "TEXT", "TEXTAREA", "NUMBER", "DATE", "URL", "EMAIL",
    "SELECT", "MULTI_SELECT", "BOOLEAN", "DECLARATION", "FILE_LINK",
  ]),
  required: z.boolean().default(false),
  options: z.array(z.string()).optional(),
  pattern: z.string().optional(),
  placeholder: z.string().optional(),
  helpText: z.string().optional(),
  sortOrder: z.number().int().default(0),
  marker: achievementFieldMarkerSchema.optional(),
  binding: achievementFieldMarkerSchema.optional(),
  defaultValue: z.unknown().optional(),
  validation: achievementFieldValidationSchema.optional(),
  visibilityRules: z.array(fieldConditionSchema).max(20).optional(),
  requiredRules: z.array(fieldConditionSchema).max(20).optional(),
});

export type AchievementFieldConfig = z.infer<typeof achievementFieldSchema>;

export const achievementFormConfigSchema = z.object({
  templateKey: z.string().optional(),
  fields: z.array(achievementFieldSchema).min(1).max(30),
});

export type AchievementFormConfig = z.infer<typeof achievementFormConfigSchema>;

/**
 * Builds a Zod schema dynamically from an AchievementFormConfig to validate
 * the user-filled form data at save time.
 */
export function buildFormDataValidator(
  fields: AchievementFieldConfig[],
  options?: { unknownKeys?: "passthrough" | "strip" },
) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of fields) {
    let fieldSchema: z.ZodTypeAny;
    const pattern = f.pattern ? new RegExp(f.pattern) : null;
    const validation = f.validation;

    switch (f.type) {
      case "NUMBER":
        fieldSchema = f.required ? z.number() : z.number().optional().nullable();
        if (validation?.min != null) {
          fieldSchema = fieldSchema.refine(
            (value) =>
              value == null ||
              (typeof value === "number" && value >= validation.min!),
            `${f.label} must be at least ${validation.min}`,
          );
        }
        if (validation?.max != null) {
          fieldSchema = fieldSchema.refine(
            (value) =>
              value == null ||
              (typeof value === "number" && value <= validation.max!),
            `${f.label} must be at most ${validation.max}`,
          );
        }
        break;
      case "BOOLEAN":
        fieldSchema = f.required ? z.boolean() : z.boolean().optional().nullable();
        break;
      case "DECLARATION":
        fieldSchema = z.boolean().optional().nullable();
        break;
      case "DATE":
        fieldSchema = f.required
          ? z.string().min(1, `${f.label} is required`)
          : z.string().optional().nullable();
        break;
      case "URL":
        fieldSchema = f.required
          ? z.string().url(`${f.label} must be a valid URL`)
          : z.union([z.string().url(), z.literal("")]).optional().nullable();
        break;
      case "EMAIL":
        fieldSchema = f.required
          ? z.string().email(`${f.label} must be a valid email`)
          : z.union([z.string().email(), z.literal("")]).optional().nullable();
        break;
      case "SELECT":
        fieldSchema = (
          f.required
            ? z.string().min(1, `${f.label} is required`)
            : z.string().optional().nullable()
        ).superRefine((value, ctx) => {
          if (
            value != null &&
            value !== "" &&
            f.options &&
            !f.options.includes(value)
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `${f.label} must be one of the allowed options`,
            });
          }
        });
        break;
      case "MULTI_SELECT":
        fieldSchema = (
          f.required
            ? z.array(z.string()).min(1, `${f.label} requires at least one selection`)
            : z.array(z.string()).optional().nullable()
        ).superRefine((values, ctx) => {
          if (
            values != null &&
            f.options &&
            values.some((value) => !f.options?.includes(value))
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `${f.label} contains an invalid selection`,
            });
          }
        });
        break;
      default:
        fieldSchema = (f.required
          ? z.string().min(1, `${f.label} is required`)
          : z.string().optional().nullable()
        ).superRefine((value, ctx) => {
          if (
            value != null &&
            value !== "" &&
            pattern &&
            !pattern.test(value)
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `${f.label} has an invalid format`,
            });
          }
          if (
            value != null &&
            value !== "" &&
            validation?.minLength != null &&
            value.length < validation.minLength
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `${f.label} must be at least ${validation.minLength} characters`,
            });
          }
          if (
            value != null &&
            value !== "" &&
            validation?.maxLength != null &&
            value.length > validation.maxLength
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `${f.label} must be at most ${validation.maxLength} characters`,
            });
          }
        });
        break;
    }
    shape[f.key] = fieldSchema;
  }
  const objectSchema = z.object(shape);
  const baseSchema =
    options?.unknownKeys === "strip"
      ? objectSchema.strip()
      : objectSchema.passthrough();

  return baseSchema.superRefine((data, ctx) => {
    for (const field of fields) {
      const value = data[field.key];
      const requiredByRule =
        field.requiredRules && field.requiredRules.length > 0
          ? evaluateFieldConditions(field.requiredRules, data)
          : false;
      const isVisible = isAchievementFieldVisible(field, data);

      if (field.type === "DECLARATION") {
        if (isVisible && (field.required || requiredByRule) && value !== true) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${field.label} must be acknowledged`,
            path: [field.key],
          });
        }
        continue;
      }

      if (!requiredByRule) continue;

      if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${field.label} is required`,
          path: [field.key],
        });
      }
    }
  });
}

function includesAny(haystack: unknown[], needles: unknown[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

function includesAll(haystack: unknown[], needles: unknown[]): boolean {
  return needles.every((needle) => haystack.includes(needle));
}

export function evaluateFieldCondition(
  condition: FieldCondition,
  values: Record<string, unknown>,
  systemMetrics?: Record<string, unknown>,
): boolean {
  const left =
    condition.systemMetricKey != null
      ? systemMetrics?.[condition.systemMetricKey]
      : values[condition.fieldKey ?? ""];
  const right = condition.value;

  switch (condition.operator) {
    case "eq":
      return left === right;
    case "neq":
      return left !== right;
    case "gt":
      return Number(left) > Number(right);
    case "gte":
      return Number(left) >= Number(right);
    case "lt":
      return Number(left) < Number(right);
    case "lte":
      return Number(left) <= Number(right);
    case "contains":
      return typeof left === "string" && String(left).includes(String(right));
    case "in":
      return Array.isArray(right) && right.includes(left);
    case "has_any":
      return Array.isArray(left) && Array.isArray(right) && includesAny(left, right);
    case "has_all":
      return Array.isArray(left) && Array.isArray(right) && includesAll(left, right);
    case "not_in":
      return Array.isArray(right) && !right.includes(left);
    case "not_contains":
      return typeof left === "string" && !String(left).includes(String(right));
    default:
      return false;
  }
}

export function evaluateFieldConditions(
  conditions: FieldCondition[],
  values: Record<string, unknown>,
  systemMetrics?: Record<string, unknown>,
): boolean {
  return conditions.every((condition) =>
    evaluateFieldCondition(condition, values, systemMetrics),
  );
}

function hasRenderableFieldValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export function applyAchievementFieldDefaults(
  fields: AchievementFieldConfig[],
  values: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(values ?? {}) };
  for (const field of fields) {
    if (next[field.key] === undefined && field.defaultValue !== undefined) {
      next[field.key] = field.defaultValue;
    }
  }
  return next;
}

export function isAchievementFieldVisible(
  field: AchievementFieldConfig,
  values: Record<string, unknown>,
  systemMetrics?: Record<string, unknown>,
  options?: { readOnly?: boolean; showHiddenWithValue?: boolean },
): boolean {
  const visibleByRule =
    !field.visibilityRules ||
    field.visibilityRules.length === 0 ||
    evaluateFieldConditions(field.visibilityRules, values, systemMetrics);

  if (visibleByRule) return true;

  if (options?.readOnly && options.showHiddenWithValue !== false) {
    return hasRenderableFieldValue(values[field.key]);
  }

  return false;
}

export function isAchievementFieldRequired(
  field: AchievementFieldConfig,
  values: Record<string, unknown>,
  systemMetrics?: Record<string, unknown>,
): boolean {
  if (field.required) return true;
  if (!field.requiredRules || field.requiredRules.length === 0) return false;
  return evaluateFieldConditions(field.requiredRules, values, systemMetrics);
}

export function getRenderableAchievementFields(
  fields: AchievementFieldConfig[],
  values: Record<string, unknown>,
  options?: { readOnly?: boolean; showHiddenWithValue?: boolean; systemMetrics?: Record<string, unknown> },
): AchievementFieldConfig[] {
  return [...fields]
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .filter((field) =>
      isAchievementFieldVisible(field, values, options?.systemMetrics, {
        readOnly: options?.readOnly,
        showHiddenWithValue: options?.showHiddenWithValue,
      }),
    );
}

// ── Predefined Achievement Templates ─────────────────────────────────────────

export type AchievementTemplate = {
  label: string;
  fields: AchievementFieldConfig[];
};

export const ACHIEVEMENT_TEMPLATES: Record<string, AchievementTemplate> = {
  PUBLICATION: {
    label: "Research Publication",
    fields: [
      { key: "paperTitle", label: "Paper Title", type: "TEXT", required: true, sortOrder: 0 },
      { key: "journalName", label: "Journal / Conference", type: "TEXT", required: true, sortOrder: 1 },
      { key: "issn", label: "ISSN / ISBN", type: "TEXT", required: false, sortOrder: 2 },
      { key: "volume", label: "Volume", type: "TEXT", required: false, sortOrder: 3 },
      { key: "issue", label: "Issue", type: "TEXT", required: false, sortOrder: 4 },
      { key: "doi", label: "DOI", type: "TEXT", required: false, placeholder: "10.xxxx/...", sortOrder: 5, marker: "UNIQUE_CHECK" },
      { key: "indexing", label: "Indexing", type: "MULTI_SELECT", required: true,
        options: ["Scopus", "Web of Science", "UGC CARE List"], sortOrder: 6, marker: "CATEGORY_FIELD" },
      { key: "publicationDate", label: "Publication Date", type: "DATE", required: true, sortOrder: 7 },
      { key: "pdfLink", label: "Paper PDF / URL", type: "URL", required: true, sortOrder: 8 },
      { key: "coAuthors", label: "Co-Authors", type: "TEXTAREA", required: false, sortOrder: 9 },
    ],
  },
  PATENT: {
    label: "Patent",
    fields: [
      { key: "patentTitle", label: "Patent Title", type: "TEXT", required: true, sortOrder: 0 },
      { key: "applicationNumber", label: "Application Number", type: "TEXT", required: true, sortOrder: 1, marker: "UNIQUE_CHECK" },
      { key: "patentOffice", label: "Patent Office", type: "SELECT", required: true,
        options: ["Indian Patent Office", "USPTO", "EPO", "WIPO", "Other"], sortOrder: 2 },
      { key: "filingDate", label: "Filing Date", type: "DATE", required: true, sortOrder: 3 },
      { key: "status", label: "Status", type: "SELECT", required: true,
        options: ["Filed", "Published", "Granted", "Abandoned"], sortOrder: 4, marker: "CATEGORY_FIELD" },
      { key: "grantDate", label: "Grant Date", type: "DATE", required: false, sortOrder: 5 },
      { key: "inventors", label: "Inventors", type: "TEXTAREA", required: true, sortOrder: 6 },
      { key: "certificateLink", label: "Certificate / Proof", type: "URL", required: false, sortOrder: 7 },
    ],
  },
  GRANT: {
    label: "Research Grant",
    fields: [
      { key: "projectTitle", label: "Project Title", type: "TEXT", required: true, sortOrder: 0 },
      { key: "fundingAgency", label: "Funding Agency", type: "TEXT", required: true, sortOrder: 1 },
      { key: "sanctionedAmount", label: "Sanctioned Amount", type: "NUMBER", required: true, sortOrder: 2, marker: "VALUE_FIELD" },
      { key: "sanctionNumber", label: "Sanction / Reference Number", type: "TEXT", required: false, sortOrder: 3, marker: "UNIQUE_CHECK" },
      { key: "duration", label: "Duration (months)", type: "NUMBER", required: false, sortOrder: 4 },
      { key: "startDate", label: "Start Date", type: "DATE", required: true, sortOrder: 5 },
      { key: "sanctionLetterLink", label: "Sanction Letter", type: "URL", required: true, sortOrder: 6 },
    ],
  },
  CONFERENCE: {
    label: "Conference Participation",
    fields: [
      { key: "conferenceName", label: "Conference Name", type: "TEXT", required: true, sortOrder: 0 },
      { key: "paperTitle", label: "Paper Title", type: "TEXT", required: true, sortOrder: 1 },
      { key: "presentationType", label: "Presentation Type", type: "SELECT", required: true,
        options: ["Oral", "Poster", "Keynote", "Invited Talk", "Workshop"], sortOrder: 2, marker: "CATEGORY_FIELD" },
      { key: "location", label: "Location", type: "TEXT", required: false, sortOrder: 3 },
      { key: "date", label: "Date", type: "DATE", required: true, sortOrder: 4 },
      { key: "proceedingsLink", label: "Proceedings / Certificate", type: "URL", required: false, sortOrder: 5 },
    ],
  },
  MOU: {
    label: "MoU / Collaboration",
    fields: [
      { key: "partnerOrg", label: "Partner Organization", type: "TEXT", required: true, sortOrder: 0 },
      { key: "scope", label: "Scope of MoU", type: "TEXTAREA", required: true, sortOrder: 1 },
      { key: "signedDate", label: "Signed Date", type: "DATE", required: true, sortOrder: 2 },
      { key: "validUntil", label: "Valid Until", type: "DATE", required: false, sortOrder: 3 },
      { key: "signedCopyLink", label: "Signed Copy", type: "URL", required: true, sortOrder: 4 },
    ],
  },
  TRAINING: {
    label: "Training / FDP",
    fields: [
      { key: "programName", label: "Program Name", type: "TEXT", required: true, sortOrder: 0 },
      { key: "organizer", label: "Organized By", type: "TEXT", required: true, sortOrder: 1 },
      { key: "role", label: "Role", type: "SELECT", required: true,
        options: ["Participant", "Resource Person", "Coordinator", "Organizer"], sortOrder: 2 },
      { key: "startDate", label: "Start Date", type: "DATE", required: true, sortOrder: 3 },
      { key: "endDate", label: "End Date", type: "DATE", required: true, sortOrder: 4 },
      { key: "hours", label: "Duration (hours)", type: "NUMBER", required: false, sortOrder: 5, marker: "UNIT_FIELD" },
      { key: "certificateLink", label: "Certificate", type: "URL", required: true, sortOrder: 6 },
    ],
  },
  BOOK: {
    label: "Book / Book Chapter",
    fields: [
      { key: "bookTitle", label: "Book Title", type: "TEXT", required: true, sortOrder: 0 },
      { key: "publisher", label: "Publisher", type: "TEXT", required: true, sortOrder: 1 },
      { key: "isbn", label: "ISBN", type: "TEXT", required: true, sortOrder: 2, marker: "UNIQUE_CHECK" },
      {
        key: "publicationYear",
        label: "Publication Year",
        type: "NUMBER",
        required: true,
        sortOrder: 3,
        validation: { min: 1900, max: 2100 },
      },
      { key: "scopusIndexed", label: "Scopus Indexed", type: "BOOLEAN", required: true, sortOrder: 4 },
      { key: "publisherLink", label: "Publisher Page / Proof", type: "URL", required: true, sortOrder: 5 },
    ],
  },
  PHD_SUPERVISION: {
    label: "PhD Supervision",
    fields: [
      { key: "scholarName", label: "Scholar Name", type: "TEXT", required: true, sortOrder: 0 },
      { key: "thesisTitle", label: "Thesis Title", type: "TEXT", required: true, sortOrder: 1 },
      { key: "university", label: "University", type: "TEXT", required: true, sortOrder: 2 },
      {
        key: "enrollmentNumber",
        label: "Enrollment / Registration Number",
        type: "TEXT",
        required: true,
        sortOrder: 3,
        marker: "UNIQUE_CHECK",
      },
      {
        key: "awardDate",
        label: "PhD Award Date",
        type: "DATE",
        required: true,
        sortOrder: 4,
        marker: "POLICY_DATE_FIELD",
      },
      {
        key: "degreeCertificateLink",
        label: "Degree Certificate / Notification",
        type: "URL",
        required: true,
        sortOrder: 5,
      },
    ],
  },
  CONSULTANCY: {
    label: "Consultancy / EDP / MDP",
    fields: [
      { key: "projectTitle", label: "Project / Program Title", type: "TEXT", required: true, sortOrder: 0 },
      { key: "clientOrg", label: "Client Organization", type: "TEXT", required: true, sortOrder: 1 },
      {
        key: "projectValue",
        label: "Total Project Value (INR)",
        type: "NUMBER",
        required: true,
        sortOrder: 2,
        marker: "VALUE_FIELD",
      },
      { key: "totalExpenditure", label: "Total Expenditure (INR)", type: "NUMBER", required: true, sortOrder: 3 },
      { key: "savings", label: "Savings (Revenue - Expenditure) (INR)", type: "NUMBER", required: true, sortOrder: 4 },
      { key: "startDate", label: "Start Date", type: "DATE", required: true, sortOrder: 5 },
      { key: "endDate", label: "End Date", type: "DATE", required: true, sortOrder: 6 },
      {
        key: "referenceNumber",
        label: "Reference / Agreement Number",
        type: "TEXT",
        required: false,
        sortOrder: 7,
        marker: "UNIQUE_CHECK",
      },
      { key: "approvalLink", label: "Approval / Agreement Document", type: "URL", required: true, sortOrder: 8 },
    ],
  },
  FDP_WORKSHOP: {
    label: "FDP / STC / VAC / Training / Hands-on Workshop (Convenor)",
    fields: [
      { key: "programName", label: "Program Name", type: "TEXT", required: true, sortOrder: 0 },
      {
        key: "programType",
        label: "Program Type",
        type: "SELECT",
        required: true,
        options: ["FDP", "STC", "VAC", "Training Program", "Hands-on Workshop"],
        sortOrder: 1,
      },
      { key: "sponsoringAgency", label: "Sponsoring / Funding Agency", type: "TEXT", required: true, sortOrder: 2 },
      {
        key: "isSponsored",
        label: "Is this program sponsored by an external funding agency (not GU)?",
        type: "BOOLEAN",
        required: true,
        sortOrder: 3,
      },
      { key: "startDate", label: "Start Date", type: "DATE", required: true, sortOrder: 4 },
      { key: "endDate", label: "End Date", type: "DATE", required: true, sortOrder: 5 },
      {
        key: "totalHours",
        label: "Total Hours",
        type: "NUMBER",
        required: true,
        sortOrder: 6,
        marker: "UNIT_FIELD",
        validation: { min: 1 },
      },
      { key: "participantCount", label: "Number of Participants", type: "NUMBER", required: false, sortOrder: 7 },
      {
        key: "referenceNumber",
        label: "Sponsorship Reference Number",
        type: "TEXT",
        required: false,
        sortOrder: 8,
        marker: "UNIQUE_CHECK",
      },
      {
        key: "certificateLink",
        label: "Completion Certificate / Report",
        type: "URL",
        required: true,
        sortOrder: 9,
      },
    ],
  },
  CERTIFICATION: {
    label: "Certification / Accreditation",
    fields: [
      { key: "certName", label: "Certification Name", type: "TEXT", required: true, sortOrder: 0 },
      { key: "issuingBody", label: "Issuing Body", type: "TEXT", required: true, sortOrder: 1 },
      { key: "validFrom", label: "Valid From", type: "DATE", required: true, sortOrder: 2 },
      { key: "validTo", label: "Valid To", type: "DATE", required: false, sortOrder: 3 },
      { key: "certificateLink", label: "Certificate", type: "URL", required: true, sortOrder: 4 },
    ],
  },
  GENERIC: {
    label: "General Achievement",
    fields: [
      { key: "description", label: "Description", type: "TEXTAREA", required: true, sortOrder: 0 },
      { key: "proofLink", label: "Supporting Document / Link", type: "URL", required: false, sortOrder: 1 },
    ],
  },
};

// ── Verification Log Entry Type ──────────────────────────────────────────────

export type VerificationLogEntry = {
  level:
    | "SUBMIT"
    | "RECOMMEND"
    | "VERIFY"
    | "REJECT"
    | "SEND_BACK"
    | "WITHDRAW"
    | "RESUBMIT";
  userId: string;
  userName: string;
  action: string;
  note?: string;
  at: string; // ISO date string
};

// ── Extended View Types for R1.1a ────────────────────────────────────────────

export type MyKpiContext = {
  userId: string;
  headOfUnits: { unitId: string; unitName: string; unitCode: string; scope: "NODE" | "DESCENDANTS" }[];
  memberOfUnits: { unitId: string; unitName: string; unitCode: string }[];
};

export type MyAllocationView = TargetAllocationView & {
  kraTitle: string;
  kraWeightage: number;
  categoryLabel: string | null;
  categoryKey: string | null;
  measurementType: KpiMeasurementType;
  measurementConfig: MeasurementConfig | null;
  unitLabel: string | null;
  kpiWeightage: number;
  defaultTarget: number | null;
  scoringDirection: ScoringDirection;
  isPerCapita: boolean;
  allocationType: KpiAllocationType;
  startingUnitId: string;
  startingUnitName: string;
  guidanceNotes: string | null;
  achievementTemplateKey: string | null;
  achievementFormConfig: AchievementFormConfig | null;
  allowMultipleAchievementsPerAllocation: boolean;
  periodState: AssessmentPeriodState;
  periodName: string;
  periodStartDate: Date;
  achievementDeadline: Date | null;
  periodEndDate: Date;
  reviewFrequency: ReviewCycleFrequency;
  achievement: AchievementView | null;
  /** All achievement instances for this allocation (R2.2 multi-target); newest first */
  achievements: AchievementView[];
  achievementAggregate: AllocationAchievementAggregateView;
  allowPartialCompletion: boolean;
  stagesDefinedCount: number;
  parentTargetValue: number | null;
  section: "department" | "individual";
  childAllocations: ChildAllocationSummary[];
  submissionConfig: AchievementSubmissionConfig;
};

export type ChildAllocationSummary = {
  id: string;
  assignedToUserId: string | null;
  assignedToUnitId: string | null;
  assignedToUserName: string | null;
  assignedToUnitName: string | null;
  targetValue: number | null;
  achievementState: AchievementState | null;
  actualValue: number | null;
  computedScore: number | null;
};

export type ReviewQueueItem = {
  achievementId: string;
  facultyUserId: string;
  facultyName: string;
  facultyDesignation: string | null;
  kraTitle: string;
  kpiTitle: string;
  kpiDefinitionId: string;
  achievementTitle: string | null;
  targetValue: number | null;
  actualValue: number | null;
  measurementType: KpiMeasurementType;
  unitLabel: string | null;
  achievementState: AchievementState;
  achievementFormData: Record<string, unknown> | null;
  achievementFormConfig: AchievementFormConfig | null;
  evidenceDescription: string | null;
  evidenceLinks: string[];
  verificationLog: VerificationLogEntry[];
  submissionTrail: SubmissionTrailView[];
  reportingDate: Date;
  reviewLevel: "RECOMMEND" | "VERIFY";
  startingUnitId: string;
  startingUnitName: string;
  reviewUnitId: string | null;
  reviewUnitName: string | null;
  waitingDays: number;
  contributionRole: string | null;
  creditPercent: number | null;
  contributors: AchievementContributorView[];
  duplicateCheckResult: DuplicateCheckResult | null;
  guidanceNotes: string | null;
  stageCompletionScore: number | null;
  effectiveScore: number | null;
  stagesComplete: number;
  stagesTotal: number;
  targetDisplay: string;
  actualDisplay: string;
  allowMultipleAchievementsPerAllocation: boolean;
  allocationAchievementAggregate: AllocationAchievementAggregateView | null;
};

export type MyDashboardSummary = {
  periodId: string;
  periodName: string;
  totalAllocations: number;
  statusCounts: Record<string, number>;
  overallWeightedScore: number;
  maxPossibleScore: number;
  overallPercentage: number;
  kraBreakdown: {
    kraId: string;
    kraTitle: string;
    kraWeightage: number;
    kpiCount: number;
    verifiedCount: number;
    avgScore: number;
  }[];
  pendingReviewCount: number;
  additionalAchievements: {
    total: number;
    verified: number;
    pending: number;
    notApproved: number;
    items: AdditionalAchievementSummaryItem[];
  };
  upcomingDeadlineCount: number;
  overdueCount: number;
};
