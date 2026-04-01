import {
  findBestEffectiveJournalRecordByIssn,
  type ResolvedJournalCatalogLookup,
} from "@/lib/journals/service";
import {
  applyPublicationJournalLookupToFormData,
  PUBLICATION_JOURNAL_LOOKUP_HIDDEN_KEY,
  PUBLICATION_JOURNAL_MANAGED_FIELD_KEYS,
  type PublicationJournalLookupFieldValue,
  type PublicationJournalLookupMeta,
  type PublicationJournalLookupResult,
} from "@/lib/kra-kpi/publication-journal-shared";
import { getPublicationLookupStoredData } from "@/lib/kra-kpi/publication-doi-shared";
import type { AchievementFieldConfig } from "@/lib/kra-kpi/shared";

function uniqueStrings(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const next: string[] = [];

  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    next.push(trimmed);
  }

  return next;
}

function extractYear(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1900 && value <= 2100) {
    return value;
  }

  if (typeof value === "string") {
    const match = value.trim().match(/\b(19|20)\d{2}\b/);
    if (match) {
      const year = Number(match[0]);
      return Number.isFinite(year) ? year : null;
    }

    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.getUTCFullYear();
    }
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.getUTCFullYear();
  }

  return null;
}

function extractRequestedSourceYear(
  formData: Record<string, unknown> | null | undefined,
): number | null {
  if (!formData) {
    return null;
  }

  const publicationDateYear = extractYear(formData.publicationDate);
  if (publicationDateYear != null) {
    return publicationDateYear;
  }

  const publicationLookup = getPublicationLookupStoredData(formData);
  return extractYear(publicationLookup?.rawPublicationDate ?? null);
}

function extractRequestedIssn(
  formData: Record<string, unknown> | null | undefined,
): string | null {
  if (!formData) {
    return null;
  }

  if (typeof formData.issn === "string" && formData.issn.trim()) {
    return formData.issn.trim();
  }

  const publicationLookup = getPublicationLookupStoredData(formData);
  return (
    publicationLookup?.issn ??
    publicationLookup?.issnList.find((value) => value.trim().length > 0) ??
    null
  );
}

function buildLookupMeta(input: {
  requestedIssn: string | null;
  requestedSourceYear: number | null;
  resolved?: ResolvedJournalCatalogLookup | null;
  warnings: string[];
}): PublicationJournalLookupMeta {
  const resolvedRecord = input.resolved?.record ?? null;

  return {
    requestedIssn: input.requestedIssn,
    requestedSourceYear: input.requestedSourceYear,
    resolvedSourceYear: input.resolved?.resolvedSourceYear ?? null,
    matchedExactly: input.resolved?.matchedExactly ?? false,
    resolutionStrategy: input.resolved?.resolutionStrategy ?? "NO_MATCH",
    recordId: resolvedRecord?.id ?? null,
    title: resolvedRecord?.title ?? null,
    matchedIssn: resolvedRecord?.issnPrimary ?? null,
    quartile: resolvedRecord?.sjrBestQuartile ?? null,
    sourceSystem: resolvedRecord?.sourceSystem ?? null,
    effectiveSource: resolvedRecord?.effectiveSource ?? null,
    policyStatus: resolvedRecord?.policyStatus ?? null,
    policyNote: resolvedRecord?.policyNote ?? null,
    categories: resolvedRecord?.categories ?? null,
    areas: resolvedRecord?.areas ?? null,
    warnings: input.warnings,
  };
}

function buildLookupFields(
  resolved: ResolvedJournalCatalogLookup | null,
): Partial<
  Record<
    (typeof PUBLICATION_JOURNAL_MANAGED_FIELD_KEYS)[number],
    PublicationJournalLookupFieldValue
  >
> {
  const record = resolved?.record ?? null;
  if (!record) {
    return {};
  }

  const fields: Partial<
    Record<
      (typeof PUBLICATION_JOURNAL_MANAGED_FIELD_KEYS)[number],
      PublicationJournalLookupFieldValue
    >
  > = {};

  const quartile = record.sjrBestQuartile?.trim() ?? null;
  if (quartile) {
    fields.journalQuartile = quartile;
    if (/^Q[1-4]$/i.test(quartile)) {
      fields.journalTier = quartile.toUpperCase();
    }
  }

  if (record.isJournalEligible) {
    fields.indexing = ["Scopus"];
    fields.scopusIndexed = true;
  }

  return fields;
}

function buildFilledFieldKeys(
  fields: Partial<
    Record<
      (typeof PUBLICATION_JOURNAL_MANAGED_FIELD_KEYS)[number],
      PublicationJournalLookupFieldValue
    >
  >,
) {
  return PUBLICATION_JOURNAL_MANAGED_FIELD_KEYS.filter((key) => {
    const value = fields[key];
    if (typeof value === "boolean") {
      return true;
    }
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    return typeof value === "string" && value.trim().length > 0;
  });
}

