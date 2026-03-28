import { beforeEach, describe, expect, test, vi } from "vitest";

const getServerSessionMock = vi.fn();
const exportRewardsCsvMock = vi.fn();
const getRewardConsoleAccessScopeMock = vi.fn();
const getRewardReconciliationMock = vi.fn();
const transitionContributorRewardsMock = vi.fn();

class MockRewardAccessDeniedError extends Error {
  constructor(message = "You do not have reward approval authority.") {
    super(message);
    this.name = "RewardAccessDeniedError";
  }
}

vi.mock("next-auth", () => ({
  default: vi.fn(() => ({})),
  getServerSession: getServerSessionMock,
}));

vi.mock("@/lib/kra-kpi/reward-ops-service", () => ({
  exportRewardsCsv: exportRewardsCsvMock,
  getRewardConsoleAccessScope: getRewardConsoleAccessScopeMock,
  getRewardReconciliation: getRewardReconciliationMock,
  transitionContributorRewards: transitionContributorRewardsMock,
  RewardAccessDeniedError: MockRewardAccessDeniedError,
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
  vi.resetModules();
  getServerSessionMock.mockResolvedValue(tenantSession());
  getRewardConsoleAccessScopeMock.mockResolvedValue({
    mode: "scoped",
    accessibleUnitIds: ["unit-1"],
  });
});

describe("reward operations routes", () => {
  test("reconciliation enforces reward approval scope", async () => {
    getRewardConsoleAccessScopeMock.mockRejectedValue(
      new MockRewardAccessDeniedError("No reward scope"),
    );

    const route = await import("@/app/api/tenant/kra-kpi/rewards/reconciliation/route");
    const response = await route.GET(
      new Request("http://localhost/api?periodId=period-1&groupBy=unit"),
    );

    expect(response.status).toBe(403);
    expect(getRewardReconciliationMock).not.toHaveBeenCalled();
  });

  test("reconciliation forwards grouping and active filters", async () => {
    getRewardReconciliationMock.mockResolvedValue({
      groupBy: "unit",
      rows: [],
      totals: {
        groupKey: "TOTAL",
        label: "All matching rewards",
        code: null,
        totalCount: 0,
        draftCount: 0,
        pendingCount: 0,
        releasedCount: 0,
        revokedCount: 0,
        totalAmount: 0,
        unit: "INR",
        isMixedUnits: false,
        amountBuckets: [],
      },
    });

    const route = await import("@/app/api/tenant/kra-kpi/rewards/reconciliation/route");
    const response = await route.GET(
      new Request("http://localhost/api?periodId=period-1&groupBy=unit&state=PENDING&benefitTypeCode=MONETARY&unitId=unit-1&kraDefinitionId=kra-1"),
    );

    expect(response.status).toBe(200);
    expect(getRewardReconciliationMock).toHaveBeenCalledWith(
      "tenant-1",
      "period-1",
      "unit",
      { mode: "scoped", accessibleUnitIds: ["unit-1"] },
      expect.objectContaining({
        state: "PENDING",
        benefitTypeCode: "MONETARY",
        unitId: "unit-1",
        kraDefinitionId: "kra-1",
      }),
    );
  });

  test("export returns csv headers and attachment metadata", async () => {
    exportRewardsCsvMock.mockResolvedValue({
      filename: "rewards-period-1.csv",
      content: "Reward ID,State\r\nreward-1,PENDING",
    });

    const route = await import("@/app/api/tenant/kra-kpi/rewards/export/route");
    const response = await route.GET(
      new Request("http://localhost/api?periodId=period-1&state=PENDING"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain("rewards-period-1.csv");
    await expect(response.text()).resolves.toContain("Reward ID,State");
    expect(exportRewardsCsvMock).toHaveBeenCalledWith(
      "tenant-1",
      expect.objectContaining({
        periodId: "period-1",
        state: "PENDING",
      }),
      { mode: "scoped", accessibleUnitIds: ["unit-1"] },
    );
  });

  test("transition rejects release without a release reference", async () => {
    const route = await import("@/app/api/tenant/kra-kpi/rewards/transition/route");
    const response = await route.POST(
      new Request("http://localhost/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rewardIds: ["reward-1"],
          nextState: "RELEASED",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(transitionContributorRewardsMock).not.toHaveBeenCalled();
  });

  test("transition surfaces partial responses from mixed bulk updates", async () => {
    transitionContributorRewardsMock.mockResolvedValue({
      updatedCount: 1,
      failed: [{ id: "reward-2", message: "Cannot move reward from RELEASED to PENDING." }],
    });

    const route = await import("@/app/api/tenant/kra-kpi/rewards/transition/route");
    const response = await route.POST(
      new Request("http://localhost/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rewardIds: ["reward-1", "reward-2"],
          nextState: "PENDING",
          note: "Approve eligible rows",
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.status).toBe("partial");
    expect(payload.updatedCount).toBe(1);
    expect(payload.failed).toHaveLength(1);
    expect(transitionContributorRewardsMock).toHaveBeenCalledWith(
      "tenant-1",
      ["reward-1", "reward-2"],
      "PENDING",
      "user-1",
      "TENANT_USER",
      {
        note: "Approve eligible rows",
        releaseReference: null,
      },
    );
  });
});
