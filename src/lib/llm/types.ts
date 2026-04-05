export type ProviderCode = "openai" | "anthropic" | "google" | "deepseek" | "groq";

export type LlmMessage = {
  role: "system" | "user";
  content: string;
};

export type LlmExecutionRequest = {
  modelCode: string;
  messages: LlmMessage[];
  maxTokensOut?: number;
  temperature?: number;
  reasoningEffort?: string | null;
  metadata?: Record<string, unknown>;
};

export type LlmExecutionResponse = {
  output: string;
  outputTokens: number;
  modelCode: string;
  providerCode: ProviderCode;
  metadata?: Record<string, unknown>;
};

export interface LlmProvider {
  readonly name: ProviderCode;
  execute(request: LlmExecutionRequest): Promise<LlmExecutionResponse>;
  isHealthy(): Promise<boolean>;
}

export type ProviderConfig = {
  apiKey: string;
  model: string;
  baseURL: string;
  timeoutMs?: number;
};

export type ResolvedLlmProfile = {
  id: string;
  key: string;
  displayName: string;
  primaryModel: {
    id: string;
    code: string;
    provider: ProviderCode;
    displayName: string;
    contextWindow: number;
    maxOutputTokens: number | null;
    supportsStructuredOutputs: boolean;
    supportsReasoning: boolean;
  };
  fallbackModels: Array<{
    id: string;
    code: string;
    provider: ProviderCode;
    displayName: string;
    contextWindow: number;
    maxOutputTokens: number | null;
    supportsStructuredOutputs: boolean;
    supportsReasoning: boolean;
  }>;
  defaultMaxTokensIn: number | null;
  defaultMaxTokensOut: number | null;
  defaultTemperature: number | null;
  defaultReasoningEffort: string | null;
  supportsStructuredOutputs: boolean;
  usageTags: string[];
};
