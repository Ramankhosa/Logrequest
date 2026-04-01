"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import {
  CompletionBar,
  EmptyState,
  ScoreBadge,
  StatusPill,
} from "@/components/dashboard/shared";
import type { DrillDownNode } from "@/lib/kra-kpi/dashboard-service";
import { matchesDashboardSearch } from "@/lib/kra-kpi/dashboard-search";

type KraDetailTableProps = {
  kraBreakdown: DrillDownNode["kraBreakdown"];
};

export function KraDetailTable({ kraBreakdown }: KraDetailTableProps) {
  const [search, setSearch] = useState("");
  const sortedBreakdown = useMemo(
    () =>
      [...kraBreakdown]
        .filter((kra) =>
          matchesDashboardSearch(
            search,
            kra.kraTitle,
            ...kra.kpis.flatMap((kpi) => [kpi.kpiTitle]),
          ),
        )
        .sort((left, right) =>
        left.completionPercent === right.completionPercent
          ? left.kraTitle.localeCompare(right.kraTitle)
          : left.completionPercent - right.completionPercent,
      ),
    [kraBreakdown, search],
  );
  const [selectedKraId, setSelectedKraId] = useState<string | null>(null);
  const openKraId = sortedBreakdown.some((kra) => kra.kraId === selectedKraId)
    ? selectedKraId
    : sortedBreakdown[0]?.kraId ?? null;

  if (sortedBreakdown.length === 0) {
    return (
      <EmptyState
        title="No KRA detail in this scope"
        description="This organization node has no KRA-linked allocations for the selected period."
      />
    );
  }

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-3 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-500">
        <Search className="h-4 w-4 text-slate-400" />
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search KRA or KPI"
          className="w-full bg-transparent text-sm text-slate-700 outline-none"
        />
      </label>
      {sortedBreakdown.map((kra) => {
        const open = openKraId === kra.kraId;
        return (
          <article
            key={kra.kraId}
            className="rounded-[1.5rem] border border-slate-200/80 bg-white/80 p-4"
          >
            <button
              type="button"
              onClick={() =>
                setSelectedKraId((current) => (current === kra.kraId ? null : kra.kraId))
              }
              className="flex w-full items-start justify-between gap-4 text-left"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {open ? (
                    <ChevronDown className="h-4 w-4 text-slate-400" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  )}
                  <h4 className="font-semibold text-slate-900">{kra.kraTitle}</h4>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <StatusPill label={`${kra.weightage}% weight`} tone="slate" />
                  <StatusPill
                    label={`${kra.completedAllocations}/${kra.totalAllocations} complete`}
                    tone="blue"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-[140px]">
                  <CompletionBar percent={kra.completionPercent} />
                </div>
                <ScoreBadge score={kra.averageScore} size="sm" />
              </div>
            </button>

            {open ? (
              <div className="mt-4 overflow-hidden rounded-[1.25rem] border border-slate-200/80">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50/90">
                      <tr>
                        <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                          KPI
                        </th>
                        <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                          Allocations
                        </th>
                        <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                          Completion
                        </th>
                        <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                          Score
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white/90">
                      {kra.kpis.map((kpi) => (
                        <tr key={kpi.sourceKpiId}>
                          <td className="px-4 py-3 text-slate-700">
                            <div className="font-medium text-slate-900">{kpi.kpiTitle}</div>
                            <div className="mt-1 flex flex-wrap gap-2">
                              <StatusPill
                                label={kpi.measurementType.replaceAll("_", " ")}
                                tone="slate"
                              />
                              {kpi.stageCount > 0 ? (
                                <StatusPill label={`${kpi.stageCount} stages`} tone="blue" />
                              ) : null}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-slate-600">{kpi.totalAllocations}</td>
                          <td className="px-4 py-3">
                            <div className="min-w-[140px]">
                              <CompletionBar percent={kpi.completionPercent} />
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <ScoreBadge score={kpi.averageScore} size="sm" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
