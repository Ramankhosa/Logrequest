import { beforeEach, describe, expect, test, vi } from "vitest";

const getServerSessionMock = vi.fn();
const listJournalCatalogRecordsMock = vi.fn();
const previewJournalImportMock = vi.fn();
const listJournalImportBatchesMock = vi.fn();
const getJournalCatalogRecordMock = vi.fn();
const updateJournalCatalogRecordMock = vi.fn();
const archiveJournalCatalogRecordMock = vi.fn();
const restoreJournalCatalogRecordMock = vi.fn();
const createTenantJournalOverrideMock = vi.fn();
const confirmJournalImportBatchMock = vi.fn();
const generateJournalTemplateWorkbookMock = vi.fn();

vi.mock("next-auth", () => ({
  default: vi.fn(() => ({})),
  getServerSession: getServerSessionMock,
}));

vi.mock("@/lib/journals/service", () => ({
  listJournalCatalogRecords: listJournalCatalogRecordsMock,
  previewJournalImport: previewJournalImportMock,
  listJournalImportBatches: listJournalImportBatchesMock,
  getJournalCatalogRecord: getJournalCatalogRecordMock,
  updateJournalCatalogRecord: updateJournalCatalogRecordMock,
  archiveJournalCatalogRecord: archiveJournalCatalogRecordMock,
  restoreJournalCatalogRecord: restoreJournalCatalogRecordMock,
  createTenantJournalOverride: createTenantJournalOverrideMock,
  confirmJournalImportBatch: confirmJournalImportBatchMock,
}));

vi.mock("@/lib/journals/parser", () => ({
  generateJournalTemplateWorkbook: generateJournalTemplateWorkbookMock,
}));

function superadminSession() {
  return {
    user: {
      id: "user-superadmin",
      isSuperadmin: true,
    },
  };
}

function tenantAdminSession(role: "TENANT_OWNER" | "TENANT_ADMIN" = "TENANT_ADMIN") {
  return {
    user: {
      id: "user-admin",
      tenantId: "tenant-1",
      role,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("journal routes", () => {
  test("superadmin catalog route returns 403 without a superadmin session", async () => {
    getServerSessionMock.mockResolvedValue(null);
    const route = await import("@/app/api/superadmin/journals/route");

    const response = await route.GET(
      new Request("http://localhost/api/superadmin/journals"),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      status: "error",
      message: "Superadmin access required.",
    });
  });

  test("superadmin catalog route forwards parsed filters to the service", async () => {
    getServerSessionMock.mockResolvedValue(superadminSession());
    listJournalCatalogRecordsMock.mockResolvedValue({
      rows: [],
      total: 0,
      page: 1,
      pageSize: 25,
      facets: {
        years: [2024],
        quartiles: ["Q1"],
        types: ["journal"],
        countries: ["India"],
        regions: ["Southern Asia"],
        publishers: ["Alpha Press"],
      },
    });

    const route = await import("@/app/api/superadmin/journals/route");
    const response = await route.GET(
      new Request(
        "http://localhost/api/superadmin/journals?sourceYear=2024&search=alpha",
      ),
    );

    expect(response.status).toBe(200);
    expect(listJournalCatalogRecordsMock).toHaveBeenCalledWith(
      { scope: "GLOBAL" },
      expect.objectContaining({
        sourceYear: 2024,
        search: "alpha",
      }),
    );
  });

  test("tenant template route requires a tenant admin and returns the workbook", async () => {
    getServerSessionMock.mockResolvedValue(tenantAdminSession("TENANT_OWNER"));
    generateJournalTemplateWorkbookMock.mockReturnValue(Buffer.from("xlsx"));

    const route = await import(
      "@/app/api/tenant/kra-kpi/journals/import/template/route"
    );
    const response = await route.GET(
      new Request(
        "http://localhost/api/tenant/kra-kpi/journals/import/template?sourceYear=2024",
      ),
    );

    expect(response.status).toBe(200);
    expect(generateJournalTemplateWorkbookMock).toHaveBeenCalledWith(2024);
    expect(response.headers.get("content-disposition")).toContain(
      "journal-template-2024.xlsx",
    );
  });

  test("tenant override route rejects non-admin tenant users", async () => {
    getServerSessionMock.mockResolvedValue({
      user: {
        id: "user-1",
        tenantId: "tenant-1",
        role: "TENANT_USER",
      },
    });

    const route = await import(
      "@/app/api/tenant/kra-kpi/journals/[id]/override/route"
    );
    const response = await route.POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "journal-1" }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      status: "error",
      message: "You do not have permission to manage journals.",
    });
  });

  test("tenant override route calls the service for admins", async () => {
    getServerSessionMock.mockResolvedValue(tenantAdminSession());
    createTenantJournalOverrideMock.mockResolvedValue({
      status: "success",
      message: "Tenant override created from the global journal row.",
      id: "tenant-record-1",
    });

    const route = await import(
      "@/app/api/tenant/kra-kpi/journals/[id]/override/route"
    );
    const response = await route.POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "journal-1" }),
    });

    expect(response.status).toBe(200);
    expect(createTenantJournalOverrideMock).toHaveBeenCalledWith({
      recordId: "journal-1",
      tenantId: "tenant-1",
      actorUserId: "user-admin",
      actorRole: "TENANT_ADMIN",
    });
  });
});
