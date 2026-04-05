import { beforeEach, describe, expect, test, vi } from "vitest";

const getServerSessionMock = vi.fn();
const listPlatformLlmModelsMock = vi.fn();
const createPlatformLlmModelMock = vi.fn();
const updatePlatformLlmModelMock = vi.fn();
const listPlatformLlmProfilesMock = vi.fn();
const createPlatformLlmProfileMock = vi.fn();
const updatePlatformLlmProfileMock = vi.fn();
const getHealthMock = vi.fn();
const getSuperadminVersionCopilotConfigMock = vi.fn();
const updateSuperadminVersionCopilotConfigMock = vi.fn();
const getTenantVersionCopilotConfigMock = vi.fn();
const updateTenantVersionCopilotConfigMock = vi.fn();
const hasTenantFeatureEnabledMock = vi.fn();

vi.mock("next-auth", () => ({
  default: vi.fn(() => ({})),
  getServerSession: getServerSessionMock,
}));

vi.mock("@/lib/llm/model-registry", () => ({
  listPlatformLlmModels: listPlatformLlmModelsMock,
  createPlatformLlmModel: createPlatformLlmModelMock,
  updatePlatformLlmModel: updatePlatformLlmModelMock,
  listPlatformLlmProfiles: listPlatformLlmProfilesMock,
  createPlatformLlmProfile: createPlatformLlmProfileMock,
  updatePlatformLlmProfile: updatePlatformLlmProfileMock,
}));

vi.mock("@/lib/llm/provider-router", () => ({
  llmProviderRouter: {
    getHealth: getHealthMock,
  },
}));

vi.mock("@/lib/accreditation/copilot-version-service", () => ({
  getSuperadminVersionCopilotConfig: getSuperadminVersionCopilotConfigMock,
  updateSuperadminVersionCopilotConfig: updateSuperadminVersionCopilotConfigMock,
  getTenantVersionCopilotConfig: getTenantVersionCopilotConfigMock,
  updateTenantVersionCopilotConfig: updateTenantVersionCopilotConfigMock,
}));

vi.mock("@/lib/tenant-services/service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tenant-services/service")>(
    "@/lib/tenant-services/service",
  );
  return {
    ...actual,
    hasTenantFeatureEnabled: hasTenantFeatureEnabledMock,
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  hasTenantFeatureEnabledMock.mockResolvedValue(true);
});

