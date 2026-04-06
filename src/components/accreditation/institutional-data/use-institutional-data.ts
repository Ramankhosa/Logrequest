"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export type MessageState = { type: "success" | "error"; text: string } | null;

export type DomainRow = { id: string; code: string; name: string };

export type SummaryPayload = {
  domainCount: number;
  sourceCount: number;
  metricCount: number;
  pendingSuggestionCount: number;
  staleMetricCount: number;
};

export type GapItem = {
  metricId: string;
  code: string;
  name: string;
  gapStatus: string;
};

export type SourceRow = {
  id: string;
  code: string;
  name: string;
  kind: string;
  shape: string;
  domain: DomainRow | null;
};

export type SourceDetail = {
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

export type MetricRow = {
  id: string;
  code: string;
  name: string;
  shape: string;
  valueType: string;
  domain: DomainRow | null;
};

export type MetricDetail = {
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
    source: { code: string; name: string };
  }>;
};

export type SuggestionRow = {
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

export type ImportPreview = {
  rowCount: number;
  columns: string[];
  scopeKey: string;
  existingSnapshot: { id: string; rowCount: number } | null;
};

export type DomainOption = { value: string; label: string };

// ── HTTP helpers ──

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

// ── Base URL ──

const BASE = "/api/tenant/accreditation/institutional-data";

// ── Hook ──

export function useInstitutionalData() {
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
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);

  const domainOptions: DomainOption[] = useMemo(
    () => domains.map((d) => ({ value: d.id, label: `${d.code} · ${d.name}` })),
    [domains],
  );

  const adapterOptions = selectedSource?.adapters ?? [
    { key: "personnel.membership_roster", label: "Personnel Membership Roster" },
    { key: "achievements.verified_registry", label: "Verified Achievement Registry" },
  ];

  // ── Data fetchers ──

  const refreshOverview = useCallback(async () => {
    const [s, g] = await Promise.all([
      fetchJson<{ summary: SummaryPayload }>(`${BASE}/summary`),
      fetchJson<{ gaps: { items: GapItem[] } }>(`${BASE}/gaps`),
    ]);
    setSummary(s.summary);
    setGapItems(g.gaps.items);
  }, []);

  const refreshDomains = useCallback(async () => {
    const r = await fetchJson<{ domains: DomainRow[] }>(`${BASE}/domains`);
    setDomains(r.domains);
  }, []);

  const refreshSources = useCallback(async (nextSelectedId?: string | null) => {
    const r = await fetchJson<{ sources: SourceRow[] }>(`${BASE}/sources`);
    setSources(r.sources);
    setSelectedSourceId((current) => {
      if (nextSelectedId && r.sources.some((s) => s.id === nextSelectedId)) return nextSelectedId;
      if (current && r.sources.some((s) => s.id === current)) return current;
      return r.sources[0]?.id ?? null;
    });
  }, []);

  const refreshMetrics = useCallback(async (nextSelectedId?: string | null) => {
    const r = await fetchJson<{ metrics: MetricRow[] }>(`${BASE}/metrics`);
    setMetrics(r.metrics);
    setSelectedMetricId((current) => {
      if (nextSelectedId && r.metrics.some((m) => m.id === nextSelectedId)) return nextSelectedId;
      if (current && r.metrics.some((m) => m.id === current)) return current;
      return r.metrics[0]?.id ?? null;
    });
  }, []);

  const refreshSuggestions = useCallback(async () => {
    const r = await fetchJson<{ suggestions: SuggestionRow[] }>(`${BASE}/suggestions?status=PENDING`);
    setSuggestions(r.suggestions);
  }, []);

  const loadSourceDetail = useCallback(async (sourceId: string) => {
    const r = await fetchJson<{ source: SourceDetail }>(`${BASE}/sources/${sourceId}`);
    setSelectedSource(r.source);
  }, []);

  const loadMetricDetail = useCallback(async (metricId: string) => {
    const r = await fetchJson<{ metric: MetricDetail }>(`${BASE}/metrics/${metricId}`);
    setSelectedMetric(r.metric);
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshDomains(), refreshOverview(), refreshSources(), refreshMetrics(), refreshSuggestions()]);
  }, [refreshDomains, refreshOverview, refreshSources, refreshMetrics, refreshSuggestions]);

  // ── Initial load ──

  useEffect(() => {
    let active = true;
    setLoading(true);
    refreshAll()
      .catch((error: unknown) => {
        if (active) setMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to load institutional data." });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [refreshAll]);

  // ── Auto-load details ──

  useEffect(() => {
    if (!selectedSourceId) { setSelectedSource(null); return; }
    void loadSourceDetail(selectedSourceId).catch((error: unknown) => {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to load source detail." });
    });
  }, [selectedSourceId, loadSourceDetail]);

  useEffect(() => {
    if (!selectedMetricId) { setSelectedMetric(null); return; }
    void loadMetricDetail(selectedMetricId).catch((error: unknown) => {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to load metric detail." });
    });
  }, [selectedMetricId, loadMetricDetail]);

  // ── Mutation wrapper ──

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

  // ── Actions ──

  async function seedCatalog() {
    await withSaving(async () => {
      await postJson(`${BASE}/seed`, { includeRecommendedSources: true });
      await refreshAll();
      setMessage({ type: "success", text: "Institutional data catalog seeded." });
    });
  }

  async function createSource(payload: Record<string, unknown>) {
    await withSaving(async () => {
      const r = await postJson<{ source: SourceRow }>(`${BASE}/sources`, payload);
      await Promise.all([refreshSources(r.source.id), refreshOverview()]);
      setMessage({ type: "success", text: "Source created." });
    });
  }

  async function updateSource(sourceId: string, payload: Record<string, unknown>) {
    await withSaving(async () => {
      await postJson(`${BASE}/sources/${sourceId}`, payload, "PATCH");
      await Promise.all([refreshSources(sourceId), loadSourceDetail(sourceId)]);
      setMessage({ type: "success", text: "Source updated." });
    });
  }

  async function refreshSource(sourceId: string) {
    await withSaving(async () => {
      await postJson(`${BASE}/sources/${sourceId}/refresh`, {});
      await Promise.all([refreshOverview(), refreshSuggestions(), refreshSources(sourceId), loadSourceDetail(sourceId)]);
      if (selectedMetricId) {
        await Promise.all([refreshMetrics(selectedMetricId), loadMetricDetail(selectedMetricId)]);
      }
      setMessage({ type: "success", text: "Source refreshed from adapter." });
    });
  }

  async function saveManualSnapshot(sourceId: string, payload: Record<string, unknown>) {
    await withSaving(async () => {
      await postJson(`${BASE}/sources/${sourceId}/snapshots`, payload, "PUT");
      await Promise.all([refreshOverview(), refreshSources(sourceId), loadSourceDetail(sourceId)]);
      if (selectedMetricId) {
        await Promise.all([refreshMetrics(selectedMetricId), loadMetricDetail(selectedMetricId)]);
      }
      setMessage({ type: "success", text: "Manual snapshot saved." });
    });
  }

  async function previewImport(sourceId: string, file: File, observedYear: number | null, scopeKey: string | null, replaceRows: boolean) {
    await withSaving(async () => {
      const fileContentBase64 = await fileToBase64(file);
      const r = await postJson<{ preview: ImportPreview }>(
        `${BASE}/sources/${sourceId}/dataset/import-preview`,
        { fileName: file.name, fileContentBase64, observedYear, scopeKey, replaceRows },
      );
      setImportPreview(r.preview);
      setMessage({ type: "success", text: "Import preview ready." });
    });
  }

  async function applyImport(sourceId: string, file: File, observedYear: number | null, scopeKey: string | null, replaceRows: boolean) {
    await withSaving(async () => {
      const fileContentBase64 = await fileToBase64(file);
      await postJson(`${BASE}/sources/${sourceId}/dataset/import`, {
        fileName: file.name, fileContentBase64, observedYear, scopeKey, replaceRows,
      });
      setImportPreview(null);
      await Promise.all([refreshOverview(), refreshSuggestions(), refreshSources(sourceId), loadSourceDetail(sourceId)]);
      if (selectedMetricId) {
        await Promise.all([refreshMetrics(selectedMetricId), loadMetricDetail(selectedMetricId)]);
      }
      setMessage({ type: "success", text: "Dataset imported." });
    });
  }

  async function createMetric(payload: Record<string, unknown>) {
    await withSaving(async () => {
      const r = await postJson<{ metric: MetricRow }>(`${BASE}/metrics`, payload);
      await Promise.all([refreshMetrics(r.metric.id), refreshOverview()]);
      setMessage({ type: "success", text: "Metric created." });
    });
  }

  async function updateMetric(metricId: string, payload: Record<string, unknown>) {
    await withSaving(async () => {
      await postJson(`${BASE}/metrics/${metricId}`, payload, "PATCH");
      await Promise.all([refreshMetrics(metricId), loadMetricDetail(metricId)]);
      setMessage({ type: "success", text: "Metric updated." });
    });
  }

  async function addMetricLink(metricId: string, linkPayload: Record<string, unknown>) {
    await withSaving(async () => {
      await postJson(`${BASE}/metrics/${metricId}/links`, { links: [linkPayload] }, "PUT");
      await Promise.all([refreshMetrics(metricId), loadMetricDetail(metricId)]);
      setMessage({ type: "success", text: "Metric link saved." });
    });
  }

  async function resolveSuggestion(id: string, action: "ACCEPT" | "REJECT") {
    await withSaving(async () => {
      await postJson(`${BASE}/suggestions/${id}/resolve`, { action });
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

  function clearMessage() {
    setMessage(null);
  }

  function clearImportPreview() {
    setImportPreview(null);
  }

  return {
    loading,
    saving,
    message,
    clearMessage,

    domains,
    domainOptions,
    adapterOptions,
    summary,
    gapItems,

    sources,
    selectedSourceId,
    setSelectedSourceId,
    selectedSource,

    metrics,
    selectedMetricId,
    setSelectedMetricId,
    selectedMetric,

    suggestions,
    importPreview,
    clearImportPreview,

    seedCatalog,
    createSource,
    updateSource,
    refreshSource,
    saveManualSnapshot,
    previewImport,
    applyImport,
    createMetric,
    updateMetric,
    addMetricLink,
    resolveSuggestion,
  };
}

export type InstitutionalDataHook = ReturnType<typeof useInstitutionalData>;
