-- CreateEnum
CREATE TYPE "AccreditationTemplateLifecycleStatus" AS ENUM ('DRAFT', 'VALIDATED', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CriterionBlockType" AS ENUM ('GROUP', 'METRIC', 'QUALITATIVE', 'COMPOSITE');

-- AlterTable
ALTER TABLE "AccreditationBodyVersion" ADD COLUMN     "lifecycleStatus" "AccreditationTemplateLifecycleStatus" NOT NULL DEFAULT 'PUBLISHED',
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "publishedByUserId" TEXT,
ADD COLUMN     "sourceVersionId" TEXT,
ADD COLUMN     "supersededAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CriterionBlock" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "parentId" TEXT,
    "blockCode" TEXT NOT NULL,
    "blockType" "CriterionBlockType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dataType" "CriterionDataType" NOT NULL DEFAULT 'QUANTITATIVE',
    "yearAggregation" "CriterionYearAggregation" NOT NULL DEFAULT 'AVERAGE',
    "yearAggregationConfig" JSONB,
    "maxScore" DOUBLE PRECISION,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "unitOfMeasure" TEXT,
    "inputSchema" JSONB,
    "outputSchema" JSONB,
    "calculationRule" JSONB,
    "scoringRule" JSONB,
    "validationRules" JSONB,
    "evidenceSchema" JSONB,
    "dependencyRules" JSONB,
    "sourceLinks" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CriterionBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CriterionBlock_versionId_parentId_sortOrder_idx" ON "CriterionBlock"("versionId", "parentId", "sortOrder");

-- CreateIndex
CREATE INDEX "CriterionBlock_versionId_depth_idx" ON "CriterionBlock"("versionId", "depth");

-- CreateIndex
CREATE UNIQUE INDEX "CriterionBlock_versionId_blockCode_key" ON "CriterionBlock"("versionId", "blockCode");

-- CreateIndex
CREATE INDEX "AccreditationBodyVersion_lifecycleStatus_idx" ON "AccreditationBodyVersion"("lifecycleStatus");

-- AddForeignKey
ALTER TABLE "AccreditationBodyVersion" ADD CONSTRAINT "AccreditationBodyVersion_sourceVersionId_fkey" FOREIGN KEY ("sourceVersionId") REFERENCES "AccreditationBodyVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CriterionBlock" ADD CONSTRAINT "CriterionBlock_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "AccreditationBodyVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CriterionBlock" ADD CONSTRAINT "CriterionBlock_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CriterionBlock"("id") ON DELETE SET NULL ON UPDATE CASCADE;

