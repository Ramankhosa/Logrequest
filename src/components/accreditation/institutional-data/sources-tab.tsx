"use client";

import { useState } from "react";
import { Plus, Pencil, RefreshCw, Database } from "lucide-react";
import { EmptyState } from "@/components/dashboard/shared";
import {
  label,
  SOURCE_KIND_LABELS,
  SOURCE_SHAPE_LABELS,
  RESOLUTION_MODE_LABELS,
  ENTRY_MODE_LABELS,
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
>;

type SlideOverMode = { kind: "create" } | { kind: "edit" } | null;

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
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
  } = props;

  const [slideOver, setSlideOver] = useState<SlideOverMode>(null);

  if (sources.length === 0) {
    return (
      <>
        <EmptyState
          icon={<Database className="h-7 w-7" />}
          title="No data sources yet"
          description="Data sources represent where your institution's data comes from — spreadsheets, system records, or documents."
          actionLabel="Add First Source"
          onAction={() => setSlideOver({ kind: "create" })}
        />
        <SourceFormSlideOver
          open={slideOver?.kind === "create"}
          onClose={() => setSlideOver(null)}
          saving={saving}
          domainOptions={domainOptions}
          adapterOptions={adapterOptions}
          onSubmit={(p) => createSource(p)}
        />
      </>
    );
  }

  return (
    <>
      <div className="grid gap-6 xl:grid-cols-[20rem,1fr]">
        {/* Sidebar source list */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">{sources.length} Source{sources.length !== 1 ? "s" : ""}</h3>
            <button
              type="button"
              onClick={() => setSlideOver({ kind: "create" })}
              className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-800"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Source
            </button>
          </div>

          <div className="space-y-2">
            {sources.map((source) => (
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
                <p className="text-sm font-semibold">{source.name}</p>
                <p className="mt-1 text-xs opacity-75">
                  {label(SOURCE_KIND_LABELS, source.kind)} &middot; {label(SOURCE_SHAPE_LABELS, source.shape)}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* Detail panel */}
        <div className="space-y-6">
          {!selectedSource ? (
            <div className="rounded-[1.75rem] border border-dashed border-slate-200 bg-white/55 px-6 py-12 text-center">
              <p className="text-sm text-slate-500">Select a source from the list to view its details and upload data.</p>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="rounded-[1.75rem] border border-slate-200/80 bg-white/85 p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium text-slate-400">{selectedSource.code}</p>
                    <h3 className="text-xl font-semibold text-slate-900">{selectedSource.name}</h3>
                    <p className="mt-1 text-sm text-slate-500">
                      {label(SOURCE_KIND_LABELS, selectedSource.kind)} &middot;{" "}
                      {label(SOURCE_SHAPE_LABELS, selectedSource.shape)}
                      {selectedSource.domain ? ` &middot; ${selectedSource.domain.name}` : ""}
                    </p>
                    {selectedSource.description ? (
                      <p className="mt-2 text-sm text-slate-600">{selectedSource.description}</p>
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
                      Edit
                    </button>
                  </div>
                </div>
              </div>

              {/* Upload / data entry */}
              <SourceUploadPanel
                source={selectedSource}
                saving={saving}
                importPreview={importPreview}
                onSaveSnapshot={saveManualSnapshot}
                onPreviewImport={previewImport}
                onApplyImport={applyImport}
                onClearPreview={clearImportPreview}
              />

              {/* Linked Metrics + Snapshot History */}
              <div className="grid gap-6 lg:grid-cols-2">
                {/* Linked metrics */}
                <div className="rounded-2xl border border-slate-200 p-5">
                  <h4 className="mb-3 text-sm font-semibold text-slate-900">Linked Metrics</h4>
                  {selectedSource.metricLinks.length === 0 ? (
                    <p className="text-sm text-slate-500">No metrics linked to this source yet. Link metrics from the Metrics tab.</p>
                  ) : (
                    <div className="space-y-2">
                      {selectedSource.metricLinks.map((link) => (
                        <div key={`${link.metricId}-${link.resolutionMode}`} className="rounded-xl bg-slate-50 px-3 py-2">
                          <p className="text-sm font-medium text-slate-900">{link.metric.name}</p>
                          <p className="text-xs text-slate-500">
                            {link.metric.code} &middot; {label(RESOLUTION_MODE_LABELS, link.resolutionMode)}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Snapshot history */}
                <div className="rounded-2xl border border-slate-200 p-5">
                  <h4 className="mb-3 text-sm font-semibold text-slate-900">Data History</h4>
                  {selectedSource.snapshots.length === 0 ? (
                    <p className="text-sm text-slate-500">No data uploaded yet. Use the upload panel above to add data.</p>
                  ) : (
                    <div className="space-y-2">
                      {selectedSource.snapshots.slice(0, 8).map((snap) => (
                        <div key={snap.id} className="rounded-xl bg-slate-50 px-3 py-2">
                          <p className="text-sm font-medium text-slate-900">
                            {snap.observedYear ?? "Current"} &middot; {snap.scopeKey}
                          </p>
                          <p className="text-xs text-slate-500">
                            {label(ENTRY_MODE_LABELS, snap.entryMode)} &middot; {formatDateTime(snap.lastRefreshedAt)}
                          </p>
                          {snap.numberValue != null ? (
                            <p className="mt-1 text-sm font-semibold text-slate-800">{snap.numberValue}</p>
                          ) : null}
                          {snap.datasetRows.length > 0 ? (
                            <p className="mt-1 text-xs text-slate-500">{snap.datasetRows.length} row{snap.datasetRows.length !== 1 ? "s" : ""}</p>
                          ) : null}
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

      {/* Slide-over for create/edit */}
      <SourceFormSlideOver
        open={slideOver?.kind === "create"}
        onClose={() => setSlideOver(null)}
        saving={saving}
        domainOptions={domainOptions}
        adapterOptions={adapterOptions}
        onSubmit={(p) => createSource(p)}
      />
      <SourceFormSlideOver
        open={slideOver?.kind === "edit"}
        onClose={() => setSlideOver(null)}
        saving={saving}
        domainOptions={domainOptions}
        adapterOptions={adapterOptions}
        source={selectedSource}
        onSubmit={(p) => updateSource(selectedSource!.id, p)}
      />
    </>
  );
}
