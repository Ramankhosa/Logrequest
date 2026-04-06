export const LIFECYCLE_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  VALIDATED: "Validated",
  PUBLISHED: "Published",
  SUPERSEDED: "Superseded",
  ARCHIVED: "Archived",
};

export const LIFECYCLE_CLASSES: Record<string, string> = {
  DRAFT: "border-slate-200 bg-slate-50 text-slate-600",
  VALIDATED: "border-blue-200 bg-blue-50 text-blue-700",
  PUBLISHED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  SUPERSEDED: "border-amber-200 bg-amber-50 text-amber-700",
  ARCHIVED: "border-slate-200 bg-slate-100 text-slate-500",
};

export const BLOCK_TYPE_LABELS: Record<string, string> = {
  GROUP: "Group",
  METRIC: "Quantitative Metric",
  QUALITATIVE: "Qualitative Assessment",
  COMPOSITE: "Composite Score",
};

export const COPILOT_MODE_LABELS: Record<string, string> = {
  DISABLED: "Disabled",
  DETERMINISTIC_ONLY: "Deterministic Only",
  LLM_ASSISTED: "LLM-Assisted",
};

export const SCOPE_LABELS: Record<string, string> = {
  GLOBAL: "Global",
  TENANT: "Tenant",
};

export const EFFECTIVE_SOURCE_LABELS: Record<string, string> = {
  GLOBAL_INHERITED: "Inherited from global",
  GLOBAL_OWNED: "Global (owned)",
  TENANT_OWNED: "Tenant (owned)",
};

export function label(map: Record<string, string>, value: string | null | undefined): string {
  if (!value) return "Unknown";
  return map[value] ?? value;
}

export const inputClassName =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-slate-900";

export const textAreaClassName = `${inputClassName} min-h-[7rem]`;

export const labelClassName = "block text-xs font-medium text-slate-500 mb-1";
