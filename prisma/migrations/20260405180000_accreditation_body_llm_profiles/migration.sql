-- CreateEnum
CREATE TYPE "CopilotMode" AS ENUM ('DISABLED', 'DETERMINISTIC_ONLY', 'LLM_ASSISTED');

-- CreateEnum
CREATE TYPE "PlatformLlmProvider" AS ENUM ('OPENAI', 'ANTHROPIC', 'GOOGLE', 'DEEPSEEK', 'GROQ');

-- CreateTable
CREATE TABLE "PlatformLlmModel" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "provider" "PlatformLlmProvider" NOT NULL,
    "contextWindow" INTEGER NOT NULL,
    "maxOutputTokens" INTEGER,
    "supportsVision" BOOLEAN NOT NULL DEFAULT false,
    "supportsStreaming" BOOLEAN NOT NULL DEFAULT false,
    "supportsStructuredOutputs" BOOLEAN NOT NULL DEFAULT false,
    "supportsReasoning" BOOLEAN NOT NULL DEFAULT false,
    "inputCostPer1M" INTEGER NOT NULL DEFAULT 0,
    "outputCostPer1M" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformLlmModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformLlmProfile" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "primaryModelId" TEXT NOT NULL,
    "fallbackModelIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "defaultMaxTokensIn" INTEGER,
    "defaultMaxTokensOut" INTEGER,
    "defaultTemperature" DOUBLE PRECISION,
    "defaultReasoningEffort" TEXT,
    "supportsStructuredOutputs" BOOLEAN NOT NULL DEFAULT false,
    "usageTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformLlmProfile_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "AccreditationBodyVersion"
  ADD COLUMN "copilotMode" "CopilotMode" NOT NULL DEFAULT 'DETERMINISTIC_ONLY',
  ADD COLUMN "llmProfileId" TEXT,
  ADD COLUMN "llmConfig" JSONB;

-- AlterTable
ALTER TABLE "AccreditationAssistantSuggestion"
  ADD COLUMN "profileKey" TEXT,
  ADD COLUMN "providerCode" TEXT,
  ADD COLUMN "modelCode" TEXT,
  ADD COLUMN "promptVersion" TEXT,
  ADD COLUMN "executionMeta" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "PlatformLlmModel_code_key" ON "PlatformLlmModel"("code");

-- CreateIndex
CREATE INDEX "PlatformLlmModel_provider_isActive_idx" ON "PlatformLlmModel"("provider", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformLlmProfile_key_key" ON "PlatformLlmProfile"("key");

-- CreateIndex
CREATE INDEX "PlatformLlmProfile_primaryModelId_idx" ON "PlatformLlmProfile"("primaryModelId");

-- CreateIndex
CREATE INDEX "PlatformLlmProfile_isActive_idx" ON "PlatformLlmProfile"("isActive");

-- CreateIndex
CREATE INDEX "AccreditationBodyVersion_llmProfileId_idx" ON "AccreditationBodyVersion"("llmProfileId");

-- AddForeignKey
ALTER TABLE "PlatformLlmProfile" ADD CONSTRAINT "PlatformLlmProfile_primaryModelId_fkey" FOREIGN KEY ("primaryModelId") REFERENCES "PlatformLlmModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccreditationBodyVersion" ADD CONSTRAINT "AccreditationBodyVersion_llmProfileId_fkey" FOREIGN KEY ("llmProfileId") REFERENCES "PlatformLlmProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
