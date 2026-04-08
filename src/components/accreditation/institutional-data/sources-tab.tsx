"use client";

import { useState } from "react";
import { Database, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/dashboard/shared";
import {
  ENTRY_MODE_LABELS,
  RESOLUTION_MODE_LABELS,
  SOURCE_SHAPE_LABELS,
  label,
} from "./constants";
import { SourceFormSlideOver } from "./source-form-slide-over";
import { SourceUploadPanel } from "./source-upload-panel";
import type { InstitutionalDataHook } from "./use-institutional-data";

type Props = Pick<
  InstitutionalDataHook,
  | "saving"
  | "sources"
  | "selectedSourceId"
  | "setSelectedSourceId"
  | "selectedSource"
  | "domainOptions"
  | "adapterOptions"
  | "importPreview"
  | "clearImportPreview"
  | "createSource"
  | "updateSource"
  | "refreshSource"
  | "saveManualSnapshot"
  | "previewImport"
  | "applyImport"
  | "deleteSnapshot"
  | "downloadSourceTemplate"
>;

type SlideOverMode = { kind: "create" } | { kind: "edit" } | null;

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

function coverageLabel(status: string | null | undefined) {
  if (status === "COMPLETE") return "Ready";
  if (status === "PARTIAL") return "Partial";
  return "Missing";
}

function coverageClass(status: string | null | undefined) {
  if (status === "COMPLETE") return "bg-emerald-100 text-emerald-700";
  if (status === "PARTIAL") return "bg-amber-100 text-amber-700";
  return "bg-slate-100 text-slate-600";
}

export function SourcesTab(props: Props) {
  const {
    saving,
    sources,
    selectedSourceId,
    setSelectedSourceId,
    selectedSource,
    domainOptions,
    adapterOptions,
    importPreview,
    clearImportPreview,
    createSource,
    updateSource,
    refreshSource,
    saveManualSnapshot,
    previewImport,
    applyImport,
    deleteSnapshot,
    downloadSourceTemplate,
  } = props;

  const [slideOver, setSlideOver] = useState<SlideOverMode>(null);

  if (sources.length === 0) {
    return (
      <>
        <EmptyState
          icon={<Database className="h-7 w-7" />}
          title="No databank sources yet"
          description="Start with the recommended databank sources, or add a custom source for institution-specific files."
          actionLabel="Add Custom Source"
          onAction={() => setSlideOver({ kind: "create" })}
        />
        <SourceFormSlideOver
          open={slideOver?.kind === "create"}
          onClose={() => setSlideOver(null)}
          saving={saving}
          domainOptions={domainOptions}
          adapterOptions={adapterOptions}
          onSubmit={(payload) => createSource(payload)}
        />
      </>
    );
  }

  return (
    <>
      <div className="grid gap-6 xl:grid-cols-[22rem,1fr]">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-700">Build Data Bank</h3>
              <p className="text-xs text-slate-500">{sources.length} guided source pack{sources.length !== 1 ? "s" : ""}</p>
            </div>
            <button
              type="button"
              onClick={() => setSlideOver({ kind: "create" })}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
            >
              <Plus className="h-3.5 w-3.5" />
              Custom / Admin
            </button>
          </div>

          <div className="space-y-2">
            {sources.map((source) => {
              const guide = source.datasetSchema?.guide;
              const latestSnapshot = source.snapshots?.[0] ?? null;

              return (
                <button
                  key={source.id}
                  type="button"
                  onClick={() => setSelectedSourceId(source.id)}
                  className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                    selectedSourceId === source.id
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">{source.name}</p>
                      <p className="mt-1 text-xs opacity-75">{guide?.ownerOffice ?? label(SOURCE_SHAPE_LABELS, source.shape)}</p>
                    </div>
                    <span
                      className={`rounded-full px-2 py-1 text-[10px] font-semibold ${
                        selectedSourceId === source.id ? "bg-white/15 text-white" : coverageClass(latestSnapshot?.coverageStatus)
                      }`}
                    >
                      {coverageLabel(latestSnapshot?.coverageStatus)}
                    </span>
                  </div>
                  <p className="mt-2 text-xs opacity-75">
                    {guide?.minimumDataHint ?? source.description ?? "Upload the data you have and improve completeness later."}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-6">
          {!selectedSource ? (
            <div className="rounded-[1.75rem] border border-dashed border-slate-200 bg-white/55 px-6 py-12 text-center">
              <p className="text-sm text-slate-500">Select a databank source to review its upload guide and data history.</p>
            </div>
          ) : (
            <>
              <div className="rounded-[1.75rem] border border-slate-200/80 bg-white/85 p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium text-slate-400">{selectedSource.code}</p>
                    <h3 className="text-xl font-semibold text-slate-900">{selectedSource.name}</h3>
                    <p className="mt-1 text-sm text-slate-500">
                      {label(SOURCE_SHAPE_LABELS, selectedSource.shape)}
                      {selectedSource.datasetSchema?.guide?.ownerOffice ? ` · ${selectedSource.datasetSchema.guide.ownerOffice}` : ""}
                      {selectedSource.domain ? ` · ${selectedSource.domain.name}` : ""}
                    </p>
                    {selectedSource.description ? (
                      <p className="mt-2 text-sm text-slate-600">{selectedSource.description}</p>
                    ) : null}
                    {selectedSource.datasetSchema?.guide ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">
                          Minimum: {selectedSource.datasetSchema.guide.minimumDataHint}
                        </span>
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">
                          Partial uploads: {selectedSource.datasetSchema.guide.supportsPartialUpload ? "Allowed" : "Not allowed"}
                        </span>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex gap-2">
                    {selectedSource.kind === "INTERNAL_ADAPTER" ? (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void refreshSource(selectedSource.id)}
                        className="inline-flex items-center gap-1.5 rounded-2xl bg-slate-900 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:bg-slate-300"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Sync Now
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setSlideOver({ kind: "edit" })}
                      className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Custom / Admin
                    </button>
                  </div>
                </div>
              </div>

              <SourceUploadPanel
                source={selectedSource}
                saving={saving}
                importPreview={importPreview}
                onSaveSnapshot={saveManualSnapshot}
                onPreviewImport={previewImport}
                onApplyImport={applyImport}
                onDownloadTemplate={downloadSourceTemplate}
                onClearPreview={clearImportPreview}
              />

              <div className="grid gap-6 lg:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 p-5">
                  <h4 className="mb-3 text-sm font-semibold text-slate-900">Linked Metrics</h4>
                  {selectedSource.metricLinks.length === 0 ? (
                    <p className="text-sm text-slate-500">No metrics are linked yet. Link them from the Metrics tab when you are ready.</p>
                  ) : (
                    <div className="space-y-2">
                      {selectedSource.metricLinks.map((link) => (
                        <div key={`${link.metricId}-${link.resolutionMode}`} className="rounded-xl bg-slate-50 px-3 py-2">
                          <p className="text-sm font-medium text-slate-900">{link.metric.name}</p>
                          <p className="text-xs text-slate-500">
                            {link.metric.code} · {label(RESOLUTION_MODE_LABELS, link.resolutionMode)}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-slate-200 p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-slate-900">Data History</h4>
                    <span className="text-[10px] text-slate-400">Upload again to update</span>
                  </div>
                  {selectedSource.snapshots.length === 0 ? (
                    <p className="text-sm text-slate-500">No data uploaded yet. Use the guided upload flow above.</p>
                  ) : (
                    <div className="space-y-2">
                      {selectedSource.snapshots.slice(0, 8).map((snapshot) => (
                        <div key={snapshot.id} className="group relative rounded-xl bg-slate-50 px-3 py-2">
                          <div className="pr-8">
                            <p className="text-sm font-medium text-slate-900">
                              {snapshot.observedYear ?? "Current"} · {snapshot.scopeKey}
                            </p>
                            <p className="text-xs text-slate-500">
                              {label(ENTRY_MODE_LABELS, snapshot.entryMode)} · {formatDateTime(snapshot.lastRefreshedAt)}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {coverageLabel(snapshot.coverageStatus)}
                              {snapshot.coveragePercent != null ? ` · ${Math.round(snapshot.coveragePercent)}%` : ""}
                            </p>
                            {snapshot.numberValue != null ? (
                              <p className="mt-1 text-sm font-semibold text-slate-800">{snapshot.numberValue}</p>
                            ) : null}
                            {snapshot.datasetRows.length > 0 ? (
                              <p className="mt-1 text-xs text-slate-500">
                                {snapshot.datasetRows.length} row{snapshot.datasetRows.length !== 1 ? "s" : ""}
                              </p>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => {
                              if (confirm("Are you sure you want to delete this data? This action cannot be undone.")) {
                                void deleteSnapshot(selectedSource.id, snapshot.id);
                              }
                            }}
                            className="absolute right-2 top-2 hidden rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 group-hover:block disabled:opacity-50"
                            title="Delete data"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <SourceFormSlideOver
        open={slideOver?.kind === "create"}
        onClose={() => setSlideOver(null)}
        saving={saving}
        domainOptions={domainOptions}
        adapterOptions={adapterOptions}
        onSubmit={(payload) => createSource(payload)}
      />
      <SourceFormSlideOver
        open={slideOver?.kind === "edit"}
        onClose={() => setSlideOver(null)}
        saving={saving}
        domainOptions={domainOptions}
        adapterOptions={adapterOptions}
        source={selectedSource}
        onSubmit={(payload) => updateSource(selectedSource!.id, payload)}
      />
    </>
  );
}
