"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  AlertCircle,
  CheckCircle2,
  BarChart3,
  ChevronRight,
  Zap,
  Undo2,
  CopyPlus,
  X,
} from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import {
  getMeasurementCapValue,
  type MeasurementConfig,
} from "@/lib/kra-kpi/shared";
import {
  NAAC_TEMPLATE_CATEGORY,
  NAAC_UNIVERSITY_STARTER_PACK_KEY,
} from "@/lib/kra-kpi/naac-template-constants";
import { KpiBuilderForm } from "./kpi-builder-form";

type KpiView = {
  id: string;
  kraDefinitionId: string;
  kraTitle: string;
  kraState: string;
  title: string;
  description: string | null;
  sourceTemplateCode?: string | null;
  sourceTemplatePackKey?: string | null;
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
  startingUnitName: string;
  state: string;
  sortOrder: number;
  guidanceNotes: string | null;
  allocationCount: number;
  accreditationLinkCount: number;
  // R2 fields
  keyUnitId?: string | null;
  keyUnitName?: string | null;
  finalUnitId?: string | null;
  finalUnitName?: string | null;
  targetUnitCount?: number;
  isTeamKpi?: boolean;
  evidenceRequired?: boolean;
  allowPartialCompletion?: boolean;
};

type UnitOption = { id: string; name: string };
type TemplateRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: string | null;
  builderPayload?: {
    meta?: {
      starterPackKey?: string | null;
    };
  };
};

