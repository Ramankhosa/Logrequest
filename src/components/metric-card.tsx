import { cn } from "@/lib/utils";

type MetricCardProps = {
  label: string;
  value: string;
  description: string;
  accent: "brand" | "amber" | "rose" | "slate";
  icon?: React.ReactNode;
};

const accentStyles = {
  brand: "border-brand/15 bg-brand-soft/70 text-brand",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  rose: "border-rose-200 bg-rose-50 text-rose-700",
  slate: "border-slate-200 bg-slate-50 text-slate-700",
};

export function MetricCard({
  label,
  value,
  description,
  accent,
  icon,
}: MetricCardProps) {
  return (
    <div className="data-glow rounded-[1.75rem] border border-slate-200/80 bg-white/85 p-5 shadow-[0_18px_50px_rgba(23,32,51,0.05)]">
      <div className="mb-4 flex items-center justify-between gap-4">
        <span className="text-sm font-semibold text-slate-500">{label}</span>
        <span
          className={cn(
            "inline-flex h-9 w-9 items-center justify-center rounded-2xl border",
            accentStyles[accent],
          )}
        >
          {icon}
        </span>
      </div>
      <div className="mb-2 font-[family-name:var(--font-geist-mono)] text-3xl text-slate-950">
        {value}
      </div>
      <p className="text-sm leading-7 text-slate-600">{description}</p>
    </div>
  );
}
