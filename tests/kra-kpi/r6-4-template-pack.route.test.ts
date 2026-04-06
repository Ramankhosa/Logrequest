import { beforeEach, describe, expect, test, vi } from "vitest";

const getServerSessionMock = vi.fn();
const applyTemplatePackToKraMock = vi.fn();

vi.mock("next-auth", () => ({
  default: vi.fn(() => ({})),
  getServerSession: getServerSessionMock,
}));

vi.mock("@/lib/kra-kpi/kpi-template-service", () => ({
  applyTemplatePackToKra: applyTemplatePackToKraMock,
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

describe("R6.4 KPI starter pack route", () => {
  test("returns 403 when the session is missing", async () => {
    getServerSessionMock.mockResolvedValue(null);

    const route = await import("@/app/api/tenant/kra-kpi/kpi-template-packs/apply/route");
    const response = await route.POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          kraDefinitionId: "kra-1",
          starterPackKey: "NAAC_UNIVERSITY_2019_FACULTY_STARTER",
          startingUnitId: "unit-1",
          templateIds: ["template-1"],
        }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(403);
  });

  test("dispatches a valid bulk apply request to the service layer", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession("TENANT_OWNER"));
    applyTemplatePackToKraMock.mockResolvedValue({
      status: "success",
      message: "Created 2 starter KPIs.",
      createdCount: 2,
      createdKpiIds: ["kpi-1", "kpi-2"],
      skippedDuplicates: [],
      failedTemplates: [],
    });

    const route = await import("@/app/api/tenant/kra-kpi/kpi-template-packs/apply/route");
    const response = await route.POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          kraDefinitionId: "kra-1",
          starterPackKey: "NAAC_UNIVERSITY_2019_FACULTY_STARTER",
          startingUnitId: "unit-1",
          templateIds: ["template-1", "template-2"],
        }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(200);
    expect(applyTemplatePackToKraMock).toHaveBeenCalledWith(
      "tenant-1",
      {
        kraDefinitionId: "kra-1",
        starterPackKey: "NAAC_UNIVERSITY_2019_FACULTY_STARTER",
        startingUnitId: "unit-1",
        templateIds: ["template-1", "template-2"],
      },
      "user-1",
      "TENANT_OWNER",
    );
  });

  test("rejects malformed request bodies", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession("TENANT_OWNER"));

    const route = await import("@/app/api/tenant/kra-kpi/kpi-template-packs/apply/route");
    const response = await route.POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          kraDefinitionId: "kra-1",
          starterPackKey: "",
          startingUnitId: "unit-1",
          templateIds: [],
        }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(400);
  });
});
