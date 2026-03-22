"use client";

import { useState, useCallback, useEffect } from "react";
import {
  Loader2,
  AlertCircle,
  Target,
  Users,
  ClipboardCheck,
  BarChart3,
  AlertTriangle,
  Clock,
  ChevronRight,
  ArrowLeft,
  TrendingUp,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";

type OverviewStats = {
  totalKpis: number;
  totalAllocations: number;
  totalAchievements: number;
  achievementsByState: Record<string, number>;
  overallCompletionPercent: number;
  overdueCount: number;
  pendingReviewCount: number;
};

type OrgUnit = {
  unitId: string;
  unitName: string;
  unitCode: string;
  category: string;
  totalAllocations: number;
  completedAllocations: number;
  completionPercent: number;
  averageScore: number;
  childUnitCount: number;
};

type AttentionItems = {
  overdueAchievements: number;
  zeroProgressEmployees: number;
  stalePendingReviews: number;
  lowCompletionKpis: { kpiId: string; kpiTitle: string; completionPercent: number }[];
};

type StageBottleneck = {
  kpiTitle: string;
  stages: {
    stageOrder: number;
    title: string;
    totalAssigned: number;
    completedCount: number;
    completionPercent: number;
    averageDaysToComplete: number | null;
  }[];
};

type PersonDetail = {
  userId: string;
  userName: string;
  unitName: string;
  allocations: {
    kpiTitle: string;
    target: string;
    stagesComplete: number;
    stagesTotal: number;
    completionPercent: number;
    score: number;
    state: string;
    isOverdue: boolean;
  }[];
  overallScore: number;
  overallCompletion: number;
};

type Period = { id: string; name: string };

export function AdminDashboard() {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([]);
  const [attention, setAttention] = useState<AttentionItems | null>(null);
  const [bottleneck, setBottleneck] = useState<StageBottleneck | null>(null);
  const [selectedBottleneckKpiId, setSelectedBottleneckKpiId] = useState<string | null>(null);
  const [drillPath, setDrillPath] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Person detail modal
  const [personDetail, setPersonDetail] = useState<PersonDetail | null>(null);
  const [personLoading, setPersonLoading] = useState(false);

  // Fetch periods
  useEffect(() => {
    async function fetchPeriods() {
      try {
        const res = await fetch("/api/tenant/kra-kpi/periods");
        if (res.ok) {
          const data = await res.json();
          const ps = (data.periods ?? data ?? []).map((p: { id: string; name: string }) => ({
            id: p.id,
            name: p.name,
          }));
          setPeriods(ps);
          if (ps.length > 0) setSelectedPeriodId(ps[0].id);
        }
      } catch {
        setError("Failed to load periods.");
      }
    }
    void fetchPeriods();
  }, []);

  // Fetch dashboard data when period changes
  const fetchDashboard = useCallback(async () => {
    if (!selectedPeriodId) return;
    setLoading(true);
    setError(null);
    try {
      const [overviewRes, orgRes, attentionRes] = await Promise.all([
        fetch(`/api/tenant/kra-kpi/dashboard/overview?periodId=${selectedPeriodId}`),
        fetch(
          `/api/tenant/kra-kpi/dashboard/org-hierarchy?periodId=${selectedPeriodId}${
            drillPath.length > 0 ? `&parentUnitId=${drillPath[drillPath.length - 1].id}` : ""
          }`,
        ),
        fetch(`/api/tenant/kra-kpi/dashboard/attention?periodId=${selectedPeriodId}`),
      ]);

      if (overviewRes.ok) setOverview(await overviewRes.json());
      if (orgRes.ok) {
        const orgData = await orgRes.json();
        setOrgUnits(orgData.units ?? []);
      }
      if (attentionRes.ok) setAttention(await attentionRes.json());
    } catch {
      setError("Failed to load dashboard.");
    } finally {
      setLoading(false);
    }
  }, [selectedPeriodId, drillPath]);

  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

  // Fetch bottleneck when KPI selected
  useEffect(() => {
    if (!selectedBottleneckKpiId || !selectedPeriodId) {
      setBottleneck(null);
      return;
    }
    async function fetchBottleneck() {
      try {
        const res = await fetch(
          `/api/tenant/kra-kpi/dashboard/stage-bottleneck?periodId=${selectedPeriodId}&kpiId=${selectedBottleneckKpiId}`,
        );
        if (res.ok) setBottleneck(await res.json());
      } catch {
        /* ignore */
      }
    }
    void fetchBottleneck();
  }, [selectedBottleneckKpiId, selectedPeriodId]);

  async function handleViewPerson(userId: string) {
    if (!selectedPeriodId) return;
    setPersonLoading(true);
    try {
      const res = await fetch(
        `/api/tenant/kra-kpi/dashboard/person?periodId=${selectedPeriodId}&userId=${userId}`,
      );
      if (res.ok) setPersonDetail(await res.json());
    } catch {
      /* ignore */
    } finally {
      setPersonLoading(false);
    }
  }

  function drillDown(unit: OrgUnit) {
    if (unit.childUnitCount > 0) {
      setDrillPath((prev) => [...prev, { id: unit.unitId, name: unit.unitName }]);
    }
  }

  function drillUp(index: number) {
    setDrillPath((prev) => prev.slice(0, index));
  }

  const selectCls =
    "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 outline-none focus:border-brand focus:ring-1 focus:ring-brand/30";

  if (loading && !overview) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {/* Period Selector */}
      <div className="flex items-center gap-3">
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Period</label>
        <select
          value={selectedPeriodId ?? ""}
          onChange={(e) => {
            setSelectedPeriodId(e.target.value);
            setDrillPath([]);
          }}
          className={selectCls}
        >
          {periods.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {/* Overview Cards */}
      {overview && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard icon={Target} label="Active KPIs" value={overview.totalKpis} accent="bg-blue-100 text-blue-600" />
          <MetricCard icon={Users} label="Allocations" value={overview.totalAllocations} accent="bg-purple-100 text-purple-600" />
          <MetricCard icon={ClipboardCheck} label="Achievements" value={overview.totalAchievements} accent="bg-green-100 text-green-600" />
          <MetricCard
            icon={TrendingUp}
            label="Completion"
            value={`${overview.overallCompletionPercent}%`}
            accent="bg-brand/10 text-brand"
          />
        </div>
      )}

      {/* Achievement State Breakdown */}
      {overview && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Achievement States</h3>
          <div className="flex gap-3 flex-wrap">
            {Object.entries(overview.achievementsByState).map(([state, count]) => (
              <div
                key={state}
                className={cn(
                  "rounded-lg px-3 py-2 text-center",
                  state === "VERIFIED"
                    ? "bg-green-50"
                    : state === "REJECTED"
                      ? "bg-red-50"
                      : state === "SUBMITTED"
                        ? "bg-blue-50"
                        : "bg-slate-50",
                )}
              >
                <p className="text-lg font-bold tabular-nums">{count}</p>
                <p className="text-[10px] font-medium text-slate-500 uppercase">{state}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Attention Items */}
      {attention && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-amber-700">
            <AlertTriangle className="h-4 w-4" /> Needs Attention
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="text-center">
              <p className="text-xl font-bold text-amber-700 tabular-nums">{attention.overdueAchievements}</p>
              <p className="text-[10px] text-amber-600">Overdue</p>
            </div>
            <div className="text-center">
              <p className="text-xl font-bold text-amber-700 tabular-nums">{attention.zeroProgressEmployees}</p>
              <p className="text-[10px] text-amber-600">Zero Progress</p>
            </div>
            <div className="text-center">
              <p className="text-xl font-bold text-amber-700 tabular-nums">{attention.stalePendingReviews}</p>
              <p className="text-[10px] text-amber-600">Stale Reviews (&gt;7d)</p>
            </div>
          </div>
          {attention.lowCompletionKpis.length > 0 && (
            <div className="mt-3">
              <p className="text-[10px] font-semibold text-amber-600 uppercase tracking-wider mb-1">
                Low Completion KPIs (&lt;50%)
              </p>
              <div className="space-y-1">
                {attention.lowCompletionKpis.map((kpi) => (
                  <div
                    key={kpi.kpiId}
                    className="flex items-center justify-between text-xs text-amber-700 cursor-pointer hover:bg-amber-100/50 rounded px-2 py-1"
                    onClick={() => setSelectedBottleneckKpiId(kpi.kpiId)}
                  >
                    <span>{kpi.kpiTitle}</span>
                    <span className="tabular-nums font-medium">{kpi.completionPercent}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Org Hierarchy */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-700">Organization Hierarchy</h3>

        {drillPath.length > 0 && (
          <div className="mb-3 flex items-center gap-1 text-xs text-slate-500">
            <button
              onClick={() => drillUp(0)}
              className="hover:text-brand font-medium"
            >
              All
            </button>
            {drillPath.map((p, i) => (
              <span key={p.id} className="flex items-center gap-1">
                <ChevronRight className="h-3 w-3" />
                <button
                  onClick={() => drillUp(i + 1)}
                  className="hover:text-brand font-medium"
                >
                  {p.name}
                </button>
              </span>
            ))}
          </div>
        )}

        {orgUnits.length === 0 ? (
          <p className="text-xs text-slate-400">No data for this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-3 py-2">Unit</th>
                  <th className="px-3 py-2 text-right">Allocations</th>
                  <th className="px-3 py-2 text-right">Completed</th>
                  <th className="px-3 py-2 text-right">Completion %</th>
                  <th className="px-3 py-2 text-right">Avg Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orgUnits.map((unit) => (
                  <tr
                    key={unit.unitId}
                    className={cn(
                      "hover:bg-slate-50/50",
                      unit.childUnitCount > 0 && "cursor-pointer",
                    )}
                    onClick={() => drillDown(unit)}
                  >
                    <td className="px-3 py-2 font-medium text-slate-700">
                      <div className="flex items-center gap-1.5">
                        {unit.unitName}
                        <span className="text-[10px] text-slate-400">({unit.unitCode})</span>
                        {unit.childUnitCount > 0 && (
                          <ChevronRight className="h-3 w-3 text-slate-400" />
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{unit.totalAllocations}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{unit.completedAllocations}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="h-1.5 w-16 rounded-full bg-slate-100">
                          <div
                            className={cn(
                              "h-1.5 rounded-full",
                              unit.completionPercent >= 80
                                ? "bg-green-500"
                                : unit.completionPercent >= 50
                                  ? "bg-blue-500"
                                  : unit.completionPercent >= 25
                                    ? "bg-amber-500"
                                    : "bg-red-400",
                            )}
                            style={{ width: `${Math.min(unit.completionPercent, 100)}%` }}
                          />
                        </div>
                        <span className="tabular-nums">{unit.completionPercent}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{unit.averageScore}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Stage Bottleneck */}
      {bottleneck && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">
              Stage Bottleneck: {bottleneck.kpiTitle}
            </h3>
            <button
              onClick={() => {
                setBottleneck(null);
                setSelectedBottleneckKpiId(null);
              }}
              className="text-xs text-slate-400 hover:text-slate-600"
            >
              Close
            </button>
          </div>
          <div className="space-y-2">
            {bottleneck.stages.map((stage) => (
              <div key={stage.stageOrder} className="flex items-center gap-3">
                <span className="w-5 text-right text-[10px] text-slate-400 tabular-nums">
                  {stage.stageOrder}
                </span>
                <span className="w-40 truncate text-xs text-slate-700">{stage.title}</span>
                <div className="flex-1">
                  <div className="h-3 w-full rounded-full bg-slate-100">
                    <div
                      className={cn(
                        "h-3 rounded-full",
                        stage.completionPercent >= 80
                          ? "bg-green-500"
                          : stage.completionPercent >= 50
                            ? "bg-blue-500"
                            : stage.completionPercent >= 25
                              ? "bg-amber-500"
                              : "bg-red-400",
                      )}
                      style={{ width: `${Math.min(stage.completionPercent, 100)}%` }}
                    />
                  </div>
                </div>
                <span className="w-20 text-right text-[10px] text-slate-500 tabular-nums">
                  {stage.completedCount}/{stage.totalAssigned} ({stage.completionPercent}%)
                </span>
                {stage.averageDaysToComplete !== null && (
                  <span className="w-16 text-right text-[10px] text-slate-400 tabular-nums">
                    ~{stage.averageDaysToComplete}d
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Person Detail Modal */}
      {personDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="mx-4 w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-700">{personDetail.userName}</h3>
                <p className="text-xs text-slate-400">{personDetail.unitName}</p>
              </div>
              <button
                onClick={() => setPersonDetail(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
              >
                &times;
              </button>
            </div>

            <div className="mb-3 flex gap-4">
              <div className="text-center">
                <p className="text-xl font-bold text-brand tabular-nums">{personDetail.overallScore}</p>
                <p className="text-[10px] text-slate-400">Score</p>
              </div>
              <div className="text-center">
                <p className="text-xl font-bold text-brand tabular-nums">{personDetail.overallCompletion}%</p>
                <p className="text-[10px] text-slate-400">Completion</p>
              </div>
            </div>

            <div className="max-h-60 overflow-y-auto space-y-2">
              {personDetail.allocations.map((alloc, i) => (
                <div key={i} className="rounded-lg border border-slate-100 p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-700">{alloc.kpiTitle}</span>
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-medium",
                        alloc.state === "VERIFIED"
                          ? "bg-green-50 text-green-700"
                          : alloc.state === "REJECTED"
                            ? "bg-red-50 text-red-700"
                            : alloc.state === "SUBMITTED"
                              ? "bg-blue-50 text-blue-700"
                              : "bg-slate-50 text-slate-500",
                      )}
                    >
                      {alloc.state}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-[10px] text-slate-500">
                    <span>Target: {alloc.target}</span>
                    {alloc.stagesTotal > 0 && (
                      <span>
                        Stages: {alloc.stagesComplete}/{alloc.stagesTotal}
                      </span>
                    )}
                    <span>Score: {alloc.score}</span>
                    {alloc.isOverdue && (
                      <span className="text-red-500 font-medium">Overdue</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
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
