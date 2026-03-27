import { cn } from "@/lib/utils";
import { scoreToTone, toneToFillClass } from "./color-utils";

export type CompletionBarProps = {
  percent: number;
  showLabel?: boolean;
  height?: "sm" | "md";
};

export function CompletionBar({
  percent,
  showLabel = true,
  height = "sm",
}: CompletionBarProps) {
  const normalized = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
  const tone = scoreToTone(normalized);

  return (
    <div className="flex items-center gap-3">
      <div
        className={cn(
          "w-full overflow-hidden rounded-full bg-slate-200",
          height === "sm" ? "h-1.5" : "h-2.5",
        )}
        aria-hidden="true"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-300 ease-out",
            toneToFillClass(tone),
          )}
          style={{ width: `${normalized}%` }}
        />
      </div>
      {showLabel ? (
        <span className="min-w-10 text-right text-xs font-semibold tabular-nums text-slate-600">
          {Math.round(normalized)}%
        </span>
      ) : null}
    </div>
  );
}
