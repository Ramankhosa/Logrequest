"use client";

import { Download, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type ExportButtonProps = {
  label?: string;
  href?: string;
  onClick?: () => void;
  loading?: boolean;
  className?: string;
};

export function ExportButton({
  label = "Export CSV",
  href,
  onClick,
  loading = false,
  className,
}: ExportButtonProps) {
  const icon = loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />;

  if (href) {
    return (
      <a
        href={href}
        className={cn(
          "inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/25",
          className,
        )}
      >
        {icon}
        {label}
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/25 disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
    >
      {icon}
      {label}
    </button>
  );
}
