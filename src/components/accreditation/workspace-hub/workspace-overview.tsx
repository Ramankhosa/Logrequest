"use client";

import { useState } from "react";
import { Lock, Unlock, TrendingUp, Award, Target, Bell } from "lucide-react";
import { TooltipHint } from "@/components/tenant/kra-kpi/tooltip-hint";
import { SlideOver } from "@/components/dashboard/shared";
import {
  statusLabel,
  WORKSPACE_STATUS_LABELS,
  WORKSPACE_STATUS_CLASSES,
  TOOLTIP_FREEZE,
  TOOLTIP_UNFREEZE,
  inputClassName,
  labelClassName,
} from "./constants";
import type { WorkspaceDetail, WorkspaceHubHook } from "./use-workspace-hub";

type Props = {
  detail: WorkspaceDetail;
  saving: boolean;
  freezeWorkspace: WorkspaceHubHook["freezeWorkspace"];
  unfreezeWorkspace: WorkspaceHubHook["unfreezeWorkspace"];
};

function formatDate(value: string | null | undefined) {
  if (!value) return "Not set";
  return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function WorkspaceOverview({ detail, saving, freezeWorkspace, unfreezeWorkspace }: Props) {
  const [showFreezePanel, setShowFreezePanel] = useState(false);
  const [showUnfreezePanel, setShowUnfreezePanel] = useState(false);
  const [unfreezeReason, setUnfreezeReason] = useState("");
  const [ackReasons, setAckReasons] = useState<Record<string, string>>({});

  const isCoordinator = detail.currentUserRole === "COORDINATOR";
  const statusCls = WORKSPACE_STATUS_CLASSES[detail.status] ?? "border-slate-200 bg-slate-50 text-slate-600";

  function handleFreeze() {
    const warnings = detail.readiness?.warnings ?? [];
    const acknowledgments = warnings.map((w) => ({
      code: w.code,
      reason: ackReasons[w.code] || "Acknowledged.",
    }));
    void freezeWorkspace(acknowledgments).then(() => setShowFreezePanel(false));
  }

  function handleUnfreeze() {
    if (!unfreezeReason.trim()) return;
    void unfreezeWorkspace(unfreezeReason).then(() => { setShowUnfreezePanel(false); setUnfreezeReason(""); });
  }

  return (
    <>
      <section className="rounded-[1.75rem] border border-slate-200/80 bg-white/85 p-6">
        {/* Title row */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className={`rounded-full border px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider ${statusCls}`}>
                {statusLabel(WORKSPACE_STATUS_LABELS, detail.status)}
              </span>
              {detail.isScoreStale ? (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600">
                  Score stale
                </span>
              ) : null}
            </div>
            <h2 className="mt-2 text-2xl font-semibold text-slate-900">{detail.title}</h2>
            {detail.description ? <p className="mt-1 text-sm text-slate-500">{detail.description}</p> : null}
            <p className="mt-2 text-xs text-slate-400">
              {formatDate(detail.periodStart)} &ndash; {formatDate(detail.periodEnd)}
              {detail.targetGrade ? ` \u00b7 Target: ${detail.targetGrade}` : ""}
            </p>
          </div>

          {isCoordinator ? (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowFreezePanel(true)}
                  disabled={saving || detail.status === "FROZEN"}
                  className="inline-flex items-center gap-1.5 rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:bg-slate-300"
                >
                  <Lock className="h-3.5 w-3.5" />
                  Freeze
                </button>
                <TooltipHint text={TOOLTIP_FREEZE} />
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowUnfreezePanel(true)}
                  disabled={saving || detail.status !== "FROZEN"}
                  className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  <Unlock className="h-3.5 w-3.5" />
                  Unfreeze
                </button>
                <TooltipHint text={TOOLTIP_UNFREEZE} />
              </div>
            </div>
          ) : null}
        </div>

        {/* Summary cards */}
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={<TrendingUp className="h-4 w-4 text-slate-400" />} label="Score" value={detail.overallConvertedScore != null ? String(detail.overallConvertedScore) : "\u2013"} />
          <StatCard icon={<Award className="h-4 w-4 text-slate-400" />} label="Grade" value={detail.resolvedGrade ?? "\u2013"} />
          <StatCard icon={<Target className="h-4 w-4 text-slate-400" />} label="Outcome" value={detail.resolvedOutcome ?? "\u2013"} />
          <ActivityCard activity={detail.activity} />
        </div>
      </section>

      {/* Freeze SlideOver */}
      <SlideOver open={showFreezePanel} onClose={() => setShowFreezePanel(false)} title="Freeze Workspace" subtitle="Lock all entries for final submission.">
        <div className="space-y-5">
          {(detail.readiness?.blockers ?? []).length > 0 ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              <p className="font-semibold">Cannot freeze yet</p>
              <ul className="mt-2 list-inside list-disc space-y-1">
                {detail.readiness!.blockers.map((b) => <li key={b.code}>{b.message}</li>)}
              </ul>
            </div>
          ) : null}

          {(detail.readiness?.warnings ?? []).length > 0 ? (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-slate-700">Acknowledge warnings to proceed:</p>
              {detail.readiness!.warnings.map((w) => (
                <div key={w.code} className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-sm text-amber-800">{w.message}</p>
                  <div className="mt-2">
                    <label className={labelClassName}>Acknowledgment reason</label>
                    <input
                      className={inputClassName}
                      placeholder="e.g. This is acceptable because..."
                      value={ackReasons[w.code] ?? ""}
                      onChange={(e) => setAckReasons((prev) => ({ ...prev, [w.code]: e.target.value }))}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {(detail.readiness?.blockers ?? []).length === 0 ? (
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={handleFreeze}
                disabled={saving}
                className="flex-1 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white disabled:bg-slate-300"
              >
                {saving ? "Freezing..." : "Confirm Freeze"}
              </button>
              <button type="button" onClick={() => setShowFreezePanel(false)} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
            </div>
          ) : null}
        </div>
      </SlideOver>

      {/* Unfreeze SlideOver */}
      <SlideOver open={showUnfreezePanel} onClose={() => setShowUnfreezePanel(false)} title="Unfreeze Workspace" subtitle="Re-open this workspace for further editing.">
        <div className="space-y-5">
          <p className="text-sm text-slate-500">Provide a reason why this workspace is being unfrozen. This will be recorded in the audit trail.</p>
          <div>
            <label className={labelClassName}>Reason</label>
            <textarea className={`${inputClassName} min-h-[6rem]`} placeholder="e.g. Additional data needs to be updated before submission" value={unfreezeReason} onChange={(e) => setUnfreezeReason(e.target.value)} />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={handleUnfreeze} disabled={saving || !unfreezeReason.trim()} className="flex-1 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white disabled:bg-slate-300">
              {saving ? "Unfreezing..." : "Confirm Unfreeze"}
            </button>
            <button type="button" onClick={() => setShowUnfreezePanel(false)} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50">
              Cancel
            </button>
          </div>
        </div>
      </SlideOver>
    </>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-3">
      <div className="flex items-center gap-2">
        {icon}
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      </div>
      <p className="mt-2 text-xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function ActivityCard({ activity }: { activity: WorkspaceDetail["activity"] }) {
  if (!activity) {
    return (
      <div className="rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-3">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-slate-400" />
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Activity</p>
        </div>
        <p className="mt-2 text-sm text-slate-500">No recent activity.</p>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-3">
      <div className="flex items-center gap-2">
        <Bell className="h-4 w-4 text-slate-400" />
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Since Last Visit</p>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {activity.entryChanges > 0 ? <MiniPill label={`${activity.entryChanges} entries`} /> : null}
        {activity.sectionEvents > 0 ? <MiniPill label={`${activity.sectionEvents} events`} /> : null}
        {activity.unreadThreads > 0 ? <MiniPill label={`${activity.unreadThreads} threads`} accent /> : null}
        {activity.entryChanges === 0 && activity.sectionEvents === 0 && activity.unreadThreads === 0 ? <span className="text-sm text-slate-500">No new activity</span> : null}
      </div>
    </div>
  );
}

function MiniPill({ label, accent }: { label: string; accent?: boolean }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${accent ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-600"}`}>
      {label}
    </span>
  );
}
