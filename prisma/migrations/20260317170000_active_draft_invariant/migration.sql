-- CreateIndex
CREATE UNIQUE INDEX "OrgStructureVersion_active_draft_tenant_key" ON "OrgStructureVersion"("tenantId")
WHERE "state" IN ('DRAFT', 'VALIDATED');
