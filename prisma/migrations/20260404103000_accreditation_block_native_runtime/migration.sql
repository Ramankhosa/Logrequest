DO $$
BEGIN
  CREATE TYPE "CriterionBlockVisibility" AS ENUM (
    'VISIBLE_INPUT',
    'VISIBLE_READONLY',
    'HIDDEN_CALCULATION'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "AccreditationBodyVersion"
  ADD COLUMN IF NOT EXISTS "engineVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "CriterionBlock"
  ADD COLUMN IF NOT EXISTS "criterionCode" TEXT,
  ADD COLUMN IF NOT EXISTS "lineageKey" TEXT,
  ADD COLUMN IF NOT EXISTS "visibility" "CriterionBlockVisibility" NOT NULL DEFAULT 'VISIBLE_INPUT',
  ADD COLUMN IF NOT EXISTS "contributesToTotal" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "isSectionRoot" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "expectedEvidence" JSONB,
  ADD COLUMN IF NOT EXISTS "isLeaf" BOOLEAN NOT NULL DEFAULT false;

UPDATE "CriterionBlock"
SET
  "criterionCode" = COALESCE(NULLIF("criterionCode", ''), "blockCode"),
  "lineageKey" = COALESCE(NULLIF("lineageKey", ''), "blockCode"),
  "expectedEvidence" = COALESCE("expectedEvidence", "evidenceSchema"),
  "isLeaf" = CASE
    WHEN "blockType" IN ('METRIC', 'QUALITATIVE') THEN true
    ELSE false
  END,
  "isSectionRoot" = CASE
    WHEN "depth" = 0 THEN true
    ELSE "isSectionRoot"
  END;

ALTER TABLE "CriterionBlock"
  ALTER COLUMN "criterionCode" SET NOT NULL;

INSERT INTO "CriterionBlock" (
  "id",
  "versionId",
  "parentId",
  "blockCode",
  "criterionCode",
  "lineageKey",
  "blockType",
  "visibility",
  "contributesToTotal",
  "isSectionRoot",
  "title",
  "description",
  "dataType",
  "yearAggregation",
  "yearAggregationConfig",
  "maxScore",
  "sortOrder",
  "depth",
  "unitOfMeasure",
  "validationRules",
  "evidenceSchema",
  "expectedEvidence",
  "isLeaf",
  "isActive",
  "createdAt",
  "updatedAt"
)
SELECT
  c."id",
  c."versionId",
  c."parentId",
  c."criterionCode",
  c."criterionCode",
  c."criterionCode",
  CASE
    WHEN c."isLeaf" = true AND c."dataType" = 'QUALITATIVE' THEN 'QUALITATIVE'::"CriterionBlockType"
    WHEN c."isLeaf" = true THEN 'METRIC'::"CriterionBlockType"
    ELSE 'GROUP'::"CriterionBlockType"
  END,
  'VISIBLE_INPUT'::"CriterionBlockVisibility",
  true,
  CASE WHEN c."depth" = 0 THEN true ELSE false END,
  c."title",
  c."description",
  c."dataType",
  c."yearAggregation",
  c."yearAggregationConfig",
  c."maxScore",
  c."sortOrder",
  c."depth",
  c."unitOfMeasure",
  c."validationRules",
  c."expectedEvidence",
  c."expectedEvidence",
  c."isLeaf",
  c."isActive",
  c."createdAt",
  c."updatedAt"
FROM "AccreditationCriterion" c
LEFT JOIN "CriterionBlock" b
  ON b."versionId" = c."versionId"
 AND b."criterionCode" = c."criterionCode"
WHERE b."id" IS NULL;

UPDATE "AccreditationProfileWeight" apw
SET "criterionId" = b."id"
FROM "AccreditationCriterion" c
JOIN "CriterionBlock" b
  ON b."versionId" = c."versionId"
 AND b."criterionCode" = c."criterionCode"
WHERE apw."criterionId" = c."id"
  AND apw."criterionId" <> b."id";

UPDATE "AccreditationScoringSlab" ass
SET "criterionId" = b."id"
FROM "AccreditationCriterion" c
JOIN "CriterionBlock" b
  ON b."versionId" = c."versionId"
 AND b."criterionCode" = c."criterionCode"
WHERE ass."criterionId" = c."id"
  AND ass."criterionId" <> b."id";

UPDATE "AccreditationThresholdRule" atr
SET "criterionId" = b."id"
FROM "AccreditationCriterion" c
JOIN "CriterionBlock" b
  ON b."versionId" = c."versionId"
 AND b."criterionCode" = c."criterionCode"
WHERE atr."criterionId" = c."id"
  AND atr."criterionId" <> b."id";

UPDATE "CriterionEntry" ce
SET "criterionId" = b."id"
FROM "AccreditationCriterion" c
JOIN "CriterionBlock" b
  ON b."versionId" = c."versionId"
 AND b."criterionCode" = c."criterionCode"
WHERE ce."criterionId" = c."id"
  AND ce."criterionId" <> b."id";

UPDATE "WorkspaceSectionAssignment" wsa
SET "sectionCriterionId" = b."id"
FROM "AccreditationCriterion" c
JOIN "CriterionBlock" b
  ON b."versionId" = c."versionId"
 AND b."criterionCode" = c."criterionCode"
WHERE wsa."sectionCriterionId" = c."id"
  AND wsa."sectionCriterionId" <> b."id";

UPDATE "WorkspaceSectionReview" wsr
SET "sectionCriterionId" = b."id"
FROM "AccreditationCriterion" c
JOIN "CriterionBlock" b
  ON b."versionId" = c."versionId"
 AND b."criterionCode" = c."criterionCode"
WHERE wsr."sectionCriterionId" = c."id"
  AND wsr."sectionCriterionId" <> b."id";

UPDATE "WorkspaceDiscussionThread" wdt
SET "sectionCriterionId" = b."id"
FROM "AccreditationCriterion" c
JOIN "CriterionBlock" b
  ON b."versionId" = c."versionId"
 AND b."criterionCode" = c."criterionCode"
WHERE wdt."sectionCriterionId" = c."id"
  AND wdt."sectionCriterionId" <> b."id";

UPDATE "WorkspaceGuestInvite" wgi
SET "sectionCriterionId" = b."id"
FROM "AccreditationCriterion" c
JOIN "CriterionBlock" b
  ON b."versionId" = c."versionId"
 AND b."criterionCode" = c."criterionCode"
WHERE wgi."sectionCriterionId" = c."id"
  AND wgi."sectionCriterionId" <> b."id";

UPDATE "KpiAccreditationCriterionLink" kacl
SET "criterionId" = b."id"
FROM "AccreditationCriterion" c
JOIN "CriterionBlock" b
  ON b."versionId" = c."versionId"
 AND b."criterionCode" = c."criterionCode"
WHERE kacl."criterionId" = c."id"
  AND kacl."criterionId" <> b."id";

UPDATE "ScoreSnapshot" s
SET "criterionScores" = remapped."mapped"
FROM (
  SELECT
    snapshot."id",
    jsonb_object_agg(COALESCE(block."id", item.key), item.value) AS "mapped"
  FROM "ScoreSnapshot" snapshot
  CROSS JOIN LATERAL jsonb_each(snapshot."criterionScores") AS item(key, value)
  LEFT JOIN "AccreditationCriterion" legacy
    ON legacy."id" = item.key
  LEFT JOIN "CriterionBlock" block
    ON block."versionId" = legacy."versionId"
   AND block."criterionCode" = legacy."criterionCode"
  GROUP BY snapshot."id"
) remapped
WHERE s."id" = remapped."id";

DROP INDEX IF EXISTS "CriterionBlock_versionId_criterionCode_key";
CREATE UNIQUE INDEX IF NOT EXISTS "CriterionBlock_versionId_criterionCode_key"
  ON "CriterionBlock"("versionId", "criterionCode");

CREATE INDEX IF NOT EXISTS "CriterionBlock_versionId_lineageKey_idx"
  ON "CriterionBlock"("versionId", "lineageKey");

ALTER TABLE "AccreditationProfileWeight"
  DROP CONSTRAINT IF EXISTS "AccreditationProfileWeight_criterionId_fkey",
  ADD CONSTRAINT "AccreditationProfileWeight_criterionId_fkey"
    FOREIGN KEY ("criterionId") REFERENCES "CriterionBlock"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AccreditationScoringSlab"
  DROP CONSTRAINT IF EXISTS "AccreditationScoringSlab_criterionId_fkey",
  ADD CONSTRAINT "AccreditationScoringSlab_criterionId_fkey"
    FOREIGN KEY ("criterionId") REFERENCES "CriterionBlock"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AccreditationThresholdRule"
  DROP CONSTRAINT IF EXISTS "AccreditationThresholdRule_criterionId_fkey",
  ADD CONSTRAINT "AccreditationThresholdRule_criterionId_fkey"
    FOREIGN KEY ("criterionId") REFERENCES "CriterionBlock"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CriterionEntry"
  DROP CONSTRAINT IF EXISTS "CriterionEntry_criterionId_fkey",
  ADD CONSTRAINT "CriterionEntry_criterionId_fkey"
    FOREIGN KEY ("criterionId") REFERENCES "CriterionBlock"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkspaceSectionAssignment"
  DROP CONSTRAINT IF EXISTS "WorkspaceSectionAssignment_sectionCriterionId_fkey",
  ADD CONSTRAINT "WorkspaceSectionAssignment_sectionCriterionId_fkey"
    FOREIGN KEY ("sectionCriterionId") REFERENCES "CriterionBlock"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkspaceSectionReview"
  DROP CONSTRAINT IF EXISTS "WorkspaceSectionReview_sectionCriterionId_fkey",
  ADD CONSTRAINT "WorkspaceSectionReview_sectionCriterionId_fkey"
    FOREIGN KEY ("sectionCriterionId") REFERENCES "CriterionBlock"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkspaceDiscussionThread"
  DROP CONSTRAINT IF EXISTS "WorkspaceDiscussionThread_sectionCriterionId_fkey",
  ADD CONSTRAINT "WorkspaceDiscussionThread_sectionCriterionId_fkey"
    FOREIGN KEY ("sectionCriterionId") REFERENCES "CriterionBlock"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkspaceGuestInvite"
  DROP CONSTRAINT IF EXISTS "WorkspaceGuestInvite_sectionCriterionId_fkey",
  ADD CONSTRAINT "WorkspaceGuestInvite_sectionCriterionId_fkey"
    FOREIGN KEY ("sectionCriterionId") REFERENCES "CriterionBlock"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "KpiAccreditationCriterionLink"
  DROP CONSTRAINT IF EXISTS "KpiAccreditationCriterionLink_criterionId_fkey",
  ADD CONSTRAINT "KpiAccreditationCriterionLink_criterionId_fkey"
    FOREIGN KEY ("criterionId") REFERENCES "CriterionBlock"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'CriterionEntryStatus'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'BlockEntryStatus'
  ) THEN
    ALTER TYPE "CriterionEntryStatus" RENAME TO "BlockEntryStatus";
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'CriterionYearDataSource'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'BlockEntryValueSource'
  ) THEN
    ALTER TYPE "CriterionYearDataSource" RENAME TO "BlockEntryValueSource";
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'CriterionEntry'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'BlockEntry'
  ) THEN
    ALTER TABLE "CriterionEntry" RENAME TO "BlockEntry";
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'CriterionEvidence'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'BlockEvidence'
  ) THEN
    ALTER TABLE "CriterionEvidence" RENAME TO "BlockEvidence";
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'CriterionEntryChange'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'BlockEntryChange'
  ) THEN
    ALTER TABLE "CriterionEntryChange" RENAME TO "BlockEntryChange";
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'CriterionEntryTableInstance'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'BlockEntryTableInstance'
  ) THEN
    ALTER TABLE "CriterionEntryTableInstance" RENAME TO "BlockEntryTableInstance";
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'CriterionEntryTableRow'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'BlockEntryTableRow'
  ) THEN
    ALTER TABLE "CriterionEntryTableRow" RENAME TO "BlockEntryTableRow";
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'CriterionEntryTableCell'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'BlockEntryTableCell'
  ) THEN
    ALTER TABLE "CriterionEntryTableCell" RENAME TO "BlockEntryTableCell";
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'KpiAccreditationCriterionLink'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'KpiAccreditationBlockLink'
  ) THEN
    ALTER TABLE "KpiAccreditationCriterionLink" RENAME TO "KpiAccreditationBlockLink";
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'AccreditationProfileWeight'
      AND column_name = 'criterionId'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'AccreditationProfileWeight'
      AND column_name = 'blockId'
  ) THEN
    ALTER TABLE "AccreditationProfileWeight" RENAME COLUMN "criterionId" TO "blockId";
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'AccreditationScoringSlab'
      AND column_name = 'criterionId'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'AccreditationScoringSlab'
      AND column_name = 'blockId'
  ) THEN
    ALTER TABLE "AccreditationScoringSlab" RENAME COLUMN "criterionId" TO "blockId";
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'AccreditationThresholdRule'
      AND column_name = 'criterionId'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'AccreditationThresholdRule'
      AND column_name = 'blockId'
  ) THEN
    ALTER TABLE "AccreditationThresholdRule" RENAME COLUMN "criterionId" TO "blockId";
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'BlockEntry'
      AND column_name = 'criterionId'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'BlockEntry'
      AND column_name = 'blockId'
  ) THEN
    ALTER TABLE "BlockEntry" RENAME COLUMN "criterionId" TO "blockId";
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'WorkspaceSectionAssignment'
      AND column_name = 'sectionCriterionId'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'WorkspaceSectionAssignment'
      AND column_name = 'sectionBlockId'
  ) THEN
    ALTER TABLE "WorkspaceSectionAssignment" RENAME COLUMN "sectionCriterionId" TO "sectionBlockId";
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'WorkspaceSectionReview'
      AND column_name = 'sectionCriterionId'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'WorkspaceSectionReview'
      AND column_name = 'sectionBlockId'
  ) THEN
    ALTER TABLE "WorkspaceSectionReview" RENAME COLUMN "sectionCriterionId" TO "sectionBlockId";
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'WorkspaceDiscussionThread'
      AND column_name = 'sectionCriterionId'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'WorkspaceDiscussionThread'
      AND column_name = 'sectionBlockId'
  ) THEN
    ALTER TABLE "WorkspaceDiscussionThread" RENAME COLUMN "sectionCriterionId" TO "sectionBlockId";
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'WorkspaceGuestInvite'
      AND column_name = 'sectionCriterionId'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'WorkspaceGuestInvite'
      AND column_name = 'sectionBlockId'
  ) THEN
    ALTER TABLE "WorkspaceGuestInvite" RENAME COLUMN "sectionCriterionId" TO "sectionBlockId";
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'KpiAccreditationBlockLink'
      AND column_name = 'criterionId'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'KpiAccreditationBlockLink'
      AND column_name = 'blockId'
  ) THEN
    ALTER TABLE "KpiAccreditationBlockLink" RENAME COLUMN "criterionId" TO "blockId";
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ScoreSnapshot'
      AND column_name = 'criterionScores'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ScoreSnapshot'
      AND column_name = 'blockScores'
  ) THEN
    ALTER TABLE "ScoreSnapshot" RENAME COLUMN "criterionScores" TO "blockScores";
  END IF;
