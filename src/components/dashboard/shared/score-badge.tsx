import { cn } from "@/lib/utils";
import {
  scoreToTone,
  toneToPillClasses,
} from "./color-utils";

export type ScoreBadgeProps = {
  score: number | null | undefined;
  size?: "sm" | "md";
};

const sizeClasses: Record<NonNullable<ScoreBadgeProps["size"]>, string> = {
  sm: "px-2 py-0.5 text-[11px]",
  md: "px-2.5 py-1 text-xs",
};

export function ScoreBadge({
  score,
  size = "md",
}: ScoreBadgeProps) {
  const tone = scoreToTone(score);
  const label = score == null || Number.isNaN(score) ? "No score" : `${Math.round(score)} / 100`;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border font-semibold",
        sizeClasses[size],
        toneToPillClasses(tone),
      )}
    >
      {label}
    </span>
  );
}
