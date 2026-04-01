-- CreateEnum
CREATE TYPE "JournalPolicyStatus" AS ENUM ('ALLOWED', 'DISABLED', 'BLACKLISTED');

-- AlterTable
ALTER TABLE "JournalCatalogRecord" ADD COLUMN     "policyNote" TEXT,
ADD COLUMN     "policyStatus" "JournalPolicyStatus" NOT NULL DEFAULT 'ALLOWED';

-- CreateIndex
CREATE INDEX "JournalCatalogRecord_scopeTenantKey_sourceYear_policyStatus_idx" ON "JournalCatalogRecord"("scopeTenantKey", "sourceYear", "policyStatus");
