DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'AccreditationScoreConversionType'
  ) THEN
    CREATE TYPE "AccreditationScoreConversionType" AS ENUM (
      'NONE',
      'LINEAR_FACTOR',
      'LINEAR_RATIO'
    );
  END IF;
END $$;

ALTER TABLE "AccreditationBodyVersion"
  ADD COLUMN IF NOT EXISTS "conversionType" "AccreditationScoreConversionType" NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS "conversionFactor" DOUBLE PRECISION;

UPDATE "AccreditationBodyVersion"
SET
  "conversionType" = CASE
    WHEN "conversionFormula" IS NOT NULL
      AND trim("conversionFormula") ~ '^[+-]?[0-9]+(\.[0-9]+)?$'
      THEN 'LINEAR_FACTOR'::"AccreditationScoreConversionType"
    WHEN "convertedScaleMax" IS NOT NULL
      THEN 'LINEAR_RATIO'::"AccreditationScoreConversionType"
    ELSE 'NONE'::"AccreditationScoreConversionType"
  END,
  "conversionFactor" = CASE
    WHEN "conversionFormula" IS NOT NULL
      AND trim("conversionFormula") ~ '^[+-]?[0-9]+(\.[0-9]+)?$'
      THEN trim("conversionFormula")::DOUBLE PRECISION
    ELSE "conversionFactor"
  END
WHERE "conversionFormula" IS NOT NULL
   OR "convertedScaleMax" IS NOT NULL;

ALTER TABLE "AccreditationBodyVersion"
  DROP COLUMN IF EXISTS "conversionFormula";

ALTER TABLE "BlockEntry"
  ADD COLUMN IF NOT EXISTS "executionStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "lastComputedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "executionMeta" JSONB,
  ADD COLUMN IF NOT EXISTS "lastExecutionHash" TEXT;
