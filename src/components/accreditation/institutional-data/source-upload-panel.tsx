"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload } from "lucide-react";
import { inputClassName, labelClassName } from "./constants";
import type { ImportPreview, SourceDetail, TemplateVariant } from "./use-institutional-data";

type Props = {
  source: SourceDetail;
  saving: boolean;
  importPreview: ImportPreview | null;
  onSaveSnapshot: (sourceId: string, payload: Record<string, unknown>) => Promise<void>;
  onPreviewImport: (
    sourceId: string,
    file: File,
    year: number | null,
    scopeKey: string | null,
    replaceRows: boolean,
    importVariant: TemplateVariant,
    headerRowIndex: number | null,
    resolvedMappings?: ImportPreview["resolvedMappings"],
  ) => Promise<void>;
  onApplyImport: (
    sourceId: string,
    file: File,
    year: number | null,
    scopeKey: string | null,
    replaceRows: boolean,
    importVariant: TemplateVariant,
    headerRowIndex: number | null,
    resolvedMappings?: ImportPreview["resolvedMappings"],
  ) => Promise<void>;
  onDownloadTemplate: (sourceId: string, format: "csv" | "xlsx", variant: TemplateVariant) => Promise<void>;
  onClearPreview: () => void;
};

const VARIANT_OPTIONS: Array<{
  value: TemplateVariant;
  label: string;
  description: string;
}> = [
  { value: "MINIMAL", label: "Minimal", description: "Smallest required set for a first upload." },
  { value: "STANDARD", label: "Standard", description: "Recommended option for most institutions." },
  { value: "FULL", label: "Full", description: "Best for long-term and multi-agency reuse." },
];

const READINESS_STYLES: Record<ImportPreview["sourceReadiness"]["status"], string> = {
  READY: "border-emerald-200 bg-emerald-50 text-emerald-700",
  PARTIAL: "border-amber-200 bg-amber-50 text-amber-700",
  MISSING: "border-rose-200 bg-rose-50 text-rose-700",
};

export function SourceUploadPanel({
  source,
  saving,
  importPreview,
  onSaveSnapshot,
  onPreviewImport,
  onApplyImport,
  onDownloadTemplate,
  onClearPreview,
}: Props) {
  const showDatasetImport = source.shape === "DATASET";
  const showManualEntry = source.shape === "SCALAR" || source.shape === "NARRATIVE";

  if (!showDatasetImport && !showManualEntry) return null;

  return (
    <div className="space-y-6">
      {showManualEntry ? (
        <ManualSnapshotForm source={source} saving={saving} onSave={onSaveSnapshot} />
      ) : null}

      {showDatasetImport ? (
        <DatasetImportForm
          source={source}
          saving={saving}
          importPreview={importPreview}
          onPreview={onPreviewImport}
          onApply={onApplyImport}
          onDownloadTemplate={onDownloadTemplate}
          onClearPreview={onClearPreview}
        />
      ) : null}
    </div>
  );
}

