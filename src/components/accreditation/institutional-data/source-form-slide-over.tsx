"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { SlideOver } from "@/components/dashboard/shared";
import {
  SOURCE_KIND_LABELS,
  SOURCE_SHAPE_LABELS,
  inputClassName,
  labelClassName,
} from "./constants";
import type { DomainOption, SourceDetail } from "./use-institutional-data";

type Props = {
  open: boolean;
  onClose: () => void;
  saving: boolean;
  domainOptions: DomainOption[];
  adapterOptions: Array<{ key: string; label: string }>;
  source?: SourceDetail | null;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
};

export function SourceFormSlideOver({
  open,
  onClose,
  saving,
  domainOptions,
  adapterOptions,
  source,
  onSubmit,
}: Props) {
  const isEditing = !!source;
  const [showAdvanced, setShowAdvanced] = useState(false);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const payload = {
      domainId: String(fd.get("domainId") ?? "") || null,
      code: String(fd.get("code") ?? ""),
      name: String(fd.get("name") ?? ""),
      description: String(fd.get("description") ?? "") || null,
      kind: String(fd.get("kind") ?? "MANUAL"),
      shape: String(fd.get("shape") ?? "SCALAR"),
      adapterKey: String(fd.get("adapterKey") ?? "") || null,
      supportsYearWise: fd.get("supportsYearWise") === "on",
      supportsScopeBreakdown: fd.get("supportsScopeBreakdown") === "on",
    };
    void onSubmit(payload).then(() => onClose());
  }

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title={isEditing ? "Edit Data Source" : "Add Data Source"}
      subtitle={
        isEditing
          ? `Editing ${source.name}`
          : "Define where your institutional data comes from."
      }
    >
      <form className="space-y-5" onSubmit={handleSubmit}>
        {/* Name */}
        <div>
          <label className={labelClassName} htmlFor="sf-name">Source Name</label>
          <input
            id="sf-name"
            className={inputClassName}
            name="name"
            defaultValue={source?.name ?? ""}
            placeholder="e.g. Faculty Members List"
            required
          />
        </div>

        {/* Code */}
        <div>
          <label className={labelClassName} htmlFor="sf-code">Unique Code</label>
          <input
            id="sf-code"
            className={inputClassName}
            name="code"
            defaultValue={source?.code ?? ""}
            placeholder="e.g. FACULTY_LIST"
            required
          />
          <p className="mt-1 text-xs text-slate-400">Short identifier used across the system. Use UPPER_SNAKE_CASE.</p>
        </div>

        {/* Data Type (kind) */}
        <div>
          <label className={labelClassName} htmlFor="sf-kind">How is data provided?</label>
          <select id="sf-kind" className={inputClassName} name="kind" defaultValue={source?.kind ?? "MANUAL"}>
            {Object.entries(SOURCE_KIND_LABELS).map(([value, lbl]) => (
              <option key={value} value={value}>{lbl}</option>
            ))}
          </select>
        </div>

        {/* Shape */}
        <div>
          <label className={labelClassName} htmlFor="sf-shape">Data Format</label>
          <select id="sf-shape" className={inputClassName} name="shape" defaultValue={source?.shape ?? "DATASET"}>
            {Object.entries(SOURCE_SHAPE_LABELS).map(([value, lbl]) => (
              <option key={value} value={value}>{lbl}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-400">
            &ldquo;Spreadsheet / Table&rdquo; for multi-row data, &ldquo;Single Value&rdquo; for a number or text.
          </p>
        </div>

        {/* Description */}
        <div>
          <label className={labelClassName} htmlFor="sf-desc">Description (optional)</label>
          <input
            id="sf-desc"
            className={inputClassName}
            name="description"
            defaultValue={source?.description ?? ""}
            placeholder="Brief description of this data source"
          />
        </div>

        {/* Domain */}
        <div>
          <label className={labelClassName} htmlFor="sf-domain">Domain (optional)</label>
          <select id="sf-domain" className={inputClassName} name="domainId" defaultValue={source?.domainId ?? ""}>
            <option value="">No domain</option>
            {domainOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Advanced toggle */}
        <button
          type="button"
          onClick={() => setShowAdvanced((prev) => !prev)}
          className="flex items-center gap-1.5 text-xs font-medium text-slate-500 transition hover:text-slate-700"
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
          Advanced options
        </button>

        {showAdvanced ? (
          <div className="space-y-4 rounded-2xl border border-slate-100 bg-slate-50/50 p-4">
            {/* Adapter */}
            <div>
              <label className={labelClassName} htmlFor="sf-adapter">System Adapter</label>
              <select id="sf-adapter" className={inputClassName} name="adapterKey" defaultValue={source?.adapterKey ?? ""}>
                <option value="">None</option>
                {adapterOptions.map((a) => (
                  <option key={a.key} value={a.key}>{a.label}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-400">Only needed for &ldquo;Auto-sync from System&rdquo; sources.</p>
            </div>

            {/* Year-wise / Scope */}
            <div className="flex items-center gap-6 text-sm text-slate-600">
              <label className="flex items-center gap-2">
                <input type="checkbox" name="supportsYearWise" defaultChecked={source?.supportsYearWise ?? true} />
                Track by year
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="supportsScopeBreakdown" defaultChecked={source?.supportsScopeBreakdown ?? false} />
                Scope breakdown
              </label>
            </div>
          </div>
        ) : null}

        {/* Submit */}
        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="flex-1 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:bg-slate-300"
          >
            {saving ? "Saving..." : isEditing ? "Update Source" : "Create Source"}
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
