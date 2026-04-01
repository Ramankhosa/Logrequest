"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Building2, Layers3, Search, Target, Users2 } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  EmptyState,
  MetricCard,
  StatusPill,
} from "@/components/dashboard/shared";
import type {
  PersonDetail,
  StageBottleneck,
  UnitMemberSummary,
  UnitSummary,
} from "@/lib/kra-kpi/dashboard-service";
import type {
  ContributorRewardView,
  RewardConsoleListResult,
} from "@/lib/kra-kpi/shared";
import type { UserDashboardScope } from "@/lib/org-structure/scope-resolver";
import { PersonDetailSlideout } from "./person-detail-slideout";
import { UnitMembersTable } from "./unit-members-table";
import { matchesDashboardSearch } from "@/lib/kra-kpi/dashboard-search";

type UnitPanelProps = {
  scope: UserDashboardScope;
  periodId: string;
};

type UnitSubview = "members" | "kra" | "stages";

type UnitOption = {
  unitId: string;
  unitName: string;
  unitCode: string;
  scope: "NODE" | "DESCENDANTS";
};

const SUBVIEWS: Array<{ key: UnitSubview; label: string; description: string }> = [
  {
    key: "members",
    label: "Members",
    description: "Open member detail, stage context, and read-only rewards.",
  },
  {
    key: "kra",
    label: "KRA Breakdown",
    description: "Compare completion and score across the current unit scope.",
  },
  {
    key: "stages",
    label: "Stage Progress",
    description: "Inspect staged KPIs using the real stage progress model.",
  },
];

function formatScopedLabel(option: UnitOption) {
  return `${option.unitName} (${option.unitCode})`;
}

function formatScopeMode(scopeMode: UnitSummary["scopeMode"]) {
  return scopeMode === "DESCENDANTS" ? "Descendants" : "Single Unit";
}

