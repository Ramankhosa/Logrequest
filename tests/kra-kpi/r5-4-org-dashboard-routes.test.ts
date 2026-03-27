import { beforeEach, describe, expect, test, vi } from "vitest";

const getServerSessionMock = vi.fn();
const getAttentionItemsMock = vi.fn();
const getCrossUnitComparisonMock = vi.fn();
const getDrillDownNodeMock = vi.fn();
const getKpiPeriodComparisonMock = vi.fn();
const getOrgHierarchyStatsMock = vi.fn();
const getPersonDetailMock = vi.fn();
const getStageBottleneckAnalysisMock = vi.fn();
const getUnitMembersSummaryMock = vi.fn();
const listScopedPersonRewardsMock = vi.fn();
const resolveDashboardOrgNodeSelectionMock = vi.fn();
const resolveDashboardUnitSelectionMock = vi.fn();
const resolveUserDashboardScopeMock = vi.fn();
const findUniqueUserMock = vi.fn();
const findManyOrgUnitMock = vi.fn();
const getPublishedVersionIdMock = vi.fn();

class MockDashboardOrgSelectionError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "DashboardOrgSelectionError";
    this.status = status;
  }
}

class MockDashboardUnitSelectionError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "DashboardUnitSelectionError";
    this.status = status;
  }
}

vi.mock("next-auth", () => ({
  default: vi.fn(() => ({})),
  getServerSession: getServerSessionMock,
}));

vi.mock("@/lib/kra-kpi/dashboard-service", () => ({
  getAttentionItems: getAttentionItemsMock,
  getCrossUnitComparison: getCrossUnitComparisonMock,
  getDrillDownNode: getDrillDownNodeMock,
  getKpiPeriodComparison: getKpiPeriodComparisonMock,
  getOrgHierarchyStats: getOrgHierarchyStatsMock,
  getPersonDetail: getPersonDetailMock,
  getStageBottleneckAnalysis: getStageBottleneckAnalysisMock,
  getUnitMembersSummary: getUnitMembersSummaryMock,
}));

vi.mock("@/lib/kra-kpi/reward-ops-service", () => ({
  listScopedPersonRewards: listScopedPersonRewardsMock,
}));

vi.mock("@/lib/org-structure/scope-resolver", () => ({
  DashboardOrgSelectionError: MockDashboardOrgSelectionError,
  DashboardUnitSelectionError: MockDashboardUnitSelectionError,
  resolveDashboardOrgNodeSelection: resolveDashboardOrgNodeSelectionMock,
  resolveDashboardUnitSelection: resolveDashboardUnitSelectionMock,
  resolveUserDashboardScope: resolveUserDashboardScopeMock,
}));

vi.mock("@/lib/org-structure/hierarchy-utils", () => ({
  getPublishedVersionId: getPublishedVersionIdMock,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: findUniqueUserMock,
    },
    orgUnit: {
      findMany: findManyOrgUnitMock,
    },
  },
}));

function tenantSession() {
  return {
    user: {
      id: "user-1",
      tenantId: "tenant-1",
      role: "TENANT_USER",
    },
  };
}

function orgSelection(overrides?: Partial<{
  entryRoots: Array<{ unitId: string; unitName: string; unitCode: string; category: string }>;
  currentNode: { unitId: string; unitName: string; unitCode: string; category: string } | null;
  breadcrumb: Array<{ unitId: string; unitName: string; unitCode: string; category: string }>;
  visibleChildren: Array<{ unitId: string; unitName: string; unitCode: string; category: string }>;
  effectiveUnitIds: string[];
}>) {
  return {
    entryRoots: [
      { unitId: "unit-root", unitName: "Engineering", unitCode: "ENG", category: "School" },
    ],
    currentNode: null,
    breadcrumb: [],
    visibleChildren: [
      { unitId: "unit-root", unitName: "Engineering", unitCode: "ENG", category: "School" },
    ],
    effectiveUnitIds: ["unit-root", "unit-cse", "unit-ece"],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  getServerSessionMock.mockResolvedValue(tenantSession());
  resolveUserDashboardScopeMock.mockResolvedValue({ visibleUnitIds: ["member-unit"] });
  getPublishedVersionIdMock.mockResolvedValue("version-1");
  findManyOrgUnitMock.mockResolvedValue([]);
});

