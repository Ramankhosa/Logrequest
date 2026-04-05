"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type SummaryPayload = {
  domainCount: number;
  sourceCount: number;
  metricCount: number;
  pendingSuggestionCount: number;
};

type GapsPayload = {
  missingMetrics: number;
  partialMetrics: number;
  staleMetrics: number;
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = (await response.json()) as T & { status?: string; message?: string };
  if (!response.ok || data.status === "error") {
    throw new Error(data.message ?? "Request failed.");
  }
  return data;
}

export function InstitutionalDataSummaryCard() {
  const [summary, setSummary] = useState<SummaryPayload | null>(null);
  const [gaps, setGaps] = useState<GapsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetchJson<{ summary: SummaryPayload }>("/api/tenant/accreditation/institutional-data/summary"),
      fetchJson<{ gaps: GapsPayload }>("/api/tenant/accreditation/institutional-data/gaps"),
    ])
      .then(([summaryResponse, gapsResponse]) => {
        if (cancelled) {
          return;
        }
        setSummary(summaryResponse.summary);
        setGaps(gapsResponse.gaps);
      })
      .catch((fetchError: unknown) => {
        if (cancelled) {
          return;
        }
        setError(fetchError instanceof Error ? fetchError.message : "Failed to load institutional data summary.");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="rounded-[1.75rem] border border-slate-200/80 bg-white/85 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">R3.5</p>
          <h2 className="text-xl font-semibold text-slate-900">Institutional Data Bank</h2>
          <p className="text-sm text-slate-500">
            Keep reusable sources and metrics ready for accreditation workspaces.
          </p>
        </div>
        <Link
          href="/tenant-admin/institutional-data"
          className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white"
        >
          Open Data Bank
        </Link>
      </div>

      {error ? (
        <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      <div className="mt-5 grid gap-3 md:grid-cols-4">
        <div className="rounded-2xl bg-slate-50 px-4 py-3">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Domains</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{summary?.domainCount ?? "..."}</p>
        </div>
        <div className="rounded-2xl bg-slate-50 px-4 py-3">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Sources</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{summary?.sourceCount ?? "..."}</p>
        </div>
        <div className="rounded-2xl bg-slate-50 px-4 py-3">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Metrics</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{summary?.metricCount ?? "..."}</p>
        </div>
        <div className="rounded-2xl bg-slate-50 px-4 py-3">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Open Issues</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">
            {gaps ? gaps.missingMetrics + gaps.partialMetrics + gaps.staleMetrics + (summary?.pendingSuggestionCount ?? 0) : "..."}
          </p>
        </div>
      </div>
    </section>
  );
}
