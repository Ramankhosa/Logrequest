"use client";

import { X } from "lucide-react";

export type FilterOption = {
  value: string;
  label: string;
};

export type FilterDef = {
  key: string;
  label: string;
  type: "select" | "multi-select" | "date-range";
  options?: FilterOption[];
};

export type FilterBarProps = {
  filters: FilterDef[];
  active: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  onClear: () => void;
};

export function FilterBar({
  filters,
  active,
  onChange,
  onClear,
}: FilterBarProps) {
  const pills = buildActivePills(filters, active, onChange);

  return (
    <div className="glass-panel rounded-[1.5rem] border border-slate-200/80 p-4">
      <div className="flex flex-wrap gap-3">
        {filters.map((filter) => (
          <div key={filter.key} className="min-w-[180px] flex-1">
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              {filter.label}
            </label>
            {filter.type === "select" ? (
              <select
                value={String(active[filter.key] ?? "")}
                onChange={(event) => onChange(filter.key, event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15"
              >
                <option value="">All</option>
                {filter.options?.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : null}

            {filter.type === "multi-select" ? (
              <select
                multiple
                value={Array.isArray(active[filter.key]) ? (active[filter.key] as string[]) : []}
                onChange={(event) =>
                  onChange(
                    filter.key,
                    Array.from(event.target.selectedOptions, (option) => option.value),
                  )
                }
                className="min-h-[88px] w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15"
              >
                {filter.options?.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : null}

            {filter.type === "date-range" ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  type="date"
                  value={String((active[`${filter.key}From`] as string | undefined) ?? "")}
                  onChange={(event) => onChange(`${filter.key}From`, event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15"
                />
                <input
                  type="date"
                  value={String((active[`${filter.key}To`] as string | undefined) ?? "")}
                  onChange={(event) => onChange(`${filter.key}To`, event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15"
                />
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {pills.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {pills.map((pill) => (
            <button
              key={pill.key}
              type="button"
              onClick={pill.onRemove}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
            >
              {pill.label}
              <X className="h-3.5 w-3.5" />
            </button>
          ))}
          <button
            type="button"
            onClick={onClear}
            className="text-xs font-semibold text-slate-500 transition hover:text-slate-900"
          >
            Clear all
          </button>
        </div>
      ) : null}
    </div>
  );
}

function buildActivePills(
  filters: FilterDef[],
  active: Record<string, unknown>,
  onChange: (key: string, value: unknown) => void,
) {
  const pills: Array<{ key: string; label: string; onRemove: () => void }> = [];

  for (const filter of filters) {
    if (filter.type === "date-range") {
      const from = active[`${filter.key}From`];
      const to = active[`${filter.key}To`];

      if (typeof from === "string" && from) {
        pills.push({
          key: `${filter.key}-from`,
          label: `${filter.label}: from ${from}`,
          onRemove: () => onChange(`${filter.key}From`, ""),
        });
      }
      if (typeof to === "string" && to) {
        pills.push({
          key: `${filter.key}-to`,
          label: `${filter.label}: to ${to}`,
          onRemove: () => onChange(`${filter.key}To`, ""),
        });
      }
      continue;
    }

    const value = active[filter.key];
    if (typeof value === "string" && value) {
      const optionLabel = filter.options?.find((option) => option.value === value)?.label ?? value;
      pills.push({
        key: filter.key,
        label: `${filter.label}: ${optionLabel}`,
        onRemove: () => onChange(filter.key, ""),
      });
    }

    if (Array.isArray(value) && value.length > 0) {
      for (const entry of value) {
        const optionLabel =
          filter.options?.find((option) => option.value === entry)?.label ?? String(entry);
        pills.push({
          key: `${filter.key}-${entry}`,
          label: `${filter.label}: ${optionLabel}`,
          onRemove: () => onChange(filter.key, value.filter((item) => item !== entry)),
        });
      }
    }
  }

  return pills;
}
