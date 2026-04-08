import {
  AchievementState,
  CriterionDataType,
  DataBankCoverageStatus,
  DataBankMetricShape,
  DataBankValueMaturity,
  ProjectionStorageMode,
  SourceMetricValueType,
  TenantServiceCode,
} from "@prisma/client";
import { describe, expect, test } from "vitest";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import {
  createTenantAccreditationBody,
  createTenantBodyVersion,
  createTenantVersionBlock,
  createTenantVersionProfile,
} from "@/lib/accreditation/service";
import {
  createAssessmentWorkspace,
  applyBlockEntryProjection,
  listBlockEntryProjectionSources,
} from "@/lib/accreditation/workspace-service";
import {
  createDataBankDomain,
  createInstitutionalDataSource,
  createInstitutionalMetric,
  getInstitutionalDataSourceDatasetTemplate,
  getInstitutionalDataGaps,
  importInstitutionalDataSourceDataset,
  listMetricRefreshSuggestions,
  previewInstitutionalDataSourceImport,
  refreshInstitutionalDataSource,
  resolveMetricRefreshSuggestion,
  seedInstitutionalDataCatalog,
  upsertInstitutionalDataSourceSnapshot,
  upsertMetricSourceLinks,
} from "@/lib/accreditation/institutional-data-service";
import {
  cleanupTrackedData,
  createTenantActor,
  createTestMembership,
  createTestUser,
  enableTenantService,
  newDbTracker,
  type DbTracker,
} from "../helpers/db";
import {
  createScenarioAllocation,
  createWorkflowCoreFixture,
  recordScenarioAchievement,
} from "../helpers/kra-kpi-db-scenarios";

async function withIsolatedDb(run: (tracker: DbTracker) => Promise<void>) {
  const tracker = newDbTracker();
  try {
    await run(tracker);
  } finally {
    await cleanupTrackedData(tracker);
  }
}

async function createEnabledTenantAccreditationContext(tracker: DbTracker) {
  const { tenant, actor } = await createTenantActor(tracker, "TENANT_OWNER");

  await enableTenantService({
    tenantId: tenant.id,
    serviceCode: TenantServiceCode.ACCREDITATION,
    actorUserId: actor.id,
  });

  const bodyResult = await createTenantAccreditationBody(
    tenant.id,
    {
      code: `IDB_${Date.now()}`,
      name: "Institutional Data Accreditation",
    },
    actor.id,
    "TENANT_OWNER",
  );
  expect(bodyResult).toMatchObject({ status: "success" });
  if (bodyResult.status !== "success") {
    throw new Error(bodyResult.message);
  }

  const versionResult = await createTenantBodyVersion(
    tenant.id,
    bodyResult.body.id,
    {
      versionCode: `IDB_2026_${Date.now()}`,
      versionName: "Institutional Data Version",
      scoreBase: 100,
    },
    actor.id,
    "TENANT_OWNER",
  );
  expect(versionResult).toMatchObject({ status: "success" });
  if (versionResult.status !== "success") {
    throw new Error(versionResult.message);
  }

  const profileResult = await createTenantVersionProfile(
    tenant.id,
    versionResult.version.id,
    {
      profileCode: "UNIVERSITY",
      profileName: "University",
      isDefault: true,
    },
    actor.id,
    "TENANT_OWNER",
  );
  expect(profileResult).toMatchObject({ status: "success" });
  if (profileResult.status !== "success") {
    throw new Error(profileResult.message);
  }

  return {
    tenant,
    actor,
    version: versionResult.version,
    profile: profileResult.profile,
  };
}

async function createWorkspaceFixture(tracker: DbTracker, blockCode: string) {
  const context = await createEnabledTenantAccreditationContext(tracker);

  const blockResult = await createTenantVersionBlock(
    context.tenant.id,
    context.version.id,
    {
      blockCode,
      title: "Institutional Data Metric",
      dataType: CriterionDataType.QUANTITATIVE,
      maxScore: 20,
      isLeaf: true,
      sortOrder: 0,
    },
    context.actor.id,
    "TENANT_OWNER",
  );
  expect(blockResult).toMatchObject({ status: "success" });
  if (blockResult.status !== "success") {
    throw new Error(blockResult.message);
  }

  const workspaceResult = await createAssessmentWorkspace(
    context.tenant.id,
    {
      versionId: context.version.id,
      profileId: context.profile.id,
      title: "Institutional Data Workspace",
      periodStart: new Date("2024-01-01T00:00:00.000Z"),
      periodEnd: new Date("2024-12-31T00:00:00.000Z"),
    },
    context.actor.id,
    "TENANT_OWNER",
  );
  expect(workspaceResult).toMatchObject({ status: "success" });
  if (workspaceResult.status !== "success") {
    throw new Error(workspaceResult.message);
  }

  const workspace = workspaceResult.workspace as { id: string };

  const entry = await prisma.blockEntry.findFirstOrThrow({
    where: {
      workspaceId: workspace.id,
      blockId: blockResult.block.id,
    },
  });

  return { ...context, workspace, entry };
}