describe("R5.4 organization dashboard routes", () => {
  test("drill-down resolves org scope and returns the node summary payload", async () => {
    resolveDashboardOrgNodeSelectionMock.mockResolvedValue(
      orgSelection({
        currentNode: {
          unitId: "unit-root",
          unitName: "Engineering",
          unitCode: "ENG",
          category: "School",
        },
        breadcrumb: [
          { unitId: "unit-root", unitName: "Engineering", unitCode: "ENG", category: "School" },
        ],
        visibleChildren: [
          { unitId: "unit-cse", unitName: "Computer Science", unitCode: "CSE", category: "Department" },
        ],
        effectiveUnitIds: ["unit-root", "unit-cse"],
      }),
    );
    getDrillDownNodeMock.mockResolvedValue({
      unitId: "unit-root",
      unitName: "Engineering",
      unitCode: "ENG",
      category: "School",
      level: 1,
      childUnitCount: 2,
      navigableChildCount: 1,
      memberCount: 5,
      totalAllocations: 6,
      completedAllocations: 3,
      completionPercent: 50,
      averageScore: 61,
      overdueCount: 1,
      kraBreakdown: [],
      stageKpiOptions: [],
    });

    const route = await import("@/app/api/tenant/kra-kpi/dashboard/drill-down/route");
    const response = await route.GET(
      new Request("http://localhost/api?periodId=period-1&unitId=unit-root"),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(resolveDashboardOrgNodeSelectionMock).toHaveBeenCalledWith(
      "tenant-1",
      "user-1",
      "unit-root",
    );
    expect(getDrillDownNodeMock).toHaveBeenCalledWith("tenant-1", "period-1", {
      unitId: "unit-root",
      effectiveUnitIds: ["unit-root", "unit-cse"],
      visibleChildUnitIds: ["unit-cse"],
    });
    expect(payload.node.unitName).toBe("Engineering");
  });

  test("org-hierarchy uses org-scope visible children and effective subtree ids", async () => {
    resolveDashboardOrgNodeSelectionMock.mockResolvedValue(
      orgSelection({
        currentNode: {
          unitId: "unit-root",
          unitName: "Engineering",
          unitCode: "ENG",
          category: "School",
        },
        visibleChildren: [
          { unitId: "unit-cse", unitName: "Computer Science", unitCode: "CSE", category: "Department" },
          { unitId: "unit-ece", unitName: "Electronics", unitCode: "ECE", category: "Department" },
        ],
        effectiveUnitIds: ["unit-root", "unit-cse", "unit-ece"],
      }),
    );
    getOrgHierarchyStatsMock.mockResolvedValue({ units: [] });

    const route = await import("@/app/api/tenant/kra-kpi/dashboard/org-hierarchy/route");
    const response = await route.GET(
      new Request("http://localhost/api?periodId=period-1&parentUnitId=unit-root"),
    );

    expect(response.status).toBe(200);
    expect(getOrgHierarchyStatsMock).toHaveBeenCalledWith(
      "tenant-1",
      "period-1",
      ["unit-cse", "unit-ece"],
      ["unit-root", "unit-cse", "unit-ece"],
    );
  });

  test("org-members forwards the resolved org subtree into the shared member summary service", async () => {
    resolveDashboardOrgNodeSelectionMock.mockResolvedValue(
      orgSelection({ effectiveUnitIds: ["unit-root", "unit-cse"] }),
    );
    getUnitMembersSummaryMock.mockResolvedValue([{ userId: "person-1", userName: "Person One" }]);

    const route = await import("@/app/api/tenant/kra-kpi/dashboard/org-members/route");
    const response = await route.GET(
      new Request("http://localhost/api?periodId=period-1&unitId=unit-root"),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(getUnitMembersSummaryMock).toHaveBeenCalledWith(
      "tenant-1",
      "period-1",
      ["unit-root", "unit-cse"],
    );
    expect(payload.members).toHaveLength(1);
  });

  test("cross-unit compares the currently visible child nodes only", async () => {
    resolveDashboardOrgNodeSelectionMock.mockResolvedValue(
      orgSelection({
        currentNode: {
          unitId: "unit-root",
          unitName: "Engineering",
          unitCode: "ENG",
          category: "School",
        },
        visibleChildren: [
          { unitId: "unit-cse", unitName: "Computer Science", unitCode: "CSE", category: "Department" },
          { unitId: "unit-ece", unitName: "Electronics", unitCode: "ECE", category: "Department" },
        ],
      }),
    );
    getCrossUnitComparisonMock.mockResolvedValue({ units: [] });

    const route = await import("@/app/api/tenant/kra-kpi/dashboard/cross-unit/route");
    const response = await route.GET(
      new Request("http://localhost/api?periodId=period-1&parentUnitId=unit-root"),
    );

    expect(response.status).toBe(200);
    expect(getCrossUnitComparisonMock).toHaveBeenCalledWith(
      "tenant-1",
      "period-1",
      ["unit-cse", "unit-ece"],
      ["unit-root", "unit-cse", "unit-ece"],
    );
  });

  test("attention falls back to dashboard scope when org drill-down is unavailable", async () => {
    resolveDashboardOrgNodeSelectionMock.mockRejectedValue(
      new MockDashboardOrgSelectionError(403, "No org drill-down"),
    );
    resolveUserDashboardScopeMock.mockResolvedValue({ visibleUnitIds: ["member-unit"] });
    getAttentionItemsMock.mockResolvedValue({
      overdueAchievements: 1,
      zeroProgressEmployees: 0,
      stalePendingReviews: 0,
      lowCompletionKpis: [],
    });

    const route = await import("@/app/api/tenant/kra-kpi/dashboard/attention/route");
    const response = await route.GET(
      new Request("http://localhost/api?periodId=period-1"),
    );

    expect(response.status).toBe(200);
    expect(getAttentionItemsMock).toHaveBeenCalledWith(
      "tenant-1",
      "period-1",
      ["member-unit"],
    );
  });

  test("period-comparison falls back to the general dashboard scope on 403 root landing", async () => {
    resolveDashboardOrgNodeSelectionMock.mockRejectedValue(
      new MockDashboardOrgSelectionError(403, "No org drill-down"),
    );
    resolveUserDashboardScopeMock.mockResolvedValue({ visibleUnitIds: ["member-unit"] });
    getKpiPeriodComparisonMock.mockResolvedValue({
      sourceKpi: {
        sourceKpiId: "kpi-1",
        kraTitle: "Research",
        kpiTitle: "Publications",
        measurementType: "NUMERIC",
        unitLabel: "papers",
      },
      comparisonMode: "NUMERIC",
      periods: [],
    });

    const route = await import("@/app/api/tenant/kra-kpi/dashboard/period-comparison/route");
    const response = await route.GET(
      new Request("http://localhost/api?sourceKpiId=kpi-1&periodIds=period-1,period-2"),
    );

    expect(response.status).toBe(200);
    expect(getKpiPeriodComparisonMock).toHaveBeenCalledWith(
      "tenant-1",
      "kpi-1",
      ["period-1", "period-2"],
      ["member-unit"],
    );
  });

  test("person rejects mixed unit and org scope parameters", async () => {
    const route = await import("@/app/api/tenant/kra-kpi/dashboard/person/route");
    const response = await route.GET(
      new Request("http://localhost/api?periodId=period-1&userId=person-1&unitId=unit-1&orgUnitId=unit-2"),
    );

    expect(response.status).toBe(400);
    expect(resolveDashboardOrgNodeSelectionMock).not.toHaveBeenCalled();
    expect(resolveDashboardUnitSelectionMock).not.toHaveBeenCalled();
  });

  test("person uses orgUnitId to scope person detail lookups", async () => {
    resolveDashboardOrgNodeSelectionMock.mockResolvedValue(
      orgSelection({ effectiveUnitIds: ["unit-root", "unit-cse"] }),
    );
    getPersonDetailMock.mockResolvedValue({
      userId: "person-1",
      userName: "Person One",
      primaryUnitId: "unit-cse",
      primaryUnitCode: "CSE",
      unitName: "Computer Science",
      allocations: [],
      overallScore: 0,
      averageScore: 0,
      overallCompletion: 0,
    });

    const route = await import("@/app/api/tenant/kra-kpi/dashboard/person/route");
    const response = await route.GET(
      new Request("http://localhost/api?periodId=period-1&userId=person-1&orgUnitId=unit-root"),
    );

    expect(response.status).toBe(200);
    expect(getPersonDetailMock).toHaveBeenCalledWith(
      "tenant-1",
      "period-1",
      "person-1",
      ["unit-root", "unit-cse"],
    );
  });

  test("person-rewards scopes through orgUnitId and denies out-of-scope people before reward lookup", async () => {
    resolveDashboardOrgNodeSelectionMock.mockResolvedValue(
      orgSelection({ effectiveUnitIds: ["unit-root", "unit-cse"] }),
    );
    getPersonDetailMock.mockResolvedValue(null);
    findUniqueUserMock.mockResolvedValue({ id: "person-2" });

    const route = await import("@/app/api/tenant/kra-kpi/dashboard/person-rewards/route");
    const response = await route.GET(
      new Request("http://localhost/api?periodId=period-1&userId=person-2&orgUnitId=unit-root"),
    );

    expect(response.status).toBe(403);
    expect(getPersonDetailMock).toHaveBeenCalledWith(
      "tenant-1",
      "period-1",
      "person-2",
      ["unit-root", "unit-cse"],
    );
    expect(listScopedPersonRewardsMock).not.toHaveBeenCalled();
  });

  test("stage-bottleneck validates the KPI against org-scoped staged options before loading analysis", async () => {
    resolveDashboardOrgNodeSelectionMock.mockResolvedValue(
      orgSelection({
        currentNode: {
          unitId: "unit-root",
          unitName: "Engineering",
          unitCode: "ENG",
          category: "School",
        },
      }),
    );
    getDrillDownNodeMock.mockResolvedValue({
      unitId: "unit-root",
      unitName: "Engineering",
      unitCode: "ENG",
      category: "School",
      level: 1,
      childUnitCount: 2,
      navigableChildCount: 2,
      memberCount: 5,
      totalAllocations: 6,
      completedAllocations: 3,
      completionPercent: 50,
      averageScore: 61,
      overdueCount: 1,
      kraBreakdown: [],
      stageKpiOptions: [
        {
          kpiId: "kpi-1",
          kraId: "kra-1",
          kraTitle: "Research",
          kpiTitle: "Publications",
          allocationCount: 3,
          stageCount: 2,
          completionPercent: 20,
        },
      ],
    });
    getStageBottleneckAnalysisMock.mockResolvedValue({
      kpiTitle: "Publications",
      stages: [],
    });

    const route = await import("@/app/api/tenant/kra-kpi/dashboard/stage-bottleneck/route");
    const response = await route.GET(
      new Request("http://localhost/api?periodId=period-1&kpiId=kpi-1&orgUnitId=unit-root"),
    );

    expect(response.status).toBe(200);
    expect(getStageBottleneckAnalysisMock).toHaveBeenCalledWith(
      "tenant-1",
      "period-1",
      "kpi-1",
      ["unit-root", "unit-cse", "unit-ece"],
    );
  });
});
