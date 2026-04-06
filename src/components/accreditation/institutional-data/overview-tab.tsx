"use client";

import { Database, Sprout } from "lucide-react";
import { EmptyState } from "@/components/dashboard/shared";
import type { InstitutionalDataHook } from "./use-institutional-data";

type Props = Pick<
  InstitutionalDataHook,
  "loading" | "saving" | "summary" | "gapItems" | "seedCatalog"
> & {
  onGoToSources: () => void;
};

const GAP_STATUS_CLASSES: Record<string, string> = {
  MISSING: "border-rose-200 bg-rose-50 text-rose-700",
  PARTIAL: "border-amber-200 bg-amber-50 text-amber-700",
  STALE: "border-slate-200 bg-slate-100 text-slate-600",
};

const GAP_STATUS_LABELS: Record<string, string> = {
  MISSING: "Missing data",
  PARTIAL: "Partial data",
  STALE: "Stale data",
};

export function OverviewTab({ loading, saving, summary, gapItems, seedCatalog, onGoToSources }: Props) {
  const isEmpty = !loading && summary && summary.sourceCount === 0 && summary.metricCount === 0;

  if (isEmpty) {
    return (
      <div className="space-y-6">
        <EmptyState
          icon={<Database className="h-7 w-7" />}
          title="No institutional data yet"
          description="Start by seeding the recommended catalog of data sources and metrics, or add your own sources manually."
          actionLabel="Seed Recommended Catalog"
          onAction={() => void seedCatalog()}
        />

        <div className="rounded-[1.75rem] border border-slate-200/80 bg-white/85 p-6">
          <h3 className="text-sm font-semibold text-slate-900">How it works</h3>
          <ol className="mt-3 space-y-3 text-sm text-slate-600">
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">1</span>
              <span><strong className="text-slate-900">Add data sources</strong> &mdash; these are where your institution&apos;s data lives (spreadsheets, system records, documents).</span>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">2</span>
              <span><strong className="text-slate-900">Upload or sync data</strong> &mdash; import spreadsheets, enter values manually, or auto-sync from system adapters.</span>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">3</span>
              <span><strong className="text-slate-900">Define metrics</strong> &mdash; create reusable metrics that pull values from your sources for accreditation.</span>
            </li>
          </ol>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary stat cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Domains" value={summary?.domainCount} loading={loading} />
        <StatCard label="Data Sources" value={summary?.sourceCount} loading={loading} />
        <StatCard label="Metrics" value={summary?.metricCount} loading={loading} />
        <StatCard label="Pending Reviews" value={summary?.pendingSuggestionCount} loading={loading} accent={!!summary && summary.pendingSuggestionCount > 0} />
        <StatCard label="Stale Metrics" value={summary?.staleMetricCount} loading={loading} accent={!!summary && summary.staleMetricCount > 0} />
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={() => void seedCatalog()}
          className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:bg-slate-300"
        >
          <Sprout className="h-4 w-4" />
          Seed Recommended Catalog
        </button>
        <button
          type="button"
          onClick={onGoToSources}
          className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          Go to Data Sources
        </button>
      </div>

      {/* Gap analysis */}
      {gapItems.length > 0 ? (
        <section className="rounded-[1.75rem] border border-slate-200/80 bg-white/85 p-6">
          <h3 className="mb-1 text-sm font-semibold text-slate-900">Data Gaps</h3>
          <p className="mb-4 text-xs text-slate-500">Metrics that need attention &mdash; missing, partial, or stale data.</p>
          <div className="flex flex-wrap gap-2">
            {gapItems.slice(0, 20).map((item) => (
              <span
                key={item.metricId}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${GAP_STATUS_CLASSES[item.gapStatus] ?? "border-slate-200 bg-slate-50 text-slate-600"}`}
              >
                {item.code} &middot; {GAP_STATUS_LABELS[item.gapStatus] ?? item.gapStatus}
              </span>
            ))}
            {gapItems.length > 20 ? (
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-500">
                +{gapItems.length - 20} more
              </span>
            ) : null}
          </div>
        </section>
      ) : (
        !loading && (
          <div className="rounded-[1.75rem] border border-emerald-200/80 bg-emerald-50/50 px-6 py-4 text-sm text-emerald-700">
            All metrics have complete data. No gaps detected.
          </div>
        )
      )}
    </div>
  );
}

function StatCard({ label, value, loading, accent }: { label: string; value?: number; loading: boolean; accent?: boolean }) {
  return (
    <div className={`rounded-2xl px-4 py-3 ${accent ? "bg-amber-50 border border-amber-200" : "bg-slate-50"}`}>
      <p className="text-xs uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${accent ? "text-amber-700" : "text-slate-900"}`}>
        {value ?? (loading ? "..." : 0)}
      </p>
    </div>
  );
}
