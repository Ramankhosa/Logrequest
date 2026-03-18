/*
  Warnings:

  - You are about to drop the `Kpi` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Kra` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "KraCategoryScope" AS ENUM ('GLOBAL', 'TENANT');

-- CreateEnum
CREATE TYPE "AssessmentPeriodState" AS ENUM ('DRAFT', 'OPEN', 'IN_PROGRESS', 'UNDER_REVIEW', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AssessmentPeriodType" AS ENUM ('CALENDAR_YEAR', 'FINANCIAL_YEAR', 'SPECIFIC_RANGE');

-- CreateEnum
CREATE TYPE "ReviewCycleFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "KraDefinitionState" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "KpiDefinitionState" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "KpiAllocationType" AS ENUM ('DEPARTMENT', 'INDIVIDUAL', 'BOTH');

-- CreateEnum
CREATE TYPE "TargetAllocationState" AS ENUM ('ACTIVE', 'LOCKED');

-- CreateEnum
CREATE TYPE "AchievementState" AS ENUM ('DRAFT', 'SUBMITTED', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ScoringMethod" AS ENUM ('LINEAR', 'THRESHOLD', 'SLAB');

-- CreateEnum
CREATE TYPE "ScoringDirection" AS ENUM ('ASCENDING', 'DESCENDING');

-- CreateEnum
CREATE TYPE "MilestoneStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "GradeValue" AS ENUM ('OUTSTANDING', 'VERY_GOOD', 'GOOD', 'SATISFACTORY', 'NEEDS_IMPROVEMENT', 'POOR');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "KpiMeasurementType" ADD VALUE 'MILESTONE';
ALTER TYPE "KpiMeasurementType" ADD VALUE 'DATE_TARGET';
ALTER TYPE "KpiMeasurementType" ADD VALUE 'GRADE';

-- DropForeignKey
ALTER TABLE "Kpi" DROP CONSTRAINT "Kpi_kraId_fkey";

-- DropForeignKey
ALTER TABLE "Kra" DROP CONSTRAINT "Kra_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "Kra" DROP CONSTRAINT "Kra_unitId_fkey";

-- DropTable
DROP TABLE "Kpi";

-- DropTable
DROP TABLE "Kra";

-- DropEnum
DROP TYPE "KraState";

-- CreateTable
CREATE TABLE "KraCategoryDefinition" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "scope" "KraCategoryScope" NOT NULL DEFAULT 'TENANT',
    "categoryKey" TEXT NOT NULL,
    "displayLabel" TEXT NOT NULL,
    "description" TEXT,
    "iconName" TEXT,
    "colorHex" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KraCategoryDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentPeriod" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "periodType" "AssessmentPeriodType" NOT NULL DEFAULT 'SPECIFIC_RANGE',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "state" "AssessmentPeriodState" NOT NULL DEFAULT 'DRAFT',
    "reviewFrequency" "ReviewCycleFrequency" NOT NULL DEFAULT 'ANNUAL',
    "targetSettingDeadline" TIMESTAMP(3),
    "achievementDeadline" TIMESTAMP(3),
    "reviewDeadline" TIMESTAMP(3),
    "description" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssessmentPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KraDefinition" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "categoryId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "weightage" INTEGER NOT NULL DEFAULT 0,
    "state" "KraDefinitionState" NOT NULL DEFAULT 'DRAFT',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KraDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KpiDefinition" (
    "id" TEXT NOT NULL,
    "kraDefinitionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "measurementType" "KpiMeasurementType" NOT NULL DEFAULT 'NUMERIC',
    "unitLabel" TEXT,
    "weightage" INTEGER NOT NULL DEFAULT 0,
    "defaultTarget" DOUBLE PRECISION,
    "measurementConfig" JSONB,
    "scoringMethod" "ScoringMethod" NOT NULL DEFAULT 'LINEAR',
    "scoringDirection" "ScoringDirection" NOT NULL DEFAULT 'ASCENDING',
    "scoringConfig" JSONB,
    "isPerCapita" BOOLEAN NOT NULL DEFAULT false,
    "allocationType" "KpiAllocationType" NOT NULL DEFAULT 'BOTH',
    "startingUnitId" TEXT NOT NULL,
    "state" "KpiDefinitionState" NOT NULL DEFAULT 'DRAFT',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "guidanceNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KpiDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TargetAllocation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "kpiDefinitionId" TEXT NOT NULL,
    "assignedToUnitId" TEXT,
    "assignedToUserId" TEXT,
    "allocatedByUserId" TEXT NOT NULL,
    "targetValue" DOUBLE PRECISION,
    "targetDate" TIMESTAMP(3),
    "targetMilestone" "MilestoneStatus",
    "targetGrade" "GradeValue",
    "targetBoolean" BOOLEAN,
    "targetRating" INTEGER,
    "state" "TargetAllocationState" NOT NULL DEFAULT 'ACTIVE',
    "lockedAt" TIMESTAMP(3),
    "parentAllocationId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TargetAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Achievement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "kpiDefinitionId" TEXT NOT NULL,
    "targetAllocationId" TEXT,
    "reportedByUserId" TEXT NOT NULL,
    "actualValue" DOUBLE PRECISION,
    "actualDate" TIMESTAMP(3),
    "actualMilestone" "MilestoneStatus",
    "actualGrade" "GradeValue",
    "actualBoolean" BOOLEAN,
    "actualRating" INTEGER,
    "evidenceDescription" TEXT,
    "evidenceLinks" TEXT[],
    "computedScore" DOUBLE PRECISION,
    "state" "AchievementState" NOT NULL DEFAULT 'DRAFT',
    "verifiedByUserId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verificationNote" TEXT,
    "rejectionReason" TEXT,
    "reportingDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Achievement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KraCategoryDefinition_scope_isActive_idx" ON "KraCategoryDefinition"("scope", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "KraCategoryDefinition_tenantId_categoryKey_key" ON "KraCategoryDefinition"("tenantId", "categoryKey");

-- CreateIndex
CREATE INDEX "AssessmentPeriod_tenantId_state_idx" ON "AssessmentPeriod"("tenantId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentPeriod_tenantId_code_key" ON "AssessmentPeriod"("tenantId", "code");

-- CreateIndex
CREATE INDEX "KraDefinition_tenantId_periodId_idx" ON "KraDefinition"("tenantId", "periodId");

-- CreateIndex
CREATE INDEX "KraDefinition_tenantId_state_idx" ON "KraDefinition"("tenantId", "state");

-- CreateIndex
CREATE INDEX "KpiDefinition_kraDefinitionId_idx" ON "KpiDefinition"("kraDefinitionId");

-- CreateIndex
CREATE INDEX "KpiDefinition_startingUnitId_idx" ON "KpiDefinition"("startingUnitId");

-- CreateIndex
CREATE INDEX "TargetAllocation_tenantId_periodId_kpiDefinitionId_idx" ON "TargetAllocation"("tenantId", "periodId", "kpiDefinitionId");

-- CreateIndex
CREATE INDEX "TargetAllocation_assignedToUnitId_periodId_idx" ON "TargetAllocation"("assignedToUnitId", "periodId");

-- CreateIndex
CREATE INDEX "TargetAllocation_assignedToUserId_periodId_idx" ON "TargetAllocation"("assignedToUserId", "periodId");

-- CreateIndex
CREATE INDEX "TargetAllocation_parentAllocationId_idx" ON "TargetAllocation"("parentAllocationId");

-- CreateIndex
CREATE INDEX "Achievement_tenantId_periodId_idx" ON "Achievement"("tenantId", "periodId");

-- CreateIndex
CREATE INDEX "Achievement_targetAllocationId_idx" ON "Achievement"("targetAllocationId");

-- CreateIndex
CREATE INDEX "Achievement_reportedByUserId_periodId_idx" ON "Achievement"("reportedByUserId", "periodId");

-- CreateIndex
CREATE INDEX "Achievement_tenantId_state_idx" ON "Achievement"("tenantId", "state");

-- AddForeignKey
ALTER TABLE "KraCategoryDefinition" ADD CONSTRAINT "KraCategoryDefinition_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentPeriod" ADD CONSTRAINT "AssessmentPeriod_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KraDefinition" ADD CONSTRAINT "KraDefinition_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KraDefinition" ADD CONSTRAINT "KraDefinition_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "AssessmentPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KraDefinition" ADD CONSTRAINT "KraDefinition_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "KraCategoryDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiDefinition" ADD CONSTRAINT "KpiDefinition_kraDefinitionId_fkey" FOREIGN KEY ("kraDefinitionId") REFERENCES "KraDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiDefinition" ADD CONSTRAINT "KpiDefinition_startingUnitId_fkey" FOREIGN KEY ("startingUnitId") REFERENCES "OrgUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TargetAllocation" ADD CONSTRAINT "TargetAllocation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TargetAllocation" ADD CONSTRAINT "TargetAllocation_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "AssessmentPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TargetAllocation" ADD CONSTRAINT "TargetAllocation_kpiDefinitionId_fkey" FOREIGN KEY ("kpiDefinitionId") REFERENCES "KpiDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TargetAllocation" ADD CONSTRAINT "TargetAllocation_assignedToUnitId_fkey" FOREIGN KEY ("assignedToUnitId") REFERENCES "OrgUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TargetAllocation" ADD CONSTRAINT "TargetAllocation_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TargetAllocation" ADD CONSTRAINT "TargetAllocation_parentAllocationId_fkey" FOREIGN KEY ("parentAllocationId") REFERENCES "TargetAllocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Achievement" ADD CONSTRAINT "Achievement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Achievement" ADD CONSTRAINT "Achievement_kpiDefinitionId_fkey" FOREIGN KEY ("kpiDefinitionId") REFERENCES "KpiDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Achievement" ADD CONSTRAINT "Achievement_targetAllocationId_fkey" FOREIGN KEY ("targetAllocationId") REFERENCES "TargetAllocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
