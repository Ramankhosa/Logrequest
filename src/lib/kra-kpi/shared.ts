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
};

export const initialKraKpiActionResult: KraKpiActionResult = {
  status: "idle",
  message: "",
};

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
  allowEarly: z.boolean().default(true), // completing before deadline = good
  gracePeriodDays: z.number().int().min(0).default(0),
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
  createdAt: Date;
};

export type KpiDefinitionView = {
  id: string;
  kraDefinitionId: string;
  kraTitle: string;
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
  state: KpiDefinitionState;
  sortOrder: number;
  guidanceNotes: string | null;
  allocationCount: number;
  createdAt: Date;
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
  actualValue: number | null;
  actualDate: Date | null;
  actualMilestone: MilestoneStatus | null;
  actualGrade: GradeValue | null;
  actualBoolean: boolean | null;
  actualRating: number | null;
  evidenceDescription: string | null;
  evidenceLinks: string[];
  computedScore: number | null;
  state: AchievementState;
  verifiedByUserId: string | null;
  verifiedAt: Date | null;
  verificationNote: string | null;
  rejectionReason: string | null;
  reportingDate: Date;
  createdAt: Date;
};

// ── Computed Review Cycle (no DB table in R1) ────────────────────────────────

export type ComputedReviewCycle = {
  cycleNumber: number;
  label: string;
  startDate: Date;
  endDate: Date;
  isCurrent: boolean;
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
