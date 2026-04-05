import type { LlmExecutionRequest, LlmExecutionResponse, ProviderConfig } from "../types";

const modelAliases: Record<string, string> = {
  "claude-3.5-sonnet": "claude-3-5-sonnet-20241022",
  "claude-3-5-sonnet": "claude-3-5-sonnet-20241022",
  "claude-3.5-haiku": "claude-3-5-haiku-20241022",
  "claude-3-5-haiku": "claude-3-5-haiku-20241022",
  "claude-3-opus": "claude-3-opus-20240229",
  "claude-3-sonnet": "claude-3-sonnet-20240229",
  "claude-3-haiku": "claude-3-haiku-20240307",
};

export class AnthropicProvider {
  readonly name = "anthropic" as const;

  constructor(private readonly config: ProviderConfig) {}

  async execute(request: LlmExecutionRequest): Promise<LlmExecutionResponse> {
    const model = modelAliases[request.modelCode] ?? request.modelCode;
    const systemMessages = request.messages.filter((message) => message.role === "system");
    const userMessages = request.messages.filter((message) => message.role !== "system");

    const response = await fetch(`${this.config.baseURL}/messages`, {
      method: "POST",
      headers: {
        "x-api-key": this.config.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: request.maxTokensOut ?? 4096,
        temperature: request.temperature ?? 0.2,
        system: systemMessages.map((message) => message.content).join("\n\n").trim() || undefined,
        messages: userMessages.map((message) => ({
          role: message.role === "user" ? "user" : "assistant",
          content: message.content,
        })),
      }),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 45_000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`anthropic message call failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as {
      content?: Array<{ type?: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
      stop_reason?: string | null;
    };
    const output = data.content
      ?.filter((chunk) => chunk.type === "text" && chunk.text)
      .map((chunk) => chunk.text)
      .join("")
      .trim() ?? "";

    if (!output) {
      throw new Error("anthropic returned an empty completion.");
    }

    return {
      output,
      outputTokens: data.usage?.output_tokens ?? 0,
      modelCode: request.modelCode,
      providerCode: "anthropic",
      metadata: {
        inputTokens: data.usage?.input_tokens ?? 0,
        finishReason: data.stop_reason ?? null,
      },
    };
  }

  async isHealthy() {
    return !!this.config.apiKey;
  }
}