function isBlankValue(value: unknown) {
  if (value == null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function mergeLookupFields(
  currentValues: Record<string, unknown>,
  lookup: PublicationJournalLookupResult,
  mode: "fillMissing" | "overwrite",
) {
  const nextFormData: Record<string, unknown> = {
    ...currentValues,
    [PUBLICATION_JOURNAL_LOOKUP_HIDDEN_KEY]: lookup.meta,
  };

  for (const key of PUBLICATION_JOURNAL_MANAGED_FIELD_KEYS) {
    const value = lookup.fields[key];
    if (value == null) {
      continue;
    }
    if (mode === "fillMissing" && !isBlankValue(currentValues[key])) {
      continue;
    }
    nextFormData[key] = Array.isArray(value) ? [...value] : value;
  }

  return nextFormData;
}

export async function lookupPublicationJournalByFormData(input: {
  tenantId?: string | null;
  formData: Record<string, unknown> | null | undefined;
}): Promise<PublicationJournalLookupResult | null> {
  const requestedIssn = extractRequestedIssn(input.formData);
  const requestedSourceYear = extractRequestedSourceYear(input.formData);
  const warnings: string[] = [];

  if (!requestedIssn && !requestedSourceYear) {
    return null;
  }

  if (!requestedIssn) {
    warnings.push(
      "Journal catalog matching could not run because ISSN was not available.",
    );
  }
  if (requestedSourceYear == null) {
    warnings.push(
      "Journal catalog matching could not run because publication year was not available.",
    );
  }

  let resolved: ResolvedJournalCatalogLookup | null = null;
  if (requestedIssn && requestedSourceYear != null) {
    try {
      resolved = await findBestEffectiveJournalRecordByIssn({
        issn: requestedIssn,
        sourceYear: requestedSourceYear,
        tenantId: input.tenantId ?? null,
      });
    } catch (error) {
      warnings.push(
        error instanceof Error && error.message
          ? `Journal catalog lookup failed: ${error.message}`
          : "Journal catalog lookup failed.",
      );
    }

    if (!resolved && warnings.length === 0) {
      warnings.push(
        `No journal catalog record matched ISSN ${requestedIssn} for publication year ${requestedSourceYear}.`,
      );
    } else if (resolved && !resolved.matchedExactly) {
      const label =
        resolved.resolutionStrategy === "LATEST_PREVIOUS_YEAR"
          ? "the latest earlier year"
          : "the nearest later year";
      warnings.push(
        `No exact journal catalog entry was found for ${requestedSourceYear}; ${label} (${resolved.resolvedSourceYear}) was used instead.`,
      );
    }

    if (resolved?.record.policyStatus === "DISABLED") {
      warnings.push(
        resolved.record.policyNote
          ? `This journal is disabled by your institution: ${resolved.record.policyNote}`
          : "This journal is disabled by your institution.",
      );
    } else if (resolved?.record.policyStatus === "BLACKLISTED") {
      warnings.push(
        resolved.record.policyNote
          ? `This journal is blacklisted by your institution: ${resolved.record.policyNote}`
          : "This journal is blacklisted by your institution.",
      );
    }
  }

  const fields = buildLookupFields(resolved);
  const filledFieldKeys = buildFilledFieldKeys(fields);
  const missingFieldKeys = PUBLICATION_JOURNAL_MANAGED_FIELD_KEYS.filter(
    (key) => !filledFieldKeys.includes(key),
  );

  return {
    found: resolved != null,
    fields,
    meta: buildLookupMeta({
      requestedIssn,
      requestedSourceYear,
      resolved,
      warnings: uniqueStrings(warnings),
    }),
    filledFieldKeys,
    missingFieldKeys,
    warnings: uniqueStrings(warnings),
  };
}

export async function enrichPublicationJournalFormData(input: {
  tenantId?: string | null;
  formData: Record<string, unknown> | null | undefined;
  fields?: AchievementFieldConfig[] | null;
  mode?: "fillMissing" | "overwrite";
}): Promise<{
  formData: Record<string, unknown> | undefined;
  lookup: PublicationJournalLookupResult | null;
}> {
  const currentValues = input.formData
    ? { ...input.formData }
    : ({} as Record<string, unknown>);
  const lookup = await lookupPublicationJournalByFormData({
    tenantId: input.tenantId ?? null,
    formData: currentValues,
  });

  if (!lookup) {
    return {
      formData: input.formData ? { ...currentValues } : undefined,
      lookup: null,
    };
  }

  const mode = input.mode ?? "fillMissing";
  const nextFormData =
    input.fields && input.fields.length > 0
      ? applyPublicationJournalLookupToFormData({
          fields: input.fields,
          currentValues,
          lookup,
          mode,
        }).formData
      : mergeLookupFields(currentValues, lookup, mode);

  return {
    formData: nextFormData,
    lookup,
  };
}
