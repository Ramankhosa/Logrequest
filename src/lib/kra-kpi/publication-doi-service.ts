import {
  PUBLICATION_MANAGED_FIELD_KEYS,
  publicationAffiliationMatchesTenantName,
  type PublicationLookupAuthor,
  type PublicationLookupResult,
  type PublicationLookupSource,
} from "@/lib/kra-kpi/publication-doi-shared";

const LOOKUP_TTL_MS = 24 * 60 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 8_000;

type ProviderFailureReason = "not_found" | "timeout" | "error" | "skipped";

type ProviderResponse<T> =
  | { ok: true; data: T }
  | { ok: false; reason: ProviderFailureReason; message: string };

type CrossrefWork = {
  DOI?: string;
  URL?: string;
  title?: string[];
  author?: Array<{
    given?: string;
    family?: string;
    sequence?: string;
    affiliation?: Array<{ name?: string }>;
    ORCID?: string;
  }>;
  ISSN?: string[];
  volume?: string;
  issue?: string;
  publisher?: string;
  issued?: { "date-parts"?: number[][] };
  "published-print"?: { "date-parts"?: number[][] };
  "published-online"?: { "date-parts"?: number[][] };
  "container-title"?: string[];
};

type OpenAlexWork = {
  doi?: string;
  display_name?: string;
  publication_date?: string;
  biblio?: {
    volume?: string;
    issue?: string;
  };
  primary_location?: {
    landing_page_url?: string | null;
    pdf_url?: string | null;
    source?: {
      display_name?: string | null;
      issn_l?: string | null;
      issn?: string[] | null;
    } | null;
  } | null;
  authorships?: Array<{
    author_position?: string | null;
    is_corresponding?: boolean | null;
    author?: {
      display_name?: string | null;
      orcid?: string | null;
    } | null;
    institutions?: Array<{
      display_name?: string | null;
      country_code?: string | null;
    }> | null;
    raw_affiliation_strings?: string[] | null;
  }>;
};

type UnpaywallWork = {
  best_oa_location?: {
    url_for_pdf?: string | null;
  } | null;
  oa_locations?: Array<{
    url_for_pdf?: string | null;
  }> | null;
};

type CrossrefAuthorRow = {
  name: string;
  givenName: string | null;
  familyName: string | null;
  sequence: string | null;
  affiliations: string[];
  orcid: string | null;
};

type OpenAlexAuthorRow = {
  name: string;
  position: string | null;
  isCorresponding: boolean;
  affiliations: string[];
  institutionCountry: string | null;
  orcid: string | null;
};

class PublicationLookupError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "PublicationLookupError";
    this.status = status;
  }
}

const lookupCache = new Map<
  string,
  { expiresAt: number; value: PublicationLookupResult }
>();
const inflightLookups = new Map<string, Promise<PublicationLookupResult>>();

function cloneLookupResult(result: PublicationLookupResult): PublicationLookupResult {
  return JSON.parse(JSON.stringify(result)) as PublicationLookupResult;
}

function buildUserAgent(product: string, email?: string | null) {
  return email?.trim()
    ? `${product} (${email.trim()})`
    : `${product}`;
}

