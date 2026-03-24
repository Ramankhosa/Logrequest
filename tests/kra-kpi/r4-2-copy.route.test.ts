import { beforeEach, describe, expect, test, vi } from "vitest";

const getServerSessionMock = vi.fn();
const previewKpiCopyMock = vi.fn();
const copyKpiBuilderConfigMock = vi.fn();

vi.mock("next-auth", () => ({
  default: vi.fn(() => ({})),
  getServerSession: getServerSessionMock,
}));

vi.mock("@/lib/kra-kpi/kpi-copy-service", () => ({
  previewKpiCopy: previewKpiCopyMock,
  copyKpiBuilderConfig: copyKpiBuilderConfigMock,
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

describe("R4.2 KPI copy route contracts", () => {
  test("copy routes require tenant admin access", async () => {
    getServerSessionMock.mockResolvedValue(null);

    const previewRoute = await import("@/app/api/tenant/kra-kpi/kpi-copy/preview/route");
    const copyRoute = await import("@/app/api/tenant/kra-kpi/kpi-copy/route");

    const previewRes = await previewRoute.GET(
      new Request("http://localhost?sourceKpiId=kpi-1"),
    );
    const copyRes = await copyRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          sourceKpiId: "kpi-1",
          targetKraDefinitionId: "kra-1",
        }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(previewRes.status).toBe(403);
    expect(copyRes.status).toBe(403);
  });

  test("preview route returns 404 when the source KPI is missing", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession("TENANT_OWNER"));
    previewKpiCopyMock.mockResolvedValue(null);

    const previewRoute = await import("@/app/api/tenant/kra-kpi/kpi-copy/preview/route");
    const res = await previewRoute.GET(
      new Request("http://localhost?sourceKpiId=missing-kpi"),
    );

    expect(res.status).toBe(404);
  });

  test("copy route dispatches to the copy service and returns success mapping", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession("TENANT_OWNER"));
    previewKpiCopyMock.mockResolvedValue({
      sourceKpiId: "kpi-1",
      sections: { basics: true },
    });
    copyKpiBuilderConfigMock.mockResolvedValue({
      status: "success",
      message: "Copied",
      id: "kpi-2",
    });

    const previewRoute = await import("@/app/api/tenant/kra-kpi/kpi-copy/preview/route");
    const copyRoute = await import("@/app/api/tenant/kra-kpi/kpi-copy/route");

    const previewRes = await previewRoute.GET(
      new Request("http://localhost?sourceKpiId=kpi-1"),
    );
    expect(previewRes.status).toBe(200);

    const copyRes = await copyRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          sourceKpiId: "kpi-1",
          targetKraDefinitionId: "kra-1",
          titleOverride: "Copied KPI",
        }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(copyRes.status).toBe(200);
    expect(copyKpiBuilderConfigMock).toHaveBeenCalledWith(
      "tenant-1",
      expect.objectContaining({
        sourceKpiId: "kpi-1",
        targetKraDefinitionId: "kra-1",
        titleOverride: "Copied KPI",
      }),
      "user-1",
      "TENANT_OWNER",
    );
  });
});
