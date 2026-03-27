"use client";

import {
  CheckCircle2,
  ClipboardList,
  Clock3,
  Target,
  Wallet,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { MyDashboard } from "@/components/my-kpis/my-dashboard";
import {
  CHART_COLORS,
  ChartContainer,
  EmptyState,
  MetricCard,
  StatusPill,
  formatStateLabel,
} from "@/components/dashboard/shared";
import type {
  MyDashboardSummary,
  StoredReviewCycleView,
} from "@/lib/kra-kpi/shared";
import { MyRewardsCard } from "./my-rewards-card";

type Props = {
  periodId: string;
  summary: MyDashboardSummary | null;
  summaryLoading: boolean;
  currentCycle: StoredReviewCycleView | null;
};

const STATUS_LABELS: Record<string, string> = {
  notStarted: "Not Started",
  inProgress: "In Progress",
  pendingReview: "Pending Review",
  completed: "Completed",
  notApproved: "Not Approved",
  needsCascade: "Needs Cascade",
};

export function ContributorPanel({
  periodId,
  summary,
  summaryLoading,
  currentCycle,
}: Props) {
  const statusChartData =
    summary == null
      ? []
      : Object.entries(summary.statusCounts)
          .filter(([, count]) => count > 0)
          .map(([key, value]) => ({
            label: STATUS_LABELS[key] ?? formatStateLabel(key),
            value,
          }));

  const kraChartData =
    summary?.kraBreakdown.map((item) => ({
      label: item.kraTitle,
      score: Math.round(item.avgScore),
      verified: item.verifiedCount,
    })) ?? [];

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Overall Score"
          value={summaryLoading || !summary ? "--" : `${summary.overallPercentage}%`}
          description="Weighted score across your current KPI allocations."
          tone="brand"
          loading={summaryLoading}
          icon={<Target className="h-4 w-4" />}
        />
        <MetricCard
          label="Allocated KPIs"
          value={summaryLoading || !summary ? "--" : summary.totalAllocations}
          description="Total KPI allocations in the selected period."
          tone="blue"
          loading={summaryLoading}
          icon={<ClipboardList className="h-4 w-4" />}
        />
        <MetricCard
          label="Pending Review"
          value={summaryLoading || !summary ? "--" : summary.pendingReviewCount}
          description="Submissions currently in a reviewer queue."
          tone="amber"
          loading={summaryLoading}
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
        <MetricCard
          label="Deadline Alerts"
          value={summaryLoading || !summary ? "--" : summary.overdueCount + summary.upcomingDeadlineCount}
          description="Overdue and upcoming deadline items combined."
          tone={summary && summary.overdueCount > 0 ? "rose" : "amber"}
          loading={summaryLoading}
          icon={<Clock3 className="h-4 w-4" />}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <ChartContainer
          title="Achievement State Mix"
          loading={summaryLoading}
          fallbackData={{
            headers: ["State", "Count"],
            rows: statusChartData.map((item) => [item.label, item.value]),
          }}
        >
          {statusChartData.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 className="h-8 w-8" />}
              title="No state breakdown yet"
              description="Once KPI activity starts, the distribution across achievement states will appear here."
            />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={statusChartData}
                  dataKey="value"
                  nameKey="label"
                  outerRadius={92}
                  innerRadius={54}
                >
                  {statusChartData.map((item, index) => (
                    <Cell key={item.label} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartContainer>

        <ChartContainer
          title="KRA Score Distribution"
          loading={summaryLoading}
          fallbackData={{
            headers: ["KRA", "Average Score", "Verified KPIs"],
            rows: kraChartData.map((item) => [item.label, item.score, item.verified]),
          }}
        >
          {kraChartData.length === 0 ? (
            <EmptyState
              icon={<Target className="h-8 w-8" />}
              title="No KRA breakdown yet"
              description="KRA-level scores appear after KPIs are allocated and scored."
            />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={kraChartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 12 }}
                  interval={0}
                  angle={-20}
                  textAnchor="end"
                  height={60}
                />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="score" fill="var(--brand)" radius={[10, 10, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartContainer>
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <MyRewardsCard periodId={periodId} />

        <div className="glass-panel rounded-[1.75rem] border border-slate-200/80 p-5">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <div className="section-title text-xs text-slate-400">Execution View</div>
              <h3 className="mt-3 text-lg font-semibold text-slate-900">Personal KPI dashboard</h3>
              <p className="text-sm text-slate-500">
                The existing contributor workspace stays intact and now sits beside reward visibility in the shared dashboard shell.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {currentCycle ? <StatusPill label={`Cycle: ${currentCycle.label}`} tone="blue" /> : null}
              <StatusPill label={summary?.periodName ?? "Selected Period"} tone="slate" />
            </div>
          </div>

          <div className="rounded-[1.5rem] border border-slate-200/80 bg-white/80 p-4">
            <MyDashboard summary={summary} currentCycle={currentCycle} />
          </div>
        </div>
      </section>
    </div>
  );
}
