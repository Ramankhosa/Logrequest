-- CreateEnum
CREATE TYPE "SuggestionFeedbackValue" AS ENUM ('USEFUL', 'NOT_USEFUL');

-- CreateEnum
CREATE TYPE "EvidenceExtractionQualityFlag" AS ENUM ('TEXT_NATIVE', 'OCR_USED', 'LOW_CONFIDENCE', 'TABLES_DETECTED', 'TABLES_PARTIAL', 'UNSUPPORTED_FORMAT', 'TOO_LARGE', 'PASSWORD_PROTECTED', 'METADATA_ONLY');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EvidenceExtractionStatus" ADD VALUE 'PARTIAL';
ALTER TYPE "EvidenceExtractionStatus" ADD VALUE 'STALE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SuggestionType" ADD VALUE 'REVIEW_EVIDENCE';
ALTER TYPE "SuggestionType" ADD VALUE 'REVIEW_COMMENT';
ALTER TYPE "SuggestionType" ADD VALUE 'RISK_ASSESSMENT';

-- AlterTable
ALTER TABLE "AccreditationAssistantSuggestion" ADD COLUMN     "feedbackAt" TIMESTAMP(3),
ADD COLUMN     "feedbackByUserId" TEXT,
ADD COLUMN     "feedbackNotes" TEXT,
ADD COLUMN     "feedbackValue" "SuggestionFeedbackValue",
ADD COLUMN     "staleReason" TEXT;

-- AlterTable
ALTER TABLE "EvidenceVersionExtraction" ADD COLUMN     "charCount" INTEGER,
ADD COLUMN     "confidence" DOUBLE PRECISION,
ADD COLUMN     "engineVersion" TEXT,
ADD COLUMN     "languageHints" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "qualityFlags" "EvidenceExtractionQualityFlag"[] DEFAULT ARRAY[]::"EvidenceExtractionQualityFlag"[];

-- CreateTable
CREATE TABLE "EvidenceVersionChunk" (
    "id" TEXT NOT NULL,
    "extractionId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "pageStart" INTEGER,
    "pageEnd" INTEGER,
    "sectionHeading" TEXT,
    "contentType" TEXT NOT NULL DEFAULT 'TEXT',
    "plainText" TEXT NOT NULL,
    "charCount" INTEGER NOT NULL,
    "tokenEstimate" INTEGER,
    "confidence" DOUBLE PRECISION,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceVersionChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceSuggestionCitation" (
    "id" TEXT NOT NULL,
    "suggestionId" TEXT NOT NULL,
    "citationType" TEXT NOT NULL,
    "evidenceVersionId" TEXT,
    "chunkId" TEXT,
    "metricCode" TEXT,
    "responseFieldKey" TEXT,
    "renderedSnippet" TEXT,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceSuggestionCitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EvidenceVersionChunk_extractionId_chunkIndex_idx" ON "EvidenceVersionChunk"("extractionId", "chunkIndex");

-- CreateIndex
CREATE INDEX "EvidenceVersionChunk_extractionId_contentType_idx" ON "EvidenceVersionChunk"("extractionId", "contentType");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceVersionChunk_extractionId_chunkIndex_key" ON "EvidenceVersionChunk"("extractionId", "chunkIndex");

-- CreateIndex
CREATE INDEX "EvidenceSuggestionCitation_suggestionId_idx" ON "EvidenceSuggestionCitation"("suggestionId");

-- CreateIndex
CREATE INDEX "EvidenceSuggestionCitation_evidenceVersionId_idx" ON "EvidenceSuggestionCitation"("evidenceVersionId");

-- CreateIndex
CREATE INDEX "EvidenceSuggestionCitation_chunkId_idx" ON "EvidenceSuggestionCitation"("chunkId");

-- AddForeignKey
ALTER TABLE "EvidenceVersionChunk" ADD CONSTRAINT "EvidenceVersionChunk_extractionId_fkey" FOREIGN KEY ("extractionId") REFERENCES "EvidenceVersionExtraction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceSuggestionCitation" ADD CONSTRAINT "EvidenceSuggestionCitation_suggestionId_fkey" FOREIGN KEY ("suggestionId") REFERENCES "AccreditationAssistantSuggestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceSuggestionCitation" ADD CONSTRAINT "EvidenceSuggestionCitation_evidenceVersionId_fkey" FOREIGN KEY ("evidenceVersionId") REFERENCES "EvidenceVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceSuggestionCitation" ADD CONSTRAINT "EvidenceSuggestionCitation_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "EvidenceVersionChunk"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "AccreditationAssistantSuggestion_workspaceId_scope_type_status_" RENAME TO "AccreditationAssistantSuggestion_workspaceId_scope_type_sta_idx";
