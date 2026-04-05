"use client";

import { useEffect, useMemo, useState } from "react";
import { WorkspaceReportingCopilotPanel } from "./workspace-reporting-copilot-panel";

type WorkspaceRow = {
  id: string;
  title: string;
  status: string;
  bodyCode: string;
  versionCode: string;
  profileName: string;
  resolvedGrade: string | null;
  progressPercent: number;
  approvalPercent: number;
  dataCompleteness: number;
};

type WorkspaceSection = {
  sectionBlockId: string;
  sectionCode: string;
  title: string;
  leafEntryCount: number;
  approvedLeafCount: number;
  status: string;
  actionable: boolean;
  overdueAssignments: number;
  currentUserRoles: string[];
  reviewerDecisionSummary: {
    total: number;
    confirmed: number;
  };
  assignments: Array<{
    id: string;
    role: string;
    deadline: string | null;
    name: string | null;
    email: string | null;
  }>;
};

type WorkspaceCollaboratorSummary = {
  id: string;
  userId: string;
  role: string;
  name: string;
  email: string;
};

type WorkspaceThread = {
  id: string;
  title: string;
  scope: string;
  sectionBlockId: string | null;
  entryId: string | null;
  isResolved: boolean;
  messages: Array<{
    id: string;
    body: string;
    createdAt: string;
    isPostApproval: boolean;
  }>;
};

type WorkspaceDetail = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  targetGrade: string | null;
  periodStart: string;
  periodEnd: string;
  resolvedGrade: string | null;
  resolvedOutcome: string | null;
  overallConvertedScore: number | null;
  isScoreStale: boolean;
  currentUserRole: string | null;
  readiness: {
    blockers: Array<{ code: string; message: string }>;
    warnings: Array<{ code: string; message: string }>;
    canFreeze: boolean;
  } | null;
  sections: WorkspaceSection[];
  dataGaps: Array<{
    blockCode: string;
    blockTitle: string;
    missingYears: number[];
  }>;
  activity: {
    since: string;
    entryChanges: number;
    sectionEvents: number;
    unreadThreads: number;
  } | null;
  freezeLogs: Array<{
    id: string;
    frozenAt: string;
    unfrozenAt: string | null;
    unfreezeReason: string | null;
  }>;
  collaborators: WorkspaceCollaboratorSummary[];
};

const inputClassName =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-slate-900";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
  });
  const data = (await response.json()) as T & { status?: string; message?: string };
  if (!response.ok || data.status === "error") {
    throw new Error(data.message ?? "Request failed.");
  }
  return data;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Not set";
  return new Date(value).toLocaleDateString();
}

