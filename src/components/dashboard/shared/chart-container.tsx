"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { SkeletonCard } from "./skeleton-card";

export type ChartContainerProps = {
  title: string;
  children: React.ReactNode;
  fallbackData?: {
    headers: string[];
    rows: Array<Array<string | number>>;
  };
  loading?: boolean;
};

export function ChartContainer({
  title,
  children,
  fallbackData,
  loading = false,
}: ChartContainerProps) {
  const [showTable, setShowTable] = useState(false);

  return (
    <section className="glass-panel rounded-[1.75rem] border border-slate-200/80 p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {fallbackData ? (
          <button
            type="button"
            onClick={() => setShowTable((current) => !current)}
            className="text-xs font-semibold text-slate-500 transition hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/25"
          >
            {showTable ? "View chart" : "View as table"}
          </button>
        ) : null}
      </div>

      {loading ? (
        <SkeletonCard variant="chart" />
      ) : showTable && fallbackData ? (
        <div className="overflow-hidden rounded-[1.25rem] border border-slate-200">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                <tr>
                  {fallbackData.headers.map((header) => (
                    <th key={header} scope="col" className="px-4 py-3">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {fallbackData.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td key={`${rowIndex}-${cellIndex}`} className="px-4 py-3 text-slate-600">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className={cn("min-h-[200px] sm:min-h-[240px]")}>{children}</div>
      )}
    </section>
  );
}
