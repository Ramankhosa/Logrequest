import { beforeEach, describe, expect, test, vi } from "vitest";

const getServerSessionMock = vi.fn();
const previewKpiRewardsMock = vi.fn();

vi.mock("next-auth", () => ({
  default: vi.fn(() => ({})),
  getServerSession: getServerSessionMock,
}));

vi.mock("@/lib/kra-kpi/reward-service", () => ({
  previewKpiRewards: previewKpiRewardsMock,
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

describe("R4.2 reward preview route contracts", () => {
  test("reward preview requires tenant admin access", async () => {
    getServerSessionMock.mockResolvedValue(null);

    const route = await import("@/app/api/tenant/kra-kpi/kpi-builder/[id]/reward-preview/route");
    const res = await route.POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "kpi-1" }) },
    );

    expect(res.status).toBe(403);
  });

  test("reward preview returns 404 when the KPI is missing", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession("TENANT_OWNER"));
    previewKpiRewardsMock.mockResolvedValue(null);

    const route = await import("@/app/api/tenant/kra-kpi/kpi-builder/[id]/reward-preview/route");
    const res = await route.POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ contributors: [], achievementFormData: {}, systemMetrics: {} }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "missing-kpi" }) },
    );

    expect(res.status).toBe(404);
  });

  test("reward preview dispatches to the reward service", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession("TENANT_OWNER"));
    previewKpiRewardsMock.mockResolvedValue({
      policyDate: "2026-01-01T00:00:00.000Z",
      recurrencePolicy: "RECURRING",
      recurrenceKey: null,
      matchedTiers: [],
      components: [],
      totalsByBenefit: [],
    });

    const route = await import("@/app/api/tenant/kra-kpi/kpi-builder/[id]/reward-preview/route");
    const payload = {
      contributors: [],
      achievementFormData: { journalTier: "Q1" },
      systemMetrics: {},
    };
    const res = await route.POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify(payload),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "kpi-1" }) },
    );

    expect(res.status).toBe(200);
    expect(previewKpiRewardsMock).toHaveBeenCalledWith("kpi-1", "tenant-1", payload);
  });
});
