import {
  AccreditationScope,
  AccreditationScoreConversionType,
  AccreditationTemplateLifecycleStatus,
  CopilotMode,
  CriterionBlockType,
  CriterionBlockVisibility,
  CriterionDataType,
  CriterionYearAggregation,
  Prisma,
} from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { publishSuperadminVersionBlocks, validateSuperadminVersionBlocks } from "./block-template-service";
import { blockAssistantConfigSchema } from "./copilot-config";

const MAX_ACCREDITATION_BLOCK_TITLE_LENGTH = 600;

type ServiceResult<T extends object = Record<string, never>> =
  | ({ status: "success" } & T)
  | { status: "error"; message: string };

const supportedFinalLifecycleStatuses = new Set<AccreditationTemplateLifecycleStatus>([
  AccreditationTemplateLifecycleStatus.DRAFT,
  AccreditationTemplateLifecycleStatus.VALIDATED,
  AccreditationTemplateLifecycleStatus.PUBLISHED,
]);

const bundleBodySchema = z.object({
  code: z.string().trim().min(2).max(40),
  name: z.string().trim().min(2).max(200),
  country: z.string().trim().max(20).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  websiteUrl: z.string().trim().url().nullable().optional(),
  scope: z.nativeEnum(AccreditationScope).optional(),
  isActive: z.boolean().optional(),
}).passthrough();

const bundleVersionSchema = z.object({
  versionCode: z.string().trim().min(1).max(80),
  versionName: z.string().trim().min(2).max(200),
  assistantPackKey: z.string().trim().max(120).nullable().optional(),
  copilotMode: z.nativeEnum(CopilotMode).optional(),
  llmProfileId: z.string().trim().min(1).nullable().optional(),
  llmProfileKey: z.string().trim().min(1).nullable().optional(),
  llmConfig: z.unknown().optional(),
  scoreBase: z.number().positive(),
  convertedScaleMax: z.number().positive().nullable().optional(),
  conversionType: z.nativeEnum(AccreditationScoreConversionType).nullable().optional(),
  conversionFactor: z.number().positive().nullable().optional(),
  effectiveFrom: z.coerce.date().nullable().optional(),
  effectiveTo: z.coerce.date().nullable().optional(),
  lifecycleStatus: z.nativeEnum(AccreditationTemplateLifecycleStatus).optional(),
  isActive: z.boolean().optional(),
  sourceDocument: z.unknown().optional(),
  notes: z.array(z.string()).optional(),
}).passthrough();

const bundleProfileSchema = z.object({
  profileCode: z.string().trim().min(1).max(80),
  profileName: z.string().trim().min(2).max(200),
  description: z.string().trim().max(1000).nullable().optional(),
  isDefault: z.boolean().optional(),
}).passthrough();

const bundleBlockSchema = z.object({
  blockCode: z.string().trim().min(1).max(80),
  parentBlockCode: z.string().trim().min(1).nullable().optional(),
  title: z.string().trim().min(2).max(MAX_ACCREDITATION_BLOCK_TITLE_LENGTH),
  description: z.string().trim().max(4000).nullable().optional(),
  blockType: z.nativeEnum(CriterionBlockType),
  visibility: z.nativeEnum(CriterionBlockVisibility).optional(),
  contributesToTotal: z.boolean().optional(),
  dataType: z.nativeEnum(CriterionDataType).default(CriterionDataType.QUANTITATIVE),
  yearAggregation: z.nativeEnum(CriterionYearAggregation).default(CriterionYearAggregation.AVERAGE),
  yearAggregationConfig: z.unknown().optional(),
  maxScore: z.number().nonnegative().nullable().optional(),
  sortOrder: z.number().int().min(0).default(0),
  unitOfMeasure: z.string().trim().max(80).nullable().optional(),
  inputSchema: z.unknown().optional(),
  outputSchema: z.unknown().optional(),
  calculationRule: z.unknown().optional(),
  scoringRule: z.unknown().optional(),
  validationRules: z.unknown().optional(),
  evidenceSchema: z.unknown().optional(),
  expectedEvidence: z.unknown().optional(),
  assistantConfig: z.unknown().optional(),
  dependencyRules: z.unknown().optional(),
  sourceLinks: z.unknown().optional(),
  isActive: z.boolean().optional(),
}).passthrough();

const bundleGradeBandSchema = z.object({
  gradeLabel: z.string().trim().min(1).max(80),
  scoreMin: z.number(),
  scoreMax: z.number(),
  outcome: z.string().trim().min(1).max(200),
  sortOrder: z.number().int().min(0).default(0),
}).passthrough();

