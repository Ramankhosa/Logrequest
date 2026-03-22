-- R2.2: Stages, submission trail, contribution roles, achievement instance fields

-- AlterTable KpiStageDefinition
ALTER TABLE "KpiStageDefinition" ADD COLUMN "weight" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "evidenceRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "evidenceTypes" "EvidenceType"[] NOT NULL DEFAULT ARRAY[]::"EvidenceType"[],
ADD COLUMN "evidenceInstructions" TEXT,
ADD COLUMN "deadline" TIMESTAMP(3);

-- AlterTable KpiStageProgress
ALTER TABLE "KpiStageProgress" ADD COLUMN "achievementId" TEXT,
ADD COLUMN "notes" TEXT,
ADD COLUMN "evidenceFiles" JSONB;

DROP INDEX "KpiStageProgress_targetAllocationId_stageDefinitionId_key";

CREATE UNIQUE INDEX "KpiStageProgress_targetAllocationId_stageDefinitionId_achievementId_key" ON "KpiStageProgress"("targetAllocationId", "stageDefinitionId", "achievementId");

CREATE INDEX "KpiStageProgress_achievementId_idx" ON "KpiStageProgress"("achievementId");

ALTER TABLE "KpiStageProgress" ADD CONSTRAINT "KpiStageProgress_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "Achievement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable KpiDefinition
ALTER TABLE "KpiDefinition" ADD COLUMN "allowPartialCompletion" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "contributionRoles" JSONB;

-- AlterTable Achievement
ALTER TABLE "Achievement" ADD COLUMN "title" TEXT,
ADD COLUMN "contributionRole" TEXT,
ADD COLUMN "creditPercent" DOUBLE PRECISION,
ADD COLUMN "effectiveScore" DOUBLE PRECISION,
ADD COLUMN "stageCompletionScore" DOUBLE PRECISION;

-- CreateTable SubmissionTrail
CREATE TABLE "SubmissionTrail" (
    "id" TEXT NOT NULL,
    "achievementId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "actorUnitName" TEXT,
    "note" TEXT,
    "scoreAtAction" DOUBLE PRECISION,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubmissionTrail_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SubmissionTrail_achievementId_createdAt_idx" ON "SubmissionTrail"("achievementId", "createdAt");

ALTER TABLE "SubmissionTrail" ADD CONSTRAINT "SubmissionTrail_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "Achievement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
