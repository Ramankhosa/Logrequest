-- CreateEnum
CREATE TYPE "AchievementFieldType" AS ENUM ('TEXT', 'TEXTAREA', 'NUMBER', 'DATE', 'URL', 'EMAIL', 'SELECT', 'MULTI_SELECT', 'BOOLEAN', 'FILE_LINK');

-- AlterEnum
ALTER TYPE "AchievementState" ADD VALUE 'RECOMMENDED';

-- AlterTable
ALTER TABLE "Achievement" ADD COLUMN     "achievementFormData" JSONB,
ADD COLUMN     "recommendationNote" TEXT,
ADD COLUMN     "recommendedAt" TIMESTAMP(3),
ADD COLUMN     "recommendedByUserId" TEXT,
ADD COLUMN     "verificationLog" JSONB;

-- AlterTable
ALTER TABLE "KpiDefinition" ADD COLUMN     "achievementFormConfig" JSONB,
ADD COLUMN     "achievementTemplateKey" TEXT;

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "linkUrl" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_userId_isRead_createdAt_idx" ON "Notification"("userId", "isRead", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_tenantId_userId_idx" ON "Notification"("tenantId", "userId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
