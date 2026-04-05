DO $$
BEGIN
  ALTER TYPE "ProjectionSourceKind" ADD VALUE IF NOT EXISTS 'INSTITUTIONAL_DATA_BANK';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'CriterionYearData'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'BlockEntryResponse'
  ) THEN
    ALTER TABLE "CriterionYearData" RENAME TO "BlockEntryResponse";
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'BlockEntryYearValue'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'BlockEntryResponse'
  ) THEN
    ALTER TABLE "BlockEntryYearValue" RENAME TO "BlockEntryResponse";
  END IF;
END $$;

DO $$
BEGIN
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
END $$;

ALTER TABLE "BlockEntryResponse"
  ADD COLUMN IF NOT EXISTS "scopeKey" TEXT,
  ADD COLUMN IF NOT EXISTS "responseData" JSONB,
  ADD COLUMN IF NOT EXISTS "responseMetadata" JSONB,
  ADD COLUMN IF NOT EXISTS "computedOutput" JSONB,
  ADD COLUMN IF NOT EXISTS "computedScore" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "enteredByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "enteredAt" TIMESTAMP(3);

DO $$
DECLARE
  has_actual_value BOOLEAN;
  has_text_value BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'BlockEntryResponse'
      AND column_name = 'actualValue'
  ) INTO has_actual_value;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'BlockEntryResponse'
      AND column_name = 'textValue'
  ) INTO has_text_value;

  IF has_actual_value OR has_text_value THEN
    EXECUTE $sql$
      UPDATE "BlockEntryResponse"
      SET
        "scopeKey" = CASE
          WHEN COALESCE(NULLIF("scopeKey", ''), '') <> '' THEN "scopeKey"
          WHEN "year" IS NULL THEN 'DEFAULT'
          ELSE 'YEAR:' || "year"::TEXT
        END,
        "responseData" = COALESCE(
          "responseData",
          jsonb_strip_nulls(
            jsonb_build_object(
              'value',
              "actualValue",
              'narrative',
              "textValue"
            )
          )
        ),
        "computedOutput" = COALESCE(
          "computedOutput",
          jsonb_strip_nulls(
            jsonb_build_object(
              'value',
              "actualValue",
              'narrative',
              "textValue"
            )
          )
        ),
        "enteredAt" = COALESCE("enteredAt", "createdAt")
      WHERE
        "scopeKey" IS NULL
        OR "responseData" IS NULL
        OR "computedOutput" IS NULL
        OR "enteredAt" IS NULL
    $sql$;
  ELSE
    UPDATE "BlockEntryResponse"
    SET
      "scopeKey" = CASE
        WHEN COALESCE(NULLIF("scopeKey", ''), '') <> '' THEN "scopeKey"
        WHEN "year" IS NULL THEN 'DEFAULT'
        ELSE 'YEAR:' || "year"::TEXT
      END,
      "responseData" = COALESCE("responseData", '{}'::jsonb),
      "computedOutput" = COALESCE("computedOutput", COALESCE("responseData", '{}'::jsonb)),
      "enteredAt" = COALESCE("enteredAt", "createdAt")
    WHERE
      "scopeKey" IS NULL
      OR "responseData" IS NULL
      OR "computedOutput" IS NULL
      OR "enteredAt" IS NULL;
  END IF;
END $$;

UPDATE "BlockEntryResponse"
SET "scopeKey" = 'DEFAULT'
WHERE "scopeKey" = 'STATIC';

ALTER TABLE "BlockEntryResponse"
  ALTER COLUMN "scopeKey" SET NOT NULL,
  ALTER COLUMN "scopeKey" SET DEFAULT 'DEFAULT',
  ALTER COLUMN "year" DROP NOT NULL,
  ALTER COLUMN "responseData" SET NOT NULL;

DROP INDEX IF EXISTS "BlockEntryYearValue_entryId_year_key";
DROP INDEX IF EXISTS "BlockEntryYearValue_entryId_idx";
DROP INDEX IF EXISTS "CriterionYearData_entryId_year_key";
DROP INDEX IF EXISTS "CriterionYearData_entryId_idx";
DROP INDEX IF EXISTS "BlockEntryResponse_entryId_year_key";
DROP INDEX IF EXISTS "BlockEntryResponse_entryId_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "BlockEntryResponse_entryId_scopeKey_key"
  ON "BlockEntryResponse"("entryId", "scopeKey");

