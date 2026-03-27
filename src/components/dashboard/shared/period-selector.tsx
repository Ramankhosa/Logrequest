"use client";

import { useEffect } from "react";
import { CalendarRange } from "lucide-react";
import { cn } from "@/lib/utils";

export type PeriodSelectorOption = {
  id: string;
  name: string;
  startDate: string | Date;
  endDate: string | Date;
  state: string;
};

export type PeriodSelectorProps = {
  periods: PeriodSelectorOption[];
  selectedId: string | null;
  onChange: (periodId: string) => void;
  className?: string;
};

export function resolveDefaultPeriodId(periods: PeriodSelectorOption[]) {
  if (periods.length === 0) return null;

  const byPriority = ["IN_PROGRESS", "OPEN", "UNDER_REVIEW"];
  for (const state of byPriority) {
    const match = periods.find((period) => period.state === state);
    if (match) return match.id;
  }

  const liveCandidates = periods.filter(
    (period) => period.state !== "ARCHIVED" && period.state !== "CLOSED",
  );

  const fallbackPool = liveCandidates.length > 0 ? liveCandidates : periods;
  return [...fallbackPool]
    .sort(
      (left, right) =>
        new Date(right.endDate).getTime() - new Date(left.endDate).getTime(),
    )[0]?.id ?? null;
}

export function PeriodSelector({
  periods,
  selectedId,
  onChange,
  className,
}: PeriodSelectorProps) {
  useEffect(() => {
    if (!selectedId) {
      const next = resolveDefaultPeriodId(periods);
      if (next) onChange(next);
    }
  }, [onChange, periods, selectedId]);

  return (
    <label
      className={cn(
        "glass-panel inline-flex min-w-[250px] items-center gap-3 rounded-2xl border border-slate-200/80 px-4 py-3",
        className,
      )}
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-soft text-blue">
        <CalendarRange className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
          Assessment Period
        </span>
        <select
          aria-label="Select assessment period"
          value={selectedId ?? ""}
          onChange={(event) => onChange(event.target.value)}
          className="mt-1 w-full bg-transparent text-sm font-semibold text-slate-900 outline-none"
        >
          {periods.map((period) => (
            <option key={period.id} value={period.id}>
              {`${period.name} | ${period.state} | ${formatRange(period.startDate, period.endDate)}`}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}

function formatRange(startDate: string | Date, endDate: string | Date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return `${formatter.format(new Date(startDate))} - ${formatter.format(new Date(endDate))}`;
}
