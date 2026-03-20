import { beforeEach, describe, expect, test, vi } from "vitest";

const getServerSessionMock = vi.fn();
const copyKrasFromPeriodMock = vi.fn();

vi.mock("next-auth", () => ({
  default: vi.fn(() => ({})),
  getServerSession: getServerSessionMock,
}));

vi.mock("@/lib/kra-kpi/kra-service", () => ({
  copyKrasFromPeriod: copyKrasFromPeriodMock,
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

describe("period copy-kras route", () => {
  test("returns 403 when the session is missing", async () => {
    getServerSessionMock.mockResolvedValue(null);

    const route = await import("@/app/api/tenant/kra-kpi/periods/[id]/copy-kras/route");
    const res = await route.POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ sourcePeriodId: "period-source" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "period-target" }) },
    );

    expect(res.status).toBe(403);
  });

  test("maps typed service errors to 404 and 409", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession());
    copyKrasFromPeriodMock.mockResolvedValueOnce({
      status: "error",
      code: "PERIOD_NOT_FOUND",
      message: "Source assessment period not found.",
    });
    copyKrasFromPeriodMock.mockResolvedValueOnce({
      status: "error",
      code: "TARGET_PERIOD_NOT_EMPTY",
      message: "This period already has KRAs. Clear them first, then copy.",
    });

    const route = await import("@/app/api/tenant/kra-kpi/periods/[id]/copy-kras/route");
    const missingRes = await route.POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ sourcePeriodId: "missing-source" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "period-target" }) },
    );
    const conflictRes = await route.POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ sourcePeriodId: "period-source" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "period-target" }) },
    );

    expect(missingRes.status).toBe(404);
    expect(conflictRes.status).toBe(409);
  });

  test("returns 200 on success", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession());
    copyKrasFromPeriodMock.mockResolvedValue({
      status: "success",
      message: "Copied 2 KRA(s), 4 KPI(s), and 3 target mapping(s) from \"AY 2025-26\".",
    });

    const route = await import("@/app/api/tenant/kra-kpi/periods/[id]/copy-kras/route");
    const res = await route.POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ sourcePeriodId: "period-source" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "period-target" }) },
    );

    expect(res.status).toBe(200);
    expect(copyKrasFromPeriodMock).toHaveBeenCalledWith(
      "period-target",
      "tenant-1",
      { sourcePeriodId: "period-source" },
      "user-1",
      "TENANT_ADMIN",
    );
  });
});
