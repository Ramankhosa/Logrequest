// ── Workspace-level statuses ──

export const WORKSPACE_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  OPEN: "Open",
  IN_PROGRESS: "In Progress",
  UNDER_REVIEW: "Under Review",
  FROZEN: "Frozen",
  SUBMITTED: "Submitted",
  COMPLETED: "Completed",
  ARCHIVED: "Archived",
};

export const WORKSPACE_STATUS_CLASSES: Record<string, string> = {
  DRAFT: "border-slate-200 bg-slate-50 text-slate-600",
  OPEN: "border-blue-200 bg-blue-50 text-blue-700",
  IN_PROGRESS: "border-indigo-200 bg-indigo-50 text-indigo-700",
  UNDER_REVIEW: "border-violet-200 bg-violet-50 text-violet-700",
  FROZEN: "border-cyan-200 bg-cyan-50 text-cyan-700",
  SUBMITTED: "border-amber-200 bg-amber-50 text-amber-700",
  COMPLETED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  ARCHIVED: "border-slate-200 bg-slate-100 text-slate-500",
};

// ── Section-level statuses ──

export const SECTION_STATUS_LABELS: Record<string, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In Progress",
  SUBMITTED: "Submitted for Review",
  CONFIRMED: "Reviewer Confirmed",
  CHANGES_REQUESTED: "Changes Requested",
  APPROVED: "Approved",
};

export const SECTION_STATUS_CLASSES: Record<string, string> = {
  OPEN: "border-slate-200 bg-slate-50 text-slate-600",
  IN_PROGRESS: "border-blue-200 bg-blue-50 text-blue-700",
  SUBMITTED: "border-indigo-200 bg-indigo-50 text-indigo-700",
  CONFIRMED: "border-violet-200 bg-violet-50 text-violet-700",
  CHANGES_REQUESTED: "border-amber-200 bg-amber-50 text-amber-700",
  APPROVED: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

// ── Section roles ──

export const SECTION_ROLE_LABELS: Record<string, string> = {
  SECTION_LEAD: "Section Lead",
  RESPONSIBLE: "Responsible",
  REVIEWER: "Reviewer",
  APPROVER: "Approver",
  VIEWER: "Viewer",
};

export const SECTION_ROLE_DESCRIPTIONS: Record<string, string> = {
  SECTION_LEAD: "Coordinates work within this section and can submit for review.",
  RESPONSIBLE: "Fills in data and responses for this section's criteria.",
  REVIEWER: "Reviews submitted entries and can confirm or request changes.",
  APPROVER: "Gives final approval for this section's entries.",
  VIEWER: "Read-only access to this section's entries and discussions.",
};

// ── Workspace user roles ──

export const USER_ROLE_LABELS: Record<string, string> = {
  COORDINATOR: "Coordinator",
  COLLABORATOR: "Collaborator",
  VIEWER: "Viewer",
};

// ── Tooltips for key concepts ──

export const TOOLTIP_FREEZE =
  "Freezing locks all entries and prevents further edits. Use this when the application is ready for final submission.";

export const TOOLTIP_UNFREEZE =
  "Unfreezing re-opens the workspace for further editing. You'll need to provide a reason for the audit trail.";

export const TOOLTIP_SECTION_SUBMIT =
  "Submit this section for review. The assigned reviewer(s) will be notified to start their review.";

export const TOOLTIP_SECTION_CONFIRM =
  "Confirm that you've reviewed this section's entries and they meet the required standard.";

export const TOOLTIP_SECTION_CHANGES =
  "Request changes from the section lead. You'll be asked to add a comment explaining what needs to change.";

export const TOOLTIP_SECTION_APPROVE =
  "Give final approval for this section. Once approved, the section is locked unless changes are explicitly requested.";

export const TOOLTIP_READINESS_BLOCKERS =
  "Blockers must be resolved before the workspace can be frozen for submission. They indicate missing required data.";

export const TOOLTIP_READINESS_WARNINGS =
  "Warnings are non-critical issues. You can proceed with submission but should acknowledge each one.";

export const TOOLTIP_DATA_GAPS =
  "Data gaps show criteria blocks that are missing institutional data for required years. Fill these via the Institutional Databank.";

export const TOOLTIP_DISCUSSION_SCOPE =
  "Workspace-scoped discussions are visible to all collaborators. Section-scoped discussions are limited to that section's team.";

// ── Helper ──

export function statusLabel(map: Record<string, string>, value: string | null | undefined): string {
  if (!value) return "Unknown";
  return map[value] ?? value.replaceAll("_", " ");
}

export const inputClassName =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-slate-900";

export const labelClassName = "block text-xs font-medium text-slate-500 mb-1";
