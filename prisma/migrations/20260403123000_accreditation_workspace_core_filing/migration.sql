-- CreateEnum
CREATE TYPE "CriterionYearAggregation" AS ENUM ('AVERAGE', 'SUM', 'LATEST', 'MAX', 'WEIGHTED_RECENT');

-- CreateEnum
CREATE TYPE "AssessmentWorkspaceStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'UNDER_REVIEW', 'FROZEN', 'SUBMITTED', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CriterionEntryStatus" AS ENUM ('BLANK', 'IN_PROGRESS', 'COMPLETE', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'APPROVED');

-- CreateEnum
CREATE TYPE "WorkspaceCollaboratorRole" AS ENUM ('COORDINATOR', 'RESPONSIBLE', 'REVIEWER', 'APPROVER', 'VIEWER');

-- CreateEnum
CREATE TYPE "CriterionYearDataSource" AS ENUM ('MANUAL', 'KPI_LINKED', 'EXTERNAL', 'PROJECTED', 'IMPORTED', 'CLONED');

-- AlterTable
ALTER TABLE "AccreditationBodyVersion" ADD COLUMN     "isLocked" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "AccreditationCriterion" ADD COLUMN     "yearAggregation" "CriterionYearAggregation" NOT NULL DEFAULT 'AVERAGE',
ADD COLUMN     "yearAggregationConfig" JSONB;

-- CreateTable
CREATE TABLE "AssessmentWorkspace" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "targetGrade" TEXT,
    "status" "AssessmentWorkspaceStatus" NOT NULL DEFAULT 'DRAFT',
    "overallRawScore" DOUBLE PRECISION,
    "overallConvertedScore" DOUBLE PRECISION,
    "resolvedGrade" TEXT,
    "resolvedOutcome" TEXT,
    "isScoreStale" BOOLEAN NOT NULL DEFAULT true,
    "lastSuccessfulScoreAt" TIMESTAMP(3),
    "lastFrozenSnapshotId" TEXT,
    "frozenAt" TIMESTAMP(3),
    "frozenByUserId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssessmentWorkspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMilestone" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "gatesFreeze" BOOLEAN NOT NULL DEFAULT false,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "completedByUserId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CriterionEntry" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,
    "status" "CriterionEntryStatus" NOT NULL DEFAULT 'BLANK',
    "computedScore" DOUBLE PRECISION,
    "manualOverride" DOUBLE PRECISION,
    "manualOverrideForced" BOOLEAN NOT NULL DEFAULT false,
    "finalScore" DOUBLE PRECISION,
    "remarks" TEXT,
    "lastUpdatedByUserId" TEXT,
    "lastUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CriterionEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CriterionYearData" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "actualValue" DOUBLE PRECISION,
    "textValue" TEXT,
    "dataSource" "CriterionYearDataSource" NOT NULL DEFAULT 'MANUAL',
    "sourceRef" TEXT,
    "remarks" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CriterionYearData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CriterionEvidence" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "docType" TEXT,
    "description" TEXT,
    "tags" TEXT[],
    "latestVersionNumber" INTEGER NOT NULL DEFAULT 0,
    "isFinalMarked" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CriterionEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceVersion" (
    "id" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileSize" INTEGER,
    "fileType" TEXT,
    "remark" TEXT,
    "isFinal" BOOLEAN NOT NULL DEFAULT false,
    "uploadedByUserId" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceEntryLink" (
    "id" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "linkedByUserId" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceEntryLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceCollaborator" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "WorkspaceCollaboratorRole" NOT NULL,
    "assignedSections" TEXT[],
    "addedByUserId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceCollaborator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CriterionEntryChange" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "year" INTEGER,
    "fieldChanged" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "changeMeta" JSONB,
    "reason" TEXT,
    "changedByUserId" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CriterionEntryChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreSnapshot" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "snapshotName" TEXT,
    "overallRawScore" DOUBLE PRECISION NOT NULL,
    "overallConvertedScore" DOUBLE PRECISION,
    "resolvedGrade" TEXT,
    "resolvedOutcome" TEXT,
    "criterionScores" JSONB NOT NULL,
    "thresholdResult" JSONB,
    "dataSourceSnapshot" JSONB,
    "takenByUserId" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScoreSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssessmentWorkspace_tenantId_status_idx" ON "AssessmentWorkspace"("tenantId", "status");

