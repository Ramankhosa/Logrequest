import { cn } from "@/lib/utils";

type PanelProps = {
  eyebrow: string;
  title: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
};

export function Panel({
  eyebrow,
  title,
  description,
  children,
  className,
}: PanelProps) {
  return (
    <section
      className={cn(
        "glass-panel rounded-[1.75rem] border px-5 py-5 sm:px-6",
        className,
      )}
    >
      <div className="mb-5 space-y-2">
        <span className="section-title text-xs text-slate-500">{eyebrow}</span>
        <h2 className="text-xl font-semibold text-slate-950">{title}</h2>
        {description ? (
          <p className="text-sm leading-7 text-slate-600">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}
