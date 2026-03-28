CREATE TYPE "TransferKpiPolicy" AS ENUM ('CARRY_ALL', 'LEAVE_ALL', 'SELECTIVE');
CREATE TYPE "TransferTargetActionType" AS ENUM ('CARRIED', 'LEFT_BEHIND', 'LOCKED_SOURCE_ONLY', 'REASSIGNED_AFTER_TRANSFER');
CREATE TYPE "TransferStatusEventType" AS ENUM ('INITIATED', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXECUTED', 'CONFIGURED');

ALTER TABLE "TransferRecord"
  ADD COLUMN "kpiTransferPolicy" "TransferKpiPolicy",
  ADD COLUMN "kpiTransferDetails" JSONB,
  ADD COLUMN "completionNotes" TEXT;

CREATE TABLE "TransferTargetAction" (
  "id" TEXT NOT NULL,
  "transferRecordId" TEXT NOT NULL,
  "targetAllocationId" TEXT NOT NULL,
  "action" "TransferTargetActionType" NOT NULL,
  "previousUnitId" TEXT,
  "newUnitId" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TransferTargetAction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TransferStatusEvent" (
  "id" TEXT NOT NULL,
  "transferRecordId" TEXT NOT NULL,
  "eventType" "TransferStatusEventType" NOT NULL,
  "actorUserId" TEXT,
  "note" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TransferStatusEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TransferTargetAction_transferRecordId_idx" ON "TransferTargetAction"("transferRecordId");
CREATE INDEX "TransferTargetAction_targetAllocationId_idx" ON "TransferTargetAction"("targetAllocationId");
CREATE INDEX "TransferStatusEvent_transferRecordId_createdAt_idx" ON "TransferStatusEvent"("transferRecordId", "createdAt");

ALTER TABLE "TransferTargetAction"
  ADD CONSTRAINT "TransferTargetAction_transferRecordId_fkey"
  FOREIGN KEY ("transferRecordId") REFERENCES "TransferRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TransferTargetAction"
  ADD CONSTRAINT "TransferTargetAction_targetAllocationId_fkey"
  FOREIGN KEY ("targetAllocationId") REFERENCES "TargetAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TransferStatusEvent"
  ADD CONSTRAINT "TransferStatusEvent_transferRecordId_fkey"
  FOREIGN KEY ("transferRecordId") REFERENCES "TransferRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