function stripOrcid(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value
    .trim()
    .replace(/^https?:\/\/orcid\.org\//i, "")
    .trim();

  return normalized || null;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const next: string[] = [];

  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    if (seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    next.push(trimmed);
  }

  return next;
}

function normalizeDateParts(parts: number[] | null | undefined): string | null {
  if (!Array.isArray(parts) || parts.length === 0) {
    return null;
  }

  const [year, month, day] = parts;
  if (typeof year !== "number" || !Number.isFinite(year)) {
    return null;
  }

  if (typeof month === "number" && Number.isFinite(month)) {
    const monthValue = String(month).padStart(2, "0");
    if (typeof day === "number" && Number.isFinite(day)) {
      return `${year}-${monthValue}-${String(day).padStart(2, "0")}`;
    }
    return `${year}-${monthValue}`;
  }

  return String(year);
}

function pickFirstDate(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function extractCrossrefPublicationDate(work: CrossrefWork | null): string | null {
  if (!work) {
    return null;
  }

  return pickFirstDate(
    normalizeDateParts(work["published-print"]?.["date-parts"]?.[0]),
    normalizeDateParts(work["published-online"]?.["date-parts"]?.[0]),
    normalizeDateParts(work.issued?.["date-parts"]?.[0]),
  );
}

function isFullDate(value: string | null | undefined): boolean {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

function getCrossrefTitle(work: CrossrefWork | null): string | null {
  return uniqueStrings(work?.title ?? [])[0] ?? null;
}

function getCrossrefJournalName(work: CrossrefWork | null): string | null {
  return uniqueStrings([
    work?.["container-title"]?.[0],
    work?.publisher,
  ])[0] ?? null;
}

function getOpenAlexJournalName(work: OpenAlexWork | null): string | null {
  return uniqueStrings([
    work?.primary_location?.source?.display_name ?? null,
  ])[0] ?? null;
}

function mapCrossrefAuthors(work: CrossrefWork | null): CrossrefAuthorRow[] {
  if (!Array.isArray(work?.author)) {
    return [];
  }

  return work.author
    .map((author) => {
      const givenName = typeof author.given === "string" && author.given.trim()
        ? author.given.trim()
        : null;
      const familyName = typeof author.family === "string" && author.family.trim()
        ? author.family.trim()
        : null;
      const name = [givenName, familyName].filter(Boolean).join(" ").trim();
      if (!name) {
        return null;
      }

      return {
        name,
        givenName,
        familyName,
        sequence:
          typeof author.sequence === "string" && author.sequence.trim()
            ? author.sequence.trim()
            : null,
        affiliations: uniqueStrings(
          Array.isArray(author.affiliation)
            ? author.affiliation.map((row) => row?.name ?? null)
            : [],
        ),
        orcid: stripOrcid(author.ORCID),
      } satisfies CrossrefAuthorRow;
    })
    .filter((author): author is CrossrefAuthorRow => author != null);
}

function mapOpenAlexAuthors(work: OpenAlexWork | null): OpenAlexAuthorRow[] {
  if (!Array.isArray(work?.authorships)) {
    return [];
  }

  return work.authorships
    .map((authorship) => {
      const name =
        typeof authorship.author?.display_name === "string" &&
        authorship.author.display_name.trim()
          ? authorship.author.display_name.trim()
          : null;
      if (!name) {
        return null;
      }

      const institutions = Array.isArray(authorship.institutions)
        ? authorship.institutions
        : [];
      const rawAffiliations = Array.isArray(authorship.raw_affiliation_strings)
        ? authorship.raw_affiliation_strings
        : [];

      return {
        name,
        position:
          typeof authorship.author_position === "string" &&
          authorship.author_position.trim()
            ? authorship.author_position.trim()
            : null,
        isCorresponding: authorship.is_corresponding === true,
        affiliations: uniqueStrings([
          ...rawAffiliations,
          ...institutions.map((institution) => institution.display_name ?? null),
        ]),
        institutionCountry:
          typeof institutions[0]?.country_code === "string" &&
          institutions[0].country_code.trim()
            ? institutions[0].country_code.trim()
            : null,
        orcid: stripOrcid(authorship.author?.orcid),
      } satisfies OpenAlexAuthorRow;
    })
    .filter((author): author is OpenAlexAuthorRow => author != null);
}

function normalizeDoiNameKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mergePublicationAuthors(input: {
  crossrefAuthors: CrossrefAuthorRow[];
  openAlexAuthors: OpenAlexAuthorRow[];
  tenantName: string | null | undefined;
}): PublicationLookupAuthor[] {
  const { crossrefAuthors, openAlexAuthors, tenantName } = input;

  if (openAlexAuthors.length === 0) {
    return crossrefAuthors.map((author) => ({
      name: author.name,
      givenName: author.givenName,
      familyName: author.familyName,
      position: author.sequence === "first" ? "first" : null,
      sequence: author.sequence,
      isCorresponding: false,
      affiliations: author.affiliations,
      institutionCountry: null,
      orcid: author.orcid,
      affiliationMatchesTenantName: publicationAffiliationMatchesTenantName(
        author.affiliations,
        tenantName,
      ),
    }));
  }

  const unmatchedCrossref = new Set(crossrefAuthors.map((_, index) => index));
  const crossrefByName = new Map<string, number[]>();
  for (const [index, author] of crossrefAuthors.entries()) {
    const key = normalizeDoiNameKey(author.name);
    if (!key) {
      continue;
    }
    const current = crossrefByName.get(key) ?? [];
    current.push(index);
    crossrefByName.set(key, current);
  }

  const merged: PublicationLookupAuthor[] = [];
  for (const [index, author] of openAlexAuthors.entries()) {
    const normalizedKey = normalizeDoiNameKey(author.name);
    const exactMatchIndex = normalizedKey
      ? (crossrefByName.get(normalizedKey) ?? []).find((rowIndex) =>
          unmatchedCrossref.has(rowIndex),
        ) ?? null
      : null;
    const fallbackIndex =
      exactMatchIndex == null &&
      index < crossrefAuthors.length &&
      unmatchedCrossref.has(index)
        ? index
        : null;
    const crossrefIndex = exactMatchIndex ?? fallbackIndex;
    const crossrefAuthor =
      crossrefIndex != null ? crossrefAuthors[crossrefIndex] ?? null : null;

    if (crossrefIndex != null) {
      unmatchedCrossref.delete(crossrefIndex);
    }

    const affiliations = uniqueStrings([
      ...author.affiliations,
      ...(crossrefAuthor?.affiliations ?? []),
    ]);

    merged.push({
      name: author.name || crossrefAuthor?.name || "",
      givenName: crossrefAuthor?.givenName ?? null,
      familyName: crossrefAuthor?.familyName ?? null,
      position: author.position,
      sequence: crossrefAuthor?.sequence ?? null,
      isCorresponding: author.isCorresponding,
      affiliations,
      institutionCountry: author.institutionCountry,
      orcid: author.orcid ?? crossrefAuthor?.orcid ?? null,
      affiliationMatchesTenantName: publicationAffiliationMatchesTenantName(
        affiliations,
        tenantName,
      ),
    });
  }

  for (const index of Array.from(unmatchedCrossref).sort((left, right) => left - right)) {
    const author = crossrefAuthors[index];
    if (!author) {
      continue;
    }

    merged.push({
      name: author.name,
      givenName: author.givenName,
      familyName: author.familyName,
      position: author.sequence === "first" ? "first" : null,
      sequence: author.sequence,
      isCorresponding: false,
      affiliations: author.affiliations,
      institutionCountry: null,
      orcid: author.orcid,
      affiliationMatchesTenantName: publicationAffiliationMatchesTenantName(
        author.affiliations,
        tenantName,
      ),
    });
  }

  return merged;
}

function buildPdfUrl(input: {
  normalizedDoi: string;
  unpaywall: UnpaywallWork | null;
  openAlex: OpenAlexWork | null;
  landingUrl: string | null;
}): string {
  const oaPdfUrl =
    input.unpaywall?.best_oa_location?.url_for_pdf ??
    input.unpaywall?.oa_locations?.find((row) => typeof row?.url_for_pdf === "string")
      ?.url_for_pdf ??
    input.openAlex?.primary_location?.pdf_url ??
    input.landingUrl ??
    `https://doi.org/${input.normalizedDoi}`;

  return oaPdfUrl;
}

function normalizePublicationDoiFromProvider(
  normalizedDoi: string,
  crossref: CrossrefWork | null,
  openAlex: OpenAlexWork | null,
): string {
  return (
    normalizePublicationDoi(crossref?.DOI ?? null) ??
    normalizePublicationDoi(openAlex?.doi ?? null) ??
    normalizedDoi
  );
}

async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCrossrefWork(doi: string): Promise<ProviderResponse<CrossrefWork>> {
  const contactEmail = process.env.CROSSREF_EMAIL?.trim() || null;
  const url = new URL(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
  if (contactEmail) {
    url.searchParams.set("mailto", contactEmail);
  }

  try {
    const response = await fetchJsonWithTimeout(
      url.toString(),
      {
        headers: {
          Accept: "application/json",
          "User-Agent": buildUserAgent("Logrequest Publication DOI Lookup", contactEmail),
        },
      },
      PROVIDER_TIMEOUT_MS,
    );

    if (response.status === 404) {
      return {
        ok: false,
        reason: "not_found",
        message: "Crossref could not find this DOI.",
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        reason: "error",
        message: `Crossref responded with ${response.status}.`,
      };
    }

    const payload = (await response.json()) as { message?: CrossrefWork };
    if (!payload.message) {
      return {
        ok: false,
        reason: "error",
        message: "Crossref returned an empty response.",
      };
    }

    return { ok: true, data: payload.message };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        ok: false,
        reason: "timeout",
        message: "Crossref timed out after 8 seconds.",
      };
    }

    return {
      ok: false,
      reason: "error",
      message:
        error instanceof Error && error.message
          ? error.message
          : "Crossref lookup failed.",
    };
  }
}

async function fetchOpenAlexWork(doi: string): Promise<ProviderResponse<OpenAlexWork>> {
  const contactEmail = process.env.OPENALEX_EMAIL?.trim() || null;
  const url = new URL(
    `https://api.openalex.org/works/${encodeURIComponent(`https://doi.org/${doi}`)}`,
  );
  if (contactEmail) {
    url.searchParams.set("mailto", contactEmail);
  }

  try {
    const response = await fetchJsonWithTimeout(
      url.toString(),
      {
        headers: {
          Accept: "application/json",
          "User-Agent": buildUserAgent("Logrequest Publication DOI Lookup", contactEmail),
        },
      },
      PROVIDER_TIMEOUT_MS,
    );

    if (response.status === 404) {
      return {
        ok: false,
        reason: "not_found",
        message: "OpenAlex could not find this DOI.",
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        reason: "error",
        message: `OpenAlex responded with ${response.status}.`,
      };
    }

    return {
      ok: true,
      data: (await response.json()) as OpenAlexWork,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        ok: false,
        reason: "timeout",
        message: "OpenAlex timed out after 8 seconds.",
      };
    }

    return {
      ok: false,
      reason: "error",
      message:
        error instanceof Error && error.message
          ? error.message
          : "OpenAlex lookup failed.",
    };
  }
}

async function fetchUnpaywallWork(doi: string): Promise<ProviderResponse<UnpaywallWork>> {
  const contactEmail = process.env.UNPAYWALL_EMAIL?.trim() || null;
  if (!contactEmail) {
    return {
      ok: false,
      reason: "skipped",
      message: "Unpaywall email is not configured.",
    };
  }

  const url = new URL(`https://api.unpaywall.org/v2/${encodeURIComponent(doi)}`);
  url.searchParams.set("email", contactEmail);

  try {
    const response = await fetchJsonWithTimeout(
      url.toString(),
      {
        headers: {
          Accept: "application/json",
          "User-Agent": buildUserAgent("Logrequest Publication DOI Lookup", contactEmail),
        },
      },
      PROVIDER_TIMEOUT_MS,
    );

    if (response.status === 404) {
      return {
        ok: false,
        reason: "not_found",
        message: "Unpaywall does not have an entry for this DOI.",
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        reason: "error",
        message: `Unpaywall responded with ${response.status}.`,
      };
    }

    return {
      ok: true,
      data: (await response.json()) as UnpaywallWork,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        ok: false,
        reason: "timeout",
        message: "Unpaywall timed out after 8 seconds.",
      };
    }

    return {
      ok: false,
      reason: "error",
      message:
        error instanceof Error && error.message
          ? error.message
          : "Unpaywall lookup failed.",
    };
  }
}

