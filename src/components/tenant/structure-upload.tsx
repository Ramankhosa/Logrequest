"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Upload,
  FileSpreadsheet,
  AlertCircle,
  CheckCircle2,
  X,
  Loader2,
  Download,
  AlertTriangle,
} from "lucide-react";

type ParsedRow = {
  rowIndex: number;
  typeKey: string;
  code: string;
  name: string;
  parentCode: string | null;
  errors: string[];
  warnings: string[];
};

type PreviewData = {
  rows: ParsedRow[];
  validCount: number;
  errorCount: number;
  warningCount: number;
};

export function StructureUpload() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const reset = () => {
    setFile(null);
    setPreview(null);
    setFeedback(null);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) handleFile(dropped);
  }, []);

  const handleFile = async (f: File) => {
    const validTypes = [
      "text/csv",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
    ];
    const validExtensions = [".csv", ".xlsx", ".xls"];
    const ext = f.name.substring(f.name.lastIndexOf(".")).toLowerCase();

    if (!validTypes.includes(f.type) && !validExtensions.includes(ext)) {
      setFeedback({
        type: "error",
        message: "Please upload a CSV or Excel file (.csv, .xlsx, .xls).",
      });
      return;
    }

    setFile(f);
    setFeedback(null);
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", f);
      formData.append("action", "preview");

      const res = await fetch("/api/tenant/structure/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (data.status === "error") {
        setFeedback({ type: "error", message: data.message });
        setPreview(null);
      } else {
        setPreview(data.data as PreviewData);
      }
    } catch {
      setFeedback({ type: "error", message: "Failed to parse file." });
    } finally {
      setUploading(false);
    }
  };

  const handleConfirm = async () => {
    if (!file) return;
    setConfirming(true);
    setFeedback(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("action", "confirm");

      const res = await fetch("/api/tenant/structure/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (data.status === "error") {
        setFeedback({ type: "error", message: data.message });
      } else {
        setFeedback({ type: "success", message: data.message });
        setPreview(null);
        setFile(null);
        startTransition(() => router.refresh());
      }
    } catch {
      setFeedback({ type: "error", message: "Import request failed." });
    } finally {
      setConfirming(false);
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      const res = await fetch("/api/tenant/structure/upload/template");
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "org-structure-template.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setFeedback({
        type: "error",
        message: "Failed to download template.",
      });
    }
  };

  return (
    <div className="space-y-5">
      {/* Header with template download */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Import from file
          </h3>
          <p className="mt-0.5 text-xs text-slate-400">
            Upload a CSV or Excel file to bulk-import units into the draft
          </p>
        </div>
        <button
          type="button"
          onClick={handleDownloadTemplate}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:border-slate-300"
        >
          <Download className="h-3.5 w-3.5" />
          Download template
        </button>
      </div>

      {/* Drop zone */}
      {!preview ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`relative flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed py-12 text-center transition ${
            dragging
              ? "border-brand bg-brand/5"
              : "border-slate-200 hover:border-slate-300"
          }`}
        >
          {uploading ? (
            <>
              <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
              <p className="text-sm text-slate-500">Parsing file…</p>
            </>
          ) : (
            <>
              <FileSpreadsheet className="h-8 w-8 text-slate-300" />
              <div>
                <p className="text-sm font-medium text-slate-600">
                  Drop a file here, or{" "}
                  <label className="cursor-pointer font-semibold text-brand hover:underline">
                    browse
                    <input
                      type="file"
                      accept=".csv,.xlsx,.xls"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleFile(f);
                      }}
                    />
                  </label>
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  CSV, XLSX, or XLS — columns: type_key, unit_code, unit_name,
                  parent_code
                </p>
              </div>
            </>
          )}
        </div>
      ) : null}

      {/* Preview */}
      {preview ? (
        <div className="space-y-4">
          {/* Summary bar */}
          <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex items-center gap-4 text-xs">
              <span className="font-medium text-slate-700">
                {file?.name}
              </span>
              <span className="text-slate-400">
                {preview.rows.length} row(s)
              </span>
              <span className="font-semibold text-brand">
                {preview.validCount} valid
              </span>
              {preview.errorCount > 0 ? (
                <span className="font-semibold text-rose-600">
                  {preview.errorCount} error(s)
                </span>
              ) : null}
              {preview.warningCount > 0 ? (
                <span className="font-semibold text-amber-600">
                  {preview.warningCount} warning(s)
                </span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={reset}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white hover:text-slate-700"
              title="Clear"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Table */}
          <div className="max-h-80 overflow-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Code</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Parent</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {preview.rows.map((row) => {
                  const hasError = row.errors.length > 0;
                  const hasWarning = row.warnings.length > 0;
                  return (
                    <tr
                      key={row.rowIndex}
                      className={
                        hasError
                          ? "bg-rose-50/50"
                          : hasWarning
                            ? "bg-amber-50/50"
                            : ""
                      }
                    >
                      <td className="px-3 py-2 text-slate-400">
                        {row.rowIndex}
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-700">
                        {row.typeKey}
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-700">
                        {row.code}
                      </td>
                      <td className="px-3 py-2 text-slate-900">{row.name}</td>
                      <td className="px-3 py-2 font-mono text-slate-500">
                        {row.parentCode ?? "—"}
                      </td>
                      <td className="px-3 py-2">
                        {hasError ? (
                          <span className="inline-flex items-center gap-1 text-rose-600">
                            <AlertCircle className="h-3 w-3" />
                            {row.errors[0]}
                          </span>
                        ) : hasWarning ? (
                          <span className="inline-flex items-center gap-1 text-amber-600">
                            <AlertTriangle className="h-3 w-3" />
                            {row.warnings[0]}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-brand">
                            <CheckCircle2 className="h-3 w-3" />
                            OK
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleConfirm}
              disabled={confirming || preview.validCount === 0}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              {confirming ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              Import {preview.validCount} unit(s)
            </button>
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:border-slate-300"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {/* Feedback */}
      {feedback ? (
        <div
          className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm ${
            feedback.type === "success"
              ? "border-brand/20 bg-brand/5 text-brand"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {feedback.type === "success" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          {feedback.message}
        </div>
      ) : null}
    </div>
  );
}
