import { PlatformLlmProvider } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getProviderFromModelCode } from "./providers/llm-provider";
import type { ProviderCode, ResolvedLlmProfile } from "./types";

const modelInputSchema = z.object({
  code: z.string().trim().min(1).max(120),
  displayName: z.string().trim().min(1).max(200),
  provider: z.nativeEnum(PlatformLlmProvider),
  contextWindow: z.number().int().min(1),
  maxOutputTokens: z.number().int().min(1).nullable().optional(),
  supportsVision: z.boolean().optional(),
  supportsStreaming: z.boolean().optional(),
  supportsStructuredOutputs: z.boolean().optional(),
  supportsReasoning: z.boolean().optional(),
  inputCostPer1M: z.number().int().min(0).optional(),
  outputCostPer1M: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

const profileInputSchema = z.object({
  key: z.string().trim().min(1).max(120),
  displayName: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).nullable().optional(),
  primaryModelId: z.string().trim().min(1),
  fallbackModelIds: z.array(z.string().trim().min(1)).max(10).optional(),
  defaultMaxTokensIn: z.number().int().min(1).nullable().optional(),
  defaultMaxTokensOut: z.number().int().min(1).nullable().optional(),
  defaultTemperature: z.number().min(0).max(2).nullable().optional(),
  defaultReasoningEffort: z.string().trim().min(1).max(40).nullable().optional(),
  supportsStructuredOutputs: z.boolean().optional(),
  usageTags: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

function asProviderCode(provider: PlatformLlmProvider): ProviderCode {
  switch (provider) {
    case PlatformLlmProvider.OPENAI:
      return "openai";
    case PlatformLlmProvider.ANTHROPIC:
      return "anthropic";
    case PlatformLlmProvider.GOOGLE:
      return "google";
    case PlatformLlmProvider.DEEPSEEK:
      return "deepseek";
    case PlatformLlmProvider.GROQ:
      return "groq";
    default:
      throw new Error(`Unsupported provider: ${provider satisfies never}`);
  }
}

async function ensureModelIdsExist(modelIds: string[], options?: { requireActive?: boolean }) {
  if (modelIds.length === 0) {
    return null;
  }
  const found = await prisma.platformLlmModel.findMany({
    where: {
      id: { in: modelIds },
      ...(options?.requireActive ? { isActive: true } : {}),
    },
    select: { id: true },
  });
  if (found.length !== new Set(modelIds).size) {
    return options?.requireActive
      ? "One or more referenced models were not found or are inactive."
      : "One or more referenced models were not found.";
  }
  return null;
}

function validateProviderAndModelCode(provider: PlatformLlmProvider, modelCode: string) {
  let inferredProvider: ProviderCode;
  try {
    inferredProvider = getProviderFromModelCode(modelCode);
  } catch {
    return `Model code "${modelCode}" is not recognized. Use a known provider prefix (gpt/chatgpt, claude, gemini, deepseek, llama/gemma/mixtral).`;
  }
  const selectedProvider = asProviderCode(provider);
  if (inferredProvider !== selectedProvider) {
    return `Model code "${modelCode}" maps to ${inferredProvider.toUpperCase()}, but selected provider is ${provider}.`;
  }
  return null;
}

export async function listPlatformLlmModels() {
  return prisma.platformLlmModel.findMany({
    orderBy: [{ isDefault: "desc" }, { provider: "asc" }, { displayName: "asc" }],
  });
}

export async function createPlatformLlmModel(input: unknown) {
  const parsed = modelInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error" as const, message: parsed.error.issues[0]?.message ?? "Invalid model input." };
  }
  const providerMismatchError = validateProviderAndModelCode(parsed.data.provider, parsed.data.code);
  if (providerMismatchError) {
    return { status: "error" as const, message: providerMismatchError };
  }

  try {
    const model = await prisma.$transaction(async (tx) => {
      if (parsed.data.isDefault) {
        await tx.platformLlmModel.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      }
      return tx.platformLlmModel.create({
        data: {
          code: parsed.data.code,
          displayName: parsed.data.displayName,
          provider: parsed.data.provider,
          contextWindow: parsed.data.contextWindow,
          maxOutputTokens: parsed.data.maxOutputTokens ?? null,
          supportsVision: parsed.data.supportsVision ?? false,
          supportsStreaming: parsed.data.supportsStreaming ?? false,
          supportsStructuredOutputs: parsed.data.supportsStructuredOutputs ?? false,
          supportsReasoning: parsed.data.supportsReasoning ?? false,
          inputCostPer1M: parsed.data.inputCostPer1M ?? 0,
          outputCostPer1M: parsed.data.outputCostPer1M ?? 0,
          isActive: parsed.data.isActive ?? true,
          isDefault: parsed.data.isDefault ?? false,
        },
      });
    });
    return { status: "success" as const, model };
  } catch (error) {
    return { status: "error" as const, message: error instanceof Error ? error.message : "Failed to create model." };
  }
}

export async function updatePlatformLlmModel(modelId: string, input: unknown) {
  const parsed = modelInputSchema.partial().safeParse(input);
  if (!parsed.success) {
    return { status: "error" as const, message: parsed.error.issues[0]?.message ?? "Invalid model input." };
  }

  try {
    const existingModel = await prisma.platformLlmModel.findUnique({
      where: { id: modelId },
      select: { code: true, provider: true },
    });
    if (!existingModel) {
      return { status: "error" as const, message: "Model not found." };
    }
    const providerMismatchError = validateProviderAndModelCode(
      parsed.data.provider ?? existingModel.provider,
      parsed.data.code ?? existingModel.code,
    );
    if (providerMismatchError) {
      return { status: "error" as const, message: providerMismatchError };
    }
    const model = await prisma.$transaction(async (tx) => {
      if (parsed.data.isDefault) {
        await tx.platformLlmModel.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      }
      return tx.platformLlmModel.update({
        where: { id: modelId },
        data: {
          ...(parsed.data.code !== undefined ? { code: parsed.data.code } : {}),
          ...(parsed.data.displayName !== undefined ? { displayName: parsed.data.displayName } : {}),
          ...(parsed.data.provider !== undefined ? { provider: parsed.data.provider } : {}),
          ...(parsed.data.contextWindow !== undefined ? { contextWindow: parsed.data.contextWindow } : {}),
          ...(parsed.data.maxOutputTokens !== undefined ? { maxOutputTokens: parsed.data.maxOutputTokens ?? null } : {}),
          ...(parsed.data.supportsVision !== undefined ? { supportsVision: parsed.data.supportsVision } : {}),
          ...(parsed.data.supportsStreaming !== undefined ? { supportsStreaming: parsed.data.supportsStreaming } : {}),
          ...(parsed.data.supportsStructuredOutputs !== undefined ? { supportsStructuredOutputs: parsed.data.supportsStructuredOutputs } : {}),
          ...(parsed.data.supportsReasoning !== undefined ? { supportsReasoning: parsed.data.supportsReasoning } : {}),
          ...(parsed.data.inputCostPer1M !== undefined ? { inputCostPer1M: parsed.data.inputCostPer1M } : {}),
          ...(parsed.data.outputCostPer1M !== undefined ? { outputCostPer1M: parsed.data.outputCostPer1M } : {}),
          ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
          ...(parsed.data.isDefault !== undefined ? { isDefault: parsed.data.isDefault } : {}),
        },
      });
    });
    return { status: "success" as const, model };
  } catch (error) {
    return { status: "error" as const, message: error instanceof Error ? error.message : "Failed to update model." };
  }
}

export async function listPlatformLlmProfiles() {
  return prisma.platformLlmProfile.findMany({
    include: {
      primaryModel: true,
    },
    orderBy: [{ isDefault: "desc" }, { displayName: "asc" }],
  });
}

export async function createPlatformLlmProfile(input: unknown) {
  const parsed = profileInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error" as const, message: parsed.error.issues[0]?.message ?? "Invalid profile input." };
  }

  const fallbackIds = [...new Set(parsed.data.fallbackModelIds ?? [])].filter((id) => id !== parsed.data.primaryModelId);
  const modelError = await ensureModelIdsExist([parsed.data.primaryModelId, ...fallbackIds], { requireActive: true });
  if (modelError) {
    return { status: "error" as const, message: modelError };
  }

  try {
    const profile = await prisma.$transaction(async (tx) => {
      if (parsed.data.isDefault) {
        await tx.platformLlmProfile.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      }
      return tx.platformLlmProfile.create({
        data: {
          key: parsed.data.key,
          displayName: parsed.data.displayName,
          description: parsed.data.description ?? null,
          primaryModelId: parsed.data.primaryModelId,
          fallbackModelIds: fallbackIds,
          defaultMaxTokensIn: parsed.data.defaultMaxTokensIn ?? null,
          defaultMaxTokensOut: parsed.data.defaultMaxTokensOut ?? null,
          defaultTemperature: parsed.data.defaultTemperature ?? null,
          defaultReasoningEffort: parsed.data.defaultReasoningEffort ?? null,
          supportsStructuredOutputs: parsed.data.supportsStructuredOutputs ?? false,
          usageTags: parsed.data.usageTags ?? [],
          isActive: parsed.data.isActive ?? true,
          isDefault: parsed.data.isDefault ?? false,
        },
        include: { primaryModel: true },
      });
    });
    return { status: "success" as const, profile };
  } catch (error) {
    return { status: "error" as const, message: error instanceof Error ? error.message : "Failed to create profile." };
  }
}

export async function updatePlatformLlmProfile(profileId: string, input: unknown) {
  const parsed = profileInputSchema.partial().safeParse(input);
  if (!parsed.success) {
    return { status: "error" as const, message: parsed.error.issues[0]?.message ?? "Invalid profile input." };
  }

  const nextPrimaryModelId = parsed.data.primaryModelId;
  const fallbackIds =
    parsed.data.fallbackModelIds === undefined
      ? undefined
      : [...new Set(parsed.data.fallbackModelIds)].filter((id) => id !== nextPrimaryModelId);

  const modelIdsToCheck = [
    ...(nextPrimaryModelId ? [nextPrimaryModelId] : []),
    ...(fallbackIds ?? []),
  ];
  const modelError = await ensureModelIdsExist(modelIdsToCheck, { requireActive: true });
  if (modelError) {
    return { status: "error" as const, message: modelError };
  }

  try {
    const profile = await prisma.$transaction(async (tx) => {
      if (parsed.data.isDefault) {
        await tx.platformLlmProfile.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      }
      return tx.platformLlmProfile.update({
        where: { id: profileId },
        data: {
          ...(parsed.data.key !== undefined ? { key: parsed.data.key } : {}),
          ...(parsed.data.displayName !== undefined ? { displayName: parsed.data.displayName } : {}),
          ...(parsed.data.description !== undefined ? { description: parsed.data.description ?? null } : {}),
          ...(parsed.data.primaryModelId !== undefined ? { primaryModelId: parsed.data.primaryModelId } : {}),
          ...(fallbackIds !== undefined ? { fallbackModelIds: fallbackIds } : {}),
          ...(parsed.data.defaultMaxTokensIn !== undefined ? { defaultMaxTokensIn: parsed.data.defaultMaxTokensIn ?? null } : {}),
          ...(parsed.data.defaultMaxTokensOut !== undefined ? { defaultMaxTokensOut: parsed.data.defaultMaxTokensOut ?? null } : {}),
          ...(parsed.data.defaultTemperature !== undefined ? { defaultTemperature: parsed.data.defaultTemperature ?? null } : {}),
          ...(parsed.data.defaultReasoningEffort !== undefined ? { defaultReasoningEffort: parsed.data.defaultReasoningEffort ?? null } : {}),
          ...(parsed.data.supportsStructuredOutputs !== undefined ? { supportsStructuredOutputs: parsed.data.supportsStructuredOutputs } : {}),
          ...(parsed.data.usageTags !== undefined ? { usageTags: parsed.data.usageTags } : {}),
          ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
          ...(parsed.data.isDefault !== undefined ? { isDefault: parsed.data.isDefault } : {}),
        },
        include: { primaryModel: true },
      });
    });
    return { status: "success" as const, profile };
  } catch (error) {
    return { status: "error" as const, message: error instanceof Error ? error.message : "Failed to update profile." };
  }
}

export async function resolvePlatformLlmProfile(profileId: string): Promise<ResolvedLlmProfile | null> {
  const profile = await prisma.platformLlmProfile.findFirst({
    where: {
      id: profileId,
      isActive: true,
      primaryModel: { isActive: true },
    },
    include: {
      primaryModel: true,
    },
  });
  if (!profile) {
    return null;
  }

  const fallbackModels = profile.fallbackModelIds.length
    ? await prisma.platformLlmModel.findMany({
        where: {
          id: { in: profile.fallbackModelIds },
          isActive: true,
        },
      })
    : [];
  const fallbackOrder = new Map(profile.fallbackModelIds.map((id, index) => [id, index]));
  fallbackModels.sort((left, right) => (fallbackOrder.get(left.id) ?? 0) - (fallbackOrder.get(right.id) ?? 0));

  return {
    id: profile.id,
    key: profile.key,
    displayName: profile.displayName,
    primaryModel: {
      id: profile.primaryModel.id,
      code: profile.primaryModel.code,
      provider: asProviderCode(profile.primaryModel.provider),
      displayName: profile.primaryModel.displayName,
      contextWindow: profile.primaryModel.contextWindow,
      maxOutputTokens: profile.primaryModel.maxOutputTokens,
      supportsStructuredOutputs: profile.primaryModel.supportsStructuredOutputs,
      supportsReasoning: profile.primaryModel.supportsReasoning,
    },
    fallbackModels: fallbackModels.map((model) => ({
      id: model.id,
      code: model.code,
      provider: asProviderCode(model.provider),
      displayName: model.displayName,
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxOutputTokens,
      supportsStructuredOutputs: model.supportsStructuredOutputs,
      supportsReasoning: model.supportsReasoning,
    })),
    defaultMaxTokensIn: profile.defaultMaxTokensIn,
    defaultMaxTokensOut: profile.defaultMaxTokensOut,
    defaultTemperature: profile.defaultTemperature,
    defaultReasoningEffort: profile.defaultReasoningEffort,
    supportsStructuredOutputs: profile.supportsStructuredOutputs,
    usageTags: profile.usageTags,
  };
}

export async function listActiveProfileOptions() {
  return prisma.platformLlmProfile.findMany({
    where: { isActive: true, primaryModel: { isActive: true } },
    include: { primaryModel: true },
    orderBy: [{ isDefault: "desc" }, { displayName: "asc" }],
  });
}
