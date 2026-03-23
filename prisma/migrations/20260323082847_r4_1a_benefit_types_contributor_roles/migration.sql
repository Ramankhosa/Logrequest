-- CreateTable
CREATE TABLE "BenefitType" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unit" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BenefitType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContributorRole" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "defaultCreditPercent" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContributorRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KpiApplicableRole" (
    "id" TEXT NOT NULL,
    "kpiDefinitionId" TEXT NOT NULL,
    "contributorRoleId" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "KpiApplicableRole_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BenefitType_tenantId_isActive_idx" ON "BenefitType"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "BenefitType_tenantId_code_key" ON "BenefitType"("tenantId", "code");

-- CreateIndex
CREATE INDEX "ContributorRole_tenantId_isActive_idx" ON "ContributorRole"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ContributorRole_tenantId_code_key" ON "ContributorRole"("tenantId", "code");

-- CreateIndex
CREATE INDEX "KpiApplicableRole_kpiDefinitionId_idx" ON "KpiApplicableRole"("kpiDefinitionId");

-- CreateIndex
CREATE UNIQUE INDEX "KpiApplicableRole_kpiDefinitionId_contributorRoleId_key" ON "KpiApplicableRole"("kpiDefinitionId", "contributorRoleId");

-- AddForeignKey
ALTER TABLE "BenefitType" ADD CONSTRAINT "BenefitType_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributorRole" ADD CONSTRAINT "ContributorRole_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiApplicableRole" ADD CONSTRAINT "KpiApplicableRole_kpiDefinitionId_fkey" FOREIGN KEY ("kpiDefinitionId") REFERENCES "KpiDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiApplicableRole" ADD CONSTRAINT "KpiApplicableRole_contributorRoleId_fkey" FOREIGN KEY ("contributorRoleId") REFERENCES "ContributorRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;
