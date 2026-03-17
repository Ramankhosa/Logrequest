"use client";

import { useCallback, useRef, useState } from "react";
import {
  Download,
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
} from "lucide-react";

type ParsedRow = {
  rowIndex: number;
  firstName: string;
  lastName: string;
  officialEmail: string;
  employeeId: string | null;
  primaryUnitCode: string;
  errors: string[];
  warnings: string[];
};

type ValidationResult = {
  rows: ParsedRow[];
  validCount: number;
  errorCount: number;
  warningCount: number;
};

type ProvisionResult = {
  totalRows: number;
  provisioned: number;
  failed: number;
  errors: Array<{ rowIndex: number; email: string; message: string }>;
};

type Stage = "idle" | "uploading" | "validated" | "provisioning" | "done";

export function PersonnelBulkUpload() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [provision, setProvision] = useState<ProvisionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback((f: File | null) => {
    setFile(f);
    setValidation(null);
    setProvision(null);
    setError(null);
    setStage("idle");
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const dropped = e.dataTransfer.files[0];
      if (dropped) handleFile(dropped);
    },
    [handleFile],
  );

  const handleValidate = async () => {
    if (!file) return;
    setStage("uploading");
    setError(null);

    try {
      const body = new FormData();
      body.append("file", file);

      const res = await fetch(
        "/api/tenant/personnel/onboard/bulk?mode=validate",
        { method: "POST", body },
      );
      const json = await res.json();

      if (!res.ok) {
        setError(json.message ?? "Validation failed.");
        setStage("idle");
        return;
      }

      setValidation(json.data as ValidationResult);
      setStage("validated");
    } catch {
      setError("Network error. Please try again.");
      setStage("idle");
    }
  };

  const handleProvision = async () => {
    if (!file) return;
    setStage("provisioning");
    setError(null);

    try {
      const body = new FormData();
      body.append("file", file);

      const res = await fetch(
        "/api/tenant/personnel/onboard/bulk?mode=provision",
        { method: "POST", body },
      );
      const json = await res.json();

      if (!res.ok && !json.provisioned) {
        setError(json.message ?? "Provisioning failed.");
        setStage("validated");
        return;
      }

      setProvision(json as ProvisionResult);
      setStage("done");
    } catch {
      setError("Network error. Please try again.");
      setStage("validated");
    }
  };

  const isLoading = stage === "uploading" || stage === "provisioning";

  return (
    <div className="space-y-6">
      {/* ── Download Template ─────────────────────────────────────── */}
      <section className="rounded-2xl border border-slate-200/80 bg-white/80 p-6">
        <h3 className="text-sm font-semibold text-slate-900">
          1. Download Template
        </h3>
        <p className="mt-1 text-sm text-slate-500">
          Download the Excel template pre-filled with your organization&apos;s
          unit codes and role definitions.
        </p>
        <button
          type="button"
          onClick={() => {
            window.location.href =
              "/api/tenant/personnel/onboard/template";
          }}
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
        >
          <Download className="h-4 w-4" />
          Download Template
        </button>
      </section>

      {/* ── Upload File ───────────────────────────────────────────── */}
      <section className="rounded-2xl border border-slate-200/80 bg-white/80 p-6">
        <h3 className="text-sm font-semibold text-slate-900">
          2. Upload Filled File
        </h3>
        <p className="mt-1 text-sm text-slate-500">
          Upload the completed spreadsheet (.xlsx, .xls, or .csv).
        </p>

        <div
          className={`mt-4 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 transition ${
            dragOver
              ? "border-brand bg-brand-soft/30"
              : "border-slate-300 bg-slate-50/60 hover:border-slate-400"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
        >
          <FileSpreadsheet className="h-8 w-8 text-slate-400" />
          <p className="mt-2 text-sm text-slate-600">
            {file ? file.name : "Drag & drop a file here, or click to browse"}
          </p>
          {file && (
            <p className="mt-1 text-xs text-slate-400">
              {(file.size / 1024).toFixed(1)} KB
            </p>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          />
        </div>

        {file && stage === "idle" && (
          <button
            type="button"
            onClick={handleValidate}
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            <Upload className="h-4 w-4" />
            Validate
          </button>
        )}

        {isLoading && (
          <div className="mt-4 flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            {stage === "uploading"
              ? "Validating file…"
              : "Provisioning members…"}
          </div>
        )}
      </section>

      {/* ── Error banner ──────────────────────────────────────────── */}
      {error && (
        <div className="rounded-2xl border border-rose-200/80 bg-rose-50/70 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {/* ── Validation Results ────────────────────────────────────── */}
      {validation && stage !== "done" && (
        <section className="rounded-2xl border border-slate-200/80 bg-white/80 p-6">
          <h3 className="text-sm font-semibold text-slate-900">
            3. Validation Results
          </h3>
          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            <span className="inline-flex items-center gap-1.5 text-slate-600">
              <span className="font-semibold">{validation.rows.length}</span>{" "}
              total rows
            </span>
            <span className="inline-flex items-center gap-1.5 text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              {validation.validCount} valid
            </span>
            <span className="inline-flex items-center gap-1.5 text-rose-700">
              <XCircle className="h-4 w-4" />
              {validation.errorCount} errors
            </span>
            {validation.warningCount > 0 && (
              <span className="inline-flex items-center gap-1.5 text-amber-700">
                <AlertTriangle className="h-4 w-4" />
                {validation.warningCount} warnings
              </span>
            )}
          </div>

          <div className="mt-4 overflow-hidden rounded-[1.25rem] border border-slate-200/80">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200/80 text-left text-sm">
                <thead className="bg-slate-50/80">
                  <tr>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                      Row
                    </th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                      Name
                    </th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                      Email
                    </th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                      Primary Unit
                    </th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/80">
                  {validation.rows.map((row) => (
                    <tr key={row.rowIndex} className="align-top">
                      <td className="px-4 py-3 text-slate-600">
                        {row.rowIndex}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {row.firstName} {row.lastName}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {row.officialEmail}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {row.primaryUnitCode}
                      </td>
                      <td className="px-4 py-3">
                        {row.errors.length > 0 ? (
                          <div className="space-y-1">
                            {row.errors.map((err, i) => (
                              <p
                                key={i}
                                className="text-xs text-rose-700"
                              >
                                {err}
                              </p>
                            ))}
                          </div>
                        ) : row.warnings.length > 0 ? (
                          <div className="space-y-1">
                            {row.warnings.map((w, i) => (
                              <p
                                key={i}
                                className="text-xs text-amber-700"
                              >
                                {w}
                              </p>
                            ))}
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Valid
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {validation.validCount > 0 && stage === "validated" && (
            <button
              type="button"
              onClick={handleProvision}
              className="mt-4 inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand/90"
            >
              <CheckCircle2 className="h-4 w-4" />
              Provision {validation.validCount} Member
              {validation.validCount > 1 ? "s" : ""}
            </button>
          )}
        </section>
      )}

      {/* ── Provision Results ─────────────────────────────────────── */}
      {provision && stage === "done" && (
        <section className="rounded-2xl border border-slate-200/80 bg-white/80 p-6">
          <h3 className="text-sm font-semibold text-slate-900">
            4. Provisioning Complete
          </h3>
          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            <span className="inline-flex items-center gap-1.5 text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              {provision.provisioned} provisioned
            </span>
            {provision.failed > 0 && (
              <span className="inline-flex items-center gap-1.5 text-rose-700">
                <XCircle className="h-4 w-4" />
                {provision.failed} failed
              </span>
            )}
          </div>

          {provision.errors.length > 0 && (
            <div className="mt-4 overflow-hidden rounded-[1.25rem] border border-slate-200/80">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200/80 text-left text-sm">
                  <thead className="bg-slate-50/80">
                    <tr>
                      <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                        Row
                      </th>
                      <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                        Email
                      </th>
                      <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                        Error
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/80">
                    {provision.errors.map((err, i) => (
                      <tr key={i} className="align-top">
                        <td className="px-4 py-3 text-slate-600">
                          {err.rowIndex}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {err.email}
                        </td>
                        <td className="px-4 py-3 text-rose-700">
                          {err.message}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              setFile(null);
              setValidation(null);
              setProvision(null);
              setError(null);
              setStage("idle");
              if (fileRef.current) fileRef.current.value = "";
            }}
            className="mt-4 inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
          >
            Upload Another File
          </button>
        </section>
      )}
    </div>
  );
}
