"use client";

import { cn } from "@/lib/utils";
import type { MyDashboardSummary } from "@/lib/kra-kpi/shared";

type Props = {
  summary: MyDashboardSummary | null;
};

export function MyDashboard({ summary }: Props) {
  if (!summary) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 py-12 text-center">
        <p className="text-sm text-gray-500">Select a period to view your dashboard.</p>
      </div>
    );
  }

  const s = summary;
  const sc = s.statusCounts;
  const withAchievements =
    s.totalAllocations - (sc.notStarted ?? 0) - (sc.needsCascade ?? 0);

  return (
    <div className="space-y-6">
      {/* Overall score */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Overall Performance</h3>
          <span className="text-2xl font-bold text-gray-900">
            {s.overallPercentage}%
          </span>
        </div>
        <div className="h-3 w-full rounded-full bg-gray-200 overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              s.overallPercentage >= 80
                ? "bg-green-500"
                : s.overallPercentage >= 60
                ? "bg-blue-500"
                : s.overallPercentage >= 40
                ? "bg-amber-500"
                : "bg-red-500"
            )}
            style={{ width: `${Math.min(100, s.overallPercentage)}%` }}
          />
        </div>
        <div className="mt-2 text-xs text-gray-500">
          Weighted score: {s.overallWeightedScore} / {s.maxPossibleScore}
        </div>
      </div>

      {/* Status grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatusCard label="Total Allocated" value={s.totalAllocations} color="bg-gray-100 text-gray-800" />
        <StatusCard label="Not Started" value={sc.notStarted ?? 0} color="bg-gray-50 text-gray-600" />
        <StatusCard label="In Progress" value={sc.inProgress ?? 0} color="bg-yellow-50 text-yellow-800" />
        <StatusCard label="Pending Review" value={sc.pendingReview ?? 0} color="bg-blue-50 text-blue-800" />
        <StatusCard label="Completed" value={sc.completed ?? 0} color="bg-green-50 text-green-800" />
        <StatusCard label="Not Approved" value={sc.notApproved ?? 0} color="bg-red-50 text-red-800" />
      </div>

      {/* KRA breakdown */}
      {s.kraBreakdown.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
          <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
            <h3 className="text-sm font-semibold text-gray-700">KRA Breakdown</h3>
          </div>
          <div className="divide-y divide-gray-100">
            {s.kraBreakdown.map((kra) => (
              <div key={kra.kraId} className="flex items-center justify-between px-4 py-3">
                <div>
                  <span className="text-sm font-medium text-gray-900">{kra.kraTitle}</span>
                  <span className="ml-2 text-xs text-gray-500">
                    W: {kra.kraWeightage} | {kra.verifiedCount}/{kra.kpiCount} KPIs verified
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-24 h-2 rounded-full bg-gray-200 overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        kra.avgScore >= 80
                          ? "bg-green-500"
                          : kra.avgScore >= 60
                          ? "bg-blue-500"
                          : kra.avgScore >= 40
                          ? "bg-amber-500"
                          : "bg-red-500"
                      )}
                      style={{
                        width: `${Math.min(100, kra.avgScore)}%`,
                      }}
                    />
                  </div>
                  <span className="text-sm font-semibold text-gray-700 w-12 text-right">
                    {kra.verifiedCount > 0 ? `${Math.round(kra.avgScore)}%` : "—"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Progress summary */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Progress</h3>
        <div className="text-sm text-gray-600">
          {withAchievements} of {s.totalAllocations} KPIs have achievements
          {sc.needsCascade && sc.needsCascade > 0 && (
            <span className="ml-2 text-amber-600">
              ({sc.needsCascade} pending distribution)
            </span>
          )}
        </div>
        <div className="mt-2 h-2 w-full rounded-full bg-gray-200 overflow-hidden">
          <div
            className="h-full rounded-full bg-green-500"
            style={{
              width: s.totalAllocations > 0
                ? `${(withAchievements / s.totalAllocations) * 100}%`
                : "0%",
            }}
          />
        </div>
      </div>
    </div>
  );
}

function StatusCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className={cn("rounded-lg p-3 text-center", color)}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs mt-1">{label}</div>
    </div>
  );
}
