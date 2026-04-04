"use client";

import { useEffect, useState } from "react";

type BodyOption = {
  id: string;
  code: string;
  name: string;
};

type VersionOption = {
  id: string;
  versionCode: string;
  versionName: string;
  isActive: boolean;
};

type ProfileOption = {
  id: string;
  profileCode: string;
  profileName: string;
};

type WorkspaceRow = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  targetGrade: string | null;
  periodStart: string;
  periodEnd: string;
  bodyCode: string;
  versionCode: string;
  profileName: string;
  overallRawScore: number | null;
  overallConvertedScore: number | null;
  resolvedGrade: string | null;
  isScoreStale: boolean;
  progressPercent: number;
  approvalPercent: number;
  dataCompleteness: number;
};

type WorkspaceDetail = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  targetGrade: string | null;
  periodStart: string;
  periodEnd: string;
  overallRawScore: number | null;
  overallConvertedScore: number | null;
  resolvedGrade: string | null;
  resolvedOutcome: string | null;
  isScoreStale: boolean;
  lastSuccessfulScoreAt: string | null;
  frozenAt: string | null;
  bodyCode: string;
  versionCode: string;
  profileName: string;
  progressPercent: number;
  approvalPercent: number;
  dataCompleteness: number;
  readiness: {
    blockers: Array<{ code: string; message: string }>;
    warnings: Array<{ code: string; message: string }>;
    canFreeze: boolean;
  } | null;
  entries: Array<{
    id: string;
    blockId: string;
    blockCode: string;
    blockTitle: string;
    status: string;
    computedScore: number | null;
    manualOverride: number | null;
    finalScore: number | null;
    responses: Array<{
      year: number;
      actualValue: number | null;
      textValue: string | null;
    }>;
  }>;
  snapshots: Array<{
    id: string;
    snapshotName: string | null;
    takenAt: string;
    resolvedGrade: string | null;
  }>;
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

