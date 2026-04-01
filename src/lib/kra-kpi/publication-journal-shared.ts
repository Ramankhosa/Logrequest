import type {
  JournalEffectiveSource,
  JournalPolicyStatus,
  JournalImportSourceSystem,
} from "@/lib/journals/shared";
import type { AchievementFieldConfig } from "@/lib/kra-kpi/shared";

export const PUBLICATION_JOURNAL_LOOKUP_HIDDEN_KEY =
  "__journalLookup" as const;

export const PUBLICATION_JOURNAL_MANAGED_FIELD_KEYS = [
  "journalQuartile",
  "journalTier",
  "indexing",
  "scopusIndexed",
] as const;

export type PublicationJournalManagedFieldKey =
  (typeof PUBLICATION_JOURNAL_MANAGED_FIELD_KEYS)[number];

export type PublicationJournalLookupResolutionStrategy =
  | "EXACT_YEAR"
  | "LATEST_PREVIOUS_YEAR"
  | "NEAREST_FUTURE_YEAR"
  | "NO_MATCH";

export type PublicationJournalLookupFieldValue =
  | string
  | boolean
  | string[];

export type PublicationJournalLookupMeta = {
  requestedIssn: string | null;
  requestedSourceYear: number | null;
  resolvedSourceYear: number | null;
  matchedExactly: boolean;
  resolutionStrategy: PublicationJournalLookupResolutionStrategy;
  recordId: string | null;
  title: string | null;
  matchedIssn: string | null;
  quartile: string | null;
  sourceSystem: JournalImportSourceSystem | null;
  effectiveSource: JournalEffectiveSource | null;
  policyStatus: JournalPolicyStatus | null;
  policyNote: string | null;
  categories: string | null;
  areas: string | null;
  warnings: string[];
};

export type PublicationJournalLookupStoredData = PublicationJournalLookupMeta;

export type PublicationJournalLookupResult = {
  found: boolean;
  fields: Partial<
    Record<PublicationJournalManagedFieldKey, PublicationJournalLookupFieldValue>
  >;
  meta: PublicationJournalLookupMeta;
  filledFieldKeys: PublicationJournalManagedFieldKey[];
  missingFieldKeys: PublicationJournalManagedFieldKey[];
  warnings: string[];
};

type ApplyMode = "fillMissing" | "overwrite";

export type PublicationJournalLookupApplyResult = {
  formData: Record<string, unknown>;
  visibleFilledFieldKeys: PublicationJournalManagedFieldKey[];
  visibleMissingFieldKeys: PublicationJournalManagedFieldKey[];
};

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isPublicationJournalManagedFieldKey(
  value: string,
): value is PublicationJournalManagedFieldKey {
  return (PUBLICATION_JOURNAL_MANAGED_FIELD_KEYS as readonly string[]).includes(
    value,
  );
}

