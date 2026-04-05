"use client";

import { useEffect, useMemo, useState } from "react";

type MessageState = { type: "success" | "error"; text: string } | null;

type DomainRow = { id: string; code: string; name: string };

type SummaryPayload = {
  domainCount: number;
  sourceCount: number;
  metricCount: number;
  pendingSuggestionCount: number;
  staleMetricCount: number;
};

type GapItem = {
  metricId: string;
  code: string;
  name: string;
  gapStatus: string;
};

type SourceRow = {
  id: string;
  code: string;
  name: string;
  kind: string;
  shape: string;
  domain: DomainRow | null;
};

type SourceDetail = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  kind: string;
  shape: string;
  adapterKey: string | null;
  domainId?: string | null;
  supportsYearWise: boolean;
  supportsScopeBreakdown: boolean;
  domain: DomainRow | null;
  metricLinks: Array<{
    metricId: string;
    metric: { code: string; name: string };
    resolutionMode: string;
    precedence: number;
  }>;
  snapshots: Array<{
    id: string;
    observedYear: number | null;
    scopeKey: string;
    numberValue: number | null;
    textValue: string | null;
    lastRefreshedAt: string | null;
    entryMode: string | null;
    datasetRows: Array<{
      id: string;
      rowData: Record<string, unknown>;
    }>;
  }>;
  adapters: Array<{ key: string; label: string }>;
};

type MetricRow = {
  id: string;
  code: string;
  name: string;
  shape: string;
  valueType: string;
  domain: DomainRow | null;
};

type MetricDetail = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  valueType: string;
  shape: string;
  domainId?: string | null;
  unitOfMeasure: string | null;
  helpText: string | null;
  usedByBodyCodes: string[];
  computeConfig: { formula?: string } | null;
  domain: DomainRow | null;
  observations: Array<{
    observedYear: number | null;
    scopeKey: string;
    numberValue: number | null;
    textValue: string | null;
    maturity: string;
    coverageStatus: string;
    isStale: boolean;
  }>;
  sourceLinks: Array<{
    sourceId: string;
    precedence: number;
    resolutionMode: string;
    transformConfig: Record<string, unknown> | null;
    source: {
      code: string;
      name: string;
    };
  }>;
};

type SuggestionRow = {
  id: string;
  candidateNumberValue: number | null;
  candidateTextValue: string | null;
  detectedAt: string;
  metricObservation: {
    metric: { code: string; name: string };
    numberValue: number | null;
    textValue: string | null;
  };
  metricSourceLink: { source: { code: string; name: string } } | null;
};

type ImportPreview = {
  rowCount: number;
  columns: string[];
  scopeKey: string;
  existingSnapshot: { id: string; rowCount: number } | null;
};

const inputClassName =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-slate-900";

const textAreaClassName = `${inputClassName} min-h-[7rem]`;

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = (await response.json()) as T & { status?: string; message?: string };
  if (!response.ok || data.status === "error") {
    throw new Error(data.message ?? "Request failed.");
  }
  return data;
}

