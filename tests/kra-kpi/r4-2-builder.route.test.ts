import { beforeEach, describe, expect, test, vi } from "vitest";

const getServerSessionMock = vi.fn();
const getKpiBuilderMock = vi.fn();
const saveKpiBuilderMock = vi.fn();

vi.mock("next-auth", () => ({
  default: vi.fn(() => ({})),
  getServerSession: getServerSessionMock,
}));

vi.mock("@/lib/kra-kpi/kpi-builder-service", () => ({
  getKpiBuilder: getKpiBuilderMock,
  saveKpiBuilder: saveKpiBuilderMock,
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

const samplePayload = {
  definition: {
    kraDefinitionId: "kra-1",
    title: "Builder KPI",
    measurementType: "NUMERIC",
    weightage: 10,
    allocationType: "INDIVIDUAL",
    startingUnitId: "unit-1",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("R4.2 builder route contracts", () => {
  test("builder routes return 403 when the session is missing", async () => {
    getServerSessionMock.mockResolvedValue(null);

    const collectionRoute = await import("@/app/api/tenant/kra-kpi/kpi-builder/route");
    const detailRoute = await import("@/app/api/tenant/kra-kpi/kpi-builder/[id]/route");

    const postRes = await collectionRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify(samplePayload),
        headers: { "content-type": "application/json" },
      }),
    );
    const getRes = await detailRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "kpi-1" }),
    });
    const putRes = await detailRoute.PUT(
      new Request("http://localhost", {
        method: "PUT",
        body: JSON.stringify(samplePayload),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "kpi-1" }) },
    );

    expect(postRes.status).toBe(403);
    expect(getRes.status).toBe(403);
    expect(putRes.status).toBe(403);
  });

  test("builder GET returns 404 when the KPI builder payload is missing", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession());
    getKpiBuilderMock.mockResolvedValue(null);

    const detailRoute = await import("@/app/api/tenant/kra-kpi/kpi-builder/[id]/route");
    const res = await detailRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "missing-kpi" }),
    });

    expect(res.status).toBe(404);
  });

  test("builder POST returns 201 and builder PUT injects the route id into the payload", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession("TENANT_OWNER"));
    saveKpiBuilderMock.mockResolvedValue({
      status: "success",
      message: "KPI builder saved.",
      id: "kpi-1",
    });
    getKpiBuilderMock.mockResolvedValue({
      definition: {
        id: "kpi-1",
        kraDefinitionId: "kra-1",
        title: "Builder KPI",
      },
    });

    const collectionRoute = await import("@/app/api/tenant/kra-kpi/kpi-builder/route");
    const detailRoute = await import("@/app/api/tenant/kra-kpi/kpi-builder/[id]/route");

    const createRes = await collectionRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify(samplePayload),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(createRes.status).toBe(201);

    const updateRes = await detailRoute.PUT(
      new Request("http://localhost", {
        method: "PUT",
        body: JSON.stringify(samplePayload),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "kpi-99" }) },
    );

    expect(updateRes.status).toBe(200);
    expect(saveKpiBuilderMock).toHaveBeenLastCalledWith(
      "tenant-1",
      expect.objectContaining({
        definition: expect.objectContaining({
          id: "kpi-99",
        }),
      }),
      "user-1",
      "TENANT_OWNER",
    );
  });
});
