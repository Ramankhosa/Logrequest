"use client";

import { useState } from "react";
import { Send, CheckCircle2, RotateCcw, ShieldCheck, ChevronDown, UserPlus } from "lucide-react";
import { TooltipHint } from "@/components/tenant/kra-kpi/tooltip-hint";
import { SlideOver } from "@/components/dashboard/shared";
import {
  statusLabel,
  SECTION_STATUS_LABELS,
  SECTION_STATUS_CLASSES,
  SECTION_ROLE_LABELS,
  SECTION_ROLE_DESCRIPTIONS,
  TOOLTIP_SECTION_SUBMIT,
  TOOLTIP_SECTION_CONFIRM,
  TOOLTIP_SECTION_CHANGES,
  TOOLTIP_SECTION_APPROVE,
  inputClassName,
  labelClassName,
} from "./constants";
import type { WorkspaceSection, WorkspaceCollaborator, WorkspaceHubHook } from "./use-workspace-hub";

type Props = {
  sections: WorkspaceSection[];
  collaborators: WorkspaceCollaborator[];
  currentUserRole: string | null;
  saving: boolean;
  sectionAction: WorkspaceHubHook["sectionAction"];
  assignSection: WorkspaceHubHook["assignSection"];
};

export function SectionReviewPanel({ sections, collaborators, currentUserRole, saving, sectionAction, assignSection }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [changesComment, setChangesComment] = useState("");
  const [changesTarget, setChangesTarget] = useState<string | null>(null);
  const [assignTarget, setAssignTarget] = useState<string | null>(null);
  const [assignForm, setAssignForm] = useState({ userId: "", role: "RESPONSIBLE", deadline: "" });

  const isCoordinator = currentUserRole === "COORDINATOR";

  function handleSubmit(sectionBlockId: string) {
    void sectionAction("submit", sectionBlockId);
  }

  function handleConfirm(sectionBlockId: string) {
    void sectionAction("confirm", sectionBlockId);
  }

  function handleRequestChanges() {
    if (!changesTarget || !changesComment.trim()) return;
    void sectionAction("changes-requested", changesTarget, changesComment).then(() => {
      setChangesTarget(null);
      setChangesComment("");
    });
  }

  function handleApprove(sectionBlockId: string) {
    void sectionAction("approve", sectionBlockId);
  }

  function handleAssign() {
    if (!assignTarget || !assignForm.userId) return;
    void assignSection(assignTarget, assignForm.userId, assignForm.role, assignForm.deadline || null).then(() => {
      setAssignTarget(null);
      setAssignForm({ userId: "", role: "RESPONSIBLE", deadline: "" });
    });
  }

  return (
    <>
      <div className="rounded-[1.75rem] border border-slate-200/80 bg-white/85 p-6">
        <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-500">Section Review</h3>
        <p className="mt-1 text-xs text-slate-400">Each section goes through a workflow: Open → Submitted → Confirmed → Approved.</p>

        <div className="mt-5 space-y-3">
          {sections.map((section) => {
            const isExpanded = expandedId === section.sectionBlockId;
            const statusCls = SECTION_STATUS_CLASSES[section.status] ?? "border-slate-200 bg-slate-50 text-slate-600";
            const progressPct = section.leafEntryCount > 0
              ? Math.round((section.approvedLeafCount / section.leafEntryCount) * 100)
              : 0;

            return (
              <div key={section.sectionBlockId} className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                {/* Section header (always visible) */}
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : section.sectionBlockId)}
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-slate-50/50"
                >
                  <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-slate-900">{section.sectionCode} &middot; {section.title}</p>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusCls}`}>
                        {statusLabel(SECTION_STATUS_LABELS, section.status)}
                      </span>
                    </div>
                    {/* Progress bar */}
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progressPct}%` }} />
                      </div>
                      <span className="text-[10px] font-medium text-slate-400">{section.approvedLeafCount}/{section.leafEntryCount}</span>
                    </div>
                  </div>
                  {section.overdueAssignments > 0 ? (
                    <span className="shrink-0 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-600">
                      {section.overdueAssignments} overdue
                    </span>
                  ) : null}
                </button>

                {/* Expanded detail */}
                {isExpanded ? (
                  <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-4 space-y-4">
                    {/* Workflow actions */}
                    <div className="flex flex-wrap items-center gap-2">
                      {(section.currentUserRoles.includes("SECTION_LEAD") || section.currentUserRoles.includes("RESPONSIBLE")) ? (
                        <ActionButton icon={<Send className="h-3.5 w-3.5" />} label="Submit for Review" tooltip={TOOLTIP_SECTION_SUBMIT} disabled={saving} onClick={() => handleSubmit(section.sectionBlockId)} variant="default" />
                      ) : null}
                      {section.currentUserRoles.includes("REVIEWER") ? (
                        <ActionButton icon={<CheckCircle2 className="h-3.5 w-3.5" />} label="Confirm Review" tooltip={TOOLTIP_SECTION_CONFIRM} disabled={saving} onClick={() => handleConfirm(section.sectionBlockId)} variant="default" />
                      ) : null}
                      {(section.currentUserRoles.includes("REVIEWER") || section.currentUserRoles.includes("APPROVER")) ? (
                        <ActionButton icon={<RotateCcw className="h-3.5 w-3.5" />} label="Request Changes" tooltip={TOOLTIP_SECTION_CHANGES} disabled={saving} onClick={() => setChangesTarget(section.sectionBlockId)} variant="warning" />
                      ) : null}
                      {section.currentUserRoles.includes("APPROVER") ? (
                        <ActionButton icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Approve" tooltip={TOOLTIP_SECTION_APPROVE} disabled={saving} onClick={() => handleApprove(section.sectionBlockId)} variant="primary" />
                      ) : null}
                      {isCoordinator ? (
                        <button type="button" onClick={() => setAssignTarget(section.sectionBlockId)} className="ml-auto inline-flex items-center gap-1.5 rounded-xl border border-dashed border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-500 transition hover:border-slate-400 hover:text-slate-700">
                          <UserPlus className="h-3.5 w-3.5" />
                          Assign
                        </button>
                      ) : null}
                    </div>

                    {/* Reviewer confirmations */}
                    {section.reviewerDecisionSummary.total > 0 ? (
                      <div className="text-xs text-slate-500">
                        Reviewer confirmations: <strong className="text-slate-700">{section.reviewerDecisionSummary.confirmed}/{section.reviewerDecisionSummary.total}</strong>
                      </div>
                    ) : null}

                    {/* Current assignments */}
                    {section.assignments.length > 0 ? (
                      <div>
                        <p className="mb-1.5 text-xs font-medium text-slate-400">Current Assignments</p>
                        <div className="flex flex-wrap gap-1.5">
                          {section.assignments.map((a) => (
                            <span key={a.id} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-600">
                              <span className="font-semibold">{SECTION_ROLE_LABELS[a.role] ?? a.role}:</span>
                              {a.name ?? a.email ?? "Unassigned"}
                              {a.deadline ? <span className="text-slate-400">&middot; {new Date(a.deadline).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span> : null}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* Request Changes SlideOver */}
      <SlideOver open={!!changesTarget} onClose={() => { setChangesTarget(null); setChangesComment(""); }} title="Request Changes" subtitle="Explain what needs to be revised in this section.">
        <div className="space-y-5">
          <div>
            <label className={labelClassName}>Comment</label>
            <textarea className={`${inputClassName} min-h-[8rem]`} placeholder="Describe what needs to change and why..." value={changesComment} onChange={(e) => setChangesComment(e.target.value)} />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={handleRequestChanges} disabled={saving || !changesComment.trim()} className="flex-1 rounded-2xl bg-amber-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-amber-700 disabled:bg-slate-300">
              {saving ? "Sending..." : "Send Change Request"}
            </button>
            <button type="button" onClick={() => { setChangesTarget(null); setChangesComment(""); }} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
          </div>
        </div>
      </SlideOver>

      {/* Assign Section SlideOver */}
      <SlideOver open={!!assignTarget} onClose={() => setAssignTarget(null)} title="Assign Collaborator" subtitle="Delegate a role for this section to a workspace collaborator.">
        <div className="space-y-5">
          <div>
            <label className={labelClassName}>Collaborator</label>
            <select className={inputClassName} value={assignForm.userId} onChange={(e) => setAssignForm((f) => ({ ...f, userId: e.target.value }))}>
              <option value="">Select a team member</option>
              {collaborators.map((c) => <option key={c.userId} value={c.userId}>{c.name} ({c.email})</option>)}
            </select>
          </div>
          <div>
            <label className={labelClassName}>Role</label>
            <select className={inputClassName} value={assignForm.role} onChange={(e) => setAssignForm((f) => ({ ...f, role: e.target.value }))}>
              {Object.entries(SECTION_ROLE_LABELS).map(([value, lbl]) => (
                <option key={value} value={value}>{lbl}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-400">{SECTION_ROLE_DESCRIPTIONS[assignForm.role] ?? ""}</p>
          </div>
          <div>
            <label className={labelClassName}>Deadline (optional)</label>
            <input type="date" className={inputClassName} value={assignForm.deadline} onChange={(e) => setAssignForm((f) => ({ ...f, deadline: e.target.value }))} />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={handleAssign} disabled={saving || !assignForm.userId} className="flex-1 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white disabled:bg-slate-300">
              {saving ? "Saving..." : "Save Assignment"}
            </button>
            <button type="button" onClick={() => setAssignTarget(null)} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
          </div>
        </div>
      </SlideOver>
    </>
  );
}

// ── Action Button with tooltip ──

function ActionButton({
  icon,
  label,
  tooltip,
  disabled,
  onClick,
  variant,
}: {
  icon: React.ReactNode;
  label: string;
  tooltip: string;
  disabled: boolean;
  onClick: () => void;
  variant: "default" | "primary" | "warning";
}) {
  const cls = {
    default: "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
    primary: "border-emerald-200 bg-emerald-600 text-white hover:bg-emerald-700",
    warning: "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100",
  }[variant];

  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${cls}`}
      >
        {icon}
        {label}
      </button>
      <TooltipHint text={tooltip} />
    </div>
  );
}