describe("institutional data service", () => {
  test("dataset sources generate guided templates with sample rows and instructions", async () => {
    await withIsolatedDb(async (tracker) => {
      const { tenant, actor } = await createEnabledTenantAccreditationContext(tracker);

      const domain = await createDataBankDomain(
        tenant.id,
        { code: "RESEARCH", name: "Research" },
        actor.id,
        "TENANT_OWNER",
      );
      expect(domain).toMatchObject({ status: "success" });
      if (domain.status !== "success") {
        throw new Error(domain.message);
      }

      const source = await createInstitutionalDataSource(
        tenant.id,
        {
          domainId: domain.domain.id,
          code: "PUBLICATION_REGISTER",
          name: "Publication Register",
          kind: "CSV_IMPORT",
          shape: "DATASET",
          datasetSchema: {
            templateKey: "PUBLICATION_REGISTER",
            templateVersion: "2026.04.v1",
            guide: {
              ownerOffice: "Research Cell",
              summary: "Publication data",
              minimumDataHint: "Title, year, publication type, and faculty author ID.",
              supportsPartialUpload: true,
              supportedMetrics: ["3.4.5"],
            },
            availableVariants: ["MINIMAL", "STANDARD", "FULL"],
            columns: [
              { key: "title", label: "Title", description: "Publication title", requiredLevel: "CORE", sample: "A Study on Learning Analytics" },
              { key: "publicationYear", label: "Publication Year", description: "Year", requiredLevel: "CORE", type: "NUMBER", sample: 2024 },
              { key: "ugcCareFlag", label: "UGC CARE", description: "UGC listed", requiredLevel: "RECOMMENDED", type: "BOOLEAN", sample: true },
              { key: "citationCount", label: "Citation Count", description: "Citations", requiredLevel: "OPTIONAL", type: "NUMBER", sample: 12 },
            ],
          },
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(source).toMatchObject({ status: "success" });
      if (source.status !== "success") {
        throw new Error(source.message);
      }

      const csvTemplate = await getInstitutionalDataSourceDatasetTemplate(
        source.source.id,
        tenant.id,
        actor.id,
        "TENANT_OWNER",
        "csv",
        "FULL",
      );
      expect(csvTemplate).toMatchObject({ status: "success" });
      if (csvTemplate.status !== "success") {
        throw new Error(csvTemplate.message);
      }
      expect(csvTemplate.filename).toBe("publication_register-template.csv");
      const csvLines = csvTemplate.content.toString("utf8").trim().split("\n");
      expect(csvLines[0]).toContain("title,publicationYear,ugcCareFlag,citationCount");
      expect(csvLines).toHaveLength(5);

      const xlsxTemplate = await getInstitutionalDataSourceDatasetTemplate(
        source.source.id,
        tenant.id,
        actor.id,
        "TENANT_OWNER",
        "xlsx",
        "STANDARD",
      );
      expect(xlsxTemplate).toMatchObject({ status: "success" });
      if (xlsxTemplate.status !== "success") {
        throw new Error(xlsxTemplate.message);
      }
      expect(xlsxTemplate.filename).toBe("publication_register-template.xlsx");
      expect(xlsxTemplate.content.byteLength).toBeGreaterThan(100);
      const workbook = XLSX.read(xlsxTemplate.content, { type: "buffer" });
      expect(workbook.SheetNames).toEqual(expect.arrayContaining(["Template", "Instructions"]));
      const templateRows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets.Template, { header: 1, defval: "" });
      expect(templateRows).toHaveLength(5);
      expect(templateRows[0]).toEqual(["title", "publicationYear", "ugcCareFlag"]);
    });
  });

  test("preview accepts partial uploads, warns clearly, and detects the header row", async () => {
    await withIsolatedDb(async (tracker) => {
      const { tenant, actor } = await createEnabledTenantAccreditationContext(tracker);

      const domain = await createDataBankDomain(
        tenant.id,
        { code: "HUMAN_RESOURCES", name: "Human Resources" },
        actor.id,
        "TENANT_OWNER",
      );
      expect(domain).toMatchObject({ status: "success" });
      if (domain.status !== "success") {
        throw new Error(domain.message);
      }

      const source = await createInstitutionalDataSource(
        tenant.id,
        {
          domainId: domain.domain.id,
          code: "HR_FACULTY_ROSTER",
          name: "HR Faculty Roster",
          kind: "CSV_IMPORT",
          shape: "DATASET",
          datasetSchema: {
            templateKey: "HR_FACULTY_ROSTER",
            templateVersion: "2026.04.v1",
            rowIdentityKeys: ["employeeCode"],
            guide: {
              ownerOffice: "HR Office",
              summary: "Faculty roster",
              minimumDataHint: "Employee code, faculty name, department, and full-time flag.",
              supportsPartialUpload: true,
              supportedMetrics: ["2.4.1", "2.4.2"],
            },
            columns: [
              { key: "employeeCode", label: "Employee Code", description: "ID", requiredLevel: "CORE", aliases: ["employee_id"], sample: "EMP-1001" },
              { key: "facultyName", label: "Faculty Name", description: "Name", requiredLevel: "CORE", aliases: ["faculty_name"], sample: "Dr Riya Sharma" },
              { key: "departmentName", label: "Department", description: "Department", requiredLevel: "CORE", aliases: ["department"], sample: "Computer Science" },
              { key: "fullTimeFlag", label: "Full-time", description: "Full time", requiredLevel: "CORE", type: "BOOLEAN", aliases: ["full_time"], sample: true, normalizers: ["boolean"] },
              { key: "phdEquivalentFlag", label: "PhD or Equivalent", description: "Doctorate flag", requiredLevel: "RECOMMENDED", type: "BOOLEAN", aliases: ["phd_flag"], sample: true, normalizers: ["boolean"], usedByMetrics: ["2.4.2"] },
            ],
          },
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(source).toMatchObject({ status: "success" });
      if (source.status !== "success") {
        throw new Error(source.message);
      }

      const csv = [
        "Faculty roster exported on 2025-04-01",
        "employee_id,faculty_name,department,full_time",
        "EMP-1001,Dr Riya Sharma,Computer Science,Yes",
        ",Dr Missing Code,Computer Science,Yes",
      ].join("\n");

      const preview = await previewInstitutionalDataSourceImport(
        source.source.id,
        tenant.id,
        {
          fileName: "faculty.csv",
          fileContentBase64: Buffer.from(csv, "utf8").toString("base64"),
          importVariant: "STANDARD",
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(preview).toMatchObject({ status: "success" });
      if (preview.status !== "success") {
        throw new Error(preview.message);
      }

      expect(preview.preview.selectedHeaderRowIndex).toBe(1);
      expect(preview.preview.validRowCount).toBe(1);
      expect(preview.preview.skippedRowCount).toBe(1);
      expect(preview.preview.warnings.some((warning) => warning.code === "MISSING_RECOMMENDED_FIELDS")).toBe(true);
      expect(preview.preview.sourceReadiness.status).toBe("PARTIAL");
      expect(preview.preview.coverageByMetric).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ metricCode: "2.4.2", status: "MISSING" }),
        ]),
      );
    });
  });

  test("import stores partial-data diagnostics and blocks zero-valid-row uploads", async () => {
    await withIsolatedDb(async (tracker) => {
      const { tenant, actor } = await createEnabledTenantAccreditationContext(tracker);

      const domain = await createDataBankDomain(
        tenant.id,
        { code: "FINANCE", name: "Finance" },
        actor.id,
        "TENANT_OWNER",
      );
      expect(domain).toMatchObject({ status: "success" });
      if (domain.status !== "success") {
        throw new Error(domain.message);
      }

      const source = await createInstitutionalDataSource(
        tenant.id,
        {
          domainId: domain.domain.id,
          code: "FINANCE_LEDGER",
          name: "Finance Ledger",
          kind: "CSV_IMPORT",
          shape: "DATASET",
          datasetSchema: {
            templateKey: "FINANCE_LEDGER",
            templateVersion: "2026.04.v1",
            rowIdentityKeys: ["transactionId"],
            guide: {
              ownerOffice: "Finance Office",
              summary: "Finance ledger",
              minimumDataHint: "Transaction ID, fiscal year, category, and amount.",
              supportsPartialUpload: true,
              supportedMetrics: ["6.4.2"],
            },
            columns: [
              { key: "transactionId", label: "Transaction ID", description: "ID", requiredLevel: "CORE", aliases: ["voucher_no"], sample: "FIN-0001" },
              { key: "fiscalYear", label: "Fiscal Year", description: "Year", requiredLevel: "CORE", sample: "2024-25" },
              { key: "ledgerCategory", label: "Category", description: "Ledger category", requiredLevel: "CORE", sample: "Infrastructure" },
              { key: "amount", label: "Amount", description: "Amount", requiredLevel: "CORE", type: "CURRENCY", sample: 1250000, normalizers: ["currency"] },
              { key: "fundSourceType", label: "Fund Source", description: "Source type", requiredLevel: "RECOMMENDED", sample: "Government", usedByMetrics: ["6.4.2"] },
            ],
          },
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(source).toMatchObject({ status: "success" });
      if (source.status !== "success") {
        throw new Error(source.message);
      }

      const importCsv = [
        "voucher_no,fiscalYear,ledgerCategory,amount",
        "FIN-0001,2024-25,Infrastructure,1250000",
        "FIN-0002,2024-25,Library,98000",
      ].join("\n");

      const importResult = await importInstitutionalDataSourceDataset(
        source.source.id,
        tenant.id,
        {
          fileName: "finance.csv",
          fileContentBase64: Buffer.from(importCsv, "utf8").toString("base64"),
          observedYear: 2025,
          importVariant: "STANDARD",
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(importResult).toMatchObject({ status: "success" });
      if (importResult.status !== "success") {
        throw new Error(importResult.message);
      }

      expect(importResult.importSummary.validRowCount).toBe(2);
      expect(importResult.importSummary.warnings.some((warning) => warning.code === "MISSING_RECOMMENDED_FIELDS")).toBe(true);

      const savedSnapshot = await prisma.dataBankSourceSnapshot.findUniqueOrThrow({
        where: { id: importResult.snapshot.id },
      });
      expect(savedSnapshot.coverageStatus).toBe(DataBankCoverageStatus.PARTIAL);
      expect(savedSnapshot.coveragePercent).toBeGreaterThan(0);
      expect(savedSnapshot.evidenceMeta).toMatchObject({
        importValidation: expect.objectContaining({
          validRowCount: 2,
          skippedRowCount: 0,
        }),
      });

      const blockedCsv = [
        "voucher_no,fiscalYear,ledgerCategory,amount",
        ",2024-25,Infrastructure,",
      ].join("\n");

      const blocked = await importInstitutionalDataSourceDataset(
        source.source.id,
        tenant.id,
        {
          fileName: "finance-bad.csv",
          fileContentBase64: Buffer.from(blockedCsv, "utf8").toString("base64"),
          observedYear: 2025,
          importVariant: "STANDARD",
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(blocked).toMatchObject({ status: "error" });
      if (blocked.status !== "error") {
        throw new Error("Expected bad upload to fail.");
      }
      expect(blocked.message).toContain("No valid rows remain");
    });
  });

  test("personnel adapter refresh writes a current-state dataset snapshot without inventing year history", async () => {
    await withIsolatedDb(async (tracker) => {
      const { tenant, actor } = await createEnabledTenantAccreditationContext(tracker);

      const extraUserA = await createTestUser(tracker, { firstName: "Priya", lastName: "Faculty" });
      const extraUserB = await createTestUser(tracker, { firstName: "Rohan", lastName: "Faculty" });
      await createTestMembership({
        tenantId: tenant.id,
        userId: extraUserA.id,
        role: "TENANT_USER",
        createdByUserId: actor.id,
      });
      await createTestMembership({
        tenantId: tenant.id,
        userId: extraUserB.id,
        role: "TENANT_USER",
        createdByUserId: actor.id,
      });

      const domain = await createDataBankDomain(
        tenant.id,
        { code: "HUMAN_RESOURCES", name: "Human Resources" },
        actor.id,
        "TENANT_OWNER",
      );
      expect(domain).toMatchObject({ status: "success" });
      if (domain.status !== "success") {
        throw new Error(domain.message);
      }

      const source = await createInstitutionalDataSource(
        tenant.id,
        {
          domainId: domain.domain.id,
          code: "PERSONNEL_ADAPTER",
          name: "Personnel Adapter",
          kind: "INTERNAL_ADAPTER",
          shape: "DATASET",
          adapterKey: "personnel.membership_roster",
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(source).toMatchObject({ status: "success" });
      if (source.status !== "success") {
        throw new Error(source.message);
      }

      const metric = await createInstitutionalMetric(
        tenant.id,
        {
          domainId: domain.domain.id,
          code: "PERSONNEL_TOTAL",
          name: "Personnel Total",
          valueType: "NUMBER",
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(metric).toMatchObject({ status: "success" });
      if (metric.status !== "success") {
        throw new Error(metric.message);
      }

      const linkResult = await upsertMetricSourceLinks(
        metric.metric.id,
        tenant.id,
        {
          links: [
            {
              sourceId: source.source.id,
              resolutionMode: "COUNT_ROWS",
              transformConfig: { mode: "COUNT_ROWS" },
            },
          ],
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(linkResult).toMatchObject({ status: "success" });

      const refreshed = await refreshInstitutionalDataSource(
        source.source.id,
        tenant.id,
        actor.id,
        "TENANT_OWNER",
      );
      expect(refreshed).toMatchObject({
        status: "success",
        refreshedSnapshotCount: 1,
        appliedCount: 1,
      });

      const snapshots = await prisma.dataBankSourceSnapshot.findMany({
        where: { sourceId: source.source.id },
        include: { datasetRows: true },
      });
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]?.observedYear).toBeNull();
      expect(snapshots[0]?.datasetRows.length).toBe(3);

      const observation = await prisma.sourceMetricObservation.findFirstOrThrow({
        where: { metricId: metric.metric.id },
      });
      expect(observation.scopeKey).toBe("DEFAULT");
      expect(observation.numberValue).toBe(3);
    });
  });

  test("achievement adapter only includes verified achievements and groups rows by reporting year", async () => {
    await withIsolatedDb(async (tracker) => {
      const fixture = await createWorkflowCoreFixture(tracker, { periodStateAfterSetup: "IN_PROGRESS" });
      await enableTenantService({
        tenantId: fixture.tenant.id,
        serviceCode: TenantServiceCode.ACCREDITATION,
        actorUserId: fixture.actor.id,
      });

      const domain = await createDataBankDomain(
        fixture.tenant.id,
        { code: "RESEARCH", name: "Research" },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(domain).toMatchObject({ status: "success" });
      if (domain.status !== "success") {
        throw new Error(domain.message);
      }

      const source = await createInstitutionalDataSource(
        fixture.tenant.id,
        {
          domainId: domain.domain.id,
          code: "ACHIEVEMENT_ADAPTER",
          name: "Achievement Adapter",
          kind: "INTERNAL_ADAPTER",
          shape: "DATASET",
          adapterKey: "achievements.verified_registry",
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(source).toMatchObject({ status: "success" });
      if (source.status !== "success") {
        throw new Error(source.message);
      }

      const metric = await createInstitutionalMetric(
        fixture.tenant.id,
        {
          domainId: domain.domain.id,
          code: "VERIFIED_ACHIEVEMENTS_TOTAL",
          name: "Verified Achievements Total",
          valueType: "NUMBER",
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(metric).toMatchObject({ status: "success" });
      if (metric.status !== "success") {
        throw new Error(metric.message);
      }

      await upsertMetricSourceLinks(
        metric.metric.id,
        fixture.tenant.id,
        {
          links: [
            {
              sourceId: source.source.id,
              resolutionMode: "COUNT_ROWS",
              transformConfig: { mode: "COUNT_ROWS" },
            },
          ],
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );

      const allocation = await createScenarioAllocation({
        fixture,
        kpiId: fixture.kpis.direct.id,
        assignedToUserId: fixture.users.facultyCse.id,
        targetValue: 1,
      });

      const firstAchievement = await recordScenarioAchievement({
        fixture,
        kpiId: fixture.kpis.direct.id,
        targetAllocationId: allocation.id,
        actorUserId: fixture.users.facultyCse.id,
        reportingDate: new Date("2024-04-01T00:00:00.000Z"),
      });
      expect(firstAchievement).toMatchObject({ status: "success" });

      const secondAchievement = await recordScenarioAchievement({
        fixture,
        kpiId: fixture.kpis.direct.id,
        targetAllocationId: allocation.id,
        actorUserId: fixture.users.facultyCse.id,
        reportingDate: new Date("2024-05-01T00:00:00.000Z"),
      });
      expect(secondAchievement).toMatchObject({ status: "success" });

      const achievements = await prisma.achievement.findMany({
        where: { tenantId: fixture.tenant.id },
        orderBy: { createdAt: "asc" },
      });
      expect(achievements.length).toBeGreaterThanOrEqual(2);

      await prisma.achievement.update({
        where: { id: achievements[0]!.id },
        data: { state: AchievementState.VERIFIED },
      });
      await prisma.achievement.update({
        where: { id: achievements[1]!.id },
        data: { state: AchievementState.SUBMITTED },
      });

      const refreshed = await refreshInstitutionalDataSource(
        source.source.id,
        fixture.tenant.id,
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(refreshed).toMatchObject({
        status: "success",
        refreshedSnapshotCount: 1,
        appliedCount: 1,
      });

      const snapshot = await prisma.dataBankSourceSnapshot.findFirstOrThrow({
        where: { sourceId: source.source.id },
        include: { datasetRows: true },
      });
      expect(snapshot.observedYear).toBe(2024);
      expect(snapshot.datasetRows).toHaveLength(1);

      const observation = await prisma.sourceMetricObservation.findFirstOrThrow({
        where: { metricId: metric.metric.id },
      });
      expect(observation.numberValue).toBe(1);
    });
  });

  test("seeds the catalog idempotently with recommended links", async () => {
    await withIsolatedDb(async (tracker) => {
      const { tenant, actor } = await createEnabledTenantAccreditationContext(tracker);

      const first = await seedInstitutionalDataCatalog(tenant.id, { includeRecommendedSources: true }, actor.id, "TENANT_OWNER");
      const second = await seedInstitutionalDataCatalog(tenant.id, { includeRecommendedSources: true }, actor.id, "TENANT_OWNER");

      expect(first).toMatchObject({ status: "success" });
      expect(second).toMatchObject({ status: "success" });

      const domainCount = await prisma.dataBankDomain.count({ where: { tenantId: tenant.id } });
      const metricCount = await prisma.sourceMetricDefinition.count({ where: { tenantId: tenant.id, isSystemDefined: true } });
      const linkCount = await prisma.metricSourceLink.count({ where: { tenantId: tenant.id } });

      expect(domainCount).toBe(6);
      expect(metricCount).toBeGreaterThanOrEqual(9);
      expect(linkCount).toBeGreaterThanOrEqual(4);
    });
  });

  test("resolves dataset-backed source links into base metrics and computed metrics", async () => {
    await withIsolatedDb(async (tracker) => {
      const { tenant, actor } = await createEnabledTenantAccreditationContext(tracker);

      const seedResult = await seedInstitutionalDataCatalog(tenant.id, { includeRecommendedSources: true }, actor.id, "TENANT_OWNER");
      expect(seedResult).toMatchObject({ status: "success" });

      const source = await prisma.dataBankSourceDefinition.findFirstOrThrow({
        where: { tenantId: tenant.id, code: "HR_FACULTY_ROSTER" },
      });

      const savedSnapshot = await upsertInstitutionalDataSourceSnapshot(
        source.id,
        tenant.id,
        {
          observedYear: 2024,
          datasetRows: [
            { rowData: { employeeCode: "F1", phdEquivalentFlag: true } },
            { rowData: { employeeCode: "F2", phdEquivalentFlag: true } },
            { rowData: { employeeCode: "F3", phdEquivalentFlag: false } },
          ],
        },
        actor.id,
        "TENANT_OWNER",
      );

      expect(savedSnapshot).toMatchObject({
        status: "success",
        syncResult: {
          appliedCount: 2,
          recomputedCount: 3,
        },
      });

      const observations = await prisma.sourceMetricObservation.findMany({
        where: {
          metric: {
            tenantId: tenant.id,
            code: {
              in: ["FACULTY_TOTAL", "FACULTY_PHD", "FACULTY_PHD_RATIO"],
            },
          },
        },
        include: {
          metric: true,
        },
      });

      const total = observations.find((item) => item.metric.code === "FACULTY_TOTAL");
      const phd = observations.find((item) => item.metric.code === "FACULTY_PHD");
      const ratio = observations.find((item) => item.metric.code === "FACULTY_PHD_RATIO");

      expect(total?.numberValue).toBe(3);
      expect(phd?.numberValue).toBe(2);
      expect(ratio?.numberValue).toBeCloseTo(2 / 3, 5);
      expect(ratio?.sourceType).toBe("COMPUTED");
    });
  });

  test("creates a refresh suggestion instead of overwriting a protected manual metric", async () => {
    await withIsolatedDb(async (tracker) => {
      const { tenant, actor } = await createEnabledTenantAccreditationContext(tracker);

      const domain = await createDataBankDomain(
        tenant.id,
        { code: "HUMAN_RESOURCES", name: "Human Resources" },
        actor.id,
        "TENANT_OWNER",
      );
      expect(domain).toMatchObject({ status: "success" });
      if (domain.status !== "success") {
        throw new Error(domain.message);
      }

      const source = await createInstitutionalDataSource(
        tenant.id,
        { domainId: domain.domain.id, code: "HR_MANUAL_ROSTER", name: "HR Manual Roster", kind: "CSV_IMPORT", shape: "DATASET" },
        actor.id,
        "TENANT_OWNER",
      );
      expect(source).toMatchObject({ status: "success" });
      if (source.status !== "success") {
        throw new Error(source.message);
      }

      const metric = await createInstitutionalMetric(
        tenant.id,
        { domainId: domain.domain.id, code: "FACULTY_TOTAL", name: "Faculty Total", valueType: "NUMBER" },
        actor.id,
        "TENANT_OWNER",
      );
      expect(metric).toMatchObject({ status: "success" });
      if (metric.status !== "success") {
        throw new Error(metric.message);
      }

      await upsertMetricSourceLinks(
        metric.metric.id,
        tenant.id,
        {
          links: [
            {
              sourceId: source.source.id,
              resolutionMode: "COUNT_ROWS",
              transformConfig: { mode: "COUNT_ROWS" },
            },
          ],
        },
        actor.id,
        "TENANT_OWNER",
      );

      await prisma.sourceMetricObservation.create({
        data: {
          metricId: metric.metric.id,
          observedYear: 2024,
          scopeKey: "YEAR:2024",
          dimensionFingerprint: "__NONE__",
          numberValue: 10,
          sourceType: "MANUAL",
          maturity: DataBankValueMaturity.VERIFIED,
          coverageStatus: DataBankCoverageStatus.COMPLETE,
          verifiedByUserId: actor.id,
          verifiedAt: new Date(),
          recordedByUserId: actor.id,
          recordedAt: new Date(),
        },
      });

      const syncResult = await upsertInstitutionalDataSourceSnapshot(
        source.source.id,
        tenant.id,
        {
          observedYear: 2024,
          datasetRows: [
            { rowData: { facultyId: "F1" } },
            { rowData: { facultyId: "F2" } },
            { rowData: { facultyId: "F3" } },
            { rowData: { facultyId: "F4" } },
            { rowData: { facultyId: "F5" } },
            { rowData: { facultyId: "F6" } },
            { rowData: { facultyId: "F7" } },
            { rowData: { facultyId: "F8" } },
          ],
        },
        actor.id,
        "TENANT_OWNER",
      );

      expect(syncResult).toMatchObject({
        status: "success",
        syncResult: {
          suggestionCount: 1,
        },
      });

      const observation = await prisma.sourceMetricObservation.findFirstOrThrow({
        where: { metricId: metric.metric.id },
      });
      expect(observation.numberValue).toBe(10);
      expect(observation.isStale).toBe(true);
      expect(observation.refreshBlockedReason).toBe("PENDING_SUGGESTION");

      const suggestions = await listMetricRefreshSuggestions(tenant.id, actor.id, "TENANT_OWNER", { status: "PENDING" });
      expect(suggestions).toMatchObject({ status: "success" });
      if (suggestions.status !== "success") {
        throw new Error(suggestions.message);
      }
      expect(suggestions.suggestions).toHaveLength(1);
      expect(suggestions.suggestions[0]?.candidateNumberValue).toBe(8);
    });
  });

  test("accepts a refresh suggestion and updates the protected metric value", async () => {
    await withIsolatedDb(async (tracker) => {
      const { tenant, actor } = await createEnabledTenantAccreditationContext(tracker);

      const seedResult = await seedInstitutionalDataCatalog(tenant.id, { includeRecommendedSources: true }, actor.id, "TENANT_OWNER");
      expect(seedResult).toMatchObject({ status: "success" });

      const metric = await prisma.sourceMetricDefinition.findFirstOrThrow({
        where: { tenantId: tenant.id, code: "FACULTY_TOTAL" },
      });
      const source = await prisma.dataBankSourceDefinition.findFirstOrThrow({
        where: { tenantId: tenant.id, code: "HR_FACULTY_ROSTER" },
      });

      await prisma.sourceMetricObservation.create({
        data: {
          metricId: metric.id,
          observedYear: 2024,
          scopeKey: "YEAR:2024",
          dimensionFingerprint: "__NONE__",
          numberValue: 12,
          sourceType: "MANUAL",
          maturity: DataBankValueMaturity.VERIFIED,
          coverageStatus: DataBankCoverageStatus.COMPLETE,
          verifiedByUserId: actor.id,
          verifiedAt: new Date(),
          recordedByUserId: actor.id,
          recordedAt: new Date(),
        },
      });

      await upsertInstitutionalDataSourceSnapshot(
        source.id,
        tenant.id,
        {
          observedYear: 2024,
          datasetRows: Array.from({ length: 9 }, (_, index) => ({
            rowData: { facultyId: `F${index + 1}` },
          })),
        },
        actor.id,
        "TENANT_OWNER",
      );

      const suggestions = await listMetricRefreshSuggestions(tenant.id, actor.id, "TENANT_OWNER", { status: "PENDING" });
      expect(suggestions).toMatchObject({ status: "success" });
      if (suggestions.status !== "success") {
        throw new Error(suggestions.message);
      }

      const suggestionId = suggestions.suggestions[0]?.id;
      expect(suggestionId).toBeTruthy();
      if (!suggestionId) {
        throw new Error("Expected a pending suggestion.");
      }

      const accepted = await resolveMetricRefreshSuggestion(
        suggestionId,
        tenant.id,
        { action: "ACCEPT" },
        actor.id,
        "TENANT_OWNER",
      );
      expect(accepted).toMatchObject({ status: "success" });

      const observation = await prisma.sourceMetricObservation.findFirstOrThrow({
        where: { metricId: metric.id, scopeKey: "YEAR:2024" },
      });
      expect(observation.numberValue).toBe(9);
      expect(observation.sourceType).toBe("DATA_BANK");
      expect(observation.isStale).toBe(false);
    });
  });

  test("rejects unknown dependencies and computed cycles", async () => {
    await withIsolatedDb(async (tracker) => {
      const { tenant, actor } = await createEnabledTenantAccreditationContext(tracker);

      const domain = await createDataBankDomain(
        tenant.id,
        { code: "RESEARCH", name: "Research" },
        actor.id,
        "TENANT_OWNER",
      );
      expect(domain).toMatchObject({ status: "success" });
      if (domain.status !== "success") {
        throw new Error(domain.message);
      }

      const unknownDependency = await createInstitutionalMetric(
        tenant.id,
        {
          domainId: domain.domain.id,
          code: "PUBLICATIONS_PER_FACULTY",
          name: "Publications Per Faculty",
          valueType: "NUMBER",
          shape: "COMPUTED",
          computeConfig: { formula: "deps.PUBLICATIONS_TOTAL.value / deps.FACULTY_TOTAL.value" },
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(unknownDependency).toMatchObject({
        status: "error",
        message: expect.stringContaining("Unknown metric dependency"),
      });

      await prisma.sourceMetricDefinition.create({
        data: {
          tenantId: tenant.id,
          domainId: domain.domain.id,
          code: "BETA_METRIC",
          name: "Beta Metric",
          valueType: SourceMetricValueType.NUMBER,
          shape: DataBankMetricShape.COMPUTED,
          computeConfig: { formula: "deps.ALPHA_METRIC.value" },
          createdByUserId: actor.id,
        },
      });

      const cycle = await createInstitutionalMetric(
        tenant.id,
        {
          domainId: domain.domain.id,
          code: "ALPHA_METRIC",
          name: "Alpha Metric",
          valueType: "NUMBER",
          shape: "COMPUTED",
          computeConfig: { formula: "deps.BETA_METRIC.value" },
        },
        actor.id,
        "TENANT_OWNER",
      );
      expect(cycle).toMatchObject({
        status: "error",
        message: expect.stringContaining("cycle"),
      });
    });
  });

  test("gap reporting distinguishes missing, partial, ready, stale, and not-applicable metrics", async () => {
    await withIsolatedDb(async (tracker) => {
      const { tenant, actor } = await createEnabledTenantAccreditationContext(tracker);

      const seedResult = await seedInstitutionalDataCatalog(tenant.id, { includeRecommendedSources: true }, actor.id, "TENANT_OWNER");
      expect(seedResult).toMatchObject({ status: "success" });

      const facultyMetric = await prisma.sourceMetricDefinition.findFirstOrThrow({
        where: { tenantId: tenant.id, code: "FACULTY_TOTAL" },
      });
      const publicationsMetric = await prisma.sourceMetricDefinition.findFirstOrThrow({
        where: { tenantId: tenant.id, code: "PUBLICATIONS_TOTAL" },
      });
      const budgetMetric = await prisma.sourceMetricDefinition.findFirstOrThrow({
        where: { tenantId: tenant.id, code: "ANNUAL_BUDGET_TOTAL" },
      });

      await prisma.sourceMetricObservation.create({
        data: {
          metricId: facultyMetric.id,
          observedYear: 2024,
          scopeKey: "YEAR:2024",
          dimensionFingerprint: "__NONE__",
          numberValue: 120,
          sourceType: "MANUAL",
          maturity: DataBankValueMaturity.REPORTED,
          coverageStatus: DataBankCoverageStatus.PARTIAL,
          coveragePercent: 75,
          recordedByUserId: actor.id,
          recordedAt: new Date(),
        },
      });

      await prisma.sourceMetricObservation.create({
        data: {
          metricId: publicationsMetric.id,
          observedYear: 2024,
          scopeKey: "YEAR:2024",
          dimensionFingerprint: "__NONE__",
          numberValue: 0,
          sourceType: "MANUAL",
          maturity: DataBankValueMaturity.REPORTED,
          coverageStatus: DataBankCoverageStatus.COMPLETE,
          isStale: true,
          recordedByUserId: actor.id,
          recordedAt: new Date(),
        },
      });

      await prisma.sourceMetricObservation.create({
        data: {
          metricId: budgetMetric.id,
          observedYear: 2024,
          scopeKey: "YEAR:2024",
          dimensionFingerprint: "__NONE__",
          numberValue: null,
          sourceType: "MANUAL",
          maturity: DataBankValueMaturity.UNKNOWN,
          coverageStatus: DataBankCoverageStatus.NOT_APPLICABLE,
          recordedByUserId: actor.id,
          recordedAt: new Date(),
        },
      });

      const gaps = await getInstitutionalDataGaps(tenant.id, actor.id, "TENANT_OWNER", { bodyCode: "NAAC" });
      expect(gaps).toMatchObject({ status: "success" });
      if (gaps.status !== "success") {
        throw new Error(gaps.message);
      }

      expect(gaps.gaps.partialMetrics).toBeGreaterThanOrEqual(1);
      expect(gaps.gaps.staleMetrics).toBeGreaterThanOrEqual(1);
      expect(gaps.gaps.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "ANNUAL_BUDGET_TOTAL", gapStatus: "NOT_APPLICABLE" }),
          expect.objectContaining({ code: "FACULTY_TOTAL", gapStatus: "PARTIAL" }),
          expect.objectContaining({ code: "PUBLICATIONS_TOTAL", gapStatus: "STALE" }),
        ]),
      );
    });
  });

  test("resolved institutional metrics can be projected into accreditation blocks through existing source-metric projections", async () => {
    await withIsolatedDb(async (tracker) => {
      const fixture = await createWorkspaceFixture(tracker, "3.2.2");
      const seedResult = await seedInstitutionalDataCatalog(fixture.tenant.id, { includeRecommendedSources: true }, fixture.actor.id, "TENANT_OWNER");
      expect(seedResult).toMatchObject({ status: "success" });

      const source = await prisma.dataBankSourceDefinition.findFirstOrThrow({
        where: { tenantId: fixture.tenant.id, code: "HR_FACULTY_ROSTER" },
      });
      const metric = await prisma.sourceMetricDefinition.findFirstOrThrow({
        where: { tenantId: fixture.tenant.id, code: "FACULTY_TOTAL" },
      });

      const syncResult = await upsertInstitutionalDataSourceSnapshot(
        source.id,
        fixture.tenant.id,
        {
          observedYear: 2024,
          datasetRows: Array.from({ length: 4 }, (_, index) => ({
            rowData: { facultyId: `F${index + 1}` },
          })),
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(syncResult).toMatchObject({ status: "success" });

      const applied = await applyBlockEntryProjection(
        fixture.entry.id,
        fixture.tenant.id,
        {
          sourceMetricId: metric.id,
          filters: { years: [2024] },
          targetPath: "actualValue",
          storageMode: ProjectionStorageMode.COPY,
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );

      expect(applied).toMatchObject({ status: "success", appliedCount: 1 });

      const response = await prisma.blockEntryResponse.findUniqueOrThrow({
        where: {
          entryId_scopeKey: {
            entryId: fixture.entry.id,
            scopeKey: "YEAR:2024",
          },
        },
      });
      expect(response.responseData).toMatchObject({ value: 4 });
      expect(response.dataSource).toBe("PROJECTED");
    });
  });

  test("projection source listing separates institutional metrics from generic source metrics", async () => {
    await withIsolatedDb(async (tracker) => {
      const fixture = await createWorkspaceFixture(tracker, "3.2.4");
      const seedResult = await seedInstitutionalDataCatalog(fixture.tenant.id, { includeRecommendedSources: true }, fixture.actor.id, "TENANT_OWNER");
      expect(seedResult).toMatchObject({ status: "success" });

      const sources = await listBlockEntryProjectionSources(
        fixture.entry.id,
        fixture.tenant.id,
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(sources).toMatchObject({ status: "success" });
      if (sources.status !== "success") {
        throw new Error(sources.message);
      }

      expect(sources.sources.institutionalDataMetrics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "FACULTY_TOTAL" }),
        ]),
      );
      expect(sources.sources.sourceMetrics.some((metric) => metric.code === "FACULTY_TOTAL")).toBe(false);
    });
  });
});
