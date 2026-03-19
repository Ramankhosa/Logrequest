"use client";

import { useState } from "react";
import { Loader2, Check, X, AlertCircle } from "lucide-react";
import { TooltipHint } from "./tooltip-hint";
import { TOOLTIPS, ACHIEVEMENT_TEMPLATES } from "@/lib/kra-kpi/shared";
import {
  getMeasurementCapValue,
  type AchievementFieldConfig,
  type AchievementFormConfig,
  type MeasurementConfig,
} from "@/lib/kra-kpi/shared";

const MEASUREMENT_TYPES = [
  { value: "NUMERIC", label: "Numeric" },
  { value: "PERCENTAGE", label: "Percentage" },
  { value: "CURRENCY", label: "Currency" },
  { value: "BOOLEAN", label: "Boolean (Yes/No)" },
  { value: "RATING", label: "Rating" },
  { value: "MILESTONE", label: "Milestone" },
  { value: "DATE_TARGET", label: "Date Target" },
  { value: "GRADE", label: "Grade" },
];

const SCORING_METHODS = [
  { value: "LINEAR", label: "Linear" },
  { value: "THRESHOLD", label: "Threshold" },
  { value: "SLAB", label: "Slab" },
];

const SCORING_DIRECTIONS = [
  { value: "ASCENDING", label: "Ascending (higher = better)" },
  { value: "DESCENDING", label: "Descending (lower = better)" },
];

const ALLOCATION_TYPES = [
  { value: "DEPARTMENT", label: "Department" },
  { value: "INDIVIDUAL", label: "Individual" },
  { value: "BOTH", label: "Both" },
];

type KpiFormProps = {
  mode: "create" | "edit";
  kraDefinitionId: string;
  units: { id: string; name: string }[];
  initial?: {
    id: string;
    title: string;
    description: string | null;
    measurementType: string;
    unitLabel: string | null;
    weightage: number;
    defaultTarget: number | null;
    measurementConfig: MeasurementConfig | null;
    scoringMethod: string;
    scoringDirection: string;
    isPerCapita: boolean;
    allocationType: string;
    startingUnitId: string;
    guidanceNotes: string | null;
    sortOrder: number;
    achievementTemplateKey?: string | null;
    achievementFormConfig?: AchievementFormConfig | null;
  };
  onDone: () => void;
  onCancel: () => void;
};

function supportsEditableMaxCap(measurementType: string): boolean {
  return (
    measurementType === "NUMERIC" ||
    measurementType === "PERCENTAGE" ||
    measurementType === "CURRENCY"
  );
}

function buildMeasurementConfig(
  measurementType: string,
  existingConfig: MeasurementConfig | null | undefined,
  enforceMaxCap: boolean,
  maxCap: string,
): MeasurementConfig | undefined {
  const capValue = maxCap.trim() ? Number(maxCap) : null;

  switch (measurementType) {
    case "NUMERIC": {
      const next =
        existingConfig?.type === "NUMERIC"
          ? { ...existingConfig }
          : { type: "NUMERIC" as const, decimalPlaces: 0 };
      if (enforceMaxCap && capValue != null) next.maxValue = capValue;
      else delete next.maxValue;
      return Object.keys(next).length > 1 ? next : undefined;
    }
    case "PERCENTAGE": {
      const next =
        existingConfig?.type === "PERCENTAGE"
          ? { ...existingConfig }
          : { type: "PERCENTAGE" as const, minValue: 0, maxValue: 100, decimalPlaces: 1 };
      next.maxValue = enforceMaxCap && capValue != null ? capValue : 100;
      return Object.keys(next).length > 1 ? next : undefined;
    }
    case "CURRENCY": {
      const next =
        existingConfig?.type === "CURRENCY"
          ? { ...existingConfig }
          : { type: "CURRENCY" as const, currencyCode: "INR", minValue: 0, decimalPlaces: 2 };
      if (enforceMaxCap && capValue != null) next.maxValue = capValue;
      else delete next.maxValue;
      return Object.keys(next).length > 1 ? next : undefined;
    }
    default:
      return existingConfig?.type === measurementType ? existingConfig : undefined;
  }
}

