-- CreateEnum
CREATE TYPE "TenantLifecycleState" AS ENUM ('DRAFT', 'PENDING_VERIFICATION', 'ACTIVE', 'GRACE_PERIOD', 'SUSPENDED', 'REVOKED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TenantEntitlementState" AS ENUM ('TRIAL_ACTIVE', 'PAID_ACTIVE', 'GRACE_PERIOD', 'PAYMENT_HOLD', 'SUSPENDED', 'REVOKED', 'EXPIRED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "UserLifecycleState" AS ENUM ('DRAFT', 'INVITED', 'PENDING_ACTIVATION', 'ACTIVE', 'LOCKED', 'SUSPENDED', 'REVOKED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('INVITED', 'PENDING_ACTIVATION', 'ACTIVE', 'LOCKED', 'SUSPENDED', 'REVOKED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPERADMIN', 'TENANT_OWNER', 'TENANT_ADMIN', 'TENANT_USER');

-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('GOOGLE', 'MICROSOFT');

-- CreateEnum
CREATE TYPE "UploadBatchStatus" AS ENUM ('UPLOADED', 'VALIDATED', 'CONFIRMED', 'PROVISIONED', 'PARTIALLY_PROVISIONED', 'FAILED');

-- CreateEnum
CREATE TYPE "UploadRowStatus" AS ENUM ('VALID', 'WARNING', 'REJECTED', 'PROVISIONED');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "legalOrganizationName" TEXT NOT NULL,
    "organizationType" TEXT NOT NULL,
    "primaryDomains" TEXT[],
    "subscriptionPlan" TEXT NOT NULL,
    "subscriptionStartDate" TIMESTAMP(3),
    "subscriptionEndDate" TIMESTAMP(3),
    "entitlementState" "TenantEntitlementState" NOT NULL DEFAULT 'TRIAL_ACTIVE',
    "lifecycleState" "TenantLifecycleState" NOT NULL DEFAULT 'DRAFT',
    "ownerUserId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantPolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "exactSocialEmailMatchOnly" BOOLEAN NOT NULL DEFAULT true,
    "allowPasswordLogin" BOOLEAN NOT NULL DEFAULT true,
    "allowGoogleLogin" BOOLEAN NOT NULL DEFAULT true,
    "allowMicrosoftLogin" BOOLEAN NOT NULL DEFAULT true,
    "allowGracePeriodAccess" BOOLEAN NOT NULL DEFAULT true,
    "multiTenantMembershipEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "officialEmail" TEXT NOT NULL,
    "alternateEmail" TEXT,
    "phoneNumber" TEXT,
    "allowedLoginMethods" JSONB,
    "passwordHash" TEXT,
    "emailVerifiedAt" TIMESTAMP(3),
    "passwordSetAt" TIMESTAMP(3),
    "passwordChangedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "lifecycleState" "UserLifecycleState" NOT NULL DEFAULT 'DRAFT',
    "mustResetPassword" BOOLEAN NOT NULL DEFAULT false,
    "isSuperadmin" BOOLEAN NOT NULL DEFAULT false,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "AuthProvider" NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "department" TEXT,
    "employeeId" TEXT,
    "status" "MembershipStatus" NOT NULL DEFAULT 'INVITED',
    "invitationState" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "invitedAt" TIMESTAMP(3),
    "activationTimestamp" TIMESTAMP(3),
    "lastAccessTimestamp" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "membershipId" TEXT,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "deliveryChannel" TEXT NOT NULL DEFAULT 'email',
    "invitedByUserId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadBatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "uploadedByUserId" TEXT,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "status" "UploadBatchStatus" NOT NULL DEFAULT 'UPLOADED',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "validRows" INTEGER NOT NULL DEFAULT 0,
    "warningRows" INTEGER NOT NULL DEFAULT 0,
    "rejectedRows" INTEGER NOT NULL DEFAULT 0,
    "provisionedRows" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "confirmedAt" TIMESTAMP(3),
    "provisionedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UploadBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadRow" (
    "id" TEXT NOT NULL,
    "uploadBatchId" TEXT NOT NULL,
    "membershipId" TEXT,
    "rowIndex" INTEGER NOT NULL,
    "status" "UploadRowStatus" NOT NULL,
    "rawData" JSONB NOT NULL,
    "normalizedData" JSONB,
    "errors" JSONB,
    "warnings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UploadRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "actorUserId" TEXT,
    "actorRole" "Role",
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "sourceIp" TEXT,
    "userAgent" TEXT,
    "previousState" JSONB,
    "newState" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_code_key" ON "Tenant"("code");

-- CreateIndex
CREATE INDEX "Tenant_lifecycleState_entitlementState_idx" ON "Tenant"("lifecycleState", "entitlementState");

-- CreateIndex
CREATE UNIQUE INDEX "TenantPolicy_tenantId_key" ON "TenantPolicy"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "User_officialEmail_key" ON "User"("officialEmail");

-- CreateIndex
CREATE INDEX "User_lifecycleState_idx" ON "User"("lifecycleState");

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccount_provider_providerAccountId_key" ON "SocialAccount"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccount_userId_provider_key" ON "SocialAccount"("userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_expiresAt_idx" ON "PasswordResetToken"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "Membership_tenantId_role_status_idx" ON "Membership"("tenantId", "role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_tenantId_userId_key" ON "Membership"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_tenantId_employeeId_key" ON "Membership"("tenantId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_token_key" ON "Invitation"("token");

-- CreateIndex
CREATE INDEX "Invitation_tenantId_status_expiresAt_idx" ON "Invitation"("tenantId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "UploadBatch_tenantId_status_createdAt_idx" ON "UploadBatch"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "UploadRow_uploadBatchId_status_idx" ON "UploadRow"("uploadBatchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "UploadRow_uploadBatchId_rowIndex_key" ON "UploadRow"("uploadBatchId", "rowIndex");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");

-- AddForeignKey
ALTER TABLE "TenantPolicy" ADD CONSTRAINT "TenantPolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadBatch" ADD CONSTRAINT "UploadBatch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadRow" ADD CONSTRAINT "UploadRow_uploadBatchId_fkey" FOREIGN KEY ("uploadBatchId") REFERENCES "UploadBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadRow" ADD CONSTRAINT "UploadRow_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