function ManualSnapshotForm({
  source,
  saving,
  onSave,
}: {
  source: SourceDetail;
  saving: boolean;
  onSave: (sourceId: string, payload: Record<string, unknown>) => Promise<void>;
}) {
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const yearText = String(fd.get("observedYear") ?? "").trim();
    const numText = String(fd.get("numberValue") ?? "").trim();
    void onSave(source.id, {
      observedYear: yearText ? Number(yearText) : null,
      scopeKey: String(fd.get("scopeKey") ?? "") || null,
      numberValue: numText ? Number(numText) : null,
      textValue: String(fd.get("textValue") ?? "") || null,
    });
  }

  return (
    <div className="rounded-2xl border border-slate-200 p-5">
      <div className="mb-4 flex items-center gap-2">
        <Upload className="h-4 w-4 text-slate-400" />
        <h4 className="text-sm font-semibold text-slate-900">Enter Data Manually</h4>
      </div>
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClassName} htmlFor="snap-year">Year</label>
            <input id="snap-year" className={inputClassName} name="observedYear" type="number" placeholder="e.g. 2025" />
          </div>
          <div>
            <label className={labelClassName} htmlFor="snap-scope">Scope (optional)</label>
            <input id="snap-scope" className={inputClassName} name="scopeKey" placeholder="e.g. department name" />
          </div>
        </div>

        {source.shape === "SCALAR" ? (
          <div>
            <label className={labelClassName} htmlFor="snap-num">Value</label>
            <input id="snap-num" className={inputClassName} name="numberValue" type="number" step="any" placeholder="Numeric value" />
          </div>
        ) : null}

        <div>
          <label className={labelClassName} htmlFor="snap-text">
            {source.shape === "NARRATIVE" ? "Narrative Text" : "Text Value (optional)"}
          </label>
          <textarea id="snap-text" className={`${inputClassName} min-h-[5rem]`} name="textValue" placeholder="Enter text..." />
        </div>

        <button
          type="submit"
          disabled={saving}
          className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:bg-slate-300"
        >
          {saving ? "Saving..." : "Save Value"}
        </button>
      </form>
    </div>
  );
}

