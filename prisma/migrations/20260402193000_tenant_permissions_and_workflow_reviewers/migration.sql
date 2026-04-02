CREATE TYPE "TenantPermissionRole" AS ENUM (
  'KRA_MANAGER',
  'KPI_EDITOR',
  'TARGET_MANAGER',
  'WORKFLOW_MANAGER',
  'REWARD_MANAGER',
  'ACCESS_ADMIN',
  'PERSONNEL_MANAGER'
);

ALTER TABLE "KpiDefinition"
ADD COLUMN "keyReviewerUserId" TEXT,
ADD COLUMN "finalReviewerUserId" TEXT;

CREATE TABLE "TenantPermissionAssignment" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "roleCode" "TenantPermissionRole" NOT NULL,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TenantPermissionAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenantPermissionAssignment_tenantId_userId_roleCode_key"
ON "TenantPermissionAssignment"("tenantId", "userId", "roleCode");

CREATE INDEX "TenantPermissionAssignment_tenantId_roleCode_idx"
ON "TenantPermissionAssignment"("tenantId", "roleCode");

CREATE INDEX "TenantPermissionAssignment_tenantId_userId_idx"
ON "TenantPermissionAssignment"("tenantId", "userId");

CREATE INDEX "KpiDefinition_keyReviewerUserId_idx"
ON "KpiDefinition"("keyReviewerUserId");

CREATE INDEX "KpiDefinition_finalReviewerUserId_idx"
ON "KpiDefinition"("finalReviewerUserId");

ALTER TABLE "KpiDefinition"
ADD CONSTRAINT "KpiDefinition_keyReviewerUserId_fkey"
FOREIGN KEY ("keyReviewerUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "KpiDefinition"
ADD CONSTRAINT "KpiDefinition_finalReviewerUserId_fkey"
FOREIGN KEY ("finalReviewerUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TenantPermissionAssignment"
ADD CONSTRAINT "TenantPermissionAssignment_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TenantPermissionAssignment"
ADD CONSTRAINT "TenantPermissionAssignment_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TenantPermissionAssignment"
ADD CONSTRAINT "TenantPermissionAssignment_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
