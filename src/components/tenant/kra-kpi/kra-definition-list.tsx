"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Target,
  Zap,
  Archive,
  ChevronRight,
  Undo2,
} from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { KraDefinitionForm } from "./kra-definition-form";

type KraView = {
  id: string;
  tenantId: string;
  periodId: string;
  periodName: string;
  categoryId: string | null;
  categoryLabel: string | null;
  title: string;
  description: string | null;
  weightage: number;
  state: string;
  sortOrder: number;
  kpiCount: number;
  kpiWeightageSum: number;
  activeKpiCount: number;
  activeKpiWeightageSum: number;
  draftKpiCount: number;
};

type CategoryOption = { id: string; displayLabel: string };

export function KraDefinitionList({
  periodId,
  periodName,
  onSelectKra,
  onKrasLoaded,
  onBack,
}: {
  periodId: string;
  periodName?: string;
  onSelectKra?: (kraId: string) => void;
  onKrasLoaded?: (kras: KraView[]) => void;
  onBack?: () => void;
}) {
  const [kras, setKras] = useState<KraView[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [krasRes, catsRes] = await Promise.all([
        fetch(`/api/tenant/kra-kpi/kras?periodId=${periodId}`),
        fetch("/api/tenant/kra-kpi/categories"),
      ]);
      const krasData = await krasRes.json();
      const catsData = await catsRes.json();
      setKras(krasData);
      onKrasLoaded?.(krasData);
      setCategories(catsData.map((c: CategoryOption & { id: string }) => ({ id: c.id, displayLabel: c.displayLabel })));
    } catch {
      setError("Failed to load data.");
    } finally {
      setLoading(false);
    }
  }, [onKrasLoaded, periodId]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const showFeedback = (type: "success" | "error", message: string) => {
    setFeedback({ type, message });
    setTimeout(() => setFeedback(null), 3500);
  };

  const handleAction = async (
    kraId: string,
    action: "activate" | "draft" | "archive" | "delete",
  ) => {
    const labels: Record<string, string> = {
      activate: "Activate",
      draft: "Move to Draft",
      archive: "Archive",
      delete: "Delete",
    };
    if (!window.confirm(`${labels[action]} this KRA?`)) return;
    setActionId(kraId);

    try {
      let url: string;
      let method: string;

      if (action === "activate" || action === "draft") {
        url = `/api/tenant/kra-kpi/kras/${kraId}/state`;
        method = "PATCH";
      } else if (action === "delete") {
        url = `/api/tenant/kra-kpi/kras/${kraId}`;
        method = "DELETE";
      } else {
        url = `/api/tenant/kra-kpi/kras/${kraId}`;
        method = "PATCH";
      }

      const res = await fetch(url, {
        method,
        ...((action === "archive" || action === "activate" || action === "draft") && {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            state:
              action === "archive"
                ? "ARCHIVED"
                : action === "activate"
                  ? "ACTIVE"
                  : "DRAFT",
          }),
        }),
      });
      const data = await res.json();

      if (data.status === "success") {
        showFeedback("success", data.message);
        void fetchData();
      } else {
        showFeedback("error", data.message);
      }
    } catch {
      showFeedback("error", "Action failed.");
    } finally {
      setActionId(null);
    }
  };

  const totalWeightage = kras.filter((k) => k.state !== "ARCHIVED").reduce((s, k) => s + k.weightage, 0);

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
            <h3 className="text-sm font-semibold text-slate-900">KRA Definitions {periodName && <span className="font-normal text-slate-400">— {periodName}</span>}</h3>
            <p className="mt-0.5 text-xs text-slate-400">
              Weightage: <strong className={totalWeightage === 100 ? "text-emerald-600" : "text-amber-600"}>{totalWeightage}/100</strong>
              {totalWeightage === 100 ? " (valid)" : ` (${100 - totalWeightage} remaining)`}
            </p>
          </div>
        </div>
        {!addingNew && (
          <button type="button" onClick={() => setAddingNew(true)} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800">
            <Plus className="h-4 w-4" /> Add KRA
          </button>
        )}
      </div>

      {/* Weightage bar */}
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
        {kras.filter((k) => k.state !== "ARCHIVED").map((kra, i) => (
          <div key={kra.id} className="inline-block h-full" style={{ width: `${kra.weightage}%`, backgroundColor: `hsl(${(i * 60) % 360}, 65%, 55%)` }} title={`${kra.title}: ${kra.weightage}`} />
        ))}
      </div>

      {feedback && (
        <div className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm ${feedback.type === "success" ? "border-brand/20 bg-brand/5 text-brand" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
          {feedback.type === "success" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
          {feedback.message}
        </div>
      )}

      {addingNew && (
        <KraDefinitionForm mode="create" periodId={periodId} categories={categories} onDone={() => { setAddingNew(false); showFeedback("success", "KRA created."); void fetchData(); }} onCancel={() => setAddingNew(false)} />
      )}

      {kras.length === 0 && !addingNew ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-200 py-12 text-center">
          <Target className="h-8 w-8 text-slate-300" />
          <p className="text-sm font-medium text-slate-500">No KRAs defined for this period</p>
        </div>
      ) : (
        <div className="space-y-2">
          {kras.map((kra) => {
            const canActivate = kra.kpiCount > 0 && kra.kpiWeightageSum === kra.weightage;
            const activationHint =
              kra.kpiCount === 0
                ? `Add KPI definitions totaling ${kra.weightage} before activating.`
                : kra.kpiWeightageSum < kra.weightage
                  ? `Add ${kra.weightage - kra.kpiWeightageSum} more KPI weight before activating.`
                  : `Reduce KPI weightage by ${kra.kpiWeightageSum - kra.weightage} before activating.`;
            const needsAttention = kra.state === "DRAFT" && !canActivate;

            return editingId === kra.id ? (
              <KraDefinitionForm key={kra.id} mode="edit" periodId={periodId} categories={categories} initial={kra} onDone={() => { setEditingId(null); showFeedback("success", "KRA updated."); void fetchData(); }} onCancel={() => setEditingId(null)} />
            ) : (
              <div key={kra.id} className={`group flex items-center gap-3 rounded-xl border border-slate-200/80 bg-white px-4 py-3.5 transition hover:border-slate-300 ${kra.state === "ARCHIVED" ? "opacity-50" : ""}`}>
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                  <Target className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">{kra.title}</span>
                    <StatusBadge label={kra.state} />
                    {kra.categoryLabel && (
                      <span className="rounded-md bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">{kra.categoryLabel}</span>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-3 text-[11px] text-slate-400">
                    <span className="font-semibold text-slate-600">Weight: {kra.weightage}</span>
                    <span>{kra.kpiCount} KPI(s)</span>
                    <span className={kra.activeKpiWeightageSum === kra.weightage ? "text-emerald-500" : "text-amber-500"}>
                      Active KPI sum: {kra.activeKpiWeightageSum}/{kra.weightage}
                    </span>
                    {kra.draftKpiCount > 0 && <span>Draft KPIs: {kra.draftKpiCount}</span>}
                  </div>
                  {needsAttention && (
                    <p className="mt-1 text-[11px] text-amber-600">{activationHint}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {kra.state === "DRAFT" && (
                    <button type="button" onClick={() => handleAction(kra.id, "activate")} disabled={!canActivate || actionId === kra.id} className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${canActivate ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"}`} title={canActivate ? "Activate" : activationHint}>
                      {actionId === kra.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />} Activate
                    </button>
                  )}
                  {kra.state === "ACTIVE" && (
                    <button
                      type="button"
                      onClick={() => handleAction(kra.id, "draft")}
                      disabled={actionId === kra.id}
                      className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] font-semibold text-amber-700 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                      title="Move KRA and its KPIs back to draft"
                    >
                      {actionId === kra.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />} Draft
                    </button>
                  )}
                  {kra.state !== "ARCHIVED" && (
                    <>
                      <button type="button" onClick={() => setEditingId(kra.id)} className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-blue-200 hover:text-blue-600" title="Edit">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={() => handleAction(kra.id, "delete")} disabled={actionId === kra.id} className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-rose-200 hover:text-rose-600 disabled:opacity-50" title="Delete">
                        {actionId === kra.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                      <button type="button" onClick={() => handleAction(kra.id, "archive")} disabled={actionId === kra.id} className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-amber-200 hover:text-amber-600 disabled:opacity-50" title="Archive">
                        <Archive className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                  {onSelectKra && (
                    <button type="button" onClick={() => onSelectKra(kra.id)} className={`flex h-7 w-7 items-center justify-center rounded-lg border bg-white transition ${needsAttention ? "border-brand bg-brand/5 text-brand" : "border-slate-200 text-slate-500 hover:border-brand hover:text-brand"}`} title={needsAttention ? "Open KPI definitions to complete this KRA" : "View KPIs"}>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
