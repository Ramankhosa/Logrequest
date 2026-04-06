"use client";

import { SlideOver } from "@/components/dashboard/shared";
import { RESOLUTION_MODE_LABELS, inputClassName, labelClassName } from "./constants";
import type { SourceRow } from "./use-institutional-data";

type Props = {
  open: boolean;
  onClose: () => void;
  saving: boolean;
  metricId: string;
  sources: SourceRow[];
  defaultSourceId?: string | null;
  onSubmit: (metricId: string, linkPayload: Record<string, unknown>) => Promise<void>;
};

const RESOLUTION_HELP: Record<string, string> = {
  DIRECT: "Use the source\u2019s scalar value as-is.",
  PICK_FIELD: "Extract one column from the dataset.",
  COUNT_ROWS: "Count the total number of rows.",
  SUM_COLUMN: "Sum all values in a specific column.",
  AVG_COLUMN: "Calculate the average of a column.",
  MAX_COLUMN: "Take the highest value in a column.",
  MIN_COLUMN: "Take the lowest value in a column.",
  FIRST_NON_NULL: "Use the first non-empty value found.",
  CUSTOM_FORMULA: "Apply a custom transformation formula.",
};

export function MetricLinkSlideOver({
  open,
  onClose,
  saving,
  metricId,
  sources,
  defaultSourceId,
  onSubmit,
}: Props) {
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const resolutionMode = String(fd.get("resolutionMode") ?? "DIRECT");
    const transformText = String(fd.get("transformConfig") ?? "").trim();

    let transformConfig: Record<string, unknown>;
    try {
      transformConfig = transformText ? JSON.parse(transformText) : { mode: resolutionMode };
    } catch {
      transformConfig = { mode: resolutionMode };
    }

    void onSubmit(metricId, {
      sourceId: String(fd.get("sourceId") ?? ""),
      precedence: Number(fd.get("precedence") ?? 100),
      resolutionMode,
      transformConfig,
    }).then(() => onClose());
  }

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title="Link Data Source"
      subtitle="Connect a data source to this metric so its value can be computed automatically."
    >
      <form className="space-y-5" onSubmit={handleSubmit}>
        {/* Source */}
        <div>
          <label className={labelClassName} htmlFor="ml-source">Data Source</label>
          <select
            id="ml-source"
            className={inputClassName}
            name="sourceId"
            defaultValue={defaultSourceId ?? sources[0]?.id ?? ""}
          >
            {sources.map((s) => (
              <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
            ))}
          </select>
        </div>

        {/* Resolution mode */}
        <div>
          <label className={labelClassName} htmlFor="ml-mode">How to extract the value</label>
          <select id="ml-mode" className={inputClassName} name="resolutionMode" defaultValue="DIRECT">
            {Object.entries(RESOLUTION_MODE_LABELS).map(([value, lbl]) => (
              <option key={value} value={value}>{lbl}</option>
            ))}
          </select>
          <div className="mt-2 space-y-1">
            {Object.entries(RESOLUTION_HELP).map(([key, help]) => (
              <p key={key} className="text-xs text-slate-400">
                <span className="font-medium text-slate-500">{RESOLUTION_MODE_LABELS[key]}:</span> {help}
              </p>
            ))}
          </div>
        </div>

        {/* Precedence */}
        <div>
          <label className={labelClassName} htmlFor="ml-prec">Priority (lower = higher priority)</label>
          <input id="ml-prec" className={inputClassName} name="precedence" type="number" defaultValue={100} min={1} />
          <p className="mt-1 text-xs text-slate-400">If a metric has multiple source links, the one with the lowest number wins.</p>
        </div>

        {/* Transform config (advanced) */}
        <div>
          <label className={labelClassName} htmlFor="ml-config">Transform Config (advanced, optional)</label>
          <textarea
            id="ml-config"
            className={`${inputClassName} min-h-[5rem] font-mono text-xs`}
            name="transformConfig"
            defaultValue=""
            placeholder='Leave empty for default, or enter JSON like {"mode":"COUNT_ROWS","filter":{"status":"active"}}'
          />
        </div>

        {/* Submit */}
        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="flex-1 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:bg-slate-300"
          >
            {saving ? "Saving..." : "Save Link"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </SlideOver>
  );
}
