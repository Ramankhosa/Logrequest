import { beforeEach, describe, expect, test, vi } from "vitest";

const getServerSessionMock = vi.fn();
const getUnitSummaryMock = vi.fn();
const getUnitMembersSummaryMock = vi.fn();
const getPersonDetailMock = vi.fn();
const getStageBottleneckAnalysisMock = vi.fn();
const listScopedPersonRewardsMock = vi.fn();
const resolveDashboardUnitSelectionMock = vi.fn();
const resolveUserDashboardScopeMock = vi.fn();
const findUniqueUserMock = vi.fn();

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
  getUnitSummary: getUnitSummaryMock,
  getUnitMembersSummary: getUnitMembersSummaryMock,
  getPersonDetail: getPersonDetailMock,
  getStageBottleneckAnalysis: getStageBottleneckAnalysisMock,
}));

vi.mock("@/lib/kra-kpi/reward-ops-service", () => ({
  listScopedPersonRewards: listScopedPersonRewardsMock,
}));

vi.mock("@/lib/org-structure/scope-resolver", () => ({
  DashboardUnitSelectionError: MockDashboardUnitSelectionError,
  resolveDashboardUnitSelection: resolveDashboardUnitSelectionMock,
  resolveUserDashboardScope: resolveUserDashboardScopeMock,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: findUniqueUserMock,
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

beforeEach(() => {
  vi.clearAllMocks();
  getServerSessionMock.mockResolvedValue(tenantSession());
});

describe("R5.3 dashboard routes", () => {
  test("unit-summary resolves headed-unit scope and forwards the selected subtree", async () => {
    resolveDashboardUnitSelectionMock.mockResolvedValue({
      scopeMode: "DESCENDANTS",
      rootUnit: { unitId: "unit-1", unitName: "CSE", unitCode: "CSE" },
      effectiveUnitIds: ["unit-1", "unit-2"],
    });
    getUnitSummaryMock.mockResolvedValue({
      unitId: "unit-1",
      unitName: "CSE",
      unitCode: "CSE",
      scopeMode: "DESCENDANTS",
      effectiveUnitCount: 2,
      memberCount: 3,
      totalAllocations: 5,
      completedAllocations: 2,
      completionPercent: 40,
      averageScore: 55,
      kraBreakdown: [],
      stageKpiOptions: [],
    });

    const route = await import("@/app/api/tenant/kra-kpi/dashboard/unit-summary/route");
    const response = await route.GET(
      new Request("http://localhost/api?periodId=period-1&unitId=unit-1"),
    );

    expect(response.status).toBe(200);
    expect(resolveDashboardUnitSelectionMock).toHaveBeenCalledWith(
      "tenant-1",
      "user-1",
      "unit-1",
    );
    expect(getUnitSummaryMock).toHaveBeenCalledWith(
      "tenant-1",
      "period-1",
      "unit-1",
      "DESCENDANTS",
      ["unit-1", "unit-2"],
    );
  });

  test("unit-members returns the scoped member list and maps selection errors to HTTP status", async () => {
    resolveDashboardUnitSelectionMock.mockRejectedValue(
      new MockDashboardUnitSelectionError(403, "You do not have access to the requested unit."),
    );

    const route = await import("@/app/api/tenant/kra-kpi/dashboard/unit-members/route");
    const response = await route.GET(
      new Request("http://localhost/api?periodId=period-1&unitId=unit-9"),
    );

    expect(response.status).toBe(403);
    expect(getUnitMembersSummaryMock).not.toHaveBeenCalled();
  });

  test("person route narrows scope with optional unitId before loading detail", async () => {
    resolveDashboardUnitSelectionMock.mockResolvedValue({
      scopeMode: "NODE",
      rootUnit: { unitId: "unit-1", unitName: "CSE", unitCode: "CSE" },
      effectiveUnitIds: ["unit-1"],
    });
    getPersonDetailMock.mockResolvedValue({
      userId: "person-1",
      userName: "Person One",
      primaryUnitId: "unit-1",
      primaryUnitCode: "CSE",
      unitName: "CSE",
      allocations: [],
      overallScore: 0,
      averageScore: 0,
      overallCompletion: 0,
    });

    const route = await import("@/app/api/tenant/kra-kpi/dashboard/person/route");
    const response = await route.GET(
      new Request("http://localhost/api?periodId=period-1&userId=person-1&unitId=unit-1"),
    );

    expect(response.status).toBe(200);
    expect(getPersonDetailMock).toHaveBeenCalledWith(
      "tenant-1",
      "period-1",
      "person-1",
      ["unit-1"],
    );
    expect(resolveUserDashboardScopeMock).not.toHaveBeenCalled();
  });

  test("person-rewards denies out-of-scope users without invoking reward queries", async () => {
    resolveDashboardUnitSelectionMock.mockResolvedValue({
      scopeMode: "NODE",
      rootUnit: { unitId: "unit-1", unitName: "CSE", unitCode: "CSE" },
      effectiveUnitIds: ["unit-1"],
    });
    getPersonDetailMock.mockResolvedValue(null);
    findUniqueUserMock.mockResolvedValue({ id: "person-2" });

    const route = await import("@/app/api/tenant/kra-kpi/dashboard/person-rewards/route");
    const response = await route.GET(
      new Request("http://localhost/api?periodId=period-1&userId=person-2&unitId=unit-1"),
    );

    expect(response.status).toBe(403);
    expect(listScopedPersonRewardsMock).not.toHaveBeenCalled();
  });

  test("stage-bottleneck honors optional unit scoping and validates KPI membership in that scope", async () => {
    resolveDashboardUnitSelectionMock.mockResolvedValue({
      scopeMode: "DESCENDANTS",
      rootUnit: { unitId: "unit-1", unitName: "Engineering", unitCode: "ENG" },
      effectiveUnitIds: ["unit-1", "unit-2"],
    });
    getUnitSummaryMock.mockResolvedValue({
      unitId: "unit-1",
      unitName: "Engineering",
      unitCode: "ENG",
      scopeMode: "DESCENDANTS",
      effectiveUnitCount: 2,
      memberCount: 4,
      totalAllocations: 8,
      completedAllocations: 3,
      completionPercent: 37.5,
      averageScore: 48,
      kraBreakdown: [],
      stageKpiOptions: [
        {
          kpiId: "kpi-1",
          kpiTitle: "Publication Pipeline",
          allocationCount: 3,
          stageCount: 2,
          completionPercent: 20,
        },
      ],
    });
    getStageBottleneckAnalysisMock.mockResolvedValue({
      kpiTitle: "Publication Pipeline",
      stages: [],
    });

    const route = await import("@/app/api/tenant/kra-kpi/dashboard/stage-bottleneck/route");
    const response = await route.GET(
      new Request("http://localhost/api?periodId=period-1&kpiId=kpi-1&unitId=unit-1"),
    );

    expect(response.status).toBe(200);
    expect(getUnitSummaryMock).toHaveBeenCalledWith(
      "tenant-1",
      "period-1",
      "unit-1",
      "DESCENDANTS",
      ["unit-1", "unit-2"],
    );
    expect(getStageBottleneckAnalysisMock).toHaveBeenCalledWith(
      "tenant-1",
      "period-1",
      "kpi-1",
      ["unit-1", "unit-2"],
    );
  });
});
