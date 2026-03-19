"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Search, ChevronDown, CheckCircle2, Clock, XCircle, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AchievementView, AchievementFormConfig, AchievementFieldConfig } from "@/lib/kra-kpi/shared";
import { ACHIEVEMENT_TEMPLATES } from "@/lib/kra-kpi/shared";
import { DynamicFormRenderer } from "./dynamic-form-renderer";

type AvailableKpiView = {
  kpiId: string;
  kpiTitle: string;
  kpiDescription: string | null;
  kpiWeightage: number;
  measurementType: string;
  unitLabel: string | null;
  achievementTemplateKey: string | null;
  achievementFormConfig: AchievementFormConfig | null;
  kraId: string;
  kraTitle: string;
  categoryKey: string | null;
  categoryLabel: string | null;
  startingUnitId: string;
  startingUnitName: string;
  isAllocated: boolean;
  hasExistingAdditional: boolean;
};

type Props = {
  periodId: string;
  periodState: string;
  onRefresh?: () => void;
};

function formatDate(d: Date | string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function AchievementStateBadge({ state }: { state: string }) {
  switch (state) {
    case "DRAFT":
      return <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700"><Clock className="h-3 w-3" />Draft</span>;
    case "SUBMITTED":
      return <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700"><Clock className="h-3 w-3" />Submitted</span>;
    case "RECOMMENDED":
      return <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700"><CheckCircle2 className="h-3 w-3" />Recommended</span>;
    case "VERIFIED":
      return <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700"><CheckCircle2 className="h-3 w-3" />Verified</span>;
    case "REJECTED":
      return <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700"><XCircle className="h-3 w-3" />Not Approved</span>;
    default:
      return <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{state}</span>;
  }
}

type RecordFormProps = {
  kpi: AvailableKpiView;
  periodId: string;
  onDone: () => void;
  onCancel: () => void;
};

function RecordAdditionalForm({ kpi, periodId, onDone, onCancel }: RecordFormProps) {
  const genericFields = ACHIEVEMENT_TEMPLATES.GENERIC.fields;
  const fields: AchievementFieldConfig[] = kpi.achievementFormConfig?.fields ?? genericFields;
  const templateLabel =
    kpi.achievementTemplateKey && ACHIEVEMENT_TEMPLATES[kpi.achievementTemplateKey]
      ? ACHIEVEMENT_TEMPLATES[kpi.achievementTemplateKey].label
      : "Achievement Details";

  const [actualValue, setActualValue] = useState<number | undefined>(undefined);
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFormFieldChange = (key: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    if (formErrors[key]) {
      setFormErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const handleSave = async (submitAfter: boolean) => {
    setError(null);
    const errors: Record<string, string> = {};
    for (const f of fields) {
      if (f.required) {
        const val = formData[f.key];
        if (val == null || val === "" || (Array.isArray(val) && val.length === 0)) {
          errors[f.key] = `${f.label} is required`;
        }
      }
    }
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    const setter = submitAfter ? setSubmitting : setSaving;
    setter(true);

    const body = {
      periodId,
      kpiDefinitionId: kpi.kpiId,
      ...(actualValue !== undefined && { actualValue }),
      achievementFormData: Object.keys(formData).length > 0 ? formData : undefined,
    };

    try {
      const res = await fetch("/api/tenant/kra-kpi/my/additional-achievements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.status === "error") {
        setError(data.message);
        setter(false);
        return;
      }

      if (submitAfter && data.id) {
        const submitRes = await fetch(`/api/tenant/kra-kpi/achievements/${data.id as string}/submit`, {
          method: "POST",
        });
        const submitData = await submitRes.json();
        if (submitData.status === "error") {
          setError(submitData.message);
          setter(false);
          return;
        }
      }

      setter(false);
      onDone();
    } catch {
      setError("An unexpected error occurred.");
      setter(false);
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900">{kpi.kpiTitle}</h3>
          <p className="text-sm text-gray-500 mt-0.5">
            {kpi.kraTitle} · Source: {kpi.startingUnitName}
          </p>
        </div>
        <button
          onClick={onCancel}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          Cancel
        </button>
      </div>

      {kpi.measurementType === "NUMERIC" || kpi.measurementType === "PERCENTAGE" || kpi.measurementType === "CURRENCY" ? (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Actual Value {kpi.unitLabel ? `(${kpi.unitLabel})` : ""}
          </label>
          <input
            type="number"
            value={actualValue ?? ""}
            onChange={(e) => setActualValue(e.target.value ? Number(e.target.value) : undefined)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Enter actual value"
          />
          {kpi.achievementFormConfig == null && (
            <p className="mt-1 text-xs text-gray-400">
              {kpi.kpiDescription ?? ""}
            </p>
          )}
        </div>
      ) : null}

      {/* Dynamic form */}
      <div>
        <h4 className="text-sm font-medium text-gray-700 mb-3">{templateLabel}</h4>
        <DynamicFormRenderer
          fields={fields}
          values={formData}
          errors={formErrors}
          onChange={handleFormFieldChange}
        />
      </div>

      {kpi.achievementFormConfig == null && (
        <p className="text-xs text-amber-600 bg-amber-50 rounded p-2">
          Score will be assessed by the verifier (no default target configured).
        </p>
      )}

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={() => { void handleSave(false); }}
          disabled={saving || submitting}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Draft"}
        </button>
        <button
          onClick={() => { void handleSave(true); }}
          disabled={saving || submitting}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? "Submitting..." : "Save & Submit"}
        </button>
      </div>
    </div>
  );
}

export function AdditionalAchievementsTab({ periodId, periodState, onRefresh }: Props) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [kpis, setKpis] = useState<AvailableKpiView[]>([]);
  const [myAchievements, setMyAchievements] = useState<AchievementView[]>([]);
  const [loadingKpis, setLoadingKpis] = useState(true);
  const [loadingAchievements, setLoadingAchievements] = useState(true);
  const [recordingKpi, setRecordingKpi] = useState<AvailableKpiView | null>(null);
  const [searchInput, setSearchInput] = useState("");

  const canRecord = periodState === "IN_PROGRESS" || periodState === "UNDER_REVIEW";

  const fetchKpis = useCallback(async () => {
    setLoadingKpis(true);
    const params = new URLSearchParams({ periodId });
    if (search) params.set("search", search);
    if (categoryFilter) params.set("category", categoryFilter);
    const res = await fetch(`/api/tenant/kra-kpi/my/available-kpis?${params.toString()}`);
    if (res.ok) {
      const data = await res.json() as AvailableKpiView[];
      setKpis(data);
    }
    setLoadingKpis(false);
  }, [periodId, search, categoryFilter]);

  const fetchAchievements = useCallback(async () => {
    setLoadingAchievements(true);
    const res = await fetch(`/api/tenant/kra-kpi/my/additional-achievements?periodId=${periodId}`);
    if (res.ok) {
      const data = await res.json() as AchievementView[];
      setMyAchievements(data);
    }
    setLoadingAchievements(false);
  }, [periodId]);

  useEffect(() => {
    void fetchKpis();
  }, [fetchKpis]);

  useEffect(() => {
    void fetchAchievements();
  }, [fetchAchievements]);

  function handleDone() {
    setRecordingKpi(null);
    void fetchKpis();
    void fetchAchievements();
    onRefresh?.();
  }

  // Derive categories from kpis
  const categories = [...new Set(kpis.map((k) => k.categoryLabel).filter((c): c is string => Boolean(c)))].sort();

  // Group kpis by KRA
  const kraMap = new Map<string, { kraTitle: string; kpis: AvailableKpiView[] }>();
  for (const kpi of kpis) {
    if (!kraMap.has(kpi.kraId)) {
      kraMap.set(kpi.kraId, { kraTitle: kpi.kraTitle, kpis: [] });
    }
    kraMap.get(kpi.kraId)!.kpis.push(kpi);
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput.trim());
  }

  if (recordingKpi) {
    return (
      <RecordAdditionalForm
        kpi={recordingKpi}
        periodId={periodId}
        onDone={handleDone}
        onCancel={() => setRecordingKpi(null)}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Search + Category filter */}
      <form onSubmit={handleSearchSubmit} className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search KPIs..."
            className="w-full rounded-md border border-gray-300 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Search
        </button>
        {search && (
          <button
            type="button"
            onClick={() => { setSearch(""); setSearchInput(""); }}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Clear
          </button>
        )}
        {categories.length > 0 && (
          <div className="relative">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-md border border-gray-300 pl-3 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none"
            >
              <option value="">All Categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
          </div>
        )}
      </form>

      {!canRecord && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertCircle className="inline h-4 w-4 mr-1" />
          Recording additional achievements is not available during "{periodState}" period.
        </div>
      )}

      {/* Available KPIs */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
          Available KPIs
        </h3>

        {loadingKpis ? (
          <div className="py-8 text-center text-sm text-gray-500">Loading KPIs...</div>
        ) : kpis.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 py-10 text-center">
            <p className="text-sm text-gray-500">
              {search || categoryFilter
                ? "No KPIs match your search."
                : "No KPIs available for additional achievements."}
            </p>
          </div>
        ) : (
          [...kraMap.entries()].map(([kraId, { kraTitle, kpis: kraKpis }]) => (
            <div key={kraId} className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{kraTitle}</h4>
              {kraKpis.map((kpi) => (
                <div
                  key={kpi.kpiId}
                  className="rounded-lg border border-gray-200 bg-white p-4 flex flex-wrap items-start justify-between gap-4"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-900">{kpi.kpiTitle}</span>
                      <span className="text-xs text-gray-400">({kpi.measurementType})</span>
                      {kpi.categoryLabel && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                          {kpi.categoryLabel}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      Dept: {kpi.startingUnitName} · Wt: {kpi.kpiWeightage}
                      {kpi.achievementTemplateKey && (
                        <span className="ml-2 text-gray-400">
                          Template: {ACHIEVEMENT_TEMPLATES[kpi.achievementTemplateKey]?.label ?? kpi.achievementTemplateKey}
                        </span>
                      )}
                    </p>
                    {kpi.kpiDescription && (
                      <p className="mt-1 text-xs text-gray-400 line-clamp-1">{kpi.kpiDescription}</p>
                    )}
                  </div>
                  <div className="shrink-0">
                    {kpi.isAllocated ? (
                      <span className="inline-block rounded-lg bg-blue-50 px-3 py-1.5 text-xs text-blue-700">
                        Already allocated — use My Targets tab
                      </span>
                    ) : kpi.hasExistingAdditional ? (
                      <span className="inline-block rounded-lg bg-green-50 px-3 py-1.5 text-xs text-green-700">
                        Achievement recorded
                      </span>
                    ) : canRecord ? (
                      <button
                        onClick={() => setRecordingKpi(kpi)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-700"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Record Achievement
                      </button>
                    ) : (
                      <span className="inline-block rounded-lg bg-gray-100 px-3 py-1.5 text-xs text-gray-500">
                        Period closed
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      {/* My Additional Achievements */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
          My Additional Achievements
        </h3>

        {loadingAchievements ? (
          <div className="py-4 text-center text-sm text-gray-500">Loading...</div>
        ) : myAchievements.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 py-8 text-center">
            <p className="text-sm text-gray-500">No additional achievements recorded yet.</p>
          </div>
        ) : (
          myAchievements.map((ach) => (
            <div
              key={ach.id}
              className="rounded-lg border border-gray-200 bg-white p-4 flex flex-wrap items-start justify-between gap-4"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-900">{ach.kpiTitle}</span>
                  <AchievementStateBadge state={ach.state} />
                </div>
                <div className="mt-1 text-xs text-gray-500 space-x-2">
                  {ach.actualValue != null && <span>Actual: {ach.actualValue}</span>}
                  {ach.computedScore != null && (
                    <span className="text-green-600 font-medium">Score: {Math.round(ach.computedScore)}%</span>
                  )}
                  <span>Recorded: {formatDate(ach.reportingDate)}</span>
                </div>
                {ach.rejectionReason && (
                  <p className="mt-1 text-xs text-red-600">
                    Reason: {ach.rejectionReason}
                  </p>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
