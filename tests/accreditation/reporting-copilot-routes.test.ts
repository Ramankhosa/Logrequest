import { beforeEach, describe, expect, test, vi } from "vitest";

const getServerSessionMock = vi.fn();

const getWorkspaceReadinessReportMock = vi.fn();
const getWorkspaceCompletenessReportMock = vi.fn();
const getWorkspaceEvidenceInventoryMock = vi.fn();
const exportWorkspaceReportMock = vi.fn();
const listWorkspaceDvvQueriesMock = vi.fn();
const createWorkspaceDvvQueryMock = vi.fn();
const updateDvvQueryMock = vi.fn();
const respondToDvvQueryMock = vi.fn();
const getWorkspaceDvvSummaryMock = vi.fn();
const listWorkspaceRecommendationsMock = vi.fn();
const createWorkspaceRecommendationMock = vi.fn();
const updatePeerRecommendationMock = vi.fn();
const updatePeerRecommendationProgressMock = vi.fn();
const getWorkspaceRecommendationSummaryMock = vi.fn();
const getCrossWorkspaceOverlapReportMock = vi.fn();
const hasTenantFeatureEnabledMock = vi.fn();

const generateEntryExplainSuggestionMock = vi.fn();
const generateEntryReviewSuggestionMock = vi.fn();
const generateEntryDraftSuggestionMock = vi.fn();
const generateWorkspaceWatchlistSuggestionMock = vi.fn();
const listEntryAssistantSuggestionsMock = vi.fn();
const updateAssistantSuggestionStatusMock = vi.fn();
const extractEvidenceVersionForCopilotMock = vi.fn();
const getEvidenceVersionExtractionDetailsMock = vi.fn();
const listEvidenceVersionChunksMock = vi.fn();

vi.mock("next-auth", () => ({
  default: vi.fn(() => ({})),
  getServerSession: getServerSessionMock,
}));

vi.mock("@/lib/accreditation/workspace-reporting-service", () => ({
  getWorkspaceReadinessReport: getWorkspaceReadinessReportMock,
  getWorkspaceCompletenessReport: getWorkspaceCompletenessReportMock,
  getWorkspaceEvidenceInventory: getWorkspaceEvidenceInventoryMock,
  exportWorkspaceReport: exportWorkspaceReportMock,
  listWorkspaceDvvQueries: listWorkspaceDvvQueriesMock,
  createWorkspaceDvvQuery: createWorkspaceDvvQueryMock,
  updateDvvQuery: updateDvvQueryMock,
  respondToDvvQuery: respondToDvvQueryMock,
  getWorkspaceDvvSummary: getWorkspaceDvvSummaryMock,
  listWorkspaceRecommendations: listWorkspaceRecommendationsMock,
  createWorkspaceRecommendation: createWorkspaceRecommendationMock,
  updatePeerRecommendation: updatePeerRecommendationMock,
  updatePeerRecommendationProgress: updatePeerRecommendationProgressMock,
  getWorkspaceRecommendationSummary: getWorkspaceRecommendationSummaryMock,
  getCrossWorkspaceOverlapReport: getCrossWorkspaceOverlapReportMock,
}));

vi.mock("@/lib/accreditation/accreditation-copilot-service", () => ({
  generateEntryExplainSuggestion: generateEntryExplainSuggestionMock,
  generateEntryReviewSuggestion: generateEntryReviewSuggestionMock,
  generateEntryDraftSuggestion: generateEntryDraftSuggestionMock,
  generateWorkspaceWatchlistSuggestion: generateWorkspaceWatchlistSuggestionMock,
  listEntryAssistantSuggestions: listEntryAssistantSuggestionsMock,
  updateAssistantSuggestionStatus: updateAssistantSuggestionStatusMock,
  extractEvidenceVersionForCopilot: extractEvidenceVersionForCopilotMock,
  getEvidenceVersionExtractionDetails: getEvidenceVersionExtractionDetailsMock,
  listEvidenceVersionChunks: listEvidenceVersionChunksMock,
}));

vi.mock("@/lib/tenant-services/service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tenant-services/service")>(
    "@/lib/tenant-services/service",
  );
  return {
    ...actual,
    hasTenantFeatureEnabled: hasTenantFeatureEnabledMock,
  };
});

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
  hasTenantFeatureEnabledMock.mockResolvedValue(true);
});

