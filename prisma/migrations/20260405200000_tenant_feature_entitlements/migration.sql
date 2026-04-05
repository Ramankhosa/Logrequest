-- CreateEnum
CREATE TYPE "TenantFeatureCode" AS ENUM ('ACCREDITATION_COPILOT');

-- CreateEnum
CREATE TYPE "TenantFeatureEntitlementStatus" AS ENUM ('ENABLED', 'DISABLED');

-- CreateTable
CREATE TABLE "TenantFeatureEntitlement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "featureCode" "TenantFeatureCode" NOT NULL,
    "status" "TenantFeatureEntitlementStatus" NOT NULL DEFAULT 'DISABLED',
    "enabledAt" TIMESTAMP(3),
    "enabledByUserId" TEXT,
    "disabledAt" TIMESTAMP(3),
    "disabledByUserId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantFeatureEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TenantFeatureEntitlement_tenantId_status_idx" ON "TenantFeatureEntitlement"("tenantId", "status");

-- CreateIndex
CREATE INDEX "TenantFeatureEntitlement_featureCode_status_idx" ON "TenantFeatureEntitlement"("featureCode", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TenantFeatureEntitlement_tenantId_featureCode_key" ON "TenantFeatureEntitlement"("tenantId", "featureCode");

-- AddForeignKey
ALTER TABLE "TenantFeatureEntitlement" ADD CONSTRAINT "TenantFeatureEntitlement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
