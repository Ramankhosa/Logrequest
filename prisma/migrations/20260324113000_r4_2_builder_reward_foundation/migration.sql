-- CreateEnum
CREATE TYPE "KpiParticipantMode" AS ENUM ('SINGLE_OWNER', 'OPTIONAL_TEAM', 'REQUIRED_TEAM');

-- CreateEnum
CREATE TYPE "KpiRewardRecurrencePolicy" AS ENUM ('RECURRING', 'ONCE_PER_PERIOD', 'ONCE_PER_KPI_LIFETIME', 'ONCE_PER_UNIQUE_KEY');

-- CreateEnum
CREATE TYPE "KpiRewardTierMatchMode" AS ENUM ('HIGHEST_MATCH', 'MANUAL_SELECT');

-- CreateEnum
CREATE TYPE "KpiRewardTrigger" AS ENUM ('FINAL_VERIFY', 'MANUAL', 'STAGE_COMPLETE');

-- CreateEnum
CREATE TYPE "KpiRewardAmountMode" AS ENUM ('FIXED_VALUE', 'FIXED_POOL', 'FIXED_PER_PERSON', 'PERCENT_OF_FIELD', 'PER_UNIT', 'PERCENT_OF_SCORE');

-- CreateEnum
CREATE TYPE "KpiRewardDistributionMode" AS ENUM ('DIRECT_OWNER', 'ROLE_PERCENT_SPLIT', 'FIXED_PER_PERSON', 'EQUAL_SPLIT', 'CREDIT_PERCENT_SPLIT', 'LEAD_ONLY');

-- CreateEnum
CREATE TYPE "KpiRewardSingleEligibleHandling" AS ENUM ('FULL_TO_SINGLE', 'KEEP_CONFIGURED_SPLIT', 'ERROR');

-- CreateEnum
CREATE TYPE "KpiRewardEmptyShareHandling" AS ENUM ('ROLLOVER_TO_MATCHED', 'DROP_UNALLOCATED', 'ERROR');

-- CreateEnum
CREATE TYPE "ContributorRewardState" AS ENUM ('CALCULATED', 'CANCELLED');

-- AlterTable
ALTER TABLE "AchievementContributor" ADD COLUMN "selectorTags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "BenefitType"
ADD COLUMN "precision" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN "roundingMode" TEXT NOT NULL DEFAULT 'HALF_UP';

-- AlterTable
ALTER TABLE "KpiDefinition"
ADD COLUMN "participantMode" "KpiParticipantMode" NOT NULL DEFAULT 'SINGLE_OWNER',
ADD COLUMN "policyDateFieldKey" TEXT,
ADD COLUMN "rewardRecurrencePolicy" "KpiRewardRecurrencePolicy" NOT NULL DEFAULT 'RECURRING';

-- CreateTable
CREATE TABLE "KpiTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "builderPayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KpiTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KpiRewardTier" (
    "id" TEXT NOT NULL,
    "kpiDefinitionId" TEXT NOT NULL,
    "tierSetKey" TEXT NOT NULL DEFAULT 'PRIMARY',
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "matchMode" "KpiRewardTierMatchMode" NOT NULL DEFAULT 'HIGHEST_MATCH',
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KpiRewardTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KpiRewardRule" (
    "id" TEXT NOT NULL,
    "rewardTierId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "fieldKey" TEXT,
    "systemMetricKey" TEXT,
    "value" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KpiRewardRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KpiRewardComponent" (
    "id" TEXT NOT NULL,
    "kpiDefinitionId" TEXT NOT NULL,
    "rewardTierId" TEXT,
    "stageDefinitionId" TEXT,
    "parentComponentId" TEXT,
    "benefitTypeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "trigger" "KpiRewardTrigger" NOT NULL DEFAULT 'FINAL_VERIFY',
    "amountMode" "KpiRewardAmountMode" NOT NULL,
    "amountValue" DOUBLE PRECISION,
    "amountFieldKey" TEXT,
    "distributionMode" "KpiRewardDistributionMode" NOT NULL DEFAULT 'DIRECT_OWNER',
    "singleEligibleHandling" "KpiRewardSingleEligibleHandling" NOT NULL DEFAULT 'FULL_TO_SINGLE',
    "emptyShareHandling" "KpiRewardEmptyShareHandling" NOT NULL DEFAULT 'ROLLOVER_TO_MATCHED',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KpiRewardComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KpiRewardDistribution" (
    "id" TEXT NOT NULL,
    "rewardComponentId" TEXT NOT NULL,
    "contributorRoleId" TEXT,
    "selectorType" TEXT NOT NULL,
    "selectorTag" TEXT,
    "sharePercent" DOUBLE PRECISION,
    "fixedAmount" DOUBLE PRECISION,
    "splitMode" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KpiRewardDistribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContributorReward" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "kpiDefinitionId" TEXT NOT NULL,
    "achievementId" TEXT NOT NULL,
    "achievementContributorId" TEXT,
    "contributorUserId" TEXT,
    "benefitTypeId" TEXT NOT NULL,
    "rewardTierId" TEXT,
    "rewardComponentId" TEXT NOT NULL,
    "recurrenceKey" TEXT,
    "state" "ContributorRewardState" NOT NULL DEFAULT 'CALCULATED',
    "baseAmount" DOUBLE PRECISION NOT NULL,
    "finalAmount" DOUBLE PRECISION NOT NULL,
    "roundingAdjustment" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "explanation" JSONB,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContributorReward_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KpiTemplate_code_key" ON "KpiTemplate"("code");

