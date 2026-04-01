"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  Download,
  Eye,
  FileSpreadsheet,
  Filter,
  Loader2,
  Pencil,
  RefreshCcw,
  Search,
  Upload,
} from "lucide-react";
import { Panel } from "@/components/panel";
import type {
  JournalCatalogListResponse,
  JournalCatalogRecordView,
  JournalImportBatchView,
  JournalImportPreviewResponse,
  JournalListFilters,
  JournalPolicyStatus,
  JournalUpdateInput,
} from "@/lib/journals/shared";

type ManagerScope = "GLOBAL" | "TENANT";

type FeedbackState =
  | { type: "success"; message: string }
  | { type: "error"; message: string }
  | null;

type JournalCatalogManagerProps = {
  scope: ManagerScope;
};

const DEFAULT_PAGE_SIZE = 25;

const TEXT_INPUT_CLASS =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20";
const SELECT_CLASS =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20";

const DETAIL_TEXT_FIELDS: Array<{
  key: keyof JournalUpdateInput;
  label: string;
  type?: "text" | "number";
}> = [
  { key: "title", label: "Title" },
  { key: "sourceYear", label: "Source Year", type: "number" },
  { key: "sourceId", label: "Source Id" },
  { key: "type", label: "Type" },
  { key: "issnRaw", label: "ISSN" },
  { key: "publisher", label: "Publisher" },
  { key: "duplicatePublisher", label: "Publisher Duplicate" },
  { key: "sjrBestQuartile", label: "Quartile" },
  { key: "country", label: "Country" },
  { key: "region", label: "Region" },
  { key: "coverage", label: "Coverage" },
  { key: "openAccessLabel", label: "Open Access Label" },
  { key: "openAccessDiamondLabel", label: "OA Diamond Label" },
  { key: "sjr", label: "SJR", type: "number" },
  { key: "hIndex", label: "H-Index", type: "number" },
  { key: "totalDocsCurrent", label: "Total Docs Current", type: "number" },
  { key: "totalDocs3Years", label: "Total Docs 3 Years", type: "number" },
  { key: "totalRefs", label: "Total Refs", type: "number" },
  { key: "totalCitations3Years", label: "Total Citations 3 Years", type: "number" },
  { key: "citableDocs3Years", label: "Citable Docs 3 Years", type: "number" },
  { key: "citationsPerDoc2Years", label: "Citations / Doc 2 Years", type: "number" },
  { key: "refsPerDoc", label: "Refs / Doc", type: "number" },
  { key: "femalePercent", label: "% Female", type: "number" },
  { key: "overton", label: "Overton", type: "number" },
  { key: "sdg", label: "SDG", type: "number" },
];

const DETAIL_TEXTAREA_FIELDS: Array<{
  key: keyof JournalUpdateInput;
  label: string;
}> = [
  { key: "categories", label: "Categories" },
  { key: "areas", label: "Areas" },
  { key: "policyNote", label: "Policy Note" },
];

function createEmptyList(): JournalCatalogListResponse {
  return {
    rows: [],
    total: 0,
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    facets: {
      years: [],
      quartiles: [],
      types: [],
      countries: [],
      regions: [],
      publishers: [],
      policyStatuses: [],
    },
  };
}

function createInitialFilters(): Partial<JournalListFilters> {
  return {
    recordState: "ACTIVE",
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    sortField: "title",
    sortDirection: "asc",
    onlyEligibleJournals: false,
  };
}

function createDraftFromRecord(record: JournalCatalogRecordView): JournalUpdateInput {
  return {
    sourceYear: record.sourceYear,
    sourceId: record.sourceId,
    title: record.title,
    type: record.type,
    issnRaw: record.issnRaw,
    publisher: record.publisher,
    duplicatePublisher: record.duplicatePublisher,
    openAccessLabel: record.openAccessLabel,
    isOpenAccess: record.isOpenAccess,
    openAccessDiamondLabel: record.openAccessDiamondLabel,
    isOpenAccessDiamond: record.isOpenAccessDiamond,
    sjr: record.sjr,
    sjrBestQuartile: record.sjrBestQuartile,
    hIndex: record.hIndex,
    totalDocsCurrent: record.totalDocsCurrent,
    totalDocs3Years: record.totalDocs3Years,
    totalRefs: record.totalRefs,
    totalCitations3Years: record.totalCitations3Years,
    citableDocs3Years: record.citableDocs3Years,
    citationsPerDoc2Years: record.citationsPerDoc2Years,
    refsPerDoc: record.refsPerDoc,
    femalePercent: record.femalePercent,
    overton: record.overton,
    sdg: record.sdg,
    country: record.country,
    region: record.region,
    coverage: record.coverage,
    categories: record.categories,
    areas: record.areas,
    policyStatus: resolvePolicyStatus(record.policyStatus),
    policyNote: record.policyNote,
  };
}

function formatEffectiveSource(value: JournalCatalogRecordView["effectiveSource"]) {
  switch (value) {
    case "TENANT_OVERRIDE":
      return "Tenant Override";
    case "TENANT_ONLY":
      return "Tenant Only";
    case "ARCHIVED_GLOBAL":
      return "Archived Global";
    case "ARCHIVED_TENANT":
      return "Archived Tenant";
    case "GLOBAL":
    default:
      return "Global";
  }
}

function buildQuery(filters: Partial<JournalListFilters>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value == null || value === "" || value === false) continue;
    params.set(key, String(value));
  }
  return params.toString();
}