END $$;

DROP INDEX IF EXISTS "CriterionBlock_versionId_criterionCode_key";

ALTER TABLE "CriterionBlock"
  DROP COLUMN IF EXISTS "criterionCode";

ALTER INDEX IF EXISTS "AccreditationProfileWeight_profileId_criterionId_key"
  RENAME TO "AccreditationProfileWeight_profileId_blockId_key";

ALTER INDEX IF EXISTS "AccreditationScoringSlab_criterionId_sortOrder_idx"
  RENAME TO "AccreditationScoringSlab_blockId_sortOrder_idx";

ALTER INDEX IF EXISTS "CriterionEntry_workspaceId_criterionId_key"
  RENAME TO "BlockEntry_workspaceId_blockId_key";

ALTER INDEX IF EXISTS "CriterionEntry_workspaceId_idx"
  RENAME TO "BlockEntry_workspaceId_idx";

ALTER INDEX IF EXISTS "CriterionEntry_workspaceId_status_idx"
  RENAME TO "BlockEntry_workspaceId_status_idx";

ALTER INDEX IF EXISTS "CriterionEntryChange_entryId_changedAt_idx"
  RENAME TO "BlockEntryChange_entryId_changedAt_idx";

ALTER INDEX IF EXISTS "CriterionEvidence_workspaceId_docType_idx"
  RENAME TO "BlockEvidence_workspaceId_docType_idx";

