import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { SkeletonCard } from "@/components/dashboard/shared/skeleton-card";
import {
  toneToMetricClasses,
  type DashboardTone,
} from "@/components/dashboard/shared/color-utils";

export type MetricCardProps = {
  label: string;
  value: string | number;
  description?: string;
  tone?: DashboardTone;
  accent?: DashboardTone;
  trend?: {
    direction: "up" | "down" | "flat";
    label: string;
  };
  loading?: boolean;
  icon?: React.ReactNode;
  className?: string;
};

export function MetricCard({
  label,
  value,
  description,
  tone,
  accent,
  trend,
  loading = false,
  icon,
  className,
}: MetricCardProps) {
  if (loading) {
    return <SkeletonCard variant="metric" />;
  }

  const resolvedTone = tone ?? accent ?? "brand";
  const toneClasses = toneToMetricClasses(resolvedTone);
  const TrendIcon =
    trend?.direction === "up"
      ? ArrowUpRight
      : trend?.direction === "down"
        ? ArrowDownRight
        : ArrowRight;

  return (
    <div
      className={cn(
        "glass-panel data-glow rounded-[1.75rem] border border-slate-200/80 border-l-4 p-5",
        toneClasses.border,
        className,
      )}
    >
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            {label}
          </span>
        </div>
        {icon ? (
          <span
            className={cn(
              "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border",
              toneClasses.icon,
            )}
          >
            {icon}
          </span>
        ) : null}
      </div>
      <div className="font-mono text-3xl font-bold text-slate-950">{value}</div>
      {description ? (
        <p className="mt-3 text-sm leading-7 text-slate-600">{description}</p>
      ) : null}
      {trend ? (
        <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/75 px-3 py-1.5 text-xs font-semibold text-slate-600">
          <span className={cn("inline-flex h-6 w-6 items-center justify-center rounded-full", toneClasses.soft)}>
            <TrendIcon className="h-3.5 w-3.5" />
          </span>
          {trend.label}
        </div>
      ) : null}
    </div>
  );
}