function buildLookupResult(input: {
  normalizedDoi: string;
  source: PublicationLookupSource;
  crossref: CrossrefWork | null;
  openAlex: OpenAlexWork | null;
  unpaywall: UnpaywallWork | null;
  warnings: string[];
  tenantName: string | null | undefined;
}): PublicationLookupResult {
  const normalizedDoi = normalizePublicationDoiFromProvider(
    input.normalizedDoi,
    input.crossref,
    input.openAlex,
  );
  const authors = mergePublicationAuthors({
    crossrefAuthors: mapCrossrefAuthors(input.crossref),
    openAlexAuthors: mapOpenAlexAuthors(input.openAlex),
    tenantName: input.tenantName,
  });

  const issnList = uniqueStrings([
    input.openAlex?.primary_location?.source?.issn_l ?? null,
    ...(input.openAlex?.primary_location?.source?.issn ?? []),
    ...(input.crossref?.ISSN ?? []),
  ]);

  const issn = issnList[0] ?? null;
  const rawPublicationDate = pickFirstDate(
    isFullDate(input.openAlex?.publication_date ?? null)
      ? input.openAlex?.publication_date ?? null
      : null,
    extractCrossrefPublicationDate(input.crossref),
    input.openAlex?.publication_date ?? null,
  );

  const landingUrl = uniqueStrings([
    input.openAlex?.primary_location?.landing_page_url ?? null,
    input.crossref?.URL,
    `https://doi.org/${normalizedDoi}`,
  ])[0] ?? `https://doi.org/${normalizedDoi}`;

  const pdfUrl = buildPdfUrl({
    normalizedDoi,
    unpaywall: input.unpaywall,
    openAlex: input.openAlex,
    landingUrl,
  });

  const fields: PublicationLookupResult["fields"] = {
    doi: normalizedDoi,
  };

  const paperTitle = uniqueStrings([
    getCrossrefTitle(input.crossref),
    input.openAlex?.display_name,
  ])[0] ?? null;
  if (paperTitle) {
    fields.paperTitle = paperTitle;
  }

  const journalName = uniqueStrings([
    getCrossrefJournalName(input.crossref),
    getOpenAlexJournalName(input.openAlex),
  ])[0] ?? null;
  if (journalName) {
    fields.journalName = journalName;
  }

  if (issn) {
    fields.issn = issn;
  }

  const volume = uniqueStrings([
    input.crossref?.volume,
    input.openAlex?.biblio?.volume,
  ])[0] ?? null;
  if (volume) {
    fields.volume = volume;
  }

  const issue = uniqueStrings([
    input.crossref?.issue,
    input.openAlex?.biblio?.issue,
  ])[0] ?? null;
  if (issue) {
    fields.issue = issue;
  }

  if (rawPublicationDate && isFullDate(rawPublicationDate)) {
    fields.publicationDate = rawPublicationDate;
  }

  fields.pdfLink = pdfUrl;

  if (authors.length > 0) {
    fields.coAuthors = authors.map((author) => author.name).join(", ");
    fields.totalAuthors = authors.length;
  }

  const filledFieldKeys = PUBLICATION_MANAGED_FIELD_KEYS.filter((key) => {
    const value = fields[key];
    if (typeof value === "number") {
      return Number.isFinite(value);
    }
    return typeof value === "string" && value.trim().length > 0;
  });
  const missingFieldKeys = PUBLICATION_MANAGED_FIELD_KEYS.filter(
    (key) => !filledFieldKeys.includes(key),
  );

  const warnings = uniqueStrings([
    ...input.warnings,
    rawPublicationDate && !isFullDate(rawPublicationDate)
      ? "Only a partial publication date was available from DOI metadata."
      : null,
    !issn ? "ISSN was not available from DOI metadata." : null,
    missingFieldKeys.length > 0
      ? "Some fields could not be auto-filled from DOI metadata."
      : null,
  ]);

  return {
    normalizedDoi,
    fields,
    authors,
    meta: {
      normalizedDoi,
      source: input.source,
      fetchedAt: new Date().toISOString(),
      rawPublicationDate,
      issn,
      issnList,
      landingUrl,
      pdfUrl,
      filledFieldKeys,
      missingFieldKeys,
      warnings,
    },
    filledFieldKeys,
    missingFieldKeys,
    warnings,
  };
}