function badgeClass(source: JournalCatalogRecordView["effectiveSource"]) {
  if (source === "TENANT_OVERRIDE") {
    return "bg-amber-100 text-amber-700";
  }
  if (source === "TENANT_ONLY") {
    return "bg-emerald-100 text-emerald-700";
  }
  if (source === "ARCHIVED_GLOBAL" || source === "ARCHIVED_TENANT") {
    return "bg-slate-200 text-slate-600";
  }
  return "bg-blue-100 text-blue-700";
}

function resolvePolicyStatus(
  value: JournalCatalogRecordView["policyStatus"] | JournalUpdateInput["policyStatus"] | null | undefined,
): JournalPolicyStatus {
  return value === "DISABLED" || value === "BLACKLISTED" ? value : "ALLOWED";
}

export function JournalCatalogManager({
  scope,
}: JournalCatalogManagerProps) {
  const apiBase =
    scope === "GLOBAL"
      ? "/api/superadmin/journals"
      : "/api/tenant/kra-kpi/journals";
  const importPreviewUrl = `${apiBase}/import/preview`;
  const importBatchesUrl = `${apiBase}/import/batches`;
  const importTemplateUrl = `${apiBase}/import/template`;

  const [draftFilters, setDraftFilters] = useState<Partial<JournalListFilters>>(
    createInitialFilters(),
  );
  const [filters, setFilters] = useState<Partial<JournalListFilters>>(
    createInitialFilters(),
  );
  const [catalog, setCatalog] = useState<JournalCatalogListResponse>(createEmptyList);
  const [batches, setBatches] = useState<JournalImportBatchView[]>([]);
  const [loading, setLoading] = useState(true);
  const [batchLoading, setBatchLoading] = useState(true);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<JournalCatalogRecordView | null>(null);
  const [detailDraft, setDetailDraft] = useState<JournalUpdateInput | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importYear, setImportYear] = useState<string>("");
  const [preview, setPreview] = useState<JournalImportPreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirmingBatchId, setConfirmingBatchId] = useState<string | null>(null);
  const detailPanelRef = useRef<HTMLDivElement | null>(null);

  const scrollDetailIntoView = useCallback(() => {
    detailPanelRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, []);

  const fetchCatalog = useCallback(async () => {
    setLoading(true);
    try {
      const query = buildQuery(filters);
      const response = await fetch(`${apiBase}${query ? `?${query}` : ""}`);
      const data = (await response.json()) as JournalCatalogListResponse | { message?: string };
      if (!response.ok) {
        throw new Error("message" in data ? data.message : "Failed to load journals.");
      }
      setCatalog(data as JournalCatalogListResponse);
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to load journals.",
      });
      setCatalog(createEmptyList());
    } finally {
      setLoading(false);
    }
  }, [apiBase, filters]);

  const fetchBatches = useCallback(async () => {
    setBatchLoading(true);
    try {
      const response = await fetch(importBatchesUrl);
      const data = (await response.json()) as JournalImportBatchView[] | { message?: string };
      if (!response.ok) {
        throw new Error(Array.isArray(data) ? "Failed to load import history." : data.message);
      }
      setBatches(Array.isArray(data) ? data : []);
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          error instanceof Error ? error.message : "Failed to load import history.",
      });
      setBatches([]);
    } finally {
      setBatchLoading(false);
    }
  }, [importBatchesUrl]);

  const fetchRecord = useCallback(
    async (recordId: string) => {
      setDetailLoading(true);
      try {
        const response = await fetch(`${apiBase}/${recordId}`);
        const data = (await response.json()) as JournalCatalogRecordView | { message?: string };
        if (!response.ok) {
          throw new Error("message" in data ? data.message : "Failed to load journal detail.");
        }
        const record = data as JournalCatalogRecordView;
        setSelectedRecord(record);
        setDetailDraft(createDraftFromRecord(record));
      } catch (error) {
        setFeedback({
          type: "error",
          message:
            error instanceof Error ? error.message : "Failed to load journal detail.",
        });
        setSelectedRecord(null);
        setDetailDraft(null);
      } finally {
        setDetailLoading(false);
      }
    },
    [apiBase],
  );

  useEffect(() => {
    void fetchCatalog();
  }, [fetchCatalog]);

  useEffect(() => {
    void fetchBatches();
  }, [fetchBatches]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedRecord(null);
      setDetailDraft(null);
      return;
    }
    void fetchRecord(selectedId);
  }, [fetchRecord, selectedId]);

  useEffect(() => {
    if (!selectedRecord || selectedRecord.id !== selectedId) {
      return;
    }

    const handle = window.setTimeout(() => {
      scrollDetailIntoView();
    }, 80);

    return () => window.clearTimeout(handle);
  }, [scrollDetailIntoView, selectedId, selectedRecord]);

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(catalog.total / Math.max(catalog.pageSize, 1)));
  }, [catalog.pageSize, catalog.total]);

  const isEditable = useMemo(() => {
    if (!selectedRecord) return false;
    if (selectedRecord.isSuperseded) return false;
    if (scope === "GLOBAL") return true;
    return selectedRecord.scope === "TENANT";
  }, [scope, selectedRecord]);

  const refreshAll = useCallback(async () => {
    await Promise.all([fetchCatalog(), fetchBatches()]);
    if (selectedId) {
      await fetchRecord(selectedId);
    }
  }, [fetchBatches, fetchCatalog, fetchRecord, selectedId]);

  const handleSelectRow = useCallback(
    (recordId: string) => {
      if (selectedId === recordId) {
        scrollDetailIntoView();
        return;
      }
      setSelectedId(recordId);
    },
    [scrollDetailIntoView, selectedId],
  );

  const applyFilters = useCallback(() => {
    setFilters((current) => ({
      ...current,
      ...draftFilters,
      page: 1,
    }));
  }, [draftFilters]);

  const resetFilters = useCallback(() => {
    const next = createInitialFilters();
    setDraftFilters(next);
    setFilters(next);
  }, []);

  const updateDraftField = useCallback(
    (key: keyof JournalUpdateInput, value: string | number | boolean | null) => {
      setDetailDraft((current) =>
        current
          ? {
              ...current,
              [key]: value,
            }
          : current,
      );
    },
    [],
  );

  const showFeedback = useCallback((type: "success" | "error", message: string) => {
    setFeedback({ type, message });
    window.setTimeout(() => {
      setFeedback((current) => (current?.message === message ? null : current));
    }, 3500);
  }, []);

  const handleSave = useCallback(async () => {
    if (!selectedRecord || !detailDraft || !isEditable) return;
    setSaving(true);
    try {
      const response = await fetch(`${apiBase}/${selectedRecord.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(detailDraft),
      });
      const data = (await response.json()) as { status: string; message: string; id?: string };
      if (!response.ok || data.status !== "success") {
        throw new Error(data.message || "Failed to save journal.");
      }
      showFeedback("success", data.message);
      await refreshAll();
    } catch (error) {
      showFeedback(
        "error",
        error instanceof Error ? error.message : "Failed to save journal.",
      );
    } finally {
      setSaving(false);
    }
  }, [apiBase, detailDraft, isEditable, refreshAll, selectedRecord, showFeedback]);

  const handleArchiveToggle = useCallback(
    async (row: JournalCatalogRecordView, action: "archive" | "restore") => {
      const label = action === "archive" ? "archive" : "restore";
      const confirmed = window.confirm(
        `Do you want to ${label} "${row.title}"?`,
      );
      if (!confirmed) return;

      setActionId(row.id);
      try {
        const body =
          action === "archive"
            ? JSON.stringify({
                reason:
                  window.prompt("Optional archive reason", "")?.trim() || null,
              })
            : undefined;
        const response = await fetch(`${apiBase}/${row.id}/${label}`, {
          method: "POST",
          headers: body ? { "Content-Type": "application/json" } : undefined,
          body,
        });
        const data = (await response.json()) as { status: string; message: string };
        if (!response.ok || data.status !== "success") {
          throw new Error(data.message || `Failed to ${label} journal.`);
        }
        showFeedback("success", data.message);
        await refreshAll();
      } catch (error) {
        showFeedback(
          "error",
          error instanceof Error ? error.message : `Failed to ${label} journal.`,
        );
      } finally {
        setActionId(null);
      }
    },
    [apiBase, refreshAll, showFeedback],
  );

  const handleCreateOverride = useCallback(async () => {
    if (!selectedRecord || scope !== "TENANT") return;

    setActionId(selectedRecord.id);
    try {
      const response = await fetch(`${apiBase}/${selectedRecord.id}/override`, {
        method: "POST",
      });
      const data = (await response.json()) as { status: string; message: string; id?: string };
      if (!response.ok || data.status !== "success" || !data.id) {
        throw new Error(data.message || "Failed to create tenant override.");
      }
      showFeedback("success", data.message);
      setSelectedId(data.id);
      await refreshAll();
    } catch (error) {
      showFeedback(
        "error",
        error instanceof Error ? error.message : "Failed to create tenant override.",
      );
    } finally {
      setActionId(null);
    }
  }, [apiBase, refreshAll, scope, selectedRecord, showFeedback]);

  const handlePreviewImport = useCallback(async () => {
    if (!importFile) {
      showFeedback("error", "Choose a journal file first.");
      return;
    }

    setPreviewLoading(true);
    try {
      const body = new FormData();
      body.append("file", importFile);
      if (importYear.trim().length > 0) {
        body.append("sourceYear", importYear.trim());
      }

      const response = await fetch(importPreviewUrl, {
        method: "POST",
        body,
      });
      const data = (await response.json()) as JournalImportPreviewResponse | { message?: string };
      if (!response.ok) {
        throw new Error("message" in data ? data.message : "Import preview failed.");
      }
      setPreview(data as JournalImportPreviewResponse);
      showFeedback("success", (data as JournalImportPreviewResponse).message);
      await fetchBatches();
    } catch (error) {
      showFeedback(
        "error",
        error instanceof Error ? error.message : "Import preview failed.",
      );
    } finally {
      setPreviewLoading(false);
    }
  }, [fetchBatches, importFile, importPreviewUrl, importYear, showFeedback]);

  const handleConfirmImport = useCallback(async () => {
    if (!preview) return;

    const batchId = preview.batch.id;
    const sourceYear = preview.batch.sourceYear;
    const confirmed = window.confirm(
      `Confirm import for ${sourceYear}? This will ${
        scope === "GLOBAL" ? "replace the global year snapshot" : "upsert tenant rows"
      }.`,
    );
    if (!confirmed) return;

    setConfirmingBatchId(batchId);
    try {
      const response = await fetch(
        `${apiBase}/import/${batchId}/confirm`,
        { method: "POST" },
      );
      const data = (await response.json()) as { status: string; message: string };
      if (!response.ok || data.status !== "success") {
        throw new Error(data.message || "Import confirm failed.");
      }
      showFeedback("success", data.message);
      setPreview(null);
      setImportFile(null);
      await refreshAll();
    } catch (error) {
      showFeedback(
        "error",
        error instanceof Error ? error.message : "Import confirm failed.",
      );
    } finally {
      setConfirmingBatchId(null);
    }
  }, [apiBase, preview, refreshAll, scope, showFeedback]);

  const handleConfirmBatch = useCallback(
    async (batch: JournalImportBatchView) => {
      const confirmed = window.confirm(
        `Confirm import for ${batch.sourceYear}? This will ${
          scope === "GLOBAL" ? "replace the global year snapshot" : "upsert tenant rows"
        }.`,
      );
      if (!confirmed) return;

      setConfirmingBatchId(batch.id);
      try {
        const response = await fetch(`${apiBase}/import/${batch.id}/confirm`, {
          method: "POST",
        });
        const data = (await response.json()) as { status: string; message: string };
        if (!response.ok || data.status !== "success") {
          throw new Error(data.message || "Import confirm failed.");
        }
        showFeedback("success", data.message);
        if (preview?.batch.id === batch.id) {
          setPreview(null);
          setImportFile(null);
        }
        await refreshAll();
      } catch (error) {
        showFeedback(
          "error",
          error instanceof Error ? error.message : "Import confirm failed.",
        );
      } finally {
        setConfirmingBatchId(null);
      }
    },
    [apiBase, preview, refreshAll, scope, showFeedback],
  );

  return (
    <div className="space-y-6">
      {feedback ? (
        <div
          className={`flex items-start gap-2 rounded-2xl border px-4 py-3 text-sm ${
            feedback.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {feedback.type === "success" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <span>{feedback.message}</span>
        </div>
      ) : null}

      <Panel
        eyebrow={scope === "GLOBAL" ? "Global Import" : "Tenant Import"}
        title={scope === "GLOBAL" ? "SCImago Import Wizard" : "Journal Upload Wizard"}
        description={
          scope === "GLOBAL"
            ? "Upload the raw SCImago CSV as downloaded. The wizard stores a preview first, then confirms a replace-year snapshot when you approve it."
            : "Upload either the raw SCImago file or the tenant template. Tenant imports upsert rows and can add tenant-only journals or overrides."
        }
      >
        <ImportWizardPanel
          scope={scope}
          importFile={importFile}
          importYear={importYear}
          preview={preview}
          previewLoading={previewLoading}
          confirmingBatchId={confirmingBatchId}
          importTemplateUrl={importTemplateUrl}
          onFileChange={setImportFile}
          onYearChange={setImportYear}
          onPreview={handlePreviewImport}
          onConfirm={handleConfirmImport}
        />
      </Panel>

      <Panel
        eyebrow="Catalog"
        title={scope === "GLOBAL" ? "Journal Catalog" : "Effective Journal Catalog"}
        description="Search by title, ISSN, source id, publisher, country, categories, or areas. Use filters to narrow by year, type, quartile, OA status, scope, and archived state."
      >
        <CatalogFilterBar
          scope={scope}
          loading={loading}
          filters={draftFilters}
          facets={catalog.facets}
          onChange={setDraftFilters}
          onApply={applyFilters}
          onReset={resetFilters}
          onRefresh={refreshAll}
        />
        <CatalogTable
          scope={scope}
          loading={loading}
          actionId={actionId}
          rows={catalog.rows}
          selectedId={selectedId}
          page={catalog.page}
          totalPages={totalPages}
          total={catalog.total}
          onSelect={handleSelectRow}
          onArchiveToggle={handleArchiveToggle}
          onPageChange={(page) =>
            setFilters((current) => ({
              ...current,
              page,
            }))
          }
        />
      </Panel>

      <div ref={detailPanelRef} className="scroll-mt-6">
        <Panel
          eyebrow="Detail"
          title="Journal Detail"
          description="Review the merged record, edit active rows you own, archive or restore individual rows, or create a tenant override from a global journal."
        >
          <JournalDetailPanel
            scope={scope}
            loading={detailLoading}
            record={selectedRecord}
            draft={detailDraft}
            editable={isEditable}
            saving={saving}
            actionId={actionId}
            onDraftChange={updateDraftField}
            onSave={handleSave}
            onCreateOverride={handleCreateOverride}
            onArchiveToggle={handleArchiveToggle}
          />
        </Panel>
      </div>

      <Panel
        eyebrow="History"
        title="Import History"
        description="Preview and confirm batches are auditable. A confirmed superadmin batch replaces the selected global year snapshot; tenant batches upsert tenant rows."
      >
        <EnhancedImportHistoryTable
          batches={batches}
          loading={batchLoading}
          confirmingBatchId={confirmingBatchId}
          onConfirm={handleConfirmBatch}
        />
      </Panel>
    </div>
  );
}

function ImportWizardPanel(props: {
  scope: ManagerScope;
  importFile: File | null;
  importYear: string;
  preview: JournalImportPreviewResponse | null;
  previewLoading: boolean;
  confirmingBatchId: string | null;
  importTemplateUrl: string;
  onFileChange: (file: File | null) => void;
  onYearChange: (value: string) => void;
  onPreview: () => void;
  onConfirm: () => void;
}) {
  const {
    scope,
    importFile,
    importYear,
    preview,
    previewLoading,
    confirmingBatchId,
    importTemplateUrl,
    onFileChange,
    onYearChange,
    onPreview,
    onConfirm,
  } = props;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Upload file</h3>
              <p className="mt-1 text-sm text-slate-500">
                Raw SCImago CSV files can be uploaded as-is. The preview step stores row-level issues before confirm.
              </p>
            </div>
            {scope === "TENANT" ? (
              <a
                href={`${importTemplateUrl}${importYear ? `?sourceYear=${encodeURIComponent(importYear)}` : ""}`}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300"
              >
                <Download className="h-4 w-4" />
                Template
              </a>
            ) : null}
          </div>

          <label className="mt-4 flex min-h-36 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-slate-300 bg-white/70 px-4 py-6 text-center transition hover:border-slate-400">
            <FileSpreadsheet className="h-8 w-8 text-slate-400" />
            <div>
              <p className="text-sm font-medium text-slate-700">
                {importFile ? importFile.name : "Choose CSV/XLSX file"}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {importFile
                  ? `${(importFile.size / 1024).toFixed(1)} KB`
                  : "Official SCImago downloads and the tenant template are both accepted."}
              </p>
            </div>
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
            />
          </label>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-900">Preview options</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                Source year
              </span>
              <input
                value={importYear}
                onChange={(event) => onYearChange(event.target.value)}
                placeholder="Auto-detect from file name if left blank"
                className={TEXT_INPUT_CLASS}
              />
            </label>
            <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-sm text-slate-600">
              <div className="flex items-center gap-2 font-medium text-slate-800">
                <Upload className="h-4 w-4" />
                Confirm mode
              </div>
              <p>
                {scope === "GLOBAL"
                  ? "Global confirm replaces only the selected year snapshot."
                  : "Tenant confirm upserts tenant rows and keeps unrelated tenant rows intact."}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onPreview}
            disabled={previewLoading || !importFile}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {previewLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            Preview import
          </button>
        </div>
      </div>

      {preview ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Preview results</h3>
              <p className="mt-1 text-sm text-slate-500">{preview.message}</p>
            </div>
            <button
              type="button"
              onClick={onConfirm}
              disabled={confirmingBatchId === preview.batch.id}
              className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {confirmingBatchId === preview.batch.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              Confirm import
            </button>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <SummaryChip label="Year" value={String(preview.batch.sourceYear)} />
            <SummaryChip label="Rows" value={String(preview.batch.totalRows)} />
            <SummaryChip label="Warnings" value={String(preview.batch.warningRows)} />
            <SummaryChip label="Rejected" value={String(preview.batch.rejectedRows)} />
          </div>

          <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
            <div className="max-h-80 overflow-auto">
              <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Row</th>
                    <th className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Title</th>
                    <th className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Status</th>
                    <th className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Issues</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {preview.rows.map((row) => (
                    <tr key={row.id}>
                      <td className="px-3 py-2 text-slate-500">{row.rowIndex}</td>
                      <td className="px-3 py-2 text-slate-700">{row.title ?? "Untitled row"}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
                            row.status === "VALID"
                              ? "bg-emerald-100 text-emerald-700"
                              : row.status === "WARNING"
                                ? "bg-amber-100 text-amber-700"
                                : row.status === "APPLIED"
                                  ? "bg-blue-100 text-blue-700"
                                  : "bg-rose-100 text-rose-700"
                          }`}
                        >
                          {row.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        {[...row.errors, ...row.warnings].join(" ") || "No issues"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SummaryChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function CatalogFilterBar(props: {
  scope: ManagerScope;
  loading: boolean;
  filters: Partial<JournalListFilters>;
  facets: JournalCatalogListResponse["facets"];
  onChange: Dispatch<SetStateAction<Partial<JournalListFilters>>>;
  onApply: () => void;
  onReset: () => void;
  onRefresh: () => void;
}) {
  const { scope, loading, filters, facets, onChange, onApply, onReset, onRefresh } = props;

  const setValue = <K extends keyof JournalListFilters>(
    key: K,
    value: JournalListFilters[K] | undefined,
  ) => {
    onChange((current) => ({
      ...current,
      [key]: value,
    }));
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 xl:grid-cols-5">
        <label className="xl:col-span-2">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            Search
          </span>
          <input
            value={filters.search ?? ""}
            onChange={(event) => setValue("search", event.target.value || undefined)}
            placeholder="Title, ISSN, source id, publisher, category"
            className={TEXT_INPUT_CLASS}
          />
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            Year
          </span>
          <select
            value={filters.sourceYear ?? ""}
            onChange={(event) =>
              setValue(
                "sourceYear",
                event.target.value ? Number(event.target.value) : undefined,
              )
            }
            className={SELECT_CLASS}
          >
            <option value="">Latest</option>
            {facets.years.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            Record state
          </span>
          <select
            value={filters.recordState ?? "ACTIVE"}
            onChange={(event) =>
              setValue(
                "recordState",
                event.target.value as JournalListFilters["recordState"],
              )
            }
            className={SELECT_CLASS}
          >
            <option value="ACTIVE">Active</option>
            <option value="ARCHIVED">Archived</option>
            <option value="ALL">All</option>
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            Effective source
          </span>
          <select
            value={filters.effectiveSource ?? ""}
            onChange={(event) =>
              setValue(
                "effectiveSource",
                event.target.value
                  ? (event.target.value as JournalListFilters["effectiveSource"])
                  : undefined,
              )
            }
            className={SELECT_CLASS}
          >
            <option value="">All</option>
            <option value="GLOBAL">Global</option>
            {scope === "TENANT" ? <option value="TENANT_OVERRIDE">Tenant Override</option> : null}
            {scope === "TENANT" ? <option value="TENANT_ONLY">Tenant Only</option> : null}
            <option value="ARCHIVED_GLOBAL">Archived Global</option>
            {scope === "TENANT" ? <option value="ARCHIVED_TENANT">Archived Tenant</option> : null}
          </select>
        </label>
      </div>

      <div className="grid gap-3 xl:grid-cols-7">
        <label>
          <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            Type
          </span>
          <select
            value={filters.type ?? ""}
            onChange={(event) => setValue("type", event.target.value || undefined)}
            className={SELECT_CLASS}
          >
            <option value="">All</option>
            {facets.types.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            Quartile
          </span>
          <select
            value={filters.quartile ?? ""}
            onChange={(event) => setValue("quartile", event.target.value || undefined)}
            className={SELECT_CLASS}
          >
            <option value="">All</option>
            {facets.quartiles.map((quartile) => (
              <option key={quartile} value={quartile}>
                {quartile}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            Country
          </span>
          <select
            value={filters.country ?? ""}
            onChange={(event) => setValue("country", event.target.value || undefined)}
            className={SELECT_CLASS}
          >
            <option value="">All</option>
            {facets.countries.map((country) => (
              <option key={country} value={country}>
                {country}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            Region
          </span>
          <select
            value={filters.region ?? ""}
            onChange={(event) => setValue("region", event.target.value || undefined)}
            className={SELECT_CLASS}
          >
            <option value="">All</option>
            {facets.regions.map((region) => (
              <option key={region} value={region}>
                {region}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            Open access
          </span>
          <select
            value={filters.openAccess ?? ""}
            onChange={(event) =>
              setValue(
                "openAccess",
                event.target.value
                  ? (event.target.value as JournalListFilters["openAccess"])
                  : undefined,
              )
            }
            className={SELECT_CLASS}
          >
            <option value="">All</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            OA diamond
          </span>
          <select
            value={filters.openAccessDiamond ?? ""}
            onChange={(event) =>
              setValue(
                "openAccessDiamond",
                event.target.value
                  ? (event.target.value as JournalListFilters["openAccessDiamond"])
                  : undefined,
              )
            }
            className={SELECT_CLASS}
          >
            <option value="">All</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            Policy
          </span>
          <select
            value={filters.policyStatus ?? ""}
            onChange={(event) =>
              setValue(
                "policyStatus",
                event.target.value
                  ? (event.target.value as JournalPolicyStatus)
                  : undefined,
              )
            }
            className={SELECT_CLASS}
          >
            <option value="">All</option>
            {facets.policyStatuses.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.4fr_1fr_1fr_1fr_auto]">
        <label>
          <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            Publisher
          </span>
          <input
            value={filters.publisher ?? ""}
            onChange={(event) => setValue("publisher", event.target.value || undefined)}
            placeholder="Publisher filter"
            className={TEXT_INPUT_CLASS}
          />
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            Sort field
          </span>
          <select
            value={filters.sortField ?? "title"}
            onChange={(event) =>
              setValue(
                "sortField",
                event.target.value as JournalListFilters["sortField"],
              )
            }
            className={SELECT_CLASS}
          >
            <option value="title">Title</option>
            <option value="sourceYear">Year</option>
            <option value="sjrBestQuartile">Quartile</option>
            <option value="sjr">SJR</option>
            <option value="hIndex">H-Index</option>
            <option value="updatedAt">Updated</option>
            <option value="createdAt">Created</option>
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            Sort direction
          </span>
          <select
            value={filters.sortDirection ?? "asc"}
            onChange={(event) =>
              setValue(
                "sortDirection",
                event.target.value as JournalListFilters["sortDirection"],
              )
            }
            className={SELECT_CLASS}
          >
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
        </label>
        <label className="flex items-end gap-2 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2">
          <input
            type="checkbox"
            checked={Boolean(filters.onlyEligibleJournals)}
            onChange={(event) => setValue("onlyEligibleJournals", event.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          <span className="text-sm text-slate-700">Journal-only eligible view</span>
        </label>
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={onApply}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Filter className="h-4 w-4" />
            Apply
          </button>
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-300"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-300"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </div>
    </div>
  );
}

function CatalogTable(props: {
  scope: ManagerScope;
  loading: boolean;
  actionId: string | null;
  rows: JournalCatalogRecordView[];
  selectedId: string | null;
  page: number;
  totalPages: number;
  total: number;
  onSelect: (id: string) => void;
  onArchiveToggle: (
    row: JournalCatalogRecordView,
    action: "archive" | "restore",
  ) => void;
  onPageChange: (page: number) => void;
}) {
  const {
    scope,
    loading,
    actionId,
    rows,
    selectedId,
    page,
    totalPages,
    total,
    onSelect,
    onArchiveToggle,
    onPageChange,
  } = props;
  const canMutateRow = (row: JournalCatalogRecordView) =>
    scope === "GLOBAL" || row.scope === "TENANT";

  if (loading) {
    return (
      <div className="mt-6 flex items-center justify-center rounded-2xl border border-slate-200 bg-slate-50/70 py-12 text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      <div className="overflow-hidden rounded-2xl border border-slate-200">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Title</th>
                <th className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">ISSN</th>
                <th className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Type</th>
                <th className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Year</th>
                <th className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Quartile</th>
                <th className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Source</th>
                <th className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className={`align-top transition ${
                    selectedId === row.id ? "bg-blue-50/60" : ""
                  }`}
                >
                  <td className="px-3 py-3">
                    <div className="font-medium text-slate-900">{row.title}</div>
                    <div className="mt-1 text-xs text-slate-500">{row.publisher ?? "No publisher"}</div>
                    {resolvePolicyStatus(row.policyStatus) !== "ALLOWED" ? (
                      <div
                        className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          resolvePolicyStatus(row.policyStatus) === "BLACKLISTED"
                            ? "bg-rose-100 text-rose-700"
                            : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {resolvePolicyStatus(row.policyStatus) === "BLACKLISTED" ? "Blacklisted" : "Disabled"}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-3 text-slate-600">{row.issnPrimary ?? row.issnRaw ?? "-"}</td>
                  <td className="px-3 py-3 text-slate-600">{row.type}</td>
                  <td className="px-3 py-3 text-slate-600">{row.sourceYear}</td>
                  <td className="px-3 py-3 text-slate-600">{row.sjrBestQuartile ?? "-"}</td>
                  <td className="px-3 py-3">
                    <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${badgeClass(row.effectiveSource)}`}>
                      {formatEffectiveSource(row.effectiveSource)}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => onSelect(row.id)}
                        className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                          selectedId === row.id
                            ? "border-blue-300 bg-blue-50 text-blue-700"
                            : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                        }`}
                      >
                        <Eye className="h-3.5 w-3.5" />
                        {selectedId === row.id ? "Viewing" : canMutateRow(row) ? "View / Edit" : "View"}
                      </button>
                      {canMutateRow(row) && !row.isArchived ? (
                        <button
                          type="button"
                          onClick={() => onArchiveToggle(row, "archive")}
                          disabled={actionId === row.id}
                          className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
                        >
                          {actionId === row.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Archive className="h-3.5 w-3.5" />
                          )}
                          Archive
                        </button>
                      ) : canMutateRow(row) ? (
                        <button
                          type="button"
                          onClick={() => onArchiveToggle(row, "restore")}
                          disabled={actionId === row.id}
                          className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60"
                        >
                          {actionId === row.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RefreshCcw className="h-3.5 w-3.5" />
                          )}
                          Restore
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">
                    {scope === "GLOBAL"
                      ? "No global journal rows matched the current filters."
                      : "No effective journal rows matched the current filters."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between text-sm text-slate-600">
        <span>{total} row(s)</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Prev
          </button>
          <span>
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

function JournalDetailPanel(props: {
  scope: ManagerScope;
  loading: boolean;
  record: JournalCatalogRecordView | null;
  draft: JournalUpdateInput | null;
  editable: boolean;
  saving: boolean;
  actionId: string | null;
  onDraftChange: (
    key: keyof JournalUpdateInput,
    value: string | number | boolean | null,
  ) => void;
  onSave: () => void;
  onCreateOverride: () => void;
  onArchiveToggle: (
    row: JournalCatalogRecordView,
    action: "archive" | "restore",
  ) => void;
}) {
  const {
    scope,
    loading,
    record,
    draft,
    editable,
    saving,
    actionId,
    onDraftChange,
    onSave,
    onCreateOverride,
    onArchiveToggle,
  } = props;
  const canMutateRecord = !record
    ? false
    : scope === "GLOBAL" || record.scope === "TENANT";

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-slate-50/70 py-12 text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!record || !draft) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-12 text-center text-sm text-slate-500">
        Select a journal row to inspect or edit it.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-slate-900">{record.title}</h3>
            <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${badgeClass(record.effectiveSource)}`}>
              {formatEffectiveSource(record.effectiveSource)}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            {record.type} · {record.sourceYear} · {record.issnPrimary ?? record.issnRaw ?? "No ISSN"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {scope === "TENANT" && record.scope === "GLOBAL" && !record.isArchived ? (
            <button
              type="button"
              onClick={onCreateOverride}
              disabled={actionId === record.id}
              className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-60"
            >
              {actionId === record.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Pencil className="h-4 w-4" />
              )}
              Create tenant override
            </button>
          ) : null}

          {canMutateRecord && !record.isArchived ? (
            <button
              type="button"
              onClick={() => onArchiveToggle(record, "archive")}
              disabled={actionId === record.id}
              className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
            >
              <Archive className="h-4 w-4" />
              Archive
            </button>
          ) : canMutateRecord ? (
            <button
              type="button"
              onClick={() => onArchiveToggle(record, "restore")}
              disabled={actionId === record.id}
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60"
            >
              <RefreshCcw className="h-4 w-4" />
              Restore
            </button>
          ) : null}
        </div>
      </div>

      {!editable ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm text-slate-600">
          {record.scope === "GLOBAL" && scope === "TENANT"
            ? "This is a global row. Create a tenant override to edit it without changing the platform-wide catalog."
            : "This row is read-only in its current state."}
        </div>
      ) : null}

      {resolvePolicyStatus(draft.policyStatus) !== "ALLOWED" ? (
        <div
          className={`rounded-2xl border px-4 py-4 text-sm ${
            resolvePolicyStatus(draft.policyStatus) === "BLACKLISTED"
              ? "border-rose-200 bg-rose-50 text-rose-800"
              : "border-amber-200 bg-amber-50 text-amber-800"
          }`}
        >
          <div className="font-medium">
            {resolvePolicyStatus(draft.policyStatus) === "BLACKLISTED"
              ? "This journal is blacklisted for this catalog scope."
              : "This journal is disabled for this catalog scope."}
          </div>
          {draft.policyNote ? <div className="mt-1">{draft.policyNote}</div> : null}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {DETAIL_TEXT_FIELDS.map((field) => (
          <label key={field.key} className="space-y-1">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
              {field.label}
            </span>
            <input
              type={field.type === "number" ? "number" : "text"}
              value={
                draft[field.key] == null
                  ? ""
                  : typeof draft[field.key] === "boolean"
                    ? String(draft[field.key])
                    : String(draft[field.key])
              }
              onChange={(event) =>
                onDraftChange(
                  field.key,
                  field.type === "number"
                    ? event.target.value === ""
                      ? null
                      : Number(event.target.value)
                    : event.target.value || null,
                )
              }
              disabled={!editable}
              className={TEXT_INPUT_CLASS}
            />
          </label>
        ))}

        <label className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            Is open access
          </span>
          <select
            value={draft.isOpenAccess == null ? "" : draft.isOpenAccess ? "true" : "false"}
            onChange={(event) =>
              onDraftChange(
                "isOpenAccess",
                event.target.value === ""
                  ? null
                  : event.target.value === "true",
              )
            }
            disabled={!editable}
            className={SELECT_CLASS}
          >
            <option value="">Unknown</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            Journal Policy
          </span>
          <select
            value={resolvePolicyStatus(draft.policyStatus)}
            onChange={(event) =>
              onDraftChange(
                "policyStatus",
                event.target.value as JournalPolicyStatus,
              )
            }
            disabled={!editable}
            className={SELECT_CLASS}
          >
            <option value="ALLOWED">Allowed</option>
            <option value="DISABLED">Disabled</option>
            <option value="BLACKLISTED">Blacklisted</option>
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            Is OA diamond
          </span>
          <select
            value={
              draft.isOpenAccessDiamond == null
                ? ""
                : draft.isOpenAccessDiamond
                  ? "true"
                  : "false"
            }
            onChange={(event) =>
              onDraftChange(
                "isOpenAccessDiamond",
                event.target.value === ""
                  ? null
                  : event.target.value === "true",
              )
            }
            disabled={!editable}
            className={SELECT_CLASS}
          >
            <option value="">Unknown</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </label>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {DETAIL_TEXTAREA_FIELDS.map((field) => (
          <label key={field.key} className="space-y-1">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
              {field.label}
            </span>
            <textarea
              value={draft[field.key] == null ? "" : String(draft[field.key])}
              onChange={(event) => onDraftChange(field.key, event.target.value || null)}
              disabled={!editable}
              rows={4}
              className={`${TEXT_INPUT_CLASS} min-h-28`}
            />
          </label>
        ))}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onSave}
          disabled={!editable || saving}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          Save changes
        </button>
      </div>
    </div>
  );
}

function ImportHistoryTable(props: {
  batches: JournalImportBatchView[];
  loading: boolean;
  confirmingBatchId: string | null;
  onConfirm: (batch: JournalImportBatchView) => void;
}) {
  const { batches, loading, confirmingBatchId, onConfirm } = props;

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-slate-50/70 py-10 text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Created</th>
              <th className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">File</th>
              <th className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Year</th>
              <th className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Mode</th>
              <th className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Status</th>
              <th className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Counts</th>
              <th className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 bg-white">
            {batches.map((batch) => (
              <tr key={batch.id}>
                <td className="px-3 py-3 text-slate-600">
                  {new Date(batch.createdAt).toLocaleString()}
                </td>
                <td className="px-3 py-3 text-slate-700">{batch.fileName}</td>
                <td className="px-3 py-3 text-slate-600">{batch.sourceYear}</td>
                <td className="px-3 py-3 text-slate-600">{batch.mode}</td>
                <td className="px-3 py-3">
                  <span
                    className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
                      batch.status === "CONFIRMED"
                        ? "bg-emerald-100 text-emerald-700"
                        : batch.status === "FAILED"
                          ? "bg-rose-100 text-rose-700"
                          : batch.status === "APPLYING"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {batch.status}
                  </span>
                </td>
                <td className="px-3 py-3 text-xs text-slate-600">
                  {batch.validRows} valid · {batch.warningRows} warnings · {batch.rejectedRows} rejected
                </td>
              </tr>
            ))}
            {batches.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">
                  No import history yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EnhancedImportHistoryTable(props: {
  batches: JournalImportBatchView[];
  loading: boolean;
  confirmingBatchId: string | null;
  onConfirm: (batch: JournalImportBatchView) => void;
}) {
  const { batches, loading, confirmingBatchId, onConfirm } = props;

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-slate-50/70 py-10 text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Created</th>
              <th className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">File</th>
              <th className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Year</th>
              <th className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Mode</th>
              <th className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Status</th>
              <th className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Counts</th>
              <th className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 bg-white">
            {batches.map((batch) => (
              <tr key={batch.id}>
                <td className="px-3 py-3 text-slate-600">
                  {new Date(batch.createdAt).toLocaleString()}
                </td>
                <td className="px-3 py-3 text-slate-700">{batch.fileName}</td>
                <td className="px-3 py-3 text-slate-600">{batch.sourceYear}</td>
                <td className="px-3 py-3 text-slate-600">{batch.mode}</td>
                <td className="px-3 py-3">
                  <span
                    className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
                      batch.status === "CONFIRMED"
                        ? "bg-emerald-100 text-emerald-700"
                        : batch.status === "FAILED"
                          ? "bg-rose-100 text-rose-700"
                          : batch.status === "APPLYING"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {batch.status}
                  </span>
                </td>
                <td className="px-3 py-3 text-xs text-slate-600">
                  <div>
                    {batch.validRows} valid · {batch.warningRows} warnings · {batch.rejectedRows} rejected
                  </div>
                  {batch.appliedRows > 0 ? (
                    <div className="mt-1 text-emerald-700">{batch.appliedRows} applied</div>
                  ) : null}
                  {batch.failureMessage ? (
                    <div className="mt-1 max-w-xl text-rose-700">{batch.failureMessage}</div>
                  ) : null}
                </td>
                <td className="px-3 py-3">
                  {batch.status === "VALIDATED" || batch.status === "FAILED" ? (
                    <button
                      type="button"
                      onClick={() => onConfirm(batch)}
                      disabled={confirmingBatchId === batch.id}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {confirmingBatchId === batch.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : null}
                      {batch.status === "FAILED" ? "Retry Import" : "Confirm Import"}
                    </button>
                  ) : (
                    <span className="text-xs text-slate-400">-</span>
                  )}
                </td>
              </tr>
            ))}
            {batches.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">
                  No import history yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