export function WorkspaceManager() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [bodies, setBodies] = useState<BodyOption[]>([]);
  const [versions, setVersions] = useState<VersionOption[]>([]);
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [selectedBodyId, setSelectedBodyId] = useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [detail, setDetail] = useState<WorkspaceDetail | null>(null);

  async function loadBodies() {
    const data = await fetchJson<{ bodies: BodyOption[] }>("/api/tenant/accreditation/bodies");
    setBodies(data.bodies ?? []);
    setSelectedBodyId((current) => current ?? data.bodies?.[0]?.id ?? null);
  }

  async function loadVersions(bodyId: string) {
    const data = await fetchJson<{ versions: VersionOption[] }>(
      `/api/tenant/accreditation/bodies/${bodyId}/versions`,
    );
    setVersions(data.versions ?? []);
    setSelectedVersionId((current) => {
      if (current && data.versions.some((version) => version.id === current)) return current;
      return data.versions?.[0]?.id ?? null;
    });
  }

  async function loadProfiles(versionId: string) {
    const data = await fetchJson<{ profiles: ProfileOption[] }>(
      `/api/tenant/accreditation/versions/${versionId}/profiles`,
    );
    setProfiles(data.profiles ?? []);
    setSelectedProfileId((current) => {
      if (current && data.profiles.some((profile) => profile.id === current)) return current;
      return data.profiles?.[0]?.id ?? null;
    });
  }

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

  async function refresh(afterSelectId?: string | null) {
    await loadWorkspaces(afterSelectId);
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([loadBodies(), loadWorkspaces()])
      .catch((error: unknown) => {
        if (!active) return;
        setMessage({
          type: "error",
          text: error instanceof Error ? error.message : "Failed to load workspace data.",
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
    if (!selectedBodyId) return;
    loadVersions(selectedBodyId).catch((error: unknown) => {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to load accreditation versions.",
      });
    });
  }, [selectedBodyId]);

  useEffect(() => {
    if (!selectedVersionId) return;
    loadProfiles(selectedVersionId).catch((error: unknown) => {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to load accreditation profiles.",
      });
    });
  }, [selectedVersionId]);

  useEffect(() => {
    if (!selectedWorkspaceId) {
      setDetail(null);
      return;
    }

    loadWorkspaceDetail(selectedWorkspaceId).catch((error: unknown) => {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to load workspace detail.",
      });
    });
  }, [selectedWorkspaceId]);

  async function handleCreateWorkspace(formData: FormData) {
    setSaving(true);
    setMessage(null);

    try {
      const response = await fetchJson<{ workspace: WorkspaceDetail }>(
        "/api/tenant/accreditation/workspaces",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            versionId: selectedVersionId,
            profileId: selectedProfileId,
            title: String(formData.get("title") ?? ""),
            description: String(formData.get("description") ?? ""),
            periodStart: String(formData.get("periodStart") ?? ""),
            periodEnd: String(formData.get("periodEnd") ?? ""),
            targetGrade: String(formData.get("targetGrade") ?? ""),
          }),
        },
      );
      await refresh(response.workspace.id);
      setMessage({ type: "success", text: "Workspace created." });
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to create workspace.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function runWorkspaceAction(
    path: string,
    method: "POST" | "PATCH" = "POST",
    body?: unknown,
  ) {
    if (!selectedWorkspaceId) return;
    setSaving(true);
    setMessage(null);
    try {
      await fetchJson(`/api/tenant/accreditation/workspaces/${selectedWorkspaceId}/${path}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      await refresh(selectedWorkspaceId);
      await loadWorkspaceDetail(selectedWorkspaceId);
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

  async function handleImport(event: React.ChangeEvent<HTMLInputElement>) {
    if (!selectedWorkspaceId || !event.target.files?.[0]) return;
    const formData = new FormData();
    formData.append("file", event.target.files[0]);
    setSaving(true);
    setMessage(null);
    try {
      await fetchJson(`/api/tenant/accreditation/workspaces/${selectedWorkspaceId}/import-data`, {
        method: "POST",
        body: formData,
      });
      await refresh(selectedWorkspaceId);
      await loadWorkspaceDetail(selectedWorkspaceId);
      setMessage({ type: "success", text: "Workspace data imported." });
      event.target.value = "";
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Import failed.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[1.75rem] border border-slate-200/80 bg-white/85 p-6">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-slate-400">R3.2A</p>
            <h2 className="text-xl font-semibold text-slate-900">Assessment Workspaces</h2>
            <p className="text-sm text-slate-500">
              Create filing workspaces, track readiness, run scores, freeze submissions, and review entry progress.
            </p>
          </div>
        </div>

        {message ? (
          <div
            className={`mb-4 rounded-2xl px-4 py-3 text-sm ${
              message.type === "success"
                ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border border-rose-200 bg-rose-50 text-rose-700"
            }`}
          >
            {message.text}
          </div>
        ) : null}

        <form
          className="grid gap-3 md:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            void handleCreateWorkspace(formData);
          }}
        >
          <select
            className={inputClassName}
            value={selectedBodyId ?? ""}
            onChange={(event) => setSelectedBodyId(event.target.value || null)}
          >
            <option value="">Select body</option>
            {bodies.map((body) => (
              <option key={body.id} value={body.id}>
                {body.code} · {body.name}
              </option>
            ))}
          </select>
          <select
            className={inputClassName}
            value={selectedVersionId ?? ""}
            onChange={(event) => setSelectedVersionId(event.target.value || null)}
          >
            <option value="">Select version</option>
            {versions.map((version) => (
              <option key={version.id} value={version.id}>
                {version.versionCode} · {version.versionName}
              </option>
            ))}
          </select>
          <select
            className={inputClassName}
            value={selectedProfileId ?? ""}
            onChange={(event) => setSelectedProfileId(event.target.value || null)}
          >
            <option value="">Select profile</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.profileCode} · {profile.profileName}
              </option>
            ))}
          </select>
          <input className={inputClassName} name="title" placeholder="Workspace title" required />
          <input className={inputClassName} name="targetGrade" placeholder="Target grade" />
          <input className={inputClassName} name="description" placeholder="Description" />
          <input className={inputClassName} type="date" name="periodStart" required />
          <input className={inputClassName} type="date" name="periodEnd" required />
          <button
            type="submit"
            disabled={saving || !selectedVersionId || !selectedProfileId}
            className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {saving ? "Saving..." : "Create Workspace"}
          </button>
        </form>
      </section>

      <section className="grid gap-6 lg:grid-cols-[24rem,1fr]">
        <div className="rounded-[1.75rem] border border-slate-200/80 bg-white/85 p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
            Workspace List
          </h3>
          <div className="space-y-3">
            {loading ? <p className="text-sm text-slate-500">Loading workspaces...</p> : null}
            {!loading && workspaces.length === 0 ? (
              <p className="text-sm text-slate-500">No workspaces yet.</p>
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
                <p className="text-sm font-semibold">{workspace.title}</p>
                <p className="mt-1 text-xs opacity-80">
                  {workspace.bodyCode} · {workspace.versionCode} · {workspace.profileName}
                </p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full bg-black/10 px-2 py-1">{workspace.status}</span>
                  <span className="rounded-full bg-black/10 px-2 py-1">
                    Progress {workspace.progressPercent}%
                  </span>
                  <span className="rounded-full bg-black/10 px-2 py-1">
                    Approved {workspace.approvalPercent}%
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-[1.75rem] border border-slate-200/80 bg-white/85 p-6">
          {!detail ? (
            <p className="text-sm text-slate-500">Select a workspace to inspect details.</p>
          ) : (
            <div className="space-y-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                    {detail.bodyCode} · {detail.versionCode}
                  </p>
                  <h3 className="text-2xl font-semibold text-slate-900">{detail.title}</h3>
                  <p className="text-sm text-slate-500">
                    {detail.profileName} · {formatDate(detail.periodStart)} to {formatDate(detail.periodEnd)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void runWorkspaceAction("compute-scores")}
                    className="rounded-2xl border border-slate-300 px-4 py-2 text-sm text-slate-700"
                  >
                    Recompute
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() =>
                      void runWorkspaceAction(detail.status === "FROZEN" ? "unfreeze" : "freeze")
                    }
                    className="rounded-2xl bg-slate-900 px-4 py-2 text-sm text-white"
                  >
                    {detail.status === "FROZEN" ? "Unfreeze" : "Freeze"}
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void runWorkspaceAction("snapshots")}
                    className="rounded-2xl border border-slate-300 px-4 py-2 text-sm text-slate-700"
                  >
                    Snapshot
                  </button>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Raw Score</p>
                  <p className="mt-1 text-xl font-semibold text-slate-900">
                    {detail.overallRawScore ?? "—"}
                  </p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Converted</p>
                  <p className="mt-1 text-xl font-semibold text-slate-900">
                    {detail.overallConvertedScore ?? "—"}
                  </p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Grade</p>
                  <p className="mt-1 text-xl font-semibold text-slate-900">
                    {detail.resolvedGrade ?? "—"}
                  </p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Score State</p>
                  <p className="mt-1 text-xl font-semibold text-slate-900">
                    {detail.isScoreStale ? "Stale" : "Fresh"}
                  </p>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Progress</p>
                  <p className="mt-1 text-lg font-semibold text-slate-900">
                    {detail.progressPercent}%
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Approval</p>
                  <p className="mt-1 text-lg font-semibold text-slate-900">
                    {detail.approvalPercent}%
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Data Completeness</p>
                  <p className="mt-1 text-lg font-semibold text-slate-900">
                    {detail.dataCompleteness}%
                  </p>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-[1.2fr,0.8fr]">
                <div className="rounded-2xl border border-slate-200 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h4 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Entry Status
                    </h4>
                    <label className="rounded-2xl border border-slate-200 px-3 py-2 text-xs text-slate-600">
                      Import CSV/XLSX
                      <input
                        type="file"
                        className="hidden"
                        accept=".csv,.xlsx,.xls"
                        onChange={(event) => void handleImport(event)}
                      />
                    </label>
                  </div>
                  <div className="max-h-[26rem] overflow-auto">
                    <table className="w-full min-w-[38rem] text-sm">
                      <thead className="text-left text-xs uppercase tracking-[0.16em] text-slate-400">
                        <tr>
                          <th className="pb-3">Block</th>
                          <th className="pb-3">Status</th>
                          <th className="pb-3">Score</th>
                          <th className="pb-3">Years</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {detail.entries.map((entry) => (
                          <tr key={entry.id}>
                            <td className="py-3 pr-3">
                              <div className="font-medium text-slate-900">{entry.blockCode}</div>
                              <div className="text-xs text-slate-500">{entry.blockTitle}</div>
                            </td>
                            <td className="py-3 pr-3 text-slate-600">{entry.status}</td>
                            <td className="py-3 pr-3 text-slate-600">{entry.finalScore ?? "—"}</td>
                            <td className="py-3 text-slate-600">
                              {entry.responses.length > 0
                                ? entry.responses
                                    .map((response) => `${response.year}:${response.actualValue ?? response.textValue ?? "—"}`)
                                    .join(", ")
                                : "No data"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded-2xl border border-slate-200 p-4">
                    <h4 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Readiness
                    </h4>
                    <div className="space-y-2">
                      {(detail.readiness?.blockers ?? []).map((item) => (
                        <p key={`${item.code}-${item.message}`} className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
                          {item.message}
                        </p>
                      ))}
                      {(detail.readiness?.warnings ?? []).map((item) => (
                        <p key={`${item.code}-${item.message}`} className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700">
                          {item.message}
                        </p>
                      ))}
                      {detail.readiness && detail.readiness.blockers.length === 0 && detail.readiness.warnings.length === 0 ? (
                        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                          No current readiness blockers or warnings.
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 p-4">
                    <h4 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Snapshots
                    </h4>
                    <div className="space-y-2">
                      {detail.snapshots.length === 0 ? (
                        <p className="text-sm text-slate-500">No snapshots yet.</p>
                      ) : (
                        detail.snapshots.map((snapshot) => (
                          <div key={snapshot.id} className="rounded-xl bg-slate-50 px-3 py-2">
                            <p className="text-sm font-medium text-slate-900">
                              {snapshot.snapshotName ?? "Snapshot"}
                            </p>
                            <p className="text-xs text-slate-500">
                              {formatDate(snapshot.takenAt)} · Grade {snapshot.resolvedGrade ?? "—"}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

