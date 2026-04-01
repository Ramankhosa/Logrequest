UPDATE "KpiDefinition" AS kd
SET "allowMultipleAchievementsPerAllocation" = TRUE
WHERE kd."allowMultipleAchievementsPerAllocation" = FALSE
  AND kd."measurementType" = 'NUMERIC'
  AND kd."achievementTemplateKey" IN ('PUBLICATION', 'GU_JOURNAL_PUB')
  AND NOT EXISTS (
    SELECT 1
    FROM "KpiStageDefinition" AS stage
    WHERE stage."kpiDefinitionId" = kd."id"
  );
