"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { BarChart3, ArrowRight, Clock, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

type DashboardSummary = {
  periodId: string;
  periodName: string;
  totalAllocations: number;
  statusCounts: Record<string, number>;
  overallWeightedScore: number;
  maxPossibleScore: number;
  overallPercentage: number;
  pendingReviewCount: number;
  additionalAchievements: {
    total: number;
    verified: number;
    pending: number;
    notApproved: number;
  };
  upcomingDeadlineCount: number;
  overdueCount: number;
};

type Period = {
  id: string;
  name: string;
  state: string;
};

export function KraKpiSummaryCard() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        // Get periods
        const periodsRes = await fetch("/api/tenant/kra-kpi/periods");
        if (!periodsRes.ok) {
          setLoading(false);
          return;
        }
        const periods = (await periodsRes.json()) as Period[];

        // Find most recent relevant period
        const relevant = periods.find(
          (p) => p.state === "IN_PROGRESS" || p.state === "UNDER_REVIEW",
        )
          ?? periods.find((p) => p.state === "CLOSED");

        if (!relevant) {
          setLoading(false);
          return;
        }

        const dashRes = await fetch(`/api/tenant/kra-kpi/my/dashboard?periodId=${relevant.id}`);
        if (dashRes.ok) {
          const data = (await dashRes.json()) as DashboardSummary | null;
          if (data && data.totalAllocations > 0) {
            setSummary(data);
          }
        }
      } catch {
        // silently fail
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  if (loading || !summary) return null;

  const sc = summary.statusCounts;
  const verifiedCount = sc.completed ?? 0;
  const pendingCount = sc.pendingReview ?? 0;
  const notApprovedCount = sc.notApproved ?? 0;

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white/60 p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50">
            <BarChart3 className="h-4 w-4 text-blue-600" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">My KRA/KPI Summary</h3>
            <p className="text-xs text-slate-400">{summary.periodName}</p>
          </div>
        </div>
        <Link
          href="/my-kpis"
          className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800 transition"
        >
          View My KPIs
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatItem label="Allocated" value={summary.totalAllocations} color="text-slate-700" />
        <StatItem label="Verified" value={verifiedCount} color="text-green-600" />
        <StatItem label="Pending" value={pendingCount} color="text-blue-600" />
        <StatItem label="Not Approved" value={notApprovedCount} color="text-red-600" />
      </div>

      {/* Score bar */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-slate-500">Overall Score</span>
          <span className="text-sm font-bold text-slate-900">{summary.overallPercentage}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              summary.overallPercentage >= 80
                ? "bg-green-500"
                : summary.overallPercentage >= 60
                ? "bg-blue-500"
                : summary.overallPercentage >= 40
                ? "bg-amber-500"
                : "bg-red-500",
            )}
            style={{ width: `${Math.min(100, summary.overallPercentage)}%` }}
          />
        </div>
      </div>

      {/* Deadline alerts */}
      {(summary.upcomingDeadlineCount > 0 || summary.overdueCount > 0) && (
        <div className="flex flex-wrap gap-3">
          {summary.overdueCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">
              <AlertTriangle className="h-3 w-3" />
              {summary.overdueCount} overdue
            </span>
          )}
          {summary.upcomingDeadlineCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
              <Clock className="h-3 w-3" />
              {summary.upcomingDeadlineCount} due this week
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function StatItem({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3 text-center">
      <div className={cn("text-xl font-bold", color)}>{value}</div>
      <div className="text-xs text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}
