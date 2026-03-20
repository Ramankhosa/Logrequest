"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, AlertCircle, Target, BarChart3, Users, ClipboardCheck, TrendingUp, Award, RefreshCw, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StoredReviewCycleView } from "@/lib/kra-kpi/shared";

type PeriodSummary = {
  periodId: string;
  periodName: string;
  totalKras: number;
  totalKpis: number;
  totalAllocations: number;
  totalAchievements: number;
  verifiedAchievements: number;
  pendingVerification: number;
  overallWeightedScore: number;
  maxPossibleScore: number;
  overallPercentage: number;
};

function MetricTile({ label, value, icon: Icon, accent }: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  accent: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
      <div className="flex items-center gap-3">
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", accent)}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-2xl font-bold tabular-nums text-slate-900">{value}</p>
          <p className="text-[11px] font-medium text-slate-400">{label}</p>
        </div>
      </div>
    </div>
  );
}

export function PeriodDashboard({ periodId, isAdmin }: { periodId: string; isAdmin?: boolean }) {
  const [summary, setSummary] = useState<PeriodSummary | null>(null);
  const [cycles, setCycles] = useState<StoredReviewCycleView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryRes, cyclesRes] = await Promise.all([
        fetch(`/api/tenant/kra-kpi/summary?periodId=${periodId}`),
        fetch(`/api/tenant/kra-kpi/periods/${periodId}/review-cycles`),
      ]);
      if (!summaryRes.ok) throw new Error();
      setSummary(await summaryRes.json());
      if (cyclesRes.ok) {
        const data = await cyclesRes.json();
        setCycles(data.cycles ?? []);
      }
    } catch {
      setError("Failed to load summary.");
    } finally {
      setLoading(false);
    }
  }, [periodId]);

  useEffect(() => { void fetchSummary(); }, [fetchSummary]);

  const handleRegenerate = async () => {
    if (!window.confirm("Regenerate review cycles? This will replace existing cycles.")) return;
    setRegenerating(true);
    try {
      const res = await fetch(`/api/tenant/kra-kpi/periods/${periodId}/review-cycles`, {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        setCycles(data.data ?? []);
      }
    } catch { /* non-fatal */ }
    setRegenerating(false);
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>;
  }

  if (error || !summary) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        <AlertCircle className="h-4 w-4 shrink-0" /> {error ?? "No data."}
      </div>
    );
  }

  const scoreColor = summary.overallPercentage >= 80
    ? "text-emerald-600"
    : summary.overallPercentage >= 60
      ? "text-brand"
      : summary.overallPercentage >= 40
        ? "text-amber-600"
        : "text-rose-600";

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">Period Dashboard</h3>
        <p className="mt-0.5 text-xs text-slate-400">{summary.periodName}</p>
      </div>

      {/* Overall score */}
      <div className="rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white to-slate-50/50 p-6 text-center shadow-[0_4px_16px_rgba(0,0,0,0.04)]">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Overall Score</p>
        <p className={cn("mt-2 text-5xl font-bold tabular-nums", scoreColor)}>
          {summary.overallPercentage.toFixed(1)}%
        </p>
        <p className="mt-1 text-sm text-slate-500">
          Weighted: {summary.overallWeightedScore} / {summary.maxPossibleScore}
        </p>
        <div className="mx-auto mt-3 h-2 w-2/3 overflow-hidden rounded-full bg-slate-100">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              summary.overallPercentage >= 80 ? "bg-emerald-500"
                : summary.overallPercentage >= 60 ? "bg-brand"
                  : summary.overallPercentage >= 40 ? "bg-amber-500"
                    : "bg-rose-500",
            )}
            style={{ width: `${Math.min(summary.overallPercentage, 100)}%` }}
          />
        </div>
      </div>

      {/* Metrics grid */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <MetricTile label="Active KRAs" value={summary.totalKras} icon={Target} accent="bg-blue-50 text-blue-600" />
        <MetricTile label="Active KPIs" value={summary.totalKpis} icon={BarChart3} accent="bg-purple-50 text-purple-600" />
        <MetricTile label="Allocations" value={summary.totalAllocations} icon={Users} accent="bg-slate-100 text-slate-600" />
        <MetricTile label="Total Achievements" value={summary.totalAchievements} icon={ClipboardCheck} accent="bg-brand-soft text-brand" />
        <MetricTile label="Verified" value={summary.verifiedAchievements} icon={Award} accent="bg-emerald-50 text-emerald-600" />
        <MetricTile label="Pending Verification" value={summary.pendingVerification} icon={TrendingUp} accent="bg-amber-50 text-amber-600" />
      </div>

      {/* Review Cycles */}
      <ReviewCyclesSection
        cycles={cycles}
        isAdmin={isAdmin}
        regenerating={regenerating}
        onRegenerate={handleRegenerate}
      />
    </div>
  );
}

function ReviewCyclesSection({
  cycles,
  isAdmin,
  regenerating,
  onRegenerate,
}: {
  cycles: StoredReviewCycleView[];
  isAdmin?: boolean;
  regenerating: boolean;
  onRegenerate: () => void;
}) {
  const currentCycle = cycles.find((c) => c.isCurrent);
  const now = new Date();
  const daysRemaining = currentCycle
    ? Math.ceil((new Date(currentCycle.endDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-slate-500" />
          <h4 className="text-sm font-semibold text-slate-900">Review Cycles</h4>
          {cycles.length > 0 && (
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
              {cycles.length}
            </span>
          )}
        </div>
        {isAdmin && cycles.length > 0 && (
          <button
            type="button"
            onClick={onRegenerate}
            disabled={regenerating}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-600 transition hover:border-slate-300 disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3 w-3", regenerating && "animate-spin")} />
            Regenerate
          </button>
        )}
      </div>

      {cycles.length === 0 ? (
        <p className="text-xs text-slate-400">
          Cycles will be generated when the period moves to IN_PROGRESS.
        </p>
      ) : (
        <>
          <div className="space-y-1.5">
            {cycles.map((c) => (
              <div
                key={c.id}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
                  c.isCurrent
                    ? "border border-brand/20 bg-brand/5 font-medium text-brand"
                    : "text-slate-500"
                )}
              >
                <span className={cn("h-2 w-2 rounded-full", c.isCurrent ? "bg-brand" : "bg-slate-200")} />
                <span className="font-medium">{c.label}</span>
                <span className="text-[11px]">
                  {new Date(c.startDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  {" – "}
                  {new Date(c.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </span>
                {c.isCurrent && (
                  <span className="ml-auto rounded-md bg-brand/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-brand">
                    Current
                  </span>
                )}
              </div>
            ))}
          </div>
          {daysRemaining != null && (
            <p className="mt-3 text-xs text-slate-400">
              Current cycle ends in <strong className="text-slate-600">{daysRemaining}</strong> day{daysRemaining !== 1 ? "s" : ""}
            </p>
          )}
        </>
      )}
    </div>
  );
}
