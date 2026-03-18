"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  Pencil,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Calendar,
  ChevronRight,
} from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { AssessmentPeriodForm } from "./assessment-period-form";

type PeriodView = {
  id: string;
  name: string;
  code: string;
  periodType: string;
  startDate: string;
  endDate: string;
  state: string;
  reviewFrequency: string;
  targetSettingDeadline: string | null;
  achievementDeadline: string | null;
  reviewDeadline: string | null;
  description: string | null;
  kraCount: number;
};

const PERIOD_STATES = [
  "DRAFT",
  "OPEN",
  "IN_PROGRESS",
  "UNDER_REVIEW",
  "CLOSED",
  "ARCHIVED",
] as const;

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function AssessmentPeriodList({ onSelectPeriod }: { onSelectPeriod?: (periodId: string) => void }) {
  const [periods, setPeriods] = useState<PeriodView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [transitioningId, setTransitioningId] = useState<string | null>(null);
  const [selectedStates, setSelectedStates] = useState<Record<string, string>>({});

  const fetchPeriods = useCallback(async () => {
    try {
      const res = await fetch("/api/tenant/kra-kpi/periods");
      const data = await res.json();
      setPeriods(data);
      if (Array.isArray(data)) {
        setSelectedStates(
          Object.fromEntries(
            data.map((period: PeriodView) => [period.id, period.state]),
          ),
        );
      }
    } catch {
      setError("Failed to load periods.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchPeriods(); }, [fetchPeriods]);

  const showFeedback = (type: "success" | "error", message: string) => {
    setFeedback({ type, message });
    setTimeout(() => setFeedback(null), 3500);
  };

  const handleTransition = async (period: PeriodView) => {
    const next = selectedStates[period.id] ?? period.state;
    if (next === period.state) {
      return;
    }
    if (!window.confirm(`Change "${period.name}" from ${period.state} to ${next}?`)) return;

    setTransitioningId(period.id);
    try {
      const res = await fetch(`/api/tenant/kra-kpi/periods/${period.id}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newState: next }),
      });
      const data = await res.json();
      if (data.status === "success") {
        showFeedback("success", data.message);
        void fetchPeriods();
      } else {
        showFeedback("error", data.message);
      }
    } catch {
      showFeedback("error", "Transition failed.");
    } finally {
      setTransitioningId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        <AlertCircle className="h-4 w-4 shrink-0" /> {error}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Assessment Periods</h3>
          <p className="mt-0.5 text-xs text-slate-400">Manage assessment periods and their lifecycle</p>
        </div>
        {!addingNew && (
          <button type="button" onClick={() => setAddingNew(true)} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800">
            <Plus className="h-4 w-4" /> Add period
          </button>
        )}
      </div>

      {feedback && (
        <div className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm ${feedback.type === "success" ? "border-brand/20 bg-brand/5 text-brand" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
          {feedback.type === "success" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
          {feedback.message}
        </div>
      )}

      {addingNew && (
        <AssessmentPeriodForm
          mode="create"
          onDone={() => { setAddingNew(false); showFeedback("success", "Period created."); void fetchPeriods(); }}
          onCancel={() => setAddingNew(false)}
        />
      )}

      {periods.length === 0 && !addingNew ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-200 py-12 text-center">
          <Calendar className="h-8 w-8 text-slate-300" />
          <p className="text-sm font-medium text-slate-500">No assessment periods yet</p>
          <p className="text-xs text-slate-400">Create a period to start defining KRAs and KPIs</p>
        </div>
      ) : (
        <div className="space-y-2">
          {periods.map((period) =>
            editingId === period.id ? (
              <AssessmentPeriodForm
                key={period.id}
                mode="edit"
                initial={period as Parameters<typeof AssessmentPeriodForm>[0]["initial"]}
                onDone={() => { setEditingId(null); showFeedback("success", "Period updated."); void fetchPeriods(); }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <div key={period.id} className="group rounded-xl border border-slate-200/80 bg-white px-4 py-3.5 transition hover:border-slate-300">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                    <Calendar className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">{period.name}</span>
                      <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-500">{period.code}</span>
                      <StatusBadge label={period.state} />
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
                      <span>{formatDate(period.startDate)} — {formatDate(period.endDate)}</span>
                      <span>{period.periodType.replace(/_/g, " ")}</span>
                      <span>Review: {period.reviewFrequency.replace(/_/g, " ")}</span>
                      <span>{period.kraCount} KRA(s)</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
                      <select
                        value={selectedStates[period.id] ?? period.state}
                        onChange={(event) =>
                          setSelectedStates((prev) => ({
                            ...prev,
                            [period.id]: event.target.value,
                          }))
                        }
                        className="bg-transparent text-[11px] font-semibold text-slate-700 outline-none"
                      >
                        {PERIOD_STATES.map((state) => (
                          <option key={state} value={state}>
                            {state.replace(/_/g, " ")}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => handleTransition(period)}
                        disabled={
                          transitioningId === period.id ||
                          (selectedStates[period.id] ?? period.state) === period.state
                        }
                        className="inline-flex items-center gap-1 rounded-lg border border-brand/20 bg-brand/5 px-2 py-1 text-[11px] font-semibold text-brand transition hover:bg-brand/10 disabled:opacity-50"
                      >
                        {transitioningId === period.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <ChevronRight className="h-3 w-3" />
                        )}
                        Apply stage
                      </button>
                    </div>
                    {(period.state === "DRAFT" || period.state === "OPEN") && (
                      <button
                        type="button"
                        onClick={() => setEditingId(period.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 transition hover:border-blue-200 hover:text-blue-600"
                        title="Edit"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit
                      </button>
                    )}
                    {onSelectPeriod && (
                      <button type="button" onClick={() => onSelectPeriod(period.id)} className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-brand hover:text-brand" title="View KRAs">
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