export function WorkspaceCollaborationHub() {
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [detail, setDetail] = useState<WorkspaceDetail | null>(null);
  const [threads, setThreads] = useState<WorkspaceThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [threadDraft, setThreadDraft] = useState({
    title: "",
    body: "",
    scope: "WORKSPACE",
    sectionBlockId: "",
    mentionedUserIds: [] as string[],
  });
  const [assignmentDrafts, setAssignmentDrafts] = useState<
    Record<string, { userId: string; role: string; deadline: string }>
  >({});

  async function loadWorkspaces(nextSelectedId?: string | null) {
    const data = await fetchJson<{ workspaces: WorkspaceRow[] }>("/api/tenant/accreditation/workspaces");
    setWorkspaces(data.workspaces ?? []);
    setSelectedWorkspaceId((current) => {
      if (nextSelectedId && data.workspaces.some((workspace) => workspace.id === nextSelectedId)) {
        return nextSelectedId;
      }
      if (current && data.workspaces.some((workspace) => workspace.id === current)) {
        return current;
      }
      return data.workspaces?.[0]?.id ?? null;
    });
  }

  async function loadWorkspaceDetail(workspaceId: string) {
    const data = await fetchJson<{ workspace: WorkspaceDetail }>(
      `/api/tenant/accreditation/workspaces/${workspaceId}`,
    );
    setDetail(data.workspace);
  }

  async function loadThreads(workspaceId: string) {
    const data = await fetchJson<{ threads: WorkspaceThread[] }>(
      `/api/tenant/accreditation/workspaces/${workspaceId}/discussions`,
    );
    setThreads(data.threads ?? []);
  }

  async function refresh(workspaceId?: string | null) {
    await loadWorkspaces(workspaceId);
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadWorkspaces()
      .catch((error: unknown) => {
        if (!active) return;
        setMessage({
          type: "error",
          text: error instanceof Error ? error.message : "Failed to load accreditation workspaces.",
        });
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedWorkspaceId) {
      setDetail(null);
      setThreads([]);
      return;
    }

    Promise.all([loadWorkspaceDetail(selectedWorkspaceId), loadThreads(selectedWorkspaceId)]).catch(
      (error: unknown) => {
        setMessage({
          type: "error",
          text: error instanceof Error ? error.message : "Failed to load workspace detail.",
        });
      },
    );
  }, [selectedWorkspaceId]);

  const sectionOptions = useMemo(() => detail?.sections ?? [], [detail]);
  const collaboratorOptions = useMemo(() => detail?.collaborators ?? [], [detail]);

  useEffect(() => {
    if (!detail) {
      setAssignmentDrafts({});
      return;
    }

    setAssignmentDrafts((current) => {
      const next = { ...current };
      for (const section of detail.sections) {
        if (!next[section.sectionBlockId]) {
          next[section.sectionBlockId] = {
            userId: "",
            role: "RESPONSIBLE",
            deadline: "",
          };
        }
      }
      return next;
    });
  }, [detail]);

  async function runWorkspaceAction(path: string, body?: unknown) {
    if (!selectedWorkspaceId) return;
    setSaving(true);
    setMessage(null);
    try {
      await fetchJson(`/api/tenant/accreditation/workspaces/${selectedWorkspaceId}/${path}`, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      await refresh(selectedWorkspaceId);
      await loadWorkspaceDetail(selectedWorkspaceId);
      await loadThreads(selectedWorkspaceId);
      setMessage({ type: "success", text: "Workspace updated." });
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Workspace action failed.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleFreeze() {
    if (!detail) return;
    const acknowledgments =
      detail.readiness?.warnings.map((warning) => ({
        code: warning.code,
        reason:
          window.prompt(`Acknowledge warning "${warning.message}" with a reason:`) ??
          "Coordinator acknowledged warning.",
      })) ?? [];
    await runWorkspaceAction("freeze", { acknowledgments });
  }

  async function handleUnfreeze() {
    const reason = window.prompt("Why are you unfreezing this workspace?");
    if (!reason) return;
    await runWorkspaceAction("unfreeze", { reason });
  }

  async function handleSectionAction(
    path: string,
    sectionBlockId: string,
    requireComment = false,
  ) {
    const comment = requireComment
      ? window.prompt("Add a comment for this action:")
      : null;
    if (requireComment && !comment) return;
    await runWorkspaceAction(`sections/reviews/${path}`, {
      sectionBlockId,
      comment,
    });
  }

  async function handleAssignSection(sectionBlockId: string) {
    if (!selectedWorkspaceId) return;
    const draft = assignmentDrafts[sectionBlockId];
    if (!draft?.userId) {
      setMessage({ type: "error", text: "Select a collaborator before saving an assignment." });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      await fetchJson(`/api/tenant/accreditation/workspaces/${selectedWorkspaceId}/sections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignments: [
            {
              sectionBlockId,
              userId: draft.userId,
              role: draft.role,
              deadline: draft.deadline || null,
            },
          ],
        }),
      });
      await loadWorkspaceDetail(selectedWorkspaceId);
      setMessage({ type: "success", text: "Section assignment saved." });
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to save section assignment.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateThread(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedWorkspaceId) return;
    setSaving(true);
    setMessage(null);
    try {
      await fetchJson(`/api/tenant/accreditation/workspaces/${selectedWorkspaceId}/discussions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: threadDraft.title,
          body: threadDraft.body,
          scope: threadDraft.scope,
          sectionBlockId:
            threadDraft.scope === "SECTION" ? threadDraft.sectionBlockId || null : null,
          mentionedUserIds: threadDraft.mentionedUserIds,
        }),
      });
      setThreadDraft({
        title: "",
        body: "",
        scope: "WORKSPACE",
        sectionBlockId: "",
        mentionedUserIds: [],
      });
      await loadThreads(selectedWorkspaceId);
      await loadWorkspaceDetail(selectedWorkspaceId);
      setMessage({ type: "success", text: "Discussion created." });
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to create discussion.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleReply(threadId: string) {
    const body = window.prompt("Reply");
    if (!body || !selectedWorkspaceId) return;
    setSaving(true);
    setMessage(null);
    try {
      await fetchJson(`/api/tenant/accreditation/discussions/${threadId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      await loadThreads(selectedWorkspaceId);
      await loadWorkspaceDetail(selectedWorkspaceId);
      setMessage({ type: "success", text: "Reply added." });
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to post reply.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {message ? (
        <div
          className={`rounded-2xl px-4 py-3 text-sm ${
            message.type === "success"
              ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {message.text}
        </div>
      ) : null}

      <section className="grid gap-6 lg:grid-cols-[22rem,1fr]">
        <div className="rounded-[1.75rem] border border-slate-200/80 bg-white/85 p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
            My Workspaces
          </h2>
          <div className="space-y-3">
            {loading ? <p className="text-sm text-slate-500">Loading workspaces...</p> : null}
            {!loading && workspaces.length === 0 ? (
              <p className="text-sm text-slate-500">No visible accreditation workspaces.</p>
            ) : null}
            {workspaces.map((workspace) => (
              <button
                key={workspace.id}
                type="button"
                onClick={() => setSelectedWorkspaceId(workspace.id)}
                className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
                  selectedWorkspaceId === workspace.id
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{workspace.title}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.18em] opacity-70">
                      {workspace.bodyCode} - {workspace.versionCode}
                    </p>
                  </div>
                  <span className="rounded-full bg-white/15 px-3 py-1 text-[11px] font-medium">
                    {workspace.status.replaceAll("_", " ")}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] opacity-80">
                  <div>Progress {workspace.progressPercent}%</div>
                  <div>Approved {workspace.approvalPercent}%</div>
                  <div>Data {workspace.dataCompleteness}%</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          {!detail ? (
            <div className="rounded-[1.75rem] border border-dashed border-slate-300 bg-white/70 p-8 text-sm text-slate-500">
              Select an accreditation workspace to review sections, discussions, and readiness.
            </div>
          ) : (
            <>
              <section className="rounded-[1.75rem] border border-slate-200/80 bg-white/85 p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.28em] text-slate-400">
                      {detail.status.replaceAll("_", " ")}
                    </p>
                    <h2 className="text-2xl font-semibold text-slate-900">{detail.title}</h2>
                    <p className="mt-2 text-sm text-slate-500">
                      {detail.description ?? "Collaboration workspace for accreditation filing."}
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      {formatDate(detail.periodStart)} to {formatDate(detail.periodEnd)} - Target{" "}
                      {detail.targetGrade ?? "Not set"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {detail.currentUserRole === "COORDINATOR" ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void handleFreeze()}
                          disabled={saving || detail.status === "FROZEN"}
                          className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:bg-slate-300"
                        >
                          Freeze
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleUnfreeze()}
                          disabled={saving || detail.status !== "FROZEN"}
                          className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
                        >
                          Unfreeze
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-4">
                  <div className="rounded-2xl bg-slate-50 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Score</p>
                    <p className="mt-2 text-xl font-semibold text-slate-900">
                      {detail.overallConvertedScore ?? "-"}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Grade</p>
                    <p className="mt-2 text-xl font-semibold text-slate-900">
                      {detail.resolvedGrade ?? "-"}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Outcome</p>
                    <p className="mt-2 text-xl font-semibold text-slate-900">
                      {detail.resolvedOutcome ?? "-"}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Since last visit</p>
                    <p className="mt-2 text-sm text-slate-700">
                      {detail.activity
                        ? `${detail.activity.entryChanges} entry changes, ${detail.activity.sectionEvents} section events, ${detail.activity.unreadThreads} active threads`
                        : "No activity summary"}
                    </p>
                  </div>
                </div>
              </section>

              <section className="grid gap-6 xl:grid-cols-[1.3fr,0.9fr]">
                <div className="space-y-6">
                  <div className="rounded-[1.75rem] border border-slate-200/80 bg-white/85 p-6">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Section Review
                    </h3>
                    <div className="mt-4 space-y-4">
                      {detail.sections.map((section) => (
                        <div key={section.sectionBlockId} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">
                                {section.sectionCode} - {section.title}
                              </p>
                              <p className="mt-1 text-xs text-slate-500">
                                {section.approvedLeafCount}/{section.leafEntryCount} entries approved - {section.status.replaceAll("_", " ")}
                              </p>
                              {section.overdueAssignments > 0 ? (
                                <p className="mt-1 text-xs text-amber-600">
                                  {section.overdueAssignments} overdue assignment(s)
                                </p>
                              ) : null}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {section.currentUserRoles.includes("SECTION_LEAD") ||
                              section.currentUserRoles.includes("RESPONSIBLE") ? (
                                <button
                                  type="button"
                                  onClick={() => void handleSectionAction("submit", section.sectionBlockId)}
                                  className="rounded-xl border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700"
                                >
                                  Submit
                                </button>
                              ) : null}
                              {section.currentUserRoles.includes("REVIEWER") ? (
                                <button
                                  type="button"
                                  onClick={() => void handleSectionAction("confirm", section.sectionBlockId)}
                                  className="rounded-xl border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700"
                                >
                                  Confirm Review
                                </button>
                              ) : null}
                              {section.currentUserRoles.includes("REVIEWER") ||
                              section.currentUserRoles.includes("APPROVER") ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleSectionAction(
                                      "changes-requested",
                                      section.sectionBlockId,
                                      true,
                                    )
                                  }
                                  className="rounded-xl border border-amber-300 px-3 py-1 text-xs font-medium text-amber-700"
                                >
                                  Request Changes
                                </button>
                              ) : null}
                              {section.currentUserRoles.includes("APPROVER") ? (
                                <button
                                  type="button"
                                  onClick={() => void handleSectionAction("approve", section.sectionBlockId)}
                                  className="rounded-xl bg-slate-900 px-3 py-1 text-xs font-medium text-white"
                                >
                                  Approve
                                </button>
                              ) : null}
                            </div>
                          </div>
                          {section.reviewerDecisionSummary.total > 0 ? (
                            <p className="mt-3 text-xs text-slate-500">
                              Reviewer confirmations: {section.reviewerDecisionSummary.confirmed}/
                              {section.reviewerDecisionSummary.total}
                            </p>
                          ) : null}
                          {detail.currentUserRole === "COORDINATOR" ? (
                            <div className="mt-4 grid gap-3 rounded-2xl border border-dashed border-slate-300 bg-white p-3 md:grid-cols-4">
                              <select
                                className={inputClassName}
                                value={assignmentDrafts[section.sectionBlockId]?.userId ?? ""}
                                onChange={(event) =>
                                  setAssignmentDrafts((current) => ({
                                    ...current,
                                    [section.sectionBlockId]: {
                                      ...(current[section.sectionBlockId] ?? {
                                        role: "RESPONSIBLE",
                                        deadline: "",
                                      }),
                                      userId: event.target.value,
                                    },
                                  }))
                                }
                              >
                                <option value="">Select collaborator</option>
                                {collaboratorOptions.map((collaborator) => (
                                  <option key={collaborator.userId} value={collaborator.userId}>
                                    {collaborator.name} ({collaborator.role})
                                  </option>
                                ))}
                              </select>
                              <select
                                className={inputClassName}
                                value={assignmentDrafts[section.sectionBlockId]?.role ?? "RESPONSIBLE"}
                                onChange={(event) =>
                                  setAssignmentDrafts((current) => ({
                                    ...current,
                                    [section.sectionBlockId]: {
                                      ...(current[section.sectionBlockId] ?? {
                                        userId: "",
                                        deadline: "",
                                      }),
                                      role: event.target.value,
                                    },
                                  }))
                                }
                              >
                                <option value="SECTION_LEAD">Section Lead</option>
                                <option value="RESPONSIBLE">Responsible</option>
                                <option value="REVIEWER">Reviewer</option>
                                <option value="APPROVER">Approver</option>
                                <option value="VIEWER">Viewer</option>
                              </select>
                              <input
                                className={inputClassName}
                                type="date"
                                value={assignmentDrafts[section.sectionBlockId]?.deadline ?? ""}
                                onChange={(event) =>
                                  setAssignmentDrafts((current) => ({
                                    ...current,
                                    [section.sectionBlockId]: {
                                      ...(current[section.sectionBlockId] ?? {
                                        userId: "",
                                        role: "RESPONSIBLE",
                                      }),
                                      deadline: event.target.value,
                                    },
                                  }))
                                }
                              />
                              <button
                                type="button"
                                onClick={() => void handleAssignSection(section.sectionBlockId)}
                                disabled={saving}
                                className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white disabled:bg-slate-300"
                              >
                                Save Assignment
                              </button>
                            </div>
                          ) : null}
                          {section.assignments.length > 0 ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {section.assignments.map((assignment) => (
                                <span
                                  key={assignment.id}
                                  className="rounded-full bg-white px-3 py-1 text-[11px] text-slate-600"
                                >
                                  {assignment.role}: {assignment.name ?? assignment.email ?? "Unassigned"}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-[1.75rem] border border-slate-200/80 bg-white/85 p-6">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Discussions
                    </h3>
                    <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={(event) => void handleCreateThread(event)}>
                      <input
                        className={inputClassName}
                        placeholder="Discussion title"
                        value={threadDraft.title}
                        onChange={(event) =>
                          setThreadDraft((current) => ({ ...current, title: event.target.value }))
                        }
                      />
                      <select
                        className={inputClassName}
                        value={threadDraft.scope}
                        onChange={(event) =>
                          setThreadDraft((current) => ({ ...current, scope: event.target.value }))
                        }
                      >
                        <option value="WORKSPACE">Workspace</option>
                        <option value="SECTION">Section</option>
                      </select>
                      {threadDraft.scope === "SECTION" ? (
                        <select
                          className={inputClassName}
                          value={threadDraft.sectionBlockId}
                          onChange={(event) =>
                            setThreadDraft((current) => ({
                              ...current,
                              sectionBlockId: event.target.value,
                            }))
                          }
                        >
                          <option value="">Select section</option>
                          {sectionOptions.map((section) => (
                            <option key={section.sectionBlockId} value={section.sectionBlockId}>
                              {section.sectionCode} - {section.title}
                            </option>
                          ))}
                        </select>
                      ) : null}
                      <select
                        multiple
                        className={`${inputClassName} md:col-span-2 min-h-28`}
                        value={threadDraft.mentionedUserIds}
                        onChange={(event) =>
                          setThreadDraft((current) => ({
                            ...current,
                            mentionedUserIds: [...event.target.selectedOptions].map(
                              (option) => option.value,
                            ),
                          }))
                        }
                      >
                        {collaboratorOptions.map((collaborator) => (
                          <option key={collaborator.userId} value={collaborator.userId}>
                            Mention {collaborator.name}
                          </option>
                        ))}
                      </select>
                      <textarea
                        className={`${inputClassName} md:col-span-2 min-h-28`}
                        placeholder="Start the discussion"
                        value={threadDraft.body}
                        onChange={(event) =>
                          setThreadDraft((current) => ({ ...current, body: event.target.value }))
                        }
                      />
                      <button
                        type="submit"
                        disabled={saving}
                        className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white disabled:bg-slate-300"
                      >
                        Create Discussion
                      </button>
                    </form>

                    <div className="mt-5 space-y-4">
                      {threads.map((thread) => (
                        <div key={thread.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">{thread.title}</p>
                              <p className="mt-1 text-xs text-slate-500">
                                {thread.scope.replaceAll("_", " ")} - {thread.isResolved ? "Resolved" : "Open"}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => void handleReply(thread.id)}
                              className="rounded-xl border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700"
                            >
                              Reply
                            </button>
                          </div>
                          <div className="mt-3 space-y-3">
                            {thread.messages.map((messageRow) => (
                              <div key={messageRow.id} className="rounded-xl bg-white px-3 py-2 text-sm text-slate-700">
                                <p>{messageRow.body}</p>
                                <p className="mt-1 text-[11px] text-slate-400">
                                  {formatDate(messageRow.createdAt)}
                                  {messageRow.isPostApproval ? " - post-approval activity" : ""}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="rounded-[1.75rem] border border-slate-200/80 bg-white/85 p-6">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Readiness
                    </h3>
                    <div className="mt-4 space-y-3">
                      {(detail.readiness?.blockers ?? []).map((item) => (
                        <div key={`${item.code}:${item.message}`} className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                          {item.message}
                        </div>
                      ))}
                      {(detail.readiness?.warnings ?? []).map((item) => (
                        <div key={`${item.code}:${item.message}`} className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                          {item.message}
                        </div>
                      ))}
                      {(detail.readiness?.blockers ?? []).length === 0 &&
                      (detail.readiness?.warnings ?? []).length === 0 ? (
                        <p className="text-sm text-emerald-700">No readiness blockers or warnings.</p>
                      ) : null}
                    </div>
                  </div>

                  <div className="rounded-[1.75rem] border border-slate-200/80 bg-white/85 p-6">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Data Gaps
                    </h3>
                    <div className="mt-4 space-y-3">
                      {detail.dataGaps.length === 0 ? (
                        <p className="text-sm text-slate-500">No missing year/value gaps.</p>
                      ) : (
                        detail.dataGaps.map((gap) => (
                          <div key={gap.blockCode} className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                            <p className="font-medium">
                              {gap.blockCode} - {gap.blockTitle}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              Missing: {gap.missingYears.join(", ")}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="rounded-[1.75rem] border border-slate-200/80 bg-white/85 p-6">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Freeze History
                    </h3>
                    <div className="mt-4 space-y-3">
                      {detail.freezeLogs.length === 0 ? (
                        <p className="text-sm text-slate-500">No freeze cycles yet.</p>
                      ) : (
                        detail.freezeLogs.map((log) => (
                          <div key={log.id} className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                            <p>Frozen: {formatDate(log.frozenAt)}</p>
                            <p className="mt-1 text-xs text-slate-500">
                              {log.unfrozenAt
                                ? `Unfrozen ${formatDate(log.unfrozenAt)} - ${log.unfreezeReason ?? "No reason recorded"}`
                                : "Still frozen"}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </section>

              <WorkspaceReportingCopilotPanel
                workspaceId={detail.id}
                workspaceStatus={detail.status}
              />
            </>
          )}
        </div>
      </section>
    </div>
  );
}
