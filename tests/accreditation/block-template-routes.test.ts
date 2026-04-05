import { beforeEach, describe, expect, test, vi } from "vitest";

const getServerSessionMock = vi.fn();

const listTenantVersionBlocksMock = vi.fn();
const createTenantVersionBlockMock = vi.fn();
const updateTenantVersionBlockMock = vi.fn();
const validateTenantVersionBlocksMock = vi.fn();
const publishTenantVersionBlocksMock = vi.fn();
const forkGlobalVersionToTenantDraftMock = vi.fn();

const listSuperadminVersionBlocksMock = vi.fn();
const createSuperadminVersionBlockMock = vi.fn();
const updateSuperadminVersionBlockMock = vi.fn();
const validateSuperadminVersionBlocksMock = vi.fn();
const publishSuperadminVersionBlocksMock = vi.fn();
const hasTenantFeatureEnabledMock = vi.fn();

vi.mock("next-auth", () => ({
  default: vi.fn(() => ({})),
  getServerSession: getServerSessionMock,
}));

vi.mock("@/lib/accreditation/block-template-service", () => ({
  listTenantVersionBlocks: listTenantVersionBlocksMock,
  createTenantVersionBlock: createTenantVersionBlockMock,
  updateTenantVersionBlock: updateTenantVersionBlockMock,
  validateTenantVersionBlocks: validateTenantVersionBlocksMock,
  publishTenantVersionBlocks: publishTenantVersionBlocksMock,
  forkGlobalVersionToTenantDraft: forkGlobalVersionToTenantDraftMock,
  listSuperadminVersionBlocks: listSuperadminVersionBlocksMock,
  createSuperadminVersionBlock: createSuperadminVersionBlockMock,
  updateSuperadminVersionBlock: updateSuperadminVersionBlockMock,
  validateSuperadminVersionBlocks: validateSuperadminVersionBlocksMock,
  publishSuperadminVersionBlocks: publishSuperadminVersionBlocksMock,
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

function tenantSession(role: "TENANT_OWNER" | "TENANT_ADMIN" | "TENANT_USER" = "TENANT_ADMIN") {
  return {
    user: {
      id: "user-1",
      tenantId: "tenant-1",
      role,
    },
  };
}

function superadminSession() {
  return {
    user: {
      id: "super-1",
      isSuperadmin: true,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  hasTenantFeatureEnabledMock.mockResolvedValue(true);
});

describe("accreditation block-template routes", () => {
  test("tenant block routes require tenant session and forward params/body", async () => {
    getServerSessionMock.mockResolvedValueOnce(null);

    const blocksRoute = await import(
      "@/app/api/tenant/accreditation/versions/[id]/blocks/route"
    );

    const denied = await blocksRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "version-1" }),
    });
    expect(denied.status).toBe(403);

    getServerSessionMock.mockResolvedValue(tenantSession("TENANT_OWNER"));
    listTenantVersionBlocksMock.mockResolvedValue({ status: "success", blocks: [], version: {} });
    createTenantVersionBlockMock.mockResolvedValue({ status: "success", block: { id: "block-1" } });
    updateTenantVersionBlockMock.mockResolvedValue({ status: "success", block: { id: "block-1" } });
    validateTenantVersionBlocksMock.mockResolvedValue({ status: "success", blockCount: 2 });
    publishTenantVersionBlocksMock.mockResolvedValue({ status: "success", publishedBlockCount: 2 });
    forkGlobalVersionToTenantDraftMock.mockResolvedValue({ status: "success", version: { id: "fork-1" } });

    const getResponse = await blocksRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "version-1" }),
    });
    expect(getResponse.status).toBe(200);
    expect(listTenantVersionBlocksMock).toHaveBeenCalledWith("tenant-1", "version-1");

    const invalidPost = await blocksRoute.POST(new Request("http://localhost", { method: "POST", body: "bad-json" }), {
      params: Promise.resolve({ id: "version-1" }),
    });
    expect(invalidPost.status).toBe(400);

    const postResponse = await blocksRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ blockCode: "CR1", title: "Research", blockType: "GROUP" }),
      }),
      { params: Promise.resolve({ id: "version-1" }) },
    );
    expect(postResponse.status).toBe(201);
    expect(createTenantVersionBlockMock).toHaveBeenCalledWith(
      "tenant-1",
      "version-1",
      expect.objectContaining({ blockCode: "CR1" }),
      "user-1",
      "TENANT_OWNER",
    );

    const blockRoute = await import(
      "@/app/api/tenant/accreditation/blocks/[id]/route"
    );
    const invalidPatch = await blockRoute.PATCH(
      new Request("http://localhost", { method: "PATCH", body: "bad-json" }),
      { params: Promise.resolve({ id: "block-1" }) },
    );
    expect(invalidPatch.status).toBe(400);

    const patchResponse = await blockRoute.PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Updated block" }),
      }),
      { params: Promise.resolve({ id: "block-1" }) },
    );
    expect(patchResponse.status).toBe(200);
    expect(updateTenantVersionBlockMock).toHaveBeenCalledWith(
      "tenant-1",
      "block-1",
      { title: "Updated block" },
      "user-1",
      "TENANT_OWNER",
    );

    const validateRoute = await import(
      "@/app/api/tenant/accreditation/versions/[id]/validate/route"
    );
    const publishRoute = await import(
      "@/app/api/tenant/accreditation/versions/[id]/publish/route"
    );
    const forkRoute = await import(
      "@/app/api/tenant/accreditation/versions/[id]/fork/route"
    );

    const validateResponse = await validateRoute.POST(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ id: "version-1" }),
    });
    expect(validateResponse.status).toBe(200);
    expect(validateTenantVersionBlocksMock).toHaveBeenCalledWith(
      "tenant-1",
      "version-1",
      "user-1",
      "TENANT_OWNER",
    );

    validateTenantVersionBlocksMock.mockResolvedValueOnce({ status: "error", message: "bad validate" });
    const invalidValidateResponse = await validateRoute.POST(
      new Request("http://localhost", { method: "POST" }),
      { params: Promise.resolve({ id: "version-1" }) },
    );
    expect(invalidValidateResponse.status).toBe(400);

    const publishResponse = await publishRoute.POST(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ id: "version-1" }),
    });
    expect(publishResponse.status).toBe(200);
    expect(publishTenantVersionBlocksMock).toHaveBeenCalledWith(
      "tenant-1",
      "version-1",
      "user-1",
      "TENANT_OWNER",
    );

    publishTenantVersionBlocksMock.mockResolvedValueOnce({ status: "error", message: "bad publish" });
    const invalidPublishResponse = await publishRoute.POST(
      new Request("http://localhost", { method: "POST" }),
      { params: Promise.resolve({ id: "version-1" }) },
    );
    expect(invalidPublishResponse.status).toBe(400);

    const forkResponse = await forkRoute.POST(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ id: "global-version-1" }),
    });
    expect(forkResponse.status).toBe(200);
    expect(forkGlobalVersionToTenantDraftMock).toHaveBeenCalledWith(
      "tenant-1",
      "global-version-1",
      "user-1",
      "TENANT_OWNER",
    );

    forkGlobalVersionToTenantDraftMock.mockResolvedValueOnce({ status: "error", message: "bad fork" });
    const invalidForkResponse = await forkRoute.POST(
      new Request("http://localhost", { method: "POST" }),
      { params: Promise.resolve({ id: "global-version-1" }) },
    );
    expect(invalidForkResponse.status).toBe(400);
  });

  test("superadmin block routes require superadmin session and forward params/body", async () => {
    getServerSessionMock.mockResolvedValueOnce(null);

    const blocksRoute = await import(
      "@/app/api/superadmin/accreditation/versions/[id]/blocks/route"
    );

    const denied = await blocksRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "version-1" }),
    });
    expect(denied.status).toBe(403);

    getServerSessionMock.mockResolvedValue(superadminSession());
    listSuperadminVersionBlocksMock.mockResolvedValue({ status: "success", blocks: [], version: {} });
    createSuperadminVersionBlockMock.mockResolvedValue({ status: "success", block: { id: "block-1" } });
    updateSuperadminVersionBlockMock.mockResolvedValue({ status: "success", block: { id: "block-1" } });
    validateSuperadminVersionBlocksMock.mockResolvedValue({ status: "success", blockCount: 2 });
    publishSuperadminVersionBlocksMock.mockResolvedValue({ status: "success", publishedBlockCount: 2 });

    const getResponse = await blocksRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "version-1" }),
    });
    expect(getResponse.status).toBe(200);
    expect(listSuperadminVersionBlocksMock).toHaveBeenCalledWith("version-1");

    const createResponse = await blocksRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ blockCode: "CR1", title: "Research", blockType: "GROUP" }),
      }),
      { params: Promise.resolve({ id: "version-1" }) },
    );
    expect(createResponse.status).toBe(201);
    expect(createSuperadminVersionBlockMock).toHaveBeenCalledWith(
      "version-1",
      expect.objectContaining({ blockCode: "CR1" }),
      "super-1",
    );

    const blockRoute = await import(
      "@/app/api/superadmin/accreditation/blocks/[id]/route"
    );
    const invalidPatch = await blockRoute.PATCH(
      new Request("http://localhost", { method: "PATCH", body: "bad-json" }),
      { params: Promise.resolve({ id: "block-1" }) },
    );
    expect(invalidPatch.status).toBe(400);

    const patchResponse = await blockRoute.PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Updated block" }),
      }),
      { params: Promise.resolve({ id: "block-1" }) },
    );
    expect(patchResponse.status).toBe(200);
    expect(updateSuperadminVersionBlockMock).toHaveBeenCalledWith(
      "block-1",
      { title: "Updated block" },
      "super-1",
    );

    const validateRoute = await import(
      "@/app/api/superadmin/accreditation/versions/[id]/validate/route"
    );
    const publishRoute = await import(
      "@/app/api/superadmin/accreditation/versions/[id]/publish/route"
    );

    const validateResponse = await validateRoute.POST(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ id: "version-1" }),
    });
    expect(validateResponse.status).toBe(200);
    expect(validateSuperadminVersionBlocksMock).toHaveBeenCalledWith("version-1", "super-1");

    validateSuperadminVersionBlocksMock.mockResolvedValueOnce({ status: "error", message: "bad validate" });
    const invalidValidateResponse = await validateRoute.POST(
      new Request("http://localhost", { method: "POST" }),
      { params: Promise.resolve({ id: "version-1" }) },
    );
    expect(invalidValidateResponse.status).toBe(400);

    const publishResponse = await publishRoute.POST(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ id: "version-1" }),
    });
    expect(publishResponse.status).toBe(200);
    expect(publishSuperadminVersionBlocksMock).toHaveBeenCalledWith("version-1", "super-1");

    publishSuperadminVersionBlocksMock.mockResolvedValueOnce({ status: "error", message: "bad publish" });
    const invalidPublishResponse = await publishRoute.POST(
      new Request("http://localhost", { method: "POST" }),
      { params: Promise.resolve({ id: "version-1" }) },
    );
    expect(invalidPublishResponse.status).toBe(400);
  });

  test("tenant block assistantConfig writes are rejected when copilot is disabled", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession("TENANT_OWNER"));
    hasTenantFeatureEnabledMock.mockResolvedValue(false);

    const blocksRoute = await import(
      "@/app/api/tenant/accreditation/versions/[id]/blocks/route"
    );
    const blockRoute = await import(
      "@/app/api/tenant/accreditation/blocks/[id]/route"
    );

    const createDenied = await blocksRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          blockCode: "CR1",
          title: "Research",
          blockType: "GROUP",
          assistantConfig: { mode: "STRICT" },
        }),
      }),
      { params: Promise.resolve({ id: "version-1" }) },
    );
    expect(createDenied.status).toBe(403);
    expect(createTenantVersionBlockMock).not.toHaveBeenCalled();

    const patchDenied = await blockRoute.PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          assistantConfig: { mode: "STRICT" },
        }),
      }),
      { params: Promise.resolve({ id: "block-1" }) },
    );
    expect(patchDenied.status).toBe(403);
    expect(updateTenantVersionBlockMock).not.toHaveBeenCalled();
  });
});
