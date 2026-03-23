-- CreateEnum
CREATE TYPE "ContributorType" AS ENUM ('INTERNAL', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "ExternalContributorScope" AS ENUM ('NATIONAL', 'INTERNATIONAL');

-- CreateTable
CREATE TABLE "ExternalContributorTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "fields" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalContributorTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KpiContributorConfig" (
    "id" TEXT NOT NULL,
    "kpiDefinitionId" TEXT NOT NULL,
    "externalContribTemplateId" TEXT,
    "allowExternalContributors" BOOLEAN NOT NULL DEFAULT true,
    "duplicateCheckFields" JSONB,
    "creditSumMode" TEXT NOT NULL DEFAULT 'MUST_EQUAL_100',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KpiContributorConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExternalContributorTemplate_tenantId_isActive_idx" ON "ExternalContributorTemplate"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "KpiContributorConfig_kpiDefinitionId_key" ON "KpiContributorConfig"("kpiDefinitionId");

-- CreateIndex
CREATE INDEX "KpiContributorConfig_externalContribTemplateId_idx" ON "KpiContributorConfig"("externalContribTemplateId");

-- AddForeignKey
ALTER TABLE "ExternalContributorTemplate" ADD CONSTRAINT "ExternalContributorTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiContributorConfig" ADD CONSTRAINT "KpiContributorConfig_kpiDefinitionId_fkey" FOREIGN KEY ("kpiDefinitionId") REFERENCES "KpiDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiContributorConfig" ADD CONSTRAINT "KpiContributorConfig_externalContribTemplateId_fkey" FOREIGN KEY ("externalContribTemplateId") REFERENCES "ExternalContributorTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
