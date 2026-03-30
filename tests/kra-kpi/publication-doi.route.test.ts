import { beforeEach, describe, expect, test, vi } from "vitest";

const getServerSessionMock = vi.fn();
const lookupPublicationByDoiMock = vi.fn();
const isPublicationLookupErrorMock = vi.fn();

vi.mock("next-auth", () => ({
  default: vi.fn(() => ({})),
  getServerSession: getServerSessionMock,
}));

vi.mock("@/lib/kra-kpi/publication-doi-service", () => ({
  lookupPublicationByDoi: lookupPublicationByDoiMock,
  isPublicationLookupError: isPublicationLookupErrorMock,
}));

function tenantSession() {
  return {
    user: {
      id: "user-1",
      tenantId: "tenant-1",
      tenantName: "Galgotias University",
      role: "TENANT_USER",
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  isPublicationLookupErrorMock.mockReturnValue(false);
});

describe("publication DOI route", () => {
  test("returns 403 when tenant session is missing", async () => {
    getServerSessionMock.mockResolvedValue(null);
    const route = await import("@/app/api/tenant/kra-kpi/publication-doi/route");

    const response = await route.POST(
      new Request("http://localhost/api/tenant/kra-kpi/publication-doi", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ doi: "10.1000/example" }),
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      status: "error",
      message: "You do not have tenant access.",
    });
  });

  test("returns 400 when the request body is invalid", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession());
    const route = await import("@/app/api/tenant/kra-kpi/publication-doi/route");

    const response = await route.POST(
      new Request("http://localhost/api/tenant/kra-kpi/publication-doi", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ doi: "" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      status: "error",
      message: "Invalid request body.",
    });
  });

  test("returns the DOI lookup payload for authenticated tenant users", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession());
    lookupPublicationByDoiMock.mockResolvedValue({
      normalizedDoi: "10.1000/example",
      fields: { doi: "10.1000/example", paperTitle: "Paper Title" },
      authors: [],
      meta: {
        normalizedDoi: "10.1000/example",
        source: "crossref",
        fetchedAt: "2026-03-30T00:00:00.000Z",
        rawPublicationDate: "2025-04",
        issn: "1111-2222",
        issnList: ["1111-2222"],
        landingUrl: "https://example.org/landing",
        pdfUrl: "https://example.org/paper.pdf",
        filledFieldKeys: ["doi", "paperTitle"],
        missingFieldKeys: ["publicationDate"],
        warnings: ["Only a partial publication date was available from DOI metadata."],
      },
      filledFieldKeys: ["doi", "paperTitle"],
      missingFieldKeys: ["publicationDate"],
      warnings: ["Only a partial publication date was available from DOI metadata."],
    });

    const route = await import("@/app/api/tenant/kra-kpi/publication-doi/route");
    const response = await route.POST(
      new Request("http://localhost/api/tenant/kra-kpi/publication-doi", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ doi: "10.1000/example" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(lookupPublicationByDoiMock).toHaveBeenCalledWith({
      doi: "10.1000/example",
      tenantName: "Galgotias University",
    });

    const body = await response.json();
    expect(body.status).toBe("success");
    expect(body.message).toBe("Auto-filled 2 fields; 1 still need manual entry.");
    expect(body.normalizedDoi).toBe("10.1000/example");
    expect(body.meta.source).toBe("crossref");
  });

  test("maps publication lookup errors to their service-provided HTTP status", async () => {
    getServerSessionMock.mockResolvedValue(tenantSession());
    lookupPublicationByDoiMock.mockRejectedValue({
      status: 404,
      message: "DOI not found in Crossref or OpenAlex.",
    });
    isPublicationLookupErrorMock.mockReturnValue(true);

    const route = await import("@/app/api/tenant/kra-kpi/publication-doi/route");
    const response = await route.POST(
      new Request("http://localhost/api/tenant/kra-kpi/publication-doi", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ doi: "10.1000/missing" }),
      }),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      status: "error",
      message: "DOI not found in Crossref or OpenAlex.",
    });
  });
});