const bundleThresholdRuleSchema = z.object({
  blockCode: z.string().trim().min(1).nullable().optional(),
  thresholdType: z.string().trim().min(1).max(120),
  minValue: z.number(),
  outcome: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
}).passthrough();

const templateBundleSchema = z.object({
  schemaVersion: z.string().trim().min(1),
  bundleType: z.string().trim().min(1),
  sourceArtifact: z.unknown().optional(),
  body: bundleBodySchema,
  version: bundleVersionSchema,
  profiles: z.array(bundleProfileSchema).default([]),
  blocks: z.array(bundleBlockSchema).default([]),
  gradeBands: z.array(bundleGradeBandSchema).default([]),
  thresholdRules: z.array(bundleThresholdRuleSchema).default([]),
}).passthrough();

type TemplateBundle = z.infer<typeof templateBundleSchema>;
type BundleProfile = z.infer<typeof bundleProfileSchema>;
type BundleBlock = z.infer<typeof bundleBlockSchema>;

function normalizeNullableString(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function jsonValueOrUndefined(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return value as Prisma.InputJsonValue;
}

function blockTypeSupportsChildren(blockType: CriterionBlockType) {
  return blockType === CriterionBlockType.GROUP || blockType === CriterionBlockType.COMPOSITE;
}

function blockTypeIsLeaf(blockType: CriterionBlockType) {
  return blockType === CriterionBlockType.METRIC || blockType === CriterionBlockType.QUALITATIVE;
}

function resolveBlockDepth(
  blockCode: string,
  blocksByCode: Map<string, BundleBlock>,
  cache = new Map<string, number>(),
  trail = new Set<string>(),
): number | null {
  const cached = cache.get(blockCode);
  if (cached !== undefined) {
    return cached;
  }

  if (trail.has(blockCode)) {
    return null;
  }

  const block = blocksByCode.get(blockCode);
  if (!block) {
    return null;
  }

  if (!block.parentBlockCode) {
    cache.set(blockCode, 0);
    return 0;
  }

  const nextTrail = new Set(trail);
  nextTrail.add(blockCode);
  const parentDepth = resolveBlockDepth(block.parentBlockCode, blocksByCode, cache, nextTrail);
  if (parentDepth === null) {
    return null;
  }

  const depth = parentDepth + 1;
  cache.set(blockCode, depth);
  return depth;
}

function normalizeProfiles(
  profiles: BundleProfile[],
): ServiceResult<{ profiles: BundleProfile[] }> {
  if (profiles.length === 0) {
    return { status: "error", message: "Template bundles must define at least one profile." };
  }

  const normalizedProfiles = profiles.map((profile) => ({
    ...profile,
    profileCode: profile.profileCode.trim().toUpperCase(),
  }));

  const seenProfileCodes = new Set<string>();
  let defaultCount = 0;
  for (const profile of normalizedProfiles) {
    if (seenProfileCodes.has(profile.profileCode)) {
      return {
        status: "error",
        message: `Duplicate profile code ${profile.profileCode} found in the import bundle.`,
      };
    }
    seenProfileCodes.add(profile.profileCode);
    if (profile.isDefault) {
      defaultCount += 1;
    }
  }

  if (defaultCount > 1) {
    return {
      status: "error",
      message: "Only one profile can be marked as default in the import bundle.",
    };
  }

  if (defaultCount === 0 && normalizedProfiles.length > 0) {
    normalizedProfiles[0] = {
      ...normalizedProfiles[0],
      isDefault: true,
    };
  }

  return {
    status: "success",
    profiles: normalizedProfiles,
  };
}

function validateBundleBlocks(
  blocks: BundleBlock[],
  thresholdRules: Array<z.infer<typeof bundleThresholdRuleSchema>>,
): ServiceResult<{
  blockDepths: Map<string, number>;
  sortedBlocks: BundleBlock[];
}> {
  if (blocks.length === 0) {
    return { status: "error", message: "Template bundles must define at least one block." };
  }

  const blocksByCode = new Map<string, BundleBlock>();
  for (const block of blocks) {
    if (blocksByCode.has(block.blockCode)) {
      return {
        status: "error",
        message: `Duplicate block code ${block.blockCode} found in the import bundle.`,
      };
    }
    blocksByCode.set(block.blockCode, block);
  }

  let rootCount = 0;
  let leafCount = 0;
  const blockDepths = new Map<string, number>();

  for (const block of blocks) {
    if (!block.parentBlockCode) {
      rootCount += 1;
    } else {
      if (block.parentBlockCode === block.blockCode) {
        return {
          status: "error",
          message: `Block ${block.blockCode} cannot reference itself as a parent.`,
        };
      }

      const parent = blocksByCode.get(block.parentBlockCode);
      if (!parent) {
        return {
          status: "error",
          message: `Block ${block.blockCode} references missing parent ${block.parentBlockCode}.`,
        };
      }

      if (!blockTypeSupportsChildren(parent.blockType)) {
        return {
          status: "error",
          message: `Block ${block.blockCode} cannot be nested under leaf block ${parent.blockCode}.`,
        };
      }
    }

    if (blockTypeIsLeaf(block.blockType)) {
      leafCount += 1;
    }

    if (block.assistantConfig !== undefined && block.assistantConfig !== null) {
      const parsedAssistantConfig = blockAssistantConfigSchema.safeParse(block.assistantConfig);
      if (!parsedAssistantConfig.success) {
        return {
          status: "error",
          message:
            parsedAssistantConfig.error.issues[0]?.message ??
            `assistantConfig is invalid for ${block.blockCode}.`,
        };
      }
    }

    const depth = resolveBlockDepth(block.blockCode, blocksByCode, blockDepths);
    if (depth === null) {
      return {
        status: "error",
        message: `The import bundle contains a parent cycle involving ${block.blockCode}.`,
      };
    }

    if (depth > 2) {
      return {
        status: "error",
        message: `Block ${block.blockCode} exceeds the maximum supported depth of 3 levels.`,
      };
    }

    blockDepths.set(block.blockCode, depth);
  }

  if (rootCount === 0) {
    return { status: "error", message: "Template bundles must define at least one root block." };
  }

  if (leafCount === 0) {
    return {
      status: "error",
      message: "Template bundles must define at least one metric or qualitative leaf block.",
    };
  }

  for (const rule of thresholdRules) {
    if (rule.blockCode && !blocksByCode.has(rule.blockCode)) {
      return {
        status: "error",
        message: `Threshold rule ${rule.thresholdType} references unknown block ${rule.blockCode}.`,
      };
    }
  }

  const sortedBlocks = [...blocks].sort((left, right) => {
    const depthDiff =
      (blockDepths.get(left.blockCode) ?? 0) - (blockDepths.get(right.blockCode) ?? 0);
    if (depthDiff !== 0) {
      return depthDiff;
    }

    if (left.sortOrder !== right.sortOrder) {
      return left.sortOrder - right.sortOrder;
    }

    return left.blockCode.localeCompare(right.blockCode);
  });

  return { status: "success", blockDepths, sortedBlocks };
}

async function cleanupImportedTemplate(bodyId: string, versionId: string) {
  await prisma.auditLog.deleteMany({
    where: {
      targetId: versionId,
    },
  });
  await prisma.accreditationBody.delete({
    where: { id: bodyId },
  });
}

export async function importSuperadminAccreditationTemplateBundle(
  input: unknown,
  actorUserId: string,
): Promise<
  ServiceResult<{
    body: {
      id: string;
      code: string;
      name: string;
    };
    version: {
      id: string;
      versionCode: string;
      versionName: string;
      lifecycleStatus: AccreditationTemplateLifecycleStatus;
    };
    importedCounts: {
      profileCount: number;
      blockCount: number;
      gradeBandCount: number;
      thresholdRuleCount: number;
    };
  }>
> {
  const parsed = templateBundleSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid accreditation template bundle.",
    };
  }

  const bundle = parsed.data;
  if (bundle.bundleType !== "accreditation-template") {
    return {
      status: "error",
      message: "Unsupported template bundle type. Expected accreditation-template.",
    };
  }

  if (bundle.body.scope && bundle.body.scope !== AccreditationScope.GLOBAL) {
    return {
      status: "error",
      message: "Only global accreditation template bundles can be imported through superadmin.",
    };
  }

  const targetLifecycleStatus =
    bundle.version.lifecycleStatus ?? AccreditationTemplateLifecycleStatus.DRAFT;
  if (!supportedFinalLifecycleStatuses.has(targetLifecycleStatus)) {
    return {
      status: "error",
      message:
        "Template bundles can only be imported as DRAFT, VALIDATED, or PUBLISHED versions.",
    };
  }

  const normalizedProfiles = normalizeProfiles(bundle.profiles);
  if (normalizedProfiles.status === "error") {
    return normalizedProfiles;
  }

  const validatedBlocks = validateBundleBlocks(bundle.blocks, bundle.thresholdRules);
  if (validatedBlocks.status === "error") {
    return validatedBlocks;
  }

  const bodyCode = bundle.body.code.trim().toUpperCase();
  const existingBody = await prisma.accreditationBody.findFirst({
    where: {
      scope: AccreditationScope.GLOBAL,
      code: bodyCode,
    },
    select: { id: true },
  });
  if (existingBody) {
    return {
      status: "error",
      message: `A global accreditation body with code ${bodyCode} already exists.`,
    };
  }

  let llmProfileId: string | null = null;
  const requestedProfileKey = normalizeNullableString(bundle.version.llmProfileKey);
  const requestedProfileId = normalizeNullableString(bundle.version.llmProfileId);
  if (requestedProfileKey || requestedProfileId) {
    const llmProfile = await prisma.platformLlmProfile.findFirst({
      where: requestedProfileId
        ? { id: requestedProfileId, isActive: true }
        : { key: requestedProfileKey ?? undefined, isActive: true },
      select: { id: true },
    });
    if (!llmProfile) {
      return {
        status: "error",
        message: "The template bundle references an unknown or inactive LLM profile.",
      };
    }
    llmProfileId = llmProfile.id;
  }

  let createdBodyId: string | null = null;
  let createdVersionId: string | null = null;

  try {
    const created = await prisma.$transaction(async (tx) => {
      const body = await tx.accreditationBody.create({
        data: {
          scope: AccreditationScope.GLOBAL,
          code: bodyCode,
          name: bundle.body.name.trim(),
          country: normalizeNullableString(bundle.body.country),
          description: normalizeNullableString(bundle.body.description),
          websiteUrl: normalizeNullableString(bundle.body.websiteUrl),
          isActive: bundle.body.isActive ?? true,
          createdByUserId: actorUserId,
        },
      });

      const version = await tx.accreditationBodyVersion.create({
        data: {
          bodyId: body.id,
          versionCode: bundle.version.versionCode.trim(),
          versionName: bundle.version.versionName.trim(),
          assistantPackKey: normalizeNullableString(bundle.version.assistantPackKey),
          copilotMode: bundle.version.copilotMode ?? CopilotMode.DETERMINISTIC_ONLY,
          llmProfileId,
          llmConfig: jsonValueOrUndefined(bundle.version.llmConfig),
          scoreBase: bundle.version.scoreBase,
          convertedScaleMax: bundle.version.convertedScaleMax ?? null,
          conversionType: bundle.version.conversionType ?? AccreditationScoreConversionType.NONE,
          conversionFactor: bundle.version.conversionFactor ?? null,
          effectiveFrom: bundle.version.effectiveFrom ?? null,
          effectiveTo: bundle.version.effectiveTo ?? null,
          lifecycleStatus: AccreditationTemplateLifecycleStatus.DRAFT,
          isLocked: false,
          isActive: bundle.version.isActive ?? true,
        },
      });

      for (const profile of normalizedProfiles.profiles) {
        await tx.accreditationProfile.create({
          data: {
            versionId: version.id,
            profileCode: profile.profileCode,
            profileName: profile.profileName.trim(),
            description: normalizeNullableString(profile.description),
            isDefault: profile.isDefault ?? false,
          },
        });
      }

      if (bundle.gradeBands.length > 0) {
        await tx.accreditationGradeBand.createMany({
          data: bundle.gradeBands.map((band) => ({
            versionId: version.id,
            gradeLabel: band.gradeLabel.trim(),
            scoreMin: band.scoreMin,
            scoreMax: band.scoreMax,
            outcome: band.outcome.trim(),
            sortOrder: band.sortOrder,
          })),
        });
      }

      const blockIdByCode = new Map<string, string>();
      for (const block of validatedBlocks.sortedBlocks) {
        const depth = validatedBlocks.blockDepths.get(block.blockCode) ?? 0;
        const parentId = block.parentBlockCode
          ? blockIdByCode.get(block.parentBlockCode) ?? null
          : null;

        const createdBlock = await tx.criterionBlock.create({
          data: {
            versionId: version.id,
            parentId,
            blockCode: block.blockCode.trim(),
            lineageKey: block.blockCode.trim(),
            blockType: block.blockType,
            visibility: block.visibility ?? CriterionBlockVisibility.VISIBLE_INPUT,
            contributesToTotal: block.contributesToTotal ?? true,
            isSectionRoot: depth === 0,
            title: block.title.trim(),
            description: normalizeNullableString(block.description),
            dataType: block.dataType,
            yearAggregation: block.yearAggregation,
            yearAggregationConfig: jsonValueOrUndefined(block.yearAggregationConfig),
            maxScore: block.maxScore ?? null,
            sortOrder: block.sortOrder,
            depth,
            unitOfMeasure: normalizeNullableString(block.unitOfMeasure),
            inputSchema: jsonValueOrUndefined(block.inputSchema),
            outputSchema: jsonValueOrUndefined(block.outputSchema),
            calculationRule: jsonValueOrUndefined(block.calculationRule),
            scoringRule: jsonValueOrUndefined(block.scoringRule),
            validationRules: jsonValueOrUndefined(block.validationRules),
            evidenceSchema: jsonValueOrUndefined(block.evidenceSchema),
            expectedEvidence: jsonValueOrUndefined(
              block.expectedEvidence ?? block.evidenceSchema,
            ),
            assistantConfig: jsonValueOrUndefined(block.assistantConfig),
            dependencyRules: jsonValueOrUndefined(block.dependencyRules),
            sourceLinks: jsonValueOrUndefined(block.sourceLinks),
            isLeaf: blockTypeIsLeaf(block.blockType),
            isActive: block.isActive ?? true,
            createdByUserId: actorUserId,
          },
        });

        blockIdByCode.set(block.blockCode, createdBlock.id);
      }

      if (bundle.thresholdRules.length > 0) {
        await tx.accreditationThresholdRule.createMany({
          data: bundle.thresholdRules.map((rule) => ({
            versionId: version.id,
            blockId: rule.blockCode ? blockIdByCode.get(rule.blockCode) ?? null : null,
            thresholdType: rule.thresholdType.trim(),
            minValue: rule.minValue,
            outcome: rule.outcome.trim(),
            description: normalizeNullableString(rule.description),
          })),
        });
      }

      await tx.auditLog.create({
        data: {
          actorUserId,
          actorRole: "SUPERADMIN",
          targetType: "AccreditationBodyVersion",
          targetId: version.id,
          action: "accreditation.template.import",
          newState: {
            bodyCode,
            versionCode: version.versionCode,
            schemaVersion: bundle.schemaVersion,
            requestedLifecycleStatus: targetLifecycleStatus,
            importedProfileCount: normalizedProfiles.profiles.length,
            importedBlockCount: validatedBlocks.sortedBlocks.length,
            importedGradeBandCount: bundle.gradeBands.length,
            importedThresholdRuleCount: bundle.thresholdRules.length,
          } as Prisma.InputJsonValue,
          metadata: jsonValueOrUndefined(bundle.sourceArtifact),
        },
      });

      return {
        body,
        version,
        importedCounts: {
          profileCount: normalizedProfiles.profiles.length,
          blockCount: validatedBlocks.sortedBlocks.length,
          gradeBandCount: bundle.gradeBands.length,
          thresholdRuleCount: bundle.thresholdRules.length,
        },
      };
    });

    createdBodyId = created.body.id;
    createdVersionId = created.version.id;

    let finalVersion = created.version;

    if (targetLifecycleStatus === AccreditationTemplateLifecycleStatus.VALIDATED ||
      targetLifecycleStatus === AccreditationTemplateLifecycleStatus.PUBLISHED) {
      const validateResult = await validateSuperadminVersionBlocks(created.version.id, actorUserId);
      if (validateResult.status === "error") {
        await cleanupImportedTemplate(created.body.id, created.version.id);
        return { status: "error", message: validateResult.message };
      }
      finalVersion = validateResult.version;
    }

    if (targetLifecycleStatus === AccreditationTemplateLifecycleStatus.PUBLISHED) {
      const publishResult = await publishSuperadminVersionBlocks(created.version.id, actorUserId);
      if (publishResult.status === "error") {
        await cleanupImportedTemplate(created.body.id, created.version.id);
        return { status: "error", message: publishResult.message };
      }
      finalVersion = publishResult.version;
    }

    return {
      status: "success",
      body: {
        id: created.body.id,
        code: created.body.code,
        name: created.body.name,
      },
      version: {
        id: finalVersion.id,
        versionCode: finalVersion.versionCode,
        versionName: finalVersion.versionName,
        lifecycleStatus: finalVersion.lifecycleStatus,
      },
      importedCounts: created.importedCounts,
    };
  } catch (error) {
    if (createdBodyId && createdVersionId) {
      await cleanupImportedTemplate(createdBodyId, createdVersionId);
    }

    return {
      status: "error",
      message: error instanceof Error ? error.message : "Failed to import accreditation template bundle.",
    };
  }
}
