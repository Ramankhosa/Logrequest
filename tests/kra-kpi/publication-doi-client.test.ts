import { describe, expect, test } from "vitest";
import {
  applyPublicationLookupToFormData,
  buildPublicationContributorPrefill,
  getPublicationAuthorPreview,
  isPublicationLikeAchievementForm,
} from "@/lib/kra-kpi/publication-doi-client";
import type { AchievementFieldConfig, AchievementSubmissionConfig } from "@/lib/kra-kpi/shared";

const publicationFields: AchievementFieldConfig[] = [
  { key: "paperTitle", label: "Paper Title", type: "TEXT", required: true, sortOrder: 0 },
  { key: "doi", label: "DOI", type: "TEXT", required: false, sortOrder: 1 },
  { key: "publicationDate", label: "Publication Date", type: "DATE", required: false, sortOrder: 2 },
  { key: "totalAuthors", label: "Total Authors", type: "NUMBER", required: false, sortOrder: 3 },
];

const submissionConfig: AchievementSubmissionConfig = {
  participantMode: "OPTIONAL_TEAM",
  evidenceRequired: false,
  evidenceTypes: [],
  evidenceInstructions: null,
  applicableRoles: [
    {
      id: "role-first",
      code: "FIRST_AUTHOR",
      name: "First Author",
      defaultCreditPercent: 60,
      isDefault: false,
    },
    {
      id: "role-corresponding",
      code: "CORRESPONDING_AUTHOR",
      name: "Corresponding Author",
      defaultCreditPercent: 50,
      isDefault: false,
    },
    {
      id: "role-co",
      code: "CO_AUTHOR",
      name: "Co-Author",
      defaultCreditPercent: 20,
      isDefault: true,
    },
  ],
  allowExternalContributors: true,
  creditSumMode: "MUST_EQUAL_100",
  externalContributorFields: [
    { key: "name", label: "Name", type: "TEXT", required: true, sortOrder: 0 },
    { key: "affiliation", label: "Affiliation", type: "TEXT", required: true, sortOrder: 1 },
    {
      key: "scope",
      label: "Scope",
      type: "SELECT",
      required: true,
      sortOrder: 2,
      options: ["National", "International"],
    },
    { key: "orcid", label: "ORCID", type: "TEXT", required: false, sortOrder: 3 },
  ],
  contributorSelectorTags: ["FIRST_AUTHOR", "CORRESPONDING_AUTHOR"],
  manualCreditEntryEnabled: true,
};

describe("publication DOI client helpers", () => {
  test("detects publication-like forms by DOI plus mapped publication fields", () => {
    expect(isPublicationLikeAchievementForm(publicationFields)).toBe(true);
    expect(
      isPublicationLikeAchievementForm([
        { key: "doi", label: "DOI", type: "TEXT", required: false, sortOrder: 0 },
      ]),
    ).toBe(false);
  });

  test("applies DOI lookup fields only to visible managed keys and keeps partial dates as helper text", () => {
    const result = applyPublicationLookupToFormData({
      fields: publicationFields,
      currentValues: { doi: "10.old/example", extra: "keep me" },
      lookup: {
        normalizedDoi: "10.1000/example",
        fields: {
          doi: "10.1000/example",
          paperTitle: "Updated Paper Title",
          totalAuthors: 5,
        },
        authors: [],
        meta: {
          normalizedDoi: "10.1000/example",
          source: "crossref",
          fetchedAt: "2026-03-30T00:00:00.000Z",
          rawPublicationDate: "2025-04",
          issn: null,
          issnList: [],
          landingUrl: "https://doi.org/10.1000/example",
          pdfUrl: "https://doi.org/10.1000/example",
          filledFieldKeys: ["doi", "paperTitle", "totalAuthors"],
          missingFieldKeys: ["publicationDate"],
          warnings: [],
        },
        filledFieldKeys: ["doi", "paperTitle", "totalAuthors"],
        missingFieldKeys: ["publicationDate"],
        warnings: [],
      },
    });

    expect(result.formData.doi).toBe("10.1000/example");
    expect(result.formData.paperTitle).toBe("Updated Paper Title");
    expect(result.formData.totalAuthors).toBe(5);
    expect(result.formData.extra).toBe("keep me");
    expect(result.visibleFilledFieldKeys).toEqual(["doi", "paperTitle", "totalAuthors"]);
    expect(result.visibleMissingFieldKeys).toEqual(["publicationDate"]);
    expect(result.publicationDateNote).toBe(
      "Publication year/month found from DOI; enter the exact date manually.",
    );
    expect(result.formData.__publicationLookup).toBeTruthy();
  });

  test("matches users by normalized full name and prepares internal and external contributor drafts", () => {
    const prefill = buildPublicationContributorPrefill({
      authors: [
        {
          name: "Jose Nunez Smith",
          givenName: "Jose",
          familyName: "Nunez Smith",
          position: "first",
          sequence: "first",
          isCorresponding: true,
          affiliations: ["Galgotias University"],
          institutionCountry: "IN",
          orcid: "0000-0002-1234-5678",
          affiliationMatchesTenantName: true,
        },
        {
          name: "External Collaborator",
          givenName: "External",
          familyName: "Collaborator",
          position: "last",
          sequence: "additional",
          isCorresponding: false,
          affiliations: ["University of Oxford"],
          institutionCountry: "GB",
          orcid: null,
          affiliationMatchesTenantName: false,
        },
      ],
      users: [
        {
          id: "user-1",
          firstName: "José",
          lastName: "Nuñez-Smith",
        },
      ],
      submissionConfig,
    });

    expect(prefill.contributors).toHaveLength(2);
    expect(prefill.matchedInternalCount).toBe(1);
    expect(prefill.externalCount).toBe(1);
    expect(prefill.contributors[0]).toMatchObject({
      type: "INTERNAL",
      userId: "user-1",
      contributorRoleId: "role-corresponding",
      selectorTags: ["FIRST_AUTHOR", "CORRESPONDING_AUTHOR"],
      creditPercent: "50",
    });
    expect(prefill.contributors[1]).toMatchObject({
      type: "EXTERNAL",
      contributorRoleId: "role-co",
      creditPercent: "20",
    });
    expect(prefill.contributors[1]?.externalData).toMatchObject({
      name: "External Collaborator",
      affiliation: "University of Oxford",
      scope: "International",
    });
  });

  test("builds a truncated author preview for large DOI author lists", () => {
    const authors = Array.from({ length: 47 }, (_, index) => ({
      name: `Author ${index + 1}`,
      givenName: `Author`,
      familyName: `${index + 1}`,
      position: index === 0 ? "first" : "middle",
      sequence: index === 0 ? "first" : "additional",
      isCorresponding: index === 0,
      affiliations: ["Institution"],
      institutionCountry: "IN",
      orcid: null,
      affiliationMatchesTenantName: false,
    }));

    const collapsed = getPublicationAuthorPreview(authors, false);
    const expanded = getPublicationAuthorPreview(authors, true);

    expect(collapsed.visibleAuthors).toHaveLength(20);
    expect(collapsed.hiddenCount).toBe(27);
    expect(collapsed.isTruncated).toBe(true);
    expect(expanded.visibleAuthors).toHaveLength(47);
    expect(expanded.hiddenCount).toBe(0);
  });
});
