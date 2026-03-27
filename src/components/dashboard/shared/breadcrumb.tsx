import { ChevronRight, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

export type BreadcrumbItem = {
  label: string;
  onClick?: () => void;
};

export type BreadcrumbProps = {
  items: BreadcrumbItem[];
  className?: string;
};

export function Breadcrumb({
  items,
  className,
}: BreadcrumbProps) {
  if (items.length === 0) return null;

  const mobileItems =
    items.length > 3
      ? [items[0], { label: "...ellipsis..." }, ...items.slice(-2)]
      : items;

  return (
    <>
      <nav
        aria-label="Breadcrumb"
        className={cn("hidden items-center gap-2 text-sm text-slate-500 md:flex", className)}
      >
        {items.map((item, index) => renderItem(item, index === items.length - 1))}
      </nav>
      <nav
        aria-label="Breadcrumb"
        className={cn("flex items-center gap-2 text-sm text-slate-500 md:hidden", className)}
      >
        {mobileItems.map((item, index) => {
          if (item.label === "...ellipsis...") {
            return (
              <span key={`ellipsis-${index}`} className="flex items-center gap-2">
                <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
                <MoreHorizontal className="h-4 w-4 text-slate-400" />
              </span>
            );
          }

          return renderItem(item, index === mobileItems.length - 1);
        })}
      </nav>
    </>
  );
}

function renderItem(item: BreadcrumbItem, isLast: boolean) {
  return (
    <span key={item.label} className="flex items-center gap-2">
      {isLast ? null : <ChevronRight className="h-3.5 w-3.5 text-slate-300" />}
      {item.onClick && !isLast ? (
        <button
          type="button"
          onClick={item.onClick}
          className="font-medium text-slate-500 transition hover:text-slate-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/25"
        >
          {item.label}
        </button>
      ) : (
        <span className={cn(isLast ? "font-semibold text-slate-900" : "text-slate-500")}>
          {item.label}
        </span>
      )}
    </span>
  );
}