function isBlankValue(value: unknown) {
  if (value == null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function getFieldMap(fields: AchievementFieldConfig[]) {
  return new Map(fields.map((field) => [field.key, field]));
}

function getVisibleManagedFieldKeys(
  fields: AchievementFieldConfig[],
): PublicationJournalManagedFieldKey[] {
  const fieldMap = getFieldMap(fields);
  return PUBLICATION_JOURNAL_MANAGED_FIELD_KEYS.filter((key) =>
    fieldMap.has(key),
  );
}

function normalizeFieldValueForField(
  field: AchievementFieldConfig,
  value: PublicationJournalLookupFieldValue,
): unknown {
  switch (field.type) {
    case "BOOLEAN":
      return typeof value === "boolean" ? value : undefined;
    case "MULTI_SELECT":
      if (!Array.isArray(value)) {
        return undefined;
      }
      if (field.options && value.some((entry) => !field.options?.includes(entry))) {
        return undefined;
      }
      return value;
    case "SELECT": {
      const scalar = Array.isArray(value) ? value[0] : value;
      if (typeof scalar !== "string") {
        return undefined;
      }
      if (field.options && !field.options.includes(scalar)) {
        return undefined;
      }
      return scalar;
    }
    default: {
      const scalar = Array.isArray(value) ? value.join(", ") : value;
      if (typeof scalar === "boolean") {
        return scalar ? "Yes" : "No";
      }
      return typeof scalar === "string" ? scalar : undefined;
    }
  }
}

export function getPublicationJournalLookupStoredData(
  formData: Record<string, unknown> | null | undefined,
): PublicationJournalLookupStoredData | null {
  if (!formData) {
    return null;
  }

  const raw = formData[PUBLICATION_JOURNAL_LOOKUP_HIDDEN_KEY];
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const row = raw as Record<string, unknown>;
  const resolutionStrategy =
    row.resolutionStrategy === "EXACT_YEAR" ||
    row.resolutionStrategy === "LATEST_PREVIOUS_YEAR" ||
    row.resolutionStrategy === "NEAREST_FUTURE_YEAR" ||
    row.resolutionStrategy === "NO_MATCH"
      ? row.resolutionStrategy
      : "NO_MATCH";

  return {
    requestedIssn:
      typeof row.requestedIssn === "string" && row.requestedIssn.trim()
        ? row.requestedIssn.trim()
        : null,
    requestedSourceYear:
      typeof row.requestedSourceYear === "number" &&
      Number.isFinite(row.requestedSourceYear)
        ? row.requestedSourceYear
        : null,
    resolvedSourceYear:
      typeof row.resolvedSourceYear === "number" &&
      Number.isFinite(row.resolvedSourceYear)
        ? row.resolvedSourceYear
        : null,
    matchedExactly: row.matchedExactly === true,
    resolutionStrategy,
    recordId:
      typeof row.recordId === "string" && row.recordId.trim()
        ? row.recordId.trim()
        : null,
    title:
      typeof row.title === "string" && row.title.trim() ? row.title.trim() : null,
    matchedIssn:
      typeof row.matchedIssn === "string" && row.matchedIssn.trim()
        ? row.matchedIssn.trim()
        : null,
    quartile:
      typeof row.quartile === "string" && row.quartile.trim()
        ? row.quartile.trim()
        : null,
    sourceSystem:
      row.sourceSystem === "SCIMAGO_RAW" || row.sourceSystem === "TENANT_TEMPLATE"
        ? row.sourceSystem
        : null,
    policyStatus:
      row.policyStatus === "ALLOWED" ||
      row.policyStatus === "DISABLED" ||
      row.policyStatus === "BLACKLISTED"
        ? row.policyStatus
        : null,
    policyNote:
      typeof row.policyNote === "string" && row.policyNote.trim()
        ? row.policyNote.trim()
        : null,
    effectiveSource:
      row.effectiveSource === "GLOBAL" ||
      row.effectiveSource === "TENANT_ONLY" ||
      row.effectiveSource === "TENANT_OVERRIDE" ||
      row.effectiveSource === "ARCHIVED_GLOBAL" ||
      row.effectiveSource === "ARCHIVED_TENANT"
        ? row.effectiveSource
        : null,
    categories:
      typeof row.categories === "string" && row.categories.trim()
        ? row.categories.trim()
        : null,
    areas:
      typeof row.areas === "string" && row.areas.trim() ? row.areas.trim() : null,
    warnings: toStringArray(row.warnings),
  };
}

export function applyPublicationJournalLookupToFormData(input: {
  fields: AchievementFieldConfig[];
  currentValues: Record<string, unknown>;
  lookup: PublicationJournalLookupResult;
  mode?: ApplyMode;
}): PublicationJournalLookupApplyResult {
  const mode = input.mode ?? "fillMissing";
  const fieldMap = getFieldMap(input.fields);
  const nextFormData: Record<string, unknown> = {
    ...input.currentValues,
    [PUBLICATION_JOURNAL_LOOKUP_HIDDEN_KEY]: input.lookup.meta,
  };

  const visibleManagedFieldKeys = getVisibleManagedFieldKeys(input.fields);
  const visibleFilledFieldKeys: PublicationJournalManagedFieldKey[] = [];

  for (const key of visibleManagedFieldKeys) {
    const field = fieldMap.get(key);
    const rawValue = input.lookup.fields[key];
    if (!field || rawValue == null) {
      continue;
    }

    if (mode === "fillMissing" && !isBlankValue(input.currentValues[key])) {
      continue;
    }

    const coercedValue = normalizeFieldValueForField(field, rawValue);
    if (coercedValue === undefined) {
      continue;
    }

    nextFormData[key] = Array.isArray(coercedValue)
      ? [...coercedValue]
      : coercedValue;
    visibleFilledFieldKeys.push(key);
  }

  const visibleMissingFieldKeys = visibleManagedFieldKeys.filter((key) =>
    isBlankValue(nextFormData[key]),
  );

  return {
    formData: nextFormData,
    visibleFilledFieldKeys,
    visibleMissingFieldKeys,
  };
}

export function stripPublicationJournalLookupMetadata(
  formData: Record<string, unknown> | null | undefined,
) {
  if (!formData) {
    return formData;
  }

  const next = { ...formData };
  delete next[PUBLICATION_JOURNAL_LOOKUP_HIDDEN_KEY];
  return next;
}
