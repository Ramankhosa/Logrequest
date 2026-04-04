"use client";

import { useEffect, useMemo, useState } from "react";

type BodyRow = {
  id: string;
  scope: "GLOBAL" | "TENANT";
  code: string;
  name: string;
  country: string | null;
  description: string | null;
  websiteUrl: string | null;
  isActive: boolean;
  versionCount: number;
};

type VersionRow = {
  id: string;
  versionCode: string;
  versionName: string;
  scoreBase: number;
  isActive: boolean;
  lifecycleStatus: "DRAFT" | "VALIDATED" | "PUBLISHED" | "SUPERSEDED" | "ARCHIVED";
  blockCount?: number;
};

type BlockNode = {
  id: string;
  parentId: string | null;
  blockCode: string;
  blockType: "GROUP" | "METRIC" | "QUALITATIVE" | "COMPOSITE";
  title: string;
  description?: string | null;
  depth: number;
  isActive: boolean;
  maxScore?: number | null;
  unitOfMeasure?: string | null;
  scoringRule?: unknown;
  validationRules?: unknown;
  evidenceSchema?: unknown;
  dependencyRules?: unknown;
  isLeaf?: boolean;
  children: BlockNode[];
};

type ProfileWeightRow = {
  blockId?: string;
  maxScore: number;
  weightPercent: number | null;
};

type ProfileRow = {
  id: string;
  profileCode: string;
  profileName: string;
  isDefault: boolean;
  weightOverrideCount: number;
  weightOverrides?: ProfileWeightRow[];
};

type CriterionNode = {
  id: string;
  parentId: string | null;
  blockCode: string;
  title: string;
  depth: number;
  isLeaf: boolean;
  isActive: boolean;
  children: CriterionNode[];
};

type KpiOption = {
  id: string;
  title: string;
  kraTitle: string;
  periodName: string;
  accreditationLinkCount: number;
};

type LinkRow = {
  id: string;
  blockId: string;
  blockCode: string;
  blockTitle: string;
  bodyCode: string;
  versionCode: string;
  notes: string | null;
};

type CriterionKpiRow = {
  linkId: string;
  blockId?: string;
  kpiId: string;
  title: string;
  kraTitle: string;
  periodName: string;
  notes: string | null;
};

const inputClassName =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-slate-900";

function flattenCriteria(nodes: CriterionNode[]): CriterionNode[] {
  const flat: CriterionNode[] = [];
  const walk = (items: CriterionNode[]) => {
    for (const item of items) {
      flat.push(item);
      walk(item.children);
    }
  };
  walk(nodes);
  return flat;
}

function flattenBlocks(nodes: BlockNode[]): BlockNode[] {
  const flat: BlockNode[] = [];
  const walk = (items: BlockNode[]) => {
    for (const item of items) {
      flat.push(item);
      walk(item.children);
    }
  };
  walk(nodes);
  return flat;
}

function mapBlocksToCriteria(nodes: BlockNode[]): CriterionNode[] {
  return nodes.map((block) => ({
    id: block.id,
    parentId: block.parentId,
    blockCode: block.blockCode,
    title: block.title,
    depth: block.depth,
    isLeaf: block.isLeaf ?? (block.blockType === "METRIC" || block.blockType === "QUALITATIVE"),
    isActive: block.isActive,
    children: mapBlocksToCriteria(block.children),
  }));
}

