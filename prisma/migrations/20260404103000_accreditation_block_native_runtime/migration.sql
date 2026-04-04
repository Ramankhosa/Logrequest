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
