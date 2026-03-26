-- AlterTable
ALTER TABLE "KpiStageDefinition" ADD COLUMN     "gracePeriodDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "latePenaltyEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "latePenaltyPercentPerDay" DOUBLE PRECISION NOT NULL DEFAULT 0;