function toNullableNumber(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNumber(value: FormDataEntryValue | null, fallback = 0): number {
  const parsed = toNullableNumber(value);
  return parsed ?? fallback;
}

export function AccreditationManager({
  scope,
  initialKpiId,
}: {
  scope: "tenant" | "superadmin";
  initialKpiId?: string | null;
}) {
  const basePath =
    scope === "tenant" ? "/api/tenant/accreditation" : "/api/superadmin/accreditation";
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [bodies, setBodies] = useState<BodyRow[]>([]);
  const [selectedBodyId, setSelectedBodyId] = useState<string | null>(null);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<BlockNode[]>([]);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [criteria, setCriteria] = useState<CriterionNode[]>([]);
  const [selectedCriterionId, setSelectedCriterionId] = useState<string | null>(null);
  const [blockKpis, setBlockKpis] = useState<CriterionKpiRow[]>([]);
  const [kpis, setKpis] = useState<KpiOption[]>([]);
  const [selectedKpiId, setSelectedKpiId] = useState<string | null>(initialKpiId ?? null);
  const [links, setLinks] = useState<LinkRow[]>([]);

  const selectedBody = bodies.find((body) => body.id === selectedBodyId) ?? null;
  const selectedVersion = versions.find((version) => version.id === selectedVersionId) ?? null;
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? null;
  const canEditSelectedBody = scope === "superadmin" || selectedBody?.scope === "TENANT";
  const canEditSelectedVersionBlocks =
    canEditSelectedBody &&
    (selectedVersion?.lifecycleStatus === "DRAFT" ||
      selectedVersion?.lifecycleStatus === "VALIDATED");
  const flatBlocks = useMemo(() => flattenBlocks(blocks), [blocks]);
  const selectedBlock = flatBlocks.find((block) => block.id === selectedBlockId) ?? null;
  const canEditRuntimeCriteria = false;
  const flatCriteria = useMemo(() => flattenCriteria(criteria), [criteria]);
  const leafCriteria = useMemo(
    () => flatCriteria.filter((criterion) => criterion.isLeaf),
    [flatCriteria],
  );
  const selectedCriterion =
    flatCriteria.find((criterion) => criterion.id === selectedCriterionId) ?? null;

  async function fetchBodies() {
    const response = await fetch(`${basePath}/bodies`, { cache: "no-store" });
    const data = (await response.json()) as {
      status: "success" | "error";
      message?: string;
      bodies?: BodyRow[];
    };
    if (!response.ok || data.status !== "success") {
      throw new Error(data.message ?? "Failed to load accreditation bodies.");
    }
    setBodies(data.bodies ?? []);
  }

  async function fetchVersions(bodyId: string) {
    const response = await fetch(`${basePath}/bodies/${bodyId}/versions`, {
      cache: "no-store",
    });
    const data = (await response.json()) as {
      status: "success" | "error";
      message?: string;
      versions?: VersionRow[];
    };
    if (!response.ok || data.status !== "success") {
      throw new Error(data.message ?? "Failed to load accreditation versions.");
    }
    setVersions(data.versions ?? []);
  }

  async function fetchProfiles(versionId: string) {
    const response = await fetch(`${basePath}/versions/${versionId}/profiles`, {
      cache: "no-store",
    });
    const data = (await response.json()) as {
      status: "success" | "error";
      message?: string;
      profiles?: ProfileRow[];
    };
    if (!response.ok || data.status !== "success") {
      throw new Error(data.message ?? "Failed to load accreditation profiles.");
    }
    setProfiles(data.profiles ?? []);
  }

  async function fetchBlocks(versionId: string) {
    const response = await fetch(`${basePath}/versions/${versionId}/blocks`, {
      cache: "no-store",
    });
    const data = (await response.json()) as {
      status: "success" | "error";
      message?: string;
      blocks?: BlockNode[];
    };
    if (!response.ok || data.status !== "success") {
      throw new Error(data.message ?? "Failed to load template blocks.");
    }
    const nextBlocks = data.blocks ?? [];
    setBlocks(nextBlocks);
    setCriteria(mapBlocksToCriteria(nextBlocks));
  }

  async function fetchKpis() {
    if (scope !== "tenant") {
      return;
    }

    const response = await fetch("/api/tenant/accreditation/kpis/options", {
      cache: "no-store",
    });
    const data = (await response.json()) as {
      status: "success" | "error";
      message?: string;
      kpis?: KpiOption[];
    };
    if (!response.ok || data.status !== "success") {
      throw new Error(data.message ?? "Failed to load KPI options.");
    }
    setKpis(data.kpis ?? []);
  }

  async function fetchLinks(kpiId: string) {
    if (scope !== "tenant") {
      return;
    }

    const response = await fetch(`/api/tenant/accreditation/kpis/${kpiId}/links`, {
      cache: "no-store",
    });
    const data = (await response.json()) as {
      status: "success" | "error";
      message?: string;
      links?: LinkRow[];
    };
    if (!response.ok || data.status !== "success") {
      throw new Error(data.message ?? "Failed to load KPI links.");
    }
    setLinks(data.links ?? []);
  }

  async function fetchBlockKpis(blockId: string) {
    if (scope !== "tenant") {
      return;
    }

    const response = await fetch(`/api/tenant/accreditation/blocks/${blockId}/kpis`, {
      cache: "no-store",
    });
    const data = (await response.json()) as {
      status: "success" | "error";
      message?: string;
      kpis?: CriterionKpiRow[];
    };
    if (!response.ok || data.status !== "success") {
      throw new Error(data.message ?? "Failed to load linked KPIs.");
    }
    setBlockKpis(data.kpis ?? []);
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        await fetchBodies();
        if (scope === "tenant") {
          await fetchKpis();
        }
        if (!cancelled) {
          setMessage(null);
        }
      } catch (error) {
        if (!cancelled) {
          setMessage({
            type: "error",
            text:
              error instanceof Error
                ? error.message
                : "Failed to load accreditation data.",
          });
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [basePath, scope]);

  useEffect(() => {
    if (!selectedBodyId && bodies.length > 0) {
      setSelectedBodyId(bodies[0]!.id);
      return;
    }

    if (selectedBodyId && !bodies.some((body) => body.id === selectedBodyId)) {
      setSelectedBodyId(bodies[0]?.id ?? null);
    }
  }, [bodies, selectedBodyId]);

  useEffect(() => {
    if (!selectedBodyId) {
      setVersions([]);
      setSelectedVersionId(null);
      return;
    }

    void fetchVersions(selectedBodyId).catch((error) => {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to load versions.",
      });
      setVersions([]);
      setSelectedVersionId(null);
    });
  }, [selectedBodyId]);

  useEffect(() => {
    if (!selectedVersionId && versions.length > 0) {
      setSelectedVersionId(versions[0]!.id);
      return;
    }

    if (selectedVersionId && !versions.some((version) => version.id === selectedVersionId)) {
      setSelectedVersionId(versions[0]?.id ?? null);
    }
  }, [selectedVersionId, versions]);

  useEffect(() => {
    if (!selectedVersionId) {
      setProfiles([]);
      setSelectedProfileId(null);
      setBlocks([]);
      setSelectedBlockId(null);
      setCriteria([]);
      setSelectedCriterionId(null);
      return;
    }

    void Promise.all([
      fetchProfiles(selectedVersionId),
      fetchBlocks(selectedVersionId),
    ]).catch(
      (error) => {
        setMessage({
          type: "error",
          text:
            error instanceof Error
              ? error.message
              : "Failed to load version details.",
        });
        setProfiles([]);
        setSelectedProfileId(null);
        setBlocks([]);
        setSelectedBlockId(null);
        setCriteria([]);
        setSelectedCriterionId(null);
      },
    );
  }, [selectedVersionId]);

  useEffect(() => {
    if (!selectedProfileId && profiles.length > 0) {
      setSelectedProfileId(profiles[0]!.id);
      return;
    }

    if (selectedProfileId && !profiles.some((profile) => profile.id === selectedProfileId)) {
      setSelectedProfileId(profiles[0]?.id ?? null);
    }
  }, [profiles, selectedProfileId]);

  useEffect(() => {
    if (!selectedBlockId && flatBlocks.length > 0) {
      setSelectedBlockId(flatBlocks[0]!.id);
      return;
    }

    if (selectedBlockId && !flatBlocks.some((block) => block.id === selectedBlockId)) {
      setSelectedBlockId(flatBlocks[0]?.id ?? null);
    }
  }, [flatBlocks, selectedBlockId]);

  useEffect(() => {
    if (!selectedCriterionId && flatCriteria.length > 0) {
      setSelectedCriterionId(flatCriteria[0]!.id);
      return;
    }

    if (
      selectedCriterionId &&
      !flatCriteria.some((criterion) => criterion.id === selectedCriterionId)
    ) {
      setSelectedCriterionId(flatCriteria[0]?.id ?? null);
    }
  }, [flatCriteria, selectedCriterionId]);

  useEffect(() => {
    if (scope !== "tenant") {
      return;
    }

    if (!selectedKpiId && kpis.length > 0) {
      setSelectedKpiId(kpis[0]!.id);
      return;
    }

    if (selectedKpiId && !kpis.some((kpi) => kpi.id === selectedKpiId)) {
      setSelectedKpiId(kpis[0]?.id ?? null);
    }
  }, [kpis, scope, selectedKpiId]);

  useEffect(() => {
    if (scope !== "tenant" || !selectedKpiId) {
      setLinks([]);
      return;
    }

    void fetchLinks(selectedKpiId).catch((error) => {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to load KPI links.",
      });
      setLinks([]);
    });
  }, [scope, selectedKpiId]);

  useEffect(() => {
    if (scope !== "tenant" || !selectedCriterionId) {
      setBlockKpis([]);
      return;
    }

    void fetchBlockKpis(selectedCriterionId).catch((error) => {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to load linked KPIs.",
      });
      setBlockKpis([]);
    });
  }, [scope, selectedCriterionId]);

  async function submitJson(
    url: string,
    method: "POST" | "PATCH" | "PUT" | "DELETE",
    body?: unknown,
  ) {
    setSubmitting(true);
    try {
      const response = await fetch(url, {
        method,
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = (await response.json()) as {
        status?: string;
        message?: string;
      };
      if (!response.ok || data.status === "error") {
        throw new Error(data.message ?? "Request failed.");
      }
      setMessage({
        type: "success",
        text: data.message ?? "Saved.",
      });
      return data;
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white/80 p-6 text-sm text-slate-500">
        Loading accreditation...
      </div>
    );
  }

  const selectedProfileWeightMap = new Map(
    (selectedProfile?.weightOverrides ?? []).flatMap((weight) => {
      const key = weight.blockId;
      return key ? [[key, weight] as const] : [];
    }),
  );

  return (
    <div className="space-y-6">
      {message ? (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm ${
            message.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {message.text}
        </div>
      ) : null}

      {scope === "tenant" && selectedBody?.scope === "GLOBAL" ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Global accreditation frameworks are visible here for reference and KPI mapping.
          Create a tenant body to maintain a tenant-owned framework.
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.05fr_1fr]">
        <section className="space-y-4 rounded-3xl border border-slate-200 bg-white/80 p-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Framework Bodies</h2>
            <p className="text-sm text-slate-500">
              {scope === "tenant"
                ? "Global frameworks plus tenant-owned frameworks."
                : "Manage platform-level accreditation bodies and starter frameworks."}
            </p>
          </div>

          <form
            className="grid gap-3 md:grid-cols-2"
            onSubmit={async (event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              await submitJson(`${basePath}/bodies`, "POST", {
                code: String(form.get("code") ?? ""),
                name: String(form.get("name") ?? ""),
                country: String(form.get("country") ?? "") || null,
                description: String(form.get("description") ?? "") || null,
              });
              event.currentTarget.reset();
              await fetchBodies();
            }}
          >
            <input name="code" placeholder="Code" className={inputClassName} />
            <input name="name" placeholder="Body name" className={inputClassName} />
            <input name="country" placeholder="Country" className={inputClassName} />
            <textarea
              name="description"
              placeholder="Description"
              className={`${inputClassName} min-h-24 md:col-span-2`}
            />
            <button
              type="submit"
              disabled={submitting}
              className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 md:col-span-2"
            >
              Create body
            </button>
          </form>

          <div className="space-y-2">
            {bodies.map((body) => (
              <button
                key={body.id}
                type="button"
                onClick={() => setSelectedBodyId(body.id)}
                className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                  selectedBodyId === body.id
                    ? "border-slate-900 bg-slate-950 text-white"
                    : "border-slate-200 bg-slate-50 text-slate-800 hover:border-slate-300"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">
                      {body.code} · {body.name}
                    </div>
                    <div
                      className={`mt-1 text-xs ${
                        selectedBodyId === body.id ? "text-slate-300" : "text-slate-500"
                      }`}
                    >
                      {body.scope} · {body.versionCount} version(s)
                      {body.country ? ` · ${body.country}` : ""}
                    </div>
                  </div>
                  {canEditSelectedBody && body.id === selectedBodyId ? (
                    <span
                      onClick={async (event) => {
                        event.stopPropagation();
                        await submitJson(`${basePath}/bodies/${body.id}`, "PATCH", {
                          isActive: !body.isActive,
                        });
                        await fetchBodies();
                      }}
                      className="rounded-full border border-current px-3 py-1 text-xs"
                    >
                      {body.isActive ? "Archive" : "Restore"}
                    </span>
                  ) : null}
                </div>
              </button>
            ))}
            {bodies.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                No accreditation bodies yet.
              </div>
            ) : null}
          </div>
        </section>

        <section className="space-y-4 rounded-3xl border border-slate-200 bg-white/80 p-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Versions</h2>
            <p className="text-sm text-slate-500">
              Create year or framework versions under the selected accreditation body.
            </p>
          </div>

          {selectedBody ? (
            <>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                Selected body: <strong>{selectedBody.code}</strong> ({selectedBody.scope})
              </div>

              {canEditRuntimeCriteria ? (
                <form
                  className="grid gap-3 md:grid-cols-2"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    await submitJson(`${basePath}/bodies/${selectedBody.id}/versions`, "POST", {
                      versionCode: String(form.get("versionCode") ?? ""),
                      versionName: String(form.get("versionName") ?? ""),
                      scoreBase: toNumber(form.get("scoreBase"), 100),
                      lifecycleStatus:
                        form.get("createAsDraft") === "on" ? "DRAFT" : "PUBLISHED",
                    });
                    event.currentTarget.reset();
                    await fetchVersions(selectedBody.id);
                  }}
                >
                  <input
                    name="versionCode"
                    placeholder="Version code"
                    className={inputClassName}
                  />
                  <input
                    name="versionName"
                    placeholder="Version name"
                    className={inputClassName}
                  />
                  <input
                    name="scoreBase"
                    type="number"
                    placeholder="Score base"
                    className={`${inputClassName} md:col-span-2`}
                  />
                  <label className="flex items-center gap-2 text-sm text-slate-600 md:col-span-2">
                    <input
                      name="createAsDraft"
                      type="checkbox"
                      className="h-4 w-4 rounded"
                    />
                    Create as an admin-only draft template
                  </label>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 md:col-span-2"
                  >
                    Create version
                  </button>
                </form>
              ) : null}

              <div className="space-y-2">
                {versions.map((version) => (
                  <button
                    key={version.id}
                    type="button"
                    onClick={() => setSelectedVersionId(version.id)}
                    className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                      selectedVersionId === version.id
                        ? "border-slate-900 bg-slate-950 text-white"
                        : "border-slate-200 bg-slate-50 text-slate-800 hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">{version.versionCode}</div>
                        <div
                          className={`mt-1 text-xs ${
                            selectedVersionId === version.id
                              ? "text-slate-300"
                              : "text-slate-500"
                          }`}
                        >
                          {version.versionName} · base {version.scoreBase} ·{" "}
                          {version.lifecycleStatus}
                          {typeof version.blockCount === "number"
                            ? ` · ${version.blockCount} block(s)`
                            : ""}
                        </div>
                      </div>
                      {canEditSelectedBody && selectedVersionId === version.id ? (
                        <span
                          onClick={async (event) => {
                            event.stopPropagation();
                            await submitJson(`${basePath}/versions/${version.id}`, "PATCH", {
                              isActive: !version.isActive,
                            });
                            await fetchVersions(selectedBody.id);
                          }}
                          className="rounded-full border border-current px-3 py-1 text-xs"
                        >
                          {version.isActive ? "Archive" : "Restore"}
                        </span>
                      ) : null}
                    </div>
                  </button>
                ))}
                {versions.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                    No versions yet for this body.
                  </div>
                ) : null}
              </div>

              {scope === "tenant" &&
              selectedBody.scope === "GLOBAL" &&
              selectedVersion?.lifecycleStatus === "PUBLISHED" ? (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={async () => {
                    if (!selectedVersion) {
                      return;
                    }

                    const data = (await submitJson(
                      `${basePath}/versions/${selectedVersion.id}/fork`,
                      "POST",
                    )) as {
                      body?: { id: string };
                      version?: { id: string };
                    };

                    await fetchBodies();
                    if (data.body?.id) {
                      setSelectedBodyId(data.body.id);
                      await fetchVersions(data.body.id);
                    }
                    if (data.version?.id) {
                      setSelectedVersionId(data.version.id);
                    }
                  }}
                  className="rounded-full border border-slate-900 px-4 py-2 text-sm font-semibold text-slate-900 disabled:opacity-60"
                >
                  Fork This Global Template Into Tenant Draft
                </button>
              ) : null}
            </>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
              Select a body to manage versions.
            </div>
          )}
        </section>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <section className="space-y-4 rounded-3xl border border-slate-200 bg-white/80 p-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Profiles</h2>
            <p className="text-sm text-slate-500">
              Define framework profiles and assign leaf-level weight overrides.
            </p>
          </div>

          {selectedVersion ? (
            <>
              {canEditSelectedBody ? (
                <form
                  className="grid gap-3 md:grid-cols-2"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    await submitJson(`${basePath}/versions/${selectedVersion.id}/profiles`, "POST", {
                      profileCode: String(form.get("profileCode") ?? ""),
                      profileName: String(form.get("profileName") ?? ""),
                      description: String(form.get("description") ?? "") || null,
                      isDefault: form.get("isDefault") === "on",
                    });
                    event.currentTarget.reset();
                    await fetchProfiles(selectedVersion.id);
                  }}
                >
                  <input
                    name="profileCode"
                    placeholder="Profile code"
                    className={inputClassName}
                  />
                  <input
                    name="profileName"
                    placeholder="Profile name"
                    className={inputClassName}
                  />
                  <textarea
                    name="description"
                    placeholder="Profile description"
                    className={`${inputClassName} min-h-24 md:col-span-2`}
                  />
                  <label className="flex items-center gap-2 text-sm text-slate-600 md:col-span-2">
                    <input name="isDefault" type="checkbox" className="h-4 w-4 rounded" />
                    Set as default profile
                  </label>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 md:col-span-2"
                  >
                    Create profile
                  </button>
                </form>
              ) : null}

              <div className="space-y-2">
                {profiles.map((profile) => (
                  <button
                    key={profile.id}
                    type="button"
                    onClick={() => setSelectedProfileId(profile.id)}
                    className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                      selectedProfileId === profile.id
                        ? "border-slate-900 bg-slate-950 text-white"
                        : "border-slate-200 bg-slate-50 text-slate-800 hover:border-slate-300"
                    }`}
                  >
                    <div className="text-sm font-semibold">
                      {profile.profileCode} · {profile.profileName}
                    </div>
                    <div
                      className={`mt-1 text-xs ${
                        selectedProfileId === profile.id ? "text-slate-300" : "text-slate-500"
                      }`}
                    >
                      {profile.isDefault ? "Default profile" : "Optional profile"} ·{" "}
                      {profile.weightOverrideCount} override(s)
                    </div>
                  </button>
                ))}
                {profiles.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                    No profiles yet for this version.
                  </div>
                ) : null}
              </div>

              {selectedProfile ? (
                <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      Weight overrides for {selectedProfile.profileCode}
                    </h3>
                    <p className="text-xs text-slate-500">
                      Save max score and optional percent overrides for leaf criteria.
                    </p>
                  </div>

                  {leafCriteria.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
                      Add leaf criteria before defining profile weights.
                    </div>
                  ) : canEditSelectedBody ? (
                    <form
                      className="space-y-3"
                      onSubmit={async (event) => {
                        event.preventDefault();
                        const form = new FormData(event.currentTarget);
                        const weights = leafCriteria
                          .map((criterion) => {
                            const maxScore = toNullableNumber(
                              form.get(`maxScore_${criterion.id}`),
                            );
                            const weightPercent = toNullableNumber(
                              form.get(`weightPercent_${criterion.id}`),
                            );

                            if (maxScore === null) {
                              return null;
                            }

                            return {
                              blockId: criterion.id,
                              maxScore,
                              weightPercent,
                            };
                          })
                          .filter(
                            (
                              row,
                            ): row is { blockId: string; maxScore: number; weightPercent: number | null } =>
                              row !== null,
                          );

                        await submitJson(
                          `${basePath}/profiles/${selectedProfile.id}/weights`,
                          "PUT",
                          { weights },
                        );
                        await fetchProfiles(selectedVersion.id);
                      }}
                    >
                      <div className="space-y-2">
                        {leafCriteria.map((criterion) => {
                          const weight = selectedProfileWeightMap.get(criterion.id);
                          return (
                            <div
                              key={criterion.id}
                              className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 md:grid-cols-[1.3fr_0.7fr_0.7fr]"
                            >
                              <div>
                                <div className="text-sm font-semibold text-slate-900">
                                  {criterion.blockCode} · {criterion.title}
                                </div>
                                <div className="text-xs text-slate-500">
                                  Depth {criterion.depth + 1} · leaf criterion
                                </div>
                              </div>
                              <input
                                name={`maxScore_${criterion.id}`}
                                type="number"
                                step="0.01"
                                defaultValue={weight?.maxScore ?? ""}
                                placeholder="Max score"
                                className={inputClassName}
                              />
                              <input
                                name={`weightPercent_${criterion.id}`}
                                type="number"
                                step="0.01"
                                defaultValue={weight?.weightPercent ?? ""}
                                placeholder="Weight %"
                                className={inputClassName}
                              />
                            </div>
                          );
                        })}
                      </div>
                      <button
                        type="submit"
                        disabled={submitting}
                        className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                      >
                        Save weight overrides
                      </button>
                    </form>
                  ) : (
                    <div className="space-y-2">
                      {leafCriteria.map((criterion) => {
                        const weight = selectedProfileWeightMap.get(criterion.id);
                        return (
                          <div
                            key={criterion.id}
                            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700"
                          >
                            <div className="font-semibold">
                              {criterion.blockCode} · {criterion.title}
                            </div>
                            <div className="mt-1 text-xs text-slate-500">
                              Max score: {weight?.maxScore ?? "Not set"} · Weight %:{" "}
                              {weight?.weightPercent ?? "Not set"}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : null}
            </>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
              Select a version to manage profiles.
            </div>
          )}
        </section>

        <section className="space-y-4 rounded-3xl border border-slate-200 bg-white/80 p-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Criteria Tree</h2>
            <p className="text-sm text-slate-500">
              Build a nested criteria structure and mark measurable leaf criteria for KPI
              linkage.
            </p>
            {flatBlocks.length > 0 ? (
              <p className="mt-2 text-xs text-slate-500">
                This version is block-authored. The criteria tree below is the compiled published
                runtime view.
              </p>
            ) : null}
          </div>

          {selectedVersion ? (
            <>
              {canEditSelectedBody ? (
                <form
                  className="grid gap-3 md:grid-cols-2"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    await submitJson(`${basePath}/versions/${selectedVersion.id}/blocks`, "POST", {
                      parentId: String(form.get("parentId") ?? "") || null,
                      blockCode: String(form.get("blockCode") ?? ""),
                      title: String(form.get("title") ?? ""),
                      blockType: form.get("isLeaf") === "on" ? "METRIC" : "GROUP",
                      maxScore: toNullableNumber(form.get("maxScore")),
                      sortOrder: toNumber(form.get("sortOrder"), 0),
                      unitOfMeasure: String(form.get("unitOfMeasure") ?? "") || null,
                    });
                    event.currentTarget.reset();
                    await fetchBlocks(selectedVersion.id);
                  }}
                >
                  <select name="parentId" className={inputClassName} defaultValue="">
                    <option value="">Root criterion</option>
                    {flatCriteria.map((criterion) => (
                      <option key={criterion.id} value={criterion.id}>
                        {"  ".repeat(criterion.depth)}
                        {criterion.blockCode} · {criterion.title}
                      </option>
                    ))}
                  </select>
                  <input
                    name="blockCode"
                    placeholder="Block code"
                    className={inputClassName}
                  />
                  <input name="title" placeholder="Criterion title" className={inputClassName} />
                  <input
                    name="unitOfMeasure"
                    placeholder="Unit of measure"
                    className={inputClassName}
                  />
                  <input
                    name="maxScore"
                    type="number"
                    step="0.01"
                    placeholder="Max score"
                    className={inputClassName}
                  />
                  <input
                    name="sortOrder"
                    type="number"
                    placeholder="Sort order"
                    className={inputClassName}
                  />
                  <label className="flex items-center gap-2 text-sm text-slate-600 md:col-span-2">
                    <input name="isLeaf" type="checkbox" className="h-4 w-4 rounded" />
                    This is a measurable leaf criterion
                  </label>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 md:col-span-2"
                  >
                    Create criterion
                  </button>
                </form>
              ) : null}

              <div className="space-y-2">
                {flatCriteria.map((criterion) => (
                  <button
                    key={criterion.id}
                    type="button"
                    onClick={() => setSelectedCriterionId(criterion.id)}
                    className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                      selectedCriterionId === criterion.id
                        ? "border-slate-900 bg-slate-950 text-white"
                        : "border-slate-200 bg-slate-50 text-slate-800 hover:border-slate-300"
                    }`}
                    style={{ paddingLeft: `${criterion.depth * 18 + 16}px` }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">
                          {criterion.blockCode} · {criterion.title}
                        </div>
                        <div
                          className={`mt-1 text-xs ${
                            selectedCriterionId === criterion.id
                              ? "text-slate-300"
                              : "text-slate-500"
                          }`}
                        >
                          {criterion.isLeaf ? "Leaf metric" : "Group criterion"} · level{" "}
                          {criterion.depth + 1}
                        </div>
                      </div>
                      {canEditRuntimeCriteria && selectedCriterionId === criterion.id ? (
                          <span
                            onClick={async (event) => {
                              event.stopPropagation();
                              await submitJson(`${basePath}/blocks/${criterion.id}`, "PATCH", {
                                isActive: !criterion.isActive,
                              });
                              await fetchBlocks(selectedVersion.id);
                            }}
                          className="rounded-full border border-current px-3 py-1 text-xs"
                        >
                          {criterion.isActive ? "Archive" : "Restore"}
                        </span>
                      ) : null}
                    </div>
                  </button>
                ))}
                {flatCriteria.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                    No criteria yet for this version.
                  </div>
                ) : null}
              </div>

              {scope === "tenant" && selectedCriterion ? (
                <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      KPI reverse lookup
                    </h3>
                    <p className="text-xs text-slate-500">
                      KPIs currently linked to published block {selectedCriterion.blockCode}.
                    </p>
                  </div>
                  {blockKpis.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
                      No KPI links for this criterion yet.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {blockKpis.map((kpi) => (
                        <div
                          key={kpi.linkId}
                          className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700"
                        >
                          <div className="font-semibold">{kpi.title}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            {kpi.kraTitle} · {kpi.periodName}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
              Select a version to manage criteria.
            </div>
          )}
        </section>
      </div>

      <section className="space-y-4 rounded-3xl border border-slate-200 bg-white/80 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Template Blocks</h2>
            <p className="text-sm text-slate-500">
              Admin-only authoring foundation for published templates. Workspace users never
              see these blocks directly.
            </p>
          </div>
          {selectedVersion ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              {selectedVersion.versionCode} · {selectedVersion.lifecycleStatus}
            </div>
          ) : null}
        </div>

        {selectedVersion ? (
          <>
            {canEditSelectedVersionBlocks ? (
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={async () => {
                    await submitJson(`${basePath}/versions/${selectedVersion.id}/validate`, "POST");
                    await fetchVersions(selectedBodyId!);
                    await fetchBlocks(selectedVersion.id);
                  }}
                  className="rounded-full border border-slate-900 px-4 py-2 text-sm font-semibold text-slate-900 disabled:opacity-60"
                >
                  Validate Draft
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={async () => {
                    await submitJson(`${basePath}/versions/${selectedVersion.id}/publish`, "POST");
                    await Promise.all([
                      fetchVersions(selectedBodyId!),
                      fetchBlocks(selectedVersion.id),
                    ]);
                  }}
                  className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  Publish Template
                </button>
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                {selectedVersion.lifecycleStatus === "PUBLISHED"
                  ? "Published templates are immutable. Fork or create a new draft to make changes."
                  : "Block authoring is only available on tenant-owned or superadmin-owned draft templates."}
              </div>
            )}

            <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
              <div className="space-y-4">
                {canEditSelectedVersionBlocks ? (
                  <form
                    className="grid gap-3 md:grid-cols-2"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      const form = new FormData(event.currentTarget);
                      await submitJson(`${basePath}/versions/${selectedVersion.id}/blocks`, "POST", {
                        parentId: String(form.get("parentId") ?? "") || null,
                        blockCode: String(form.get("blockCode") ?? ""),
                        title: String(form.get("title") ?? ""),
                        blockType: String(form.get("blockType") ?? "METRIC"),
                        maxScore: toNullableNumber(form.get("maxScore")),
                        sortOrder: toNumber(form.get("sortOrder"), 0),
                        unitOfMeasure: String(form.get("unitOfMeasure") ?? "") || null,
                        scoringRule: String(form.get("scoringRule") ?? "") || null,
                        validationRules: String(form.get("validationRules") ?? "") || null,
                        evidenceSchema: String(form.get("evidenceSchema") ?? "") || null,
                        dependencyRules: String(form.get("dependencyRules") ?? "") || null,
                      });
                      event.currentTarget.reset();
                      await fetchBlocks(selectedVersion.id);
                    }}
                  >
                    <select name="parentId" className={inputClassName} defaultValue="">
                      <option value="">Root block</option>
                      {flatBlocks.map((block) => (
                        <option key={block.id} value={block.id}>
                          {"  ".repeat(block.depth)}
                          {block.blockCode} · {block.title}
                        </option>
                      ))}
                    </select>
                    <input name="blockCode" placeholder="Block code" className={inputClassName} />
                    <input name="title" placeholder="Block title" className={inputClassName} />
                    <select name="blockType" className={inputClassName} defaultValue="METRIC">
                      <option value="GROUP">GROUP</option>
                      <option value="METRIC">METRIC</option>
                      <option value="QUALITATIVE">QUALITATIVE</option>
                      <option value="COMPOSITE">COMPOSITE</option>
                    </select>
                    <input
                      name="maxScore"
                      type="number"
                      step="0.01"
                      placeholder="Max score"
                      className={inputClassName}
                    />
                    <input
                      name="sortOrder"
                      type="number"
                      placeholder="Sort order"
                      className={inputClassName}
                    />
                    <input
                      name="unitOfMeasure"
                      placeholder="Unit of measure"
                      className={`${inputClassName} md:col-span-2`}
                    />
                    <textarea
                      name="scoringRule"
                      placeholder='Scoring rule JSON, e.g. {"type":"SLAB","slabs":[...]}'
                      className={`${inputClassName} min-h-24 md:col-span-2`}
                    />
                    <textarea
                      name="validationRules"
                      placeholder="Validation rules JSON"
                      className={`${inputClassName} min-h-24`}
                    />
                    <textarea
                      name="evidenceSchema"
                      placeholder="Evidence schema JSON"
                      className={`${inputClassName} min-h-24`}
                    />
                    <textarea
                      name="dependencyRules"
                      placeholder='Dependency rules JSON, e.g. [{"targetBlockCode":"1.1"}]'
                      className={`${inputClassName} min-h-24 md:col-span-2`}
                    />
                    <button
                      type="submit"
                      disabled={submitting}
                      className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 md:col-span-2"
                    >
                      Create block
                    </button>
                  </form>
                ) : null}

                <div className="space-y-2">
                  {flatBlocks.map((block) => (
                    <button
                      key={block.id}
                      type="button"
                      onClick={() => setSelectedBlockId(block.id)}
                      className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                        selectedBlockId === block.id
                          ? "border-slate-900 bg-slate-950 text-white"
                          : "border-slate-200 bg-slate-50 text-slate-800 hover:border-slate-300"
                      }`}
                      style={{ paddingLeft: `${block.depth * 18 + 16}px` }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold">
                            {block.blockCode} · {block.title}
                          </div>
                          <div
                            className={`mt-1 text-xs ${
                              selectedBlockId === block.id ? "text-slate-300" : "text-slate-500"
                            }`}
                          >
                            {block.blockType} · level {block.depth + 1}
                          </div>
                        </div>
                        {canEditSelectedVersionBlocks && selectedBlockId === block.id ? (
                          <span
                            onClick={async (event) => {
                              event.stopPropagation();
                              await submitJson(`${basePath}/blocks/${block.id}`, "PATCH", {
                                isActive: !block.isActive,
                              });
                              await fetchBlocks(selectedVersion.id);
                            }}
                            className="rounded-full border border-current px-3 py-1 text-xs"
                          >
                            {block.isActive ? "Archive" : "Restore"}
                          </span>
                        ) : null}
                      </div>
                    </button>
                  ))}
                  {flatBlocks.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                      No blocks defined for this template version yet.
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Selected block</h3>
                  <p className="text-xs text-slate-500">
                    Edit the currently selected block or inspect its JSON-backed scoring and
                    dependency configuration.
                  </p>
                </div>

                {selectedBlock ? (
                  <>
                    {canEditSelectedVersionBlocks ? (
                      <form
                        className="space-y-3"
                        onSubmit={async (event) => {
                          event.preventDefault();
                          const form = new FormData(event.currentTarget);
                          await submitJson(`${basePath}/blocks/${selectedBlock.id}`, "PATCH", {
                            title: String(form.get("title") ?? ""),
                            description: String(form.get("description") ?? "") || null,
                            maxScore: toNullableNumber(form.get("maxScore")),
                            unitOfMeasure: String(form.get("unitOfMeasure") ?? "") || null,
                            scoringRule: String(form.get("scoringRule") ?? "") || null,
                            validationRules: String(form.get("validationRules") ?? "") || null,
                            evidenceSchema: String(form.get("evidenceSchema") ?? "") || null,
                            dependencyRules: String(form.get("dependencyRules") ?? "") || null,
                          });
                          await fetchBlocks(selectedVersion.id);
                        }}
                      >
                        <input
                          name="title"
                          defaultValue={selectedBlock.title}
                          className={inputClassName}
                        />
                        <textarea
                          name="description"
                          defaultValue={selectedBlock.description ?? ""}
                          placeholder="Description"
                          className={`${inputClassName} min-h-24`}
                        />
                        <input
                          name="maxScore"
                          type="number"
                          step="0.01"
                          defaultValue={selectedBlock.maxScore ?? ""}
                          placeholder="Max score"
                          className={inputClassName}
                        />
                        <input
                          name="unitOfMeasure"
                          defaultValue={selectedBlock.unitOfMeasure ?? ""}
                          placeholder="Unit of measure"
                          className={inputClassName}
                        />
                        <textarea
                          name="scoringRule"
                          defaultValue={
                            selectedBlock.scoringRule
                              ? JSON.stringify(selectedBlock.scoringRule, null, 2)
                              : ""
                          }
                          placeholder="Scoring rule JSON"
                          className={`${inputClassName} min-h-28`}
                        />
                        <textarea
                          name="validationRules"
                          defaultValue={
                            selectedBlock.validationRules
                              ? JSON.stringify(selectedBlock.validationRules, null, 2)
                              : ""
                          }
                          placeholder="Validation rules JSON"
                          className={`${inputClassName} min-h-24`}
                        />
                        <textarea
                          name="evidenceSchema"
                          defaultValue={
                            selectedBlock.evidenceSchema
                              ? JSON.stringify(selectedBlock.evidenceSchema, null, 2)
                              : ""
                          }
                          placeholder="Evidence schema JSON"
                          className={`${inputClassName} min-h-24`}
                        />
                        <textarea
                          name="dependencyRules"
                          defaultValue={
                            selectedBlock.dependencyRules
                              ? JSON.stringify(selectedBlock.dependencyRules, null, 2)
                              : ""
                          }
                          placeholder="Dependency rules JSON"
                          className={`${inputClassName} min-h-24`}
                        />
                        <button
                          type="submit"
                          disabled={submitting}
                          className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                        >
                          Save selected block
                        </button>
                      </form>
                    ) : (
                      <div className="space-y-3">
                        <div className="text-sm font-semibold text-slate-900">
                          {selectedBlock.blockCode} · {selectedBlock.title}
                        </div>
                        <pre className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-700">
                          {JSON.stringify(selectedBlock, null, 2)}
                        </pre>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
                    Select a block to inspect or edit it.
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
            Select a version to manage template blocks.
          </div>
        )}
      </section>

      {scope === "tenant" ? (
        <section className="space-y-4 rounded-3xl border border-slate-200 bg-white/80 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">KPI Registry Links</h2>
              <p className="text-sm text-slate-500">
                Link tenant KPI definitions to measurable accreditation criteria.
              </p>
            </div>
            <div className="min-w-72">
              <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                Selected KPI
              </label>
              <select
                value={selectedKpiId ?? ""}
                onChange={(event) => setSelectedKpiId(event.target.value || null)}
                className={`${inputClassName} mt-2`}
              >
                <option value="">Select KPI</option>
                {kpis.map((kpi) => (
                  <option key={kpi.id} value={kpi.id}>
                    {kpi.title} · {kpi.kraTitle} · {kpi.periodName}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {selectedKpiId ? (
            <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
              <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Create link</h3>
                  <p className="text-xs text-slate-500">
                    Only active measurable leaf blocks can be linked to KPIs.
                  </p>
                </div>

                <form
                  className="space-y-3"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    await submitJson(`/api/tenant/accreditation/kpis/${selectedKpiId}/links`, "POST", {
                      blockId: String(form.get("blockId") ?? ""),
                      notes: String(form.get("notes") ?? "") || null,
                    });
                    event.currentTarget.reset();
                    await Promise.all([
                      fetchLinks(selectedKpiId),
                      fetchKpis(),
                      selectedCriterionId ? fetchBlockKpis(selectedCriterionId) : Promise.resolve(),
                    ]);
                  }}
                >
                  <select
                    name="blockId"
                    defaultValue={selectedCriterion?.isLeaf ? selectedCriterion.id : ""}
                    className={inputClassName}
                  >
                    <option value="">Select leaf block</option>
                    {leafCriteria
                      .filter((criterion) => criterion.isActive)
                      .map((criterion) => (
                        <option key={criterion.id} value={criterion.id}>
                          {criterion.blockCode} · {criterion.title}
                        </option>
                      ))}
                  </select>
                  <textarea
                    name="notes"
                    placeholder="Optional notes"
                    className={`${inputClassName} min-h-24`}
                  />
                  <button
                    type="submit"
                    disabled={submitting}
                    className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    Create link
                  </button>
                </form>
              </div>

              <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Existing links</h3>
                  <p className="text-xs text-slate-500">
                    Links for the selected KPI across the visible framework registry.
                  </p>
                </div>

                {links.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
                    No accreditation links yet for this KPI.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {links.map((link) => (
                      <div
                        key={link.id}
                        className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3"
                      >
                        <div>
                          <div className="text-sm font-semibold text-slate-900">
                            {link.blockCode} · {link.blockTitle}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {link.bodyCode} · {link.versionCode}
                          </div>
                          {link.notes ? (
                            <div className="mt-2 text-xs text-slate-600">{link.notes}</div>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={async () => {
                            await submitJson(`/api/tenant/accreditation/links/${link.id}`, "DELETE");
                            await Promise.all([
                              fetchLinks(selectedKpiId),
                              fetchKpis(),
                              selectedCriterionId ? fetchBlockKpis(selectedCriterionId) : Promise.resolve(),
                            ]);
                          }}
                          className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 disabled:opacity-60"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
              Select a KPI to manage accreditation links.
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
