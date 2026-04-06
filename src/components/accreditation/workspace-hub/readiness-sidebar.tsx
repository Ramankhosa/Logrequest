"use client";

import { ShieldAlert, AlertTriangle, CheckCircle2, Database, History } from "lucide-react";
import { TooltipHint } from "@/components/tenant/kra-kpi/tooltip-hint";
import { TOOLTIP_READINESS_BLOCKERS, TOOLTIP_READINESS_WARNINGS, TOOLTIP_DATA_GAPS } from "./constants";
import type { WorkspaceDetail } from "./use-workspace-hub";

type Props = {
  readiness: WorkspaceDetail["readiness"];
  dataGaps: WorkspaceDetail["dataGaps"];
  freezeLogs: WorkspaceDetail["freezeLogs"];
};

function formatDate(value: string | null | undefined) {
  if (!value) return "Not set";
  return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function ReadinessSidebar({ readiness, dataGaps, freezeLogs }: Props) {
  const blockers = readiness?.blockers ?? [];
  const warnings = readiness?.warnings ?? [];
  const allClear = blockers.length === 0 && warnings.length === 0;

  return (
    <div className="space-y-5">
      {/* Readiness */}
      <div className="rounded-[1.75rem] border border-slate-200/80 bg-white/85 p-5">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-500">Readiness</h3>
          <TooltipHint text="Shows blockers and warnings that affect whether this workspace can be frozen for submission." />
        </div>

        <div className="mt-4 space-y-2.5">
          {blockers.map((item) => (
            <div key={`b-${item.code}`} className="flex items-start gap-2.5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
              <div>
                <p className="text-sm font-medium text-rose-700">{item.message}</p>
                <div className="mt-0.5 flex items-center gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-rose-400">Blocker</span>
                  <TooltipHint text={TOOLTIP_READINESS_BLOCKERS} />
                </div>
              </div>
            </div>
          ))}
          {warnings.map((item) => (
            <div key={`w-${item.code}`} className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <div>
                <p className="text-sm font-medium text-amber-700">{item.message}</p>
                <div className="mt-0.5 flex items-center gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-400">Warning</span>
                  <TooltipHint text={TOOLTIP_READINESS_WARNINGS} />
                </div>
              </div>
            </div>
          ))}
          {allClear ? (
            <div className="flex items-center gap-2.5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <p className="text-sm font-medium text-emerald-700">All clear &mdash; no blockers or warnings.</p>
            </div>
          ) : null}
        </div>
      </div>

      {/* Data Gaps */}
      <div className="rounded-[1.75rem] border border-slate-200/80 bg-white/85 p-5">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-500">Data Gaps</h3>
          <TooltipHint text={TOOLTIP_DATA_GAPS} />
        </div>

        <div className="mt-4 space-y-2.5">
          {dataGaps.length === 0 ? (
            <div className="flex items-center gap-2.5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <Database className="h-4 w-4 text-emerald-500" />
              <p className="text-sm font-medium text-emerald-700">No missing data gaps.</p>
            </div>
          ) : (
            dataGaps.map((gap) => (
              <div key={gap.blockCode} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-sm font-medium text-slate-700">{gap.blockCode} &middot; {gap.blockTitle}</p>
                <p className="mt-1 text-xs text-slate-400">
                  Missing years: <span className="font-medium text-slate-600">{gap.missingYears.join(", ")}</span>
                </p>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Freeze History */}
      <div className="rounded-[1.75rem] border border-slate-200/80 bg-white/85 p-5">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-500">Freeze History</h3>
          <TooltipHint text="Shows each time this workspace was frozen for submission and subsequently unfrozen." />
        </div>

        <div className="mt-4 space-y-2.5">
          {freezeLogs.length === 0 ? (
            <div className="flex items-center gap-2.5 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
              <History className="h-4 w-4 text-slate-400" />
              <p className="text-sm text-slate-500">No freeze cycles yet.</p>
            </div>
          ) : (
            freezeLogs.map((log) => (
              <div key={log.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[10px] font-semibold text-cyan-700">
                    Frozen
                  </span>
                  <span className="text-xs text-slate-500">{formatDate(log.frozenAt)}</span>
                </div>
                {log.unfrozenAt ? (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-600">
                      Unfrozen
                    </span>
                    <span className="text-xs text-slate-500">{formatDate(log.unfrozenAt)}</span>
                  </div>
                ) : (
                  <p className="mt-2 text-xs font-medium text-cyan-600">Currently frozen</p>
                )}
                {log.unfreezeReason ? (
                  <p className="mt-1.5 text-xs text-slate-400">Reason: {log.unfreezeReason}</p>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
