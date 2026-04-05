import { beforeEach, describe, expect, test, vi } from "vitest";

const getServerSessionMock = vi.fn();
const listEnabledTenantServiceCodesMock = vi.fn();
const listEnabledTenantFeatureCodesMock = vi.fn();
const setTenantFeatureEntitlementMock = vi.fn();

vi.mock("next-auth", () => ({
  default: vi.fn(() => ({})),
  getServerSession: getServerSessionMock,
}));

vi.mock("@/lib/tenant-services/service", () => ({
  listEnabledTenantServiceCodes: listEnabledTenantServiceCodesMock,
  listEnabledTenantFeatureCodes: listEnabledTenantFeatureCodesMock,
  setTenantFeatureEntitlement: setTenantFeatureEntitlementMock,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("tenant feature routes", () => {
  test("/api/tenant/services returns enabledServices and enabledFeatures", async () => {
    getServerSessionMock.mockResolvedValue({
      user: {
        id: "user-1",
        tenantId: "tenant-1",
      },
    });
    listEnabledTenantServiceCodesMock.mockResolvedValue(["ACCREDITATION"]);
    listEnabledTenantFeatureCodesMock.mockResolvedValue(["ACCREDITATION_COPILOT"]);

    const route = await import("@/app/api/tenant/services/route");
    const response = await route.GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "success",
      enabledServices: ["ACCREDITATION"],
      enabledFeatures: ["ACCREDITATION_COPILOT"],
    });
    expect(listEnabledTenantServiceCodesMock).toHaveBeenCalledWith("tenant-1");
    expect(listEnabledTenantFeatureCodesMock).toHaveBeenCalledWith("tenant-1");
  });

  test("superadmin can toggle accreditation copilot for a tenant", async () => {
    getServerSessionMock.mockResolvedValue({
      user: {
        id: "super-1",
        isSuperadmin: true,
      },
    });
    setTenantFeatureEntitlementMock.mockResolvedValue({
      status: "success",
      message: "ACCREDITATION_COPILOT feature enabled for Tenant Alpha.",
    });

    const route = await import(
      "@/app/api/superadmin/tenants/[tenantId]/features/[featureCode]/route"
    );
    const response = await route.PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      }),
      {
        params: Promise.resolve({
          tenantId: "tenant-1",
          featureCode: "ACCREDITATION_COPILOT",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(setTenantFeatureEntitlementMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        featureCode: "ACCREDITATION_COPILOT",
        enabled: true,
        actorUserId: "super-1",
        actorRole: "SUPERADMIN",
      }),
    );
  });

  test("superadmin feature route rejects non-superadmins and unsupported codes", async () => {
    const route = await import(
      "@/app/api/superadmin/tenants/[tenantId]/features/[featureCode]/route"
    );

    getServerSessionMock.mockResolvedValueOnce({
      user: {
        id: "tenant-admin-1",
        isSuperadmin: false,
      },
    });

    const denied = await route.PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      }),
      {
        params: Promise.resolve({
          tenantId: "tenant-1",
          featureCode: "ACCREDITATION_COPILOT",
        }),
      },
    );
    expect(denied.status).toBe(403);

    getServerSessionMock.mockResolvedValueOnce({
      user: {
        id: "super-1",
        isSuperadmin: true,
      },
    });

    const unsupported = await route.PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      }),
      {
        params: Promise.resolve({
          tenantId: "tenant-1",
          featureCode: "UNKNOWN_FEATURE",
        }),
      },
    );
    expect(unsupported.status).toBe(400);
    expect(setTenantFeatureEntitlementMock).not.toHaveBeenCalled();
  });
});
