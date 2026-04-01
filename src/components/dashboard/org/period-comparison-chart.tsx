"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  EmptyState,
  ScoreBadge,
  StatusPill,
} from "@/components/dashboard/shared";
import type { PeriodComparisonResult } from "@/lib/kra-kpi/dashboard-service";
import { matchesDashboardSearch } from "@/lib/kra-kpi/dashboard-search";

type PeriodOption = {
  id: string;
  name: string;
  state: string;
};

type PeriodComparisonChartProps = {
  periodId: string;
  orgUnitId: string | null;
  kpiOptions: Array<{
    sourceKpiId: string;
    kraTitle: string;
    kpiTitle: string;
  }>;
  selectedSourceKpiId: string;
  selectedPeriodIds: string[];
  onSourceKpiChange: (kpiId: string) => void;
  onSelectedPeriodIdsChange: (periodIds: string[]) => void;
};

export function PeriodComparisonChart({
  periodId,
  orgUnitId,
  kpiOptions,
  selectedSourceKpiId,
  selectedPeriodIds,
  onSourceKpiChange,
  onSelectedPeriodIdsChange,
}: PeriodComparisonChartProps) {
  const [availablePeriods, setAvailablePeriods] = useState<PeriodOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PeriodComparisonResult | null>(null);
  const [kpiSearch, setKpiSearch] = useState("");

  useEffect(() => {
    let ignore = false;

    async function loadPeriods() {
      const response = await fetch("/api/tenant/kra-kpi/periods");
      if (!response.ok || ignore) return;
      const data = (await response.json()) as Array<{
        id: string;
        name: string;
        state: string;
      }>;
      setAvailablePeriods(data.filter((entry) => entry.state !== "DRAFT"));
    }

    void loadPeriods();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (kpiOptions.length === 0) {
      if (selectedSourceKpiId) {
        onSourceKpiChange("");
      }
      return;
    }
    if (!kpiOptions.some((kpi) => kpi.sourceKpiId === selectedSourceKpiId)) {
      onSourceKpiChange(kpiOptions[0]!.sourceKpiId);
    }
  }, [kpiOptions, onSourceKpiChange, selectedSourceKpiId]);

  useEffect(() => {
    if (availablePeriods.length === 0) return;

    const validIds = selectedPeriodIds.filter((value) =>
      availablePeriods.some((period) => period.id === value),
    );
    if (validIds.length === selectedPeriodIds.length && validIds.length > 0) {
      return;
    }

    const fallback = [
      periodId,
      ...availablePeriods.filter((entry) => entry.id !== periodId).map((entry) => entry.id),
    ].slice(0, Math.min(2, availablePeriods.length));
    onSelectedPeriodIdsChange([...new Set(validIds.length > 0 ? validIds : fallback)]);
  }, [availablePeriods, onSelectedPeriodIdsChange, periodId, selectedPeriodIds]);

  useEffect(() => {
    if (!selectedSourceKpiId || selectedPeriodIds.length === 0) {
      setResult(null);
      return;
    }

    let ignore = false;

    async function loadComparison() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/tenant/kra-kpi/dashboard/period-comparison?sourceKpiId=${encodeURIComponent(selectedSourceKpiId)}&periodIds=${encodeURIComponent(selectedPeriodIds.join(","))}${orgUnitId ? `&orgUnitId=${encodeURIComponent(orgUnitId)}` : ""}`,
        );
        const data = (await response.json()) as PeriodComparisonResult | { message?: string };
        if (!response.ok) {
          throw new Error("message" in data ? data.message ?? "Failed to load period comparison." : "Failed to load period comparison.");
        }
        if (!ignore) {
          setResult(data as PeriodComparisonResult);
        }
      } catch (loadError) {
        if (!ignore) {
          setResult(null);
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Failed to load period comparison.",
          );
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    void loadComparison();
    return () => {
      ignore = true;
    };
  }, [orgUnitId, selectedPeriodIds, selectedSourceKpiId]);

  const filteredKpiOptions = useMemo(
    () =>
      kpiOptions.filter((kpi) =>
        matchesDashboardSearch(kpiSearch, kpi.kraTitle, kpi.kpiTitle),
      ),
    [kpiOptions, kpiSearch],
  );
  const selectableKpiOptions = useMemo(() => {
    const selected = kpiOptions.find((kpi) => kpi.sourceKpiId === selectedSourceKpiId) ?? null;
    if (!selected) {
      return filteredKpiOptions;
    }
    return filteredKpiOptions.some((kpi) => kpi.sourceKpiId === selected.sourceKpiId)
      ? filteredKpiOptions
      : [selected, ...filteredKpiOptions];
  }, [filteredKpiOptions, kpiOptions, selectedSourceKpiId]);

  const chartRows = useMemo(
    () =>
      (result?.periods ?? [])
        .filter((period) => period.matchStatus === "matched")
        .map((period) => ({
          label: period.periodName,
          target: period.targetTotal ?? 0,
          achieved: period.achievedTotal ?? 0,
        })),
    [result],
  );

  const selectedKpiLabel = kpiOptions.find((kpi) => kpi.sourceKpiId === selectedSourceKpiId);

  function togglePeriod(id: string) {
    const next = selectedPeriodIds.includes(id)
      ? selectedPeriodIds.filter((periodId) => periodId !== id)
      : [...selectedPeriodIds, id];
    if (next.length === 0 || next.length > 5) return;
    onSelectedPeriodIdsChange(next);
  }

  return (
    <div className="space-y-4">
      <section className="rounded-[1.5rem] border border-slate-200/80 bg-white/80 p-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              KPI
            </label>
            <label className="mb-3 flex items-center gap-3 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-500">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                type="search"
                value={kpiSearch}
                onChange={(event) => setKpiSearch(event.target.value)}
                placeholder="Search KRA or KPI"
                className="w-full bg-transparent text-sm text-slate-700 outline-none"
              />
            </label>
            <select
              value={selectedSourceKpiId}
              onChange={(event) => onSourceKpiChange(event.target.value)}
              className="w-full rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15"
            >
              {selectableKpiOptions.map((kpi) => (
                <option key={kpi.sourceKpiId} value={kpi.sourceKpiId}>
                  {kpi.kraTitle} | {kpi.kpiTitle}
                </option>
              ))}
            </select>
            {filteredKpiOptions.length === 0 ? (
              <p className="mt-2 text-xs text-amber-700">
                No KPI matches the current search.
              </p>
            ) : null}
          </div>
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Periods
            </div>
            <div className="flex flex-wrap gap-2">
              {availablePeriods.map((period) => (
                <button
                  key={period.id}
                  type="button"
                  onClick={() => togglePeriod(period.id)}
                  className={`rounded-full border px-3 py-1.5 text-sm transition ${
                    selectedPeriodIds.includes(period.id)
                      ? "border-blue bg-blue-soft text-blue"
                      : "border-slate-200 bg-white text-slate-600"
                  }`}
                >
                  {period.name}
                </button>
              ))}
            </div>
          </div>
        </div>
        {selectedKpiLabel ? (
          <p className="mt-3 text-sm text-slate-500">
            Comparing {selectedKpiLabel.kraTitle} / {selectedKpiLabel.kpiTitle} across the selected periods.
          </p>
        ) : null}
      </section>

      {error ? (
        <EmptyState
          title="Could not load period comparison"
          description={error}
        />
      ) : (
        <>
          <ChartContainer
            title="Period comparison"
            loading={loading}
            fallbackData={{
              headers: ["Period", "Target", "Achieved", "Completion %", "Average Score"],
              rows:
                result?.periods.map((period) => [
                  period.periodName,
                  period.targetTotal ?? "--",
                  period.achievedTotal ?? "--",
                  period.completionPercent,
                  period.averageScore,
                ]) ?? [],
            }}
          >
            {!result ? (
              <EmptyState
                title="No comparison selected"
                description="Choose a KPI and at least one period to compare."
              />
            ) : result.comparisonMode === "NUMERIC" && chartRows.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartRows}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="target" fill="var(--blue)" radius={[10, 10, 0, 0]} />
                  <Bar dataKey="achieved" fill="var(--brand)" radius={[10, 10, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState
                title="Score and completion comparison"
                description="This KPI mix is not numerically comparable across the selected periods, so the comparison falls back to score and completion."
              />
            )}
          </ChartContainer>

          <div className="space-y-3">
            {(result?.periods ?? []).map((period) => (
              <article
                key={period.periodId}
                className="rounded-[1.5rem] border border-slate-200/80 bg-white/80 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-slate-900">{period.periodName}</div>
                    <div className="mt-1 flex flex-wrap gap-2">
                      <StatusPill label={period.matchStatus} tone={
                        period.matchStatus === "matched"
                          ? "brand"
                          : period.matchStatus === "ambiguous"
                            ? "amber"
                            : "slate"
                      } />
                      {period.measurementType ? (
                        <StatusPill
                          label={period.measurementType.replaceAll("_", " ")}
                          tone="slate"
                        />
                      ) : null}
                    </div>
                  </div>
                  <ScoreBadge score={period.averageScore} size="sm" />
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-4">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                      Completion
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-slate-900">
                      {period.completionPercent}%
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                      Verified
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-slate-900">
                      {period.verifiedCount}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                      Target Total
                    </div>
                    <div className="mt-2 text-lg font-semibold text-slate-900">
                      {period.targetTotal ?? "--"}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                      Achieved Total
                    </div>
                    <div className="mt-2 text-lg font-semibold text-slate-900">
                      {period.achievedTotal ?? "--"}
                    </div>
                  </div>
                </div>
                {period.matchStatus === "ambiguous" && period.candidateMatches.length > 0 ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {period.candidateMatches.map((candidate) => (
                      <StatusPill
                        key={candidate.kpiId}
                        label={`${candidate.kraTitle} | ${candidate.kpiTitle}`}
                        tone="amber"
                      />
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
