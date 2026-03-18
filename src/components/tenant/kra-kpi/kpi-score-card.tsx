"use client";

import { cn } from "@/lib/utils";

type KpiScoreCardProps = {
  kpiTitle: string;
  score: number | null;
  weightage: number;
  measurementType: string;
  actualValue?: number | null;
  targetValue?: number | null;
  unitLabel?: string | null;
};

function scoreColor(score: number | null): string {
  if (score === null) return "text-slate-400";
  if (score >= 80) return "text-emerald-600";
  if (score >= 60) return "text-brand";
  if (score >= 40) return "text-amber-600";
  return "text-rose-600";
}

function scoreBg(score: number | null): string {
  if (score === null) return "bg-slate-100";
  if (score >= 80) return "bg-emerald-50";
  if (score >= 60) return "bg-brand-soft/60";
  if (score >= 40) return "bg-amber-50";
  return "bg-rose-50";
}

export function KpiScoreCard({
  kpiTitle,
  score,
  weightage,
  measurementType,
  actualValue,
  targetValue,
  unitLabel,
}: KpiScoreCardProps) {
  const weighted = score !== null ? Math.round((score * weightage) / 100 * 100) / 100 : null;

  return (
    <div className="rounded-xl border border-slate-200/80 bg-white p-4 transition hover:border-slate-300">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">{kpiTitle}</p>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400">
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-medium">{measurementType}</span>
            <span>Weight: {weightage}</span>
          </div>
        </div>

        <div className={cn("flex flex-col items-center rounded-xl px-3 py-2", scoreBg(score))}>
          <span className={cn("text-lg font-bold tabular-nums", scoreColor(score))}>
            {score !== null ? score.toFixed(1) : "—"}
          </span>
          <span className="text-[10px] text-slate-500">/ 100</span>
        </div>
      </div>

      {(actualValue !== null && actualValue !== undefined) && (
        <div className="mt-3 flex items-center gap-4 text-xs text-slate-500">
          <span>
            Actual: <strong className="text-slate-700">{actualValue}{unitLabel ? ` ${unitLabel}` : ""}</strong>
          </span>
          {targetValue !== null && targetValue !== undefined && (
            <span>
              Target: <strong className="text-slate-700">{targetValue}{unitLabel ? ` ${unitLabel}` : ""}</strong>
            </span>
          )}
          {weighted !== null && (
            <span className="ml-auto font-medium text-slate-600">
              Weighted: {weighted}
            </span>
          )}
        </div>
      )}

      {/* Score bar */}
      <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            score !== null && score >= 80
              ? "bg-emerald-500"
              : score !== null && score >= 60
                ? "bg-brand"
                : score !== null && score >= 40
                  ? "bg-amber-500"
                  : score !== null
                    ? "bg-rose-500"
                    : "bg-slate-200",
          )}
          style={{ width: `${Math.min(score ?? 0, 100)}%` }}
        />
      </div>
    </div>
  );
}
