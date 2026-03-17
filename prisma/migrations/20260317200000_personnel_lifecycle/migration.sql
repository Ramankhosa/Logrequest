-- CreateEnum
CREATE TYPE "KraState" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "KpiMeasurementType" AS ENUM ('NUMERIC', 'PERCENTAGE', 'BOOLEAN', 'RATING', 'CURRENCY');

-- CreateEnum
CREATE TYPE "PersonnelStatus" AS ENUM ('ONBOARDING', 'ACTIVE', 'ON_LEAVE', 'NOTICE_PERIOD', 'SEPARATED', 'SUSPENDED_HR');

-- CreateEnum
CREATE TYPE "PersonnelActionType" AS ENUM ('ONBOARD', 'ACTIVATE', 'ASSIGN_UNIT', 'REMOVE_UNIT', 'CHANGE_PRIMARY_UNIT', 'ASSIGN_ROLE', 'REMOVE_ROLE', 'LEAVE_START', 'LEAVE_END', 'LEAVE_EXTEND', 'TRANSFER_INITIATE', 'TRANSFER_COMPLETE', 'TRANSFER_CANCEL', 'RESIGN', 'RESIGN_WITHDRAW', 'TERMINATE', 'REINSTATE', 'RETIRE');

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'EXTENDED');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('PROPOSED', 'APPROVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ResignationStatus" AS ENUM ('SUBMITTED', 'NOTICE_PERIOD', 'HANDOVER_PENDING', 'COMPLETED', 'WITHDRAWN');

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "dateOfJoining" TIMESTAMP(3),
ADD COLUMN     "designation" TEXT,
ADD COLUMN     "personnelStatus" "PersonnelStatus" NOT NULL DEFAULT 'ONBOARDING';

-- AlterTable
ALTER TABLE "OrgRoleAssignment" ADD COLUMN     "roleDefinitionId" TEXT;

-- AlterTable
ALTER TABLE "UploadBatch" ADD COLUMN     "structureVersionId" TEXT,
ADD COLUMN     "uploadType" TEXT NOT NULL DEFAULT 'MEMBERS';

-- CreateTable
CREATE TABLE "OrgRoleDefinition" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "roleKey" TEXT NOT NULL,
    "displayLabel" TEXT NOT NULL,
    "description" TEXT,
    "isUnitHead" BOOLEAN NOT NULL DEFAULT false,
    "approvalAuthority" BOOLEAN NOT NULL DEFAULT false,
    "maxPerUnit" INTEGER NOT NULL DEFAULT -1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgRoleDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Kra" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "weightage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "state" "KraState" NOT NULL DEFAULT 'DRAFT',
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Kra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Kpi" (
    "id" TEXT NOT NULL,
    "kraId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "measurementType" "KpiMeasurementType" NOT NULL DEFAULT 'NUMERIC',
    "targetValue" DOUBLE PRECISION,
    "unit" TEXT,
    "weightage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Kpi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantPersonnelPolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "defaultNoticePeriodDays" INTEGER NOT NULL DEFAULT 30,
    "allowResignationWithdrawal" BOOLEAN NOT NULL DEFAULT true,
    "withdrawalWindowDays" INTEGER NOT NULL DEFAULT 7,
    "requireTransferApproval" BOOLEAN NOT NULL DEFAULT true,
    "requireLeaveApproval" BOOLEAN NOT NULL DEFAULT true,
    "allowMultiplePrimaryUnits" BOOLEAN NOT NULL DEFAULT false,
    "maxSecondaryUnits" INTEGER NOT NULL DEFAULT 5,
    "autoDeactivateOnExit" BOOLEAN NOT NULL DEFAULT true,
    "requireHeadCoverageBeforeExit" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantPersonnelPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveTypeDefinition" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "typeKey" TEXT NOT NULL,
    "displayLabel" TEXT NOT NULL,
    "description" TEXT,
    "maxDaysPerYear" INTEGER,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "requiresActing" BOOLEAN NOT NULL DEFAULT false,
    "isPaid" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveTypeDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "expectedEndDate" TIMESTAMP(3) NOT NULL,
    "actualEndDate" TIMESTAMP(3),
    "reason" TEXT,
    "status" "LeaveStatus" NOT NULL DEFAULT 'SCHEDULED',
    "approvedByUserId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActingAssignment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leaveRecordId" TEXT,
    "transferRecordId" TEXT,
    "versionId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "actingMembershipId" TEXT NOT NULL,
    "originalMembershipId" TEXT NOT NULL,
    "roleAssignmentId" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActingAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "sourceUnitId" TEXT NOT NULL,
    "targetUnitId" TEXT NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'PROPOSED',
    "reason" TEXT,
    "newRoleDefinitionIds" TEXT[],
    "initiatedByUserId" TEXT,
    "approvedByUserId" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransferRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResignationRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "resignationDate" TIMESTAMP(3) NOT NULL,
    "noticeEndDate" TIMESTAMP(3) NOT NULL,
    "actualExitDate" TIMESTAMP(3),
    "reason" TEXT,
    "status" "ResignationStatus" NOT NULL DEFAULT 'SUBMITTED',
    "handoverNotes" TEXT,
    "processedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResignationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonnelAction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "actionType" "PersonnelActionType" NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "reason" TEXT,
    "actorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonnelAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrgRoleDefinition_tenantId_isActive_idx" ON "OrgRoleDefinition"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "OrgRoleDefinition_tenantId_roleKey_key" ON "OrgRoleDefinition"("tenantId", "roleKey");

-- CreateIndex
CREATE INDEX "Kra_tenantId_unitId_idx" ON "Kra"("tenantId", "unitId");

-- CreateIndex
CREATE INDEX "Kra_tenantId_state_idx" ON "Kra"("tenantId", "state");

-- CreateIndex
CREATE INDEX "Kpi_kraId_idx" ON "Kpi"("kraId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantPersonnelPolicy_tenantId_key" ON "TenantPersonnelPolicy"("tenantId");

-- CreateIndex
CREATE INDEX "LeaveTypeDefinition_tenantId_isActive_idx" ON "LeaveTypeDefinition"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveTypeDefinition_tenantId_typeKey_key" ON "LeaveTypeDefinition"("tenantId", "typeKey");

-- CreateIndex
CREATE INDEX "LeaveRecord_tenantId_status_idx" ON "LeaveRecord"("tenantId", "status");

-- CreateIndex
CREATE INDEX "LeaveRecord_membershipId_status_idx" ON "LeaveRecord"("membershipId", "status");

-- CreateIndex
CREATE INDEX "LeaveRecord_tenantId_startDate_expectedEndDate_idx" ON "LeaveRecord"("tenantId", "startDate", "expectedEndDate");

-- CreateIndex
CREATE INDEX "ActingAssignment_tenantId_isActive_idx" ON "ActingAssignment"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "ActingAssignment_leaveRecordId_idx" ON "ActingAssignment"("leaveRecordId");

-- CreateIndex
CREATE INDEX "ActingAssignment_transferRecordId_idx" ON "ActingAssignment"("transferRecordId");

-- CreateIndex
CREATE INDEX "ActingAssignment_actingMembershipId_isActive_idx" ON "ActingAssignment"("actingMembershipId", "isActive");

-- CreateIndex
CREATE INDEX "TransferRecord_tenantId_status_idx" ON "TransferRecord"("tenantId", "status");

-- CreateIndex
CREATE INDEX "TransferRecord_membershipId_status_idx" ON "TransferRecord"("membershipId", "status");

-- CreateIndex
CREATE INDEX "ResignationRecord_tenantId_status_idx" ON "ResignationRecord"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ResignationRecord_membershipId_status_idx" ON "ResignationRecord"("membershipId", "status");

-- CreateIndex
CREATE INDEX "PersonnelAction_tenantId_membershipId_createdAt_idx" ON "PersonnelAction"("tenantId", "membershipId", "createdAt");

-- CreateIndex
CREATE INDEX "PersonnelAction_tenantId_actionType_effectiveDate_idx" ON "PersonnelAction"("tenantId", "actionType", "effectiveDate");

-- CreateIndex
CREATE INDEX "Membership_tenantId_personnelStatus_idx" ON "Membership"("tenantId", "personnelStatus");

-- CreateIndex
CREATE INDEX "OrgRoleAssignment_roleDefinitionId_idx" ON "OrgRoleAssignment"("roleDefinitionId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgRoleAssignment_versionId_unitId_userId_roleName_key" ON "OrgRoleAssignment"("versionId", "unitId", "userId", "roleName");

-- AddForeignKey
ALTER TABLE "OrgRoleAssignment" ADD CONSTRAINT "OrgRoleAssignment_roleDefinitionId_fkey" FOREIGN KEY ("roleDefinitionId") REFERENCES "OrgRoleDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgRoleDefinition" ADD CONSTRAINT "OrgRoleDefinition_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Kra" ADD CONSTRAINT "Kra_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Kra" ADD CONSTRAINT "Kra_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "OrgUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Kpi" ADD CONSTRAINT "Kpi_kraId_fkey" FOREIGN KEY ("kraId") REFERENCES "Kra"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantPersonnelPolicy" ADD CONSTRAINT "TenantPersonnelPolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveTypeDefinition" ADD CONSTRAINT "LeaveTypeDefinition_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRecord" ADD CONSTRAINT "LeaveRecord_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRecord" ADD CONSTRAINT "LeaveRecord_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRecord" ADD CONSTRAINT "LeaveRecord_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveTypeDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActingAssignment" ADD CONSTRAINT "ActingAssignment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActingAssignment" ADD CONSTRAINT "ActingAssignment_leaveRecordId_fkey" FOREIGN KEY ("leaveRecordId") REFERENCES "LeaveRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActingAssignment" ADD CONSTRAINT "ActingAssignment_transferRecordId_fkey" FOREIGN KEY ("transferRecordId") REFERENCES "TransferRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActingAssignment" ADD CONSTRAINT "ActingAssignment_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "OrgStructureVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActingAssignment" ADD CONSTRAINT "ActingAssignment_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "OrgUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActingAssignment" ADD CONSTRAINT "ActingAssignment_actingMembershipId_fkey" FOREIGN KEY ("actingMembershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActingAssignment" ADD CONSTRAINT "ActingAssignment_originalMembershipId_fkey" FOREIGN KEY ("originalMembershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferRecord" ADD CONSTRAINT "TransferRecord_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferRecord" ADD CONSTRAINT "TransferRecord_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferRecord" ADD CONSTRAINT "TransferRecord_sourceUnitId_fkey" FOREIGN KEY ("sourceUnitId") REFERENCES "OrgUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferRecord" ADD CONSTRAINT "TransferRecord_targetUnitId_fkey" FOREIGN KEY ("targetUnitId") REFERENCES "OrgUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResignationRecord" ADD CONSTRAINT "ResignationRecord_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResignationRecord" ADD CONSTRAINT "ResignationRecord_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonnelAction" ADD CONSTRAINT "PersonnelAction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonnelAction" ADD CONSTRAINT "PersonnelAction_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
