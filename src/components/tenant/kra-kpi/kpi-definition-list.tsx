"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  AlertCircle,
  CheckCircle2,
  BarChart3,
  ChevronRight,
} from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { KpiDefinitionForm } from "./kpi-definition-form";

type KpiView = {
  id: string;
  kraDefinitionId: string;
  kraTitle: string;
  title: string;
  description: string | null;
  measurementType: string;
  unitLabel: string | null;
  weightage: number;
  defaultTarget: number | null;
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
};

type UnitOption = { id: string; name: string };

export function KpiDefinitionList({
  kraDefinitionId,
  kraTitle,
  kraWeightage,
  onBack,
}: {
  kraDefinitionId: string;
  kraTitle?: string;
  kraWeightage?: number;
  onBack?: () => void;
}) {
  const [kpis, setKpis] = useState<KpiView[]>([]);
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
      if (Array.isArray(unitsData)) {
        setUnits(unitsData.map((u: UnitOption) => ({ id: u.id, name: u.name })));
      }
      setError(null);
    } catch {
      setError("Failed to load KPI setup data. Ensure the tenant has structure units available.");
    } finally {
      setLoading(false);
    }
  }, [kraDefinitionId]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const showFeedback = (type: "success" | "error", message: string) => {
    setFeedback({ type, message });
    setTimeout(() => setFeedback(null), 3500);
  };

  const handleDelete = async (kpi: KpiView) => {
    if (!window.confirm(`Delete KPI "${kpi.title}"?`)) return;
    setDeletingId(kpi.id);
    try {
      const res = await fetch(`/api/tenant/kra-kpi/kpis/${kpi.id}`, { method: "DELETE" });
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
      setDeletingId(null);
    }
  };

  const kpiWeightageSum = kpis.filter((k) => k.state !== "ARCHIVED").reduce((s, k) => s + k.weightage, 0);
  const noUnitsAvailable = units.length === 0;

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {onBack && (
            <button type="button" onClick={onBack} className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:text-slate-700">
              <ChevronRight className="h-4 w-4 rotate-180" />
            </button>
          )}
          <div>
            <h3 className="text-sm font-semibold text-slate-900">KPI Definitions {kraTitle && <span className="font-normal text-slate-400">— {kraTitle}</span>}</h3>
            <p className="mt-0.5 text-xs text-slate-400">
              KPI weightage sum: <strong className={kpiWeightageSum === (kraWeightage ?? 0) ? "text-emerald-600" : "text-amber-600"}>{kpiWeightageSum}/{kraWeightage ?? "?"}</strong>
              {kpiWeightageSum === (kraWeightage ?? 0) ? " (valid)" : ` (${(kraWeightage ?? 0) - kpiWeightageSum} remaining)`}
            </p>
          </div>
        </div>
        {!addingNew && (
          <button type="button" onClick={() => setAddingNew(true)} disabled={noUnitsAvailable} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50" title={noUnitsAvailable ? "Create or publish at least one structure unit before adding KPIs." : "Add KPI"}>
            <Plus className="h-4 w-4" /> Add KPI
          </button>
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
        <div className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm ${feedback.type === "success" ? "border-brand/20 bg-brand/5 text-brand" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
          {feedback.type === "success" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
          {feedback.message}
        </div>
      )}

      {addingNew && !noUnitsAvailable && (
        <KpiDefinitionForm mode="create" kraDefinitionId={kraDefinitionId} units={units} onDone={() => { setAddingNew(false); showFeedback("success", "KPI created."); void fetchData(); }} onCancel={() => setAddingNew(false)} />
      )}

      {kpis.length === 0 && !addingNew ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-200 py-12 text-center">
          <BarChart3 className="h-8 w-8 text-slate-300" />
          <p className="text-sm font-medium text-slate-500">No KPIs defined for this KRA</p>
        </div>
      ) : (
        <div className="space-y-2">
          {kpis.map((kpi) =>
            editingId === kpi.id ? (
              <KpiDefinitionForm key={kpi.id} mode="edit" kraDefinitionId={kraDefinitionId} units={units} initial={kpi} onDone={() => { setEditingId(null); showFeedback("success", "KPI updated."); void fetchData(); }} onCancel={() => setEditingId(null)} />
            ) : (
              <div key={kpi.id} className="group flex items-center gap-3 rounded-xl border border-slate-200/80 bg-white px-4 py-3.5 transition hover:border-slate-300">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                  <BarChart3 className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">{kpi.title}</span>
                    <StatusBadge label={kpi.state} />
                    {kpi.isPerCapita && <span className="rounded-md bg-purple-50 px-1.5 py-0.5 text-[9px] font-bold uppercase text-purple-600">Per capita</span>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
                    <span className="font-semibold text-slate-600">Weight: {kpi.weightage}</span>
                    <span>{kpi.measurementType}</span>
                    <span>{kpi.scoringMethod} / {kpi.scoringDirection}</span>
                    <span>{kpi.allocationType}</span>
                    <span>Unit: {kpi.startingUnitName}</span>
                    <span>{kpi.allocationCount} allocation(s)</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button type="button" onClick={() => setEditingId(kpi.id)} className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-blue-200 hover:text-blue-600" title="Edit">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" onClick={() => handleDelete(kpi)} disabled={deletingId === kpi.id} className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-rose-200 hover:text-rose-600 disabled:opacity-50" title="Delete">
                    {deletingId === kpi.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
