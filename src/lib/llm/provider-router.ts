import { createProvider, getProviderFromModelCode } from "./providers/llm-provider";
import type { LlmExecutionRequest, LlmExecutionResponse, ProviderCode, ProviderConfig } from "./types";

type ProviderHealth = {
  providerCode: ProviderCode;
  configured: boolean;
  healthy: boolean;
};

const providerConfigs: Record<ProviderCode, ProviderConfig> = {
  google: {
    apiKey: process.env.GOOGLE_AI_API_KEY ?? "",
    model: "gemini-2.5-pro",
    baseURL: "https://generativelanguage.googleapis.com/v1beta",
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY ?? "",
    model: "gpt-5.2",
    baseURL: "https://api.openai.com/v1",
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY ?? "",
    model: "claude-3-5-sonnet",
    baseURL: "https://api.anthropic.com/v1",
  },
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY ?? "",
    model: "deepseek-chat",
    baseURL: "https://api.deepseek.com/v1",
  },
  groq: {
    apiKey: process.env.GROQ_API_KEY ?? "",
    model: "llama-3.3-70b-versatile",
    baseURL: "https://api.groq.com/openai/v1",
  },
};

export class LlmProviderRouter {
  private readonly providers = new Map<ProviderCode, ReturnType<typeof createProvider>>();

  constructor() {
    for (const [providerCode, config] of Object.entries(providerConfigs) as Array<[ProviderCode, ProviderConfig]>) {
      if (!config.apiKey) {
        continue;
      }
      this.providers.set(providerCode, createProvider(providerCode, config));
    }
  }

  async executeWithFallback(
    request: LlmExecutionRequest,
    fallbacks: string[] = [],
  ): Promise<{
    response: LlmExecutionResponse;
    attemptedModels: string[];
  }> {
    const models = [request.modelCode, ...fallbacks].filter(Boolean);
    const attemptedModels: string[] = [];
    let lastError: Error | null = null;

    for (const modelCode of models) {
      attemptedModels.push(modelCode);
      const providerCode = getProviderFromModelCode(modelCode);
      const provider = this.providers.get(providerCode);
      if (!provider) {
        lastError = new Error(`Provider ${providerCode} is not configured.`);
        continue;
      }

      try {
        const response = await provider.execute({ ...request, modelCode });
        return { response, attemptedModels };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    throw lastError ?? new Error("No provider could satisfy the LLM request.");
  }

  async getHealth() {
    const results = await Promise.all(
      (Object.keys(providerConfigs) as ProviderCode[]).map(async (providerCode) => {
        const provider = this.providers.get(providerCode);
        if (!provider) {
          return {
            providerCode,
            configured: false,
            healthy: false,
          } satisfies ProviderHealth;
        }

        try {
          return {
            providerCode,
            configured: true,
            healthy: await provider.isHealthy(),
          } satisfies ProviderHealth;
        } catch {
          return {
            providerCode,
            configured: true,
            healthy: false,
          } satisfies ProviderHealth;
        }
      }),
    );

    return results;
  }
}

export const llmProviderRouter = new LlmProviderRouter();
