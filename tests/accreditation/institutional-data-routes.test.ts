import { beforeEach, describe, expect, test, vi } from "vitest";

const getServerSessionMock = vi.fn();

const listDataBankDomainsMock = vi.fn();
const createDataBankDomainMock = vi.fn();
const listInstitutionalDataSourcesMock = vi.fn();
const createInstitutionalDataSourceMock = vi.fn();
const getInstitutionalDataSourceMock = vi.fn();
const updateInstitutionalDataSourceMock = vi.fn();
const listInstitutionalDataSourceSnapshotsMock = vi.fn();
const upsertInstitutionalDataSourceSnapshotMock = vi.fn();
const previewInstitutionalDataSourceImportMock = vi.fn();
const importInstitutionalDataSourceDatasetMock = vi.fn();
const refreshInstitutionalDataSourceMock = vi.fn();
const listInstitutionalMetricsMock = vi.fn();
const createInstitutionalMetricMock = vi.fn();
const getInstitutionalMetricMock = vi.fn();
const updateInstitutionalMetricMock = vi.fn();
const upsertMetricSourceLinksMock = vi.fn();
const listMetricRefreshSuggestionsMock = vi.fn();
const resolveMetricRefreshSuggestionMock = vi.fn();
const getInstitutionalDataSummaryMock = vi.fn();
const getInstitutionalDataGapsMock = vi.fn();
const seedInstitutionalDataCatalogMock = vi.fn();

vi.mock("next-auth", () => ({
  default: vi.fn(() => ({})),
  getServerSession: getServerSessionMock,
}));

vi.mock("@/lib/accreditation/institutional-data-service", () => ({
  listDataBankDomains: listDataBankDomainsMock,
  createDataBankDomain: createDataBankDomainMock,
  listInstitutionalDataSources: listInstitutionalDataSourcesMock,
  createInstitutionalDataSource: createInstitutionalDataSourceMock,
  getInstitutionalDataSource: getInstitutionalDataSourceMock,
  updateInstitutionalDataSource: updateInstitutionalDataSourceMock,
  listInstitutionalDataSourceSnapshots: listInstitutionalDataSourceSnapshotsMock,
  upsertInstitutionalDataSourceSnapshot: upsertInstitutionalDataSourceSnapshotMock,
  previewInstitutionalDataSourceImport: previewInstitutionalDataSourceImportMock,
  importInstitutionalDataSourceDataset: importInstitutionalDataSourceDatasetMock,
  refreshInstitutionalDataSource: refreshInstitutionalDataSourceMock,
  listInstitutionalMetrics: listInstitutionalMetricsMock,
  createInstitutionalMetric: createInstitutionalMetricMock,
  getInstitutionalMetric: getInstitutionalMetricMock,
  updateInstitutionalMetric: updateInstitutionalMetricMock,
  upsertMetricSourceLinks: upsertMetricSourceLinksMock,
  listMetricRefreshSuggestions: listMetricRefreshSuggestionsMock,
  resolveMetricRefreshSuggestion: resolveMetricRefreshSuggestionMock,
  getInstitutionalDataSummary: getInstitutionalDataSummaryMock,
  getInstitutionalDataGaps: getInstitutionalDataGapsMock,
  seedInstitutionalDataCatalog: seedInstitutionalDataCatalogMock,
}));