describe("reporting and copilot routes", () => {
  test("report routes require tenant session and forward workspace params", async () => {
    getServerSessionMock.mockResolvedValueOnce(null);
    const readinessRoute = await import(
      "@/app/api/tenant/accreditation/workspaces/[id]/reports/readiness/route"
    );
    const denied = await readinessRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "workspace-1" }),
    });
    expect(denied.status).toBe(403);

    getServerSessionMock.mockResolvedValue(tenantSession("TENANT_OWNER"));
    getWorkspaceReadinessReportMock.mockResolvedValue({ status: "success", report: { blockersCount: 0 } });
    getWorkspaceCompletenessReportMock.mockResolvedValue({ status: "success", report: { summary: {} } });
    getWorkspaceEvidenceInventoryMock.mockResolvedValue({ status: "success", report: { summary: {} } });

    const completenessRoute = await import(
      "@/app/api/tenant/accreditation/workspaces/[id]/reports/completeness/route"
    );
    const inventoryRoute = await import(
      "@/app/api/tenant/accreditation/workspaces/[id]/reports/evidence-inventory/route"
    );

    const readinessResponse = await readinessRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "workspace-1" }),
    });
    expect(readinessResponse.status).toBe(200);
    expect(getWorkspaceReadinessReportMock).toHaveBeenCalledWith(
      "workspace-1",
      "tenant-1",
      "user-1",
      "TENANT_OWNER",
    );

    const completenessResponse = await completenessRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "workspace-1" }),
    });
    expect(completenessResponse.status).toBe(200);
    expect(getWorkspaceCompletenessReportMock).toHaveBeenCalledWith(
      "workspace-1",
      "tenant-1",
      "user-1",
      "TENANT_OWNER",
    );

    const inventoryResponse = await inventoryRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "workspace-1" }),
    });
    expect(inventoryResponse.status).toBe(200);
    expect(getWorkspaceEvidenceInventoryMock).toHaveBeenCalledWith(
      "workspace-1",
      "tenant-1",
      "user-1",
      "TENANT_OWNER",
    );
  });

  test("export route validates format and returns csv payloads directly", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession("TENANT_OWNER"));
    exportWorkspaceReportMock.mockResolvedValue({
      status: "success",
      format: "csv",
      filename: "workspace-1-report.csv",
      csv: "blockCode,score",
      payload: {},
    });

    const exportRoute = await import(
      "@/app/api/tenant/accreditation/workspaces/[id]/reports/export/route"
    );

    const invalid = await exportRoute.GET(new Request("http://localhost?format=pdf"), {
      params: Promise.resolve({ id: "workspace-1" }),
    });
    expect(invalid.status).toBe(400);

    const csvResponse = await exportRoute.GET(new Request("http://localhost?format=csv"), {
      params: Promise.resolve({ id: "workspace-1" }),
    });
    expect(csvResponse.status).toBe(200);
    expect(await csvResponse.text()).toContain("blockCode,score");
    expect(exportWorkspaceReportMock).toHaveBeenCalledWith(
      "workspace-1",
      "tenant-1",
      "csv",
      "user-1",
      "TENANT_OWNER",
    );
  });

  test("dvv routes forward bodies and reject invalid json", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession("TENANT_OWNER"));
    listWorkspaceDvvQueriesMock.mockResolvedValue({ status: "success", queries: [] });
    createWorkspaceDvvQueryMock.mockResolvedValue({ status: "success", query: { id: "dvv-1" } });
    updateDvvQueryMock.mockResolvedValue({ status: "success", query: { id: "dvv-1" } });
    respondToDvvQueryMock.mockResolvedValue({ status: "success", query: { id: "dvv-1" } });
    getWorkspaceDvvSummaryMock.mockResolvedValue({ status: "success", summary: { total: 1 } });

    const listRoute = await import(
      "@/app/api/tenant/accreditation/workspaces/[id]/dvv-queries/route"
    );
    const updateRoute = await import(
      "@/app/api/tenant/accreditation/dvv-queries/[id]/route"
    );
    const respondRoute = await import(
      "@/app/api/tenant/accreditation/dvv-queries/[id]/respond/route"
    );
    const summaryRoute = await import(
      "@/app/api/tenant/accreditation/workspaces/[id]/dvv-summary/route"
    );

    const listResponse = await listRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "workspace-1" }),
    });
    expect(listResponse.status).toBe(200);
    expect(listWorkspaceDvvQueriesMock).toHaveBeenCalledWith(
      "workspace-1",
      "tenant-1",
      "user-1",
      "TENANT_OWNER",
    );

    const invalidCreate = await listRoute.POST(
      new Request("http://localhost", { method: "POST", body: "bad-json" }),
      { params: Promise.resolve({ id: "workspace-1" }) },
    );
    expect(invalidCreate.status).toBe(400);

    const createResponse = await listRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ queryNumber: "DVV-1", queryText: "Clarify metric." }),
      }),
      { params: Promise.resolve({ id: "workspace-1" }) },
    );
    expect(createResponse.status).toBe(200);
    expect(createWorkspaceDvvQueryMock).toHaveBeenCalledWith(
      "workspace-1",
      "tenant-1",
      { queryNumber: "DVV-1", queryText: "Clarify metric." },
      "user-1",
      "TENANT_OWNER",
    );

    const patchResponse = await updateRoute.PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "ASSIGNED" }),
      }),
      { params: Promise.resolve({ id: "dvv-1" }) },
    );
    expect(patchResponse.status).toBe(200);
    expect(updateDvvQueryMock).toHaveBeenCalledWith(
      "dvv-1",
      "tenant-1",
      { status: "ASSIGNED" },
      "user-1",
      "TENANT_OWNER",
    );

    const respondResponse = await respondRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ responseText: "Attached clarification." }),
      }),
      { params: Promise.resolve({ id: "dvv-1" }) },
    );
    expect(respondResponse.status).toBe(200);
    expect(respondToDvvQueryMock).toHaveBeenCalledWith(
      "dvv-1",
      "tenant-1",
      { responseText: "Attached clarification." },
      "user-1",
      "TENANT_OWNER",
    );

    const summaryResponse = await summaryRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "workspace-1" }),
    });
    expect(summaryResponse.status).toBe(200);
    expect(getWorkspaceDvvSummaryMock).toHaveBeenCalledWith(
      "workspace-1",
      "tenant-1",
      "user-1",
      "TENANT_OWNER",
    );
  });

  test("recommendation routes forward bodies and reject invalid json", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession("TENANT_OWNER"));
    listWorkspaceRecommendationsMock.mockResolvedValue({ status: "success", recommendations: [] });
    createWorkspaceRecommendationMock.mockResolvedValue({
      status: "success",
      recommendation: { id: "rec-1" },
    });
    updatePeerRecommendationMock.mockResolvedValue({
      status: "success",
      recommendation: { id: "rec-1" },
    });
    updatePeerRecommendationProgressMock.mockResolvedValue({
      status: "success",
      recommendation: { id: "rec-1" },
    });
    getWorkspaceRecommendationSummaryMock.mockResolvedValue({
      status: "success",
      summary: { total: 1 },
    });

    const listRoute = await import(
      "@/app/api/tenant/accreditation/workspaces/[id]/recommendations/route"
    );
    const updateRoute = await import(
      "@/app/api/tenant/accreditation/recommendations/[id]/route"
    );
    const progressRoute = await import(
      "@/app/api/tenant/accreditation/recommendations/[id]/progress/route"
    );
    const summaryRoute = await import(
      "@/app/api/tenant/accreditation/workspaces/[id]/recommendation-summary/route"
    );

    const listResponse = await listRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "workspace-1" }),
    });
    expect(listResponse.status).toBe(200);
    expect(listWorkspaceRecommendationsMock).toHaveBeenCalledWith(
      "workspace-1",
      "tenant-1",
      "user-1",
      "TENANT_OWNER",
    );

    const invalidCreate = await listRoute.POST(
      new Request("http://localhost", { method: "POST", body: "bad-json" }),
      { params: Promise.resolve({ id: "workspace-1" }) },
    );
    expect(invalidCreate.status).toBe(400);

    const createResponse = await listRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recommendationText: "Improve evidence traceability." }),
      }),
      { params: Promise.resolve({ id: "workspace-1" }) },
    );
    expect(createResponse.status).toBe(200);
    expect(createWorkspaceRecommendationMock).toHaveBeenCalledWith(
      "workspace-1",
      "tenant-1",
      { recommendationText: "Improve evidence traceability." },
      "user-1",
      "TENANT_OWNER",
    );

    const patchResponse = await updateRoute.PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "IN_PROGRESS" }),
      }),
      { params: Promise.resolve({ id: "rec-1" }) },
    );
    expect(patchResponse.status).toBe(200);
    expect(updatePeerRecommendationMock).toHaveBeenCalledWith(
      "rec-1",
      "tenant-1",
      { status: "IN_PROGRESS" },
      "user-1",
      "TENANT_OWNER",
    );

    const progressResponse = await progressRoute.PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "COMPLETED", progressNote: "Implemented." }),
      }),
      { params: Promise.resolve({ id: "rec-1" }) },
    );
    expect(progressResponse.status).toBe(200);
    expect(updatePeerRecommendationProgressMock).toHaveBeenCalledWith(
      "rec-1",
      "tenant-1",
      { status: "COMPLETED", progressNote: "Implemented." },
      "user-1",
      "TENANT_OWNER",
    );

    const summaryResponse = await summaryRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "workspace-1" }),
    });
    expect(summaryResponse.status).toBe(200);
    expect(getWorkspaceRecommendationSummaryMock).toHaveBeenCalledWith(
      "workspace-1",
      "tenant-1",
      "user-1",
      "TENANT_OWNER",
    );
  });

  test("copilot and overlap routes forward params and suggestion actions", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession("TENANT_USER"));
    generateWorkspaceWatchlistSuggestionMock.mockResolvedValue({
      status: "success",
      suggestion: { id: "watch-1" },
    });
    generateEntryExplainSuggestionMock.mockResolvedValue({ status: "success", suggestion: { id: "s1" } });
    generateEntryReviewSuggestionMock.mockResolvedValue({ status: "success", suggestion: { id: "s2" } });
    generateEntryDraftSuggestionMock.mockResolvedValue({ status: "success", suggestion: { id: "s3" } });
    listEntryAssistantSuggestionsMock.mockResolvedValue({ status: "success", suggestions: [] });
    updateAssistantSuggestionStatusMock.mockResolvedValue({ status: "success", suggestion: { id: "s1" } });
    extractEvidenceVersionForCopilotMock.mockResolvedValue({ status: "success", extraction: { id: "x1" } });
    getEvidenceVersionExtractionDetailsMock.mockResolvedValue({
      status: "success",
      extraction: { id: "x1", status: "SUCCESS", chunkCount: 2 },
    });
    listEvidenceVersionChunksMock.mockResolvedValue({
      status: "success",
      chunks: [{ id: "chunk-1" }],
    });
    getCrossWorkspaceOverlapReportMock.mockResolvedValue({ status: "success", report: { summary: {} } });

    const watchlistRoute = await import(
      "@/app/api/tenant/accreditation/workspaces/[id]/copilot/watchlist/route"
    );
    const explainRoute = await import(
      "@/app/api/tenant/accreditation/entries/[id]/copilot/explain/route"
    );
    const reviewRoute = await import(
      "@/app/api/tenant/accreditation/entries/[id]/copilot/review/route"
    );
    const draftRoute = await import(
      "@/app/api/tenant/accreditation/entries/[id]/copilot/draft/route"
    );
    const suggestionsRoute = await import(
      "@/app/api/tenant/accreditation/entries/[id]/assistant-suggestions/route"
    );
    const suggestionRoute = await import(
      "@/app/api/tenant/accreditation/assistant-suggestions/[id]/route"
    );
    const extractRoute = await import(
      "@/app/api/tenant/accreditation/evidence-versions/[id]/extract/route"
    );
    const extractionDetailRoute = await import(
      "@/app/api/tenant/accreditation/evidence-versions/[id]/extraction/route"
    );
    const extractionChunksRoute = await import(
      "@/app/api/tenant/accreditation/evidence-versions/[id]/chunks/route"
    );
    const overlapRoute = await import(
      "@/app/api/tenant/accreditation/reports/workspace-overlap/route"
    );

    const watchlistResponse = await watchlistRoute.POST(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ id: "workspace-1" }),
    });
    expect(watchlistResponse.status).toBe(200);
    expect(generateWorkspaceWatchlistSuggestionMock).toHaveBeenCalledWith(
      "workspace-1",
      "tenant-1",
      "user-1",
      "TENANT_USER",
    );

    await explainRoute.POST(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ id: "entry-1" }),
    });
    expect(generateEntryExplainSuggestionMock).toHaveBeenCalledWith(
      "entry-1",
      "tenant-1",
      "user-1",
      "TENANT_USER",
    );

    await reviewRoute.POST(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ id: "entry-1" }),
    });
    expect(generateEntryReviewSuggestionMock).toHaveBeenCalledWith(
      "entry-1",
      "tenant-1",
      "user-1",
      "TENANT_USER",
    );

    await draftRoute.POST(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ id: "entry-1" }),
    });
    expect(generateEntryDraftSuggestionMock).toHaveBeenCalledWith(
      "entry-1",
      "tenant-1",
      "user-1",
      "TENANT_USER",
    );

    const listSuggestionsResponse = await suggestionsRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "entry-1" }),
    });
    expect(listSuggestionsResponse.status).toBe(200);
    expect(listEntryAssistantSuggestionsMock).toHaveBeenCalledWith(
      "entry-1",
      "tenant-1",
      "user-1",
      "TENANT_USER",
    );

    const invalidPatch = await suggestionRoute.PATCH(
      new Request("http://localhost", { method: "PATCH", body: "not-json" }),
      { params: Promise.resolve({ id: "suggestion-1" }) },
    );
    expect(invalidPatch.status).toBe(400);

    const suggestionResponse = await suggestionRoute.PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "accept" }),
      }),
      { params: Promise.resolve({ id: "suggestion-1" }) },
    );
    expect(suggestionResponse.status).toBe(200);
    expect(updateAssistantSuggestionStatusMock).toHaveBeenCalledWith(
      "suggestion-1",
      "tenant-1",
      { action: "accept" },
      "user-1",
      "TENANT_USER",
    );

    const extractResponse = await extractRoute.POST(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ id: "evidence-version-1" }),
    });
    expect(extractResponse.status).toBe(200);
    expect(extractEvidenceVersionForCopilotMock).toHaveBeenCalledWith(
      "evidence-version-1",
      "tenant-1",
      "user-1",
      "TENANT_USER",
    );

    const extractionDetailResponse = await extractionDetailRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "evidence-version-1" }),
    });
    expect(extractionDetailResponse.status).toBe(200);
    expect(getEvidenceVersionExtractionDetailsMock).toHaveBeenCalledWith(
      "evidence-version-1",
      "tenant-1",
      "user-1",
      "TENANT_USER",
    );

    const extractionChunksResponse = await extractionChunksRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "evidence-version-1" }),
    });
    expect(extractionChunksResponse.status).toBe(200);
    expect(listEvidenceVersionChunksMock).toHaveBeenCalledWith(
      "evidence-version-1",
      "tenant-1",
      "user-1",
      "TENANT_USER",
    );

    const overlapResponse = await overlapRoute.GET();
    expect(overlapResponse.status).toBe(200);
    expect(getCrossWorkspaceOverlapReportMock).toHaveBeenCalledWith(
      "tenant-1",
      "user-1",
      "TENANT_USER",
    );
  });

  test("copilot routes return 403 when the feature is disabled while reporting stays available", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession("TENANT_USER"));
    hasTenantFeatureEnabledMock.mockResolvedValue(false);
    getWorkspaceReadinessReportMock.mockResolvedValue({
      status: "success",
      report: { blockersCount: 0 },
    });

    const readinessRoute = await import(
      "@/app/api/tenant/accreditation/workspaces/[id]/reports/readiness/route"
    );
    const watchlistRoute = await import(
      "@/app/api/tenant/accreditation/workspaces/[id]/copilot/watchlist/route"
    );
    const explainRoute = await import(
      "@/app/api/tenant/accreditation/entries/[id]/copilot/explain/route"
    );

    const readinessResponse = await readinessRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "workspace-1" }),
    });
    expect(readinessResponse.status).toBe(200);
    expect(getWorkspaceReadinessReportMock).toHaveBeenCalledTimes(1);

    const watchlistResponse = await watchlistRoute.POST(
      new Request("http://localhost", { method: "POST" }),
      { params: Promise.resolve({ id: "workspace-1" }) },
    );
    expect(watchlistResponse.status).toBe(403);
    expect(generateWorkspaceWatchlistSuggestionMock).not.toHaveBeenCalled();

    const explainResponse = await explainRoute.POST(
      new Request("http://localhost", { method: "POST" }),
      { params: Promise.resolve({ id: "entry-1" }) },
    );
    expect(explainResponse.status).toBe(403);
    expect(generateEntryExplainSuggestionMock).not.toHaveBeenCalled();
  });
});