CREATE INDEX IF NOT EXISTS "BlockEntryResponse_entryId_year_idx"
  ON "BlockEntryResponse"("entryId", "year");

ALTER TABLE "BlockEntryResponse"
  DROP COLUMN IF EXISTS "actualValue",
  DROP COLUMN IF EXISTS "textValue";

ALTER TABLE "BlockEntryTableInstance"
  ADD COLUMN IF NOT EXISTS "responseId" TEXT;

INSERT INTO "BlockEntryResponse" (
  "id",
  "entryId",
  "scopeKey",
  "year",
  "responseData",
  "dataSource",
  "createdAt",
  "updatedAt",
  "enteredAt"
)
SELECT
  'resp_' || md5(ti."entryId" || ':' || COALESCE(ti."scopeKey", '') || ':' || COALESCE(ti."year"::TEXT, '')),
  ti."entryId",
  CASE
    WHEN COALESCE(NULLIF(ti."scopeKey", ''), '') <> '' THEN ti."scopeKey"
    WHEN ti."year" IS NULL THEN 'DEFAULT'
    ELSE 'YEAR:' || ti."year"::TEXT
  END,
  ti."year",
  '{}'::jsonb,
  'MANUAL'::"BlockEntryValueSource",
  NOW(),
  NOW(),
  NOW()
FROM "BlockEntryTableInstance" ti
LEFT JOIN "BlockEntryResponse" r
  ON r."entryId" = ti."entryId"
 AND r."scopeKey" = CASE
   WHEN COALESCE(NULLIF(ti."scopeKey", ''), '') <> '' THEN ti."scopeKey"
   WHEN ti."year" IS NULL THEN 'DEFAULT'
   ELSE 'YEAR:' || ti."year"::TEXT
 END
WHERE ti."responseId" IS NULL
  AND r."id" IS NULL;

UPDATE "BlockEntryTableInstance" ti
SET
  "scopeKey" = CASE
    WHEN COALESCE(NULLIF(ti."scopeKey", ''), '') <> '' THEN ti."scopeKey"
    WHEN ti."year" IS NULL THEN 'DEFAULT'
    ELSE 'YEAR:' || ti."year"::TEXT
  END,
  "responseId" = r."id"
FROM "BlockEntryResponse" r
WHERE r."entryId" = ti."entryId"
  AND r."scopeKey" = CASE
    WHEN COALESCE(NULLIF(ti."scopeKey", ''), '') <> '' THEN ti."scopeKey"
    WHEN ti."year" IS NULL THEN 'DEFAULT'
    ELSE 'YEAR:' || ti."year"::TEXT
  END
  AND ti."responseId" IS NULL;

UPDATE "BlockEntryTableInstance"
SET "scopeKey" = 'DEFAULT'
WHERE "scopeKey" = 'STATIC';

ALTER TABLE "BlockEntryTableInstance"
  ALTER COLUMN "responseId" SET NOT NULL;

DROP INDEX IF EXISTS "BlockEntryTableInstance_entryId_scopeKey_fieldKey_key";
DROP INDEX IF EXISTS "CriterionEntryTableInstance_entryId_scopeKey_fieldKey_key";
CREATE UNIQUE INDEX IF NOT EXISTS "BlockEntryTableInstance_responseId_fieldKey_key"
  ON "BlockEntryTableInstance"("responseId", "fieldKey");
CREATE INDEX IF NOT EXISTS "BlockEntryTableInstance_responseId_idx"
  ON "BlockEntryTableInstance"("responseId");

ALTER TABLE "BlockEntryTableInstance"
  DROP CONSTRAINT IF EXISTS "BlockEntryTableInstance_responseId_fkey",
  ADD CONSTRAINT "BlockEntryTableInstance_responseId_fkey"
    FOREIGN KEY ("responseId") REFERENCES "BlockEntryResponse"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER INDEX IF EXISTS "CriterionEntryTableCell_rowId_columnKey_key"
  RENAME TO "BlockEntryTableCell_rowId_columnKey_key";