function DatasetImportForm({
  source,
  saving,
  importPreview,
  onPreview,
  onApply,
  onDownloadTemplate,
  onClearPreview,
}: {
  source: SourceDetail;
  saving: boolean;
  importPreview: ImportPreview | null;
  onPreview: Props["onPreviewImport"];
  onApply: Props["onApplyImport"];
  onDownloadTemplate: Props["onDownloadTemplate"];
  onClearPreview: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [year, setYear] = useState("");
  const [scopeKey, setScopeKey] = useState("");
  const [replaceRows, setReplaceRows] = useState(true);
  const [variant, setVariant] = useState<TemplateVariant>("STANDARD");
  const [headerRowIndex, setHeaderRowIndex] = useState("");

  const guide = source.datasetSchema?.guide;
  const availableVariants = useMemo(
    () => (source.datasetSchema?.availableVariants?.length ? source.datasetSchema.availableVariants : VARIANT_OPTIONS.map((option) => option.value)),
    [source.datasetSchema?.availableVariants],
  );

  function getParams() {
    if (!file) return null;
    return [
      file,
      year.trim() ? Number(year.trim()) : null,
      scopeKey.trim() || null,
      replaceRows,
      variant,
      headerRowIndex.trim() ? Number(headerRowIndex.trim()) : null,
      importPreview?.resolvedMappings,
    ] as const;
  }

  function handlePreview() {
    const params = getParams();
    if (!params) return;
    void onPreview(source.id, ...params);
  }

  function handleApply() {
    const params = getParams();
    if (!params) return;
    void onApply(source.id, ...params).then(() => {
      setFile(null);
      setYear("");
      setScopeKey("");
      setHeaderRowIndex("");
      onClearPreview();
    });
  }

  const canImport = !!file && !(importPreview?.blockingIssues.length ?? 0);

  return (
    <div className="space-y-5 rounded-2xl border border-slate-200 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-slate-400" />
            <h4 className="text-sm font-semibold text-slate-900">Build This Data Source</h4>
          </div>
          <p className="text-sm text-slate-600">
            Upload whatever data you already have. The system will warn about missing fields and import the usable rows.
          </p>
        </div>
        <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600">
          Spreadsheet upload
        </span>
      </div>

      {guide ? (
        <div className="grid gap-3 md:grid-cols-3">
          <InfoCard label="Usually owned by" value={guide.ownerOffice} />
          <InfoCard label="Minimum data needed" value={guide.minimumDataHint} />
          <InfoCard
            label="Supports partial upload"
            value={guide.supportsPartialUpload ? "Yes, warnings only for missing optional or recommended data." : "No"}
          />
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-4">
        <StepCard step="1" title="Download template" description="Pick a template level and start from the sample sheet." />
        <StepCard step="2" title="Prepare your file" description="Keep your own headers if needed. We try to match them automatically." />
        <StepCard step="3" title="Review warnings" description="Check missing fields, skipped rows, and detected header row before import." />
        <StepCard step="4" title="Import and use" description="Only valid rows are imported. You can improve completeness later." />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr),22rem]">
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
          <div>
            <label className={labelClassName}>Template Level</label>
            <div className="grid gap-2 sm:grid-cols-3">
              {VARIANT_OPTIONS.filter((option) => availableVariants.includes(option.value)).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setVariant(option.value);
                    onClearPreview();
                  }}
                  className={`rounded-2xl border px-3 py-3 text-left transition ${
                    variant === option.value
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                  }`}
                >
                  <div className="text-sm font-semibold">{option.label}</div>
                  <div className={`mt-1 text-xs ${variant === option.value ? "text-slate-200" : "text-slate-500"}`}>
                    {option.description}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void onDownloadTemplate(source.id, "xlsx", variant)}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-400"
            >
              <Download className="h-3.5 w-3.5" />
              Download XLSX
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void onDownloadTemplate(source.id, "csv", variant)}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-400"
            >
              <Download className="h-3.5 w-3.5" />
              Download CSV
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={labelClassName} htmlFor="import-file">Choose file</label>
              <input
                id="import-file"
                className={inputClassName}
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  onClearPreview();
                }}
              />
            </div>
            <div>
              <label className={labelClassName} htmlFor="import-year">Year (optional)</label>
              <input id="import-year" className={inputClassName} type="number" value={year} onChange={(event) => setYear(event.target.value)} placeholder="e.g. 2025" />
            </div>
            <div>
              <label className={labelClassName} htmlFor="import-scope">Department / scope (optional)</label>
              <input id="import-scope" className={inputClassName} value={scopeKey} onChange={(event) => setScopeKey(event.target.value)} placeholder="Institution-wide if blank" />
            </div>
            <div>
              <label className={labelClassName} htmlFor="import-header-row">Header row (optional)</label>
              <input
                id="import-header-row"
                className={inputClassName}
                type="number"
                min={0}
                value={headerRowIndex}
                onChange={(event) => setHeaderRowIndex(event.target.value)}
                placeholder={importPreview ? String(importPreview.selectedHeaderRowIndex) : "Auto-detect"}
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                <input type="checkbox" checked={replaceRows} onChange={(event) => setReplaceRows(event.target.checked)} />
                Replace existing rows for the same year and scope
              </label>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={saving || !file}
              onClick={handlePreview}
              className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-400"
            >
              Review Upload
            </button>
            <button
              type="button"
              disabled={saving || !canImport}
              onClick={handleApply}
              className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:bg-slate-300"
            >
              {saving ? "Importing..." : "Import Valid Rows"}
            </button>
          </div>
        </div>

        <div className="space-y-3 rounded-2xl border border-slate-200 p-4">
          <h5 className="text-sm font-semibold text-slate-900">What this source helps answer</h5>
          <p className="text-sm text-slate-600">
            {guide?.summary ?? "This upload feeds your institutional databank and linked accreditation metrics."}
          </p>
          <div className="flex flex-wrap gap-2">
            {(guide?.supportedMetrics ?? []).slice(0, 10).map((metric) => (
              <span key={metric} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">
                {metric}
              </span>
            ))}
          </div>
          <div className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-600">
            <div className="font-medium text-slate-900">Plain-language rule</div>
            <div className="mt-1">
              Core fields matter most. Missing recommended fields create warnings. Rows with no usable identity or missing core fields are skipped.
            </div>
          </div>
        </div>
      </div>

      {importPreview ? (
        <PreviewPanel importPreview={importPreview} />
      ) : null}
    </div>
  );
}

