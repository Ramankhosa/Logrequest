import { cn } from "@/lib/utils";

export type SkeletonCardProps = {
  variant: "metric" | "table-row" | "chart";
  count?: number;
};

export function SkeletonCard({
  variant,
  count = 1,
}: SkeletonCardProps) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <div key={`${variant}-${index}`}>{renderVariant(variant)}</div>
      ))}
    </>
  );
}

function renderVariant(variant: SkeletonCardProps["variant"]) {
  if (variant === "metric") {
    return (
      <div className="glass-panel animate-pulse rounded-[1.75rem] border border-slate-200/80 p-5">
        <div className="mb-6 flex items-center justify-between">
          <div className="h-3 w-24 rounded-full bg-slate-200" />
          <div className="h-10 w-10 rounded-2xl bg-slate-200" />
        </div>
        <div className="h-9 w-28 rounded-xl bg-slate-200" />
        <div className="mt-4 h-3 w-3/4 rounded-full bg-slate-200" />
        <div className="mt-2 h-3 w-2/3 rounded-full bg-slate-200" />
      </div>
    );
  }

  if (variant === "chart") {
    return (
      <div className="glass-panel animate-pulse rounded-[1.75rem] border border-slate-200/80 p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="h-4 w-32 rounded-full bg-slate-200" />
          <div className="h-4 w-24 rounded-full bg-slate-200" />
        </div>
        <div className="h-[220px] rounded-[1.4rem] bg-slate-200/90" />
      </div>
    );
  }

  return (
    <div className="animate-pulse rounded-2xl border border-slate-200/80 bg-white/70 p-4">
      <div className="grid gap-3 md:grid-cols-[1.2fr_1fr_0.7fr_0.7fr]">
        {["w-28", "w-40", "w-20", "w-24"].map((width, index) => (
          <div key={index} className="space-y-2">
            <div className="h-3 w-16 rounded-full bg-slate-200" />
            <div className={cn("h-4 rounded-full bg-slate-200", width)} />
          </div>
        ))}
      </div>
    </div>
  );
}
