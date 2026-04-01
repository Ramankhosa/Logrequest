import { z } from "zod";
import {
  achievementFormConfigSchema,
  fieldConditionOperatorSchema,
  measurementConfigSchema,
  scoringConfigSchema,
} from "./shared";

export const participantModeSchema = z.enum([
  "SINGLE_OWNER",
  "OPTIONAL_TEAM",
  "REQUIRED_TEAM",
]);

export const rewardRecurrencePolicySchema = z.enum([
  "RECURRING",
  "ONCE_PER_PERIOD",
  "ONCE_PER_KPI_LIFETIME",
  "ONCE_PER_UNIQUE_KEY",
]);

export const rewardTierMatchModeSchema = z.enum([
  "HIGHEST_MATCH",
  "MANUAL_SELECT",
]);

export const rewardTriggerSchema = z.enum([
  "FINAL_VERIFY",
  "MANUAL",
  "STAGE_COMPLETE",
]);

export const rewardAmountModeSchema = z.enum([
  "FIXED_VALUE",
  "FIXED_POOL",
  "FIXED_PER_PERSON",
  "PERCENT_OF_FIELD",
  "PER_UNIT",
  "PERCENT_OF_SCORE",
]);

export const rewardDistributionModeSchema = z.enum([
  "DIRECT_OWNER",
  "ROLE_PERCENT_SPLIT",
  "FIXED_PER_PERSON",
  "EQUAL_SPLIT",
  "CREDIT_PERCENT_SPLIT",
  "LEAD_ONLY",
]);

export const singleEligibleHandlingSchema = z.enum([
  "FULL_TO_SINGLE",
  "KEEP_CONFIGURED_SPLIT",
  "ERROR",
]);

export const emptyShareHandlingSchema = z.enum([
  "ROLLOVER_TO_MATCHED",
  "DROP_UNALLOCATED",
  "ERROR",
]);

export const rewardRuleSourceSchema = z.enum([
  "FORM_FIELD",
  "ACTUAL_VALUE",
  "COMPUTED_SCORE",
  "EFFECTIVE_SCORE",
  "SYSTEM_METRIC",
  "TEAM_SIZE",
  "MANUAL_SELECTION",
  "CONTRIBUTOR_TAG",
  "CONTRIBUTOR_COUNT",
]);

export const rewardRuleOperatorSchema = fieldConditionOperatorSchema;

export const rewardSelectorTypeSchema = z.enum([
  "ROLE",
  "SELECTOR_TAG",
  "REMAINDER",
  "ALL_CONTRIBUTORS",
]);

export const rewardSplitModeSchema = z.enum([
  "EQUAL",
  "FULL_TO_MATCHED",
]);

export const builderApplicableRoleSchema = z.object({
  roleId: z.string().trim().min(1).optional(),
  roleCode: z.string().trim().min(1).optional(),
  isDefault: z.boolean().default(false),
  sortOrder: z.number().int().min(0).default(0),
});

export const builderContributorConfigSchema = z.object({
  externalContribTemplateId: z.string().trim().min(1).nullable().optional(),
  allowExternalContributors: z.boolean().default(true),
  duplicateCheckFields: z.array(z.string().trim().min(1)).max(20).default([]),
  creditSumMode: z.enum(["MUST_EQUAL_100", "MAX_100", "UNCAPPED"]).default("MUST_EQUAL_100"),
});

export const builderStageSchema = z.object({
  id: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(500).nullable().optional(),
  stageOrder: z.number().int().min(1),
  weight: z.number().min(0).default(0),
  isMandatory: z.boolean().default(true),
  evidenceRequired: z.boolean().default(false),
  evidenceTypes: z.array(
    z.enum([
      "DOCUMENT",
      "URL",
      "CERTIFICATE",
      "SELF_DECLARATION",
      "SYSTEM_GENERATED",
      "NONE",
    ]),
  ).default([]),
  evidenceInstructions: z.string().trim().max(2000).nullable().optional(),
  deadline: z.coerce.date().nullable().optional(),
});

