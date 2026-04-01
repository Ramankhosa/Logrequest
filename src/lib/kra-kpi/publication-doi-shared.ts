import { PUBLICATION_JOURNAL_LOOKUP_HIDDEN_KEY } from "@/lib/kra-kpi/publication-journal-shared";

const PUBLICATION_LOOKUP_HIDDEN_KEY = "__publicationLookup" as const;

export { PUBLICATION_LOOKUP_HIDDEN_KEY };

export const PUBLICATION_MANAGED_FIELD_KEYS = [
  "doi",
  "paperTitle",
  "journalName",
  "issn",
  "volume",
  "issue",
  "publicationDate",
  "pdfLink",
  "coAuthors",
  "totalAuthors",
] as const;

export type PublicationManagedFieldKey =
  (typeof PUBLICATION_MANAGED_FIELD_KEYS)[number];

export type PublicationLookupSource = "crossref" | "openalex";

export type PublicationLookupAuthor = {
  name: string;
  givenName: string | null;
  familyName: string | null;
  position: string | null;
  sequence: string | null;
  isCorresponding: boolean;
  affiliations: string[];
  institutionCountry: string | null;
  orcid: string | null;
  affiliationMatchesTenantName: boolean;
};

export type PublicationLookupMeta = {
  normalizedDoi: string;
  source: PublicationLookupSource;
  fetchedAt: string;
  rawPublicationDate: string | null;
  issn: string | null;
  issnList: string[];
  landingUrl: string | null;
  pdfUrl: string | null;
  filledFieldKeys: PublicationManagedFieldKey[];
  missingFieldKeys: PublicationManagedFieldKey[];
  warnings: string[];
};

export type PublicationLookupStoredData = PublicationLookupMeta & {
  authors: PublicationLookupAuthor[];
};

export type PublicationLookupResult = {
  normalizedDoi: string;
  fields: Partial<Record<PublicationManagedFieldKey, string | number>>;
  authors: PublicationLookupAuthor[];
  meta: PublicationLookupMeta;
  filledFieldKeys: PublicationManagedFieldKey[];
  missingFieldKeys: PublicationManagedFieldKey[];
  warnings: string[];
};

export function stripPublicationLookupMetadata(
  formData: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!formData) {
    return null;
  }

  const next = { ...formData };
  delete next[PUBLICATION_LOOKUP_HIDDEN_KEY];
  delete next[PUBLICATION_JOURNAL_LOOKUP_HIDDEN_KEY];
  return next;
}

export function getVisibleAchievementFormEntries(
  formData: Record<string, unknown> | null | undefined,
): Array<[string, unknown]> {
  const stripped = stripPublicationLookupMetadata(formData);
  return stripped ? Object.entries(stripped) : [];
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isPublicationManagedFieldKey(
  value: string,
): value is PublicationManagedFieldKey {
  return (PUBLICATION_MANAGED_FIELD_KEYS as readonly string[]).includes(value);
}

function parseAuthor(
  value: unknown,
): PublicationLookupAuthor | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const row = value as Record<string, unknown>;
  if (typeof row.name !== "string" || row.name.trim().length === 0) {
    return null;
  }

  return {
    name: row.name.trim(),
    givenName:
      typeof row.givenName === "string" && row.givenName.trim()
        ? row.givenName.trim()
        : null,
    familyName:
      typeof row.familyName === "string" && row.familyName.trim()
        ? row.familyName.trim()
        : null,
    position:
      typeof row.position === "string" && row.position.trim()
        ? row.position.trim()
        : null,
    sequence:
      typeof row.sequence === "string" && row.sequence.trim()
        ? row.sequence.trim()
        : null,
    isCorresponding: row.isCorresponding === true,
    affiliations: toStringArray(row.affiliations),
    institutionCountry:
      typeof row.institutionCountry === "string" && row.institutionCountry.trim()
        ? row.institutionCountry.trim()
        : null,
    orcid:
      typeof row.orcid === "string" && row.orcid.trim()
        ? row.orcid.trim()
        : null,
    affiliationMatchesTenantName: row.affiliationMatchesTenantName === true,
  };
}

export function getPublicationLookupStoredData(
  formData: Record<string, unknown> | null | undefined,
): PublicationLookupStoredData | null {
  if (!formData) {
    return null;
  }

  const raw = formData[PUBLICATION_LOOKUP_HIDDEN_KEY];
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const row = raw as Record<string, unknown>;
  if (
    typeof row.normalizedDoi !== "string" ||
    (row.source !== "crossref" && row.source !== "openalex")
  ) {
    return null;
  }

  const filledFieldKeys = toStringArray(row.filledFieldKeys).filter(
    isPublicationManagedFieldKey,
  );
  const missingFieldKeys = toStringArray(row.missingFieldKeys).filter(
    isPublicationManagedFieldKey,
  );
  const authors = Array.isArray(row.authors)
    ? row.authors
        .map((author) => parseAuthor(author))
        .filter((author): author is PublicationLookupAuthor => author != null)
    : [];

  return {
    normalizedDoi: row.normalizedDoi,
    source: row.source,
    fetchedAt:
      typeof row.fetchedAt === "string" && row.fetchedAt.trim()
        ? row.fetchedAt.trim()
        : new Date(0).toISOString(),
    rawPublicationDate:
      typeof row.rawPublicationDate === "string" && row.rawPublicationDate.trim()
        ? row.rawPublicationDate.trim()
        : null,
    issn:
      typeof row.issn === "string" && row.issn.trim() ? row.issn.trim() : null,
    issnList: toStringArray(row.issnList),
    landingUrl:
      typeof row.landingUrl === "string" && row.landingUrl.trim()
        ? row.landingUrl.trim()
        : null,
    pdfUrl:
      typeof row.pdfUrl === "string" && row.pdfUrl.trim()
        ? row.pdfUrl.trim()
        : null,
    filledFieldKeys,
    missingFieldKeys,
    warnings: toStringArray(row.warnings),
    authors,
  };
}

export function normalizePublicationPersonName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[.,\-']/g, " ")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTenantToken(value: string): string {
  const normalized = normalizePublicationPersonName(value);
  if (normalized.length > 5 && normalized.endsWith("s")) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

export function publicationAffiliationMatchesTenantName(
  affiliations: string[],
  tenantName: string | null | undefined,
): boolean {
  const normalizedTenantName = normalizePublicationPersonName(tenantName ?? "");
  if (!normalizedTenantName) {
    return false;
  }

  const tenantTokens = normalizedTenantName
    .split(" ")
    .map(normalizeTenantToken)
    .filter(
      (token) =>
        token.length > 2 &&
        token !== "university" &&
        token !== "college" &&
        token !== "department" &&
        token !== "school" &&
        token !== "institute" &&
        token !== "of" &&
        token !== "the" &&
        token !== "and",
    );

  return affiliations.some((affiliation) => {
    const normalizedAffiliation = normalizePublicationPersonName(affiliation);
    if (!normalizedAffiliation) {
      return false;
    }

    if (
      normalizedAffiliation.includes(normalizedTenantName) ||
      normalizedTenantName.includes(normalizedAffiliation)
    ) {
      return true;
    }

    const affiliationTokens = new Set(
      normalizedAffiliation
        .split(" ")
        .map(normalizeTenantToken)
        .filter(Boolean),
    );

    return tenantTokens.some((token) => affiliationTokens.has(token));
  });
}

export function isFullPublicationDate(value: string | null | undefined): boolean {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}
