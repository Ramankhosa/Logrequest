"use client";

import { useState } from "react";
import { Upload, FileSpreadsheet } from "lucide-react";
import { inputClassName, labelClassName } from "./constants";
import type { ImportPreview, SourceDetail } from "./use-institutional-data";

type Props = {
  source: SourceDetail;
  saving: boolean;
  importPreview: ImportPreview | null;
  onSaveSnapshot: (sourceId: string, payload: Record<string, unknown>) => Promise<void>;
  onPreviewImport: (sourceId: string, file: File, year: number | null, scopeKey: string | null, replaceRows: boolean) => Promise<void>;
  onApplyImport: (sourceId: string, file: File, year: number | null, scopeKey: string | null, replaceRows: boolean) => Promise<void>;
  onClearPreview: () => void;
};

export function SourceUploadPanel({
  source,
  saving,
  importPreview,
  onSaveSnapshot,
  onPreviewImport,
  onApplyImport,
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
          onClearPreview={onClearPreview}
        />
      ) : null}
    </div>
  );
}

// ── Manual snapshot entry ──

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
          <label className={labelClassName} htmlFor="snap-text">{source.shape === "NARRATIVE" ? "Narrative Text" : "Text Value (optional)"}</label>
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

// ── Dataset import (spreadsheet upload) ──

function DatasetImportForm({
  source,
  saving,
  importPreview,
  onPreview,
  onApply,
  onClearPreview,
}: {
  source: SourceDetail;
  saving: boolean;
  importPreview: ImportPreview | null;
  onPreview: (sourceId: string, file: File, year: number | null, scopeKey: string | null, replaceRows: boolean) => Promise<void>;
  onApply: (sourceId: string, file: File, year: number | null, scopeKey: string | null, replaceRows: boolean) => Promise<void>;
  onClearPreview: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [year, setYear] = useState("");
  const [scopeKey, setScopeKey] = useState("");
  const [replaceRows, setReplaceRows] = useState(true);

  function getParams(): [File, number | null, string | null, boolean] | null {
    if (!file) return null;
    return [file, year.trim() ? Number(year.trim()) : null, scopeKey || null, replaceRows];
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
      onClearPreview();
    });
  }

  return (
    <div className="rounded-2xl border border-slate-200 p-5">
      <div className="mb-4 flex items-center gap-2">
        <FileSpreadsheet className="h-4 w-4 text-slate-400" />
        <h4 className="text-sm font-semibold text-slate-900">Import Spreadsheet</h4>
      </div>
      <p className="mb-4 text-xs text-slate-500">
        Upload a CSV or Excel file (.csv, .xlsx, .xls). The first row should contain column headers.
      </p>

      <div className="space-y-4">
        <div>
          <label className={labelClassName} htmlFor="import-file">File</label>
          <input
            id="import-file"
            className={inputClassName}
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); onClearPreview(); }}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClassName} htmlFor="import-year">Year (optional)</label>
            <input id="import-year" className={inputClassName} type="number" placeholder="e.g. 2025" value={year} onChange={(e) => setYear(e.target.value)} />
          </div>
          <div>
            <label className={labelClassName} htmlFor="import-scope">Scope (optional)</label>
            <input id="import-scope" className={inputClassName} placeholder="e.g. department name" value={scopeKey} onChange={(e) => setScopeKey(e.target.value)} />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={replaceRows} onChange={(e) => setReplaceRows(e.target.checked)} />
          Replace existing rows (recommended)
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={saving || !file}
            onClick={handlePreview}
            className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-400"
          >
            Preview
          </button>
          <button
            type="button"
            disabled={saving || !file}
            onClick={handleApply}
            className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:bg-slate-300"
          >
            {saving ? "Importing..." : "Import Data"}
          </button>
        </div>

        {importPreview ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
            <p className="font-medium text-slate-900">Preview: {importPreview.rowCount} rows detected</p>
            <p className="mt-1 text-slate-600">Columns: {importPreview.columns.join(", ")}</p>
            <p className="mt-1 text-slate-600">Scope: {importPreview.scopeKey}</p>
            {importPreview.existingSnapshot ? (
              <p className="mt-2 text-amber-700">
                This will replace an existing snapshot with {importPreview.existingSnapshot.rowCount} rows.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
