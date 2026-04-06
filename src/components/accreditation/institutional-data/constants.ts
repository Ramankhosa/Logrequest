export const SOURCE_KIND_LABELS: Record<string, string> = {
  MANUAL: "Manual Entry",
  CSV_IMPORT: "Spreadsheet Import",
  INTERNAL_ADAPTER: "Auto-sync from System",
  DOCUMENT: "Document Upload",
  NARRATIVE: "Narrative / Text",
};

export const SOURCE_SHAPE_LABELS: Record<string, string> = {
  SCALAR: "Single Value",
  DATASET: "Spreadsheet / Table",
  NARRATIVE: "Narrative Text",
  DOCUMENT_REF: "Document Reference",
};

export const METRIC_VALUE_TYPE_LABELS: Record<string, string> = {
  NUMBER: "Numeric",
  TEXT: "Text",
  JSON: "Structured (JSON)",
};

export const METRIC_SHAPE_LABELS: Record<string, string> = {
  SCALAR: "Single Value",
  DATASET: "Tabular Data",
  COMPUTED: "Computed / Formula",
  NARRATIVE: "Narrative Text",
  DOCUMENT_REF: "Document Reference",
};

export const RESOLUTION_MODE_LABELS: Record<string, string> = {
  DIRECT: "Use value directly",
  PICK_FIELD: "Pick a column",
  COUNT_ROWS: "Count rows",
  SUM_COLUMN: "Sum a column",
  AVG_COLUMN: "Average a column",
  MAX_COLUMN: "Maximum in column",
  MIN_COLUMN: "Minimum in column",
  FIRST_NON_NULL: "First available value",
  CUSTOM_FORMULA: "Custom formula",
};

export const MATURITY_LABELS: Record<string, string> = {
  RAW: "Raw",
  VALIDATED: "Validated",
  APPROVED: "Approved",
};

export const COVERAGE_LABELS: Record<string, string> = {
  FULL: "Full coverage",
  PARTIAL: "Partial coverage",
  MISSING: "Missing",
};

export const ENTRY_MODE_LABELS: Record<string, string> = {
  MANUAL: "Manual entry",
  BULK_IMPORT: "Spreadsheet import",
  ADAPTER_REFRESH: "Auto-synced",
};

export function label(map: Record<string, string>, value: string | null | undefined): string {
  if (!value) return "Unknown";
  return map[value] ?? value;
}

export const inputClassName =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-slate-900";

export const textAreaClassName = `${inputClassName} min-h-[7rem]`;

export const labelClassName = "block text-xs font-medium text-slate-500 mb-1";