export function UnitPanel({ scope, periodId }: UnitPanelProps) {
  const unitOptions = useMemo<UnitOption[]>(
    () =>
      [...new Map(
        scope.headOfUnits.map((unit) => [
          unit.unitId,
          {
            unitId: unit.unitId,
            unitName: unit.unitName,
            unitCode: unit.unitCode,
            scope: unit.scope,
          } satisfies UnitOption,
        ]),
      ).values()],
    [scope.headOfUnits],
  );

  const [selectedUnitId, setSelectedUnitId] = useState(unitOptions[0]?.unitId ?? "");
  const [activeSubview, setActiveSubview] = useState<UnitSubview>("members");
  const [summary, setSummary] = useState<UnitSummary | null>(null);
  const [members, setMembers] = useState<UnitMemberSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedStageKpiId, setSelectedStageKpiId] = useState<string | null>(null);
  const [kpiSearch, setKpiSearch] = useState("");
  const [stageAnalysis, setStageAnalysis] = useState<StageBottleneck | null>(null);
  const [stageLoading, setStageLoading] = useState(false);
  const [stageError, setStageError] = useState<string | null>(null);

  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [personDetail, setPersonDetail] = useState<PersonDetail | null>(null);
  const [personLoading, setPersonLoading] = useState(false);
  const [personError, setPersonError] = useState<string | null>(null);
  const [personRewards, setPersonRewards] = useState<ContributorRewardView[]>([]);
  const [rewardLoading, setRewardLoading] = useState(false);
  const [rewardError, setRewardError] = useState<string | null>(null);

  useEffect(() => {
    if (unitOptions.length === 0) return;
    if (!unitOptions.some((option) => option.unitId === selectedUnitId)) {
      setSelectedUnitId(unitOptions[0]?.unitId ?? "");
    }
  }, [selectedUnitId, unitOptions]);

  useEffect(() => {
    setSelectedPersonId(null);
    setPersonDetail(null);
    setPersonRewards([]);
    setPersonError(null);
    setRewardError(null);
  }, [periodId, selectedUnitId]);

  useEffect(() => {
    if (!periodId || !selectedUnitId) return;
    let ignore = false;

    async function loadUnitData() {
      setLoading(true);
      setError(null);

      try {
        const [summaryResponse, membersResponse] = await Promise.all([
          fetch(
            `/api/tenant/kra-kpi/dashboard/unit-summary?periodId=${encodeURIComponent(periodId)}&unitId=${encodeURIComponent(selectedUnitId)}`,
          ),
          fetch(
            `/api/tenant/kra-kpi/dashboard/unit-members?periodId=${encodeURIComponent(periodId)}&unitId=${encodeURIComponent(selectedUnitId)}`,
          ),
        ]);

        const [summaryData, membersData] = await Promise.all([
          summaryResponse.json() as Promise<UnitSummary | { message?: string }>,
          membersResponse.json() as Promise<{ members?: UnitMemberSummary[]; message?: string }>,
        ]);

        if (!summaryResponse.ok) {
          throw new Error("message" in summaryData ? summaryData.message ?? "Failed to load unit summary." : "Failed to load unit summary.");
        }
        if (!membersResponse.ok) {
          throw new Error(membersData.message ?? "Failed to load unit members.");
        }

        if (!ignore) {
          const resolvedSummary = summaryData as UnitSummary;
          setSummary(resolvedSummary);
          setMembers(membersData.members ?? []);
          setSelectedStageKpiId((current) =>
            resolvedSummary.stageKpiOptions.some((option) => option.kpiId === current)
              ? current
              : resolvedSummary.stageKpiOptions[0]?.kpiId ?? null,
          );
        }
      } catch (loadError) {
        if (!ignore) {
          setSummary(null);
          setMembers([]);
          setSelectedStageKpiId(null);
          setError(loadError instanceof Error ? loadError.message : "Failed to load unit data.");
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    void loadUnitData();

    return () => {
      ignore = true;
    };
  }, [periodId, selectedUnitId]);

  useEffect(() => {
    if (!periodId || !selectedUnitId || !selectedStageKpiId || activeSubview !== "stages") {
      if (!selectedStageKpiId) {
        setStageAnalysis(null);
      }
      return;
    }

    let ignore = false;
    const stageKpiId = selectedStageKpiId;

    async function loadStageAnalysis() {
      setStageLoading(true);
      setStageError(null);

      try {
        const response = await fetch(
          `/api/tenant/kra-kpi/dashboard/stage-bottleneck?periodId=${encodeURIComponent(periodId)}&kpiId=${encodeURIComponent(stageKpiId)}&unitId=${encodeURIComponent(selectedUnitId)}`,
        );
        const data = (await response.json()) as StageBottleneck | { message?: string };
        if (!response.ok) {
          throw new Error("message" in data ? data.message ?? "Failed to load stage progress." : "Failed to load stage progress.");
        }
        if (!ignore) {
          setStageAnalysis(data as StageBottleneck);
        }
      } catch (loadError) {
        if (!ignore) {
          setStageAnalysis(null);
          setStageError(loadError instanceof Error ? loadError.message : "Failed to load stage progress.");
        }
      } finally {
        if (!ignore) {
          setStageLoading(false);
        }
      }
    }

    void loadStageAnalysis();

    return () => {
      ignore = true;
    };
  }, [activeSubview, periodId, selectedStageKpiId, selectedUnitId]);

  useEffect(() => {
    if (!periodId || !selectedUnitId || !selectedPersonId) return;

    let ignore = false;
    const personId = selectedPersonId;

    async function loadPersonDetail() {
      setPersonLoading(true);
      setRewardLoading(true);
      setPersonError(null);
      setRewardError(null);

      try {
        const [personResponse, rewardsResponse] = await Promise.all([
          fetch(
            `/api/tenant/kra-kpi/dashboard/person?periodId=${encodeURIComponent(periodId)}&userId=${encodeURIComponent(personId)}&unitId=${encodeURIComponent(selectedUnitId)}`,
          ),
          fetch(
            `/api/tenant/kra-kpi/dashboard/person-rewards?periodId=${encodeURIComponent(periodId)}&userId=${encodeURIComponent(personId)}&unitId=${encodeURIComponent(selectedUnitId)}`,
          ),
        ]);

        const [personData, rewardsData] = await Promise.all([
          personResponse.json() as Promise<PersonDetail | { message?: string }>,
          rewardsResponse.json() as Promise<RewardConsoleListResult | { message?: string }>,
        ]);

        if (!personResponse.ok) {
          throw new Error("message" in personData ? personData.message ?? "Failed to load member detail." : "Failed to load member detail.");
        }

        if (!ignore) {
          setPersonDetail(personData as PersonDetail);
          if (rewardsResponse.ok) {
            setPersonRewards((rewardsData as RewardConsoleListResult).rewards);
          } else {
            setPersonRewards([]);
            setRewardError(
              "message" in rewardsData
                ? rewardsData.message ?? "Failed to load scoped rewards."
                : "Failed to load scoped rewards.",
            );
          }
        }
      } catch (loadError) {
        if (!ignore) {
          setPersonDetail(null);
          setPersonRewards([]);
          setPersonError(loadError instanceof Error ? loadError.message : "Failed to load member detail.");
        }
      } finally {
        if (!ignore) {
          setPersonLoading(false);
          setRewardLoading(false);
        }
      }
    }

    void loadPersonDetail();

    return () => {
      ignore = true;
    };
  }, [periodId, selectedPersonId, selectedUnitId]);

  const sortedMembers = useMemo(
    () =>
      [...members].sort((left, right) => {
        if (left.overallScore !== right.overallScore) {
          return left.overallScore - right.overallScore;
        }
        if (left.overdueCount !== right.overdueCount) {
          return right.overdueCount - left.overdueCount;
        }
        return left.userName.localeCompare(right.userName);
      }),
    [members],
  );

  const selectedStageOption = summary?.stageKpiOptions.find(
    (option) => option.kpiId === selectedStageKpiId,
  ) ?? null;
  const filteredKraBreakdown = useMemo(
    () =>
      (summary?.kraBreakdown ?? []).filter((kra) =>
        matchesDashboardSearch(kpiSearch, kra.kraTitle),
      ),
    [kpiSearch, summary],
  );
  const filteredStageOptions = useMemo(
    () =>
      (summary?.stageKpiOptions ?? []).filter((option) =>
        matchesDashboardSearch(kpiSearch, option.kpiTitle),
      ),
    [kpiSearch, summary],
  );
  const unitSearchPlaceholder =
    activeSubview === "kra" ? "Search KRA" : "Search KPI";
  const stageOptionsForSelect = useMemo(() => {
    if (!selectedStageOption) {
      return filteredStageOptions;
    }
    return filteredStageOptions.some((option) => option.kpiId === selectedStageOption.kpiId)
      ? filteredStageOptions
      : [selectedStageOption, ...filteredStageOptions];
  }, [filteredStageOptions, selectedStageOption]);

  const kraChartData = summary?.kraBreakdown.map((item) => ({
    label: item.kraTitle,
    completion: item.completionPercent,
    score: item.averageScore,
  })) ?? [];

  const stageChartData = stageAnalysis?.stages.map((stage) => ({
    label: stage.title,
    completion: stage.completionPercent,
  })) ?? [];

  if (unitOptions.length === 0) {
    return (
      <EmptyState
        icon={<Building2 className="h-8 w-8" />}
        title="No headed units available"
        description="The My Unit workspace is only available when you currently head at least one organizational unit."
      />
    );
  }

  return (
    <div className="space-y-6">
      <section className="glass-panel rounded-[1.75rem] border border-slate-200/80 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="section-title text-xs text-slate-400">My Unit Workspace</div>
            <h3 className="mt-3 text-lg font-semibold text-slate-900">
              {summary ? summary.unitName : formatScopedLabel(unitOptions.find((option) => option.unitId === selectedUnitId) ?? unitOptions[0]!)}
            </h3>
            <p className="mt-2 text-sm text-slate-500">
              Adaptive unit analytics stay scoped to your active headed unit and its allowed hierarchy.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <StatusPill
                label={summary ? formatScopeMode(summary.scopeMode) : "Scoped"}
                tone="blue"
              />
              {summary?.effectiveUnitCount && summary.effectiveUnitCount > 1 ? (
                <StatusPill label={`${summary.effectiveUnitCount} units`} tone="brand" />
              ) : null}
              <StatusPill
                label={`${summary?.stageKpiOptions.length ?? 0} staged KPIs`}
                tone="slate"
              />
            </div>
          </div>

          {unitOptions.length > 1 ? (
            <div className="w-full max-w-sm">
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                Selected Unit
              </label>
              <select
                value={selectedUnitId}
                onChange={(event) => setSelectedUnitId(event.target.value)}
                className="w-full rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15"
              >
                {unitOptions.map((option) => (
                  <option key={option.unitId} value={option.unitId}>
                    {formatScopedLabel(option)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
      </section>

      {error ? (
        <EmptyState
          icon={<AlertTriangle className="h-8 w-8" />}
          title="Could not load unit workspace"
          description={error}
        />
      ) : null}

      {!error ? (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Members"
              value={summary?.memberCount ?? "--"}
              description="Primary members plus allocation-only contributors in scope."
              tone="brand"
              loading={loading}
              icon={<Users2 className="h-4 w-4" />}
            />
            <MetricCard
              label="Allocations"
              value={summary?.totalAllocations ?? "--"}
              description="Current period KPI allocations inside the selected scope."
              tone="blue"
              loading={loading}
              icon={<Target className="h-4 w-4" />}
            />
            <MetricCard
              label="Completion"
              value={summary ? `${summary.completionPercent}%` : "--"}
              description="Verified completion rate across the selected unit scope."
              tone="amber"
              loading={loading}
              icon={<Layers3 className="h-4 w-4" />}
            />
            <MetricCard
              label="Average Score"
              value={summary?.averageScore ?? "--"}
              description="Stored scoring only, without re-running KPI calculations."
              tone="brand"
              loading={loading}
              icon={<Building2 className="h-4 w-4" />}
            />
          </section>

          <section className="glass-panel rounded-[1.75rem] border border-slate-200/80 p-5">
            <div className="flex flex-wrap gap-2">
              {SUBVIEWS.map((view) => (
                <button
                  key={view.key}
                  type="button"
                  onClick={() => setActiveSubview(view.key)}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                    activeSubview === view.key
                      ? "bg-slate-900 text-white"
                      : "border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900"
                  }`}
                >
                  {view.label}
                </button>
              ))}
            </div>
            <p className="mt-3 text-sm text-slate-500">
              {SUBVIEWS.find((view) => view.key === activeSubview)?.description}
            </p>
            {activeSubview !== "members" ? (
              <label className="mt-4 flex items-center gap-3 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-500">
                <Search className="h-4 w-4 text-slate-400" />
                <input
                  type="search"
                  value={kpiSearch}
                  onChange={(event) => setKpiSearch(event.target.value)}
                  placeholder={unitSearchPlaceholder}
                  className="w-full bg-transparent text-sm text-slate-700 outline-none"
                />
              </label>
            ) : null}
          </section>

          {activeSubview === "members" ? (
            <section className="glass-panel rounded-[1.75rem] border border-slate-200/80 p-5">
              <div className="mb-4">
                <h3 className="text-lg font-semibold text-slate-900">Scoped Members</h3>
                <p className="text-sm text-slate-500">
                  Rows are ordered by lowest score first, then highest overdue count, so intervention candidates stay visible.
                </p>
              </div>
              <UnitMembersTable
                members={sortedMembers}
                loading={loading}
                showPrimaryUnitColumn={(summary?.effectiveUnitCount ?? 1) > 1}
                onSelectMember={(member) => setSelectedPersonId(member.userId)}
              />
            </section>
          ) : null}

          {activeSubview === "kra" ? (
            <div className="space-y-4">
              <ChartContainer
                title="KRA completion and score"
                loading={loading}
                fallbackData={{
                  headers: ["KRA", "Completion %", "Average Score"],
                  rows: kraChartData.map((item) => [item.label, item.completion, item.score]),
                }}
              >
                {kraChartData.length === 0 ? (
                  <EmptyState
                    icon={<Target className="h-8 w-8" />}
                    title="No KRA data in scope"
                    description="This unit scope has no KRA-linked allocations in the selected period."
                  />
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={kraChartData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 12 }} interval={0} angle={-20} textAnchor="end" height={64} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Bar dataKey="completion" fill="var(--blue)" radius={[10, 10, 0, 0]} />
                      <Bar dataKey="score" fill="var(--brand)" radius={[10, 10, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </ChartContainer>

              <div className="grid gap-4 lg:grid-cols-2">
                {filteredKraBreakdown.map((kra) => (
                  <article
                    key={kra.kraId}
                    className="glass-panel rounded-[1.5rem] border border-slate-200/80 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="font-semibold text-slate-900">{kra.kraTitle}</h4>
                        <div className="mt-1 text-sm text-slate-500">
                          {kra.completedAllocations}/{kra.totalAllocations} complete
                        </div>
                      </div>
                      <StatusPill label={`${kra.weightage}% weight`} tone="slate" />
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-3">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                          Completion
                        </div>
                        <div className="mt-2 text-2xl font-semibold text-slate-900">
                          {kra.completionPercent}%
                        </div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-3">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                          Average Score
                        </div>
                        <div className="mt-2 text-2xl font-semibold text-slate-900">
                          {kra.averageScore}
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
              {!loading && filteredKraBreakdown.length === 0 ? (
                <EmptyState
                  icon={<Target className="h-8 w-8" />}
                  title="No KRA or KPI matches"
                  description="Try a different KRA or KPI search term."
                />
              ) : null}
            </div>
          ) : null}

          {activeSubview === "stages" ? (
            <div className="space-y-4">
              {(summary?.stageKpiOptions.length ?? 0) === 0 ? (
                <EmptyState
                  icon={<Layers3 className="h-8 w-8" />}
                  title="No staged KPIs in scope"
                  description="The selected unit has no staged KPI allocations for the current period."
                />
              ) : (
                <>
                  <section className="glass-panel rounded-[1.75rem] border border-slate-200/80 p-5">
                    <div className="flex flex-wrap items-end gap-4">
                      <div className="min-w-[260px] flex-1">
                        <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                          Staged KPI
                        </label>
                        <select
                          value={selectedStageKpiId ?? ""}
                          onChange={(event) => setSelectedStageKpiId(event.target.value)}
                          className="w-full rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15"
                        >
                          {stageOptionsForSelect.map((option) => (
                            <option key={option.kpiId} value={option.kpiId}>
                              {option.kpiTitle}
                            </option>
                          ))}
                        </select>
                      </div>
                      {selectedStageOption ? (
                        <div className="flex flex-wrap gap-2">
                          <StatusPill
                            label={`${selectedStageOption.completionPercent}% complete`}
                            tone="blue"
                          />
                          <StatusPill
                            label={`${selectedStageOption.allocationCount} allocations`}
                            tone="slate"
                          />
                          <StatusPill
                            label={`${selectedStageOption.stageCount} stages`}
                            tone="brand"
                          />
                        </div>
                      ) : null}
                    </div>
                  </section>

                  {!stageLoading && filteredStageOptions.length === 0 ? (
                    <EmptyState
                      icon={<Layers3 className="h-8 w-8" />}
                      title="No staged KPI matches"
                      description="Try a different KRA or KPI search term."
                    />
                  ) : null}
                  {stageError ? (
                    <EmptyState
                      icon={<AlertTriangle className="h-8 w-8" />}
                      title="Could not load stage analysis"
                      description={stageError}
                    />
                  ) : (
                    <>
                      <ChartContainer
                        title={selectedStageOption ? `Stage completion | ${selectedStageOption.kpiTitle}` : "Stage completion"}
                        loading={stageLoading}
                        fallbackData={{
                          headers: ["Stage", "Completion %", "Completed", "Assigned", "Avg Days"],
                          rows:
                            stageAnalysis?.stages.map((stage) => [
                              stage.title,
                              stage.completionPercent,
                              stage.completedCount,
                              stage.totalAssigned,
                              stage.averageDaysToComplete ?? "-",
                            ]) ?? [],
                        }}
                      >
                        {stageChartData.length === 0 ? (
                          <EmptyState
                            icon={<Layers3 className="h-8 w-8" />}
                            title="No stage progress available"
                            description="This KPI has stage definitions but no scoped progress rows yet."
                          />
                        ) : (
                          <ResponsiveContainer width="100%" height={260}>
                            <BarChart data={stageChartData}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} />
                              <XAxis dataKey="label" tick={{ fontSize: 12 }} interval={0} angle={-20} textAnchor="end" height={64} />
                              <YAxis tick={{ fontSize: 12 }} />
                              <Tooltip />
                              <Bar dataKey="completion" fill="var(--accent)" radius={[10, 10, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        )}
                      </ChartContainer>

                      <div className="grid gap-4 lg:grid-cols-2">
                        {(stageAnalysis?.stages ?? []).map((stage) => (
                          <article
                            key={`${stage.stageOrder}-${stage.title}`}
                            className="glass-panel rounded-[1.5rem] border border-slate-200/80 p-4"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <h4 className="font-semibold text-slate-900">
                                  {stage.stageOrder}. {stage.title}
                                </h4>
                                <div className="mt-1 text-sm text-slate-500">
                                  {stage.completedCount}/{stage.totalAssigned} complete
                                </div>
                              </div>
                              <StatusPill label={`${stage.completionPercent}%`} tone="brand" />
                            </div>
                            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                              <div className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-3">
                                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                                  Assigned
                                </div>
                                <div className="mt-2 text-2xl font-semibold text-slate-900">
                                  {stage.totalAssigned}
                                </div>
                              </div>
                              <div className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-3">
                                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                                  Avg Days
                                </div>
                                <div className="mt-2 text-2xl font-semibold text-slate-900">
                                  {stage.averageDaysToComplete ?? "--"}
                                </div>
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          ) : null}
        </>
      ) : null}

      <PersonDetailSlideout
        open={selectedPersonId != null}
        onClose={() => {
          setSelectedPersonId(null);
          setPersonDetail(null);
          setPersonRewards([]);
          setPersonError(null);
          setRewardError(null);
        }}
        person={personDetail}
        rewards={personRewards}
        loading={personLoading}
        rewardLoading={rewardLoading}
        error={personError}
        rewardError={rewardError}
      />
    </div>
  );
}
