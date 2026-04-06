"use client";

import { CheckCircle2, XCircle, Inbox } from "lucide-react";
import { EmptyState } from "@/components/dashboard/shared";
import type { InstitutionalDataHook } from "./use-institutional-data";

type Props = Pick<InstitutionalDataHook, "loading" | "saving" | "suggestions" | "resolveSuggestion">;

function formatDateTime(value: string | null | undefined) {
  if (!value) return "";
  return new Date(value).toLocaleString();
}

export function ReviewTab({ loading, saving, suggestions, resolveSuggestion }: Props) {
  if (!loading && suggestions.length === 0) {
    return (
      <EmptyState
        icon={<Inbox className="h-7 w-7" />}
        title="All caught up"
        description="No pending review suggestions. When data sources are refreshed and new values differ from current observations, they'll appear here for your review."
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">
        {suggestions.length} pending suggestion{suggestions.length !== 1 ? "s" : ""}. Review updated values from data sources and accept or reject them.
      </p>

      {suggestions.map((suggestion) => (
        <div key={suggestion.id} className="rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-slate-300">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900">
                {suggestion.metricObservation.metric.name}
              </p>
              <p className="text-xs text-slate-500">
                {suggestion.metricObservation.metric.code}
                {suggestion.metricSourceLink ? ` \u00b7 from ${suggestion.metricSourceLink.source.name}` : ""}
                {suggestion.detectedAt ? ` \u00b7 ${formatDateTime(suggestion.detectedAt)}` : ""}
              </p>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-slate-50 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Current Value</p>
                  <p className="mt-0.5 text-sm font-medium text-slate-700">
                    {suggestion.metricObservation.numberValue ?? suggestion.metricObservation.textValue ?? "No value"}
                  </p>
                </div>
                <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-400">New Value</p>
                  <p className="mt-0.5 text-sm font-semibold text-blue-700">
                    {suggestion.candidateNumberValue ?? suggestion.candidateTextValue ?? "No value"}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => void resolveSuggestion(suggestion.id, "ACCEPT")}
                className="inline-flex items-center gap-1.5 rounded-2xl bg-slate-900 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:bg-slate-300"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Accept
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void resolveSuggestion(suggestion.id, "REJECT")}
                className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:bg-slate-100"
              >
                <XCircle className="h-3.5 w-3.5" />
                Reject
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
