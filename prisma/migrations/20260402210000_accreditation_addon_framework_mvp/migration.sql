-- CreateEnum
CREATE TYPE "TenantServiceCode" AS ENUM ('ACCREDITATION');

-- CreateEnum
CREATE TYPE "TenantServiceEntitlementStatus" AS ENUM ('ENABLED', 'DISABLED');

-- CreateEnum
CREATE TYPE "AccreditationScope" AS ENUM ('GLOBAL', 'TENANT');

-- CreateEnum
CREATE TYPE "CriterionDataType" AS ENUM ('QUANTITATIVE', 'QUALITATIVE', 'HYBRID');

-- AlterEnum
ALTER TYPE "TenantPermissionRole" ADD VALUE 'ACCREDITATION_MANAGER';

-- CreateTable
CREATE TABLE "TenantServiceEntitlement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceCode" "TenantServiceCode" NOT NULL,
    "status" "TenantServiceEntitlementStatus" NOT NULL DEFAULT 'DISABLED',
    "enabledAt" TIMESTAMP(3),
    "enabledByUserId" TEXT,
    "disabledAt" TIMESTAMP(3),
    "disabledByUserId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantServiceEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccreditationBody" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "scope" "AccreditationScope" NOT NULL DEFAULT 'GLOBAL',
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "description" TEXT,
    "websiteUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccreditationBody_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccreditationBodyVersion" (
    "id" TEXT NOT NULL,
    "bodyId" TEXT NOT NULL,
    "versionCode" TEXT NOT NULL,
    "versionName" TEXT NOT NULL,
    "scoreBase" DOUBLE PRECISION NOT NULL,
    "convertedScaleMax" DOUBLE PRECISION,
    "conversionFormula" TEXT,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccreditationBodyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccreditationProfile" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "profileCode" TEXT NOT NULL,
    "profileName" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccreditationProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccreditationCriterion" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "parentId" TEXT,
    "criterionCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dataType" "CriterionDataType" NOT NULL DEFAULT 'QUANTITATIVE',
    "maxScore" DOUBLE PRECISION,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "unitOfMeasure" TEXT,
    "validationRules" JSONB,
    "expectedEvidence" JSONB,
    "isLeaf" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccreditationCriterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccreditationProfileWeight" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,
    "maxScore" DOUBLE PRECISION NOT NULL,
    "weightPercent" DOUBLE PRECISION,

    CONSTRAINT "AccreditationProfileWeight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccreditationScoringSlab" (
    "id" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,
    "rangeMin" DOUBLE PRECISION,
    "rangeMax" DOUBLE PRECISION,
    "rangeLabel" TEXT,
    "pointsAwarded" DOUBLE PRECISION NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AccreditationScoringSlab_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccreditationGradeBand" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "gradeLabel" TEXT NOT NULL,
    "scoreMin" DOUBLE PRECISION NOT NULL,
    "scoreMax" DOUBLE PRECISION NOT NULL,
    "outcome" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AccreditationGradeBand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccreditationThresholdRule" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "criterionId" TEXT,
    "thresholdType" TEXT NOT NULL,
    "minValue" DOUBLE PRECISION NOT NULL,
    "outcome" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "AccreditationThresholdRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KpiAccreditationCriterionLink" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kpiDefinitionId" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,
    "notes" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KpiAccreditationCriterionLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TenantServiceEntitlement_tenantId_status_idx" ON "TenantServiceEntitlement"("tenantId", "status");

-- CreateIndex
CREATE INDEX "TenantServiceEntitlement_serviceCode_status_idx" ON "TenantServiceEntitlement"("serviceCode", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TenantServiceEntitlement_tenantId_serviceCode_key" ON "TenantServiceEntitlement"("tenantId", "serviceCode");

-- CreateIndex
CREATE INDEX "AccreditationBody_scope_isActive_idx" ON "AccreditationBody"("scope", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "AccreditationBody_tenantId_code_key" ON "AccreditationBody"("tenantId", "code");

-- CreateIndex
CREATE INDEX "AccreditationBodyVersion_bodyId_isActive_idx" ON "AccreditationBodyVersion"("bodyId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "AccreditationBodyVersion_bodyId_versionCode_key" ON "AccreditationBodyVersion"("bodyId", "versionCode");

-- CreateIndex
CREATE UNIQUE INDEX "AccreditationProfile_versionId_profileCode_key" ON "AccreditationProfile"("versionId", "profileCode");

-- CreateIndex
CREATE INDEX "AccreditationCriterion_versionId_parentId_sortOrder_idx" ON "AccreditationCriterion"("versionId", "parentId", "sortOrder");

-- CreateIndex
CREATE INDEX "AccreditationCriterion_versionId_depth_idx" ON "AccreditationCriterion"("versionId", "depth");

-- CreateIndex
CREATE UNIQUE INDEX "AccreditationCriterion_versionId_criterionCode_key" ON "AccreditationCriterion"("versionId", "criterionCode");

-- CreateIndex
CREATE UNIQUE INDEX "AccreditationProfileWeight_profileId_criterionId_key" ON "AccreditationProfileWeight"("profileId", "criterionId");

-- CreateIndex
CREATE INDEX "AccreditationScoringSlab_criterionId_sortOrder_idx" ON "AccreditationScoringSlab"("criterionId", "sortOrder");

-- CreateIndex
CREATE INDEX "AccreditationGradeBand_versionId_sortOrder_idx" ON "AccreditationGradeBand"("versionId", "sortOrder");

-- CreateIndex
CREATE INDEX "AccreditationThresholdRule_versionId_idx" ON "AccreditationThresholdRule"("versionId");

-- CreateIndex
CREATE INDEX "KpiAccreditationCriterionLink_tenantId_kpiDefinitionId_idx" ON "KpiAccreditationCriterionLink"("tenantId", "kpiDefinitionId");

-- CreateIndex
CREATE INDEX "KpiAccreditationCriterionLink_tenantId_criterionId_idx" ON "KpiAccreditationCriterionLink"("tenantId", "criterionId");

-- CreateIndex
CREATE UNIQUE INDEX "KpiAccreditationCriterionLink_kpiDefinitionId_criterionId_key" ON "KpiAccreditationCriterionLink"("kpiDefinitionId", "criterionId");

-- AddForeignKey
ALTER TABLE "TenantServiceEntitlement" ADD CONSTRAINT "TenantServiceEntitlement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccreditationBody" ADD CONSTRAINT "AccreditationBody_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccreditationBodyVersion" ADD CONSTRAINT "AccreditationBodyVersion_bodyId_fkey" FOREIGN KEY ("bodyId") REFERENCES "AccreditationBody"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccreditationProfile" ADD CONSTRAINT "AccreditationProfile_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "AccreditationBodyVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccreditationCriterion" ADD CONSTRAINT "AccreditationCriterion_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "AccreditationBodyVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccreditationCriterion" ADD CONSTRAINT "AccreditationCriterion_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "AccreditationCriterion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccreditationProfileWeight" ADD CONSTRAINT "AccreditationProfileWeight_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "AccreditationProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccreditationProfileWeight" ADD CONSTRAINT "AccreditationProfileWeight_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "AccreditationCriterion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccreditationScoringSlab" ADD CONSTRAINT "AccreditationScoringSlab_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "AccreditationCriterion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccreditationGradeBand" ADD CONSTRAINT "AccreditationGradeBand_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "AccreditationBodyVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccreditationThresholdRule" ADD CONSTRAINT "AccreditationThresholdRule_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "AccreditationBodyVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccreditationThresholdRule" ADD CONSTRAINT "AccreditationThresholdRule_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "AccreditationCriterion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiAccreditationCriterionLink" ADD CONSTRAINT "KpiAccreditationCriterionLink_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiAccreditationCriterionLink" ADD CONSTRAINT "KpiAccreditationCriterionLink_kpiDefinitionId_fkey" FOREIGN KEY ("kpiDefinitionId") REFERENCES "KpiDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiAccreditationCriterionLink" ADD CONSTRAINT "KpiAccreditationCriterionLink_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "AccreditationCriterion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
