-- CreateEnum
CREATE TYPE "DvvQueryStatus" AS ENUM ('RECEIVED', 'ASSIGNED', 'DRAFTED', 'SUBMITTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "DvvQueryPriority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('RECEIVED', 'ACTION_PLANNED', 'IN_PROGRESS', 'COMPLETED', 'DEFERRED');

-- CreateEnum
CREATE TYPE "RecommendationPriority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "SuggestionScope" AS ENUM ('WORKSPACE', 'BLOCK_ENTRY');

-- CreateEnum
CREATE TYPE "SuggestionType" AS ENUM ('GUIDANCE', 'REVIEW', 'DRAFT', 'RISK', 'QUESTION_CHECKLIST');

-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('ACTIVE', 'ACCEPTED', 'DISMISSED', 'STALE');

-- CreateEnum
CREATE TYPE "EvidenceExtractionStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'UNSUPPORTED');

-- AlterTable
ALTER TABLE "AccreditationBodyVersion"
  ADD COLUMN "assistantPackKey" TEXT;

-- AlterTable
ALTER TABLE "CriterionBlock"
  ADD COLUMN "assistantConfig" JSONB;

-- CreateTable
CREATE TABLE "DvvQuery" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "linkedBlockIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "queryNumber" TEXT NOT NULL,
    "queryText" TEXT NOT NULL,
    "responseText" TEXT,
    "status" "DvvQueryStatus" NOT NULL DEFAULT 'RECEIVED',
    "priority" "DvvQueryPriority" NOT NULL DEFAULT 'MEDIUM',
    "assignedToUserId" TEXT,
    "assignedToExternalName" TEXT,
    "assignedToExternalEmail" TEXT,
    "dueDate" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "responseAttachments" JSONB,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DvvQuery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PeerRecommendation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "linkedBlockIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "recommendationText" TEXT NOT NULL,
    "priority" "RecommendationPriority" NOT NULL DEFAULT 'MEDIUM',
    "actionPlan" TEXT,
    "status" "RecommendationStatus" NOT NULL DEFAULT 'RECEIVED',
    "assignedToUserId" TEXT,
    "assignedToExternalName" TEXT,
    "assignedToExternalEmail" TEXT,
    "targetDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "progressNotes" JSONB,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PeerRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccreditationAssistantSuggestion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "entryId" TEXT,
    "scope" "SuggestionScope" NOT NULL,
    "type" "SuggestionType" NOT NULL,
    "assistantPackKey" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "structuredPayload" JSONB,
    "citations" JSONB NOT NULL,
    "groundingStatus" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "sourceHash" TEXT,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'ACTIVE',
    "acceptedByUserId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "dismissedByUserId" TEXT,
    "dismissedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccreditationAssistantSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceVersionExtraction" (
    "id" TEXT NOT NULL,
    "evidenceVersionId" TEXT NOT NULL,
    "status" "EvidenceExtractionStatus" NOT NULL DEFAULT 'PENDING',
    "contentHash" TEXT,
    "extractedText" TEXT,
    "structuredChunks" JSONB,
    "pageCount" INTEGER,
    "fileType" TEXT,
    "processingMeta" JSONB,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvidenceVersionExtraction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DvvQuery_workspaceId_status_idx" ON "DvvQuery"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "DvvQuery_workspaceId_priority_idx" ON "DvvQuery"("workspaceId", "priority");

-- CreateIndex
CREATE INDEX "PeerRecommendation_workspaceId_status_idx" ON "PeerRecommendation"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "PeerRecommendation_workspaceId_priority_idx" ON "PeerRecommendation"("workspaceId", "priority");

-- CreateIndex
CREATE INDEX "AccreditationAssistantSuggestion_workspaceId_scope_type_status_idx" ON "AccreditationAssistantSuggestion"("workspaceId", "scope", "type", "status");

-- CreateIndex
CREATE INDEX "AccreditationAssistantSuggestion_entryId_type_status_idx" ON "AccreditationAssistantSuggestion"("entryId", "type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceVersionExtraction_evidenceVersionId_key" ON "EvidenceVersionExtraction"("evidenceVersionId");

-- CreateIndex
CREATE INDEX "EvidenceVersionExtraction_status_idx" ON "EvidenceVersionExtraction"("status");

-- AddForeignKey
ALTER TABLE "DvvQuery" ADD CONSTRAINT "DvvQuery_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "AssessmentWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeerRecommendation" ADD CONSTRAINT "PeerRecommendation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "AssessmentWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccreditationAssistantSuggestion" ADD CONSTRAINT "AccreditationAssistantSuggestion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "AssessmentWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccreditationAssistantSuggestion" ADD CONSTRAINT "AccreditationAssistantSuggestion_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "BlockEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceVersionExtraction" ADD CONSTRAINT "EvidenceVersionExtraction_evidenceVersionId_fkey" FOREIGN KEY ("evidenceVersionId") REFERENCES "EvidenceVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
