import type { LlmExecutionRequest, LlmExecutionResponse, ProviderConfig, ProviderCode } from "../types";

type OpenAiCompatibleProviderOptions = {
  providerCode: ProviderCode;
  healthPath?: string;
};

export class OpenAiCompatibleProvider {
  readonly name: ProviderCode;

  constructor(
    private readonly config: ProviderConfig,
    options: OpenAiCompatibleProviderOptions,
  ) {
    this.name = options.providerCode;
    this.healthPath = options.healthPath ?? "/models";
  }

  private readonly healthPath: string;

  async execute(request: LlmExecutionRequest): Promise<LlmExecutionResponse> {
    const normalizedModel = request.modelCode.endsWith("-thinking")
      ? request.modelCode.replace(/-thinking$/, "")
      : request.modelCode;
    const body: Record<string, unknown> = {
      model: normalizedModel,
      messages: request.messages,
    };

    if (request.maxTokensOut) {
      if (normalizedModel.startsWith("gpt-5") || normalizedModel.startsWith("o1")) {
        body.max_completion_tokens = request.maxTokensOut;
      } else {
        body.max_tokens = request.maxTokensOut;
      }
    }

    if (
      request.temperature !== undefined &&
      !normalizedModel.startsWith("gpt-5") &&
      !normalizedModel.startsWith("o1")
    ) {
      body.temperature = request.temperature;
    }

    if (request.reasoningEffort && normalizedModel.startsWith("gpt-5")) {
      body.reasoning_effort = request.reasoningEffort;
    }

    const response = await fetch(`${this.config.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 45_000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${this.name} chat completion failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null }; finish_reason?: string | null }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const output = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!output) {
      throw new Error(`${this.name} returned an empty completion.`);
    }

    return {
      output,
      outputTokens: data.usage?.completion_tokens ?? 0,
      modelCode: request.modelCode,
      providerCode: this.name,
      metadata: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
        finishReason: data.choices?.[0]?.finish_reason ?? null,
      },
    };
  }

  async isHealthy() {
    const response = await fetch(`${this.config.baseURL}${this.healthPath}`, {
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  }
}
