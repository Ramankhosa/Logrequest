import type { JournalCatalogActionResult, JournalListFilters } from "@/lib/journals/shared";

const journalErrorStatusMap: Record<string, number> = {
  BATCH_NOT_FOUND: 404,
  RECORD_NOT_FOUND: 404,
  INVALID_OVERRIDE_SOURCE: 409,
  SUPERSEDED_RECORD: 409,
  ALREADY_ARCHIVED: 409,
  NOT_ARCHIVED: 409,
  IDENTITY_CONFLICT: 409,
  BATCH_ALREADY_CONFIRMED: 409,
  BATCH_ALREADY_APPLYING: 409,
  OVERRIDE_REQUIRED: 409,
  PERMISSION_DENIED: 403,
  INVALID_INPUT: 400,
  IMPORT_FAILED: 400,
};

function parseBooleanFlag(value: string | null): boolean | undefined {
  if (value == null || value.length === 0) return undefined;
  if (value === "true" || value === "1" || value.toLowerCase() === "yes") return true;
  if (value === "false" || value === "0" || value.toLowerCase() === "no") return false;
  return undefined;
}

function parseInteger(value: string | null): number | undefined {
  if (value == null || value.trim().length === 0) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseJournalListFilters(
  searchParams: URLSearchParams,
): Partial<JournalListFilters> {
  return {
    search: searchParams.get("search") ?? undefined,
    sourceYear: parseInteger(searchParams.get("sourceYear")),
    type: searchParams.get("type") ?? undefined,
    quartile: searchParams.get("quartile") ?? undefined,
    openAccess:
      searchParams.get("openAccess") === "yes" ||
      searchParams.get("openAccess") === "no"
        ? (searchParams.get("openAccess") as "yes" | "no")
        : undefined,
    openAccessDiamond:
      searchParams.get("openAccessDiamond") === "yes" ||
      searchParams.get("openAccessDiamond") === "no"
        ? (searchParams.get("openAccessDiamond") as "yes" | "no")
        : undefined,
    country: searchParams.get("country") ?? undefined,
    region: searchParams.get("region") ?? undefined,
    publisher: searchParams.get("publisher") ?? undefined,
    onlyEligibleJournals: parseBooleanFlag(searchParams.get("onlyEligibleJournals")),
    effectiveSource:
      searchParams.get("effectiveSource") != null
        ? (searchParams.get("effectiveSource") as JournalListFilters["effectiveSource"])
        : undefined,
    recordState:
      searchParams.get("recordState") != null
        ? (searchParams.get("recordState") as JournalListFilters["recordState"])
        : undefined,
    page: parseInteger(searchParams.get("page")),
    pageSize: parseInteger(searchParams.get("pageSize")),
    sortField:
      searchParams.get("sortField") != null
        ? (searchParams.get("sortField") as JournalListFilters["sortField"])
        : undefined,
    sortDirection:
      searchParams.get("sortDirection") != null
        ? (searchParams.get("sortDirection") as JournalListFilters["sortDirection"])
        : undefined,
  };
}

export function getJournalActionHttpStatus(
  result: JournalCatalogActionResult,
  successStatus = 200,
) {
  if (result.status === "success") {
    return successStatus;
  }

  if (result.code && result.code in journalErrorStatusMap) {
    return journalErrorStatusMap[result.code];
  }

  return 400;
}
