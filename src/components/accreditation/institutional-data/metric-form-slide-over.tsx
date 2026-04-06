"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { SlideOver } from "@/components/dashboard/shared";
import {
  METRIC_VALUE_TYPE_LABELS,
  METRIC_SHAPE_LABELS,
  inputClassName,
  labelClassName,
} from "./constants";
import type { DomainOption, MetricDetail } from "./use-institutional-data";

type Props = {
  open: boolean;
  onClose: () => void;
  saving: boolean;
  domainOptions: DomainOption[];
  metric?: MetricDetail | null;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
};

export function MetricFormSlideOver({
  open,
  onClose,
  saving,
  domainOptions,
  metric,
  onSubmit,
}: Props) {
  const isEditing = !!metric;
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [shape, setShape] = useState(metric?.shape ?? "SCALAR");

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const selectedShape = String(fd.get("shape") ?? "SCALAR");
    const formula = String(fd.get("formula") ?? "").trim();
    const payload = {
      domainId: String(fd.get("domainId") ?? "") || null,
      code: String(fd.get("code") ?? ""),
      name: String(fd.get("name") ?? ""),
      description: String(fd.get("description") ?? "") || null,
      valueType: String(fd.get("valueType") ?? "NUMBER"),
      shape: selectedShape,
      unitOfMeasure: String(fd.get("unitOfMeasure") ?? "") || null,
      helpText: String(fd.get("helpText") ?? "") || null,
      usedByBodyCodes: String(fd.get("usedByBodyCodes") ?? "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
      computeConfig: selectedShape === "COMPUTED" && formula ? { formula } : null,
    };
    void onSubmit(payload).then(() => onClose());
  }

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title={isEditing ? "Edit Metric" : "Add Metric"}
      subtitle={
        isEditing
          ? `Editing ${metric.name}`
          : "Define a reusable metric that pulls values from your data sources."
      }
    >
      <form className="space-y-5" onSubmit={handleSubmit}>
        {/* Name */}
        <div>
          <label className={labelClassName} htmlFor="mf-name">Metric Name</label>
          <input
            id="mf-name"
            className={inputClassName}
            name="name"
            defaultValue={metric?.name ?? ""}
            placeholder="e.g. Total Faculty Count"
            required
          />
        </div>

        {/* Code */}
        <div>
          <label className={labelClassName} htmlFor="mf-code">Unique Code</label>
          <input
            id="mf-code"
            className={inputClassName}
            name="code"
            defaultValue={metric?.code ?? ""}
            placeholder="e.g. FACULTY_COUNT"
            required
          />
          <p className="mt-1 text-xs text-slate-400">Short identifier. Use UPPER_SNAKE_CASE.</p>
        </div>

        {/* Value type */}
        <div>
          <label className={labelClassName} htmlFor="mf-vtype">Value Type</label>
          <select id="mf-vtype" className={inputClassName} name="valueType" defaultValue={metric?.valueType ?? "NUMBER"}>
            {Object.entries(METRIC_VALUE_TYPE_LABELS).map(([value, lbl]) => (
              <option key={value} value={value}>{lbl}</option>
            ))}
          </select>
        </div>

        {/* Shape */}
        <div>
          <label className={labelClassName} htmlFor="mf-shape">Metric Type</label>
          <select
            id="mf-shape"
            className={inputClassName}
            name="shape"
            defaultValue={metric?.shape ?? "SCALAR"}
            onChange={(e) => setShape(e.target.value)}
          >
            {Object.entries(METRIC_SHAPE_LABELS).map(([value, lbl]) => (
              <option key={value} value={value}>{lbl}</option>
            ))}
          </select>
        </div>

        {/* Formula (only for COMPUTED) */}
        {shape === "COMPUTED" ? (
          <div>
            <label className={labelClassName} htmlFor="mf-formula">Formula</label>
            <textarea
              id="mf-formula"
              className={`${inputClassName} min-h-[5rem]`}
              name="formula"
              defaultValue={metric?.computeConfig?.formula ?? ""}
              placeholder="e.g. FACULTY_PHD / FACULTY_COUNT * 100"
            />
            <p className="mt-1 text-xs text-slate-400">Reference other metrics by code.</p>
          </div>
        ) : null}

        {/* Unit */}
        <div>
          <label className={labelClassName} htmlFor="mf-unit">Unit of Measure (optional)</label>
          <input
            id="mf-unit"
            className={inputClassName}
            name="unitOfMeasure"
            defaultValue={metric?.unitOfMeasure ?? ""}
            placeholder="e.g. %, count, INR"
          />
        </div>

        {/* Description */}
        <div>
          <label className={labelClassName} htmlFor="mf-desc">Description (optional)</label>
          <input
            id="mf-desc"
            className={inputClassName}
            name="description"
            defaultValue={metric?.description ?? ""}
            placeholder="Brief description of what this metric measures"
          />
        </div>

        {/* Domain */}
        <div>
          <label className={labelClassName} htmlFor="mf-domain">Domain (optional)</label>
          <select id="mf-domain" className={inputClassName} name="domainId" defaultValue={metric?.domainId ?? ""}>
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
            <div>
              <label className={labelClassName} htmlFor="mf-help">Help Text</label>
              <input
                id="mf-help"
                className={inputClassName}
                name="helpText"
                defaultValue={metric?.helpText ?? ""}
                placeholder="Guidance for users filling this metric"
              />
            </div>
            <div>
              <label className={labelClassName} htmlFor="mf-bodies">Accreditation Bodies</label>
              <input
                id="mf-bodies"
                className={inputClassName}
                name="usedByBodyCodes"
                defaultValue={metric?.usedByBodyCodes.join(", ") ?? ""}
                placeholder="e.g. NAAC, NBA (comma-separated)"
              />
              <p className="mt-1 text-xs text-slate-400">Which accreditation bodies use this metric.</p>
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
            {saving ? "Saving..." : isEditing ? "Update Metric" : "Create Metric"}
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
