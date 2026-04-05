import type { LlmExecutionRequest, LlmExecutionResponse, ProviderConfig } from "../types";

const modelAliases: Record<string, string> = {
  "gemini-1.5-pro": "gemini-1.5-pro-002",
  "gemini-1.5-flash": "gemini-1.5-flash-002",
  "gemini-2.0-flash": "gemini-2.0-flash-001",
  "gemini-2.0-flash-lite": "gemini-2.0-flash-lite-001",
};

export class GoogleProvider {
  readonly name = "google" as const;

  constructor(private readonly config: ProviderConfig) {}

  async execute(request: LlmExecutionRequest): Promise<LlmExecutionResponse> {
    const model = modelAliases[request.modelCode] ?? request.modelCode;
    const prompt = request.messages
      .map((message) => `${message.role.toUpperCase()}:\n${message.content}`)
      .join("\n\n");

    const response = await fetch(
      `${this.config.baseURL}/models/${model}:generateContent?key=${encodeURIComponent(this.config.apiKey)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            maxOutputTokens: request.maxTokensOut ?? 4096,
            temperature: request.temperature ?? 0.2,
          },
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 45_000),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`google generateContent failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        finishReason?: string | null;
        content?: { parts?: Array<{ text?: string }> };
      }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
      };
    };
    const output = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim() ?? "";
    if (!output) {
      throw new Error("google returned an empty completion.");
    }

    return {
      output,
      outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      modelCode: request.modelCode,
      providerCode: "google",
      metadata: {
        inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
        totalTokens: data.usageMetadata?.totalTokenCount ?? 0,
        finishReason: data.candidates?.[0]?.finishReason ?? null,
      },
    };
  }

  async isHealthy() {
    return !!this.config.apiKey;
  }
}
