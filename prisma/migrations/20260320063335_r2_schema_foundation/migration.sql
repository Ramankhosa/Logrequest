-- CreateEnum
CREATE TYPE "KpiFlowStatus" AS ENUM ('CREATED', 'ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'KEY_REVIEW', 'KEY_APPROVED', 'KEY_REJECTED', 'FINAL_REVIEW', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "EvidenceType" AS ENUM ('DOCUMENT', 'URL', 'CERTIFICATE', 'SELF_DECLARATION', 'SYSTEM_GENERATED', 'NONE');

-- CreateEnum
CREATE TYPE "TeamCreditMethod" AS ENUM ('FULL_EACH', 'EQUAL_SPLIT', 'WEIGHTED_SPLIT', 'PRIMARY_ONLY');

-- AlterTable
ALTER TABLE "Achievement" ADD COLUMN     "currentVerifierUnitId" TEXT,
ADD COLUMN     "currentVerifierUserId" TEXT,
ADD COLUMN     "evidenceFiles" JSONB,
ADD COLUMN     "isTeamAchievement" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "KpiDefinition" ADD COLUMN     "evidenceInstructions" TEXT,
ADD COLUMN     "evidenceRequired" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "evidenceTypes" "EvidenceType"[],
ADD COLUMN     "finalUnitId" TEXT,
ADD COLUMN     "isTeamKpi" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "keyUnitId" TEXT,
ADD COLUMN     "sopDescription" TEXT,
ADD COLUMN     "sopFiles" JSONB,
ADD COLUMN     "teamCreditMethod" "TeamCreditMethod" NOT NULL DEFAULT 'FULL_EACH';

-- AlterTable
ALTER TABLE "TargetAllocation" ADD COLUMN     "flowLog" JSONB,
ADD COLUMN     "flowStatus" "KpiFlowStatus" NOT NULL DEFAULT 'CREATED',
ADD COLUMN     "teamWeights" JSONB,
ADD COLUMN     "verifierOverrideNote" TEXT,
ADD COLUMN     "verifierOverrideUserId" TEXT;

-- CreateTable
CREATE TABLE "KpiTargetUnit" (
    "id" TEXT NOT NULL,
    "kpiDefinitionId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "targetShare" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KpiTargetUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KpiStageDefinition" (
    "id" TEXT NOT NULL,
    "kpiDefinitionId" TEXT NOT NULL,
    "stageOrder" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "isMandatory" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KpiStageDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KpiStageProgress" (
    "id" TEXT NOT NULL,
    "targetAllocationId" TEXT NOT NULL,
    "stageDefinitionId" TEXT NOT NULL,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "completedByUserId" TEXT,
    "completedAt" TIMESTAMP(3),
    "evidenceNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KpiStageProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewCycle" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "cycleNumber" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "reviewDeadline" TIMESTAMP(3),
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewCycle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KpiTargetUnit_unitId_idx" ON "KpiTargetUnit"("unitId");

-- CreateIndex
CREATE UNIQUE INDEX "KpiTargetUnit_kpiDefinitionId_unitId_key" ON "KpiTargetUnit"("kpiDefinitionId", "unitId");

-- CreateIndex
CREATE INDEX "KpiStageDefinition_kpiDefinitionId_idx" ON "KpiStageDefinition"("kpiDefinitionId");

-- CreateIndex
CREATE UNIQUE INDEX "KpiStageDefinition_kpiDefinitionId_stageOrder_key" ON "KpiStageDefinition"("kpiDefinitionId", "stageOrder");

-- CreateIndex
CREATE INDEX "KpiStageProgress_targetAllocationId_idx" ON "KpiStageProgress"("targetAllocationId");

-- CreateIndex
CREATE UNIQUE INDEX "KpiStageProgress_targetAllocationId_stageDefinitionId_key" ON "KpiStageProgress"("targetAllocationId", "stageDefinitionId");

-- CreateIndex
CREATE INDEX "ReviewCycle_periodId_isCurrent_idx" ON "ReviewCycle"("periodId", "isCurrent");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewCycle_periodId_cycleNumber_key" ON "ReviewCycle"("periodId", "cycleNumber");

-- CreateIndex
CREATE INDEX "KpiDefinition_keyUnitId_idx" ON "KpiDefinition"("keyUnitId");

-- CreateIndex
CREATE INDEX "KpiDefinition_finalUnitId_idx" ON "KpiDefinition"("finalUnitId");

-- AddForeignKey
ALTER TABLE "KpiDefinition" ADD CONSTRAINT "KpiDefinition_keyUnitId_fkey" FOREIGN KEY ("keyUnitId") REFERENCES "OrgUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiDefinition" ADD CONSTRAINT "KpiDefinition_finalUnitId_fkey" FOREIGN KEY ("finalUnitId") REFERENCES "OrgUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiTargetUnit" ADD CONSTRAINT "KpiTargetUnit_kpiDefinitionId_fkey" FOREIGN KEY ("kpiDefinitionId") REFERENCES "KpiDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiTargetUnit" ADD CONSTRAINT "KpiTargetUnit_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "OrgUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiStageDefinition" ADD CONSTRAINT "KpiStageDefinition_kpiDefinitionId_fkey" FOREIGN KEY ("kpiDefinitionId") REFERENCES "KpiDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiStageProgress" ADD CONSTRAINT "KpiStageProgress_targetAllocationId_fkey" FOREIGN KEY ("targetAllocationId") REFERENCES "TargetAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiStageProgress" ADD CONSTRAINT "KpiStageProgress_stageDefinitionId_fkey" FOREIGN KEY ("stageDefinitionId") REFERENCES "KpiStageDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewCycle" ADD CONSTRAINT "ReviewCycle_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "AssessmentPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
