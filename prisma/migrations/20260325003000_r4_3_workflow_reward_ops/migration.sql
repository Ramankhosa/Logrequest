-- R4.3 workflow remarks, notification dedupe, and reward operations foundation

ALTER TYPE "ContributorRewardState" RENAME TO "ContributorRewardState_old";

CREATE TYPE "ContributorRewardState" AS ENUM ('DRAFT', 'PENDING', 'RELEASED', 'REVOKED');

ALTER TABLE "ContributorReward"
  ALTER COLUMN "state" DROP DEFAULT;

ALTER TABLE "ContributorReward"
  ALTER COLUMN "state" TYPE "ContributorRewardState"
  USING (
    CASE "state"::text
      WHEN 'CALCULATED' THEN 'DRAFT'
      WHEN 'CANCELLED' THEN 'REVOKED'
      ELSE 'DRAFT'
    END
  )::"ContributorRewardState";

ALTER TABLE "ContributorReward"
  ALTER COLUMN "state" SET DEFAULT 'DRAFT';

DROP TYPE "ContributorRewardState_old";

ALTER TABLE "Notification"
  ADD COLUMN "eventKey" TEXT;

ALTER TABLE "ContributorReward"
  ADD COLUMN "statusRemark" TEXT,
  ADD COLUMN "releasedAt" TIMESTAMP(3),
  ADD COLUMN "releasedById" TEXT,
  ADD COLUMN "releaseReference" TEXT,
  ADD COLUMN "revokedAt" TIMESTAMP(3),
  ADD COLUMN "revokedById" TEXT,
  ADD COLUMN "revocationReason" TEXT,
  ADD COLUMN "supersedesRewardId" TEXT,
  ADD COLUMN "replacedByRewardId" TEXT,
  ADD COLUMN "rewardOwnerUnitId" TEXT,
  ADD COLUMN "rewardOwnerUnitName" TEXT,
  ADD COLUMN "rewardOwnerUnitPath" TEXT,
  ADD COLUMN "rewardOwnerUnitTypeKey" TEXT,
  ADD COLUMN "reporterUnitId" TEXT,
  ADD COLUMN "reporterUnitName" TEXT,
  ADD COLUMN "reporterUnitPath" TEXT,
  ADD COLUMN "reporterUnitTypeKey" TEXT;

CREATE TABLE "ContributorRewardEvent" (
  "id" TEXT NOT NULL,
  "rewardId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "actorRole" "Role",
  "action" TEXT NOT NULL,
  "fromState" "ContributorRewardState",
  "toState" "ContributorRewardState",
  "note" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ContributorRewardEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContributorReward_tenantId_state_periodId_idx" ON "ContributorReward"("tenantId", "state", "periodId");
CREATE INDEX "ContributorReward_tenantId_rewardOwnerUnitId_periodId_idx" ON "ContributorReward"("tenantId", "rewardOwnerUnitId", "periodId");
CREATE INDEX "ContributorReward_tenantId_reporterUnitId_periodId_idx" ON "ContributorReward"("tenantId", "reporterUnitId", "periodId");
CREATE INDEX "ContributorReward_tenantId_releasedAt_idx" ON "ContributorReward"("tenantId", "releasedAt");

CREATE INDEX "ContributorRewardEvent_rewardId_createdAt_idx" ON "ContributorRewardEvent"("rewardId", "createdAt");
CREATE INDEX "ContributorRewardEvent_tenantId_createdAt_idx" ON "ContributorRewardEvent"("tenantId", "createdAt");
CREATE INDEX "ContributorRewardEvent_actorUserId_idx" ON "ContributorRewardEvent"("actorUserId");

CREATE UNIQUE INDEX "Notification_tenantId_userId_eventKey_key" ON "Notification"("tenantId", "userId", "eventKey");

ALTER TABLE "ContributorRewardEvent"
  ADD CONSTRAINT "ContributorRewardEvent_rewardId_fkey"
  FOREIGN KEY ("rewardId") REFERENCES "ContributorReward"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContributorRewardEvent"
  ADD CONSTRAINT "ContributorRewardEvent_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContributorRewardEvent"
  ADD CONSTRAINT "ContributorRewardEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
