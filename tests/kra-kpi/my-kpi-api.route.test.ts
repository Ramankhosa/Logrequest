import { beforeEach, describe, expect, test, vi } from "vitest";

const getServerSessionMock = vi.fn();
const getMyUnitMembersMock = vi.fn();
const getMyChildUnitsMock = vi.fn();
const isUserHeadOfUnitMock = vi.fn();
const getMyKpiContextMock = vi.fn();
const cascadeTargetsMock = vi.fn();
const recommendAchievementMock = vi.fn();
const verifyAchievementMock = vi.fn();
const targetAllocationFindFirstMock = vi.fn();

vi.mock("next-auth", () => ({
  default: vi.fn(() => ({})),
  getServerSession: getServerSessionMock,
}));

vi.mock("@/lib/kra-kpi/my-kpi-service", () => ({
  getMyUnitMembers: getMyUnitMembersMock,
  getMyChildUnits: getMyChildUnitsMock,
  isUserHeadOfUnit: isUserHeadOfUnitMock,
  getMyKpiContext: getMyKpiContextMock,
}));

vi.mock("@/lib/kra-kpi/target-service", () => ({
  cascadeTargets: cascadeTargetsMock,
}));

vi.mock("@/lib/kra-kpi/achievement-service", () => ({
  recommendAchievement: recommendAchievementMock,
  verifyAchievement: verifyAchievementMock,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    targetAllocation: {
      findFirst: targetAllocationFindFirstMock,
    },
  },
}));

