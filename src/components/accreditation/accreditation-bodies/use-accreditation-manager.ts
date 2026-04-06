"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// ── Types ──

export type BodyRow = {
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

export type VersionRow = {
  id: string;
  versionCode: string;
  versionName: string;
  scoreBase: number;
  isActive: boolean;
  copilotMode?: "DISABLED" | "DETERMINISTIC_ONLY" | "LLM_ASSISTED";
  lifecycleStatus: "DRAFT" | "VALIDATED" | "PUBLISHED" | "SUPERSEDED" | "ARCHIVED";
  blockCount?: number;
};

export type BlockNode = {
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
  assistantConfig?: unknown;
  isLeaf?: boolean;
  children: BlockNode[];
};

export type LlmProfileOption = {
  id: string;
  key: string;
  displayName: string;
  primaryModel: { displayName: string; code: string; provider: string };
};

export type CopilotConfigRow = {
  versionId: string;
  copilotMode: "DISABLED" | "DETERMINISTIC_ONLY" | "LLM_ASSISTED";
  assistantPackKey: string | null;
  llmProfileId: string | null;
  llmProfile: LlmProfileOption | null;
  llmConfig: unknown;
  lockState: { isLocked: boolean; reason: string | null };
  effectiveSource: {
    type: "GLOBAL_INHERITED" | "GLOBAL_OWNED" | "TENANT_OWNED";
    versionId: string;
    versionCode: string | null;
    bodyCode: string;
  };
};

export type ProfileWeightRow = {
  blockId?: string;
  maxScore: number;
  weightPercent: number | null;
};

export type ProfileRow = {
  id: string;
  profileCode: string;
  profileName: string;
  isDefault: boolean;
  weightOverrideCount: number;
  weightOverrides?: ProfileWeightRow[];
};

export type CriterionNode = {
  id: string;
  parentId: string | null;
  blockCode: string;
  title: string;
  depth: number;
  isLeaf: boolean;
  isActive: boolean;
  children: CriterionNode[];
};

export type KpiOption = {
  id: string;
  title: string;
  kraTitle: string;
  periodName: string;
  accreditationLinkCount: number;
};

export type LinkRow = {
  id: string;
  blockId: string;
  blockCode: string;
  blockTitle: string;
  bodyCode: string;
  versionCode: string;
  notes: string | null;
};

export type CriterionKpiRow = {
  linkId: string;
  blockId?: string;
  kpiId: string;
  title: string;
  kraTitle: string;
  periodName: string;
  notes: string | null;
};

export type MessageState = { type: "success" | "error"; text: string } | null;

// ── Helpers ──

function flattenBlocksHelper(nodes: BlockNode[]): BlockNode[] {
  const flat: BlockNode[] = [];
  const walk = (items: BlockNode[]) => {
    for (const item of items) { flat.push(item); walk(item.children); }
  };
  walk(nodes);
  return flat;
}

function flattenCriteriaHelper(nodes: CriterionNode[]): CriterionNode[] {
  const flat: CriterionNode[] = [];
  const walk = (items: CriterionNode[]) => {
    for (const item of items) { flat.push(item); walk(item.children); }
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

// ── Fetch helpers ──

async function fetchApi<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const data = (await response.json()) as T & { status?: string; message?: string };
  if (!response.ok || data.status === "error") {
    throw new Error(data.message ?? "Request failed.");
  }
  return data;
}

async function submitApi(
  url: string,
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  body?: unknown,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json()) as { status?: string; message?: string };
  if (!response.ok || data.status === "error") {
    throw new Error(data.message ?? "Request failed.");
  }
  return data as Record<string, unknown>;
}

// ── Hook ──

export function useAccreditationManager(
  scope: "tenant" | "superadmin",
  initialKpiId?: string | null,
) {
  const basePath = scope === "tenant" ? "/api/tenant/accreditation" : "/api/superadmin/accreditation";

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<MessageState>(null);

  const [bodies, setBodies] = useState<BodyRow[]>([]);
  const [selectedBodyId, setSelectedBodyId] = useState<string | null>(null);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<BlockNode[]>([]);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [copilotConfig, setCopilotConfig] = useState<CopilotConfigRow | null>(null);
  const [availableLlmProfiles, setAvailableLlmProfiles] = useState<LlmProfileOption[]>([]);
  const [criteria, setCriteria] = useState<CriterionNode[]>([]);
  const [selectedCriterionId, setSelectedCriterionId] = useState<string | null>(null);
  const [blockKpis, setBlockKpis] = useState<CriterionKpiRow[]>([]);
  const [kpis, setKpis] = useState<KpiOption[]>([]);
  const [selectedKpiId, setSelectedKpiId] = useState<string | null>(initialKpiId ?? null);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [tenantEnabledFeatures, setTenantEnabledFeatures] = useState<string[]>([]);

  // ── Derived ──

  const selectedBody = bodies.find((b) => b.id === selectedBodyId) ?? null;
  const selectedVersion = versions.find((v) => v.id === selectedVersionId) ?? null;
  const selectedProfile = profiles.find((p) => p.id === selectedProfileId) ?? null;

  const tenantCopilotEnabled = scope === "superadmin" || tenantEnabledFeatures.includes("ACCREDITATION_COPILOT");
  const canEditSelectedBody = scope === "superadmin" || selectedBody?.scope === "TENANT";
  const canEditSelectedVersionCopilot =
    tenantCopilotEnabled && !!selectedVersion && !!copilotConfig && canEditSelectedBody &&
    !copilotConfig.lockState.isLocked && (scope === "superadmin" || selectedBody?.scope === "TENANT");
  const canEditSelectedVersionBlocks =
    canEditSelectedBody &&
    (selectedVersion?.lifecycleStatus === "DRAFT" || selectedVersion?.lifecycleStatus === "VALIDATED");
  const canEditAssistantRules = scope === "superadmin" || tenantCopilotEnabled;
  const canEditRuntimeCriteria = false;

  const flatBlocks = useMemo(() => flattenBlocksHelper(blocks), [blocks]);
  const selectedBlock = flatBlocks.find((b) => b.id === selectedBlockId) ?? null;
  const flatCriteria = useMemo(() => flattenCriteriaHelper(criteria), [criteria]);
  const leafCriteria = useMemo(() => flatCriteria.filter((c) => c.isLeaf), [flatCriteria]);
  const selectedCriterion = flatCriteria.find((c) => c.id === selectedCriterionId) ?? null;

  const selectedProfileWeightMap = useMemo(() => {
    return new Map(
      (selectedProfile?.weightOverrides ?? []).flatMap((w) => {
        const key = w.blockId;
        return key ? [[key, w] as const] : [];
      }),
    );
  }, [selectedProfile]);

  // ── Fetchers ──

  const fetchBodies = useCallback(async () => {
    const data = await fetchApi<{ bodies?: BodyRow[] }>(`${basePath}/bodies`);
    setBodies(data.bodies ?? []);
  }, [basePath]);

  const fetchVersions = useCallback(async (bodyId: string) => {
    const data = await fetchApi<{ versions?: VersionRow[] }>(`${basePath}/bodies/${bodyId}/versions`);
    setVersions(data.versions ?? []);
  }, [basePath]);

  const fetchProfiles = useCallback(async (versionId: string) => {
    const data = await fetchApi<{ profiles?: ProfileRow[] }>(`${basePath}/versions/${versionId}/profiles`);
    setProfiles(data.profiles ?? []);
  }, [basePath]);

  const fetchBlocks = useCallback(async (versionId: string) => {
    const data = await fetchApi<{ blocks?: BlockNode[] }>(`${basePath}/versions/${versionId}/blocks`);
    const next = data.blocks ?? [];
    setBlocks(next);
    setCriteria(mapBlocksToCriteria(next));
  }, [basePath]);

  const fetchCopilotConfig = useCallback(async (versionId: string) => {
    const data = await fetchApi<{ config?: CopilotConfigRow; availableProfiles?: LlmProfileOption[] }>(
      `${basePath}/versions/${versionId}/copilot-config`,
    );
    setCopilotConfig(data.config ?? null);
    setAvailableLlmProfiles(data.availableProfiles ?? []);
  }, [basePath]);

  const fetchKpis = useCallback(async () => {
    if (scope !== "tenant") return;
    const data = await fetchApi<{ kpis?: KpiOption[] }>("/api/tenant/accreditation/kpis/options");
    setKpis(data.kpis ?? []);
  }, [scope]);

  const fetchTenantFeatureAccess = useCallback(async () => {
    if (scope !== "tenant") return;
    const data = await fetchApi<{ enabledFeatures?: string[] }>("/api/tenant/services");
    setTenantEnabledFeatures(data.enabledFeatures ?? []);
  }, [scope]);

  const fetchLinks = useCallback(async (kpiId: string) => {
    if (scope !== "tenant") return;
    const data = await fetchApi<{ links?: LinkRow[] }>(`/api/tenant/accreditation/kpis/${kpiId}/links`);
    setLinks(data.links ?? []);
  }, [scope]);

  const fetchBlockKpis = useCallback(async (blockId: string) => {
    if (scope !== "tenant") return;
    const data = await fetchApi<{ kpis?: CriterionKpiRow[] }>(`/api/tenant/accreditation/blocks/${blockId}/kpis`);
    setBlockKpis(data.kpis ?? []);
  }, [scope]);

  // ── Effects ──

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        await fetchBodies();
        if (scope === "tenant") await Promise.all([fetchKpis(), fetchTenantFeatureAccess()]);
        if (!cancelled) setMessage(null);
      } catch (error) {
        if (!cancelled) setMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to load accreditation data." });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [basePath, scope, fetchBodies, fetchKpis, fetchTenantFeatureAccess]);

  useEffect(() => {
    if (!selectedBodyId && bodies.length > 0) { setSelectedBodyId(bodies[0]!.id); return; }
    if (selectedBodyId && !bodies.some((b) => b.id === selectedBodyId)) setSelectedBodyId(bodies[0]?.id ?? null);
  }, [bodies, selectedBodyId]);

  useEffect(() => {
    if (!selectedBodyId) { setVersions([]); setSelectedVersionId(null); return; }
    void fetchVersions(selectedBodyId).catch((error) => {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to load versions." });
      setVersions([]); setSelectedVersionId(null);
    });
  }, [selectedBodyId, fetchVersions]);

  useEffect(() => {
    if (!selectedVersionId && versions.length > 0) { setSelectedVersionId(versions[0]!.id); return; }
    if (selectedVersionId && !versions.some((v) => v.id === selectedVersionId)) setSelectedVersionId(versions[0]?.id ?? null);
  }, [selectedVersionId, versions]);

  useEffect(() => {
    if (!selectedVersionId) {
      setProfiles([]); setSelectedProfileId(null); setBlocks([]); setSelectedBlockId(null);
      setCopilotConfig(null); setAvailableLlmProfiles([]); setCriteria([]); setSelectedCriterionId(null);
      return;
    }
    const copilotPromise = tenantCopilotEnabled
      ? fetchCopilotConfig(selectedVersionId)
      : Promise.resolve().then(() => { setCopilotConfig(null); setAvailableLlmProfiles([]); });
    void Promise.all([fetchProfiles(selectedVersionId), fetchBlocks(selectedVersionId), copilotPromise]).catch((error) => {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to load version details." });
      setProfiles([]); setSelectedProfileId(null); setBlocks([]); setSelectedBlockId(null);
      setCopilotConfig(null); setAvailableLlmProfiles([]); setCriteria([]); setSelectedCriterionId(null);
    });
  }, [selectedVersionId, tenantCopilotEnabled, fetchProfiles, fetchBlocks, fetchCopilotConfig]);

  useEffect(() => {
    if (!selectedProfileId && profiles.length > 0) { setSelectedProfileId(profiles[0]!.id); return; }
    if (selectedProfileId && !profiles.some((p) => p.id === selectedProfileId)) setSelectedProfileId(profiles[0]?.id ?? null);
  }, [profiles, selectedProfileId]);

  useEffect(() => {
    if (!selectedBlockId && flatBlocks.length > 0) { setSelectedBlockId(flatBlocks[0]!.id); return; }
    if (selectedBlockId && !flatBlocks.some((b) => b.id === selectedBlockId)) setSelectedBlockId(flatBlocks[0]?.id ?? null);
  }, [flatBlocks, selectedBlockId]);

  useEffect(() => {
    if (!selectedCriterionId && flatCriteria.length > 0) { setSelectedCriterionId(flatCriteria[0]!.id); return; }
    if (selectedCriterionId && !flatCriteria.some((c) => c.id === selectedCriterionId)) setSelectedCriterionId(flatCriteria[0]?.id ?? null);
  }, [flatCriteria, selectedCriterionId]);

  useEffect(() => {
    if (scope !== "tenant") return;
    if (!selectedKpiId && kpis.length > 0) { setSelectedKpiId(kpis[0]!.id); return; }
    if (selectedKpiId && !kpis.some((k) => k.id === selectedKpiId)) setSelectedKpiId(kpis[0]?.id ?? null);
  }, [kpis, scope, selectedKpiId]);

  useEffect(() => {
    if (scope !== "tenant" || !selectedKpiId) { setLinks([]); return; }
    void fetchLinks(selectedKpiId).catch((error) => {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to load KPI links." });
      setLinks([]);
    });
  }, [scope, selectedKpiId, fetchLinks]);

  useEffect(() => {
    if (scope !== "tenant" || !selectedCriterionId) { setBlockKpis([]); return; }
    void fetchBlockKpis(selectedCriterionId).catch((error) => {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to load linked KPIs." });
      setBlockKpis([]);
    });
  }, [scope, selectedCriterionId, fetchBlockKpis]);

  // ── Mutation wrapper ──

  async function withSubmit(task: () => Promise<void>) {
    setSubmitting(true);
    try {
      await task();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Request failed." });
    } finally {
      setSubmitting(false);
    }
  }

  // ── Actions ──

  async function createBody(payload: Record<string, unknown>) {
    await withSubmit(async () => {
      await submitApi(`${basePath}/bodies`, "POST", payload);
      setMessage({ type: "success", text: "Accreditation body created." });
      await fetchBodies();
    });
  }

  async function toggleBodyActive(bodyId: string, currentlyActive: boolean) {
    await withSubmit(async () => {
      await submitApi(`${basePath}/bodies/${bodyId}`, "PATCH", { isActive: !currentlyActive });
      setMessage({ type: "success", text: currentlyActive ? "Body archived." : "Body restored." });
      await fetchBodies();
    });
  }

  async function createVersion(bodyId: string, payload: Record<string, unknown>) {
    await withSubmit(async () => {
      await submitApi(`${basePath}/bodies/${bodyId}/versions`, "POST", payload);
      setMessage({ type: "success", text: "Version created." });
      await fetchVersions(bodyId);
    });
  }

  async function toggleVersionActive(versionId: string, currentlyActive: boolean) {
    await withSubmit(async () => {
      await submitApi(`${basePath}/versions/${versionId}`, "PATCH", { isActive: !currentlyActive });
      setMessage({ type: "success", text: currentlyActive ? "Version archived." : "Version restored." });
      if (selectedBodyId) await fetchVersions(selectedBodyId);
    });
  }

  async function forkVersion(versionId: string) {
    await withSubmit(async () => {
      const data = await submitApi(`${basePath}/versions/${versionId}/fork`, "POST");
      setMessage({ type: "success", text: "Template forked into tenant draft." });
      await fetchBodies();
      const bodyData = data.body as { id: string } | undefined;
      const versionData = data.version as { id: string } | undefined;
      if (bodyData?.id) {
        setSelectedBodyId(bodyData.id);
        await fetchVersions(bodyData.id);
      }
      if (versionData?.id) setSelectedVersionId(versionData.id);
    });
  }

  async function validateDraft(versionId: string) {
    await withSubmit(async () => {
      await submitApi(`${basePath}/versions/${versionId}/validate`, "POST");
      setMessage({ type: "success", text: "Draft validated." });
      if (selectedBodyId) await fetchVersions(selectedBodyId);
      await fetchBlocks(versionId);
    });
  }

  async function publishVersion(versionId: string) {
    await withSubmit(async () => {
      await submitApi(`${basePath}/versions/${versionId}/publish`, "POST");
      setMessage({ type: "success", text: "Template published." });
      if (selectedBodyId) await Promise.all([fetchVersions(selectedBodyId), fetchBlocks(versionId)]);
    });
  }

  async function saveCopilotSettings(versionId: string, payload: Record<string, unknown>) {
    await withSubmit(async () => {
      await submitApi(`${basePath}/versions/${versionId}/copilot-config`, "PATCH", payload);
      setMessage({ type: "success", text: "Copilot settings saved." });
      await Promise.all([fetchCopilotConfig(versionId), selectedBodyId ? fetchVersions(selectedBodyId) : Promise.resolve()]);
    });
  }

  async function createProfile(versionId: string, payload: Record<string, unknown>) {
    await withSubmit(async () => {
      await submitApi(`${basePath}/versions/${versionId}/profiles`, "POST", payload);
      setMessage({ type: "success", text: "Profile created." });
      await fetchProfiles(versionId);
    });
  }

  async function saveProfileWeights(profileId: string, weights: Array<Record<string, unknown>>) {
    await withSubmit(async () => {
      await submitApi(`${basePath}/profiles/${profileId}/weights`, "PUT", { weights });
      setMessage({ type: "success", text: "Weight overrides saved." });
      if (selectedVersionId) await fetchProfiles(selectedVersionId);
    });
  }

  async function createBlock(versionId: string, payload: Record<string, unknown>) {
    await withSubmit(async () => {
      await submitApi(`${basePath}/versions/${versionId}/blocks`, "POST", payload);
      setMessage({ type: "success", text: "Block created." });
      await fetchBlocks(versionId);
    });
  }

  async function updateBlock(blockId: string, payload: Record<string, unknown>) {
    await withSubmit(async () => {
      await submitApi(`${basePath}/blocks/${blockId}`, "PATCH", payload);
      setMessage({ type: "success", text: "Block updated." });
      if (selectedVersionId) await fetchBlocks(selectedVersionId);
    });
  }

  async function toggleBlockActive(blockId: string, currentlyActive: boolean) {
    await withSubmit(async () => {
      await submitApi(`${basePath}/blocks/${blockId}`, "PATCH", { isActive: !currentlyActive });
      setMessage({ type: "success", text: currentlyActive ? "Block archived." : "Block restored." });
      if (selectedVersionId) await fetchBlocks(selectedVersionId);
    });
  }

  async function createKpiLink(kpiId: string, payload: Record<string, unknown>) {
    await withSubmit(async () => {
      await submitApi(`/api/tenant/accreditation/kpis/${kpiId}/links`, "POST", payload);
      setMessage({ type: "success", text: "KPI link created." });
      await Promise.all([
        fetchLinks(kpiId),
        fetchKpis(),
        selectedCriterionId ? fetchBlockKpis(selectedCriterionId) : Promise.resolve(),
      ]);
    });
  }

  async function deleteKpiLink(linkId: string) {
    await withSubmit(async () => {
      await submitApi(`/api/tenant/accreditation/links/${linkId}`, "DELETE");
      setMessage({ type: "success", text: "KPI link removed." });
      await Promise.all([
        selectedKpiId ? fetchLinks(selectedKpiId) : Promise.resolve(),
        fetchKpis(),
        selectedCriterionId ? fetchBlockKpis(selectedCriterionId) : Promise.resolve(),
      ]);
    });
  }

  return {
    scope,
    basePath,
    loading,
    submitting,
    message,
    setMessage,

    bodies,
    selectedBodyId,
    setSelectedBodyId,
    selectedBody,
    versions,
    selectedVersionId,
    setSelectedVersionId,
    selectedVersion,

    profiles,
    selectedProfileId,
    setSelectedProfileId,
    selectedProfile,
    selectedProfileWeightMap,

    blocks,
    flatBlocks,
    selectedBlockId,
    setSelectedBlockId,
    selectedBlock,

    copilotConfig,
    availableLlmProfiles,

    criteria,
    flatCriteria,
    leafCriteria,
    selectedCriterionId,
    setSelectedCriterionId,
    selectedCriterion,

    blockKpis,
    kpis,
    selectedKpiId,
    setSelectedKpiId,
    links,

    tenantCopilotEnabled,
    canEditSelectedBody,
    canEditSelectedVersionCopilot,
    canEditSelectedVersionBlocks,
    canEditAssistantRules,
    canEditRuntimeCriteria,

    createBody,
    toggleBodyActive,
    createVersion,
    toggleVersionActive,
    forkVersion,
    validateDraft,
    publishVersion,
    saveCopilotSettings,
    createProfile,
    saveProfileWeights,
    createBlock,
    updateBlock,
    toggleBlockActive,
    createKpiLink,
    deleteKpiLink,
  };
}

export type AccreditationManagerHook = ReturnType<typeof useAccreditationManager>;