ALTER INDEX IF EXISTS "CriterionEvidence_workspaceId_idx"
  RENAME TO "BlockEvidence_workspaceId_idx";

ALTER INDEX IF EXISTS "KpiAccreditationCriterionLink_kpiDefinitionId_criterionId_key"
  RENAME TO "KpiAccreditationBlockLink_kpiDefinitionId_blockId_key";

ALTER INDEX IF EXISTS "KpiAccreditationCriterionLink_tenantId_criterionId_idx"
  RENAME TO "KpiAccreditationBlockLink_tenantId_blockId_idx";

ALTER INDEX IF EXISTS "KpiAccreditationCriterionLink_tenantId_kpiDefinitionId_idx"
  RENAME TO "KpiAccreditationBlockLink_tenantId_kpiDefinitionId_idx";

ALTER INDEX IF EXISTS "WorkspaceDiscussionThread_workspaceId_sectionCriterionId_idx"
  RENAME TO "WorkspaceDiscussionThread_workspaceId_sectionBlockId_idx";

ALTER INDEX IF EXISTS "WorkspaceSectionAssignment_workspaceId_sectionCriterionId_g_key"
  RENAME TO "WorkspaceSectionAssignment_workspaceId_sectionBlockId_guest_key";

ALTER INDEX IF EXISTS "WorkspaceSectionAssignment_workspaceId_sectionCriterionId_r_idx"
  RENAME TO "WorkspaceSectionAssignment_workspaceId_sectionBlockId_role_idx";