describe("llm config routes", () => {
  test("superadmin model routes require superadmin session and forward payloads", async () => {
    const modelsRoute = await import("@/app/api/superadmin/llm-models/route");

    getServerSessionMock.mockResolvedValueOnce(null);
    const denied = await modelsRoute.GET();
    expect(denied.status).toBe(403);

    getServerSessionMock.mockResolvedValue({ user: { id: "sa-1", isSuperadmin: true } });
    listPlatformLlmModelsMock.mockResolvedValue([{ id: "model-1", code: "gpt-5.2" }]);

    const listed = await modelsRoute.GET();
    expect(listed.status).toBe(200);
    expect(listPlatformLlmModelsMock).toHaveBeenCalledTimes(1);

    createPlatformLlmModelMock.mockResolvedValue({ status: "success", model: { id: "model-2" } });
    const created = await modelsRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "claude-3-5-sonnet" }),
      }),
    );
    expect(created.status).toBe(201);
    expect(createPlatformLlmModelMock).toHaveBeenCalledWith({ code: "claude-3-5-sonnet" });

    updatePlatformLlmModelMock.mockResolvedValue({ status: "success", model: { id: "model-2" } });
    const patched = await modelsRoute.PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "model-2", isActive: false }),
      }),
    );
    expect(patched.status).toBe(200);
    expect(updatePlatformLlmModelMock).toHaveBeenCalledWith("model-2", { isActive: false });
  });

  test("superadmin profile and health routes expose registry state", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "sa-1", isSuperadmin: true } });
    listPlatformLlmProfilesMock.mockResolvedValue([{ id: "profile-1", key: "naac-fast" }]);
    createPlatformLlmProfileMock.mockResolvedValue({ status: "success", profile: { id: "profile-2" } });
    updatePlatformLlmProfileMock.mockResolvedValue({ status: "success", profile: { id: "profile-2" } });
    getHealthMock.mockResolvedValue([{ providerCode: "openai", configured: true, healthy: true }]);

    const profilesRoute = await import("@/app/api/superadmin/llm-profiles/route");
    const healthRoute = await import("@/app/api/superadmin/llm-health/route");

    const listed = await profilesRoute.GET();
    expect(listed.status).toBe(200);
    expect(listPlatformLlmProfilesMock).toHaveBeenCalledTimes(1);

    const created = await profilesRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: "naac-fast", primaryModelId: "model-1" }),
      }),
    );
    expect(created.status).toBe(201);
    expect(createPlatformLlmProfileMock).toHaveBeenCalledWith({ key: "naac-fast", primaryModelId: "model-1" });

    const patched = await profilesRoute.PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "profile-2", isActive: false }),
      }),
    );
    expect(patched.status).toBe(200);
    expect(updatePlatformLlmProfileMock).toHaveBeenCalledWith("profile-2", { isActive: false });

    const health = await healthRoute.GET();
    expect(health.status).toBe(200);
    expect(getHealthMock).toHaveBeenCalledTimes(1);
  });

  test("version copilot config routes enforce access and forward version context", async () => {
    const tenantRoute = await import("@/app/api/tenant/accreditation/versions/[id]/copilot-config/route");
    const superadminRoute = await import("@/app/api/superadmin/accreditation/versions/[id]/copilot-config/route");

    getServerSessionMock.mockResolvedValueOnce(null);
    const tenantDenied = await tenantRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "version-1" }),
    });
    expect(tenantDenied.status).toBe(403);

    getServerSessionMock.mockResolvedValue({
      user: { id: "user-1", tenantId: "tenant-1", role: "TENANT_ADMIN" },
    });
    getTenantVersionCopilotConfigMock.mockResolvedValue({ status: "success", config: { versionId: "version-1" } });
    updateTenantVersionCopilotConfigMock.mockResolvedValue({ status: "success", config: { versionId: "version-1" } });

    const tenantListed = await tenantRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "version-1" }),
    });
    expect(tenantListed.status).toBe(200);
    expect(getTenantVersionCopilotConfigMock).toHaveBeenCalledWith("tenant-1", "version-1");

    const tenantPatched = await tenantRoute.PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ copilotMode: "LLM_ASSISTED", llmProfileId: "profile-1" }),
      }),
      { params: Promise.resolve({ id: "version-1" }) },
    );
    expect(tenantPatched.status).toBe(200);
    expect(updateTenantVersionCopilotConfigMock).toHaveBeenCalledWith(
      "tenant-1",
      "version-1",
      { copilotMode: "LLM_ASSISTED", llmProfileId: "profile-1" },
      "user-1",
      "TENANT_ADMIN",
    );

    getServerSessionMock.mockResolvedValue({ user: { id: "sa-1", isSuperadmin: true } });
    getSuperadminVersionCopilotConfigMock.mockResolvedValue({ status: "success", config: { versionId: "version-1" } });
    updateSuperadminVersionCopilotConfigMock.mockResolvedValue({ status: "success", config: { versionId: "version-1" } });

    const superadminListed = await superadminRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "version-1" }),
    });
    expect(superadminListed.status).toBe(200);
    expect(getSuperadminVersionCopilotConfigMock).toHaveBeenCalledWith("version-1");

    const superadminPatched = await superadminRoute.PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ copilotMode: "DETERMINISTIC_ONLY" }),
      }),
      { params: Promise.resolve({ id: "version-1" }) },
    );
    expect(superadminPatched.status).toBe(200);
    expect(updateSuperadminVersionCopilotConfigMock).toHaveBeenCalledWith("version-1", {
      copilotMode: "DETERMINISTIC_ONLY",
    });
  });

  test("tenant version copilot routes return 403 when the copilot feature is disabled", async () => {
    const tenantRoute = await import("@/app/api/tenant/accreditation/versions/[id]/copilot-config/route");

    getServerSessionMock.mockResolvedValue({
      user: { id: "user-1", tenantId: "tenant-1", role: "TENANT_ADMIN" },
    });
    hasTenantFeatureEnabledMock.mockResolvedValue(false);

    const deniedGet = await tenantRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "version-1" }),
    });
    expect(deniedGet.status).toBe(403);
    expect(getTenantVersionCopilotConfigMock).not.toHaveBeenCalled();

    const deniedPatch = await tenantRoute.PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ copilotMode: "LLM_ASSISTED" }),
      }),
      { params: Promise.resolve({ id: "version-1" }) },
    );
    expect(deniedPatch.status).toBe(403);
    expect(updateTenantVersionCopilotConfigMock).not.toHaveBeenCalled();
  });
});
