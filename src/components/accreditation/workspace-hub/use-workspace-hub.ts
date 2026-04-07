"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// ── Types ──

export type WorkspaceRow = {
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

export type SectionAssignment = {
  id: string;
  role: string;
  deadline: string | null;
  createdAt: string;
  assignedByUserId: string;
  assignedByName: string | null;
  assignedByEmail: string | null;
  name: string | null;
  email: string | null;
};

export type WorkspaceSection = {
  sectionBlockId: string;
  sectionCode: string;
  title: string;
  leafEntryCount: number;
  approvedLeafCount: number;
  status: string;
  actionable: boolean;
  overdueAssignments: number;
  currentUserRoles: string[];
  reviewerDecisionSummary: { total: number; confirmed: number };
  assignments: SectionAssignment[];
};

export type WorkspaceCollaborator = {
  id: string;
  userId: string;
  role: string;
  name: string;
  email: string;
};

export type AssignableMember = {
  userId: string;
  name: string;
  email: string;
  isWorkspaceCollaborator: boolean;
  collaboratorRole: string | null;
  membershipStatus: string;
};

export type ThreadMessage = {
  id: string;
  body: string;
  createdAt: string;
  isPostApproval: boolean;
};

export type WorkspaceThread = {
  id: string;
  title: string;
  scope: string;
  sectionBlockId: string | null;
  entryId: string | null;
  isResolved: boolean;
  messages: ThreadMessage[];
};

export type WorkspaceDetail = {
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
  dataGaps: Array<{ blockCode: string; blockTitle: string; missingYears: number[] }>;
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
  collaborators: WorkspaceCollaborator[];
};

export type MessageState = { type: "success" | "error"; text: string } | null;

type TenantUserDirectoryRow = {
  id: string;
  name: string;
  email: string;
  status: string;
};

// ── Fetch helpers ──

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = (await response.json()) as T & { status?: string; message?: string };
  if (!response.ok || data.status === "error") {
    throw new Error(data.message ?? "Request failed.");
  }
  return data;
}

// ── Hook ──

