import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PlatformLlmProvider, PrismaClient } from "@prisma/client";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for production LLM model seeding.");
}

const pool = new Pool({ connectionString: databaseUrl });
const prisma = new PrismaClient({
  adapter: new PrismaPg(pool),
  log: ["error"],
});

type SeedModel = {
  code: string;
  displayName: string;
  provider: PlatformLlmProvider;
  contextWindow: number;
  maxOutputTokens: number | null;
  supportsVision: boolean;
  supportsStreaming: boolean;
  supportsStructuredOutputs: boolean;
  supportsReasoning: boolean;
  inputCostPer1M: number;
  outputCostPer1M: number;
  isActive: boolean;
  isDefault: boolean;
};

const LLM_MODELS: SeedModel[] = [
  {
    code: "gpt-5.2",
    displayName: "ChatGPT 5.2",
    provider: PlatformLlmProvider.OPENAI,
    contextWindow: 256000,
    maxOutputTokens: 8192,
    supportsVision: true,
    supportsStreaming: true,
    supportsStructuredOutputs: true,
    supportsReasoning: true,
    inputCostPer1M: 0,
    outputCostPer1M: 0,
    isActive: true,
    isDefault: true,
  },
  {
    code: "gpt-5-mini",
    displayName: "ChatGPT 5 Mini",
    provider: PlatformLlmProvider.OPENAI,
    contextWindow: 128000,
    maxOutputTokens: 8192,
    supportsVision: true,
    supportsStreaming: true,
    supportsStructuredOutputs: true,
    supportsReasoning: true,
    inputCostPer1M: 0,
    outputCostPer1M: 0,
    isActive: true,
    isDefault: false,
  },
  {
    code: "gpt-4o",
    displayName: "ChatGPT 4o",
    provider: PlatformLlmProvider.OPENAI,
    contextWindow: 128000,
    maxOutputTokens: 4096,
    supportsVision: true,
    supportsStreaming: true,
    supportsStructuredOutputs: true,
    supportsReasoning: false,
    inputCostPer1M: 0,
    outputCostPer1M: 0,
    isActive: true,
    isDefault: false,
  },
  {
    code: "gpt-4o-mini",
    displayName: "ChatGPT 4o Mini",
    provider: PlatformLlmProvider.OPENAI,
    contextWindow: 128000,
    maxOutputTokens: 4096,
    supportsVision: true,
    supportsStreaming: true,
    supportsStructuredOutputs: true,
    supportsReasoning: false,
    inputCostPer1M: 0,
    outputCostPer1M: 0,
    isActive: true,
    isDefault: false,
  },
  {
    code: "gemini-2.5-pro",
    displayName: "Gemini 2.5 Pro",
    provider: PlatformLlmProvider.GOOGLE,
    contextWindow: 128000,
    maxOutputTokens: 8192,
    supportsVision: true,
    supportsStreaming: true,
    supportsStructuredOutputs: true,
    supportsReasoning: true,
    inputCostPer1M: 0,
    outputCostPer1M: 0,
    isActive: true,
    isDefault: false,
  },
  {
    code: "gemini-2.5-flash",
    displayName: "Gemini 2.5 Flash",
    provider: PlatformLlmProvider.GOOGLE,
    contextWindow: 128000,
    maxOutputTokens: 8192,
    supportsVision: true,
    supportsStreaming: true,
    supportsStructuredOutputs: true,
    supportsReasoning: true,
    inputCostPer1M: 0,
    outputCostPer1M: 0,
    isActive: true,
    isDefault: false,
  },
  {
    code: "gemini-2.0-flash",
    displayName: "Gemini 2.0 Flash",
    provider: PlatformLlmProvider.GOOGLE,
    contextWindow: 128000,
    maxOutputTokens: 4096,
    supportsVision: true,
    supportsStreaming: true,
    supportsStructuredOutputs: true,
    supportsReasoning: false,
    inputCostPer1M: 0,
    outputCostPer1M: 0,
    isActive: true,
    isDefault: false,
  },
  {
    code: "gemini-3-pro-preview",
    displayName: "Gemini 3 Pro Preview",
    provider: PlatformLlmProvider.GOOGLE,
    contextWindow: 1048576,
    maxOutputTokens: 8192,
    supportsVision: true,
    supportsStreaming: true,
    supportsStructuredOutputs: true,
    supportsReasoning: true,
    inputCostPer1M: 0,
    outputCostPer1M: 0,
    isActive: true,
    isDefault: false,
  },
  {
    code: "gemini-3-pro-preview-thinking",
    displayName: "Gemini 3 Pro Preview Thinking",
    provider: PlatformLlmProvider.GOOGLE,
    contextWindow: 1048576,
    maxOutputTokens: 8192,
    supportsVision: true,
    supportsStreaming: true,
    supportsStructuredOutputs: true,
    supportsReasoning: true,
    inputCostPer1M: 0,
    outputCostPer1M: 0,
    isActive: true,
    isDefault: false,
  },
];

async function main() {
  let created = 0;
  let updated = 0;

  console.log("Seeding production LLM models (ChatGPT + Gemini 3)...");

  for (const model of LLM_MODELS) {
    const existing = await prisma.platformLlmModel.findUnique({
      where: { code: model.code },
      select: { id: true },
    });

    await prisma.platformLlmModel.upsert({
      where: { code: model.code },
      update: {
        displayName: model.displayName,
        provider: model.provider,
        contextWindow: model.contextWindow,
        maxOutputTokens: model.maxOutputTokens,
        supportsVision: model.supportsVision,
        supportsStreaming: model.supportsStreaming,
        supportsStructuredOutputs: model.supportsStructuredOutputs,
        supportsReasoning: model.supportsReasoning,
        inputCostPer1M: model.inputCostPer1M,
        outputCostPer1M: model.outputCostPer1M,
        isActive: model.isActive,
        isDefault: model.isDefault,
      },
      create: model,
    });

    if (existing) {
      updated += 1;
      console.log(`Updated: ${model.code}`);
    } else {
      created += 1;
      console.log(`Created: ${model.code}`);
    }
  }

  if (LLM_MODELS.some((model) => model.isDefault)) {
    const defaultModel = LLM_MODELS.find((model) => model.isDefault);
    if (defaultModel) {
      await prisma.platformLlmModel.updateMany({
        where: { code: { not: defaultModel.code }, isDefault: true },
        data: { isDefault: false },
      });
    }
  }

  console.log(`LLM model seed complete. Created: ${created}, Updated: ${updated}, Total: ${LLM_MODELS.length}`);
}

main()
  .catch((error) => {
    console.error("Failed to seed production LLM models.");
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