-- CreateIndex
CREATE INDEX "AssessmentWorkspace_tenantId_versionId_idx" ON "AssessmentWorkspace"("tenantId", "versionId");

-- CreateIndex
CREATE INDEX "AssessmentWorkspace_tenantId_profileId_idx" ON "AssessmentWorkspace"("tenantId", "profileId");

-- CreateIndex
CREATE INDEX "WorkspaceMilestone_workspaceId_sortOrder_idx" ON "WorkspaceMilestone"("workspaceId", "sortOrder");

-- CreateIndex
CREATE INDEX "WorkspaceMilestone_workspaceId_dueDate_idx" ON "WorkspaceMilestone"("workspaceId", "dueDate");

-- CreateIndex
CREATE INDEX "CriterionEntry_workspaceId_idx" ON "CriterionEntry"("workspaceId");

-- CreateIndex
CREATE INDEX "CriterionEntry_workspaceId_status_idx" ON "CriterionEntry"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CriterionEntry_workspaceId_criterionId_key" ON "CriterionEntry"("workspaceId", "criterionId");

-- CreateIndex
CREATE INDEX "CriterionYearData_entryId_idx" ON "CriterionYearData"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "CriterionYearData_entryId_year_key" ON "CriterionYearData"("entryId", "year");

-- CreateIndex
CREATE INDEX "CriterionEvidence_workspaceId_idx" ON "CriterionEvidence"("workspaceId");

-- CreateIndex
CREATE INDEX "CriterionEvidence_workspaceId_docType_idx" ON "CriterionEvidence"("workspaceId", "docType");

-- CreateIndex
CREATE INDEX "EvidenceVersion_evidenceId_uploadedAt_idx" ON "EvidenceVersion"("evidenceId", "uploadedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceVersion_evidenceId_versionNumber_key" ON "EvidenceVersion"("evidenceId", "versionNumber");

-- CreateIndex
CREATE INDEX "EvidenceEntryLink_entryId_idx" ON "EvidenceEntryLink"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceEntryLink_evidenceId_entryId_key" ON "EvidenceEntryLink"("evidenceId", "entryId");

-- CreateIndex
CREATE INDEX "WorkspaceCollaborator_workspaceId_idx" ON "WorkspaceCollaborator"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceCollaborator_workspaceId_userId_key" ON "WorkspaceCollaborator"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "CriterionEntryChange_entryId_changedAt_idx" ON "CriterionEntryChange"("entryId", "changedAt");

-- CreateIndex
CREATE INDEX "ScoreSnapshot_workspaceId_takenAt_idx" ON "ScoreSnapshot"("workspaceId", "takenAt");

-- AddForeignKey
ALTER TABLE "AssessmentWorkspace" ADD CONSTRAINT "AssessmentWorkspace_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentWorkspace" ADD CONSTRAINT "AssessmentWorkspace_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "AccreditationBodyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentWorkspace" ADD CONSTRAINT "AssessmentWorkspace_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "AccreditationProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMilestone" ADD CONSTRAINT "WorkspaceMilestone_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "AssessmentWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CriterionEntry" ADD CONSTRAINT "CriterionEntry_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "AssessmentWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CriterionEntry" ADD CONSTRAINT "CriterionEntry_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "AccreditationCriterion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CriterionYearData" ADD CONSTRAINT "CriterionYearData_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "CriterionEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CriterionEvidence" ADD CONSTRAINT "CriterionEvidence_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "AssessmentWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceVersion" ADD CONSTRAINT "EvidenceVersion_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "CriterionEvidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceEntryLink" ADD CONSTRAINT "EvidenceEntryLink_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "CriterionEvidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceEntryLink" ADD CONSTRAINT "EvidenceEntryLink_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "CriterionEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceCollaborator" ADD CONSTRAINT "WorkspaceCollaborator_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "AssessmentWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceCollaborator" ADD CONSTRAINT "WorkspaceCollaborator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CriterionEntryChange" ADD CONSTRAINT "CriterionEntryChange_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "CriterionEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreSnapshot" ADD CONSTRAINT "ScoreSnapshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "AssessmentWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

