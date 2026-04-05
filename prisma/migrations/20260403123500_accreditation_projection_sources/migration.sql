-- CreateEnum
CREATE TYPE "SourceMetricValueType" AS ENUM ('NUMBER', 'TEXT', 'JSON');

-- CreateEnum
CREATE TYPE "ProjectionSourceKind" AS ENUM ('WORKSPACE_ENTRY', 'SOURCE_METRIC', 'ENTRY_TABLE', 'INSTITUTIONAL_DATA_BANK');

-- CreateEnum
CREATE TYPE "ProjectionStorageMode" AS ENUM ('COPY', 'LIVE_REFERENCE');

-- CreateEnum
CREATE TYPE "ProjectionRunType" AS ENUM ('PREVIEW', 'APPLY', 'REFRESH', 'DETACH');

-- CreateEnum
CREATE TYPE "ProjectionRunStatus" AS ENUM ('SUCCESS', 'ERROR');

-- CreateTable
CREATE TABLE "CriterionEntryTableInstance" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "year" INTEGER,
    "scopeKey" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "fieldLabel" TEXT,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CriterionEntryTableInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CriterionEntryTableRow" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "rowKey" TEXT,
    "dimensions" JSONB,
    "dimensionFingerprint" TEXT NOT NULL DEFAULT '__NONE__',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CriterionEntryTableRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CriterionEntryTableCell" (
    "id" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "columnKey" TEXT NOT NULL,
    "numberValue" DOUBLE PRECISION,
    "textValue" TEXT,
    "booleanValue" BOOLEAN,
    "dateValue" TIMESTAMP(3),
    "jsonValue" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CriterionEntryTableCell_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceMetricDefinition" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "valueType" "SourceMetricValueType" NOT NULL DEFAULT 'NUMBER',
    "unitOfMeasure" TEXT,
    "allowedDimensions" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceMetricDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceMetricObservation" (
    "id" TEXT NOT NULL,
    "metricId" TEXT NOT NULL,
    "observedYear" INTEGER,
    "scopeKey" TEXT NOT NULL DEFAULT 'STATIC',
    "dimensions" JSONB,
    "dimensionFingerprint" TEXT NOT NULL DEFAULT '__NONE__',
    "numberValue" DOUBLE PRECISION,
    "textValue" TEXT,
    "jsonValue" JSONB,
    "sourceType" TEXT NOT NULL DEFAULT 'MANUAL',
    "sourceRef" TEXT,
    "sourceRevisionHash" TEXT,
    "recordedByUserId" TEXT,
    "recordedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceMetricObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlockProjectionRecipe" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "targetWorkspaceId" TEXT NOT NULL,
    "targetEntryId" TEXT NOT NULL,
    "sourceKind" "ProjectionSourceKind" NOT NULL,
    "sourceWorkspaceId" TEXT,
    "sourceEntryId" TEXT,
    "sourceMetricId" TEXT,
    "sourceTableInstanceId" TEXT,
    "sourceTableFieldKey" TEXT,
    "sourcePath" TEXT,
    "filters" JSONB,
    "transform" JSONB,
    "storageMode" "ProjectionStorageMode" NOT NULL DEFAULT 'COPY',
    "targetPath" TEXT NOT NULL DEFAULT 'actualValue',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSourceRevisionHash" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlockProjectionRecipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlockProjectionRun" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "runType" "ProjectionRunType" NOT NULL,
    "status" "ProjectionRunStatus" NOT NULL,
    "previewSummary" JSONB,
    "appliedCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "sourceRevisionHash" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlockProjectionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlockProjectionTarget" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "targetEntryId" TEXT NOT NULL,
    "targetYear" INTEGER,
    "targetScopeKey" TEXT NOT NULL,
    "targetPath" TEXT NOT NULL,
    "sourceYear" INTEGER,
    "sourceScopeKey" TEXT,
    "sourceRevisionHash" TEXT,
    "materializedNumberValue" DOUBLE PRECISION,
    "materializedTextValue" TEXT,
    "importedByUserId" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlockProjectionTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CriterionEntryTableInstance_entryId_year_idx" ON "CriterionEntryTableInstance"("entryId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "CriterionEntryTableInstance_entryId_scopeKey_fieldKey_key" ON "CriterionEntryTableInstance"("entryId", "scopeKey", "fieldKey");

