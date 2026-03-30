import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  clearPublicationDoiLookupCache,
  lookupPublicationByDoi,
  normalizePublicationDoi,
} from "@/lib/kra-kpi/publication-doi-service";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  clearPublicationDoiLookupCache();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  process.env.CROSSREF_EMAIL = "crossref@example.com";
  process.env.OPENALEX_EMAIL = "openalex@example.com";
  process.env.UNPAYWALL_EMAIL = "unpaywall@example.com";
});

afterEach(() => {
  clearPublicationDoiLookupCache();
});

describe("publication DOI service", () => {
  test("normalizes DOI input with prefixes and punctuation", () => {
    expect(
      normalizePublicationDoi(" https://doi.org/10.1000/Test-123. "),
    ).toBe("10.1000/test-123");
    expect(normalizePublicationDoi("doi:10.5555/ABC123;")).toBe("10.5555/abc123");
    expect(normalizePublicationDoi("not-a-doi")).toBeNull();
  });

  test("merges Crossref, OpenAlex, and Unpaywall metadata with the expected precedence", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          message: {
            DOI: "10.1000/example-1",
            title: ["Crossref Paper Title"],
            URL: "https://publisher.example/article",
            ISSN: ["1111-2222"],
            volume: "12",
            issue: "3",
            issued: { "date-parts": [[2025, 3]] },
            "container-title": ["Crossref Journal"],
            author: [
              {
                given: "Raman",
                family: "Kumar",
                sequence: "first",
                affiliation: [{ name: "Galgotias University" }],
                ORCID: "https://orcid.org/0000-0002-1234-5678",
              },
              {
                given: "Priya",
                family: "Sharma",
                sequence: "additional",
                affiliation: [{ name: "IIT Delhi" }],
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          doi: "https://doi.org/10.1000/example-1",
          display_name: "OpenAlex Paper Title",
          publication_date: "2025-03-21",
          biblio: { volume: "99", issue: "8" },
          primary_location: {
            landing_page_url: "https://openalex.example/landing",
            pdf_url: "https://openalex.example/paper.pdf",
            source: {
              display_name: "OpenAlex Journal",
              issn_l: "9999-8888",
              issn: ["9999-8888", "1111-2222"],
            },
          },
          authorships: [
            {
              author_position: "first",
              is_corresponding: true,
              author: {
                display_name: "Raman Kumar",
                orcid: "https://orcid.org/0000-0002-1234-5678",
              },
              institutions: [
                { display_name: "Galgotias University", country_code: "IN" },
              ],
              raw_affiliation_strings: ["Department of CSE, Galgotias University"],
            },
            {
              author_position: "last",
              is_corresponding: false,
              author: { display_name: "Priya Sharma" },
              institutions: [
                { display_name: "IIT Delhi", country_code: "IN" },
              ],
              raw_affiliation_strings: ["IIT Delhi"],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          best_oa_location: {
            url_for_pdf: "https://unpaywall.example/paper.pdf",
          },
        }),
      );

    const result = await lookupPublicationByDoi({
      doi: "https://doi.org/10.1000/example-1",
      tenantName: "Galgotias University",
    });

    expect(result.meta.source).toBe("crossref");
    expect(result.fields.paperTitle).toBe("Crossref Paper Title");
    expect(result.fields.journalName).toBe("Crossref Journal");
    expect(result.fields.issn).toBe("9999-8888");
    expect(result.fields.volume).toBe("12");
    expect(result.fields.issue).toBe("3");
    expect(result.fields.publicationDate).toBe("2025-03-21");
    expect(result.fields.pdfLink).toBe("https://unpaywall.example/paper.pdf");
    expect(result.fields.totalAuthors).toBe(2);
    expect(result.meta.rawPublicationDate).toBe("2025-03-21");
    expect(result.authors[0]).toMatchObject({
      name: "Raman Kumar",
      position: "first",
      isCorresponding: true,
      orcid: "0000-0002-1234-5678",
      affiliationMatchesTenantName: true,
    });
  });

  test("falls back to OpenAlex when Crossref times out", async () => {
    const abortError = new Error("timeout");
    abortError.name = "AbortError";

    fetchMock
      .mockRejectedValueOnce(abortError)
      .mockResolvedValueOnce(
        jsonResponse({
          doi: "https://doi.org/10.1000/example-2",
          display_name: "OpenAlex Only Paper",
          publication_date: "2025-02-11",
          primary_location: {
            landing_page_url: "https://openalex.example/only-paper",
            source: {
              display_name: "OpenAlex Only Journal",
              issn_l: "4444-5555",
              issn: ["4444-5555"],
            },
          },
          authorships: [
            {
              author_position: "first",
              is_corresponding: false,
              author: { display_name: "Lead Author" },
              institutions: [
                { display_name: "Galgotias University", country_code: "IN" },
              ],
              raw_affiliation_strings: ["Galgotias University"],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({}, 404));

    const result = await lookupPublicationByDoi({
      doi: "10.1000/example-2",
      tenantName: "Galgotias University",
    });

    expect(result.meta.source).toBe("openalex");
    expect(result.fields.paperTitle).toBe("OpenAlex Only Paper");
    expect(result.fields.publicationDate).toBe("2025-02-11");
    expect(result.warnings).toContain(
      "Crossref timed out, so OpenAlex was used as the bibliographic source.",
    );
  });

  test("keeps partial publication dates in metadata and leaves the visible date empty", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          message: {
            DOI: "10.1000/example-3",
            title: ["Sparse DOI Record"],
            issued: { "date-parts": [[2025]] },
            author: [{ given: "Only", family: "Author", sequence: "first" }],
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({}, 404))
      .mockResolvedValueOnce(jsonResponse({}, 404));

    const result = await lookupPublicationByDoi({
      doi: "10.1000/example-3",
      tenantName: "Galgotias University",
    });

    expect(result.meta.rawPublicationDate).toBe("2025");
    expect(result.fields.publicationDate).toBeUndefined();
    expect(result.missingFieldKeys).toContain("publicationDate");
    expect(result.warnings).toContain(
      "Only a partial publication date was available from DOI metadata.",
    );
  });

  test("deduplicates concurrent requests and serves cached results for repeated DOIs", async () => {
    fetchMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve(
                jsonResponse({
                  message: {
                    DOI: "10.1000/example-4",
                    title: ["Cached DOI Record"],
                    issued: { "date-parts": [[2025, 1, 12]] },
                    author: [{ given: "A", family: "Author", sequence: "first" }],
                  },
                }),
              );
            }, 10);
          }),
      )
      .mockResolvedValueOnce(jsonResponse({}, 404))
      .mockResolvedValueOnce(jsonResponse({}, 404));

    const [first, second] = await Promise.all([
      lookupPublicationByDoi({ doi: "10.1000/example-4", tenantName: "Tenant" }),
      lookupPublicationByDoi({ doi: "10.1000/example-4", tenantName: "Tenant" }),
    ]);

    const third = await lookupPublicationByDoi({
      doi: "10.1000/example-4",
      tenantName: "Tenant",
    });

    expect(first.normalizedDoi).toBe("10.1000/example-4");
    expect(second.normalizedDoi).toBe("10.1000/example-4");
    expect(third.normalizedDoi).toBe("10.1000/example-4");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