async function postJson<T>(url: string, body: unknown, method: "POST" | "PATCH" | "PUT" = "POST") {
  return fetchJson<T>(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function fileToBase64(file: File) {
  const buffer = await file.arrayBuffer();
  let binary = "";
  for (const byte of new Uint8Array(buffer)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Not refreshed";
  return new Date(value).toLocaleString();
}

function prettyJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export function InstitutionalDataManager() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<MessageState>(null);
  const [domains, setDomains] = useState<DomainRow[]>([]);
  const [summary, setSummary] = useState<SummaryPayload | null>(null);
  const [gapItems, setGapItems] = useState<GapItem[]>([]);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [metrics, setMetrics] = useState<MetricRow[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestionRow[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [selectedMetricId, setSelectedMetricId] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<SourceDetail | null>(null);
  const [selectedMetric, setSelectedMetric] = useState<MetricDetail | null>(null);
  const [sourceImportFile, setSourceImportFile] = useState<File | null>(null);
  const [sourceImportYear, setSourceImportYear] = useState("");
  const [sourceImportScopeKey, setSourceImportScopeKey] = useState("");
  const [sourceImportReplaceRows, setSourceImportReplaceRows] = useState(true);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);

  const adapterOptions = selectedSource?.adapters ?? [
    { key: "personnel.membership_roster", label: "Personnel Membership Roster" },
    { key: "achievements.verified_registry", label: "Verified Achievement Registry" },
  ];

  const domainOptions = useMemo(
    () => domains.map((domain) => ({ value: domain.id, label: `${domain.code} · ${domain.name}` })),
    [domains],
  );

  async function refreshOverview() {
    const [summaryResponse, gapsResponse] = await Promise.all([
      fetchJson<{ summary: SummaryPayload }>("/api/tenant/accreditation/institutional-data/summary"),
      fetchJson<{ gaps: { items: GapItem[] } }>("/api/tenant/accreditation/institutional-data/gaps"),
    ]);
    setSummary(summaryResponse.summary);
    setGapItems(gapsResponse.gaps.items);
  }

  async function refreshDomains() {
    const response = await fetchJson<{ domains: DomainRow[] }>("/api/tenant/accreditation/institutional-data/domains");
    setDomains(response.domains);
  }

  async function refreshSources(nextSelectedId?: string | null) {
    const response = await fetchJson<{ sources: SourceRow[] }>("/api/tenant/accreditation/institutional-data/sources");
    setSources(response.sources);
    setSelectedSourceId((current) => {
      if (nextSelectedId && response.sources.some((source) => source.id === nextSelectedId)) return nextSelectedId;
      if (current && response.sources.some((source) => source.id === current)) return current;
      return response.sources[0]?.id ?? null;
    });
  }

  async function refreshMetrics(nextSelectedId?: string | null) {
    const response = await fetchJson<{ metrics: MetricRow[] }>("/api/tenant/accreditation/institutional-data/metrics");
    setMetrics(response.metrics);
    setSelectedMetricId((current) => {
      if (nextSelectedId && response.metrics.some((metric) => metric.id === nextSelectedId)) return nextSelectedId;
      if (current && response.metrics.some((metric) => metric.id === current)) return current;
      return response.metrics[0]?.id ?? null;
    });
  }

  async function refreshSuggestions() {
    const response = await fetchJson<{ suggestions: SuggestionRow[] }>("/api/tenant/accreditation/institutional-data/suggestions?status=PENDING");
    setSuggestions(response.suggestions);
  }

  async function loadSourceDetail(sourceId: string) {
    const response = await fetchJson<{ source: SourceDetail }>("/api/tenant/accreditation/institutional-data/sources/" + sourceId);
    setSelectedSource(response.source);
  }

  async function loadMetricDetail(metricId: string) {
    const response = await fetchJson<{ metric: MetricDetail }>("/api/tenant/accreditation/institutional-data/metrics/" + metricId);
    setSelectedMetric(response.metric);
  }

  async function refreshAll() {
    await Promise.all([refreshDomains(), refreshOverview(), refreshSources(), refreshMetrics(), refreshSuggestions()]);
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    refreshAll()
      .catch((error: unknown) => {
        if (active) {
          setMessage({
            type: "error",
            text: error instanceof Error ? error.message : "Failed to load institutional data.",
          });
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedSourceId) {
      setSelectedSource(null);
      return;
    }
    void loadSourceDetail(selectedSourceId).catch((error: unknown) => {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to load source detail." });
    });
  }, [selectedSourceId]);

  useEffect(() => {
    if (!selectedMetricId) {
      setSelectedMetric(null);
      return;
    }
    void loadMetricDetail(selectedMetricId).catch((error: unknown) => {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to load metric detail." });
    });
  }, [selectedMetricId]);

  async function withSaving(task: () => Promise<void>) {
    setSaving(true);
    setMessage(null);
    try {
      await task();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Request failed." });
    } finally {
      setSaving(false);
    }
  }

  async function handleSeedCatalog() {
    await withSaving(async () => {
      await postJson("/api/tenant/accreditation/institutional-data/seed", { includeRecommendedSources: true });
      await refreshAll();
      setMessage({ type: "success", text: "Institutional data catalog seeded." });
    });
  }

  async function handleCreateSource(formData: FormData) {
    await withSaving(async () => {
      const payload = {
        domainId: String(formData.get("domainId") ?? "") || null,
        code: String(formData.get("code") ?? ""),
        name: String(formData.get("name") ?? ""),
        description: String(formData.get("description") ?? "") || null,
        kind: String(formData.get("kind") ?? "MANUAL"),
        shape: String(formData.get("shape") ?? "SCALAR"),
        adapterKey: String(formData.get("adapterKey") ?? "") || null,
        supportsYearWise: formData.get("supportsYearWise") === "on",
        supportsScopeBreakdown: formData.get("supportsScopeBreakdown") === "on",
      };
      const response = await postJson<{ source: SourceRow }>("/api/tenant/accreditation/institutional-data/sources", payload);
      await Promise.all([refreshSources(response.source.id), refreshOverview()]);
      setMessage({ type: "success", text: "Source created." });
    });
  }

  async function handleUpdateSource(formData: FormData) {
    if (!selectedSource) return;
    await withSaving(async () => {
      const payload = {
        domainId: String(formData.get("domainId") ?? "") || null,
        code: String(formData.get("code") ?? ""),
        name: String(formData.get("name") ?? ""),
        description: String(formData.get("description") ?? "") || null,
        kind: String(formData.get("kind") ?? selectedSource.kind),
        shape: String(formData.get("shape") ?? selectedSource.shape),
        adapterKey: String(formData.get("adapterKey") ?? "") || null,
        supportsYearWise: formData.get("supportsYearWise") === "on",
        supportsScopeBreakdown: formData.get("supportsScopeBreakdown") === "on",
      };
      await postJson("/api/tenant/accreditation/institutional-data/sources/" + selectedSource.id, payload, "PATCH");
      await Promise.all([refreshSources(selectedSource.id), loadSourceDetail(selectedSource.id)]);
      setMessage({ type: "success", text: "Source updated." });
    });
  }

  async function handleRefreshSource() {
    if (!selectedSource) return;
    await withSaving(async () => {
      await postJson("/api/tenant/accreditation/institutional-data/sources/" + selectedSource.id + "/refresh", {});
      await Promise.all([
        refreshOverview(),
        refreshSuggestions(),
        refreshSources(selectedSource.id),
        loadSourceDetail(selectedSource.id),
      ]);
      if (selectedMetricId) {
        await Promise.all([refreshMetrics(selectedMetricId), loadMetricDetail(selectedMetricId)]);
      }
      setMessage({ type: "success", text: "Source refreshed from adapter." });
    });
  }

  async function handleManualSnapshot(formData: FormData) {
    if (!selectedSource) return;
    await withSaving(async () => {
      const observedYearText = String(formData.get("observedYear") ?? "").trim();
      const numberValueText = String(formData.get("numberValue") ?? "").trim();
      await postJson(
        "/api/tenant/accreditation/institutional-data/sources/" + selectedSource.id + "/snapshots",
        {
          observedYear: observedYearText ? Number(observedYearText) : null,
          scopeKey: String(formData.get("scopeKey") ?? "") || null,
          numberValue: numberValueText ? Number(numberValueText) : null,
          textValue: String(formData.get("textValue") ?? "") || null,
        },
        "PUT",
      );
      await Promise.all([
        refreshOverview(),
        refreshSources(selectedSource.id),
        loadSourceDetail(selectedSource.id),
      ]);
      if (selectedMetricId) {
        await Promise.all([refreshMetrics(selectedMetricId), loadMetricDetail(selectedMetricId)]);
      }
      setMessage({ type: "success", text: "Manual snapshot saved." });
    });
  }

  async function handlePreviewImport() {
    if (!selectedSource || !sourceImportFile) return;
    await withSaving(async () => {
      const fileContentBase64 = await fileToBase64(sourceImportFile);
      const observedYear = sourceImportYear.trim() ? Number(sourceImportYear.trim()) : null;
      const response = await postJson<{ preview: ImportPreview }>(
        "/api/tenant/accreditation/institutional-data/sources/" + selectedSource.id + "/dataset/import-preview",
        {
          fileName: sourceImportFile.name,
          fileContentBase64,
          observedYear,
          scopeKey: sourceImportScopeKey || null,
          replaceRows: sourceImportReplaceRows,
        },
      );
      setImportPreview(response.preview);
      setMessage({ type: "success", text: "Import preview ready." });
    });
  }

  async function handleApplyImport() {
    if (!selectedSource || !sourceImportFile) return;
    await withSaving(async () => {
      const fileContentBase64 = await fileToBase64(sourceImportFile);
      const observedYear = sourceImportYear.trim() ? Number(sourceImportYear.trim()) : null;
      await postJson(
        "/api/tenant/accreditation/institutional-data/sources/" + selectedSource.id + "/dataset/import",
        {
          fileName: sourceImportFile.name,
          fileContentBase64,
          observedYear,
          scopeKey: sourceImportScopeKey || null,
          replaceRows: sourceImportReplaceRows,
        },
      );
      setImportPreview(null);
      await Promise.all([
        refreshOverview(),
        refreshSuggestions(),
        refreshSources(selectedSource.id),
        loadSourceDetail(selectedSource.id),
      ]);
      if (selectedMetricId) {
        await Promise.all([refreshMetrics(selectedMetricId), loadMetricDetail(selectedMetricId)]);
      }
      setMessage({ type: "success", text: "Dataset imported." });
    });
  }

  async function handleCreateMetric(formData: FormData) {
    await withSaving(async () => {
      const shape = String(formData.get("shape") ?? "SCALAR");
      const formula = String(formData.get("formula") ?? "").trim();
      const payload = {
        domainId: String(formData.get("domainId") ?? "") || null,
        code: String(formData.get("code") ?? ""),
        name: String(formData.get("name") ?? ""),
        description: String(formData.get("description") ?? "") || null,
        valueType: String(formData.get("valueType") ?? "NUMBER"),
        shape,
        unitOfMeasure: String(formData.get("unitOfMeasure") ?? "") || null,
        helpText: String(formData.get("helpText") ?? "") || null,
        usedByBodyCodes: String(formData.get("usedByBodyCodes") ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        computeConfig: shape === "COMPUTED" && formula ? { formula } : null,
      };
      const response = await postJson<{ metric: MetricRow }>("/api/tenant/accreditation/institutional-data/metrics", payload);
      await Promise.all([refreshMetrics(response.metric.id), refreshOverview()]);
      setMessage({ type: "success", text: "Metric created." });
    });
  }

  async function handleUpdateMetric(formData: FormData) {
    if (!selectedMetric) return;
    await withSaving(async () => {
      const shape = String(formData.get("shape") ?? selectedMetric.shape);
      const formula = String(formData.get("formula") ?? "").trim();
      const payload = {
        domainId: String(formData.get("domainId") ?? "") || null,
        code: String(formData.get("code") ?? ""),
        name: String(formData.get("name") ?? ""),
        description: String(formData.get("description") ?? "") || null,
        valueType: String(formData.get("valueType") ?? selectedMetric.valueType),
        shape,
        unitOfMeasure: String(formData.get("unitOfMeasure") ?? "") || null,
        helpText: String(formData.get("helpText") ?? "") || null,
        usedByBodyCodes: String(formData.get("usedByBodyCodes") ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        computeConfig: shape === "COMPUTED" && formula ? { formula } : null,
      };
      await postJson("/api/tenant/accreditation/institutional-data/metrics/" + selectedMetric.id, payload, "PATCH");
      await Promise.all([refreshMetrics(selectedMetric.id), loadMetricDetail(selectedMetric.id)]);
      setMessage({ type: "success", text: "Metric updated." });
    });
  }

  async function handleAddMetricLink(formData: FormData) {
    if (!selectedMetric) return;
    await withSaving(async () => {
      const resolutionMode = String(formData.get("resolutionMode") ?? "DIRECT");
      const transformConfigText = String(formData.get("transformConfig") ?? "").trim();
      await postJson(
        "/api/tenant/accreditation/institutional-data/metrics/" + selectedMetric.id + "/links",
        {
          links: [
            {
              sourceId: String(formData.get("sourceId") ?? ""),
              precedence: Number(formData.get("precedence") ?? 100),
              resolutionMode,
              transformConfig: transformConfigText ? JSON.parse(transformConfigText) : { mode: resolutionMode },
            },
          ],
        },
        "PUT",
      );
      await Promise.all([refreshMetrics(selectedMetric.id), loadMetricDetail(selectedMetric.id)]);
      setMessage({ type: "success", text: "Metric link saved." });
    });
  }

  async function handleResolveSuggestion(id: string, action: "ACCEPT" | "REJECT") {
    await withSaving(async () => {
      await postJson("/api/tenant/accreditation/institutional-data/suggestions/" + id + "/resolve", { action });
      await Promise.all([refreshOverview(), refreshSuggestions()]);
      if (selectedSourceId) {
        await Promise.all([refreshSources(selectedSourceId), loadSourceDetail(selectedSourceId)]);
      }
      if (selectedMetricId) {
        await Promise.all([refreshMetrics(selectedMetricId), loadMetricDetail(selectedMetricId)]);
      }
      setMessage({ type: "success", text: `Suggestion ${action === "ACCEPT" ? "accepted" : "rejected"}.` });
    });
  }

  return (
    <div className="space-y-6">
      {message ? (
        <div
          className={`rounded-2xl px-4 py-3 text-sm ${
            message.type === "success"
              ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {message.text}
        </div>
      ) : null}

      <section className="rounded-[1.75rem] border border-slate-200/80 bg-white/85 p-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Overview</p>
            <h2 className="text-2xl font-semibold text-slate-900">Institutional Data Bank</h2>
            <p className="text-sm text-slate-500">
              Seed recommended sources, monitor gaps, and keep accreditation data reusable.
            </p>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSeedCatalog()}
            className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:bg-slate-300"
          >
            Seed Recommended Catalog
          </button>
        </div>

        <div className="grid gap-3 md:grid-cols-5">
          <div className="rounded-2xl bg-slate-50 px-4 py-3"><p className="text-xs uppercase tracking-[0.18em] text-slate-400">Domains</p><p className="mt-1 text-xl font-semibold text-slate-900">{summary?.domainCount ?? (loading ? "..." : 0)}</p></div>
          <div className="rounded-2xl bg-slate-50 px-4 py-3"><p className="text-xs uppercase tracking-[0.18em] text-slate-400">Sources</p><p className="mt-1 text-xl font-semibold text-slate-900">{summary?.sourceCount ?? (loading ? "..." : 0)}</p></div>
          <div className="rounded-2xl bg-slate-50 px-4 py-3"><p className="text-xs uppercase tracking-[0.18em] text-slate-400">Metrics</p><p className="mt-1 text-xl font-semibold text-slate-900">{summary?.metricCount ?? (loading ? "..." : 0)}</p></div>
          <div className="rounded-2xl bg-slate-50 px-4 py-3"><p className="text-xs uppercase tracking-[0.18em] text-slate-400">Pending Suggestions</p><p className="mt-1 text-xl font-semibold text-slate-900">{summary?.pendingSuggestionCount ?? (loading ? "..." : 0)}</p></div>
          <div className="rounded-2xl bg-slate-50 px-4 py-3"><p className="text-xs uppercase tracking-[0.18em] text-slate-400">Stale Metrics</p><p className="mt-1 text-xl font-semibold text-slate-900">{summary?.staleMetricCount ?? (loading ? "..." : 0)}</p></div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {gapItems.slice(0, 12).map((item) => (
            <span key={item.metricId} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
              {item.code} · {item.gapStatus}
            </span>
          ))}
          {!loading && gapItems.length === 0 ? <span className="text-sm text-slate-500">No current gaps.</span> : null}
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[22rem,1fr]">
        <div className="rounded-[1.75rem] border border-slate-200/80 bg-white/85 p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Sources</h3>
          <div className="space-y-3">
            {sources.map((source) => (
              <button key={source.id} type="button" onClick={() => setSelectedSourceId(source.id)} className={`w-full rounded-2xl border px-4 py-3 text-left ${selectedSourceId === source.id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-slate-50 text-slate-700"}`}>
                <p className="text-sm font-semibold">{source.name}</p>
                <p className="mt-1 text-xs opacity-80">{source.code} · {source.kind} · {source.shape}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <section className="rounded-[1.75rem] border border-slate-200/80 bg-white/85 p-6">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Create Source</h3>
            <form className="grid gap-3 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void handleCreateSource(new FormData(event.currentTarget)); }}>
              <select className={inputClassName} name="domainId" defaultValue=""><option value="">No domain</option>{domainOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
              <select className={inputClassName} name="kind" defaultValue="MANUAL"><option value="MANUAL">Manual</option><option value="CSV_IMPORT">CSV Import</option><option value="INTERNAL_ADAPTER">Internal Adapter</option><option value="DOCUMENT">Document</option><option value="NARRATIVE">Narrative</option></select>
              <input className={inputClassName} name="code" placeholder="SOURCE_CODE" required />
              <input className={inputClassName} name="name" placeholder="Source name" required />
              <select className={inputClassName} name="shape" defaultValue="DATASET"><option value="SCALAR">Scalar</option><option value="DATASET">Dataset</option><option value="NARRATIVE">Narrative</option><option value="DOCUMENT_REF">Document Ref</option></select>
              <select className={inputClassName} name="adapterKey" defaultValue=""><option value="">No adapter</option>{adapterOptions.map((adapter) => <option key={adapter.key} value={adapter.key}>{adapter.label}</option>)}</select>
              <input className={inputClassName} name="description" placeholder="Description" />
              <div className="flex items-center gap-4 rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-600"><label className="flex items-center gap-2"><input type="checkbox" name="supportsYearWise" defaultChecked />Year-wise</label><label className="flex items-center gap-2"><input type="checkbox" name="supportsScopeBreakdown" />Scope breakdown</label></div>
              <button type="submit" disabled={saving} className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white disabled:bg-slate-300">Create Source</button>
            </form>
          </section>

          <section className="rounded-[1.75rem] border border-slate-200/80 bg-white/85 p-6">
            {!selectedSource ? (
              <p className="text-sm text-slate-500">Select a source to edit it, refresh adapters, or import data.</p>
            ) : (
              <div className="space-y-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-400">{selectedSource.code}</p>
                    <h3 className="text-xl font-semibold text-slate-900">{selectedSource.name}</h3>
                    <p className="text-sm text-slate-500">{selectedSource.kind} · {selectedSource.shape} · {selectedSource.domain?.name ?? "No domain"}</p>
                  </div>
                  {selectedSource.kind === "INTERNAL_ADAPTER" ? <button type="button" disabled={saving} onClick={() => void handleRefreshSource()} className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:bg-slate-300">Refresh Adapter</button> : null}
                </div>

                <form className="grid gap-3 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void handleUpdateSource(new FormData(event.currentTarget)); }}>
                  <select className={inputClassName} name="domainId" defaultValue={selectedSource.domainId ?? ""}><option value="">No domain</option>{domainOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
                  <select className={inputClassName} name="kind" defaultValue={selectedSource.kind}><option value="MANUAL">Manual</option><option value="CSV_IMPORT">CSV Import</option><option value="INTERNAL_ADAPTER">Internal Adapter</option><option value="DOCUMENT">Document</option><option value="NARRATIVE">Narrative</option></select>
                  <input className={inputClassName} name="code" defaultValue={selectedSource.code} required />
                  <input className={inputClassName} name="name" defaultValue={selectedSource.name} required />
                  <select className={inputClassName} name="shape" defaultValue={selectedSource.shape}><option value="SCALAR">Scalar</option><option value="DATASET">Dataset</option><option value="NARRATIVE">Narrative</option><option value="DOCUMENT_REF">Document Ref</option></select>
                  <select className={inputClassName} name="adapterKey" defaultValue={selectedSource.adapterKey ?? ""}><option value="">No adapter</option>{adapterOptions.map((adapter) => <option key={adapter.key} value={adapter.key}>{adapter.label}</option>)}</select>
                  <input className={inputClassName} name="description" defaultValue={selectedSource.description ?? ""} placeholder="Description" />
                  <div className="flex items-center gap-4 rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-600"><label className="flex items-center gap-2"><input type="checkbox" name="supportsYearWise" defaultChecked={selectedSource.supportsYearWise} />Year-wise</label><label className="flex items-center gap-2"><input type="checkbox" name="supportsScopeBreakdown" defaultChecked={selectedSource.supportsScopeBreakdown} />Scope breakdown</label></div>
                  <button type="submit" disabled={saving} className="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 disabled:bg-slate-100">Update Source</button>
                </form>

                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 p-4">
                    <h4 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Manual Snapshot</h4>
                    <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void handleManualSnapshot(new FormData(event.currentTarget)); }}>
                      <input className={inputClassName} name="observedYear" type="number" placeholder="Observed year" />
                      <input className={inputClassName} name="scopeKey" placeholder="Scope key (optional)" />
                      <input className={inputClassName} name="numberValue" type="number" step="any" placeholder="Number value" />
                      <textarea className={textAreaClassName} name="textValue" placeholder="Text value" />
                      <button type="submit" disabled={saving} className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white disabled:bg-slate-300">Save Snapshot</button>
                    </form>
                  </div>
                  <div className="rounded-2xl border border-slate-200 p-4">
                    <h4 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Dataset Import</h4>
                    <div className="space-y-3">
                      <input className={inputClassName} type="file" accept=".csv,.xlsx,.xls" onChange={(event) => setSourceImportFile(event.target.files?.[0] ?? null)} />
                      <input className={inputClassName} type="number" placeholder="Observed year" value={sourceImportYear} onChange={(event) => setSourceImportYear(event.target.value)} />
                      <input className={inputClassName} placeholder="Scope key (optional)" value={sourceImportScopeKey} onChange={(event) => setSourceImportScopeKey(event.target.value)} />
                      <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={sourceImportReplaceRows} onChange={(event) => setSourceImportReplaceRows(event.target.checked)} />Replace existing rows</label>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" disabled={saving || !sourceImportFile} onClick={() => void handlePreviewImport()} className="rounded-2xl border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:bg-slate-100">Preview Import</button>
                        <button type="button" disabled={saving || !sourceImportFile} onClick={() => void handleApplyImport()} className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:bg-slate-300">Apply Import</button>
                      </div>
                      {importPreview ? <div className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-700"><p className="font-medium">Rows: {importPreview.rowCount}</p><p className="mt-1">Columns: {importPreview.columns.join(", ")}</p><p className="mt-1">Scope: {importPreview.scopeKey}</p>{importPreview.existingSnapshot ? <p className="mt-1 text-amber-700">Existing snapshot has {importPreview.existingSnapshot.rowCount} rows.</p> : null}</div> : null}
                    </div>
                  </div>
                </div>

                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 p-4">
                    <h4 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Linked Metrics</h4>
                    <div className="space-y-2">{selectedSource.metricLinks.map((link) => <div key={`${link.metricId}-${link.resolutionMode}`} className="rounded-xl bg-slate-50 px-3 py-2"><p className="text-sm font-medium text-slate-900">{link.metric.code} · {link.metric.name}</p><p className="text-xs text-slate-500">{link.resolutionMode} · precedence {link.precedence}</p></div>)}{selectedSource.metricLinks.length === 0 ? <p className="text-sm text-slate-500">No metrics linked yet.</p> : null}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 p-4">
                    <h4 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Snapshot History</h4>
                    <div className="space-y-2">{selectedSource.snapshots.slice(0, 8).map((snapshot) => <div key={snapshot.id} className="rounded-xl bg-slate-50 px-3 py-2"><p className="text-sm font-medium text-slate-900">{snapshot.scopeKey} · {snapshot.observedYear ?? "Current"}</p><p className="text-xs text-slate-500">{snapshot.entryMode ?? "MANUAL"} · {formatDateTime(snapshot.lastRefreshedAt)}</p>{snapshot.datasetRows[0] ? <pre className="mt-2 overflow-auto rounded-lg bg-white p-2 text-[11px] text-slate-600">{prettyJson(snapshot.datasetRows[0].rowData)}</pre> : null}</div>)}{selectedSource.snapshots.length === 0 ? <p className="text-sm text-slate-500">No snapshots yet.</p> : null}</div>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[22rem,1fr]">
        <div className="rounded-[1.75rem] border border-slate-200/80 bg-white/85 p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Metrics</h3>
          <div className="space-y-3">{metrics.map((metric) => <button key={metric.id} type="button" onClick={() => setSelectedMetricId(metric.id)} className={`w-full rounded-2xl border px-4 py-3 text-left ${selectedMetricId === metric.id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-slate-50 text-slate-700"}`}><p className="text-sm font-semibold">{metric.name}</p><p className="mt-1 text-xs opacity-80">{metric.code} · {metric.shape} · {metric.valueType}</p></button>)}</div>
        </div>

        <div className="space-y-6">
          <section className="rounded-[1.75rem] border border-slate-200/80 bg-white/85 p-6">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Create Metric</h3>
            <form className="grid gap-3 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void handleCreateMetric(new FormData(event.currentTarget)); }}>
              <select className={inputClassName} name="domainId" defaultValue=""><option value="">No domain</option>{domainOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
              <select className={inputClassName} name="valueType" defaultValue="NUMBER"><option value="NUMBER">Number</option><option value="TEXT">Text</option><option value="JSON">JSON</option></select>
              <input className={inputClassName} name="code" placeholder="METRIC_CODE" required />
              <input className={inputClassName} name="name" placeholder="Metric name" required />
              <select className={inputClassName} name="shape" defaultValue="SCALAR"><option value="SCALAR">Scalar</option><option value="DATASET">Dataset</option><option value="COMPUTED">Computed</option><option value="NARRATIVE">Narrative</option><option value="DOCUMENT_REF">Document Ref</option></select>
              <input className={inputClassName} name="unitOfMeasure" placeholder="Unit of measure" />
              <input className={inputClassName} name="usedByBodyCodes" placeholder="Bodies (comma separated)" />
              <input className={inputClassName} name="description" placeholder="Description" />
              <input className={inputClassName} name="helpText" placeholder="Help text" />
              <textarea className={textAreaClassName} name="formula" placeholder="Computed formula" />
              <button type="submit" disabled={saving} className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white disabled:bg-slate-300">Create Metric</button>
            </form>
          </section>

          <section className="rounded-[1.75rem] border border-slate-200/80 bg-white/85 p-6">
            {!selectedMetric ? (
              <p className="text-sm text-slate-500">Select a metric to edit it, link sources, and inspect observations.</p>
            ) : (
              <div className="space-y-6">
                <div><p className="text-xs uppercase tracking-[0.18em] text-slate-400">{selectedMetric.code}</p><h3 className="text-xl font-semibold text-slate-900">{selectedMetric.name}</h3><p className="text-sm text-slate-500">{selectedMetric.shape} · {selectedMetric.valueType}</p></div>
                <form className="grid gap-3 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void handleUpdateMetric(new FormData(event.currentTarget)); }}>
                  <select className={inputClassName} name="domainId" defaultValue={selectedMetric.domainId ?? ""}><option value="">No domain</option>{domainOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
                  <select className={inputClassName} name="valueType" defaultValue={selectedMetric.valueType}><option value="NUMBER">Number</option><option value="TEXT">Text</option><option value="JSON">JSON</option></select>
                  <input className={inputClassName} name="code" defaultValue={selectedMetric.code} required />
                  <input className={inputClassName} name="name" defaultValue={selectedMetric.name} required />
                  <select className={inputClassName} name="shape" defaultValue={selectedMetric.shape}><option value="SCALAR">Scalar</option><option value="DATASET">Dataset</option><option value="COMPUTED">Computed</option><option value="NARRATIVE">Narrative</option><option value="DOCUMENT_REF">Document Ref</option></select>
                  <input className={inputClassName} name="unitOfMeasure" defaultValue={selectedMetric.unitOfMeasure ?? ""} placeholder="Unit of measure" />
                  <input className={inputClassName} name="usedByBodyCodes" defaultValue={selectedMetric.usedByBodyCodes.join(", ")} placeholder="Bodies (comma separated)" />
                  <input className={inputClassName} name="description" defaultValue={selectedMetric.description ?? ""} placeholder="Description" />
                  <input className={inputClassName} name="helpText" defaultValue={selectedMetric.helpText ?? ""} placeholder="Help text" />
                  <textarea className={textAreaClassName} name="formula" defaultValue={selectedMetric.computeConfig?.formula ?? ""} placeholder="Computed formula" />
                  <button type="submit" disabled={saving} className="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 disabled:bg-slate-100">Update Metric</button>
                </form>

                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 p-4">
                    <h4 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Source Links</h4>
                    <div className="space-y-2">{selectedMetric.sourceLinks.map((link) => <div key={`${link.sourceId}-${link.resolutionMode}`} className="rounded-xl bg-slate-50 px-3 py-2"><p className="text-sm font-medium text-slate-900">{link.source.code} · {link.source.name}</p><p className="text-xs text-slate-500">{link.resolutionMode} · precedence {link.precedence}</p>{link.transformConfig ? <pre className="mt-2 overflow-auto rounded-lg bg-white p-2 text-[11px] text-slate-600">{prettyJson(link.transformConfig)}</pre> : null}</div>)}{selectedMetric.sourceLinks.length === 0 ? <p className="text-sm text-slate-500">No source links yet.</p> : null}</div>
                    <form className="mt-4 space-y-3" onSubmit={(event) => { event.preventDefault(); void handleAddMetricLink(new FormData(event.currentTarget)); }}>
                      <select className={inputClassName} name="sourceId" defaultValue={selectedSourceId ?? sources[0]?.id ?? ""}>{sources.map((source) => <option key={source.id} value={source.id}>{source.code} · {source.name}</option>)}</select>
                      <select className={inputClassName} name="resolutionMode" defaultValue="DIRECT"><option value="DIRECT">DIRECT</option><option value="PICK_FIELD">PICK_FIELD</option><option value="COUNT_ROWS">COUNT_ROWS</option><option value="SUM_COLUMN">SUM_COLUMN</option><option value="AVG_COLUMN">AVG_COLUMN</option><option value="MAX_COLUMN">MAX_COLUMN</option><option value="MIN_COLUMN">MIN_COLUMN</option><option value="FIRST_NON_NULL">FIRST_NON_NULL</option><option value="CUSTOM_FORMULA">CUSTOM_FORMULA</option></select>
                      <input className={inputClassName} name="precedence" type="number" defaultValue="100" />
                      <textarea className={textAreaClassName} name="transformConfig" defaultValue='{"mode":"DIRECT"}' placeholder='{"mode":"COUNT_ROWS"}' />
                      <button type="submit" disabled={saving} className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white disabled:bg-slate-300">Save Link</button>
                    </form>
                  </div>
                  <div className="rounded-2xl border border-slate-200 p-4">
                    <h4 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Latest Observations</h4>
                    <div className="space-y-2">{selectedMetric.observations.map((observation) => <div key={`${observation.scopeKey}-${observation.observedYear ?? "CURRENT"}`} className="rounded-xl bg-slate-50 px-3 py-2"><p className="text-sm font-medium text-slate-900">{observation.scopeKey} · {observation.observedYear ?? "Current"}</p><p className="text-xs text-slate-500">{observation.maturity} · {observation.coverageStatus} · {observation.isStale ? "STALE" : "FRESH"}</p><p className="mt-1 text-sm text-slate-700">{observation.numberValue ?? observation.textValue ?? "No value"}</p></div>)}{selectedMetric.observations.length === 0 ? <p className="text-sm text-slate-500">No observations yet.</p> : null}</div>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      </section>

      <section className="rounded-[1.75rem] border border-slate-200/80 bg-white/85 p-6">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Refresh Suggestions</h3>
        <div className="space-y-3">
          {suggestions.map((suggestion) => (
            <div key={suggestion.id} className="rounded-2xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{suggestion.metricObservation.metric.code} · {suggestion.metricObservation.metric.name}</p>
                  <p className="text-xs text-slate-500">Source {suggestion.metricSourceLink?.source.code ?? "Unknown"} · {formatDateTime(suggestion.detectedAt)}</p>
                  <p className="mt-2 text-sm text-slate-700">Current: {suggestion.metricObservation.numberValue ?? suggestion.metricObservation.textValue ?? "No value"}</p>
                  <p className="text-sm text-slate-700">Candidate: {suggestion.candidateNumberValue ?? suggestion.candidateTextValue ?? "No value"}</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" disabled={saving} onClick={() => void handleResolveSuggestion(suggestion.id, "ACCEPT")} className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:bg-slate-300">Accept</button>
                  <button type="button" disabled={saving} onClick={() => void handleResolveSuggestion(suggestion.id, "REJECT")} className="rounded-2xl border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:bg-slate-100">Reject</button>
                </div>
              </div>
            </div>
          ))}
          {!loading && suggestions.length === 0 ? <p className="text-sm text-slate-500">No pending refresh suggestions.</p> : null}
        </div>
      </section>
    </div>
  );
}