function tenantSession(role: "TENANT_OWNER" | "TENANT_ADMIN" | "TENANT_USER" = "TENANT_ADMIN") {
  return {
    user: {
      id: "user-1",
      tenantId: "tenant-1",
      role,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("institutional data routes", () => {
  test("tenant institutional-data routes forward params, bodies, and query filters", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession("TENANT_OWNER"));
    listDataBankDomainsMock.mockResolvedValue({ status: "success", domains: [] });
    createDataBankDomainMock.mockResolvedValue({ status: "success", domain: { id: "domain-1" } });
    listInstitutionalDataSourcesMock.mockResolvedValue({ status: "success", sources: [] });
    createInstitutionalDataSourceMock.mockResolvedValue({ status: "success", source: { id: "source-1" } });
    getInstitutionalDataSourceMock.mockResolvedValue({ status: "success", source: { id: "source-1" } });
    updateInstitutionalDataSourceMock.mockResolvedValue({ status: "success", source: { id: "source-1" } });
    listInstitutionalDataSourceSnapshotsMock.mockResolvedValue({ status: "success", snapshots: [] });
    upsertInstitutionalDataSourceSnapshotMock.mockResolvedValue({ status: "success", snapshot: { id: "snapshot-1" } });
    previewInstitutionalDataSourceImportMock.mockResolvedValue({ status: "success", preview: { rowCount: 2 } });
    importInstitutionalDataSourceDatasetMock.mockResolvedValue({ status: "success", snapshot: { id: "snapshot-1" } });
    refreshInstitutionalDataSourceMock.mockResolvedValue({ status: "success", refreshedSnapshotCount: 1 });
    listInstitutionalMetricsMock.mockResolvedValue({ status: "success", metrics: [] });
    createInstitutionalMetricMock.mockResolvedValue({ status: "success", metric: { id: "metric-1" } });
    getInstitutionalMetricMock.mockResolvedValue({ status: "success", metric: { id: "metric-1" } });
    updateInstitutionalMetricMock.mockResolvedValue({ status: "success", metric: { id: "metric-1" } });
    upsertMetricSourceLinksMock.mockResolvedValue({ status: "success", links: [] });
    listMetricRefreshSuggestionsMock.mockResolvedValue({ status: "success", suggestions: [] });
    resolveMetricRefreshSuggestionMock.mockResolvedValue({ status: "success", suggestion: { id: "suggestion-1" } });
    getInstitutionalDataSummaryMock.mockResolvedValue({ status: "success", summary: {} });
    getInstitutionalDataGapsMock.mockResolvedValue({ status: "success", gaps: { items: [] } });
    seedInstitutionalDataCatalogMock.mockResolvedValue({ status: "success" });

    const domainsRoute = await import("@/app/api/tenant/accreditation/institutional-data/domains/route");
    const sourcesRoute = await import("@/app/api/tenant/accreditation/institutional-data/sources/route");
    const sourceRoute = await import("@/app/api/tenant/accreditation/institutional-data/sources/[id]/route");
    const snapshotsRoute = await import("@/app/api/tenant/accreditation/institutional-data/sources/[id]/snapshots/route");
    const importPreviewRoute = await import("@/app/api/tenant/accreditation/institutional-data/sources/[id]/dataset/import-preview/route");
    const importRoute = await import("@/app/api/tenant/accreditation/institutional-data/sources/[id]/dataset/import/route");
    const refreshRoute = await import("@/app/api/tenant/accreditation/institutional-data/sources/[id]/refresh/route");
    const metricsRoute = await import("@/app/api/tenant/accreditation/institutional-data/metrics/route");
    const metricRoute = await import("@/app/api/tenant/accreditation/institutional-data/metrics/[id]/route");
    const linksRoute = await import("@/app/api/tenant/accreditation/institutional-data/metrics/[id]/links/route");
    const suggestionsRoute = await import("@/app/api/tenant/accreditation/institutional-data/suggestions/route");
    const resolveSuggestionRoute = await import("@/app/api/tenant/accreditation/institutional-data/suggestions/[id]/resolve/route");
    const summaryRoute = await import("@/app/api/tenant/accreditation/institutional-data/summary/route");
    const gapsRoute = await import("@/app/api/tenant/accreditation/institutional-data/gaps/route");
    const seedRoute = await import("@/app/api/tenant/accreditation/institutional-data/seed/route");

    const domainsResponse = await domainsRoute.GET();
    expect(domainsResponse.status).toBe(200);
    expect(listDataBankDomainsMock).toHaveBeenCalledWith("tenant-1", "user-1", "TENANT_OWNER");

    const createDomainResponse = await domainsRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "HUMAN_RESOURCES", name: "Human Resources" }),
      }),
    );
    expect(createDomainResponse.status).toBe(200);
    expect(createDataBankDomainMock).toHaveBeenCalledWith(
      "tenant-1",
      { code: "HUMAN_RESOURCES", name: "Human Resources" },
      "user-1",
      "TENANT_OWNER",
    );

    const sourcesResponse = await sourcesRoute.GET();
    expect(sourcesResponse.status).toBe(200);
    expect(listInstitutionalDataSourcesMock).toHaveBeenCalledWith("tenant-1", "user-1", "TENANT_OWNER");

    const createSourceResponse = await sourcesRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "HR_FACULTY_ROSTER", name: "HR Faculty Roster", kind: "CSV_IMPORT", shape: "DATASET" }),
      }),
    );
    expect(createSourceResponse.status).toBe(200);
    expect(createInstitutionalDataSourceMock).toHaveBeenCalledWith(
      "tenant-1",
      { code: "HR_FACULTY_ROSTER", name: "HR Faculty Roster", kind: "CSV_IMPORT", shape: "DATASET" },
      "user-1",
      "TENANT_OWNER",
    );

    const sourceDetailResponse = await sourceRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "source-1" }),
    });
    expect(sourceDetailResponse.status).toBe(200);
    expect(getInstitutionalDataSourceMock).toHaveBeenCalledWith("source-1", "tenant-1", "user-1", "TENANT_OWNER");

    const sourcePatchResponse = await sourceRoute.PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Updated Source" }),
      }),
      { params: Promise.resolve({ id: "source-1" }) },
    );
    expect(sourcePatchResponse.status).toBe(200);
    expect(updateInstitutionalDataSourceMock).toHaveBeenCalledWith(
      "source-1",
      "tenant-1",
      { name: "Updated Source" },
      "user-1",
      "TENANT_OWNER",
    );

    const snapshotsListResponse = await snapshotsRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "source-1" }),
    });
    expect(snapshotsListResponse.status).toBe(200);
    expect(listInstitutionalDataSourceSnapshotsMock).toHaveBeenCalledWith("source-1", "tenant-1", "user-1", "TENANT_OWNER");

    const snapshotResponse = await snapshotsRoute.PUT(
      new Request("http://localhost", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          observedYear: 2024,
          datasetRows: [{ rowData: { qualification: "PhD" } }],
        }),
      }),
      { params: Promise.resolve({ id: "source-1" }) },
    );
    expect(snapshotResponse.status).toBe(200);
    expect(upsertInstitutionalDataSourceSnapshotMock).toHaveBeenCalledWith(
      "source-1",
      "tenant-1",
      {
        observedYear: 2024,
        datasetRows: [{ rowData: { qualification: "PhD" } }],
      },
      "user-1",
      "TENANT_OWNER",
    );

    const previewImportResponse = await importPreviewRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileName: "faculty.csv", fileContentBase64: "ZHVtbXk=" }),
      }),
      { params: Promise.resolve({ id: "source-1" }) },
    );
    expect(previewImportResponse.status).toBe(200);
    expect(previewInstitutionalDataSourceImportMock).toHaveBeenCalledWith(
      "source-1",
      "tenant-1",
      { fileName: "faculty.csv", fileContentBase64: "ZHVtbXk=" },
      "user-1",
      "TENANT_OWNER",
    );

    const importResponse = await importRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileName: "faculty.csv", fileContentBase64: "ZHVtbXk=" }),
      }),
      { params: Promise.resolve({ id: "source-1" }) },
    );
    expect(importResponse.status).toBe(200);
    expect(importInstitutionalDataSourceDatasetMock).toHaveBeenCalledWith(
      "source-1",
      "tenant-1",
      { fileName: "faculty.csv", fileContentBase64: "ZHVtbXk=" },
      "user-1",
      "TENANT_OWNER",
    );

    const refreshResponse = await refreshRoute.POST(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ id: "source-1" }),
    });
    expect(refreshResponse.status).toBe(200);
    expect(refreshInstitutionalDataSourceMock).toHaveBeenCalledWith("source-1", "tenant-1", "user-1", "TENANT_OWNER");

    const metricsResponse = await metricsRoute.GET();
    expect(metricsResponse.status).toBe(200);
    expect(listInstitutionalMetricsMock).toHaveBeenCalledWith("tenant-1", "user-1", "TENANT_OWNER");

    const createMetricResponse = await metricsRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "FACULTY_TOTAL", name: "Faculty Total", valueType: "NUMBER" }),
      }),
    );
    expect(createMetricResponse.status).toBe(200);
    expect(createInstitutionalMetricMock).toHaveBeenCalledWith(
      "tenant-1",
      { code: "FACULTY_TOTAL", name: "Faculty Total", valueType: "NUMBER" },
      "user-1",
      "TENANT_OWNER",
    );

    const metricDetailResponse = await metricRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "metric-1" }),
    });
    expect(metricDetailResponse.status).toBe(200);
    expect(getInstitutionalMetricMock).toHaveBeenCalledWith("metric-1", "tenant-1", "user-1", "TENANT_OWNER");

    const metricPatchResponse = await metricRoute.PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Faculty Count" }),
      }),
      { params: Promise.resolve({ id: "metric-1" }) },
    );
    expect(metricPatchResponse.status).toBe(200);
    expect(updateInstitutionalMetricMock).toHaveBeenCalledWith(
      "metric-1",
      "tenant-1",
      { name: "Faculty Count" },
      "user-1",
      "TENANT_OWNER",
    );

    const linksResponse = await linksRoute.PUT(
      new Request("http://localhost", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          links: [{ sourceId: "source-1", resolutionMode: "COUNT_ROWS", transformConfig: { mode: "COUNT_ROWS" } }],
        }),
      }),
      { params: Promise.resolve({ id: "metric-1" }) },
    );
    expect(linksResponse.status).toBe(200);
    expect(upsertMetricSourceLinksMock).toHaveBeenCalledWith(
      "metric-1",
      "tenant-1",
      { links: [{ sourceId: "source-1", resolutionMode: "COUNT_ROWS", transformConfig: { mode: "COUNT_ROWS" } }] },
      "user-1",
      "TENANT_OWNER",
    );

    const suggestionsResponse = await suggestionsRoute.GET(new Request("http://localhost?status=PENDING"));
    expect(suggestionsResponse.status).toBe(200);
    expect(listMetricRefreshSuggestionsMock).toHaveBeenCalledWith("tenant-1", "user-1", "TENANT_OWNER", { status: "PENDING" });

    const resolveResponse = await resolveSuggestionRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "ACCEPT" }),
      }),
      { params: Promise.resolve({ id: "suggestion-1" }) },
    );
    expect(resolveResponse.status).toBe(200);
    expect(resolveMetricRefreshSuggestionMock).toHaveBeenCalledWith("suggestion-1", "tenant-1", { action: "ACCEPT" }, "user-1", "TENANT_OWNER");

    const summaryResponse = await summaryRoute.GET();
    expect(summaryResponse.status).toBe(200);
    expect(getInstitutionalDataSummaryMock).toHaveBeenCalledWith("tenant-1", "user-1", "TENANT_OWNER");

    const gapsResponse = await gapsRoute.GET(new Request("http://localhost?bodyCode=NAAC"));
    expect(gapsResponse.status).toBe(200);
    expect(getInstitutionalDataGapsMock).toHaveBeenCalledWith("tenant-1", "user-1", "TENANT_OWNER", { bodyCode: "NAAC" });

    const seedResponse = await seedRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ includeRecommendedSources: true }),
      }),
    );
    expect(seedResponse.status).toBe(200);
    expect(seedInstitutionalDataCatalogMock).toHaveBeenCalledWith("tenant-1", { includeRecommendedSources: true }, "user-1", "TENANT_OWNER");
  });

  test("tenant institutional-data routes reject missing session and invalid JSON", async () => {
    getServerSessionMock.mockResolvedValueOnce(null);
    const domainsRoute = await import("@/app/api/tenant/accreditation/institutional-data/domains/route");
    const denied = await domainsRoute.GET();
    expect(denied.status).toBe(403);

    getServerSessionMock.mockResolvedValue(tenantSession("TENANT_OWNER"));
    const sourcesRoute = await import("@/app/api/tenant/accreditation/institutional-data/sources/route");
    const invalid = await sourcesRoute.POST(new Request("http://localhost", { method: "POST", body: "bad-json" }));
    expect(invalid.status).toBe(400);
  });
});