export function useWorkspaceHub() {
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [detail, setDetail] = useState<WorkspaceDetail | null>(null);
  const [threads, setThreads] = useState<WorkspaceThread[]>([]);
  const [assignableMembers, setAssignableMembers] = useState<AssignableMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<MessageState>(null);

  const sectionOptions = useMemo(() => detail?.sections ?? [], [detail]);
  const collaboratorOptions = useMemo(() => detail?.collaborators ?? [], [detail]);

  const buildAssignableMembers = useCallback(
    (workspaceDetail: WorkspaceDetail, tenantUsers: TenantUserDirectoryRow[]) => {
      const collaboratorByUserId = new Map(
        workspaceDetail.collaborators.map((collaborator) => [collaborator.userId, collaborator]),
      );
      const merged = tenantUsers.map((user) => {
        const collaborator = collaboratorByUserId.get(user.id);
        return {
          userId: user.id,
          name: user.name,
          email: user.email,
          isWorkspaceCollaborator: Boolean(collaborator),
          collaboratorRole: collaborator?.role ?? null,
          membershipStatus: user.status,
        } satisfies AssignableMember;
      });

      for (const collaborator of workspaceDetail.collaborators) {
        if (collaboratorByUserId.has(collaborator.userId) && merged.some((user) => user.userId === collaborator.userId)) {
          continue;
        }
        merged.push({
          userId: collaborator.userId,
          name: collaborator.name,
          email: collaborator.email,
          isWorkspaceCollaborator: true,
          collaboratorRole: collaborator.role,
          membershipStatus: "ACTIVE",
        });
      }

      return merged.sort((left, right) => {
        if (left.isWorkspaceCollaborator !== right.isWorkspaceCollaborator) {
          return left.isWorkspaceCollaborator ? -1 : 1;
        }
        return left.name.localeCompare(right.name);
      });
    },
    [],
  );

  // ── Fetchers ──

  const loadWorkspaces = useCallback(async (nextSelectedId?: string | null) => {
    const data = await fetchJson<{ workspaces: WorkspaceRow[] }>("/api/tenant/accreditation/workspaces");
    setWorkspaces(data.workspaces ?? []);
    setSelectedWorkspaceId((current) => {
      if (nextSelectedId && data.workspaces.some((w) => w.id === nextSelectedId)) return nextSelectedId;
      if (current && data.workspaces.some((w) => w.id === current)) return current;
      return data.workspaces?.[0]?.id ?? null;
    });
  }, []);

  const loadDetail = useCallback(async (workspaceId: string) => {
    const data = await fetchJson<{ workspace: WorkspaceDetail }>(
      `/api/tenant/accreditation/workspaces/${workspaceId}`,
    );
    setDetail(data.workspace);
  }, []);

  const loadThreads = useCallback(async (workspaceId: string) => {
    const data = await fetchJson<{ threads: WorkspaceThread[] }>(
      `/api/tenant/accreditation/workspaces/${workspaceId}/discussions`,
    );
    setThreads(data.threads ?? []);
  }, []);

  const loadTenantUsers = useCallback(async () => {
    return fetchJson<TenantUserDirectoryRow[]>("/api/tenant/users");
  }, []);

  const refreshAll = useCallback(async (workspaceId: string) => {
    await loadWorkspaces(workspaceId);
    await loadDetail(workspaceId);
    await loadThreads(workspaceId);
  }, [loadWorkspaces, loadDetail, loadThreads]);

  // ── Effects ──

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadWorkspaces()
      .catch((error: unknown) => {
        if (active) setMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to load workspaces." });
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadWorkspaces]);

  useEffect(() => {
    if (!selectedWorkspaceId) { setDetail(null); setThreads([]); return; }
    Promise.all([loadDetail(selectedWorkspaceId), loadThreads(selectedWorkspaceId)]).catch(
      (error: unknown) => {
        setMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to load workspace detail." });
      },
    );
  }, [selectedWorkspaceId, loadDetail, loadThreads]);

  useEffect(() => {
    if (!detail) {
      setAssignableMembers([]);
      return;
    }
    if (detail.currentUserRole !== "COORDINATOR") {
      setAssignableMembers(
        detail.collaborators.map((collaborator) => ({
          userId: collaborator.userId,
          name: collaborator.name,
          email: collaborator.email,
          isWorkspaceCollaborator: true,
          collaboratorRole: collaborator.role,
          membershipStatus: "ACTIVE",
        })),
      );
      return;
    }

    let active = true;
    loadTenantUsers()
      .then((tenantUsers) => {
        if (!active) return;
        setAssignableMembers(buildAssignableMembers(detail, tenantUsers));
      })
      .catch((error: unknown) => {
        if (!active) return;
        setAssignableMembers(
          detail.collaborators.map((collaborator) => ({
            userId: collaborator.userId,
            name: collaborator.name,
            email: collaborator.email,
            isWorkspaceCollaborator: true,
            collaboratorRole: collaborator.role,
            membershipStatus: "ACTIVE",
          })),
        );
        setMessage({
          type: "error",
          text: error instanceof Error ? error.message : "Failed to load tenant members.",
        });
      });

    return () => {
      active = false;
    };
  }, [detail, loadTenantUsers, buildAssignableMembers]);

  // ── Mutation wrapper ──

  async function withSave(task: () => Promise<void>) {
    setSaving(true);
    setMessage(null);
    try {
      await task();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Action failed." });
    } finally {
      setSaving(false);
    }
  }

  // ── Actions ──

  async function runWorkspaceAction(path: string, body?: unknown) {
    if (!selectedWorkspaceId) return;
    await withSave(async () => {
      await fetchJson(`/api/tenant/accreditation/workspaces/${selectedWorkspaceId}/${path}`, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      await refreshAll(selectedWorkspaceId);
      setMessage({ type: "success", text: "Workspace updated." });
    });
  }

  async function freezeWorkspace(acknowledgments: Array<{ code: string; reason: string }>) {
    await runWorkspaceAction("freeze", { acknowledgments });
  }

  async function unfreezeWorkspace(reason: string) {
    await runWorkspaceAction("unfreeze", { reason });
  }

  async function sectionAction(path: string, sectionBlockId: string, comment?: string | null) {
    await runWorkspaceAction(`sections/reviews/${path}`, { sectionBlockId, comment: comment ?? null });
  }

  async function assignSection(sectionBlockId: string, userId: string, role: string, deadline: string | null) {
    if (!selectedWorkspaceId) return;
    await withSave(async () => {
      await fetchJson(`/api/tenant/accreditation/workspaces/${selectedWorkspaceId}/sections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignments: [{ sectionBlockId, userId, role, deadline: deadline || null }] }),
      });
      await loadDetail(selectedWorkspaceId);
      setMessage({ type: "success", text: "Section assignment saved." });
    });
  }

  async function createThread(payload: {
    title: string;
    body: string;
    scope: string;
    sectionBlockId: string | null;
    mentionedUserIds: string[];
  }) {
    if (!selectedWorkspaceId) return;
    await withSave(async () => {
      await fetchJson(`/api/tenant/accreditation/workspaces/${selectedWorkspaceId}/discussions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await loadThreads(selectedWorkspaceId);
      await loadDetail(selectedWorkspaceId);
      setMessage({ type: "success", text: "Discussion created." });
    });
  }

  async function replyToThread(threadId: string, body: string) {
    if (!selectedWorkspaceId) return;
    await withSave(async () => {
      await fetchJson(`/api/tenant/accreditation/discussions/${threadId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      await loadThreads(selectedWorkspaceId);
      await loadDetail(selectedWorkspaceId);
      setMessage({ type: "success", text: "Reply posted." });
    });
  }

  return {
    workspaces,
    selectedWorkspaceId,
    setSelectedWorkspaceId,
    detail,
    threads,
    loading,
    saving,
    message,
    setMessage,
    sectionOptions,
    collaboratorOptions,
    assignableMembers,

    freezeWorkspace,
    unfreezeWorkspace,
    sectionAction,
    assignSection,
    createThread,
    replyToThread,
  };
}

export type WorkspaceHubHook = ReturnType<typeof useWorkspaceHub>;
