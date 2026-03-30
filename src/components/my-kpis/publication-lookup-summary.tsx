"use client";

import { isFullPublicationDate, getPublicationLookupStoredData } from "@/lib/kra-kpi/publication-doi-shared";

type Props = {
  formData: Record<string, unknown> | null | undefined;
  hasPublicationDateField?: boolean;
  className?: string;
};

function formatDateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

export function PublicationLookupSummary({
  formData,
  hasPublicationDateField = false,
  className = "",
}: Props) {
  const lookup = getPublicationLookupStoredData(formData);
  if (!lookup) {
    return null;
  }

  return (
    <div className={`rounded-md border border-blue-100 bg-blue-50/70 p-3 text-xs text-blue-950 ${className}`.trim()}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-semibold uppercase tracking-wide text-blue-700">
          DOI Lookup
        </span>
        <span className="rounded-full bg-white px-2 py-0.5 font-medium text-blue-700">
          {lookup.source === "crossref" ? "Crossref" : "OpenAlex"}
        </span>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <div>
          <span className="font-medium">Normalized DOI:</span> {lookup.normalizedDoi}
        </div>
        <div>
          <span className="font-medium">Fetched:</span> {formatDateTime(lookup.fetchedAt)}
        </div>
        <div>
          <span className="font-medium">ISSN:</span> {lookup.issn ?? "-"}
        </div>
        <div>
          <span className="font-medium">Authors found:</span> {lookup.authors.length}
        </div>
        {lookup.rawPublicationDate ? (
          <div className="md:col-span-2">
            <span className="font-medium">Source publication date:</span> {lookup.rawPublicationDate}
            {!isFullPublicationDate(lookup.rawPublicationDate) && (
              <span className="ml-2 text-blue-700">
                Exact date was not available in DOI metadata.
              </span>
            )}
          </div>
        ) : null}
      </div>

      {lookup.warnings.length > 0 ? (
        <div className="mt-2 space-y-1 text-blue-800">
          {lookup.warnings.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
        </div>
      ) : null}

      {hasPublicationDateField ? (
        <div className="mt-2 text-blue-800">
          Publication date from DOI metadata can influence KPI period assignment.
        </div>
      ) : null}
    </div>
  );
}
