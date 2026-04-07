import { AnthropicProvider } from "./anthropic-provider";
import { GoogleProvider } from "./google-provider";
import { OpenAiCompatibleProvider } from "./openai-compatible-provider";
import type { LlmProvider, ProviderCode, ProviderConfig } from "../types";

export function getProviderFromModelCode(modelCode: string): ProviderCode {
  const normalized = modelCode.toLowerCase();
  if (
    normalized.startsWith("gpt") ||
    normalized.startsWith("chatgpt") ||
    normalized.startsWith("o1") ||
    normalized.startsWith("o3")
  ) {
    return "openai";
  }
  if (normalized.startsWith("claude")) {
    return "anthropic";
  }
  if (normalized.startsWith("gemini")) {
    return "google";
  }
  if (normalized.startsWith("deepseek")) {
    return "deepseek";
  }
  if (
    normalized.startsWith("groq") ||
    normalized.startsWith("llama") ||
    normalized.startsWith("mixtral") ||
    normalized.startsWith("gemma")
  ) {
    return "groq";
  }
  throw new Error(`Unknown model code: "${modelCode}".`);
}

export function createProvider(type: ProviderCode, config: ProviderConfig): LlmProvider {
  switch (type) {
    case "openai":
      return new OpenAiCompatibleProvider(config, { providerCode: "openai" });
    case "deepseek":
      return new OpenAiCompatibleProvider(config, { providerCode: "deepseek" });
    case "groq":
      return new OpenAiCompatibleProvider(config, { providerCode: "groq" });
    case "anthropic":
      return new AnthropicProvider(config);
    case "google":
      return new GoogleProvider(config);
    default:
      throw new Error(`Unsupported provider: ${type satisfies never}`);
  }
}