ALTER INDEX IF EXISTS "CriterionEntryTableInstance_entryId_year_idx"
  RENAME TO "BlockEntryTableInstance_entryId_year_idx";

ALTER INDEX IF EXISTS "CriterionEntryTableRow_instanceId_dimensionFingerprint_idx"
  RENAME TO "BlockEntryTableRow_instanceId_dimensionFingerprint_idx";

ALTER INDEX IF EXISTS "CriterionEntryTableRow_instanceId_rowIndex_key"
  RENAME TO "BlockEntryTableRow_instanceId_rowIndex_key";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CriterionYearData_pkey') THEN
    ALTER TABLE "BlockEntryResponse" RENAME CONSTRAINT "CriterionYearData_pkey" TO "BlockEntryResponse_pkey";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CriterionYearData_entryId_fkey') THEN
    ALTER TABLE "BlockEntryResponse" RENAME CONSTRAINT "CriterionYearData_entryId_fkey" TO "BlockEntryResponse_entryId_fkey";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CriterionEntryTableInstance_pkey') THEN
    ALTER TABLE "BlockEntryTableInstance" RENAME CONSTRAINT "CriterionEntryTableInstance_pkey" TO "BlockEntryTableInstance_pkey";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CriterionEntryTableInstance_entryId_fkey') THEN
    ALTER TABLE "BlockEntryTableInstance" RENAME CONSTRAINT "CriterionEntryTableInstance_entryId_fkey" TO "BlockEntryTableInstance_entryId_fkey";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CriterionEntryTableRow_pkey') THEN
    ALTER TABLE "BlockEntryTableRow" RENAME CONSTRAINT "CriterionEntryTableRow_pkey" TO "BlockEntryTableRow_pkey";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CriterionEntryTableRow_instanceId_fkey') THEN
    ALTER TABLE "BlockEntryTableRow" RENAME CONSTRAINT "CriterionEntryTableRow_instanceId_fkey" TO "BlockEntryTableRow_instanceId_fkey";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CriterionEntryTableCell_pkey') THEN
    ALTER TABLE "BlockEntryTableCell" RENAME CONSTRAINT "CriterionEntryTableCell_pkey" TO "BlockEntryTableCell_pkey";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CriterionEntryTableCell_rowId_fkey') THEN
    ALTER TABLE "BlockEntryTableCell" RENAME CONSTRAINT "CriterionEntryTableCell_rowId_fkey" TO "BlockEntryTableCell_rowId_fkey";
  END IF;
END $$;

ALTER TABLE "BlockProjectionRecipe"
  ADD COLUMN IF NOT EXISTS "sourceExternalRecordId" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceExternalPath" TEXT;

UPDATE "BlockProjectionRecipe"
SET
  "sourcePath" = CASE
    WHEN "sourcePath" = 'actualValue' THEN 'response.value'
    WHEN "sourcePath" = 'textValue' THEN 'response.narrative'
    ELSE "sourcePath"
  END,
  "targetPath" = CASE
    WHEN "targetPath" = 'actualValue' THEN 'response.value'
    WHEN "targetPath" = 'textValue' THEN 'response.narrative'
    ELSE COALESCE("targetPath", 'response.value')
  END;

ALTER TABLE "BlockProjectionRecipe"
  ALTER COLUMN "targetPath" SET DEFAULT 'response.value';

UPDATE "BlockProjectionTarget"
SET
  "targetPath" = CASE
    WHEN "targetPath" = 'actualValue' THEN 'response.value'
    WHEN "targetPath" = 'textValue' THEN 'response.narrative'
    ELSE "targetPath"
  END,
  "targetScopeKey" = CASE
    WHEN "targetScopeKey" = 'STATIC' THEN 'DEFAULT'
    ELSE "targetScopeKey"
  END,
  "sourceScopeKey" = CASE
    WHEN "sourceScopeKey" = 'STATIC' THEN 'DEFAULT'
    ELSE "sourceScopeKey"
  END;

UPDATE "SourceMetricObservation"
SET "scopeKey" = 'DEFAULT'
WHERE "scopeKey" = 'STATIC';

ALTER TABLE "SourceMetricObservation"
  ALTER COLUMN "scopeKey" SET DEFAULT 'DEFAULT';