function PreviewPanel({ importPreview }: { importPreview: ImportPreview }) {
  const readinessClass = READINESS_STYLES[importPreview.sourceReadiness.status];

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h5 className="text-sm font-semibold text-slate-900">Upload Review</h5>
          <p className="mt-1 text-sm text-slate-600">
            {importPreview.validRowCount} valid row{importPreview.validRowCount !== 1 ? "s" : ""} ready to import,
            {" "}
            {importPreview.skippedRowCount} skipped.
          </p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-medium ${readinessClass}`}>
          {importPreview.sourceReadiness.status} · {importPreview.sourceReadiness.score}% ready
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <ReviewStat label="Detected header row" value={String(importPreview.selectedHeaderRowIndex)} />
        <ReviewStat label="Rows found" value={String(importPreview.rowCount)} />
        <ReviewStat label="Valid rows" value={String(importPreview.validRowCount)} />
        <ReviewStat label="Skipped rows" value={String(importPreview.skippedRowCount)} />
      </div>

      {importPreview.blockingIssues.length > 0 ? (
        <IssueList
          title="Blocking issues"
          items={importPreview.blockingIssues.map((issue) => issue.message)}
          variant="error"
        />
      ) : null}

      {importPreview.warnings.length > 0 ? (
        <IssueList
          title="Warnings"
          items={importPreview.warnings.map((warning) => warning.message)}
          variant="warning"
        />
      ) : null}

      {importPreview.rowIssueSample.length > 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <h6 className="text-sm font-semibold text-slate-900">Rows skipped</h6>
          <div className="mt-3 space-y-2">
            {importPreview.rowIssueSample.slice(0, 5).map((row) => (
              <div key={row.rowIndex} className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
                <span className="font-medium text-slate-900">Row {row.rowIndex}</span>: {row.issues.join(" ")}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <h6 className="text-sm font-semibold text-slate-900">What this upload now enables</h6>
          <div className="mt-3 flex flex-wrap gap-2">
            {importPreview.coverageByMetric.filter((metric) => metric.status === "READY").length > 0 ? (
              importPreview.coverageByMetric
                .filter((metric) => metric.status === "READY")
                .slice(0, 8)
                .map((metric) => (
                  <span key={metric.metricCode} className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs text-emerald-700">
                    {metric.metricCode}
                  </span>
                ))
            ) : (
              <p className="text-sm text-slate-500">No linked metrics are fully ready yet.</p>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <h6 className="text-sm font-semibold text-slate-900">What is still missing</h6>
          <div className="mt-3 flex flex-wrap gap-2">
            {importPreview.coverageByMetric.filter((metric) => metric.status !== "READY").length > 0 ? (
              importPreview.coverageByMetric
                .filter((metric) => metric.status !== "READY")
                .slice(0, 8)
                .map((metric) => (
                  <span key={metric.metricCode} className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-700">
                    {metric.metricCode} · {metric.status.toLowerCase()}
                  </span>
                ))
            ) : (
              <p className="text-sm text-slate-500">No major gaps detected for the linked metrics in this source.</p>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <h6 className="text-sm font-semibold text-slate-900">Detected columns</h6>
        <p className="mt-1 text-sm text-slate-600">{importPreview.detectedHeaders.join(", ")}</p>
      </div>
    </div>
  );
}

function StepCard({ step, title, description }: { step: string; title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <div className="mb-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
        {step}
      </div>
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      <div className="mt-1 text-sm text-slate-600">{description}</div>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">{label}</div>
      <div className="mt-1 text-sm text-slate-700">{value}</div>
    </div>
  );
}

function ReviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">{label}</div>
      <div className="mt-1 text-lg font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function IssueList({
  title,
  items,
  variant,
}: {
  title: string;
  items: string[];
  variant: "warning" | "error";
}) {
  const isError = variant === "error";
  return (
    <div className={`rounded-2xl border p-4 ${isError ? "border-rose-200 bg-rose-50" : "border-amber-200 bg-amber-50"}`}>
      <div className={`mb-3 flex items-center gap-2 text-sm font-semibold ${isError ? "text-rose-700" : "text-amber-700"}`}>
        {isError ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
        {title}
      </div>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item} className={`rounded-xl px-3 py-2 text-sm ${isError ? "bg-white text-rose-700" : "bg-white text-amber-700"}`}>
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}
