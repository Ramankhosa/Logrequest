"use client";

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
  scoreToTone,
  toneToMetricClasses,
} from "@/components/dashboard/shared";
import type { CrossUnitComparison } from "@/lib/kra-kpi/dashboard-service";

type CrossUnitHeatmapProps = {
  comparison: CrossUnitComparison | null;
  loading?: boolean;
};

export function CrossUnitHeatmap({
  comparison,
  loading = false,
}: CrossUnitHeatmapProps) {
  const units = comparison?.units ?? [];
  const kraTitles = [...new Set(units.flatMap((unit) => unit.kraBreakdown.map((kra) => kra.kraTitle)))];

  return (
    <div className="space-y-4">
      <ChartContainer
        title="Cross-unit heatmap"
        loading={loading}
        fallbackData={{
          headers: ["Unit", ...kraTitles, "Overall"],
          rows: units.map((unit) => [
            unit.unitName,
            ...kraTitles.map((title) =>
              unit.kraBreakdown.find((kra) => kra.kraTitle === title)?.averageScore ?? "-",
            ),
            unit.averageScore,
          ]),
        }}
      >
        {units.length === 0 ? (
          <EmptyState
            title="No comparable child units"
            description="This node has no visible child units to compare in the current scope."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 rounded-[1.5rem] border border-slate-200/80 bg-white/80 text-sm">
              <thead className="bg-slate-50/90">
                <tr>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Unit
                  </th>
                  {kraTitles.map((title) => (
                    <th
                      key={title}
                      className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500"
                    >
                      {title}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Overall
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white/90">
                {units.map((unit) => (
                  <tr key={unit.unitId}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{unit.unitName}</div>
                      <div className="text-xs text-slate-500">{unit.unitCode}</div>
                    </td>
                    {kraTitles.map((title) => {
                      const kra = unit.kraBreakdown.find((item) => item.kraTitle === title) ?? null;
                      const tone = scoreToTone(kra?.averageScore ?? null);
                      return (
                        <td key={`${unit.unitId}:${title}`} className="px-4 py-3">
                          <div
                            title={
                              kra
                                ? `${kra.averageScore} score | ${kra.completionPercent}% completion | ${kra.totalAllocations} allocations`
                                : "No allocations"
                            }
                            className={`rounded-2xl px-3 py-2 text-sm font-semibold ${toneToMetricClasses(tone).soft} ${tone === "slate" ? "text-slate-600" : "text-slate-900"}`}
                          >
                            {kra ? `${kra.averageScore}` : "--"}
                          </div>
                        </td>
                      );
                    })}
                    <td className="px-4 py-3">
                      <div
                        className={`rounded-2xl px-3 py-2 text-sm font-semibold ${toneToMetricClasses(scoreToTone(unit.averageScore)).soft} text-slate-900`}
                        title={`${unit.averageScore} score | ${unit.completionPercent}% completion`}
                      >
                        {unit.averageScore}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ChartContainer>

      <ChartContainer
        title="Completion by unit"
        loading={loading}
        fallbackData={{
          headers: ["Unit", "Completion %"],
          rows: units.map((unit) => [unit.unitName, unit.completionPercent]),
        }}
      >
        {units.length === 0 ? (
          <EmptyState
            title="No completion comparison available"
            description="Completion bars appear when there are visible child units in the current scope."
          />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart
              data={units.map((unit) => ({
                label: unit.unitName,
                completion: unit.completionPercent,
              }))}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="completion" fill="var(--blue)" radius={[10, 10, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartContainer>
    </div>
  );
}
