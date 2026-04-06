ALTER TABLE "KpiDefinition"
ADD COLUMN "sourceTemplateCode" TEXT,
ADD COLUMN "sourceTemplatePackKey" TEXT;

CREATE INDEX "KpiDefinition_sourceTemplatePackKey_idx"
ON "KpiDefinition"("sourceTemplatePackKey");

CREATE UNIQUE INDEX "KpiDefinition_kraDefinitionId_sourceTemplateCode_key"
ON "KpiDefinition"("kraDefinitionId", "sourceTemplateCode");
