import { beforeEach, describe, expect, test, vi } from "vitest";

const getServerSessionMock = vi.fn();
const importTemplateBundleMock = vi.fn();

vi.mock("next-auth", () => ({
  default: vi.fn(() => ({})),
  getServerSession: getServerSessionMock,
}));

vi.mock("@/lib/accreditation/template-bundle-import-service", () => ({
  importSuperadminAccreditationTemplateBundle: importTemplateBundleMock,
}));

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
});

describe("accreditation template bundle import route", () => {
  test("requires a superadmin session", async () => {
    getServerSessionMock.mockResolvedValue(null);

    const route = await import(
      "@/app/api/superadmin/accreditation/import-template/route"
    );

    const response = await route.POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bundleType: "accreditation-template" }),
      }),
    );

    expect(response.status).toBe(403);
  });

  test("rejects invalid json and forwards direct or nested bundle payloads", async () => {
    getServerSessionMock.mockResolvedValue(superadminSession());

    const route = await import(
      "@/app/api/superadmin/accreditation/import-template/route"
    );

    const invalid = await route.POST(
      new Request("http://localhost", {
        method: "POST",
        body: "bad-json",
      }),
    );
    expect(invalid.status).toBe(400);

    importTemplateBundleMock.mockResolvedValue({
      status: "success",
      body: { id: "body-1", code: "NAAC", name: "NAAC" },
      version: {
        id: "version-1",
        versionCode: "2026",
        versionName: "NAAC University",
        lifecycleStatus: "DRAFT",
      },
      importedCounts: {
        profileCount: 1,
        blockCount: 3,
        gradeBandCount: 0,
        thresholdRuleCount: 0,
      },
    });

    const directResponse = await route.POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          bundleType: "accreditation-template",
          schemaVersion: "v1",
        }),
      }),
    );
    expect(directResponse.status).toBe(201);
    expect(importTemplateBundleMock).toHaveBeenCalledWith(
      expect.objectContaining({ bundleType: "accreditation-template" }),
      "super-1",
    );

    const nestedResponse = await route.POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          bundle: {
            bundleType: "accreditation-template",
            schemaVersion: "v1",
          },
        }),
      }),
    );
    expect(nestedResponse.status).toBe(201);
    expect(importTemplateBundleMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ bundleType: "accreditation-template" }),
      "super-1",
    );
  });

  test("returns 409 for import conflicts and 400 for other import errors", async () => {
    getServerSessionMock.mockResolvedValue(superadminSession());

    const route = await import(
      "@/app/api/superadmin/accreditation/import-template/route"
    );

    importTemplateBundleMock.mockResolvedValueOnce({
      status: "error",
      message: "A global accreditation body with code NAAC already exists.",
    });
    const conflictResponse = await route.POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          bundleType: "accreditation-template",
          schemaVersion: "v1",
        }),
      }),
    );
    expect(conflictResponse.status).toBe(409);

    importTemplateBundleMock.mockResolvedValueOnce({
      status: "error",
      message: "Template bundles must define at least one profile.",
    });
    const validationResponse = await route.POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          bundleType: "accreditation-template",
          schemaVersion: "v1",
        }),
      }),
    );
    expect(validationResponse.status).toBe(400);
  });
});