export function KpiDefinitionList({
  kraDefinitionId,
  kraTitle,
  kraWeightage,
  onBack,
  onKpisLoaded,
}: {
  kraDefinitionId: string;
  kraTitle?: string;
  kraWeightage?: number;
  onBack?: () => void;
  onKpisLoaded?: (kpis: KpiView[]) => void;
}) {
  const [kpis, setKpis] = useState<KpiView[]>([]);
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [starterPackOpen, setStarterPackOpen] = useState(false);
  const [starterTemplates, setStarterTemplates] = useState<TemplateRow[]>([]);
  const [starterTemplatesLoading, setStarterTemplatesLoading] = useState(false);
  const [starterPackError, setStarterPackError] = useState<string | null>(null);
  const [starterPackStartingUnitId, setStarterPackStartingUnitId] = useState("");
  const [selectedStarterTemplateIds, setSelectedStarterTemplateIds] = useState<string[]>([]);
  const [starterPackSubmitting, setStarterPackSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [enabledServices, setEnabledServices] = useState<string[]>([]);
  const appliedStarterTemplateCodes = useMemo(
    () =>
      new Set(
        kpis
          .map((kpi) => kpi.sourceTemplateCode)
          .filter((code): code is string => typeof code === "string" && code.length > 0),
      ),
    [kpis],
  );

  const fetchData = useCallback(async () => {
    try {
      const [kpisRes, unitsRes] = await Promise.all([
        fetch(`/api/tenant/kra-kpi/kpis?kraDefinitionId=${kraDefinitionId}`),
        fetch("/api/tenant/structure/units"),
      ]);
      if (!kpisRes.ok) {
        throw new Error("Failed to load KPIs.");
      }
      if (!unitsRes.ok) {
        throw new Error("Failed to load structure units. Create or publish units first.");
      }
      const kpisData = await kpisRes.json();
      const unitsData = await unitsRes.json();
      setKpis(kpisData);
      onKpisLoaded?.(kpisData);
      if (Array.isArray(unitsData)) {
        setUnits(unitsData.map((u: UnitOption) => ({ id: u.id, name: u.name })));
      }
      setError(null);
    } catch {
      setError("Failed to load KPI setup data. Ensure the tenant has structure units available.");
    } finally {
      setLoading(false);
    }
  }, [kraDefinitionId, onKpisLoaded]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  useEffect(() => {
    let cancelled = false;

    async function loadServices() {
      try {
        const response = await fetch("/api/tenant/services", { cache: "no-store" });
        if (!response.ok) {
          if (!cancelled) {
            setEnabledServices([]);
          }
          return;
        }
        const data = (await response.json()) as { enabledServices?: string[] };
        if (!cancelled) {
          setEnabledServices(Array.isArray(data.enabledServices) ? data.enabledServices : []);
        }
      } catch {
        if (!cancelled) {
          setEnabledServices([]);
        }
      }
    }

    void loadServices();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!starterPackOpen || starterTemplates.length === 0) {
      return;
    }
    setSelectedStarterTemplateIds((current) =>
      current.filter((templateId) => {
        const template = starterTemplates.find((row) => row.id === templateId);
        return template ? !appliedStarterTemplateCodes.has(template.code) : false;
      }),
    );
  }, [appliedStarterTemplateCodes, starterPackOpen, starterTemplates]);

  const showFeedback = (type: "success" | "error", message: string) => {
    setFeedback({ type, message });
    setTimeout(() => setFeedback(null), 3500);
  };

  const loadStarterPackTemplates = useCallback(async () => {
    setStarterTemplatesLoading(true);
    setStarterPackError(null);
    try {
      const response = await fetch("/api/tenant/kra-kpi/kpi-templates", {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("Failed to load KPI starter templates.");
      }
      const rows = (await response.json()) as TemplateRow[];
      const templates = rows.filter((template) => {
        const starterPackKey = template.builderPayload?.meta?.starterPackKey ?? null;
        return (
          starterPackKey === NAAC_UNIVERSITY_STARTER_PACK_KEY &&
          template.category === NAAC_TEMPLATE_CATEGORY
        );
      });
      setStarterTemplates(templates);
      setSelectedStarterTemplateIds(
        templates
          .filter((template) => !appliedStarterTemplateCodes.has(template.code))
          .map((template) => template.id),
      );
    } catch (loadError) {
      setStarterPackError(
        loadError instanceof Error ? loadError.message : "Failed to load KPI starter templates.",
      );
    } finally {
      setStarterTemplatesLoading(false);
    }
  }, [appliedStarterTemplateCodes]);

  const openStarterPack = useCallback(() => {
    setAddingNew(false);
    setEditingId(null);
    setStarterPackOpen(true);
    setStarterPackStartingUnitId((current) => current || units[0]?.id || "");
    void loadStarterPackTemplates();
  }, [loadStarterPackTemplates, units]);

  const closeStarterPack = useCallback(() => {
    setStarterPackOpen(false);
    setStarterPackError(null);
    setStarterPackSubmitting(false);
  }, []);

  const handleStarterTemplateToggle = (templateId: string, checked: boolean) => {
    setSelectedStarterTemplateIds((current) => {
      if (checked) {
        return current.includes(templateId) ? current : [...current, templateId];
      }
      return current.filter((value) => value !== templateId);
    });
  };

  const handleStarterPackApply = async () => {
    if (!starterPackStartingUnitId || selectedStarterTemplateIds.length === 0) {
      return;
    }

    setStarterPackSubmitting(true);
    setStarterPackError(null);
    try {
      const response = await fetch("/api/tenant/kra-kpi/kpi-template-packs/apply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          kraDefinitionId,
          starterPackKey: NAAC_UNIVERSITY_STARTER_PACK_KEY,
          startingUnitId: starterPackStartingUnitId,
          templateIds: selectedStarterTemplateIds,
        }),
      });
      const data = (await response.json()) as {
        status: "success" | "error";
        message: string;
        createdCount?: number;
        skippedDuplicates?: Array<unknown>;
        failedTemplates?: Array<unknown>;
      };

      if (!response.ok || data.status === "error") {
        setStarterPackError(data.message ?? "Failed to apply starter pack.");
        return;
      }

      const failureCount = Array.isArray(data.failedTemplates) ? data.failedTemplates.length : 0;
      const duplicateCount = Array.isArray(data.skippedDuplicates)
        ? data.skippedDuplicates.length
        : 0;
      const createdCount = typeof data.createdCount === "number" ? data.createdCount : 0;
      const summaryParts = [`Created ${createdCount} starter KPI${createdCount === 1 ? "" : "s"}.`];
      if (duplicateCount > 0) {
        summaryParts.push(`Skipped ${duplicateCount} already applied template${duplicateCount === 1 ? "" : "s"}.`);
      }
      if (failureCount > 0) {
        summaryParts.push(`${failureCount} template${failureCount === 1 ? "" : "s"} failed.`);
      }
      showFeedback(
        createdCount > 0 || duplicateCount > 0 ? "success" : "error",
        summaryParts.join(" "),
      );
      closeStarterPack();
      await fetchData();
    } catch (applyError) {
      setStarterPackError(
        applyError instanceof Error ? applyError.message : "Failed to apply starter pack.",
      );
    } finally {
      setStarterPackSubmitting(false);
    }
  };

  const handleDelete = async (kpi: KpiView) => {
    if (!window.confirm(`Delete KPI "${kpi.title}"?`)) return;
    setActionId(kpi.id);
    try {
      const res = await fetch(`/api/tenant/kra-kpi/kpis/${kpi.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.status === "success") {
        showFeedback("success", data.message);
        void fetchData();
      } else {
        showFeedback("error", data.message);
      }
    } catch {
      showFeedback("error", "Delete failed.");
    } finally {
      setActionId(null);
    }
  };

  const handleStateChange = async (
    kpi: KpiView,
    nextState: "ACTIVE" | "DRAFT",
  ) => {
    const verb = nextState === "ACTIVE" ? "activate" : "move to draft";
    if (!window.confirm(`${verb} KPI "${kpi.title}"?`)) return;

    setActionId(kpi.id);
    try {
      const res = await fetch(`/api/tenant/kra-kpi/kpis/${kpi.id}/state`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: nextState }),
      });
      const data = await res.json();
      if (data.status === "success") {
        showFeedback("success", data.message);
        void fetchData();
      } else {
        showFeedback("error", data.message);
      }
    } catch {
      showFeedback("error", "State change failed.");
    } finally {
      setActionId(null);
    }
  };

  const activeKpiWeightageSum = kpis
    .filter((k) => k.state === "ACTIVE")
    .reduce((sum, kpi) => sum + kpi.weightage, 0);
  const draftKpiCount = kpis.filter((k) => k.state === "DRAFT").length;
  const parentKraState = kpis[0]?.kraState ?? "DRAFT";
  const noUnitsAvailable = units.length === 0;
  const accreditationEnabled = enabledServices.includes("ACCREDITATION");

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:text-slate-700"
            >
              <ChevronRight className="h-4 w-4 rotate-180" />
            </button>
          )}
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              KPI Definitions{" "}
              {kraTitle && (
                <span className="font-normal text-slate-400">- {kraTitle}</span>
              )}
            </h3>
            <p className="mt-0.5 text-xs text-slate-400">
              Active KPI weightage sum:{" "}
              <strong
                className={
                  activeKpiWeightageSum === (kraWeightage ?? 0)
                    ? "text-emerald-600"
                    : "text-amber-600"
                }
              >
                {activeKpiWeightageSum}/{kraWeightage ?? "?"}
              </strong>
              {activeKpiWeightageSum === (kraWeightage ?? 0)
                ? " (valid)"
                : ` (${(kraWeightage ?? 0) - activeKpiWeightageSum} remaining)`}
              {draftKpiCount > 0 && <span className="ml-2">Draft KPIs: {draftKpiCount}</span>}
            </p>
          </div>
        </div>
        {!addingNew && (
          <div className="flex items-center gap-2">
            {!starterPackOpen && (
              <button
                type="button"
                onClick={openStarterPack}
                disabled={noUnitsAvailable}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
                title={
                  noUnitsAvailable
                    ? "Create or publish at least one structure unit before applying starter KPIs."
                    : "Apply Starter Pack"
                }
              >
                <CopyPlus className="h-4 w-4" /> Apply Starter Pack
              </button>
            )}
              <button
                type="button"
                onClick={() => {
                  setEditingId(null);
                  setStarterPackOpen(false);
                  setAddingNew(true);
                }}
              disabled={noUnitsAvailable}
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              title={
                noUnitsAvailable
                  ? "Create or publish at least one structure unit before adding KPIs."
                  : "Add KPI"
              }
            >
              <Plus className="h-4 w-4" /> Add KPI
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {!error && noUnitsAvailable && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          No structure units are available for KPI starting-unit selection yet. Create or publish your org structure first.
        </div>
      )}

      {feedback && (
        <div
          className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm ${
            feedback.type === "success"
              ? "border-brand/20 bg-brand/5 text-brand"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {feedback.type === "success" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          {feedback.message}
        </div>
      )}

      {starterPackOpen && !noUnitsAvailable && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-slate-900">
                NAAC University 2019 Faculty Starter
              </h4>
              <p className="mt-1 text-xs text-slate-500">
                Apply ready-made NAAC faculty KPI templates into this KRA. Targets stay blank so your team can plan allocations later.
              </p>
            </div>
            <button
              type="button"
              onClick={closeStarterPack}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:text-slate-800"
              title="Close starter pack"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,240px)_1fr]">
            <div className="space-y-2">
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Starting Unit
              </label>
              <select
                value={starterPackStartingUnitId}
                onChange={(event) => setStarterPackStartingUnitId(event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand focus:ring-1 focus:ring-brand/30"
              >
                <option value="">Select starting unit...</option>
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-400">
                One shared starting unit is used for all selected starter KPIs in this batch.
              </p>
            </div>

            <div className="space-y-3">
              {starterPackError && (
                <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  {starterPackError}
                </div>
              )}

              {starterTemplatesLoading ? (
                <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading starter templates...
                </div>
              ) : starterTemplates.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 px-3 py-6 text-sm text-slate-500">
                  No NAAC starter templates are available.
                </div>
              ) : (
                <div className="space-y-2">
                  {starterTemplates.map((template) => {
                    const alreadyApplied = appliedStarterTemplateCodes.has(template.code);
                    const checked = selectedStarterTemplateIds.includes(template.id);
                    return (
                      <label
                        key={template.id}
                        className={`flex items-start gap-3 rounded-xl border px-3 py-3 text-sm ${
                          alreadyApplied
                            ? "border-slate-200 bg-slate-50 text-slate-400"
                            : "border-slate-200 bg-white text-slate-700"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={alreadyApplied}
                          onChange={(event) => handleStarterTemplateToggle(template.id, event.target.checked)}
                          className="mt-1 h-4 w-4 rounded border-slate-300"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-slate-900">{template.name}</span>
                            {alreadyApplied && (
                              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                                Already applied
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-slate-500">
                            {template.description ?? "Ready-made starter KPI template."}
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={closeStarterPack}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleStarterPackApply()}
                  disabled={
                    starterPackSubmitting ||
                    !starterPackStartingUnitId ||
                    selectedStarterTemplateIds.length === 0
                  }
                  className="inline-flex items-center gap-1.5 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {starterPackSubmitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CopyPlus className="h-4 w-4" />
                  )}
                  Apply Selected Starter KPIs
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {addingNew && !noUnitsAvailable && (
        <KpiBuilderForm
          mode="create"
          kraDefinitionId={kraDefinitionId}
          units={units}
          onDone={() => {
            setAddingNew(false);
            showFeedback("success", "KPI created.");
            void fetchData();
          }}
          onCancel={() => setAddingNew(false)}
        />
      )}

      {kpis.length === 0 && !addingNew ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-200 py-12 text-center">
          <BarChart3 className="h-8 w-8 text-slate-300" />
          <p className="text-sm font-medium text-slate-500">
            No KPIs defined for this KRA
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {kpis.map((kpi) =>
            editingId === kpi.id ? (
              <KpiBuilderForm
                key={kpi.id}
                mode="edit"
                kraDefinitionId={kraDefinitionId}
                units={units}
                initial={kpi}
                onDone={() => {
                  setEditingId(null);
                  showFeedback("success", "KPI updated.");
                  void fetchData();
                }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <div key={kpi.id}>
              <div
                className="group flex items-center gap-3 rounded-xl border border-slate-200/80 bg-white px-4 py-3.5 transition hover:border-slate-300"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                  <BarChart3 className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">
                      {kpi.title}
                    </span>
                    <StatusBadge label={kpi.state} />
                    {kpi.isPerCapita && (
                      <span className="rounded-md bg-purple-50 px-1.5 py-0.5 text-[9px] font-bold uppercase text-purple-600">
                        Per capita
                      </span>
                    )}
                    {(kpi.targetUnitCount ?? 0) > 0 && (
                      <span className="rounded-md bg-cyan-50 px-1.5 py-0.5 text-[9px] font-bold uppercase text-cyan-700">
                        {kpi.targetUnitCount} target dept{kpi.targetUnitCount !== 1 ? "s" : ""}
                      </span>
                    )}
                    {kpi.keyUnitName && (
                      <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-700">
                        Key: {kpi.keyUnitName}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
                    <span className="font-semibold text-slate-600">
                      Weight: {kpi.weightage}
                    </span>
                    <span>{kpi.measurementType}</span>
                    <span>
                      {kpi.scoringMethod} / {kpi.scoringDirection}
                    </span>
                    <span>{kpi.allocationType}</span>
                    <span>Unit: {kpi.startingUnitName}</span>
                    {kpi.kraState !== "ACTIVE" && <span>KRA: {kpi.kraState}</span>}
                    {getMeasurementCapValue(kpi.measurementType, kpi.measurementConfig) != null && (
                      <span>
                        Cap: {getMeasurementCapValue(kpi.measurementType, kpi.measurementConfig)}
                      </span>
                    )}
                    <span>{kpi.allocationCount} allocation(s)</span>
                    {(kpi.targetUnitCount ?? 0) > 0 && (
                      <span>{kpi.targetUnitCount} target dept(s)</span>
                    )}
                  </div>
                  {accreditationEnabled ? (
                    <div className="mt-2 flex items-center gap-3 text-[11px]">
                      <span className="rounded-full bg-amber-50 px-2 py-1 font-semibold text-amber-700">
                        Accreditation links: {kpi.accreditationLinkCount ?? 0}
                      </span>
                      <Link
                        href={`/tenant-admin/accreditation?kpiId=${kpi.id}`}
                        className="font-semibold text-slate-600 transition hover:text-slate-900"
                      >
                        Manage Accreditation Links
                      </Link>
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {kpi.state === "DRAFT" && (
                    <button
                      type="button"
                      onClick={() => handleStateChange(kpi, "ACTIVE")}
                      disabled={actionId === kpi.id || kpi.kraState !== "ACTIVE"}
                      className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
                      title={
                        kpi.kraState === "ACTIVE"
                          ? "Activate KPI"
                          : "Activate the parent KRA first"
                      }
                    >
                      {actionId === kpi.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Zap className="h-3 w-3" />
                      )}{" "}
                      Activate
                    </button>
                  )}
                  {kpi.state === "ACTIVE" && (
                    <button
                      type="button"
                      onClick={() => handleStateChange(kpi, "DRAFT")}
                      disabled={actionId === kpi.id}
                      className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700 transition hover:bg-amber-100 disabled:opacity-50"
                      title="Move KPI back to draft"
                    >
                      {actionId === kpi.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Undo2 className="h-3 w-3" />
                      )}{" "}
                      Draft
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setStarterPackOpen(false);
                      setEditingId(kpi.id);
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-blue-200 hover:text-blue-600"
                    title="Edit"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(kpi)}
                    disabled={actionId === kpi.id}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-rose-200 hover:text-rose-600 disabled:opacity-50"
                    title="Delete"
                  >
                    {actionId === kpi.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>
              </div>
            ),
          )}
        </div>
      )}

      {parentKraState !== "ACTIVE" && kpis.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-700">
          The parent KRA is in {parentKraState}. KPI activation is locked until the KRA is ACTIVE.
        </div>
      )}
    </div>
  );
}