export function normalizePublicationDoi(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .replace(/[)\],;]+$/g, "")
    .replace(/\.+$/g, "")
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();

  if (!normalized) {
    return null;
  }

  return /^10\.\d{4,9}\/\S+$/i.test(normalized) ? normalized : null;
}

async function performPublicationLookup(input: {
  normalizedDoi: string;
  tenantName: string | null | undefined;
}): Promise<PublicationLookupResult> {
  const warnings: string[] = [];
  const crossrefResponse = await fetchCrossrefWork(input.normalizedDoi);

  if (crossrefResponse.ok) {
    const [openAlexResponse, unpaywallResponse] = await Promise.all([
      fetchOpenAlexWork(input.normalizedDoi),
      fetchUnpaywallWork(input.normalizedDoi),
    ]);

    if (!openAlexResponse.ok && openAlexResponse.reason !== "not_found") {
      warnings.push(openAlexResponse.message);
    }
    if (
      !unpaywallResponse.ok &&
      unpaywallResponse.reason !== "skipped" &&
      unpaywallResponse.reason !== "not_found"
    ) {
      warnings.push(unpaywallResponse.message);
    }

    return buildLookupResult({
      normalizedDoi: input.normalizedDoi,
      source: "crossref",
      crossref: crossrefResponse.data,
      openAlex: openAlexResponse.ok ? openAlexResponse.data : null,
      unpaywall: unpaywallResponse.ok ? unpaywallResponse.data : null,
      warnings,
      tenantName: input.tenantName,
    });
  }

  if (crossrefResponse.reason !== "not_found") {
    warnings.push(crossrefResponse.message);
  }

  const openAlexResponse = await fetchOpenAlexWork(input.normalizedDoi);
  if (!openAlexResponse.ok) {
    if (openAlexResponse.reason !== "not_found") {
      warnings.push(openAlexResponse.message);
    }

    if (crossrefResponse.reason === "not_found" || openAlexResponse.reason === "not_found") {
      throw new PublicationLookupError("DOI not found in Crossref or OpenAlex.", 404);
    }

    throw new PublicationLookupError(
      warnings[0] ?? "DOI metadata could not be fetched right now.",
      502,
    );
  }

  warnings.push(
    crossrefResponse.reason === "timeout"
      ? "Crossref timed out, so OpenAlex was used as the bibliographic source."
      : "Crossref metadata was unavailable, so OpenAlex was used as the bibliographic source.",
  );

  const unpaywallResponse = await fetchUnpaywallWork(input.normalizedDoi);
  if (
    !unpaywallResponse.ok &&
    unpaywallResponse.reason !== "skipped" &&
    unpaywallResponse.reason !== "not_found"
  ) {
    warnings.push(unpaywallResponse.message);
  }

  return buildLookupResult({
    normalizedDoi: input.normalizedDoi,
    source: "openalex",
    crossref: null,
    openAlex: openAlexResponse.data,
    unpaywall: unpaywallResponse.ok ? unpaywallResponse.data : null,
    warnings,
    tenantName: input.tenantName,
  });
}

