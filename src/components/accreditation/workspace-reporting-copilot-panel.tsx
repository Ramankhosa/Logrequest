"use client";

import { useEffect, useState } from "react";

type WorkspaceReportingCopilotPanelProps = {
  workspaceId: string;
  workspaceStatus: string;
  allowWorkflowMutations?: boolean;
};

type ReadinessReport = {
  blockersCount: number;
  warningsCount: number;
  freezeEligible: boolean;
  totalEntries: number;
  progressPercent: number;
  approvalPercent: number;
  dataCompleteness: number;
  workspace: {
    isScoreStale: boolean;
    resolvedGrade: string | null;
    resolvedOutcome: string | null;
  };
};

type CompletenessBlock = {
  entryId: string;
  blockCode: string;
  blockTitle: string;
  completionStatus: string;
  missingYears: number[];
  missingRequiredEvidenceTypes: string[];
  finalScore: number | null;
};

type CompletenessReport = {
  blocks: CompletenessBlock[];
  summary: {
    totalBlocks: number;
    noResponseCount: number;
    missingYearCount: number;
    missingEvidenceCount: number;
    approvedCount: number;
  };
};

type EvidenceInventoryReport = {
  blocks: Array<{
    entryId: string;
    blockCode: string;
    blockTitle: string;
    evidenceCount: number;
    hasFinalEvidence: boolean;
    missingRequiredEvidenceTypes: string[];
  }>;
  summary: {
    blockCount: number;
    evidenceCount: number;
    unlinkedEvidenceCount: number;
    blocksMissingRequiredEvidence: number;
  };
};

type EntryOption = {
  id: string;
  blockCode: string;
  blockTitle: string;
  status: string;
  responses: Array<{
    scopeKey: string;
    year: number | null;
    responseData: {
      value?: number | null;
      narrative?: string | null;
    };
  }>;
  latestEvidence: Array<{
    evidenceId: string;
    title: string;
    docType: string | null;
    latestVersion: {
      id: string;
      fileName: string;
      fileType: string | null;
      uploadedAt: string;
    } | null;
  }>;
};

type LinkedBlockRef = {
  blockId: string;
  blockCode: string | null;
  blockTitle: string | null;
};

type DvvQuery = {
  id: string;
  queryNumber: string;
  queryText: string;
  status: string;
  priority: string;
  dueDate: string | null;
  linkedBlocks: LinkedBlockRef[];
};

type Recommendation = {
  id: string;
  recommendationText: string;
  status: string;
  priority: string;
  targetDate: string | null;
  linkedBlocks: LinkedBlockRef[];
};

type AssistantSuggestion = {
  id: string;
  type: string;
  content: string;
  confidence: number | null;
  groundingStatus: string;
  status: string;
  staleReason?: string | null;
  feedbackValue?: string | null;
  citations: Array<{
    type?: string;
    ref?: string;
    snippet?: string;
    confidence?: number | null;
    evidenceVersionId?: string | null;
    chunkId?: string | null;
    metricCode?: string | null;
    responseFieldKey?: string | null;
  }>;
  createdAt: string;
};

type EvidenceExtractionSummary = {
  id: string;
  status: string;
  engineVersion: string | null;
  confidence: number | null;
  processedAt: string | null;
  qualityFlags: string[];
  chunkCount: number;
};

type EvidenceChunk = {
  id: string;
  chunkIndex: number;
  sectionHeading: string | null;
  plainText: string;
  tokenEstimate: number | null;
  confidence: number | null;
};

const inputClassName =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-slate-900";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
  });
  const data = (await response.json()) as T & { status?: string; message?: string };
  if (!response.ok || data.status === "error") {
    throw new Error(data.message ?? "Request failed.");
  }
  return data;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Not set";
  return new Date(value).toLocaleDateString();
}

function suggestionLabel(type: string) {
  return type.replaceAll("_", " ");
}

