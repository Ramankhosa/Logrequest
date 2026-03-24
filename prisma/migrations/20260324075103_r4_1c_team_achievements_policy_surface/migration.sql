-- AlterTable
ALTER TABLE "Achievement" ADD COLUMN     "duplicateCheckResult" JSONB,
ADD COLUMN     "isOBO" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "oboReportedForUserId" TEXT;

-- CreateTable
CREATE TABLE "AchievementContributor" (
    "id" TEXT NOT NULL,
    "achievementId" TEXT NOT NULL,
    "type" "ContributorType" NOT NULL DEFAULT 'INTERNAL',
    "userId" TEXT,
    "externalName" TEXT,
    "externalAffiliation" TEXT,
    "externalScope" "ExternalContributorScope",
    "externalData" JSONB,
    "contributorRoleId" TEXT NOT NULL,
    "creditPercent" DOUBLE PRECISION NOT NULL,
    "isExcludedFromReward" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AchievementContributor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AchievementContributor_achievementId_idx" ON "AchievementContributor"("achievementId");

-- CreateIndex
CREATE INDEX "AchievementContributor_userId_idx" ON "AchievementContributor"("userId");

-- CreateIndex
CREATE INDEX "AchievementContributor_contributorRoleId_idx" ON "AchievementContributor"("contributorRoleId");

-- CreateIndex
CREATE UNIQUE INDEX "AchievementContributor_achievementId_userId_key" ON "AchievementContributor"("achievementId", "userId");

-- CreateIndex
CREATE INDEX "Achievement_oboReportedForUserId_periodId_idx" ON "Achievement"("oboReportedForUserId", "periodId");

-- AddForeignKey
ALTER TABLE "AchievementContributor" ADD CONSTRAINT "AchievementContributor_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "Achievement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AchievementContributor" ADD CONSTRAINT "AchievementContributor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AchievementContributor" ADD CONSTRAINT "AchievementContributor_contributorRoleId_fkey" FOREIGN KEY ("contributorRoleId") REFERENCES "ContributorRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
