import { beforeEach, describe, expect, test, vi } from "vitest";

const getServerSessionMock = vi.fn();
const listMyRewardsMock = vi.fn();

vi.mock("next-auth", () => ({
  default: vi.fn(() => ({})),
  getServerSession: getServerSessionMock,
}));

vi.mock("@/lib/kra-kpi/reward-ops-service", () => ({
  listMyRewards: listMyRewardsMock,
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
});

describe("reward self-service route", () => {
  test("returns 403 when session is missing", async () => {
    getServerSessionMock.mockResolvedValue(null);

    const route = await import("@/app/api/tenant/kra-kpi/rewards/my/route");
    const response = await route.GET(new Request("http://localhost/api"));

    expect(response.status).toBe(403);
    expect(listMyRewardsMock).not.toHaveBeenCalled();
  });

  test("forwards session user and optional filters to listMyRewards", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession());
    listMyRewardsMock.mockResolvedValue({
      rewards: [],
      totalsByState: {
        DRAFT: [],
        PENDING: [],
        RELEASED: [],
        REVOKED: [],
      },
    });

    const route = await import("@/app/api/tenant/kra-kpi/rewards/my/route");
    const response = await route.GET(
      new Request("http://localhost/api?periodId=period-1&limit=12&offset=3"),
    );

    expect(response.status).toBe(200);
    expect(listMyRewardsMock).toHaveBeenCalledWith("tenant-1", "user-1", {
      periodId: "period-1",
      limit: 12,
      offset: 3,
    });
  });
});
