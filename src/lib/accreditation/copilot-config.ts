import { CopilotMode, CriterionDataType, type Prisma } from "@prisma/client";
import { z } from "zod";

export const copilotActionSchema = z.enum([
  "EXPLAIN",
  "REVIEW",
  "DRAFT",
  "WATCHLIST",
  "QUESTION_CHECKLIST",
]);

export const llmGroundingRequirementSchema = z.enum([
  "METADATA_ONLY",
  "EXTRACTED_TEXT_PREFERRED",
  "EXTRACTED_TEXT_REQUIRED",
]);

export const llmFallbackPolicySchema = z.enum(["DETERMINISTIC", "ERROR"]);

export const llmPrivacyModeSchema = z.enum(["STANDARD_REDACTION", "STRICT_REDACTION"]);

export const llmCitationPolicySchema = z.enum(["REQUIRED", "OPTIONAL"]);

export const assistantReviewFocusSchema = z.enum([
  "DATA_ACCURACY",
  "NARRATIVE_QUALITY",
  "MIXED",
]);

export const assistantYearCoverageSchema = z.enum(["NONE", "PARTIAL", "FULL"]);

const metricRuleSchema = z.object({
  semanticLabel: z.string().trim().min(1).max(200).optional(),
  expectedUnit: z.string().trim().min(1).max(80).optional(),
  requiredYearCoverage: assistantYearCoverageSchema.optional(),
  allowNotApplicable: z.boolean().optional(),
  zeroMeansMissing: z.boolean().optional(),
  staleToleranceDays: z.number().int().min(0).max(3650).optional(),
  contradictionThreshold: z.number().min(0).optional(),
  evidenceRequiredForNarrativeClaim: z.boolean().optional(),
});

export const blockAssistantConfigSchema = z.object({
  reviewFocus: assistantReviewFocusSchema.optional(),
  requiredNarrativeElements: z.array(z.string().trim().min(1).max(240)).max(20).optional(),
  bannedPhrases: z.array(z.string().trim().min(1).max(240)).max(20).optional(),
  toneGuide: z.string().trim().min(1).max(120).optional(),
  minWordCount: z.number().int().min(0).max(10000).optional(),
  maxWordCount: z.number().int().min(1).max(20000).optional(),
  maxClaimsWithoutEvidence: z.number().int().min(0).max(50).optional(),
  checkFormulaParity: z.boolean().optional(),
  checkSlabBoundaries: z.boolean().optional(),
  suggestBetterDataSources: z.boolean().optional(),
  warnOnManualOverride: z.boolean().optional(),
  preferredEvidenceDocTypes: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  metricRules: z.record(z.string().trim().min(1), metricRuleSchema).optional(),
}).superRefine((value, ctx) => {
  if (
    value.minWordCount !== undefined &&
    value.maxWordCount !== undefined &&
    value.minWordCount > value.maxWordCount
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["minWordCount"],
      message: "minWordCount cannot be greater than maxWordCount.",
    });
  }
});

export const bodyVersionLlmConfigSchema = z.object({
  enabledActions: z.array(copilotActionSchema).min(1).max(5).default(["EXPLAIN", "REVIEW", "DRAFT", "WATCHLIST"]),
  groundingRequirement: llmGroundingRequirementSchema.default("METADATA_ONLY"),
  citationPolicy: llmCitationPolicySchema.default("REQUIRED"),
  privacyMode: llmPrivacyModeSchema.default("STANDARD_REDACTION"),
  fallbackPolicy: llmFallbackPolicySchema.default("DETERMINISTIC"),
  maxInputTokens: z.number().int().min(1).max(2_000_000).nullable().optional(),
  maxOutputTokens: z.number().int().min(1).max(128_000).nullable().optional(),
  maxEvidenceChunks: z.number().int().min(1).max(50).default(8),
  maxTotalGroundingChars: z.number().int().min(1_000).max(500_000).default(24_000),
  schemaVersion: z.string().trim().min(1).max(40).default("1"),
});

export const bodyVersionCopilotConfigInputSchema = z.object({
  copilotMode: z.nativeEnum(CopilotMode),
  assistantPackKey: z.string().trim().min(1).max(120).nullable().optional(),
  llmProfileId: z.string().trim().min(1).max(191).nullable().optional(),
  llmConfig: bodyVersionLlmConfigSchema.nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.copilotMode === CopilotMode.LLM_ASSISTED && !value.llmProfileId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["llmProfileId"],
      message: "llmProfileId is required when copilotMode is LLM_ASSISTED.",
    });
  }
});

export type BodyVersionLlmConfig = z.infer<typeof bodyVersionLlmConfigSchema>;
export type BodyVersionCopilotConfigInput = z.infer<typeof bodyVersionCopilotConfigInputSchema>;
export type BlockAssistantConfig = z.infer<typeof blockAssistantConfigSchema>;

function asJsonObject(value: Prisma.JsonValue | Prisma.InputJsonValue | null | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value;
}

export function parseBlockAssistantConfig(
  value: Prisma.JsonValue | Prisma.InputJsonValue | null | undefined,
  dataType: CriterionDataType,
) {
  const object = asJsonObject(value);
  const parsed = blockAssistantConfigSchema.safeParse(object ?? {});
  if (!parsed.success) {
    return null;
  }

  const normalized = parsed.data;
  return {
    reviewFocus:
      normalized.reviewFocus ??
      (dataType === CriterionDataType.QUALITATIVE
        ? "NARRATIVE_QUALITY"
        : dataType === CriterionDataType.HYBRID
          ? "MIXED"
          : "DATA_ACCURACY"),
    requiredNarrativeElements: normalized.requiredNarrativeElements ?? [],
    bannedPhrases: normalized.bannedPhrases ?? [],
    toneGuide: normalized.toneGuide ?? (dataType === CriterionDataType.QUALITATIVE ? "formal_academic" : undefined),
    minWordCount: normalized.minWordCount,
    maxWordCount: normalized.maxWordCount,
    maxClaimsWithoutEvidence:
      normalized.maxClaimsWithoutEvidence ??
      (dataType === CriterionDataType.QUALITATIVE ? 2 : undefined),
    checkFormulaParity: normalized.checkFormulaParity ?? true,
    checkSlabBoundaries: normalized.checkSlabBoundaries ?? true,
    suggestBetterDataSources: normalized.suggestBetterDataSources ?? true,
    warnOnManualOverride: normalized.warnOnManualOverride ?? true,
    preferredEvidenceDocTypes: normalized.preferredEvidenceDocTypes ?? [],
    metricRules: normalized.metricRules ?? {},
  } satisfies BlockAssistantConfig;
}

export function parseBodyVersionLlmConfig(
  value: Prisma.JsonValue | Prisma.InputJsonValue | null | undefined,
) {
  const object = asJsonObject(value);
  const parsed = bodyVersionLlmConfigSchema.safeParse(object ?? {});
  return parsed.success ? parsed.data : bodyVersionLlmConfigSchema.parse({});
}
