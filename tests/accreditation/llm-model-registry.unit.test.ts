import { beforeEach, describe, expect, test, vi } from "vitest";

const platformLlmModelFindManyMock = vi.fn();
const platformLlmModelFindUniqueMock = vi.fn();
const transactionMock = vi.fn();

const getProviderFromModelCodeMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    platformLlmModel: {
      findMany: platformLlmModelFindManyMock,
      findUnique: platformLlmModelFindUniqueMock,
    },
    $transaction: transactionMock,
  },
}));

vi.mock("@/lib/llm/providers/llm-provider", () => ({
  getProviderFromModelCode: getProviderFromModelCodeMock,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("model registry guardrails", () => {
  test("rejects model create when provider and model code do not match", async () => {
    getProviderFromModelCodeMock.mockReturnValue("openai");

    const { createPlatformLlmModel } = await import("@/lib/llm/model-registry");
    const result = await createPlatformLlmModel({
      code: "gpt-5.2",
      displayName: "GPT 5.2",
      provider: "GOOGLE",
      contextWindow: 128000,
    });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toContain("maps to OPENAI");
    }
    expect(transactionMock).not.toHaveBeenCalled();
  });

  test("rejects model update when next provider and code do not match", async () => {
    getProviderFromModelCodeMock.mockReturnValue("google");
    platformLlmModelFindUniqueMock.mockResolvedValue({ code: "gpt-5.2", provider: "OPENAI" });

    const { updatePlatformLlmModel } = await import("@/lib/llm/model-registry");
    const result = await updatePlatformLlmModel("model-1", { provider: "OPENAI", code: "gemini-2.5-pro" });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toContain("maps to GOOGLE");
    }
    expect(transactionMock).not.toHaveBeenCalled();
  });

  test("requires active models when creating profile", async () => {
    platformLlmModelFindManyMock.mockResolvedValue([{ id: "model-active-1" }]);

    const { createPlatformLlmProfile } = await import("@/lib/llm/model-registry");
    const result = await createPlatformLlmProfile({
      key: "profile-1",
      displayName: "Profile 1",
      primaryModelId: "model-active-1",
      fallbackModelIds: ["model-inactive-2"],
    });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toContain("inactive");
    }
    expect(platformLlmModelFindManyMock).toHaveBeenCalledWith({
      where: {
        id: { in: ["model-active-1", "model-inactive-2"] },
        isActive: true,
      },
      select: { id: true },
    });
    expect(transactionMock).not.toHaveBeenCalled();
  });
});
