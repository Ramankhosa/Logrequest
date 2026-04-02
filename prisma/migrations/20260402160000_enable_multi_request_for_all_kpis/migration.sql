ALTER TABLE "KpiDefinition"
ALTER COLUMN "allowMultipleAchievementsPerAllocation" SET DEFAULT TRUE;

UPDATE "KpiDefinition"
SET "allowMultipleAchievementsPerAllocation" = TRUE
WHERE "allowMultipleAchievementsPerAllocation" = FALSE;

UPDATE "KpiTemplate"
SET "builderPayload" = jsonb_set(
  COALESCE("builderPayload"::jsonb, '{}'::jsonb),
  '{definition,allowMultipleAchievementsPerAllocation}',
  'true'::jsonb,
  TRUE
)
WHERE jsonb_typeof(COALESCE("builderPayload"::jsonb, '{}'::jsonb)) = 'object';