ALTER INDEX IF EXISTS "WorkspaceSectionAssignment_workspaceId_sectionCriterionId_u_key"
  RENAME TO "WorkspaceSectionAssignment_workspaceId_sectionBlockId_userI_key";

ALTER INDEX IF EXISTS "WorkspaceSectionReview_workspaceId_sectionCriterionId_key"
  RENAME TO "WorkspaceSectionReview_workspaceId_sectionBlockId_key";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CriterionEntry_pkey') THEN
    ALTER TABLE "BlockEntry" RENAME CONSTRAINT "CriterionEntry_pkey" TO "BlockEntry_pkey";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CriterionEntryChange_pkey') THEN
    ALTER TABLE "BlockEntryChange" RENAME CONSTRAINT "CriterionEntryChange_pkey" TO "BlockEntryChange_pkey";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CriterionEntryChange_entryId_fkey') THEN
    ALTER TABLE "BlockEntryChange" RENAME CONSTRAINT "CriterionEntryChange_entryId_fkey" TO "BlockEntryChange_entryId_fkey";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CriterionEvidence_pkey') THEN
    ALTER TABLE "BlockEvidence" RENAME CONSTRAINT "CriterionEvidence_pkey" TO "BlockEvidence_pkey";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'KpiAccreditationCriterionLink_pkey') THEN
    ALTER TABLE "KpiAccreditationBlockLink" RENAME CONSTRAINT "KpiAccreditationCriterionLink_pkey" TO "KpiAccreditationBlockLink_pkey";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccreditationProfileWeight_criterionId_fkey') THEN
    ALTER TABLE "AccreditationProfileWeight" RENAME CONSTRAINT "AccreditationProfileWeight_criterionId_fkey" TO "AccreditationProfileWeight_blockId_fkey";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccreditationScoringSlab_criterionId_fkey') THEN
    ALTER TABLE "AccreditationScoringSlab" RENAME CONSTRAINT "AccreditationScoringSlab_criterionId_fkey" TO "AccreditationScoringSlab_blockId_fkey";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccreditationThresholdRule_criterionId_fkey') THEN
    ALTER TABLE "AccreditationThresholdRule" RENAME CONSTRAINT "AccreditationThresholdRule_criterionId_fkey" TO "AccreditationThresholdRule_blockId_fkey";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CriterionEntry_criterionId_fkey') THEN
    ALTER TABLE "BlockEntry" RENAME CONSTRAINT "CriterionEntry_criterionId_fkey" TO "BlockEntry_blockId_fkey";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CriterionEntry_workspaceId_fkey') THEN
    ALTER TABLE "BlockEntry" RENAME CONSTRAINT "CriterionEntry_workspaceId_fkey" TO "BlockEntry_workspaceId_fkey";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CriterionEvidence_workspaceId_fkey') THEN
    ALTER TABLE "BlockEvidence" RENAME CONSTRAINT "CriterionEvidence_workspaceId_fkey" TO "BlockEvidence_workspaceId_fkey";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'KpiAccreditationCriterionLink_criterionId_fkey') THEN
    ALTER TABLE "KpiAccreditationBlockLink" RENAME CONSTRAINT "KpiAccreditationCriterionLink_criterionId_fkey" TO "KpiAccreditationBlockLink_blockId_fkey";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'KpiAccreditationCriterionLink_kpiDefinitionId_fkey') THEN
    ALTER TABLE "KpiAccreditationBlockLink" RENAME CONSTRAINT "KpiAccreditationCriterionLink_kpiDefinitionId_fkey" TO "KpiAccreditationBlockLink_kpiDefinitionId_fkey";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'KpiAccreditationCriterionLink_tenantId_fkey') THEN
    ALTER TABLE "KpiAccreditationBlockLink" RENAME CONSTRAINT "KpiAccreditationCriterionLink_tenantId_fkey" TO "KpiAccreditationBlockLink_tenantId_fkey";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkspaceDiscussionThread_sectionCriterionId_fkey') THEN
    ALTER TABLE "WorkspaceDiscussionThread" RENAME CONSTRAINT "WorkspaceDiscussionThread_sectionCriterionId_fkey" TO "WorkspaceDiscussionThread_sectionBlockId_fkey";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkspaceGuestInvite_sectionCriterionId_fkey') THEN
    ALTER TABLE "WorkspaceGuestInvite" RENAME CONSTRAINT "WorkspaceGuestInvite_sectionCriterionId_fkey" TO "WorkspaceGuestInvite_sectionBlockId_fkey";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkspaceSectionAssignment_sectionCriterionId_fkey') THEN
    ALTER TABLE "WorkspaceSectionAssignment" RENAME CONSTRAINT "WorkspaceSectionAssignment_sectionCriterionId_fkey" TO "WorkspaceSectionAssignment_sectionBlockId_fkey";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkspaceSectionReview_sectionCriterionId_fkey') THEN
    ALTER TABLE "WorkspaceSectionReview" RENAME CONSTRAINT "WorkspaceSectionReview_sectionCriterionId_fkey" TO "WorkspaceSectionReview_sectionBlockId_fkey";
  END IF;
END $$;

DROP TABLE IF EXISTS "AccreditationCriterion";
