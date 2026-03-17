-- CreateEnum
CREATE TYPE "OrgStructureState" AS ENUM ('DRAFT', 'VALIDATED', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "OrgUnitCategory" AS ENUM ('ORG_ROOT', 'CAMPUS', 'SCHOOL_LIKE_UNIT', 'DEPARTMENT_LIKE_UNIT', 'CENTER', 'LAB', 'OFFICE', 'DIVISION', 'PROGRAM', 'ADMINISTRATIVE_UNIT', 'BUSINESS_UNIT', 'FUNCTION', 'TEAM', 'REGION', 'BRANCH', 'SITE', 'PROJECT_UNIT', 'CUSTOM_UNIT');

-- CreateEnum
CREATE TYPE "OrgUnitState" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "OrgAssignmentType" AS ENUM ('PRIMARY', 'SECONDARY');

-- CreateEnum
CREATE TYPE "OrgRoleScope" AS ENUM ('NODE', 'DESCENDANTS');

-- CreateTable
CREATE TABLE "OrgStructureVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "state" "OrgStructureState" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "validationSummary" JSONB,
    "validatedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgStructureVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgUnitType" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "typeKey" TEXT NOT NULL,
    "internalCategory" "OrgUnitCategory" NOT NULL,
    "displayLabel" TEXT NOT NULL,
    "description" TEXT,
    "allowRoot" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgUnitType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgUnit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "level" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "path" TEXT,
    "state" "OrgUnitState" NOT NULL DEFAULT 'DRAFT',
    "metadata" JSONB,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportingLine" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "unitId" TEXT,
    "managerUserId" TEXT NOT NULL,
    "memberUserId" TEXT NOT NULL,
    "lineType" TEXT NOT NULL DEFAULT 'SOLID',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportingLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserOrgAssignment" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignmentType" "OrgAssignmentType" NOT NULL DEFAULT 'PRIMARY',
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserOrgAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgRoleAssignment" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleName" TEXT NOT NULL,
    "scope" "OrgRoleScope" NOT NULL DEFAULT 'NODE',
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgRoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrgStructureVersion_tenantId_state_idx" ON "OrgStructureVersion"("tenantId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "OrgStructureVersion_tenantId_versionNumber_key" ON "OrgStructureVersion"("tenantId", "versionNumber");

-- CreateIndex
CREATE INDEX "OrgUnitType_versionId_sortOrder_idx" ON "OrgUnitType"("versionId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "OrgUnitType_versionId_typeKey_key" ON "OrgUnitType"("versionId", "typeKey");

-- CreateIndex
CREATE INDEX "OrgUnit_tenantId_code_idx" ON "OrgUnit"("tenantId", "code");

-- CreateIndex
CREATE INDEX "OrgUnit_versionId_parentId_idx" ON "OrgUnit"("versionId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgUnit_versionId_code_key" ON "OrgUnit"("versionId", "code");

-- CreateIndex
CREATE INDEX "ReportingLine_versionId_unitId_idx" ON "ReportingLine"("versionId", "unitId");

-- CreateIndex
CREATE INDEX "ReportingLine_managerUserId_memberUserId_idx" ON "ReportingLine"("managerUserId", "memberUserId");

-- CreateIndex
CREATE INDEX "UserOrgAssignment_versionId_userId_idx" ON "UserOrgAssignment"("versionId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserOrgAssignment_versionId_unitId_userId_assignmentType_key" ON "UserOrgAssignment"("versionId", "unitId", "userId", "assignmentType");

-- CreateIndex
CREATE INDEX "OrgRoleAssignment_versionId_unitId_roleName_idx" ON "OrgRoleAssignment"("versionId", "unitId", "roleName");

-- CreateIndex
CREATE INDEX "OrgRoleAssignment_versionId_userId_idx" ON "OrgRoleAssignment"("versionId", "userId");

-- AddForeignKey
ALTER TABLE "OrgStructureVersion" ADD CONSTRAINT "OrgStructureVersion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgUnitType" ADD CONSTRAINT "OrgUnitType_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "OrgStructureVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgUnit" ADD CONSTRAINT "OrgUnit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgUnit" ADD CONSTRAINT "OrgUnit_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "OrgStructureVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgUnit" ADD CONSTRAINT "OrgUnit_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "OrgUnitType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgUnit" ADD CONSTRAINT "OrgUnit_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "OrgUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportingLine" ADD CONSTRAINT "ReportingLine_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "OrgStructureVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportingLine" ADD CONSTRAINT "ReportingLine_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "OrgUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportingLine" ADD CONSTRAINT "ReportingLine_managerUserId_fkey" FOREIGN KEY ("managerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportingLine" ADD CONSTRAINT "ReportingLine_memberUserId_fkey" FOREIGN KEY ("memberUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserOrgAssignment" ADD CONSTRAINT "UserOrgAssignment_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "OrgStructureVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserOrgAssignment" ADD CONSTRAINT "UserOrgAssignment_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "OrgUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserOrgAssignment" ADD CONSTRAINT "UserOrgAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgRoleAssignment" ADD CONSTRAINT "OrgRoleAssignment_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "OrgStructureVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgRoleAssignment" ADD CONSTRAINT "OrgRoleAssignment_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "OrgUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgRoleAssignment" ADD CONSTRAINT "OrgRoleAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
