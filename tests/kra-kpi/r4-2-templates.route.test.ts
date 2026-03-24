import { beforeEach, describe, expect, test, vi } from "vitest";

const getServerSessionMock = vi.fn();
const listKpiTemplatesMock = vi.fn();
const getKpiTemplateMock = vi.fn();
const createKpiTemplateMock = vi.fn();
const updateKpiTemplateMock = vi.fn();
const applyTemplateToKpiMock = vi.fn();

vi.mock("next-auth", () => ({
  default: vi.fn(() => ({})),
  getServerSession: getServerSessionMock,
}));

vi.mock("@/lib/kra-kpi/kpi-template-service", () => ({
  listKpiTemplates: listKpiTemplatesMock,
  getKpiTemplate: getKpiTemplateMock,
  createKpiTemplate: createKpiTemplateMock,
  updateKpiTemplate: updateKpiTemplateMock,
  applyTemplateToKpi: applyTemplateToKpiMock,
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

describe("R4.2 KPI template route contracts", () => {
  test("template routes return 403 when the session is missing", async () => {
    getServerSessionMock.mockResolvedValue(null);

    const collectionRoute = await import("@/app/api/tenant/kra-kpi/kpi-templates/route");
    const detailRoute = await import("@/app/api/tenant/kra-kpi/kpi-templates/[id]/route");
    const applyRoute = await import("@/app/api/tenant/kra-kpi/kpi-templates/[id]/apply/route");

    const listRes = await collectionRoute.GET();
    const createRes = await collectionRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ code: "TEMP_1", name: "Temp", payload: {} }),
        headers: { "content-type": "application/json" },
      }),
    );
    const getRes = await detailRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "template-1" }),
    });
    const patchRes = await detailRoute.PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ name: "Updated" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "template-1" }) },
    );
    const applyRes = await applyRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ kraDefinitionId: "kra-1" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "template-1" }) },
    );

    expect(listRes.status).toBe(403);
    expect(createRes.status).toBe(403);
    expect(getRes.status).toBe(403);
    expect(patchRes.status).toBe(403);
    expect(applyRes.status).toBe(403);
  });

  test("template GET returns 404 when the template is missing", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession());
    getKpiTemplateMock.mockResolvedValue(null);

    const detailRoute = await import("@/app/api/tenant/kra-kpi/kpi-templates/[id]/route");
    const res = await detailRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "missing-template" }),
    });

    expect(res.status).toBe(404);
  });

  test("template POST, PATCH, and apply route dispatch to the service layer", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession("TENANT_OWNER"));
    listKpiTemplatesMock.mockResolvedValue([{ id: "system-template" }]);
    getKpiTemplateMock.mockResolvedValue({ id: "template-1" });
    createKpiTemplateMock.mockResolvedValue({
      status: "success",
      message: "Created",
      id: "template-1",
    });
    updateKpiTemplateMock.mockResolvedValue({
      status: "success",
      message: "Updated",
      id: "template-1",
    });
    applyTemplateToKpiMock.mockResolvedValue({
      status: "success",
      message: "Applied",
      id: "kpi-1",
    });

    const collectionRoute = await import("@/app/api/tenant/kra-kpi/kpi-templates/route");
    const detailRoute = await import("@/app/api/tenant/kra-kpi/kpi-templates/[id]/route");
    const applyRoute = await import("@/app/api/tenant/kra-kpi/kpi-templates/[id]/apply/route");

    const listRes = await collectionRoute.GET();
    expect(listRes.status).toBe(200);

    const createRes = await collectionRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          code: "TEMP_1",
          name: "Temp",
          payload: {
            definition: {
              kraDefinitionId: "kra-1",
              title: "Builder KPI",
              measurementType: "NUMERIC",
              weightage: 10,
              allocationType: "INDIVIDUAL",
              startingUnitId: "unit-1",
            },
          },
        }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(createRes.status).toBe(201);

    const patchRes = await detailRoute.PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ name: "Updated Template" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "template-1" }) },
    );
    expect(patchRes.status).toBe(200);

    const applyRes = await applyRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          kraDefinitionId: "kra-1",
          titleOverride: "Applied KPI",
          startingUnitId: "unit-1",
        }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "template-1" }) },
    );
    expect(applyRes.status).toBe(200);
    expect(applyTemplateToKpiMock).toHaveBeenCalledWith(
      "tenant-1",
      "template-1",
      {
        kraDefinitionId: "kra-1",
        titleOverride: "Applied KPI",
        startingUnitId: "unit-1",
      },
      "user-1",
      "TENANT_OWNER",
    );
  });
});
