"use client";

import { useEffect, useMemo, useState } from "react";

type EntryOption = {
  id: string;
  blockCode: string;
  blockTitle: string;
};

type InstitutionalMetricSource = {
  id: string;
  code: string;
  name: string;
  valueType: string;
  unitOfMeasure: string | null;
  domain: { code: string; name: string } | null;
  latestObservation: {
    observedYear: number | null;
    scopeKey: string;
    maturity: string;
    coverageStatus: string;
    isStale: boolean;
  } | null;
  sourceLinkCount: number;
};

type ProjectionSourcesPayload = {
  institutionalDataMetrics?: InstitutionalMetricSource[];
  activeProjections: Array<{
    recipeId: string;
    sourceKind: string;
    storageMode: string;
    targetPath: string;
    sourceMetric: { code: string; name: string } | null;
  }>;
};

type ProjectionPreview = {
  matches: Array<{
    targetYear: number;
    materializedNumberValue: number | null;
    materializedTextValue: string | null;
  }>;
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = (await response.json()) as T & { status?: string; message?: string };
  if (!response.ok || data.status === "error") {
    throw new Error(data.message ?? "Request failed.");
  }
  return data;
}

export function WorkspaceProjectionStudio({
  entries,
}: {
  entries: EntryOption[];
}) {
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(entries[0]?.id ?? null);
  const [selectedMetricId, setSelectedMetricId] = useState<string | null>(null);
  const [targetYear, setTargetYear] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sources, setSources] = useState<ProjectionSourcesPayload | null>(null);
  const [preview, setPreview] = useState<ProjectionPreview | null>(null);

  const selectedMetric = useMemo(
    () => sources?.institutionalDataMetrics?.find((metric) => metric.id === selectedMetricId) ?? null,
    [selectedMetricId, sources],
  );

  useEffect(() => {
    setSelectedEntryId(entries[0]?.id ?? null);
  }, [entries]);

  useEffect(() => {
    if (!selectedEntryId) {
      setSources(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchJson<{ sources: ProjectionSourcesPayload }>(
      `/api/tenant/accreditation/entries/${selectedEntryId}/projections/sources`,
    )
      .then((response) => {
        if (cancelled) return;
        setSources(response.sources);
        const firstMetric = response.sources.institutionalDataMetrics?.[0] ?? null;
        setSelectedMetricId((current) =>
          current && response.sources.institutionalDataMetrics?.some((metric) => metric.id === current)
            ? current
            : firstMetric?.id ?? null,
        );
      })
      .catch((fetchError: unknown) => {
        if (cancelled) return;
        setError(fetchError instanceof Error ? fetchError.message : "Failed to load projection sources.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedEntryId]);

  useEffect(() => {
    setPreview(null);
    setMessage(null);
    if (selectedMetric?.latestObservation?.observedYear) {
      setTargetYear(String(selectedMetric.latestObservation.observedYear));
    }
  }, [selectedMetricId, selectedMetric?.latestObservation?.observedYear]);

  async function runProjection(mode: "preview" | "apply") {
    if (!selectedEntryId || !selectedMetricId) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const body = {
        sourceKind: "INSTITUTIONAL_DATA_BANK",
        sourceMetricId: selectedMetricId,
        targetYear: targetYear.trim() ? Number(targetYear.trim()) : undefined,
        filters: targetYear.trim() ? { years: [Number(targetYear.trim())] } : undefined,
        targetPath: "actualValue",
        storageMode: "COPY",
      };
      const response = await fetchJson<{ preview?: ProjectionPreview; appliedCount?: number }>(
        `/api/tenant/accreditation/entries/${selectedEntryId}/projections/${mode}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (mode === "preview" && response.preview) {
        setPreview(response.preview);
        setMessage("Projection preview ready.");
      } else {
        setPreview(null);
        setMessage(`Projection applied${response.appliedCount ? ` to ${response.appliedCount} year(s)` : ""}.`);
      }
    } catch (projectionError) {
      setError(projectionError instanceof Error ? projectionError.message : "Projection failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-[1.75rem] border border-slate-200/80 bg-white/85 p-6">
      <div className="mb-4">
        <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Projection Studio</p>
        <h4 className="text-lg font-semibold text-slate-900">Institutional Data to Block Projection</h4>
        <p className="text-sm text-slate-500">
          Pick a block entry, preview an institutional-data metric, and project it into the workspace.
        </p>
      </div>

      {error ? <p className="mb-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
      {message ? <p className="mb-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</p> : null}

      <div className="grid gap-3 md:grid-cols-4">
        <select className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700" value={selectedEntryId ?? ""} onChange={(event) => setSelectedEntryId(event.target.value || null)}>
          {entries.map((entry) => <option key={entry.id} value={entry.id}>{entry.blockCode} · {entry.blockTitle}</option>)}
        </select>
        <select className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700" value={selectedMetricId ?? ""} onChange={(event) => setSelectedMetricId(event.target.value || null)}>
          <option value="">Select institutional metric</option>
          {(sources?.institutionalDataMetrics ?? []).map((metric) => (
            <option key={metric.id} value={metric.id}>{metric.code} · {metric.name}</option>
          ))}
        </select>
        <input className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700" type="number" placeholder="Target year" value={targetYear} onChange={(event) => setTargetYear(event.target.value)} />
        <div className="flex gap-2">
          <button type="button" disabled={loading || !selectedMetricId} onClick={() => void runProjection("preview")} className="rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-700 disabled:bg-slate-100">Preview</button>
          <button type="button" disabled={loading || !selectedMetricId} onClick={() => void runProjection("apply")} className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white disabled:bg-slate-300">Apply</button>
        </div>
      </div>

      {selectedMetric ? (
        <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
          <p className="font-medium text-slate-900">{selectedMetric.code} · {selectedMetric.name}</p>
          <p className="mt-1 text-xs text-slate-500">
            {selectedMetric.domain?.name ?? "No domain"} · {selectedMetric.valueType}
            {selectedMetric.unitOfMeasure ? ` · ${selectedMetric.unitOfMeasure}` : ""}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {selectedMetric.latestObservation
              ? `${selectedMetric.latestObservation.coverageStatus} · ${selectedMetric.latestObservation.maturity} · ${selectedMetric.latestObservation.isStale ? "STALE" : "FRESH"}`
              : "No latest observation"}
          </p>
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 p-4">
          <h5 className="mb-2 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Preview</h5>
          {preview?.matches?.length ? (
            <div className="space-y-2">
              {preview.matches.map((match) => (
                <div key={`${match.targetYear}-${match.materializedNumberValue ?? match.materializedTextValue ?? "empty"}`} className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  Year {match.targetYear}: {match.materializedNumberValue ?? match.materializedTextValue ?? "No value"}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">Run preview to inspect the projected value.</p>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 p-4">
          <h5 className="mb-2 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Active Institutional Projections</h5>
          <div className="space-y-2">
            {(sources?.activeProjections ?? [])
              .filter((projection) => projection.sourceKind === "INSTITUTIONAL_DATA_BANK")
              .map((projection) => (
                <div key={projection.recipeId} className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  {projection.sourceMetric?.code ?? "Metric"} · {projection.storageMode} · {projection.targetPath}
                </div>
              ))}
            {(sources?.activeProjections ?? []).filter((projection) => projection.sourceKind === "INSTITUTIONAL_DATA_BANK").length === 0 ? (
              <p className="text-sm text-slate-500">No active institutional projections for this entry.</p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