-- CreateIndex
CREATE INDEX "KpiTemplate_tenantId_isActive_idx" ON "KpiTemplate"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "KpiTemplate_isSystem_isActive_idx" ON "KpiTemplate"("isSystem", "isActive");

-- CreateIndex
CREATE INDEX "KpiRewardTier_kpiDefinitionId_tierSetKey_isActive_idx" ON "KpiRewardTier"("kpiDefinitionId", "tierSetKey", "isActive");

-- CreateIndex
CREATE INDEX "KpiRewardTier_effectiveFrom_effectiveTo_idx" ON "KpiRewardTier"("effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "KpiRewardTier_kpiDefinitionId_tierSetKey_code_effectiveFrom_key" ON "KpiRewardTier"("kpiDefinitionId", "tierSetKey", "code", "effectiveFrom");

-- CreateIndex
CREATE INDEX "KpiRewardRule_rewardTierId_sortOrder_idx" ON "KpiRewardRule"("rewardTierId", "sortOrder");

-- CreateIndex
CREATE INDEX "KpiRewardComponent_kpiDefinitionId_rewardTierId_isActive_idx" ON "KpiRewardComponent"("kpiDefinitionId", "rewardTierId", "isActive");

-- CreateIndex
CREATE INDEX "KpiRewardComponent_stageDefinitionId_idx" ON "KpiRewardComponent"("stageDefinitionId");

-- CreateIndex
CREATE UNIQUE INDEX "KpiRewardComponent_kpiDefinitionId_code_key" ON "KpiRewardComponent"("kpiDefinitionId", "code");

-- CreateIndex
CREATE INDEX "KpiRewardDistribution_rewardComponentId_sortOrder_idx" ON "KpiRewardDistribution"("rewardComponentId", "sortOrder");

-- CreateIndex
CREATE INDEX "KpiRewardDistribution_contributorRoleId_idx" ON "KpiRewardDistribution"("contributorRoleId");

-- CreateIndex
CREATE UNIQUE INDEX "ContributorReward_idempotencyKey_key" ON "ContributorReward"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ContributorReward_tenantId_periodId_kpiDefinitionId_idx" ON "ContributorReward"("tenantId", "periodId", "kpiDefinitionId");

-- CreateIndex
CREATE INDEX "ContributorReward_achievementId_idx" ON "ContributorReward"("achievementId");

-- CreateIndex
CREATE INDEX "ContributorReward_achievementContributorId_idx" ON "ContributorReward"("achievementContributorId");

-- CreateIndex
CREATE INDEX "ContributorReward_contributorUserId_idx" ON "ContributorReward"("contributorUserId");

-- CreateIndex
CREATE INDEX "ContributorReward_rewardComponentId_idx" ON "ContributorReward"("rewardComponentId");

-- AddForeignKey
ALTER TABLE "KpiTemplate" ADD CONSTRAINT "KpiTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiRewardTier" ADD CONSTRAINT "KpiRewardTier_kpiDefinitionId_fkey" FOREIGN KEY ("kpiDefinitionId") REFERENCES "KpiDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiRewardRule" ADD CONSTRAINT "KpiRewardRule_rewardTierId_fkey" FOREIGN KEY ("rewardTierId") REFERENCES "KpiRewardTier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiRewardComponent" ADD CONSTRAINT "KpiRewardComponent_kpiDefinitionId_fkey" FOREIGN KEY ("kpiDefinitionId") REFERENCES "KpiDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiRewardComponent" ADD CONSTRAINT "KpiRewardComponent_rewardTierId_fkey" FOREIGN KEY ("rewardTierId") REFERENCES "KpiRewardTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiRewardComponent" ADD CONSTRAINT "KpiRewardComponent_stageDefinitionId_fkey" FOREIGN KEY ("stageDefinitionId") REFERENCES "KpiStageDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiRewardComponent" ADD CONSTRAINT "KpiRewardComponent_parentComponentId_fkey" FOREIGN KEY ("parentComponentId") REFERENCES "KpiRewardComponent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiRewardComponent" ADD CONSTRAINT "KpiRewardComponent_benefitTypeId_fkey" FOREIGN KEY ("benefitTypeId") REFERENCES "BenefitType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiRewardDistribution" ADD CONSTRAINT "KpiRewardDistribution_rewardComponentId_fkey" FOREIGN KEY ("rewardComponentId") REFERENCES "KpiRewardComponent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiRewardDistribution" ADD CONSTRAINT "KpiRewardDistribution_contributorRoleId_fkey" FOREIGN KEY ("contributorRoleId") REFERENCES "ContributorRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributorReward" ADD CONSTRAINT "ContributorReward_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributorReward" ADD CONSTRAINT "ContributorReward_kpiDefinitionId_fkey" FOREIGN KEY ("kpiDefinitionId") REFERENCES "KpiDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributorReward" ADD CONSTRAINT "ContributorReward_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "Achievement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributorReward" ADD CONSTRAINT "ContributorReward_achievementContributorId_fkey" FOREIGN KEY ("achievementContributorId") REFERENCES "AchievementContributor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributorReward" ADD CONSTRAINT "ContributorReward_contributorUserId_fkey" FOREIGN KEY ("contributorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributorReward" ADD CONSTRAINT "ContributorReward_benefitTypeId_fkey" FOREIGN KEY ("benefitTypeId") REFERENCES "BenefitType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributorReward" ADD CONSTRAINT "ContributorReward_rewardTierId_fkey" FOREIGN KEY ("rewardTierId") REFERENCES "KpiRewardTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributorReward" ADD CONSTRAINT "ContributorReward_rewardComponentId_fkey" FOREIGN KEY ("rewardComponentId") REFERENCES "KpiRewardComponent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
