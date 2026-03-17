import { cn } from "@/lib/utils";

type Tone = "brand" | "amber" | "rose" | "slate";

type StatusBadgeProps = {
  label: string;
  tone?: Tone;
  className?: string;
};

const toneStyles: Record<Tone, string> = {
  brand: "border-brand/15 bg-brand-soft text-brand",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  rose: "border-rose-200 bg-rose-50 text-rose-700",
  slate: "border-slate-200 bg-slate-100 text-slate-700",
};

export function StatusBadge({
  label,
  tone,
  className,
}: StatusBadgeProps) {
  const resolvedTone = tone ?? inferTone(label);

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold",
        toneStyles[resolvedTone],
        className,
      )}
    >
      {toDisplayLabel(label)}
    </span>
  );
}

function inferTone(label: string): Tone {
  const normalized = label.toUpperCase().replaceAll(" ", "_");

  if (
    normalized.includes("ACTIVE") ||
    normalized.includes("PAID") ||
    normalized.includes("READY") ||
    normalized.includes("ACCEPTED") ||
    normalized.includes("ENABLED")
  ) {
    return "brand";
  }

  if (
    normalized.includes("SUSPENDED") ||
    normalized.includes("REVOKED") ||
    normalized.includes("REJECTED") ||
    normalized.includes("RISK") ||
    normalized.includes("EXPIRED")
  ) {
    return "rose";
  }

  if (
    normalized.includes("PENDING") ||
    normalized.includes("GRACE") ||
    normalized.includes("WARNING") ||
    normalized.includes("REVIEW") ||
    normalized.includes("DEFERRED")
  ) {
    return "amber";
  }

  return "slate";
}

function toDisplayLabel(label: string) {
  return label
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}