export const builderRewardRuleSchema = z.object({
  id: z.string().trim().min(1).optional(),
  source: rewardRuleSourceSchema,
  operator: rewardRuleOperatorSchema,
  fieldKey: z.string().trim().min(1).optional(),
  systemMetricKey: z.string().trim().min(1).optional(),
  value: z.unknown(),
  sortOrder: z.number().int().min(0).default(0),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const builderRewardDistributionSchema = z.object({
  id: z.string().trim().min(1).optional(),
  contributorRoleId: z.string().trim().min(1).nullable().optional(),
  contributorRoleCode: z.string().trim().min(1).nullable().optional(),
  selectorType: rewardSelectorTypeSchema,
  selectorTag: z.string().trim().min(1).nullable().optional(),
  sharePercent: z.number().min(0).max(100).nullable().optional(),
  fixedAmount: z.number().min(0).nullable().optional(),
  splitMode: rewardSplitModeSchema.nullable().optional(),
  sortOrder: z.number().int().min(0).default(0),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const builderRewardComponentSchema = z.object({
  id: z.string().trim().min(1).optional(),
  rewardTierRef: z.string().trim().min(1).max(120).nullable().optional(),
  rewardTierCode: z.string().trim().min(1).nullable().optional(),
  stageDefinitionId: z.string().trim().min(1).nullable().optional(),
  parentComponentCode: z.string().trim().min(1).nullable().optional(),
  benefitTypeId: z.string().trim().min(1).optional(),
  benefitTypeCode: z.string().trim().min(1).optional(),
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(500).nullable().optional(),
  trigger: rewardTriggerSchema.default("FINAL_VERIFY"),
  amountMode: rewardAmountModeSchema,
  amountValue: z.number().min(0).nullable().optional(),
  amountFieldKey: z.string().trim().min(1).nullable().optional(),
  distributionMode: rewardDistributionModeSchema.default("DIRECT_OWNER"),
  singleEligibleHandling: singleEligibleHandlingSchema.default("FULL_TO_SINGLE"),
  emptyShareHandling: emptyShareHandlingSchema.default("ROLLOVER_TO_MATCHED"),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).default(0),
  metadata: z.record(z.string(), z.unknown()).optional(),
  distributions: z.array(builderRewardDistributionSchema).default([]),
});

export const builderRewardTierSchema = z.object({
  id: z.string().trim().min(1).optional(),
  refKey: z.string().trim().min(1).max(120).optional(),
  tierSetKey: z.string().trim().min(1).default("PRIMARY"),
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(500).nullable().optional(),
  priority: z.number().int().min(0).default(0),
  matchMode: rewardTierMatchModeSchema.default("HIGHEST_MATCH"),
  effectiveFrom: z.coerce.date().nullable().optional(),
  effectiveTo: z.coerce.date().nullable().optional(),
  isActive: z.boolean().default(true),
  metadata: z.record(z.string(), z.unknown()).optional(),
  rules: z.array(builderRewardRuleSchema).default([]),
});

export const builderKpiDefinitionSchema = z.object({
  id: z.string().trim().min(1).optional(),
  kraDefinitionId: z.string().trim().min(1),
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(1000).nullable().optional(),
  measurementType: z.enum([
    "NUMERIC",
    "PERCENTAGE",
    "CURRENCY",
    "BOOLEAN",
    "RATING",
    "MILESTONE",
    "DATE_TARGET",
    "GRADE",
  ]),
  unitLabel: z.string().trim().max(30).nullable().optional(),
  weightage: z.number().int().min(0).max(100).default(0),
  defaultTarget: z.number().nullable().optional(),
  measurementConfig: measurementConfigSchema.nullable().optional(),
  scoringMethod: z.enum(["LINEAR", "THRESHOLD", "SLAB"]).default("LINEAR"),
  scoringDirection: z.enum(["ASCENDING", "DESCENDING"]).default("ASCENDING"),
  scoringConfig: scoringConfigSchema.nullable().optional(),
  isPerCapita: z.boolean().default(false),
  allocationType: z.enum(["DEPARTMENT", "INDIVIDUAL", "BOTH"]).default("BOTH"),
  startingUnitId: z.string().trim().min(1),
  achievementTemplateKey: z.string().trim().max(80).nullable().optional(),
  achievementFormConfig: achievementFormConfigSchema.nullable().optional(),
  guidanceNotes: z.string().trim().max(2000).nullable().optional(),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  keyUnitId: z.string().trim().min(1).nullable().optional(),
  finalUnitId: z.string().trim().min(1).nullable().optional(),
  sopDescription: z.string().trim().max(5000).nullable().optional(),
  evidenceRequired: z.boolean().default(true),
  evidenceTypes: z.array(
    z.enum([
      "DOCUMENT",
      "URL",
      "CERTIFICATE",
      "SELF_DECLARATION",
      "SYSTEM_GENERATED",
      "NONE",
    ]),
  ).default([]),
  evidenceInstructions: z.string().trim().max(2000).nullable().optional(),
  isTeamKpi: z.boolean().default(false),
  teamCreditMethod: z.enum([
    "FULL_EACH",
    "EQUAL_SPLIT",
    "WEIGHTED_SPLIT",
    "PRIMARY_ONLY",
  ]).default("FULL_EACH"),
  allowPartialCompletion: z.boolean().default(true),
  allowMultipleAchievementsPerAllocation: z.boolean().default(false),
  participantMode: participantModeSchema.default("SINGLE_OWNER"),
  rewardRecurrencePolicy: rewardRecurrencePolicySchema.default("RECURRING"),
  policyDateFieldKey: z.string().trim().max(80).nullable().optional(),
  contributionRoles: z.array(
    z.object({
      role: z.string().trim().min(1).max(100),
      creditPercent: z.number().min(1).max(100),
      isDefault: z.boolean(),
    }),
  ).nullable().optional(),
});

export const kpiBuilderPayloadSchema = z.object({
  definition: builderKpiDefinitionSchema,
  applicableRoles: z.array(builderApplicableRoleSchema).default([]),
  contributorConfig: builderContributorConfigSchema.default(() => ({
    allowExternalContributors: true,
    duplicateCheckFields: [],
    creditSumMode: "MUST_EQUAL_100" as const,
  })),
  stages: z.array(builderStageSchema).default([]),
  rewardTiers: z.array(builderRewardTierSchema).default([]),
  rewardComponents: z.array(builderRewardComponentSchema).default([]),
});

export type BuilderApplicableRole = z.infer<typeof builderApplicableRoleSchema>;
export type BuilderContributorConfig = z.infer<typeof builderContributorConfigSchema>;
export type BuilderStage = z.infer<typeof builderStageSchema>;
export type BuilderRewardRule = z.infer<typeof builderRewardRuleSchema>;
export type BuilderRewardDistribution = z.infer<typeof builderRewardDistributionSchema>;
export type BuilderRewardComponent = z.infer<typeof builderRewardComponentSchema>;
export type BuilderRewardTier = z.infer<typeof builderRewardTierSchema>;
export type BuilderKpiDefinition = z.infer<typeof builderKpiDefinitionSchema>;
export type KpiBuilderPayload = z.infer<typeof kpiBuilderPayloadSchema>;
export type KpiBuilderPayloadInput = z.input<typeof kpiBuilderPayloadSchema>;

export const kpiTemplateWriteSchema = z.object({
  code: z.string().trim().min(2).max(80),
  name: z.string().trim().min(2).max(200),
  description: z.string().trim().max(1000).nullable().optional(),
  category: z.string().trim().max(80).nullable().optional(),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  payload: kpiBuilderPayloadSchema,
});

export type KpiTemplateWriteDraft = z.input<typeof kpiTemplateWriteSchema>;
export type KpiTemplateWriteInput = z.infer<typeof kpiTemplateWriteSchema>;

export const kpiCopySelectionSchema = z.object({
  basics: z.boolean().default(true),
  fields: z.boolean().default(true),
  participantPolicy: z.boolean().default(true),
  externalContributorPolicy: z.boolean().default(true),
  duplicateCheckPolicy: z.boolean().default(true),
  roles: z.boolean().default(true),
  stages: z.boolean().default(true),
  tiers: z.boolean().default(true),
  rewardComponents: z.boolean().default(true),
  distributions: z.boolean().default(true),
});

export type KpiCopySelection = z.infer<typeof kpiCopySelectionSchema>;

export const rewardPreviewContributorSchema = z.object({
  id: z.string().trim().min(1).optional(),
  userId: z.string().trim().min(1).nullable().optional(),
  contributorRoleId: z.string().trim().min(1).nullable().optional(),
  creditPercent: z.number().min(0).max(100).default(0),
  isExcludedFromReward: z.boolean().default(false),
  selectorTags: z.array(z.string().trim().min(1)).default([]),
});

export const rewardPreviewInputSchema = z.object({
  achievementId: z.string().trim().min(1).optional(),
  actualValue: z.number().nullable().optional(),
  actualDate: z.coerce.date().nullable().optional(),
  computedScore: z.number().nullable().optional(),
  effectiveScore: z.number().nullable().optional(),
  reportingDate: z.coerce.date().optional(),
  achievementFormData: z.record(z.string(), z.unknown()).default({}),
  contributors: z.array(rewardPreviewContributorSchema).default([]),
  manualTierCode: z.string().trim().min(1).nullable().optional(),
  systemMetrics: z.record(z.string(), z.unknown()).default({}),
});

export type RewardPreviewInput = z.infer<typeof rewardPreviewInputSchema>;