export function KpiDefinitionForm({ mode, kraDefinitionId, units, initial, onDone, onCancel }: KpiFormProps) {
  const initialCapValue = getMeasurementCapValue(
    initial?.measurementType ?? "NUMERIC",
    initial?.measurementConfig ?? null,
  );
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [measurementType, setMeasurementType] = useState(initial?.measurementType ?? "NUMERIC");
  const [unitLabel, setUnitLabel] = useState(initial?.unitLabel ?? "");
  const [weightage, setWeightage] = useState(initial?.weightage ?? 0);
  const [defaultTarget, setDefaultTarget] = useState<string>(initial?.defaultTarget?.toString() ?? "");
  const [enforceMaxCap, setEnforceMaxCap] = useState(initialCapValue != null);
  const [maxCap, setMaxCap] = useState(initialCapValue != null ? String(initialCapValue) : "");
  const [scoringMethod, setScoringMethod] = useState(initial?.scoringMethod ?? "LINEAR");
  const [scoringDirection, setScoringDirection] = useState(initial?.scoringDirection ?? "ASCENDING");
  const [isPerCapita, setIsPerCapita] = useState(initial?.isPerCapita ?? false);
  const [allocationType, setAllocationType] = useState(initial?.allocationType ?? "BOTH");
  const [startingUnitId, setStartingUnitId] = useState(initial?.startingUnitId ?? "");
  const [guidanceNotes, setGuidanceNotes] = useState(initial?.guidanceNotes ?? "");
  const [sortOrder, setSortOrder] = useState(initial?.sortOrder ?? 0);
  const [templateKey, setTemplateKey] = useState(initial?.achievementTemplateKey ?? "");
  const [customFields, setCustomFields] = useState<AchievementFieldConfig[]>(
    initial?.achievementFormConfig?.fields ?? []
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleTemplateSelect = (key: string) => {
    setTemplateKey(key);
    if (key && ACHIEVEMENT_TEMPLATES[key]) {
      setCustomFields([...ACHIEVEMENT_TEMPLATES[key].fields]);
    } else {
      setCustomFields([]);
    }
  };

  const TEMPLATE_OPTIONS = [
    { value: "", label: "No Template" },
    ...Object.entries(ACHIEVEMENT_TEMPLATES).map(([key, tmpl]) => ({
      value: key,
      label: tmpl.label,
    })),
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const trimmedTitle = title.trim();

    if (!kraDefinitionId) {
      setError("Select a KRA before creating a KPI.");
      setSubmitting(false);
      return;
    }

    if (trimmedTitle.length < 2) {
      setError("KPI title must be at least 2 characters.");
      setSubmitting(false);
      return;
    }

    if (units.length === 0) {
      setError("No structure units are available. Create or publish at least one unit first.");
      setSubmitting(false);
      return;
    }

    if (!startingUnitId) {
      setError("Select a starting unit.");
      setSubmitting(false);
      return;
    }

    const capSupported = supportsEditableMaxCap(measurementType);
    if (capSupported && enforceMaxCap) {
      if (!maxCap.trim()) {
        setError("Enter the maximum KPI cap.");
        setSubmitting(false);
        return;
      }

      const parsedCap = Number(maxCap);
      if (!Number.isFinite(parsedCap) || parsedCap < 0) {
        setError("Enter a valid maximum KPI cap.");
        setSubmitting(false);
        return;
      }
      if (measurementType === "PERCENTAGE" && parsedCap > 100) {
        setError("Percentage KPI caps cannot exceed 100.");
        setSubmitting(false);
        return;
      }

      if (defaultTarget.trim() && Number(defaultTarget) > parsedCap) {
        setError("Default target cannot exceed the configured maximum cap.");
        setSubmitting(false);
        return;
      }
    }

    try {
      const url = mode === "create"
        ? "/api/tenant/kra-kpi/kpis"
        : `/api/tenant/kra-kpi/kpis/${initial!.id}`;

      const formConfig: AchievementFormConfig | null =
        customFields.length > 0
          ? { templateKey: templateKey || undefined, fields: customFields }
          : null;
      const existingMeasurementConfig =
        initial?.measurementConfig?.type === measurementType
          ? initial.measurementConfig
          : null;
      const measurementConfig = buildMeasurementConfig(
        measurementType,
        existingMeasurementConfig,
        enforceMaxCap,
        maxCap,
      );

      const body: Record<string, unknown> = {
        ...(mode === "create" && { kraDefinitionId }),
        title: trimmedTitle,
        description: description.trim() || (mode === "edit" ? null : undefined),
        measurementType,
        unitLabel: unitLabel.trim() || (mode === "edit" ? null : undefined),
        weightage,
        defaultTarget: defaultTarget.trim() ? Number(defaultTarget) : (mode === "edit" ? null : undefined),
        measurementConfig: measurementConfig ?? (mode === "edit" ? null : undefined),
        scoringMethod,
        scoringDirection,
        isPerCapita,
        allocationType,
        startingUnitId,
        achievementTemplateKey: templateKey || (mode === "edit" ? null : undefined),
        achievementFormConfig: formConfig ?? (mode === "edit" ? null : undefined),
        guidanceNotes: guidanceNotes.trim() || (mode === "edit" ? null : undefined),
        sortOrder,
      };

      const res = await fetch(url, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (data.status === "error") {
        setError(data.message);
        setSubmitting(false);
      } else {
        onDone();
      }
    } catch {
      setError("Request failed.");
      setSubmitting(false);
    }
  };

  const borderColor = mode === "create" ? "border-brand/20 bg-brand/5" : "border-blue-200 bg-blue-50/50";
  const labelCls = "mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500";
  const inputCls = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand focus:ring-1 focus:ring-brand/30";
  const capSupported = supportsEditableMaxCap(measurementType);

  return (
    <form onSubmit={handleSubmit} className={`rounded-xl border ${borderColor} p-4`}>
      <div className="mb-3 flex items-center justify-between">
        <span className={`text-xs font-semibold ${mode === "create" ? "text-brand" : "text-blue-600"}`}>
          {mode === "create" ? "New KPI" : "Edit KPI"}
        </span>
        <button type="button" onClick={onCancel} className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 hover:text-slate-700">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="sm:col-span-2 lg:col-span-3">
          <label className={labelCls}>Title</label>
          <input type="text" placeholder="e.g. Number of Publications" value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} autoFocus />
        </div>

        <div>
          <label className={labelCls}>
            Measurement type <TooltipHint text={TOOLTIPS.MEASUREMENT_TYPE} className="ml-1" />
          </label>
          <select value={measurementType} onChange={(e) => setMeasurementType(e.target.value)} className={inputCls}>
            {MEASUREMENT_TYPES.map((mt) => <option key={mt.value} value={mt.value}>{mt.label}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Unit label</label>
          <input type="text" placeholder="e.g. count, %, INR" value={unitLabel} onChange={(e) => setUnitLabel(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>
            Weightage <TooltipHint text={TOOLTIPS.KPI_WEIGHTAGE} className="ml-1" />
          </label>
          <input type="number" value={weightage} onChange={(e) => setWeightage(Number(e.target.value))} min={0} max={100} className={inputCls} />
        </div>

        <div>
          <label className={labelCls}>
            Scoring method <TooltipHint text={TOOLTIPS.SCORING_METHOD} className="ml-1" />
          </label>
          <select value={scoringMethod} onChange={(e) => setScoringMethod(e.target.value)} className={inputCls}>
            {SCORING_METHODS.map((sm) => <option key={sm.value} value={sm.value}>{sm.label}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>
            Scoring direction <TooltipHint text={TOOLTIPS.SCORING_DIRECTION} className="ml-1" />
          </label>
          <select value={scoringDirection} onChange={(e) => setScoringDirection(e.target.value)} className={inputCls}>
            {SCORING_DIRECTIONS.map((sd) => <option key={sd.value} value={sd.value}>{sd.label}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Default target</label>
          <input type="number" step="any" placeholder="Optional" value={defaultTarget} onChange={(e) => setDefaultTarget(e.target.value)} className={inputCls} />
        </div>

        {capSupported && (
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-3 sm:col-span-2 lg:col-span-3">
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={enforceMaxCap}
                onChange={(e) => setEnforceMaxCap(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand/30"
              />
              Enforce maximum KPI cap
            </label>
            <p className="mt-1 text-xs text-slate-500">
              When enabled, target allocations cannot exceed this KPI cap.
            </p>
            {enforceMaxCap && (
              <div className="mt-3 max-w-xs">
                <label className={labelCls}>
                  {measurementType === "PERCENTAGE" ? "Maximum percentage cap" : "Maximum target cap"}
                </label>
                <input
                  type="number"
                  step="any"
                  min={0}
                  max={measurementType === "PERCENTAGE" ? 100 : undefined}
                  placeholder={measurementType === "PERCENTAGE" ? "0-100" : "Optional"}
                  value={maxCap}
                  onChange={(e) => setMaxCap(e.target.value)}
                  className={inputCls}
                />
              </div>
            )}
          </div>
        )}

        <div>
          <label className={labelCls}>
            Allocation type <TooltipHint text={TOOLTIPS.ALLOCATION_TYPE} className="ml-1" />
          </label>
          <select value={allocationType} onChange={(e) => setAllocationType(e.target.value)} className={inputCls}>
            {ALLOCATION_TYPES.map((at) => <option key={at.value} value={at.value}>{at.label}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Starting unit</label>
          <select value={startingUnitId} onChange={(e) => setStartingUnitId(e.target.value)} className={inputCls}>
            <option value="">Select unit...</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <div className="flex items-center pt-5">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={isPerCapita} onChange={(e) => setIsPerCapita(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand/30" />
            Per capita <TooltipHint text={TOOLTIPS.IS_PER_CAPITA} className="ml-1" />
          </label>
        </div>

        <div className="sm:col-span-2 lg:col-span-3">
          <label className={labelCls}>Description</label>
          <textarea placeholder="Optional" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={`${inputCls} resize-none`} />
        </div>
        <div className="sm:col-span-2 lg:col-span-2">
          <label className={labelCls}>Guidance notes</label>
          <textarea placeholder="Optional instructions for target owners" value={guidanceNotes} onChange={(e) => setGuidanceNotes(e.target.value)} rows={2} className={`${inputCls} resize-none`} />
        </div>
        <div>
          <label className={labelCls}>Sort order</label>
          <input type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} min={0} max={9999} className="w-24 rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand/30" />
        </div>

        {/* Achievement Template */}
        <div className="sm:col-span-2 lg:col-span-3 border-t border-slate-200 pt-3 mt-1">
          <label className={labelCls}>Achievement Template</label>
          <select value={templateKey} onChange={(e) => handleTemplateSelect(e.target.value)} className={inputCls}>
            {TEMPLATE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          {customFields.length > 0 && (
            <div className="mt-2 space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Template Fields ({customFields.length})</span>
              <div className="max-h-40 overflow-y-auto rounded-md border border-slate-100 bg-white p-2 space-y-1">
                {customFields.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-slate-600">
                    <span className="font-medium">{f.label}</span>
                    <span className="text-slate-400">({f.type})</span>
                    {f.required && <span className="text-rose-500">*</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button type="submit" disabled={submitting} className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-50 ${mode === "create" ? "bg-brand hover:bg-brand/90" : "bg-blue-600 hover:bg-blue-700"}`}>
          {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          {mode === "create" ? "Create" : "Save"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300">Cancel</button>
      </div>
      {error && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-rose-600">
          <AlertCircle className="h-3 w-3 shrink-0" /> {error}
        </div>
      )}
    </form>
  );
}