-- CreateIndex
CREATE INDEX "CriterionEntryTableRow_instanceId_dimensionFingerprint_idx" ON "CriterionEntryTableRow"("instanceId", "dimensionFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "CriterionEntryTableRow_instanceId_rowIndex_key" ON "CriterionEntryTableRow"("instanceId", "rowIndex");

-- CreateIndex
CREATE UNIQUE INDEX "CriterionEntryTableCell_rowId_columnKey_key" ON "CriterionEntryTableCell"("rowId", "columnKey");

-- CreateIndex
CREATE INDEX "SourceMetricDefinition_tenantId_isActive_idx" ON "SourceMetricDefinition"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "SourceMetricDefinition_tenantId_code_key" ON "SourceMetricDefinition"("tenantId", "code");

-- CreateIndex
CREATE INDEX "SourceMetricObservation_metricId_observedYear_idx" ON "SourceMetricObservation"("metricId", "observedYear");

-- CreateIndex
CREATE INDEX "SourceMetricObservation_metricId_dimensionFingerprint_idx" ON "SourceMetricObservation"("metricId", "dimensionFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "SourceMetricObservation_metricId_scopeKey_dimensionFingerpr_key" ON "SourceMetricObservation"("metricId", "scopeKey", "dimensionFingerprint");

-- CreateIndex
CREATE INDEX "BlockProjectionRecipe_tenantId_targetWorkspaceId_isActive_idx" ON "BlockProjectionRecipe"("tenantId", "targetWorkspaceId", "isActive");

-- CreateIndex
CREATE INDEX "BlockProjectionRecipe_tenantId_targetEntryId_isActive_idx" ON "BlockProjectionRecipe"("tenantId", "targetEntryId", "isActive");

-- CreateIndex
CREATE INDEX "BlockProjectionRecipe_sourceWorkspaceId_idx" ON "BlockProjectionRecipe"("sourceWorkspaceId");

-- CreateIndex
CREATE INDEX "BlockProjectionRecipe_sourceEntryId_idx" ON "BlockProjectionRecipe"("sourceEntryId");

-- CreateIndex
CREATE INDEX "BlockProjectionRecipe_sourceMetricId_idx" ON "BlockProjectionRecipe"("sourceMetricId");

-- CreateIndex
CREATE INDEX "BlockProjectionRun_recipeId_createdAt_idx" ON "BlockProjectionRun"("recipeId", "createdAt");

-- CreateIndex
CREATE INDEX "BlockProjectionTarget_targetEntryId_importedAt_idx" ON "BlockProjectionTarget"("targetEntryId", "importedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BlockProjectionTarget_recipeId_targetEntryId_targetScopeKey_key" ON "BlockProjectionTarget"("recipeId", "targetEntryId", "targetScopeKey", "targetPath");

-- AddForeignKey
ALTER TABLE "CriterionEntryTableInstance" ADD CONSTRAINT "CriterionEntryTableInstance_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "CriterionEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CriterionEntryTableRow" ADD CONSTRAINT "CriterionEntryTableRow_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "CriterionEntryTableInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CriterionEntryTableCell" ADD CONSTRAINT "CriterionEntryTableCell_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "CriterionEntryTableRow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceMetricDefinition" ADD CONSTRAINT "SourceMetricDefinition_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceMetricObservation" ADD CONSTRAINT "SourceMetricObservation_metricId_fkey" FOREIGN KEY ("metricId") REFERENCES "SourceMetricDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockProjectionRecipe" ADD CONSTRAINT "BlockProjectionRecipe_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockProjectionRecipe" ADD CONSTRAINT "BlockProjectionRecipe_targetWorkspaceId_fkey" FOREIGN KEY ("targetWorkspaceId") REFERENCES "AssessmentWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockProjectionRecipe" ADD CONSTRAINT "BlockProjectionRecipe_targetEntryId_fkey" FOREIGN KEY ("targetEntryId") REFERENCES "CriterionEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockProjectionRecipe" ADD CONSTRAINT "BlockProjectionRecipe_sourceWorkspaceId_fkey" FOREIGN KEY ("sourceWorkspaceId") REFERENCES "AssessmentWorkspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockProjectionRecipe" ADD CONSTRAINT "BlockProjectionRecipe_sourceEntryId_fkey" FOREIGN KEY ("sourceEntryId") REFERENCES "CriterionEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockProjectionRecipe" ADD CONSTRAINT "BlockProjectionRecipe_sourceMetricId_fkey" FOREIGN KEY ("sourceMetricId") REFERENCES "SourceMetricDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockProjectionRecipe" ADD CONSTRAINT "BlockProjectionRecipe_sourceTableInstanceId_fkey" FOREIGN KEY ("sourceTableInstanceId") REFERENCES "CriterionEntryTableInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockProjectionRun" ADD CONSTRAINT "BlockProjectionRun_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "BlockProjectionRecipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockProjectionTarget" ADD CONSTRAINT "BlockProjectionTarget_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "BlockProjectionRecipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockProjectionTarget" ADD CONSTRAINT "BlockProjectionTarget_targetEntryId_fkey" FOREIGN KEY ("targetEntryId") REFERENCES "CriterionEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
