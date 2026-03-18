"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, AlertCircle, Target, BarChart3, Users, ClipboardCheck, TrendingUp, Award } from "lucide-react";
import { cn } from "@/lib/utils";

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

export function PeriodDashboard({ periodId }: { periodId: string }) {
  const [summary, setSummary] = useState<PeriodSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenant/kra-kpi/summary?periodId=${periodId}`);
      if (!res.ok) throw new Error();
      setSummary(await res.json());
    } catch {
      setError("Failed to load summary.");
    } finally {
      setLoading(false);
    }
  }, [periodId]);

  useEffect(() => { void fetchSummary(); }, [fetchSummary]);

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
        <MetricTile label="KRAs" value={summary.totalKras} icon={Target} accent="bg-blue-50 text-blue-600" />
        <MetricTile label="KPIs" value={summary.totalKpis} icon={BarChart3} accent="bg-purple-50 text-purple-600" />
        <MetricTile label="Allocations" value={summary.totalAllocations} icon={Users} accent="bg-slate-100 text-slate-600" />
        <MetricTile label="Total Achievements" value={summary.totalAchievements} icon={ClipboardCheck} accent="bg-brand-soft text-brand" />
        <MetricTile label="Verified" value={summary.verifiedAchievements} icon={Award} accent="bg-emerald-50 text-emerald-600" />
        <MetricTile label="Pending Verification" value={summary.pendingVerification} icon={TrendingUp} accent="bg-amber-50 text-amber-600" />
      </div>
    </div>
  );
}
