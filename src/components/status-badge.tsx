import { cn } from "@/lib/utils";
import {
  stateToLabel,
  stateToTone,
  toneToPillClasses,
  type DashboardTone,
} from "@/components/dashboard/shared/color-utils";

export type StatusBadgeProps = {
  label?: string;
  state?: string;
  tone?: DashboardTone;
  className?: string;
};

export function StatusBadge({
  label,
  state,
  tone,
  className,
}: StatusBadgeProps) {
  const rawValue = state ?? label ?? "UNKNOWN";
  const resolvedTone = tone ?? stateToTone(rawValue);

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold",
        toneToPillClasses(resolvedTone),
        className,
      )}
    >
      {stateToLabel(rawValue)}
    </span>
  );
}