function tenantSession(role: "TENANT_OWNER" | "TENANT_ADMIN" | "TENANT_USER" = "TENANT_USER") {
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

describe("R1.1a My KPI routes", () => {
  test("all routes return 403 when session is missing", async () => {
    getServerSessionMock.mockResolvedValue(null);

    const unitMembersRoute = await import("@/app/api/tenant/kra-kpi/my/unit-members/route");
    const childUnitsRoute = await import("@/app/api/tenant/kra-kpi/my/child-units/route");
    const cascadeRoute = await import("@/app/api/tenant/kra-kpi/my/cascade/route");
    const recommendRoute = await import("@/app/api/tenant/kra-kpi/my/recommend/route");

    const unitMembersRes = await unitMembersRoute.GET(
      new Request("http://localhost/api?unitId=unit-1"),
    );
    const childUnitsRes = await childUnitsRoute.GET(
      new Request("http://localhost/api?unitId=unit-1"),
    );
    const cascadeRes = await cascadeRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ parentAllocationId: "alloc-1", distributions: [] }),
        headers: { "content-type": "application/json" },
      }),
    );
    const recommendRes = await recommendRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ achievementId: "ach-1", approved: true, level: "RECOMMEND" }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(unitMembersRes.status).toBe(403);
    expect(childUnitsRes.status).toBe(403);
    expect(cascadeRes.status).toBe(403);
    expect(recommendRes.status).toBe(403);
  });

  test("unit-members and child-units require the caller to head the requested unit", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession());
    isUserHeadOfUnitMock.mockResolvedValue(false);

    const unitMembersRoute = await import("@/app/api/tenant/kra-kpi/my/unit-members/route");
    const childUnitsRoute = await import("@/app/api/tenant/kra-kpi/my/child-units/route");

    const unitMembersRes = await unitMembersRoute.GET(
      new Request("http://localhost/api?unitId=unit-1"),
    );
    const childUnitsRes = await childUnitsRoute.GET(
      new Request("http://localhost/api?unitId=unit-1"),
    );

    expect(unitMembersRes.status).toBe(403);
    expect(childUnitsRes.status).toBe(403);
  });

  test("unit-members and child-units return data for heads of the requested unit", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession());
    isUserHeadOfUnitMock.mockResolvedValue(true);
    getMyUnitMembersMock.mockResolvedValue([{ userId: "user-2", userName: "Faculty A", isUnitHead: false }]);
    getMyChildUnitsMock.mockResolvedValue([{ unitId: "unit-2", unitName: "CSE", unitCode: "CSE" }]);

    const unitMembersRoute = await import("@/app/api/tenant/kra-kpi/my/unit-members/route");
    const childUnitsRoute = await import("@/app/api/tenant/kra-kpi/my/child-units/route");

    const unitMembersRes = await unitMembersRoute.GET(
      new Request("http://localhost/api?unitId=unit-1"),
    );
    const childUnitsRes = await childUnitsRoute.GET(
      new Request("http://localhost/api?unitId=unit-1"),
    );

    expect(unitMembersRes.status).toBe(200);
    expect(await unitMembersRes.json()).toEqual([
      { userId: "user-2", userName: "Faculty A", isUnitHead: false },
    ]);

    expect(childUnitsRes.status).toBe(200);
    expect(await childUnitsRes.json()).toEqual([
      { unitId: "unit-2", unitName: "CSE", unitCode: "CSE" },
    ]);
  });

  test("cascade route blocks callers who do not head the allocation's unit", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession());
    getMyKpiContextMock.mockResolvedValue({
      userId: "user-1",
      headOfUnits: [],
      memberOfUnits: [{ unitId: "unit-1", unitName: "CSE", unitCode: "CSE" }],
    });
    targetAllocationFindFirstMock.mockResolvedValue({ assignedToUnitId: "unit-1" });

    const cascadeRoute = await import("@/app/api/tenant/kra-kpi/my/cascade/route");
    const res = await cascadeRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          parentAllocationId: "alloc-1",
          distributions: [{ assignedToUserId: "user-2", targetValue: 5 }],
        }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(res.status).toBe(403);
    expect(cascadeTargetsMock).not.toHaveBeenCalled();
  });

  test("cascade route forwards valid head-of-unit requests to the service", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession());
    getMyKpiContextMock.mockResolvedValue({
      userId: "user-1",
      headOfUnits: [{ unitId: "unit-1", unitName: "CSE", unitCode: "CSE" }],
      memberOfUnits: [{ unitId: "unit-1", unitName: "CSE", unitCode: "CSE" }],
    });
    targetAllocationFindFirstMock.mockResolvedValue({ assignedToUnitId: "unit-1" });
    cascadeTargetsMock.mockResolvedValue({ status: "success", message: "ok" });

    const cascadeRoute = await import("@/app/api/tenant/kra-kpi/my/cascade/route");
    const res = await cascadeRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          parentAllocationId: "alloc-1",
          distributions: [{ assignedToUserId: "user-2", targetValue: 5 }],
        }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(res.status).toBe(200);
    expect(cascadeTargetsMock).toHaveBeenCalledWith(
      "alloc-1",
      "tenant-1",
      { distributions: [{ assignedToUserId: "user-2", targetValue: 5 }] },
      "user-1",
      "TENANT_USER",
      { allowHeadOfUnit: true },
    );
  });

  test("recommend route dispatches to recommend or verify based on level", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession());
    recommendAchievementMock.mockResolvedValue({ status: "success", message: "recommended" });
    verifyAchievementMock.mockResolvedValue({ status: "success", message: "verified" });

    const recommendRoute = await import("@/app/api/tenant/kra-kpi/my/recommend/route");

    const recommendRes = await recommendRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ achievementId: "ach-1", approved: true, note: "ok", level: "RECOMMEND" }),
        headers: { "content-type": "application/json" },
      }),
    );
    const verifyRes = await recommendRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ achievementId: "ach-1", approved: true, note: "ok", level: "VERIFY" }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(recommendRes.status).toBe(200);
    expect(verifyRes.status).toBe(200);
    expect(recommendAchievementMock).toHaveBeenCalledWith(
      "ach-1",
      "tenant-1",
      true,
      "ok",
      "user-1",
      "TENANT_USER",
    );
    expect(verifyAchievementMock).toHaveBeenCalledWith(
      "ach-1",
      "tenant-1",
      true,
      "ok",
      "user-1",
      "TENANT_USER",
    );
  });
});
