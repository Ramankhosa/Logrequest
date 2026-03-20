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
  AchievementFieldType,
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
  targetUnitCount: number;
  evidenceRequired: boolean;
  evidenceTypes: string[];
  evidenceInstructions: string | null;
  sopDescription: string | null;
  isTeamKpi: boolean;
  teamCreditMethod: string;
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
  updatedAt: Date;
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
  reportingDate: Date;
  createdAt: Date;
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

export const ACHIEVEMENT_FIELD_TYPES: AchievementFieldType[] = [
  "TEXT", "TEXTAREA", "NUMBER", "DATE", "URL", "EMAIL",
  "SELECT", "MULTI_SELECT", "BOOLEAN", "FILE_LINK",
];

export const achievementFieldSchema = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
  label: z.string().min(1).max(100),
  type: z.enum([
    "TEXT", "TEXTAREA", "NUMBER", "DATE", "URL", "EMAIL",
    "SELECT", "MULTI_SELECT", "BOOLEAN", "FILE_LINK",
  ]),
  required: z.boolean().default(false),
  options: z.array(z.string()).optional(),
  pattern: z.string().optional(),
  placeholder: z.string().optional(),
  helpText: z.string().optional(),
  sortOrder: z.number().int().default(0),
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
export function buildFormDataValidator(fields: AchievementFieldConfig[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of fields) {
    let fieldSchema: z.ZodTypeAny;
    const pattern = f.pattern ? new RegExp(f.pattern) : null;

    switch (f.type) {
      case "NUMBER":
        fieldSchema = f.required ? z.number() : z.number().optional().nullable();
        break;
      case "BOOLEAN":
        fieldSchema = f.required ? z.boolean() : z.boolean().optional().nullable();
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
        });
        break;
    }
    shape[f.key] = fieldSchema;
  }
  return z.object(shape).passthrough();
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
      { key: "doi", label: "DOI", type: "TEXT", required: false, placeholder: "10.xxxx/...", sortOrder: 5 },
      { key: "indexing", label: "Indexing", type: "MULTI_SELECT", required: true,
        options: ["Scopus", "Web of Science", "UGC CARE List", "PubMed", "IEEE Xplore", "Other"], sortOrder: 6 },
      { key: "publicationDate", label: "Publication Date", type: "DATE", required: true, sortOrder: 7 },
      { key: "pdfLink", label: "Paper PDF / URL", type: "URL", required: true, sortOrder: 8 },
      { key: "coAuthors", label: "Co-Authors", type: "TEXTAREA", required: false, sortOrder: 9 },
    ],
  },
  PATENT: {
    label: "Patent",
    fields: [
      { key: "patentTitle", label: "Patent Title", type: "TEXT", required: true, sortOrder: 0 },
      { key: "applicationNumber", label: "Application Number", type: "TEXT", required: true, sortOrder: 1 },
      { key: "patentOffice", label: "Patent Office", type: "SELECT", required: true,
        options: ["Indian Patent Office", "USPTO", "EPO", "WIPO", "Other"], sortOrder: 2 },
      { key: "filingDate", label: "Filing Date", type: "DATE", required: true, sortOrder: 3 },
      { key: "status", label: "Status", type: "SELECT", required: true,
        options: ["Filed", "Published", "Granted", "Abandoned"], sortOrder: 4 },
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
      { key: "sanctionedAmount", label: "Sanctioned Amount", type: "NUMBER", required: true, sortOrder: 2 },
      { key: "duration", label: "Duration (months)", type: "NUMBER", required: false, sortOrder: 3 },
      { key: "startDate", label: "Start Date", type: "DATE", required: true, sortOrder: 4 },
      { key: "sanctionLetterLink", label: "Sanction Letter", type: "URL", required: true, sortOrder: 5 },
    ],
  },
  CONFERENCE: {
    label: "Conference Participation",
    fields: [
      { key: "conferenceName", label: "Conference Name", type: "TEXT", required: true, sortOrder: 0 },
      { key: "paperTitle", label: "Paper Title", type: "TEXT", required: true, sortOrder: 1 },
      { key: "presentationType", label: "Presentation Type", type: "SELECT", required: true,
        options: ["Oral", "Poster", "Keynote", "Invited Talk", "Workshop"], sortOrder: 2 },
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
      { key: "hours", label: "Duration (hours)", type: "NUMBER", required: false, sortOrder: 5 },
      { key: "certificateLink", label: "Certificate", type: "URL", required: true, sortOrder: 6 },
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
  level: "SUBMIT" | "RECOMMEND" | "VERIFY" | "REJECT" | "SEND_BACK" | "WITHDRAW";
  userId: string;
  userName: string;
  action: string;
  note?: string;
  at: string; // ISO date string
};

// ── Extended View Types for R1.1a ────────────────────────────────────────────

export type MyKpiContext = {
  userId: string;
  headOfUnits: { unitId: string; unitName: string; unitCode: string }[];
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
  periodState: AssessmentPeriodState;
  periodName: string;
  periodStartDate: Date;
  achievementDeadline: Date | null;
  periodEndDate: Date;
  reviewFrequency: ReviewCycleFrequency;
  achievement: AchievementView | null;
  parentTargetValue: number | null;
  section: "department" | "individual";
  childAllocations: ChildAllocationSummary[];
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
  kpiTitle: string;
  kpiDefinitionId: string;
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
  reportingDate: Date;
  reviewLevel: "RECOMMEND" | "VERIFY";
  startingUnitId: string;
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