function formatEntryResponse(entry: EntryOption | null) {
  if (!entry) return "";
  const parts = entry.responses
    .map((response) => {
      const label = response.year ?? response.scopeKey;
      const narrative = response.responseData?.narrative?.trim();
      const value = response.responseData?.value;
      if (narrative) {
        return `${label}: ${narrative}`;
      }
      if (typeof value === "number") {
        return `${label}: ${value}`;
      }
      return null;
    })
    .filter((value): value is string => !!value);
  return parts.join("\n\n");
}

export function WorkspaceReportingCopilotPanel({
  workspaceId,
  workspaceStatus,
  allowWorkflowMutations = false,
}: WorkspaceReportingCopilotPanelProps) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [copilotEnabled, setCopilotEnabled] = useState(false);
  const [readiness, setReadiness] = useState<ReadinessReport | null>(null);
  const [completeness, setCompleteness] = useState<CompletenessReport | null>(null);
  const [inventory, setInventory] = useState<EvidenceInventoryReport | null>(null);
  const [entries, setEntries] = useState<EntryOption[]>([]);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [watchlist, setWatchlist] = useState<AssistantSuggestion | null>(null);
  const [suggestions, setSuggestions] = useState<AssistantSuggestion[]>([]);
  const [draftPad, setDraftPad] = useState("");
  const [selectedSuggestionId, setSelectedSuggestionId] = useState<string | null>(null);
  const [extractionsByVersionId, setExtractionsByVersionId] = useState<Record<string, EvidenceExtractionSummary | null>>({});
  const [chunksByVersionId, setChunksByVersionId] = useState<Record<string, EvidenceChunk[]>>({});
  const [dvvQueries, setDvvQueries] = useState<DvvQuery[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [dvvSummary, setDvvSummary] = useState<{
    total: number;
    open: number;
    closed: number;
    highPriority: number;
  } | null>(null);
  const [recommendationSummary, setRecommendationSummary] = useState<{
    total: number;
    open: number;
    completed: number;
    highPriority: number;
  } | null>(null);
  const selectedEntry = entries.find((entry) => entry.id === selectedEntryId) ?? null;

  async function loadCore() {
    const servicesResult = await fetchJson<{ enabledFeatures?: string[] }>("/api/tenant/services");
    const nextCopilotEnabled = Array.isArray(servicesResult.enabledFeatures)
      ? servicesResult.enabledFeatures.includes("ACCREDITATION_COPILOT")
      : false;

    const [
      readinessResult,
      completenessResult,
      inventoryResult,
      dvvResult,
      dvvSummaryResult,
      recommendationResult,
      recommendationSummaryResult,
    ] = await Promise.all([
      fetchJson<{ report: ReadinessReport }>(
        `/api/tenant/accreditation/workspaces/${workspaceId}/reports/readiness`,
      ),
      fetchJson<{ report: CompletenessReport }>(
        `/api/tenant/accreditation/workspaces/${workspaceId}/reports/completeness`,
      ),
      fetchJson<{ report: EvidenceInventoryReport }>(
        `/api/tenant/accreditation/workspaces/${workspaceId}/reports/evidence-inventory`,
      ),
      fetchJson<{ queries: DvvQuery[] }>(
        `/api/tenant/accreditation/workspaces/${workspaceId}/dvv-queries`,
      ),
      fetchJson<{ summary: { total: number; open: number; closed: number; highPriority: number } }>(
        `/api/tenant/accreditation/workspaces/${workspaceId}/dvv-summary`,
      ),
      fetchJson<{ recommendations: Recommendation[] }>(
        `/api/tenant/accreditation/workspaces/${workspaceId}/recommendations`,
      ),
      fetchJson<{ summary: { total: number; open: number; completed: number; highPriority: number } }>(
        `/api/tenant/accreditation/workspaces/${workspaceId}/recommendation-summary`,
      ),
    ]);

    const [entryResult, watchlistResult] = nextCopilotEnabled
      ? await Promise.all([
          fetchJson<{ entries: EntryOption[] }>(
            `/api/tenant/accreditation/workspaces/${workspaceId}/entries`,
          ),
          fetchJson<{ suggestion: AssistantSuggestion }>(
            `/api/tenant/accreditation/workspaces/${workspaceId}/copilot/watchlist`,
            { method: "POST" },
          ),
        ])
      : [{ entries: [] }, null];

    setCopilotEnabled(nextCopilotEnabled);
    setReadiness(readinessResult.report);
    setCompleteness(completenessResult.report);
    setInventory(inventoryResult.report);
    setEntries(entryResult.entries);
    setSelectedEntryId((current) =>
      nextCopilotEnabled ? current ?? entryResult.entries[0]?.id ?? null : null,
    );
    setDvvQueries(dvvResult.queries);
    setDvvSummary(dvvSummaryResult.summary);
    setRecommendations(recommendationResult.recommendations);
    setRecommendationSummary(recommendationSummaryResult.summary);
    setWatchlist(watchlistResult?.suggestion ?? null);
  }

  async function loadSuggestions(entryId: string) {
    const result = await fetchJson<{ suggestions: AssistantSuggestion[] }>(
      `/api/tenant/accreditation/entries/${entryId}/assistant-suggestions`,
    );
    setSuggestions(result.suggestions);
  }

  async function loadEvidenceIntelligence(entry: EntryOption | null) {
    if (!entry) {
      setExtractionsByVersionId({});
      setChunksByVersionId({});
      return;
    }

    const versionIds = entry.latestEvidence
      .map((evidence) => evidence.latestVersion?.id ?? null)
      .filter((value): value is string => !!value);

    if (versionIds.length === 0) {
      setExtractionsByVersionId({});
      setChunksByVersionId({});
      return;
    }

    const results = await Promise.all(
      versionIds.map(async (versionId) => {
        const [extractionResult, chunkResult] = await Promise.all([
          fetchJson<{ extraction: EvidenceExtractionSummary | null }>(
            `/api/tenant/accreditation/evidence-versions/${versionId}/extraction`,
          ),
          fetchJson<{ chunks: EvidenceChunk[] }>(
            `/api/tenant/accreditation/evidence-versions/${versionId}/chunks`,
          ),
        ]);
        return {
          versionId,
          extraction: extractionResult.extraction,
          chunks: chunkResult.chunks,
        };
      }),
    );

    setExtractionsByVersionId(
      Object.fromEntries(results.map((row) => [row.versionId, row.extraction])),
    );
    setChunksByVersionId(
      Object.fromEntries(results.map((row) => [row.versionId, row.chunks])),
    );
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadCore()
      .catch((error: unknown) => {
        if (!active) return;
        setMessage({
          type: "error",
          text: error instanceof Error ? error.message : "Failed to load reporting data.",
        });
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [workspaceId]);

  useEffect(() => {
    if (!copilotEnabled || !selectedEntryId) {
      setSuggestions([]);
      return;
    }
    loadSuggestions(selectedEntryId).catch((error: unknown) => {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to load assistant suggestions.",
      });
    });
  }, [copilotEnabled, selectedEntryId]);

  useEffect(() => {
    setDraftPad(formatEntryResponse(selectedEntry));
    setSelectedSuggestionId(null);
    if (!copilotEnabled) {
      setExtractionsByVersionId({});
      setChunksByVersionId({});
      return;
    }
    loadEvidenceIntelligence(selectedEntry).catch((error: unknown) => {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to load evidence intelligence.",
      });
    });
  }, [copilotEnabled, selectedEntryId, entries]);

  async function downloadReport(format: "json" | "csv") {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/tenant/accreditation/workspaces/${workspaceId}/reports/export?format=${format}`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        const data = (await response.json()) as { message?: string };
        throw new Error(data.message ?? "Export failed.");
      }
      const blob = await response.blob();
      const fileName =
        response.headers.get("content-disposition")?.match(/filename=\"?([^\"]+)\"?$/)?.[1] ??
        `workspace-${workspaceId}-report.${format}`;
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
      window.URL.revokeObjectURL(url);
      setMessage({ type: "success", text: `Downloaded ${fileName}.` });
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Export failed.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function runEntryCopilot(kind: "explain" | "review" | "draft") {
    if (!selectedEntryId) return;
    setBusy(true);
    setMessage(null);
    try {
      await fetchJson(
        `/api/tenant/accreditation/entries/${selectedEntryId}/copilot/${kind}`,
        { method: "POST" },
      );
      await loadSuggestions(selectedEntryId);
      setMessage({ type: "success", text: `Generated ${kind} suggestion.` });
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Copilot action failed.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleSuggestionAction(suggestionId: string, action: "accept" | "dismiss") {
    setBusy(true);
    setMessage(null);
    try {
      await fetchJson(`/api/tenant/accreditation/assistant-suggestions/${suggestionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (selectedEntryId) {
        await loadSuggestions(selectedEntryId);
      }
      setMessage({ type: "success", text: `Suggestion ${action}ed.` });
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Suggestion action failed.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleSuggestionFeedback(
    suggestionId: string,
    action: "mark_useful" | "mark_not_useful",
  ) {
    setBusy(true);
    setMessage(null);
    try {
      await fetchJson(`/api/tenant/accreditation/assistant-suggestions/${suggestionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (selectedEntryId) {
        await loadSuggestions(selectedEntryId);
      }
      setMessage({
        type: "success",
        text: action === "mark_useful" ? "Marked suggestion as useful." : "Marked suggestion as not useful.",
      });
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Suggestion feedback failed.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function runEvidenceExtraction(evidenceVersionId: string) {
    setBusy(true);
    setMessage(null);
    try {
      await fetchJson(`/api/tenant/accreditation/evidence-versions/${evidenceVersionId}/extract`, {
        method: "POST",
      });
      await loadEvidenceIntelligence(selectedEntry);
      if (selectedEntryId) {
        await loadSuggestions(selectedEntryId);
      }
      setMessage({ type: "success", text: "Evidence extraction refreshed." });
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Evidence extraction failed.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateDvv(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!allowWorkflowMutations) return;
    const formData = new FormData(event.currentTarget);
    setBusy(true);
    setMessage(null);
    try {
      await fetchJson(`/api/tenant/accreditation/workspaces/${workspaceId}/dvv-queries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          queryNumber: String(formData.get("queryNumber") ?? ""),
          queryText: String(formData.get("queryText") ?? ""),
          priority: String(formData.get("priority") ?? "MEDIUM"),
          dueDate: String(formData.get("dueDate") ?? "") || null,
        }),
      });
      event.currentTarget.reset();
      await loadCore();
      setMessage({ type: "success", text: "DVV query created." });
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to create DVV query.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateRecommendation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!allowWorkflowMutations) return;
    const formData = new FormData(event.currentTarget);
    setBusy(true);
    setMessage(null);
    try {
      await fetchJson(`/api/tenant/accreditation/workspaces/${workspaceId}/recommendations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recommendationText: String(formData.get("recommendationText") ?? ""),
          priority: String(formData.get("priority") ?? "MEDIUM"),
          targetDate: String(formData.get("targetDate") ?? "") || null,
          actionPlan: String(formData.get("actionPlan") ?? "") || null,
        }),
      });
      event.currentTarget.reset();
      await loadCore();
      setMessage({ type: "success", text: "Recommendation created." });
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to create recommendation.",
      });
    } finally {
      setBusy(false);
    }
  }

  const flaggedBlocks =
    completeness?.blocks.filter(
      (block) => block.completionStatus !== "APPROVED" && block.completionStatus !== "READY",
    ) ?? [];
  const selectedDraftSuggestion =
    suggestions.find((suggestion) => suggestion.id === selectedSuggestionId) ??
    suggestions.find((suggestion) => suggestion.type === "DRAFT" && suggestion.status !== "DISMISSED") ??
    null;
  const currentResponseText = formatEntryResponse(selectedEntry);

  return (
    <section className="rounded-[1.75rem] border border-slate-200/80 bg-white/85 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-slate-400">R3.4A</p>
          <h3 className="text-xl font-semibold text-slate-900">Reporting and Copilot</h3>
          <p className="text-sm text-slate-500">
            {copilotEnabled
              ? "Readiness, completeness, evidence inventory, DVV/recommendation tracking, and grounded assistant guidance."
              : "Readiness, completeness, evidence inventory, and DVV/recommendation tracking."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void downloadReport("json")}
            className="rounded-2xl border border-slate-300 px-4 py-2 text-sm text-slate-700"
          >
            Export JSON
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void downloadReport("csv")}
            className="rounded-2xl border border-slate-300 px-4 py-2 text-sm text-slate-700"
          >
            Export CSV
          </button>
        </div>
      </div>

      {message ? (
        <div
          className={`mt-4 rounded-2xl px-4 py-3 text-sm ${
            message.type === "success"
              ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {message.text}
        </div>
      ) : null}

      {loading ? (
        <p className="mt-6 text-sm text-slate-500">Loading reporting and copilot data...</p>
      ) : (
        <div className="mt-6 space-y-6">
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Blockers</p>
              <p className="mt-1 text-xl font-semibold text-slate-900">{readiness?.blockersCount ?? 0}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Warnings</p>
              <p className="mt-1 text-xl font-semibold text-slate-900">{readiness?.warningsCount ?? 0}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">No Response</p>
              <p className="mt-1 text-xl font-semibold text-slate-900">{completeness?.summary.noResponseCount ?? 0}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Evidence Gaps</p>
              <p className="mt-1 text-xl font-semibold text-slate-900">
                {inventory?.summary.blocksMissingRequiredEvidence ?? 0}
              </p>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Open DVV</p>
              <p className="mt-1 text-xl font-semibold text-slate-900">{dvvSummary?.open ?? 0}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Open Actions</p>
              <p className="mt-1 text-xl font-semibold text-slate-900">{recommendationSummary?.open ?? 0}</p>
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.1fr,0.9fr]">
            <div className="space-y-6">
              {copilotEnabled ? (
              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Workspace Watchlist
                    </h4>
                    <p className="mt-1 text-xs text-slate-500">
                      Status: {workspaceStatus.replaceAll("_", " ")} · Freeze eligible:{" "}
                      {readiness?.freezeEligible ? "Yes" : "No"}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setLoading(true);
                      loadCore()
                        .catch((error: unknown) => {
                          setMessage({
                            type: "error",
                            text: error instanceof Error ? error.message : "Failed to refresh watchlist.",
                          });
                        })
                        .finally(() => setLoading(false));
                    }}
                    className="rounded-xl border border-slate-300 px-3 py-1 text-xs text-slate-700"
                  >
                    Refresh
                  </button>
                </div>
                <p className="mt-4 whitespace-pre-wrap text-sm text-slate-700">
                  {watchlist?.content ?? "No watchlist generated yet."}
                </p>
              </div>
              ) : null}

              <div className="rounded-2xl border border-slate-200 p-4">
                <h4 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Completeness Watchlist
                </h4>
                <div className="mt-4 space-y-3">
                  {flaggedBlocks.length === 0 ? (
                    <p className="text-sm text-emerald-700">No major completeness gaps are currently flagged.</p>
                  ) : (
                    flaggedBlocks.slice(0, 8).map((block) => (
                      <div key={block.entryId} className="rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-700">
                        <p className="font-medium text-slate-900">
                          {block.blockCode} · {block.blockTitle}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {block.completionStatus.replaceAll("_", " ")}
                          {block.missingYears.length > 0 ? ` · Missing years: ${block.missingYears.join(", ")}` : ""}
                          {block.missingRequiredEvidenceTypes.length > 0
                            ? ` · Missing evidence: ${block.missingRequiredEvidenceTypes.join(", ")}`
                            : ""}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4">
                <h4 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Evidence Inventory
                </h4>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <div className="rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-700">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Total Evidence</p>
                    <p className="mt-1 text-lg font-semibold text-slate-900">{inventory?.summary.evidenceCount ?? 0}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-700">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Unlinked</p>
                    <p className="mt-1 text-lg font-semibold text-slate-900">{inventory?.summary.unlinkedEvidenceCount ?? 0}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-700">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Blocks Missing Evidence</p>
                    <p className="mt-1 text-lg font-semibold text-slate-900">
                      {inventory?.summary.blocksMissingRequiredEvidence ?? 0}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              {copilotEnabled ? (
              <div className="rounded-2xl border border-slate-200 p-4">
                <h4 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Block Copilot
                </h4>
                <div className="mt-4 grid gap-3 md:grid-cols-[1fr,auto,auto,auto]">
                  <select
                    className={inputClassName}
                    value={selectedEntryId ?? ""}
                    onChange={(event) => setSelectedEntryId(event.target.value || null)}
                  >
                    <option value="">Select a block</option>
                    {entries.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.blockCode} · {entry.blockTitle}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={busy || !selectedEntryId}
                    onClick={() => void runEntryCopilot("explain")}
                    className="rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-700"
                  >
                    Explain
                  </button>
                  <button
                    type="button"
                    disabled={busy || !selectedEntryId}
                    onClick={() => void runEntryCopilot("review")}
                    className="rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-700"
                  >
                    Review
                  </button>
                  <button
                    type="button"
                    disabled={busy || !selectedEntryId}
                    onClick={() => void runEntryCopilot("draft")}
                    className="rounded-2xl bg-slate-900 px-4 py-3 text-sm text-white"
                  >
                    Draft
                  </button>
                </div>
                {selectedEntry ? (
                  <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    <p className="font-medium text-slate-900">
                      {selectedEntry.blockCode} · {selectedEntry.blockTitle}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Current status {selectedEntry.status.replaceAll("_", " ")} · Responses {selectedEntry.responses.length}
                      · Evidence {selectedEntry.latestEvidence.length}
                    </p>
                  </div>
                ) : null}
                <div className="mt-4 space-y-3">
                  {suggestions.length === 0 ? (
                    <p className="text-sm text-slate-500">No assistant suggestions yet for the selected block.</p>
                  ) : (
                    suggestions.map((suggestion) => (
                      <div
                        key={suggestion.id}
                        className={`rounded-xl px-4 py-3 ${
                          selectedSuggestionId === suggestion.id ? "bg-slate-100 ring-1 ring-slate-300" : "bg-slate-50"
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-slate-900">
                              {suggestionLabel(suggestion.type)} · {suggestion.status}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {formatDate(suggestion.createdAt)} · {suggestion.groundingStatus}
                              {suggestion.confidence !== null
                                ? ` · Confidence ${Math.round(suggestion.confidence * 100)}%`
                                : ""}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => setSelectedSuggestionId(suggestion.id)}
                              className="rounded-xl border border-slate-300 px-3 py-1 text-xs text-slate-700"
                            >
                              Focus
                            </button>
                            {suggestion.type === "DRAFT" ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                  setSelectedSuggestionId(suggestion.id);
                                  setDraftPad(suggestion.content);
                                }}
                                className="rounded-xl border border-sky-300 px-3 py-1 text-xs text-sky-700"
                              >
                                Apply To Draft
                              </button>
                            ) : null}
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void handleSuggestionAction(suggestion.id, "accept")}
                              className="rounded-xl border border-emerald-300 px-3 py-1 text-xs text-emerald-700"
                            >
                              Accept
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void handleSuggestionAction(suggestion.id, "dismiss")}
                              className="rounded-xl border border-slate-300 px-3 py-1 text-xs text-slate-700"
                            >
                              Dismiss
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void handleSuggestionFeedback(suggestion.id, "mark_useful")}
                              className="rounded-xl border border-indigo-300 px-3 py-1 text-xs text-indigo-700"
                            >
                              Useful
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void handleSuggestionFeedback(suggestion.id, "mark_not_useful")}
                              className="rounded-xl border border-amber-300 px-3 py-1 text-xs text-amber-700"
                            >
                              Not Useful
                            </button>
                          </div>
                        </div>
                        <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{suggestion.content}</p>
                        {suggestion.citations.length > 0 ? (
                          <div className="mt-3 grid gap-2">
                            {suggestion.citations.slice(0, 6).map((citation, index) => (
                              <button
                                type="button"
                                key={`${suggestion.id}-citation-${index}`}
                                onClick={() => {
                                  if (suggestion.type === "DRAFT" && citation.snippet) {
                                    setDraftPad((current) =>
                                      current.trim().length > 0 ? `${current}\n\n[Citation] ${citation.snippet}` : citation.snippet ?? "",
                                    );
                                  }
                                }}
                                className="rounded-2xl bg-white px-3 py-2 text-left text-[11px] text-slate-600"
                              >
                                <span className="font-medium text-slate-800">
                                  {(citation.type ?? "source").replaceAll("_", " ")}
                                </span>
                                <span className="ml-1">
                                  {citation.snippet ?? citation.ref ?? "reference"}
                                </span>
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
                <div className="mt-6 rounded-2xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h5 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Draft Workspace
                      </h5>
                      <p className="mt-1 text-xs text-slate-500">
                        Compare the current response with a selected draft suggestion. This remains local and does not save the official response.
                      </p>
                    </div>
                    {selectedDraftSuggestion ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setDraftPad(selectedDraftSuggestion.content)}
                        className="rounded-xl border border-sky-300 px-3 py-1 text-xs text-sky-700"
                      >
                        Apply Selected Draft
                      </button>
                    ) : null}
                  </div>
                  <div className="mt-4 grid gap-4 xl:grid-cols-2">
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Current Response</p>
                      <pre className="mt-2 min-h-40 whitespace-pre-wrap rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                        {currentResponseText || "No current response content for this block."}
                      </pre>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Draft Pad</p>
                      <textarea
                        value={draftPad}
                        onChange={(event) => setDraftPad(event.target.value)}
                        className={`${inputClassName} mt-2 min-h-40`}
                        placeholder="Apply a draft suggestion here to compare or refine it."
                      />
                    </div>
                  </div>
                </div>
                <div className="mt-6 rounded-2xl border border-slate-200 p-4">
                  <h5 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Evidence Intelligence
                  </h5>
                  <div className="mt-4 space-y-3">
                    {selectedEntry?.latestEvidence.length ? (
                      selectedEntry.latestEvidence.map((evidence) => {
                        const versionId = evidence.latestVersion?.id;
                        const extraction = versionId ? extractionsByVersionId[versionId] : null;
                        const chunks = versionId ? chunksByVersionId[versionId] ?? [] : [];
                        return (
                          <div key={evidence.evidenceId} className="rounded-xl bg-slate-50 px-4 py-3">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-medium text-slate-900">{evidence.title}</p>
                                <p className="mt-1 text-xs text-slate-500">
                                  {evidence.docType ?? "Unclassified"}
                                  {evidence.latestVersion ? ` · ${evidence.latestVersion.fileName}` : " · No file version"}
                                  {extraction ? ` · ${extraction.status}` : " · Not extracted"}
                                  {extraction?.chunkCount ? ` · ${extraction.chunkCount} chunks` : ""}
                                </p>
                              </div>
                              {versionId ? (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void runEvidenceExtraction(versionId)}
                                  className="rounded-xl border border-slate-300 px-3 py-1 text-xs text-slate-700"
                                >
                                  {extraction ? "Re-extract" : "Extract"}
                                </button>
                              ) : null}
                            </div>
                            {extraction ? (
                              <p className="mt-2 text-xs text-slate-500">
                                Engine {extraction.engineVersion ?? "unknown"}
                                {extraction.confidence !== null ? ` · Confidence ${Math.round(extraction.confidence * 100)}%` : ""}
                                {extraction.processedAt ? ` · Processed ${formatDate(extraction.processedAt)}` : ""}
                                {extraction.qualityFlags.length > 0 ? ` · ${extraction.qualityFlags.join(", ")}` : ""}
                              </p>
                            ) : null}
                            {chunks.length > 0 ? (
                              <div className="mt-3 grid gap-2">
                                {chunks.slice(0, 2).map((chunk) => (
                                  <div key={chunk.id} className="rounded-2xl bg-white px-3 py-3 text-sm text-slate-700">
                                    <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                                      Chunk {chunk.chunkIndex + 1}
                                      {chunk.sectionHeading ? ` · ${chunk.sectionHeading}` : ""}
                                      {chunk.tokenEstimate ? ` · ~${chunk.tokenEstimate} tokens` : ""}
                                    </p>
                                    <p className="mt-2 whitespace-pre-wrap">{chunk.plainText.slice(0, 420)}</p>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        );
                      })
                    ) : (
                      <p className="text-sm text-slate-500">No evidence is currently linked to the selected block.</p>
                    )}
                  </div>
                </div>
              </div>
              ) : null}

              <div className="rounded-2xl border border-slate-200 p-4">
                <h4 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                  DVV Queries
                </h4>
                {allowWorkflowMutations ? (
                  <form className="mt-4 grid gap-3" onSubmit={(event) => void handleCreateDvv(event)}>
                    <div className="grid gap-3 md:grid-cols-3">
                      <input className={inputClassName} name="queryNumber" placeholder="Query number" required />
                      <select className={inputClassName} name="priority" defaultValue="MEDIUM">
                        <option value="HIGH">High</option>
                        <option value="MEDIUM">Medium</option>
                        <option value="LOW">Low</option>
                      </select>
                      <input className={inputClassName} type="date" name="dueDate" />
                    </div>
                    <textarea
                      className={`${inputClassName} min-h-24`}
                      name="queryText"
                      placeholder="DVV query text"
                      required
                    />
                    <button
                      type="submit"
                      disabled={busy}
                      className="rounded-2xl bg-slate-900 px-4 py-3 text-sm text-white disabled:bg-slate-300"
                    >
                      Add DVV Query
                    </button>
                  </form>
                ) : null}
                <div className="mt-4 space-y-3">
                  {dvvQueries.length === 0 ? (
                    <p className="text-sm text-slate-500">No DVV queries recorded yet.</p>
                  ) : (
                    dvvQueries.map((query) => (
                      <div key={query.id} className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                        <p className="font-medium text-slate-900">
                          {query.queryNumber} · {query.status}
                        </p>
                        <p className="mt-1">{query.queryText}</p>
                        <p className="mt-2 text-xs text-slate-500">
                          Priority {query.priority}
                          {query.dueDate ? ` · Due ${formatDate(query.dueDate)}` : ""}
                          {query.linkedBlocks.length > 0
                            ? ` · Blocks ${query.linkedBlocks.map((block) => block.blockCode ?? block.blockId).join(", ")}`
                            : ""}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4">
                <h4 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Recommendations
                </h4>
                {allowWorkflowMutations ? (
                  <form className="mt-4 grid gap-3" onSubmit={(event) => void handleCreateRecommendation(event)}>
                    <div className="grid gap-3 md:grid-cols-2">
                      <select className={inputClassName} name="priority" defaultValue="MEDIUM">
                        <option value="HIGH">High</option>
                        <option value="MEDIUM">Medium</option>
                        <option value="LOW">Low</option>
                      </select>
                      <input className={inputClassName} type="date" name="targetDate" />
                    </div>
                    <textarea
                      className={`${inputClassName} min-h-24`}
                      name="recommendationText"
                      placeholder="Recommendation text"
                      required
                    />
                    <textarea
                      className={`${inputClassName} min-h-20`}
                      name="actionPlan"
                      placeholder="Action plan"
                    />
                    <button
                      type="submit"
                      disabled={busy}
                      className="rounded-2xl bg-slate-900 px-4 py-3 text-sm text-white disabled:bg-slate-300"
                    >
                      Add Recommendation
                    </button>
                  </form>
                ) : null}
                <div className="mt-4 space-y-3">
                  {recommendations.length === 0 ? (
                    <p className="text-sm text-slate-500">No recommendations recorded yet.</p>
                  ) : (
                    recommendations.map((recommendation) => (
                      <div key={recommendation.id} className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                        <p className="font-medium text-slate-900">
                          {recommendation.status} · {recommendation.priority}
                        </p>
                        <p className="mt-1">{recommendation.recommendationText}</p>
                        <p className="mt-2 text-xs text-slate-500">
                          {recommendation.targetDate ? `Target ${formatDate(recommendation.targetDate)}` : "No target date"}
                          {recommendation.linkedBlocks.length > 0
                            ? ` · Blocks ${recommendation.linkedBlocks
                                .map((block) => block.blockCode ?? block.blockId)
                                .join(", ")}`
                            : ""}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
