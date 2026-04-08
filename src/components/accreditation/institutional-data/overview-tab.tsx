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
          title="Build your institutional data bank"
          description="Seed the guided source packs first. They come with templates, sample rows, and upload rules for non-technical coordinators."
          actionLabel="Seed Guided Source Packs"
          onAction={() => void seedCatalog()}
        />

        <div className="rounded-[1.75rem] border border-slate-200/80 bg-white/85 p-6">
          <h3 className="text-sm font-semibold text-slate-900">How the databank works</h3>
          <ol className="mt-3 space-y-3 text-sm text-slate-600">
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">1</span>
              <span><strong className="text-slate-900">Choose the source pack</strong> - for example HR, placements, finance, or publications.</span>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">2</span>
              <span><strong className="text-slate-900">Upload the data you have</strong> - partial files are accepted, and the system warns about missing or invalid rows.</span>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">3</span>
              <span><strong className="text-slate-900">Track readiness</strong> - see what is ready, partial, or still missing for accreditation metrics.</span>
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
        <StatCard label="Source Packs" value={summary?.sourceCount} loading={loading} />
        <StatCard label="Linked Metrics" value={summary?.metricCount} loading={loading} />
        <StatCard label="Pending Reviews" value={summary?.pendingSuggestionCount} loading={loading} accent={!!summary && summary.pendingSuggestionCount > 0} />
        <StatCard label="Needs Refresh" value={summary?.staleMetricCount} loading={loading} accent={!!summary && summary.staleMetricCount > 0} />
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
          Seed Guided Source Packs
        </button>
        <button
          type="button"
          onClick={onGoToSources}
          className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          Go to Build Data Bank
        </button>
      </div>

      {/* Gap analysis */}
      {gapItems.length > 0 ? (
        <section className="rounded-[1.75rem] border border-slate-200/80 bg-white/85 p-6">
          <h3 className="mb-1 text-sm font-semibold text-slate-900">Data Gaps</h3>
          <p className="mb-4 text-xs text-slate-500">These metrics still need better uploads, cleaner files, or fresher data.</p>
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
            All linked metrics currently have usable data. No major gaps detected.
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
