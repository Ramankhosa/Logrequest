-- CreateEnum
CREATE TYPE "JournalCatalogScope" AS ENUM ('GLOBAL', 'TENANT');

-- CreateEnum
CREATE TYPE "JournalImportSourceSystem" AS ENUM ('SCIMAGO_RAW', 'TENANT_TEMPLATE');

-- CreateEnum
CREATE TYPE "JournalImportBatchStatus" AS ENUM ('VALIDATED', 'APPLYING', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "JournalImportRowStatus" AS ENUM ('VALID', 'WARNING', 'REJECTED', 'APPLIED');

-- CreateTable
CREATE TABLE "JournalCatalogRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "scope" "JournalCatalogScope" NOT NULL,
    "scopeTenantKey" TEXT NOT NULL,
    "sourceSystem" "JournalImportSourceSystem" NOT NULL,
    "sourceYear" INTEGER NOT NULL,
    "sourceId" TEXT,
    "identityKey" TEXT NOT NULL,
    "currentIdentityKey" TEXT,
    "title" TEXT NOT NULL,
    "normalizedTitle" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "issnRaw" TEXT,
    "issnPrimary" TEXT,
    "issnList" TEXT[],
    "issnNormalizedList" TEXT[],
    "publisher" TEXT,
    "duplicatePublisher" TEXT,
    "openAccessLabel" TEXT,
    "isOpenAccess" BOOLEAN,
    "openAccessDiamondLabel" TEXT,
    "isOpenAccessDiamond" BOOLEAN,
    "sjr" DOUBLE PRECISION,
    "sjrBestQuartile" TEXT,
    "hIndex" INTEGER,
    "totalDocsCurrent" INTEGER,
    "totalDocs3Years" INTEGER,
    "totalRefs" INTEGER,
    "totalCitations3Years" INTEGER,
    "citableDocs3Years" INTEGER,
    "citationsPerDoc2Years" DOUBLE PRECISION,
    "refsPerDoc" DOUBLE PRECISION,
    "femalePercent" DOUBLE PRECISION,
    "overton" INTEGER,
    "sdg" INTEGER,
    "country" TEXT,
    "region" TEXT,
    "coverage" TEXT,
    "categories" TEXT,
    "areas" TEXT,
    "isJournalEligible" BOOLEAN NOT NULL DEFAULT false,
    "importBatchId" TEXT,
    "overriddenGlobalRecordId" TEXT,
    "rawSourcePayload" JSONB,
    "metadata" JSONB,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "archivedByUserId" TEXT,
    "archiveReason" TEXT,
    "isSuperseded" BOOLEAN NOT NULL DEFAULT false,
    "supersededAt" TIMESTAMP(3),
    "supersededByBatchId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalCatalogRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalImportBatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "scope" "JournalCatalogScope" NOT NULL,
    "scopeTenantKey" TEXT NOT NULL,
    "uploadedByUserId" TEXT,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "sourceSystem" "JournalImportSourceSystem" NOT NULL,
    "sourceYear" INTEGER NOT NULL,
    "mode" TEXT NOT NULL,
    "status" "JournalImportBatchStatus" NOT NULL DEFAULT 'VALIDATED',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "validRows" INTEGER NOT NULL DEFAULT 0,
    "warningRows" INTEGER NOT NULL DEFAULT 0,
    "rejectedRows" INTEGER NOT NULL DEFAULT 0,
    "appliedRows" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "confirmedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalImportRow" (
    "id" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "status" "JournalImportRowStatus" NOT NULL,
    "sourceId" TEXT,
    "identityKey" TEXT,
    "rawText" TEXT,
    "rawData" JSONB NOT NULL,
    "normalizedData" JSONB,
    "errors" JSONB,
    "warnings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JournalCatalogRecord_tenantId_sourceYear_isArchived_idx" ON "JournalCatalogRecord"("tenantId", "sourceYear", "isArchived");

-- CreateIndex
CREATE INDEX "JournalCatalogRecord_scopeTenantKey_sourceYear_type_idx" ON "JournalCatalogRecord"("scopeTenantKey", "sourceYear", "type");

-- CreateIndex
CREATE INDEX "JournalCatalogRecord_scopeTenantKey_sourceYear_sjrBestQuart_idx" ON "JournalCatalogRecord"("scopeTenantKey", "sourceYear", "sjrBestQuartile");

-- CreateIndex
CREATE INDEX "JournalCatalogRecord_scopeTenantKey_sourceYear_issnPrimary_idx" ON "JournalCatalogRecord"("scopeTenantKey", "sourceYear", "issnPrimary");

-- CreateIndex
CREATE INDEX "JournalCatalogRecord_scopeTenantKey_sourceYear_currentIdent_idx" ON "JournalCatalogRecord"("scopeTenantKey", "sourceYear", "currentIdentityKey");

-- CreateIndex
CREATE UNIQUE INDEX "JournalCatalogRecord_scopeTenantKey_sourceYear_currentIdent_key" ON "JournalCatalogRecord"("scopeTenantKey", "sourceYear", "currentIdentityKey");

-- CreateIndex
CREATE INDEX "JournalImportBatch_tenantId_scope_sourceYear_createdAt_idx" ON "JournalImportBatch"("tenantId", "scope", "sourceYear", "createdAt");

-- CreateIndex
CREATE INDEX "JournalImportBatch_scopeTenantKey_sourceYear_status_idx" ON "JournalImportBatch"("scopeTenantKey", "sourceYear", "status");

-- CreateIndex
CREATE INDEX "JournalImportRow_importBatchId_status_idx" ON "JournalImportRow"("importBatchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "JournalImportRow_importBatchId_rowIndex_key" ON "JournalImportRow"("importBatchId", "rowIndex");

-- AddForeignKey
ALTER TABLE "JournalCatalogRecord" ADD CONSTRAINT "JournalCatalogRecord_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalCatalogRecord" ADD CONSTRAINT "JournalCatalogRecord_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "JournalImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalCatalogRecord" ADD CONSTRAINT "JournalCatalogRecord_overriddenGlobalRecordId_fkey" FOREIGN KEY ("overriddenGlobalRecordId") REFERENCES "JournalCatalogRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalCatalogRecord" ADD CONSTRAINT "JournalCatalogRecord_supersededByBatchId_fkey" FOREIGN KEY ("supersededByBatchId") REFERENCES "JournalImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalImportBatch" ADD CONSTRAINT "JournalImportBatch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalImportRow" ADD CONSTRAINT "JournalImportRow_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "JournalImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
