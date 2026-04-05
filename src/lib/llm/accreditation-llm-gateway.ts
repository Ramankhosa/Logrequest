import { llmProviderRouter } from "./provider-router";
import { resolvePlatformLlmProfile } from "./model-registry";
import type { BodyVersionLlmConfig } from "@/lib/accreditation/copilot-config";

type GatewayInput = {
  profileId: string;
  systemPrompt: string;
  userPrompt: string;
  llmConfig: BodyVersionLlmConfig;
  metadata?: Record<string, unknown>;
};

export async function executeAccreditationLlm(input: GatewayInput) {
  const profile = await resolvePlatformLlmProfile(input.profileId);
  if (!profile) {
    return {
      status: "error" as const,
      message: "Configured LLM profile is missing or inactive.",
    };
  }

  const maxTokensOut =
    input.llmConfig.maxOutputTokens ??
    profile.defaultMaxTokensOut ??
    profile.primaryModel.maxOutputTokens ??
    4096;

  const { response, attemptedModels } = await llmProviderRouter.executeWithFallback(
    {
      modelCode: profile.primaryModel.code,
      messages: [
        { role: "system", content: input.systemPrompt },
        { role: "user", content: input.userPrompt },
      ],
      maxTokensOut,
      temperature: profile.defaultTemperature ?? 0.2,
      reasoningEffort: profile.defaultReasoningEffort,
      metadata: input.metadata,
    },
    profile.fallbackModels.map((model) => model.code),
  );

  return {
    status: "success" as const,
    profile,
    response,
    attemptedModels,
  };
}
