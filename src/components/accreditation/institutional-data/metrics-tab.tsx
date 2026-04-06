"use client";

import { useState } from "react";
import { Plus, Pencil, BarChart3, Link2 } from "lucide-react";
import { EmptyState } from "@/components/dashboard/shared";
import {
  label,
  METRIC_SHAPE_LABELS,
  METRIC_VALUE_TYPE_LABELS,
  RESOLUTION_MODE_LABELS,
  MATURITY_LABELS,
  COVERAGE_LABELS,
} from "./constants";
import { MetricFormSlideOver } from "./metric-form-slide-over";
import { MetricLinkSlideOver } from "./metric-link-slide-over";
import type { InstitutionalDataHook } from "./use-institutional-data";

type Props = Pick<
  InstitutionalDataHook,
  | "saving"
  | "sources"
  | "metrics"
  | "selectedSourceId"
  | "selectedMetricId"
  | "setSelectedMetricId"
  | "selectedMetric"
  | "domainOptions"
  | "createMetric"
  | "updateMetric"
  | "addMetricLink"
>;

type SlideOverMode = { kind: "createMetric" } | { kind: "editMetric" } | { kind: "addLink" } | null;

export function MetricsTab(props: Props) {
  const {
    saving,
    sources,
    metrics,
    selectedSourceId,
    selectedMetricId,
    setSelectedMetricId,
    selectedMetric,
    domainOptions,
    createMetric,
    updateMetric,
    addMetricLink,
  } = props;

  const [slideOver, setSlideOver] = useState<SlideOverMode>(null);

  if (metrics.length === 0) {
    return (
      <>
        <EmptyState
          icon={<BarChart3 className="h-7 w-7" />}
          title="No metrics defined yet"
          description="Metrics are reusable data points like 'Total Faculty Count' or 'Student-Teacher Ratio' that pull values from your data sources."
          actionLabel="Add First Metric"
          onAction={() => setSlideOver({ kind: "createMetric" })}
        />
        <MetricFormSlideOver
          open={slideOver?.kind === "createMetric"}
          onClose={() => setSlideOver(null)}
          saving={saving}
          domainOptions={domainOptions}
          onSubmit={(p) => createMetric(p)}
        />
      </>
    );
  }

  return (
    <>
      <div className="grid gap-6 xl:grid-cols-[20rem,1fr]">
        {/* Sidebar metric list */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">{metrics.length} Metric{metrics.length !== 1 ? "s" : ""}</h3>
            <button
              type="button"
              onClick={() => setSlideOver({ kind: "createMetric" })}
              className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-800"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Metric
            </button>
          </div>

          <div className="space-y-2">
            {metrics.map((metric) => (
              <button
                key={metric.id}
                type="button"
                onClick={() => setSelectedMetricId(metric.id)}
                className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                  selectedMetricId === metric.id
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                }`}
              >
                <p className="text-sm font-semibold">{metric.name}</p>
                <p className="mt-1 text-xs opacity-75">
                  {label(METRIC_SHAPE_LABELS, metric.shape)} &middot; {label(METRIC_VALUE_TYPE_LABELS, metric.valueType)}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* Detail panel */}
        <div className="space-y-6">
          {!selectedMetric ? (
            <div className="rounded-[1.75rem] border border-dashed border-slate-200 bg-white/55 px-6 py-12 text-center">
              <p className="text-sm text-slate-500">Select a metric from the list to view details, link sources, and inspect values.</p>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="rounded-[1.75rem] border border-slate-200/80 bg-white/85 p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium text-slate-400">{selectedMetric.code}</p>
                    <h3 className="text-xl font-semibold text-slate-900">{selectedMetric.name}</h3>
                    <p className="mt-1 text-sm text-slate-500">
                      {label(METRIC_SHAPE_LABELS, selectedMetric.shape)} &middot;{" "}
                      {label(METRIC_VALUE_TYPE_LABELS, selectedMetric.valueType)}
                      {selectedMetric.unitOfMeasure ? ` (${selectedMetric.unitOfMeasure})` : ""}
                      {selectedMetric.domain ? ` &middot; ${selectedMetric.domain.name}` : ""}
                    </p>
                    {selectedMetric.description ? (
                      <p className="mt-2 text-sm text-slate-600">{selectedMetric.description}</p>
                    ) : null}
                    {selectedMetric.helpText ? (
                      <p className="mt-1 text-xs italic text-slate-400">{selectedMetric.helpText}</p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => setSlideOver({ kind: "editMetric" })}
                    className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </button>
                </div>
              </div>

              {/* Source links + Observations */}
              <div className="grid gap-6 lg:grid-cols-2">
                {/* Source links */}
                <div className="rounded-2xl border border-slate-200 p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-slate-900">Linked Sources</h4>
                    <button
                      type="button"
                      onClick={() => setSlideOver({ kind: "addLink" })}
                      className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                    >
                      <Link2 className="h-3 w-3" />
                      Link Source
                    </button>
                  </div>
                  {selectedMetric.sourceLinks.length === 0 ? (
                    <p className="text-sm text-slate-500">No sources linked yet. Link a data source to compute this metric&apos;s value automatically.</p>
                  ) : (
                    <div className="space-y-2">
                      {selectedMetric.sourceLinks.map((link) => (
                        <div key={`${link.sourceId}-${link.resolutionMode}`} className="rounded-xl bg-slate-50 px-3 py-2">
                          <p className="text-sm font-medium text-slate-900">{link.source.name}</p>
                          <p className="text-xs text-slate-500">
                            {link.source.code} &middot; {label(RESOLUTION_MODE_LABELS, link.resolutionMode)} &middot; priority {link.precedence}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Observations */}
                <div className="rounded-2xl border border-slate-200 p-5">
                  <h4 className="mb-3 text-sm font-semibold text-slate-900">Current Values</h4>
                  {selectedMetric.observations.length === 0 ? (
                    <p className="text-sm text-slate-500">No values computed yet. Upload data to a linked source or enter values manually.</p>
                  ) : (
                    <div className="space-y-2">
                      {selectedMetric.observations.map((obs) => (
                        <div key={`${obs.scopeKey}-${obs.observedYear ?? "CURRENT"}`} className="rounded-xl bg-slate-50 px-3 py-2">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-medium text-slate-900">
                              {obs.observedYear ?? "Current"} &middot; {obs.scopeKey}
                            </p>
                            {obs.isStale ? (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700">Stale</span>
                            ) : (
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-700">Fresh</span>
                            )}
                          </div>
                          <p className="mt-1 text-lg font-bold text-slate-800">
                            {obs.numberValue ?? obs.textValue ?? "No value"}
                          </p>
                          <p className="text-xs text-slate-500">
                            {label(MATURITY_LABELS, obs.maturity)} &middot; {label(COVERAGE_LABELS, obs.coverageStatus)}
                          </p>
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

      {/* Slide-overs */}
      <MetricFormSlideOver
        open={slideOver?.kind === "createMetric"}
        onClose={() => setSlideOver(null)}
        saving={saving}
        domainOptions={domainOptions}
        onSubmit={(p) => createMetric(p)}
      />
      <MetricFormSlideOver
        open={slideOver?.kind === "editMetric"}
        onClose={() => setSlideOver(null)}
        saving={saving}
        domainOptions={domainOptions}
        metric={selectedMetric}
        onSubmit={(p) => updateMetric(selectedMetric!.id, p)}
      />
      {selectedMetric ? (
        <MetricLinkSlideOver
          open={slideOver?.kind === "addLink"}
          onClose={() => setSlideOver(null)}
          saving={saving}
          metricId={selectedMetric.id}
          sources={sources}
          defaultSourceId={selectedSourceId}
          onSubmit={addMetricLink}
        />
      ) : null}
    </>
  );
}