export function clearPublicationDoiLookupCache() {
  lookupCache.clear();
  inflightLookups.clear();
}

export async function lookupPublicationByDoi(input: {
  doi: string;
  tenantName?: string | null;
}): Promise<PublicationLookupResult> {
  const normalizedDoi = normalizePublicationDoi(input.doi);
  if (!normalizedDoi) {
    throw new PublicationLookupError(
      "Invalid DOI format. Enter a DOI like 10.1038/nature12373.",
      400,
    );
  }

  const cached = lookupCache.get(normalizedDoi);
  if (cached && cached.expiresAt > Date.now()) {
    return cloneLookupResult(cached.value);
  }
  if (cached) {
    lookupCache.delete(normalizedDoi);
  }

  const inflight = inflightLookups.get(normalizedDoi);
  if (inflight) {
    return cloneLookupResult(await inflight);
  }

  const promise = performPublicationLookup({
    normalizedDoi,
    tenantName: input.tenantName ?? null,
  }).then((result) => {
    lookupCache.set(normalizedDoi, {
      expiresAt: Date.now() + LOOKUP_TTL_MS,
      value: cloneLookupResult(result),
    });
    return result;
  });

  inflightLookups.set(normalizedDoi, promise);

  try {
    return cloneLookupResult(await promise);
  } catch (error) {
    if (error instanceof PublicationLookupError) {
      throw error;
    }

    throw new PublicationLookupError(
      error instanceof Error && error.message
        ? error.message
        : "DOI metadata lookup failed.",
      500,
    );
  } finally {
    inflightLookups.delete(normalizedDoi);
  }
}

export function isPublicationLookupError(error: unknown): error is PublicationLookupError {
  return error instanceof PublicationLookupError;
}
