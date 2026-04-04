-- CreateEnum
CREATE TYPE "DataSourceKind" AS ENUM ('MANUAL', 'CSV_IMPORT', 'INTERNAL_ADAPTER', 'DOCUMENT', 'NARRATIVE');

-- CreateEnum
CREATE TYPE "DataSourceShape" AS ENUM ('SCALAR', 'DATASET', 'NARRATIVE', 'DOCUMENT_REF');

-- CreateEnum
CREATE TYPE "DataBankMetricShape" AS ENUM ('SCALAR', 'DATASET', 'COMPUTED', 'NARRATIVE', 'DOCUMENT_REF');

-- CreateEnum
CREATE TYPE "DataBankValueMaturity" AS ENUM ('UNKNOWN', 'ESTIMATED', 'REPORTED', 'VERIFIED', 'EVIDENCE_BACKED');

-- CreateEnum
CREATE TYPE "DataBankCoverageStatus" AS ENUM ('NONE', 'PARTIAL', 'COMPLETE', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "DataBankSnapshotEntryMode" AS ENUM ('MANUAL_ENTRY', 'BULK_IMPORT', 'ADAPTER_REFRESH', 'DERIVED_COPY');

-- CreateEnum
CREATE TYPE "MetricSourceResolutionMode" AS ENUM ('DIRECT', 'PICK_FIELD', 'COUNT_ROWS', 'SUM_COLUMN', 'AVG_COLUMN', 'MAX_COLUMN', 'MIN_COLUMN', 'FIRST_NON_NULL', 'CUSTOM_FORMULA');

-- CreateEnum
CREATE TYPE "RefreshSuggestionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'AUTO_APPLIED');

-- AlterTable
ALTER TABLE "SourceMetricDefinition" ADD COLUMN     "computeConfig" JSONB,
ADD COLUMN     "datasetSchema" JSONB,
ADD COLUMN     "domainId" TEXT,
ADD COLUMN     "helpText" TEXT,
ADD COLUMN     "isRequiredHint" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isSystemDefined" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "precision" INTEGER,
ADD COLUMN     "shape" "DataBankMetricShape" NOT NULL DEFAULT 'SCALAR',
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "supportsScopeBreakdown" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "supportsYearWise" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "usedByBodyCodes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "SourceMetricObservation" ADD COLUMN     "confidenceNote" TEXT,
ADD COLUMN     "coveragePercent" DOUBLE PRECISION,
ADD COLUMN     "coverageStatus" "DataBankCoverageStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "evidenceMeta" JSONB,
ADD COLUMN     "isStale" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastRefreshedAt" TIMESTAMP(3),
ADD COLUMN     "maturity" "DataBankValueMaturity" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "refreshBlockedReason" TEXT,
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedByUserId" TEXT;

-- CreateTable
CREATE TABLE "DataBankDomain" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isSystemDefined" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataBankDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataBankSourceDefinition" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "domainId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" "DataSourceKind" NOT NULL,
    "shape" "DataSourceShape" NOT NULL,
    "datasetSchema" JSONB,
    "adapterKey" TEXT,
    "adapterConfig" JSONB,
    "supportsYearWise" BOOLEAN NOT NULL DEFAULT true,
    "supportsScopeBreakdown" BOOLEAN NOT NULL DEFAULT false,
    "isSystemDefined" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataBankSourceDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataBankSourceSnapshot" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "observedYear" INTEGER,
    "scopeKey" TEXT NOT NULL DEFAULT 'INSTITUTION',
    "dimensions" JSONB,
    "dimensionFingerprint" TEXT NOT NULL DEFAULT '__NONE__',
    "numberValue" DOUBLE PRECISION,
    "textValue" TEXT,
    "jsonValue" JSONB,
    "maturity" "DataBankValueMaturity" NOT NULL DEFAULT 'UNKNOWN',
    "coverageStatus" "DataBankCoverageStatus" NOT NULL DEFAULT 'NONE',
    "coveragePercent" DOUBLE PRECISION,
    "confidenceNote" TEXT,
    "sourceRevisionHash" TEXT,
    "sourceRef" TEXT,
    "entryMode" "DataBankSnapshotEntryMode",
    "enteredByUserId" TEXT,
    "enteredAt" TIMESTAMP(3),
    "verifiedByUserId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "evidenceMeta" JSONB,
    "lastRefreshedAt" TIMESTAMP(3),
    "isStale" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataBankSourceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataBankSourceDatasetRow" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "rowKey" TEXT,
    "rowData" JSONB NOT NULL,
    "sourceRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataBankSourceDatasetRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricSourceLink" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "metricId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "precedence" INTEGER NOT NULL DEFAULT 100,
    "resolutionMode" "MetricSourceResolutionMode" NOT NULL,
    "transformConfig" JSONB,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "autoApplyWhenUnknown" BOOLEAN NOT NULL DEFAULT true,
    "createSuggestionOnConflict" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetricSourceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricRefreshSuggestion" (
    "id" TEXT NOT NULL,
    "metricObservationId" TEXT NOT NULL,
    "metricSourceLinkId" TEXT,
    "status" "RefreshSuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "candidateNumberValue" DOUBLE PRECISION,
    "candidateTextValue" TEXT,
    "candidateJsonValue" JSONB,
    "candidateMaturity" "DataBankValueMaturity" NOT NULL DEFAULT 'REPORTED',
    "candidateCoverageStatus" "DataBankCoverageStatus",
    "candidateCoveragePercent" DOUBLE PRECISION,
    "sourceRevisionHash" TEXT,
    "sourceRef" TEXT,
    "note" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,

    CONSTRAINT "MetricRefreshSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DataBankDomain_tenantId_isActive_sortOrder_idx" ON "DataBankDomain"("tenantId", "isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "DataBankDomain_tenantId_code_key" ON "DataBankDomain"("tenantId", "code");

-- CreateIndex
CREATE INDEX "DataBankSourceDefinition_tenantId_isActive_sortOrder_idx" ON "DataBankSourceDefinition"("tenantId", "isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "DataBankSourceDefinition_tenantId_domainId_isActive_idx" ON "DataBankSourceDefinition"("tenantId", "domainId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "DataBankSourceDefinition_tenantId_code_key" ON "DataBankSourceDefinition"("tenantId", "code");

-- CreateIndex
CREATE INDEX "DataBankSourceSnapshot_sourceId_observedYear_idx" ON "DataBankSourceSnapshot"("sourceId", "observedYear");

-- CreateIndex
CREATE INDEX "DataBankSourceSnapshot_sourceId_isStale_idx" ON "DataBankSourceSnapshot"("sourceId", "isStale");

-- CreateIndex
CREATE UNIQUE INDEX "DataBankSourceSnapshot_sourceId_scopeKey_dimensionFingerpri_key" ON "DataBankSourceSnapshot"("sourceId", "scopeKey", "dimensionFingerprint");

-- CreateIndex
CREATE INDEX "DataBankSourceDatasetRow_snapshotId_rowKey_idx" ON "DataBankSourceDatasetRow"("snapshotId", "rowKey");

-- CreateIndex
CREATE UNIQUE INDEX "DataBankSourceDatasetRow_snapshotId_rowIndex_key" ON "DataBankSourceDatasetRow"("snapshotId", "rowIndex");

-- CreateIndex
CREATE INDEX "MetricSourceLink_tenantId_metricId_isActive_precedence_idx" ON "MetricSourceLink"("tenantId", "metricId", "isActive", "precedence");

-- CreateIndex
CREATE INDEX "MetricSourceLink_tenantId_sourceId_isActive_precedence_idx" ON "MetricSourceLink"("tenantId", "sourceId", "isActive", "precedence");

-- CreateIndex
CREATE UNIQUE INDEX "MetricSourceLink_metricId_sourceId_key" ON "MetricSourceLink"("metricId", "sourceId");

-- CreateIndex
CREATE INDEX "MetricRefreshSuggestion_metricObservationId_status_idx" ON "MetricRefreshSuggestion"("metricObservationId", "status");

-- CreateIndex
CREATE INDEX "MetricRefreshSuggestion_metricSourceLinkId_status_idx" ON "MetricRefreshSuggestion"("metricSourceLinkId", "status");

-- CreateIndex
CREATE INDEX "SourceMetricDefinition_tenantId_domainId_isActive_sortOrder_idx" ON "SourceMetricDefinition"("tenantId", "domainId", "isActive", "sortOrder");

-- AddForeignKey
ALTER TABLE "DataBankDomain" ADD CONSTRAINT "DataBankDomain_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataBankSourceDefinition" ADD CONSTRAINT "DataBankSourceDefinition_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataBankSourceDefinition" ADD CONSTRAINT "DataBankSourceDefinition_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "DataBankDomain"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataBankSourceSnapshot" ADD CONSTRAINT "DataBankSourceSnapshot_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "DataBankSourceDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataBankSourceDatasetRow" ADD CONSTRAINT "DataBankSourceDatasetRow_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "DataBankSourceSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceMetricDefinition" ADD CONSTRAINT "SourceMetricDefinition_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "DataBankDomain"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricSourceLink" ADD CONSTRAINT "MetricSourceLink_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricSourceLink" ADD CONSTRAINT "MetricSourceLink_metricId_fkey" FOREIGN KEY ("metricId") REFERENCES "SourceMetricDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricSourceLink" ADD CONSTRAINT "MetricSourceLink_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "DataBankSourceDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricRefreshSuggestion" ADD CONSTRAINT "MetricRefreshSuggestion_metricObservationId_fkey" FOREIGN KEY ("metricObservationId") REFERENCES "SourceMetricObservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricRefreshSuggestion" ADD CONSTRAINT "MetricRefreshSuggestion_metricSourceLinkId_fkey" FOREIGN KEY ("metricSourceLinkId") REFERENCES "MetricSourceLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

