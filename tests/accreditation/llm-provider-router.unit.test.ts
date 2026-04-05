import { describe, expect, test, vi } from "vitest";
import { getProviderFromModelCode } from "@/lib/llm/providers/llm-provider";
import type { LlmExecutionResponse, LlmProvider, ProviderCode } from "@/lib/llm/types";
import { LlmProviderRouter } from "@/lib/llm/provider-router";

function createProviderStub(
  providerCode: ProviderCode,
  execute: () => Promise<LlmExecutionResponse>,
): LlmProvider {
  return {
    name: providerCode,
    execute: vi.fn(execute),
    isHealthy: vi.fn(async () => true),
  };
}

describe("llm provider router", () => {
  test("maps model codes to the expected providers", () => {
    expect(getProviderFromModelCode("gpt-5.2")).toBe("openai");
    expect(getProviderFromModelCode("claude-3-5-sonnet")).toBe("anthropic");
    expect(getProviderFromModelCode("gemini-2.5-pro")).toBe("google");
    expect(getProviderFromModelCode("deepseek-chat")).toBe("deepseek");
    expect(getProviderFromModelCode("llama-3.3-70b-versatile")).toBe("groq");
  });

  test("falls back across models when the primary provider fails", async () => {
    const router = new LlmProviderRouter() as unknown as {
      providers: Map<ProviderCode, LlmProvider>;
      executeWithFallback: LlmProviderRouter["executeWithFallback"];
    };

    router.providers = new Map<ProviderCode, LlmProvider>([
      [
        "openai",
        createProviderStub("openai", async () => {
          throw new Error("primary failed");
        }),
      ],
      [
        "anthropic",
        createProviderStub("anthropic", async () => ({
          output: "{\"content\":\"grounded\"}",
          outputTokens: 128,
          modelCode: "claude-3-5-sonnet",
          providerCode: "anthropic",
        })),
      ],
    ]);

    const result = await router.executeWithFallback(
      {
        modelCode: "gpt-5.2",
        messages: [{ role: "user", content: "review this block" }],
        maxTokensOut: 512,
      },
      ["claude-3-5-sonnet"],
    );

    expect(result.attemptedModels).toEqual(["gpt-5.2", "claude-3-5-sonnet"]);
    expect(result.response.providerCode).toBe("anthropic");
    expect(result.response.modelCode).toBe("claude-3-5-sonnet");
  });
});
