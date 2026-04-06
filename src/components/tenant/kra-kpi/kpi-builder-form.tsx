"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  CopyPlus,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import {
  ACHIEVEMENT_FIELD_TYPES,
  type AchievementFieldConfig,
  type FieldCondition,
} from "@/lib/kra-kpi/shared";
import type {
  BuilderApplicableRole,
  BuilderRewardComponent,
  BuilderRewardDistribution,
  BuilderRewardRule,
  BuilderRewardTier,
  BuilderStage,
  KpiBuilderPayload,
  KpiCopySelection,
  RewardPreviewInput,
  RewardPreviewInput as RewardPreviewInputType,
} from "@/lib/kra-kpi/builder-shared";
import {
  applyCopyDependencies,
  applyCopySelectionToDraft,
  applyTemplateToDraftPayload,
  createEmptyBuilderPayload,
} from "@/lib/kra-kpi/kpi-builder-client";
import {
  NAAC_TEMPLATE_CATEGORY,
  NAAC_UNIVERSITY_STARTER_PACK_KEY,
} from "@/lib/kra-kpi/naac-template-constants";

type UnitOption = { id: string; name: string };
type WorkflowReviewerOption = {
  userId: string;
  name: string;
  email: string;
  employeeId: string | null;
  designation: string | null;
  membershipStatus: string;
  unitIds: string[];
  unitLabels: string[];
};

type TemplateRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: string | null;
  isSystem: boolean;
  isActive: boolean;
  sortOrder: number;
  builderPayload: KpiBuilderPayload;
};

type ContributorRoleRow = {
  id: string;
  code: string;
  name: string;
  defaultCreditPercent: number;
  isActive: boolean;
  sortOrder: number;
};

type BenefitTypeRow = {
  id: string;
  code: string;
  name: string;
  unit: string;
  isActive: boolean;
};

type ExternalTemplateRow = {
  id: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
};

type KpiSummaryRow = {
  id: string;
  title: string;
  kraTitle?: string | null;
  state?: string;
};

type CopyPreviewResponse = {
  sourceKpiId: string;
  title: string;
  sourceKraTitle: string;
  sourcePeriodName: string;
  sourceState: string;
  sections: Record<string, boolean>;
  dependencyHints?: Record<string, boolean>;
};

type RewardPreviewResult = {
  policyDate: string | null;
  recurrencePolicy: string;
  recurrenceKey: string | null;
  matchedTiers: Array<{ code: string; name: string }>;
  components: Array<{
    componentCode: string;
    componentName: string;
    benefitTypeCode: string;
    totalAmount: number;
    blockedCount: number;
    fallbackApplied: string | null;
    roundingApplied: number;
  }>;
};

type KpiBuilderFormProps = {
  mode: "create" | "edit";
  kraDefinitionId: string;
  units: UnitOption[];
  initial?: {
    id: string;
    title: string;
  };
  onDone: () => void;
  onCancel: () => void;
};

const PARTICIPANT_MODES = [
  { value: "SINGLE_OWNER", label: "Single Owner" },
  { value: "OPTIONAL_TEAM", label: "Optional Team" },
  { value: "REQUIRED_TEAM", label: "Required Team" },
];

const MEASUREMENT_TYPES = [
  "NUMERIC",
  "PERCENTAGE",
  "CURRENCY",
  "BOOLEAN",
  "RATING",
  "MILESTONE",
  "DATE_TARGET",
  "GRADE",
] as const;

const SCORING_METHODS = ["LINEAR", "THRESHOLD", "SLAB"] as const;
const SCORING_DIRECTIONS = ["ASCENDING", "DESCENDING"] as const;
const ALLOCATION_TYPES = ["DEPARTMENT", "INDIVIDUAL", "BOTH"] as const;
const CREDIT_SUM_MODES = ["MUST_EQUAL_100", "MAX_100", "UNCAPPED"] as const;
const REWARD_RECURRENCE_POLICIES = [
  "RECURRING",
  "ONCE_PER_PERIOD",
  "ONCE_PER_KPI_LIFETIME",
  "ONCE_PER_UNIQUE_KEY",
] as const;
const REWARD_RULE_SOURCES = [
  "FORM_FIELD",
  "ACTUAL_VALUE",
  "COMPUTED_SCORE",
  "EFFECTIVE_SCORE",
  "SYSTEM_METRIC",
  "TEAM_SIZE",
  "MANUAL_SELECTION",
  "CONTRIBUTOR_TAG",
  "CONTRIBUTOR_COUNT",
] as const;
const RULE_OPERATORS = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "in",
  "has_any",
  "has_all",
  "not_in",
  "not_contains",
] as const;
const REWARD_TRIGGER_OPTIONS = ["FINAL_VERIFY", "MANUAL", "STAGE_COMPLETE"] as const;
const REWARD_AMOUNT_MODES = [
  "FIXED_VALUE",
  "FIXED_POOL",
  "FIXED_PER_PERSON",
  "PERCENT_OF_FIELD",
  "PER_UNIT",
  "PERCENT_OF_SCORE",
] as const;
const DISTRIBUTION_MODES = [
  "DIRECT_OWNER",
  "ROLE_PERCENT_SPLIT",
  "FIXED_PER_PERSON",
  "EQUAL_SPLIT",
  "CREDIT_PERCENT_SPLIT",
  "LEAD_ONLY",
] as const;
const SELECTOR_TYPES = ["ROLE", "SELECTOR_TAG", "REMAINDER", "ALL_CONTRIBUTORS"] as const;
const SPLIT_MODES = ["EQUAL", "FULL_TO_MATCHED"] as const;
const MATCH_MODES = ["HIGHEST_MATCH", "MANUAL_SELECT"] as const;
const SINGLE_ELIGIBLE_OPTIONS = ["FULL_TO_SINGLE", "KEEP_CONFIGURED_SPLIT", "ERROR"] as const;
const EMPTY_SHARE_OPTIONS = ["ROLLOVER_TO_MATCHED", "DROP_UNALLOCATED", "ERROR"] as const;

const labelCls = "mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500";
const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand focus:ring-1 focus:ring-brand/30";
const sectionCls = "rounded-xl border border-slate-200 bg-white/80 p-4";

function formatJson(value: unknown) {
  return value == null ? "" : JSON.stringify(value, null, 2);
}

function parseJsonValue(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return JSON.parse(trimmed);
}

function newField(sortOrder: number): AchievementFieldConfig {
  return {
    key: `field_${sortOrder + 1}`,
    label: `Field ${sortOrder + 1}`,
    type: "TEXT",
    required: false,
    sortOrder,
    options: [],
  };
}

function newStage(sortOrder: number): BuilderStage {
  return {
    title: `Stage ${sortOrder + 1}`,
    description: null,
    stageOrder: sortOrder + 1,
    weight: 0,
    isMandatory: true,
    evidenceRequired: false,
    evidenceTypes: [],
    evidenceInstructions: null,
    deadline: null,
  };
}

function newTier(sortOrder: number): BuilderRewardTier {
  return {
    refKey: `TIER_${sortOrder + 1}`,
    tierSetKey: "PRIMARY",
    code: `TIER_${sortOrder + 1}`,
    name: `Reward Tier ${sortOrder + 1}`,
    description: null,
    priority: sortOrder,
    matchMode: "HIGHEST_MATCH",
    effectiveFrom: null,
    effectiveTo: null,
    isActive: true,
    rules: [],
  };
}

function newRule(sortOrder: number): BuilderRewardRule {
  return {
    source: "FORM_FIELD",
    operator: "eq",
    fieldKey: undefined,
    systemMetricKey: undefined,
    value: "",
    sortOrder,
  };
}

function newDistribution(sortOrder: number): BuilderRewardDistribution {
  return {
    selectorType: "ALL_CONTRIBUTORS",
    selectorTag: null,
    contributorRoleId: null,
    contributorRoleCode: null,
    sharePercent: null,
    fixedAmount: null,
    splitMode: "EQUAL",
    sortOrder,
  };
}

function newRewardComponent(sortOrder: number): BuilderRewardComponent {
  return {
    rewardTierRef: null,
    rewardTierCode: null,
    stageDefinitionId: null,
    parentComponentCode: null,
    benefitTypeCode: "MONETARY",
    code: `REWARD_${sortOrder + 1}`,
    name: `Reward Component ${sortOrder + 1}`,
    description: null,
    trigger: "FINAL_VERIFY",
    amountMode: "FIXED_VALUE",
    amountValue: 0,
    amountFieldKey: null,
    distributionMode: "DIRECT_OWNER",
    singleEligibleHandling: "FULL_TO_SINGLE",
    emptyShareHandling: "ROLLOVER_TO_MATCHED",
    isActive: true,
    sortOrder,
    distributions: [],
  };
}

function Section({
  title,
  description,
  children,
  defaultOpen = true,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={sectionCls}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div>
          <div className="text-sm font-semibold text-slate-900">{title}</div>
          {description ? <div className="mt-0.5 text-xs text-slate-500">{description}</div> : null}
        </div>
        <ChevronDown
          className={`h-4 w-4 text-slate-400 transition ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? <div className="mt-4 space-y-4">{children}</div> : null}
    </div>
  );
}

export function KpiBuilderForm({
  mode,
  kraDefinitionId,
  units,
  initial,
  onDone,
  onCancel,
}: KpiBuilderFormProps) {
  const [payload, setPayload] = useState<KpiBuilderPayload>(() =>
    createEmptyBuilderPayload(kraDefinitionId, units[0]?.id ?? ""),
  );
  const [loading, setLoading] = useState(mode === "edit");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [rolePool, setRolePool] = useState<ContributorRoleRow[]>([]);
  const [benefitTypes, setBenefitTypes] = useState<BenefitTypeRow[]>([]);
  const [externalTemplates, setExternalTemplates] = useState<ExternalTemplateRow[]>([]);
  const [sourceKpis, setSourceKpis] = useState<KpiSummaryRow[]>([]);
  const [workflowReviewerOptions, setWorkflowReviewerOptions] = useState<WorkflowReviewerOption[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedSourceKpiId, setSelectedSourceKpiId] = useState("");
  const [copyPreview, setCopyPreview] = useState<CopyPreviewResponse | null>(null);
  const [copySelection, setCopySelection] = useState<KpiCopySelection>({
    basics: true,
    fields: true,
    participantPolicy: true,
    externalContributorPolicy: true,
    duplicateCheckPolicy: true,
    roles: true,
    stages: true,
    tiers: true,
    rewardComponents: true,
    distributions: true,
  });
  const [previewFormDataText, setPreviewFormDataText] = useState("{}");
  const [previewContributorsText, setPreviewContributorsText] = useState("[]");
  const [previewScore, setPreviewScore] = useState("0");
  const [previewDate, setPreviewDate] = useState("");
  const [previewResult, setPreviewResult] = useState<RewardPreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadResources() {
      try {
        const requests: Promise<Response>[] = [
          fetch("/api/tenant/kra-kpi/kpi-templates"),
          fetch("/api/tenant/kra-kpi/contributor-roles"),
          fetch("/api/tenant/kra-kpi/benefit-types"),
          fetch("/api/tenant/kra-kpi/external-contrib-templates"),
          fetch("/api/tenant/kra-kpi/kpis"),
          fetch("/api/tenant/kra-kpi/workflow/reviewer-options"),
        ];
        if (mode === "edit" && initial?.id) {
          requests.unshift(fetch(`/api/tenant/kra-kpi/kpi-builder/${initial.id}`));
        }

        const responses = await Promise.all(requests);
        const json = await Promise.all(responses.map(async (response) => response.json()));
        if (cancelled) return;

        let offset = 0;
        if (mode === "edit" && initial?.id) {
          setPayload(json[0] as KpiBuilderPayload);
          offset = 1;
        } else {
          setPayload((current) => ({
            ...current,
            definition: {
              ...current.definition,
              kraDefinitionId,
              startingUnitId: current.definition.startingUnitId || units[0]?.id || "",
            },
          }));
        }

        setTemplates((json[offset] as TemplateRow[]) ?? []);
        setRolePool(((json[offset + 1] as ContributorRoleRow[]) ?? []).filter((role) => role.isActive));
        setBenefitTypes(((json[offset + 2] as BenefitTypeRow[]) ?? []).filter((benefit) => benefit.isActive));
        setExternalTemplates(((json[offset + 3] as ExternalTemplateRow[]) ?? []).filter((template) => template.isActive));
        setSourceKpis(
          ((json[offset + 4] as KpiSummaryRow[]) ?? [])
            .filter((row) => row.id !== initial?.id)
            .map((row) => ({
              id: row.id,
              title: row.title,
              kraTitle: row.kraTitle ?? null,
              state: row.state,
            })),
        );
        setWorkflowReviewerOptions((json[offset + 5] as WorkflowReviewerOption[]) ?? []);
      } catch {
        if (!cancelled) {
          setError("Failed to load unified KPI builder data.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadResources();
    return () => {
      cancelled = true;
    };
  }, [initial?.id, kraDefinitionId, mode, units]);

  const reviewerOptionsForUnit = useCallback(
    (unitId: string | null | undefined) =>
      unitId
        ? workflowReviewerOptions.filter((option) => option.unitIds.includes(unitId))
        : [],
    [workflowReviewerOptions],
  );

  const formatReviewerLabel = useCallback(
    (option: WorkflowReviewerOption) =>
      `${option.name}${option.employeeId ? ` (${option.employeeId})` : ""}`,
    [],
  );

  const fieldOptions = useMemo(
    () =>
      (payload.definition.achievementFormConfig?.fields ?? [])
        .slice()
        .sort((left, right) => left.sortOrder - right.sortOrder),
    [payload.definition.achievementFormConfig?.fields],
  );

  const tierRefOptions = useMemo(
    () =>
      payload.rewardTiers.map((tier) => ({
        refKey: tier.refKey ?? tier.code,
        code: tier.code,
        label: `${tier.name} (${tier.refKey ?? tier.code})`,
      })),
    [payload.rewardTiers],
  );

  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) ?? null;
  const starterTemplates = useMemo(
    () =>
      templates.filter(
        (template) =>
          template.category === NAAC_TEMPLATE_CATEGORY &&
          template.builderPayload.meta?.starterPackKey === NAAC_UNIVERSITY_STARTER_PACK_KEY,
      ),
    [templates],
  );
  const tenantTemplates = useMemo(
    () => templates.filter((template) => !template.isSystem),
    [templates],
  );
  const systemTemplates = useMemo(
    () =>
      templates.filter(
        (template) =>
          template.isSystem &&
          !(
            template.category === NAAC_TEMPLATE_CATEGORY &&
            template.builderPayload.meta?.starterPackKey === NAAC_UNIVERSITY_STARTER_PACK_KEY
          ),
      ),
    [templates],
  );

  const describeTemplateOption = (template: TemplateRow) => {
    if (
      template.category === NAAC_TEMPLATE_CATEGORY &&
      template.builderPayload.meta?.starterPackKey === NAAC_UNIVERSITY_STARTER_PACK_KEY
    ) {
      return `${template.name} (NAAC Starter)`;
    }
    return `${template.name} ${template.isSystem ? "(System)" : "(Tenant)"}`;
  };

  const updateDefinition = <K extends keyof KpiBuilderPayload["definition"]>(
    key: K,
    value: KpiBuilderPayload["definition"][K],
  ) => {
    setPayload((current) => ({
      ...current,
      definition: {
        ...current.definition,
        [key]: value,
      },
    }));
  };

  const updateContributorConfig = <K extends keyof KpiBuilderPayload["contributorConfig"]>(
    key: K,
    value: KpiBuilderPayload["contributorConfig"][K],
  ) => {
    setPayload((current) => ({
      ...current,
      contributorConfig: {
        ...current.contributorConfig,
        [key]: value,
      },
    }));
  };

  const setFields = (fields: AchievementFieldConfig[]) => {
    setPayload((current) => ({
      ...current,
      definition: {
        ...current.definition,
        achievementFormConfig: fields.length > 0
          ? {
              templateKey: current.definition.achievementTemplateKey ?? undefined,
              fields,
            }
          : null,
      },
    }));
  };

  const setApplicableRoles = (applicableRoles: BuilderApplicableRole[]) => {
    setPayload((current) => ({ ...current, applicableRoles }));
  };

  const setStages = (stages: BuilderStage[]) => {
    setPayload((current) => ({ ...current, stages }));
  };

  const setRewardTiers = (rewardTiers: BuilderRewardTier[]) => {
    setPayload((current) => ({ ...current, rewardTiers }));
  };

  const setRewardComponents = (rewardComponents: BuilderRewardComponent[]) => {
    setPayload((current) => ({ ...current, rewardComponents }));
  };

  const handleTemplateApply = () => {
    if (!selectedTemplate) return;
    if (payload.definition.title.trim() || payload.rewardComponents.length > 0 || payload.rewardTiers.length > 0) {
      const confirmed = window.confirm("Apply this template to the current draft? Existing unsaved builder changes will be replaced.");
      if (!confirmed) return;
    }

    const next = applyTemplateToDraftPayload({
      templatePayload: selectedTemplate.builderPayload,
      kraDefinitionId,
      startingUnitId: payload.definition.startingUnitId || units[0]?.id || "",
      existingId: mode === "edit" ? initial?.id : undefined,
    });
    setPayload(next);
  };

  const loadCopyPreview = async (sourceKpiId: string) => {
    setSelectedSourceKpiId(sourceKpiId);
    setCopyPreview(null);
    if (!sourceKpiId) return;

    const response = await fetch(`/api/tenant/kra-kpi/kpi-copy/preview?sourceKpiId=${sourceKpiId}`);
    const data = await response.json();
    if (!response.ok) {
      setError(data.message ?? "Failed to load copy preview.");
      return;
    }
    setCopyPreview(data as CopyPreviewResponse);
    setCopySelection((current) =>
      applyCopyDependencies(current, (data as CopyPreviewResponse).sections),
    );
  };

  const toggleCopySelection = (key: keyof KpiCopySelection, checked: boolean) => {
    setCopySelection((current) =>
      applyCopyDependencies(
        {
          ...current,
          [key]: checked,
        },
        copyPreview?.sections,
      ),
    );
  };

  const applyCopyToDraft = async () => {
    if (!selectedSourceKpiId) return;
    const response = await fetch(`/api/tenant/kra-kpi/kpi-builder/${selectedSourceKpiId}`);
    const source = (await response.json()) as KpiBuilderPayload;
    if (!response.ok) {
      setError("Failed to load the selected source KPI.");
      return;
    }

    const resolvedSelection = applyCopyDependencies(copySelection, copyPreview?.sections);
    const next = applyCopySelectionToDraft({
      source,
      target: payload,
      selection: resolvedSelection,
      targetKraDefinitionId: kraDefinitionId,
      startingUnitId: payload.definition.startingUnitId || units[0]?.id || "",
    });
    next.definition.id = mode === "edit" ? initial?.id : undefined;
    setPayload(next);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(
        mode === "create"
          ? "/api/tenant/kra-kpi/kpi-builder"
          : `/api/tenant/kra-kpi/kpi-builder/${initial!.id}`,
        {
          method: mode === "create" ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = await response.json();
      if (!response.ok || data.status === "error") {
        setError(data.message ?? "Failed to save KPI builder.");
        setSubmitting(false);
        return;
      }
      onDone();
    } catch {
      setError("Failed to save KPI builder.");
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
  };

  const runRewardPreview = async () => {
    if (mode !== "edit" || !initial?.id) return;
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewResult(null);

    try {
      const requestBody: RewardPreviewInputType = {
        reportingDate: previewDate ? new Date(previewDate) : new Date(),
        effectiveScore: previewScore.trim() ? Number(previewScore) : undefined,
        achievementFormData: (parseJsonValue(previewFormDataText) as Record<string, unknown>) ?? {},
        contributors: (parseJsonValue(previewContributorsText) as RewardPreviewInput["contributors"]) ?? [],
        systemMetrics: {},
      };

      const response = await fetch(`/api/tenant/kra-kpi/kpi-builder/${initial.id}/reward-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const data = await response.json();
      if (!response.ok) {
        setPreviewError(data.message ?? "Failed to preview rewards.");
        return;
      }
      setPreviewResult(data as RewardPreviewResult);
    } catch (previewErr) {
      setPreviewError(previewErr instanceof Error ? previewErr.message : "Failed to preview rewards.");
    } finally {
      setPreviewLoading(false);
    }
  };

  if (loading) {
    return (
      <div className={`${sectionCls} flex items-center gap-2 text-sm text-slate-500`}>
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading KPI builder...
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-brand">
            {mode === "create" ? "Unified KPI Builder" : "Edit KPI Builder"}
          </div>
          <div className="mt-1 text-sm text-slate-500">
            Configure basics, fields, participants, stages, tiers, rewards, and distributions in one draft.
          </div>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600"
        >
          Cancel
        </button>
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      ) : null}

      <Section
        title="Templates And Copy"
        description="Start from a system or tenant template, or selectively import sections from an existing KPI."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
              Apply Template
            </div>
            <label className={labelCls}>Template</label>
            <select
              value={selectedTemplateId}
              onChange={(event) => setSelectedTemplateId(event.target.value)}
              className={inputCls}
            >
              <option value="">Blank KPI</option>
              {starterTemplates.length > 0 ? (
                <optgroup label="NAAC Starter Pack">
                  {starterTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {describeTemplateOption(template)}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {systemTemplates.length > 0 ? (
                <optgroup label="System Templates">
                  {systemTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {describeTemplateOption(template)}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {tenantTemplates.length > 0 ? (
                <optgroup label="Tenant Templates">
                  {tenantTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {describeTemplateOption(template)}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
            {selectedTemplate ? (
              <div className="mt-2 space-y-1 text-xs text-slate-500">
                {selectedTemplate.category === NAAC_TEMPLATE_CATEGORY ? (
                  <div className="font-semibold text-amber-700">
                    NAAC starter template
                  </div>
                ) : null}
                <p>
                  {selectedTemplate.description ?? "This template preloads fields, roles, policies, tiers, and rewards."}
                </p>
              </div>
            ) : null}
            <button
              type="button"
              disabled={!selectedTemplate}
              onClick={handleTemplateApply}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              <ChevronRight className="h-3.5 w-3.5" />
              Apply template to draft
            </button>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
              Import Existing KPI
            </div>
            <label className={labelCls}>Source KPI</label>
            <select
              value={selectedSourceKpiId}
              onChange={(event) => void loadCopyPreview(event.target.value)}
              className={inputCls}
            >
              <option value="">Select a KPI to copy from...</option>
              {sourceKpis.map((kpi) => (
                <option key={kpi.id} value={kpi.id}>
                  {kpi.title} {kpi.kraTitle ? `- ${kpi.kraTitle}` : ""}
                </option>
              ))}
            </select>
            {copyPreview ? (
              <div className="mt-3 space-y-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
                <div className="text-xs text-slate-500">
                  Source: <span className="font-medium text-slate-700">{copyPreview.title}</span>
                  {" "}from {copyPreview.sourceKraTitle} ({copyPreview.sourcePeriodName})
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(
                    Object.keys(copySelection) as Array<keyof KpiCopySelection>
                  ).map((key) => (
                    <label
                      key={key}
                      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
                        copyPreview.sections[key]
                          ? "border-slate-200 bg-white text-slate-700"
                          : "border-slate-100 bg-slate-50 text-slate-400"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={copySelection[key]}
                        disabled={!copyPreview.sections[key]}
                        onChange={(event) => toggleCopySelection(key, event.target.checked)}
                        className="h-3.5 w-3.5 rounded border-slate-300"
                      />
                      {key}
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => void applyCopyToDraft()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white"
                >
                  <CopyPlus className="h-3.5 w-3.5" />
                  Apply selected sections to draft
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </Section>

      <Section title="Basics" description="Core KPI identity, scoring, routing, and evidence defaults.">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="md:col-span-2 xl:col-span-4">
            <label className={labelCls}>Title</label>
            <input
              value={payload.definition.title}
              onChange={(event) => updateDefinition("title", event.target.value)}
              className={inputCls}
              placeholder="e.g. Faculty Research Publication Incentive"
            />
          </div>
          <div className="md:col-span-2 xl:col-span-4">
            <label className={labelCls}>Description</label>
            <textarea
              value={payload.definition.description ?? ""}
              onChange={(event) => updateDefinition("description", event.target.value || null)}
              className={`${inputCls} resize-none`}
              rows={2}
            />
          </div>
          <div>
            <label className={labelCls}>Measurement Type</label>
            <select
              value={payload.definition.measurementType}
              onChange={(event) =>
                updateDefinition("measurementType", event.target.value as KpiBuilderPayload["definition"]["measurementType"])
              }
              className={inputCls}
            >
              {MEASUREMENT_TYPES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>

          {payload.definition.measurementType === "DATE_TARGET" && (() => {
            const mc = payload.definition.measurementConfig;
            const dtCfg = mc?.type === "DATE_TARGET" ? mc : null;
            const grace = dtCfg?.gracePeriodDays ?? 0;
            const penEnabled = dtCfg?.latePenaltyEnabled ?? false;
            const penRate = dtCfg?.latePenaltyPercentPerDay ?? 5;
            const setDtConfig = (patch: Record<string, unknown>) => {
              updateDefinition("measurementConfig", {
                type: "DATE_TARGET" as const,
                allowEarly: dtCfg?.allowEarly ?? true,
                gracePeriodDays: grace,
                latePenaltyEnabled: penEnabled,
                latePenaltyPercentPerDay: penRate,
                ...patch,
              });
            };
            return (
              <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-3 md:col-span-2 xl:col-span-4">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Late Submission Settings
                </p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label className={labelCls}>Grace Period (days)</label>
                    <input
                      type="number"
                      min={0}
                      value={grace}
                      onChange={(e) => setDtConfig({ gracePeriodDays: Math.max(0, Number(e.target.value)) })}
                      className={inputCls}
                    />
                    <p className="mt-0.5 text-[10px] text-slate-400">Extra days after deadline with no penalty</p>
                  </div>
                  <div className="flex items-center pt-5">
                    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={penEnabled}
                        onChange={(e) => setDtConfig({ latePenaltyEnabled: e.target.checked })}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      Enable late penalty
                    </label>
                  </div>
                  {penEnabled && (
                    <div>
                      <label className={labelCls}>Penalty per day (%)</label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step="0.5"
                        value={penRate}
                        onChange={(e) => setDtConfig({ latePenaltyPercentPerDay: Math.max(0, Math.min(100, Number(e.target.value))) })}
                        className={inputCls}
                      />
                      <p className="mt-0.5 text-[10px] text-slate-400">Score deducted per day after grace period</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          <div>
            <label className={labelCls}>Unit Label</label>
            <input
              value={payload.definition.unitLabel ?? ""}
              onChange={(event) => updateDefinition("unitLabel", event.target.value || null)}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Weightage</label>
            <input
              type="number"
              value={payload.definition.weightage}
              onChange={(event) => updateDefinition("weightage", Number(event.target.value))}
              className={inputCls}
              min={0}
              max={100}
            />
          </div>
          <div>
            <label className={labelCls}>Default Target</label>
            <input
              type="number"
              value={payload.definition.defaultTarget ?? ""}
              onChange={(event) =>
                updateDefinition(
                  "defaultTarget",
                  event.target.value === "" ? null : Number(event.target.value),
                )
              }
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Scoring Method</label>
            <select
              value={payload.definition.scoringMethod}
              onChange={(event) =>
                updateDefinition("scoringMethod", event.target.value as KpiBuilderPayload["definition"]["scoringMethod"])
              }
              className={inputCls}
            >
              {SCORING_METHODS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Scoring Direction</label>
            <select
              value={payload.definition.scoringDirection}
              onChange={(event) =>
                updateDefinition("scoringDirection", event.target.value as KpiBuilderPayload["definition"]["scoringDirection"])
              }
              className={inputCls}
            >
              {SCORING_DIRECTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Allocation Type</label>
            <select
              value={payload.definition.allocationType}
              onChange={(event) =>
                updateDefinition("allocationType", event.target.value as KpiBuilderPayload["definition"]["allocationType"])
              }
              className={inputCls}
            >
              {ALLOCATION_TYPES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Starting Unit</label>
            <select
              value={payload.definition.startingUnitId}
              onChange={(event) => updateDefinition("startingUnitId", event.target.value)}
              className={inputCls}
            >
              <option value="">Select unit...</option>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Key Unit</label>
            <select
              value={payload.definition.keyUnitId ?? ""}
              onChange={(event) => {
                updateDefinition("keyUnitId", event.target.value || null);
                updateDefinition("keyReviewerUserId", null);
              }}
              className={inputCls}
            >
              <option value="">None</option>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Final Unit</label>
            <select
              value={payload.definition.finalUnitId ?? ""}
              onChange={(event) => {
                updateDefinition("finalUnitId", event.target.value || null);
                updateDefinition("finalReviewerUserId", null);
              }}
              className={inputCls}
            >
              <option value="">None</option>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Key Reviewer</label>
            <select
              value={payload.definition.keyReviewerUserId ?? ""}
              onChange={(event) => updateDefinition("keyReviewerUserId", event.target.value || null)}
              className={inputCls}
              disabled={!payload.definition.keyUnitId}
            >
              <option value="">Fallback to key unit head</option>
              {reviewerOptionsForUnit(payload.definition.keyUnitId).map((option) => (
                <option key={option.userId} value={option.userId}>
                  {formatReviewerLabel(option)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Final Reviewer</label>
            <select
              value={payload.definition.finalReviewerUserId ?? ""}
              onChange={(event) => updateDefinition("finalReviewerUserId", event.target.value || null)}
              className={inputCls}
              disabled={!payload.definition.finalUnitId}
            >
              <option value="">Fallback to final unit head</option>
              {reviewerOptionsForUnit(payload.definition.finalUnitId).map((option) => (
                <option key={option.userId} value={option.userId}>
                  {formatReviewerLabel(option)}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>Guidance Notes</label>
            <textarea
              value={payload.definition.guidanceNotes ?? ""}
              onChange={(event) => updateDefinition("guidanceNotes", event.target.value || null)}
              className={`${inputCls} resize-none`}
              rows={2}
            />
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>SOP Description</label>
            <textarea
              value={payload.definition.sopDescription ?? ""}
              onChange={(event) => updateDefinition("sopDescription", event.target.value || null)}
              className={`${inputCls} resize-none`}
              rows={2}
            />
          </div>
          <div className="md:col-span-2 xl:col-span-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={payload.definition.isPerCapita}
                onChange={(event) => updateDefinition("isPerCapita", event.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              Per Capita
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={payload.definition.isTeamKpi}
                onChange={(event) => updateDefinition("isTeamKpi", event.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              Team KPI
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={payload.definition.allowPartialCompletion}
                onChange={(event) => updateDefinition("allowPartialCompletion", event.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              Allow Partial Completion
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={payload.definition.allowMultipleAchievementsPerAllocation}
                disabled={payload.definition.measurementType !== "NUMERIC"}
                onChange={(event) =>
                  updateDefinition("allowMultipleAchievementsPerAllocation", event.target.checked)
                }
                className="h-4 w-4 rounded border-slate-300"
              />
              Parallel Requests
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={payload.definition.evidenceRequired}
                onChange={(event) => updateDefinition("evidenceRequired", event.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              Evidence Required
            </label>
          </div>
          <div className="text-xs text-slate-500">
            {payload.definition.measurementType === "NUMERIC"
              ? "Parallel requests let one allocation collect multiple item-based submissions. Official progress comes from verified requests only."
              : "Parallel requests are available only for numeric KPIs."}
          </div>
        </div>
      </Section>

      <Section
        title="Data Collection"
        description="Define the achievement form fields, validations, bindings, and conditional rules used by tiers and rewards."
      >
        <div className="flex items-center justify-between">
          <div className="text-xs text-slate-500">
            {fieldOptions.length} field(s) configured
          </div>
          <button
            type="button"
            onClick={() => setFields([...(payload.definition.achievementFormConfig?.fields ?? []), newField(fieldOptions.length)])}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white"
          >
            <Plus className="h-3.5 w-3.5" />
            Add field
          </button>
        </div>

        {fieldOptions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">
            No achievement fields yet. Add fields or apply a template.
          </div>
        ) : (
          <div className="space-y-3">
            {fieldOptions.map((field, index) => (
              <div key={`${field.key}-${index}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Field {index + 1}
                  </div>
                  <button
                    type="button"
                    onClick={() => setFields(fieldOptions.filter((_, fieldIndex) => fieldIndex !== index))}
                    className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div>
                    <label className={labelCls}>Key</label>
                    <input
                      value={field.key}
                      onChange={(event) => {
                        const fields = fieldOptions.slice();
                        fields[index] = { ...fields[index], key: event.target.value };
                        setFields(fields);
                      }}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Label</label>
                    <input
                      value={field.label}
                      onChange={(event) => {
                        const fields = fieldOptions.slice();
                        fields[index] = { ...fields[index], label: event.target.value };
                        setFields(fields);
                      }}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Type</label>
                    <select
                      value={field.type}
                      onChange={(event) => {
                        const nextType = event.target.value as AchievementFieldConfig["type"];
                        const fields = fieldOptions.slice();
                        fields[index] = {
                          ...fields[index],
                          type: nextType,
                          options:
                            nextType === "SELECT" || nextType === "MULTI_SELECT"
                              ? fields[index].options ?? []
                              : undefined,
                        };
                        setFields(fields);
                      }}
                      className={inputCls}
                    >
                      {ACHIEVEMENT_FIELD_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Binding</label>
                    <select
                      value={field.binding ?? field.marker ?? ""}
                      onChange={(event) => {
                        const fields = fieldOptions.slice();
                        fields[index] = {
                          ...fields[index],
                          binding: event.target.value ? (event.target.value as AchievementFieldConfig["binding"]) : undefined,
                        };
                        setFields(fields);
                      }}
                      className={inputCls}
                    >
                      <option value="">None</option>
                      <option value="VALUE_FIELD">VALUE_FIELD</option>
                      <option value="CATEGORY_FIELD">CATEGORY_FIELD</option>
                      <option value="UNIT_FIELD">UNIT_FIELD</option>
                      <option value="SCORE_FIELD">SCORE_FIELD</option>
                      <option value="UNIQUE_CHECK">UNIQUE_CHECK</option>
                      <option value="POLICY_DATE_FIELD">POLICY_DATE_FIELD</option>
                      <option value="TEAM_SIZE">TEAM_SIZE</option>
                    </select>
                  </div>
                  {(field.type === "SELECT" || field.type === "MULTI_SELECT") && (
                    <div className="md:col-span-2 xl:col-span-4">
                      <label className={labelCls}>Options</label>
                      <input
                        value={(field.options ?? []).join(", ")}
                        onChange={(event) => {
                          const fields = fieldOptions.slice();
                          fields[index] = {
                            ...fields[index],
                            options: event.target.value
                              .split(",")
                              .map((option) => option.trim())
                              .filter(Boolean),
                          };
                          setFields(fields);
                        }}
                        className={inputCls}
                        placeholder="Comma separated options"
                      />
                    </div>
                  )}
                  <div className="md:col-span-2 xl:col-span-4">
                    <label className={labelCls}>Conditional Rules JSON</label>
                    <textarea
                      value={formatJson({
                        visibilityRules: field.visibilityRules ?? [],
                        requiredRules: field.requiredRules ?? [],
                      })}
                      onChange={(event) => {
                        const fields = fieldOptions.slice();
                        try {
                          const parsed = parseJsonValue(event.target.value) as {
                            visibilityRules?: FieldCondition[];
                            requiredRules?: FieldCondition[];
                          };
                          fields[index] = {
                            ...fields[index],
                            visibilityRules: parsed?.visibilityRules,
                            requiredRules: parsed?.requiredRules,
                          };
                          setFields(fields);
                        } catch {
                          // keep text area editable without breaking the whole form
                        }
                      }}
                      rows={4}
                      className={`${inputCls} font-mono text-xs`}
                      placeholder='{"visibilityRules":[],"requiredRules":[]}'
                    />
                  </div>
                  <div className="md:col-span-2 xl:col-span-4 flex flex-wrap items-center gap-4">
                    <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={field.required}
                        onChange={(event) => {
                          const fields = fieldOptions.slice();
                          fields[index] = { ...fields[index], required: event.target.checked };
                          setFields(fields);
                        }}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      Required
                    </label>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Participant And Contributor Policy"
        description="Choose solo vs team participation, recurrence, external contributors, duplicate checks, and credit rules."
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <label className={labelCls}>Participant Mode</label>
            <select
              value={payload.definition.participantMode}
              onChange={(event) =>
                updateDefinition("participantMode", event.target.value as KpiBuilderPayload["definition"]["participantMode"])
              }
              className={inputCls}
            >
              {PARTICIPANT_MODES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Reward Recurrence</label>
            <select
              value={payload.definition.rewardRecurrencePolicy}
              onChange={(event) =>
                updateDefinition(
                  "rewardRecurrencePolicy",
                  event.target.value as KpiBuilderPayload["definition"]["rewardRecurrencePolicy"],
                )
              }
              className={inputCls}
            >
              {REWARD_RECURRENCE_POLICIES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Policy Date Field</label>
            <select
              value={payload.definition.policyDateFieldKey ?? ""}
              onChange={(event) => updateDefinition("policyDateFieldKey", event.target.value || null)}
              className={inputCls}
            >
              <option value="">Use achievement actual/reporting date</option>
              {fieldOptions.map((field) => (
                <option key={field.key} value={field.key}>
                  {field.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Credit Sum Mode</label>
            <select
              value={payload.contributorConfig.creditSumMode}
              onChange={(event) =>
                updateContributorConfig(
                  "creditSumMode",
                  event.target.value as KpiBuilderPayload["contributorConfig"]["creditSumMode"],
                )
              }
              className={inputCls}
            >
              {CREDIT_SUM_MODES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2 xl:col-span-4 flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={payload.contributorConfig.allowExternalContributors}
                onChange={(event) => updateContributorConfig("allowExternalContributors", event.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              Allow external contributors
            </label>
            <div className="min-w-60">
              <label className={labelCls}>External Contributor Template</label>
              <select
                value={payload.contributorConfig.externalContribTemplateId ?? ""}
                onChange={(event) =>
                  updateContributorConfig("externalContribTemplateId", event.target.value || null)
                }
                className={inputCls}
              >
                <option value="">Tenant default / none</option>
                {externalTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} {template.isDefault ? "(Default)" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="md:col-span-2 xl:col-span-4">
            <label className={labelCls}>Duplicate Check Fields</label>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {fieldOptions.map((field) => (
                <label
                  key={field.key}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                >
                  <input
                    type="checkbox"
                    checked={payload.contributorConfig.duplicateCheckFields.includes(field.key)}
                    onChange={(event) => {
                      const next = new Set(payload.contributorConfig.duplicateCheckFields);
                      if (event.target.checked) next.add(field.key);
                      else next.delete(field.key);
                      updateContributorConfig("duplicateCheckFields", [...next]);
                    }}
                    className="h-3.5 w-3.5 rounded border-slate-300"
                  />
                  {field.label}
                  <span className="font-mono text-[10px] text-slate-400">{field.key}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </Section>

      <Section title="Roles" description="Define the KPI-level role catalog and choose one default role.">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {rolePool.map((role) => {
            const isEnabled = payload.applicableRoles.some((row) => row.roleId === role.id || row.roleCode === role.code);
            const isDefault = payload.applicableRoles.some(
              (row) => (row.roleId === role.id || row.roleCode === role.code) && row.isDefault,
            );
            return (
              <div key={role.id} className="rounded-lg border border-slate-200 bg-white px-3 py-3">
                <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-800">
                  <input
                    type="checkbox"
                    checked={isEnabled}
                    onChange={(event) => {
                      if (event.target.checked) {
                        const next = [
                          ...payload.applicableRoles,
                          {
                            roleId: role.id,
                            roleCode: role.code,
                            isDefault: payload.applicableRoles.length === 0,
                            sortOrder: payload.applicableRoles.length,
                          },
                        ];
                        setApplicableRoles(next);
                      } else {
                        const next = payload.applicableRoles
                          .filter((row) => row.roleId !== role.id && row.roleCode !== role.code)
                          .map((row, index) => ({ ...row, sortOrder: index }));
                        if (next.length > 0 && !next.some((row) => row.isDefault)) {
                          next[0] = { ...next[0], isDefault: true };
                        }
                        setApplicableRoles(next);
                      }
                    }}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  {role.name}
                </label>
                <div className="mt-1 text-xs text-slate-500">{role.code}</div>
                {isEnabled ? (
                  <label className="mt-3 inline-flex items-center gap-2 text-xs text-slate-600">
                    <input
                      type="radio"
                      checked={isDefault}
                      onChange={() =>
                        setApplicableRoles(
                          payload.applicableRoles.map((row) => ({
                            ...row,
                            isDefault: row.roleId === role.id || row.roleCode === role.code,
                          })),
                        )
                      }
                      className="h-3.5 w-3.5 border-slate-300"
                    />
                    Default role
                  </label>
                ) : null}
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="Stages" description="Configure stage definitions, deadlines, evidence, and partial-completion structure.">
        <div className="flex items-center justify-between">
          <div className="text-xs text-slate-500">{payload.stages.length} stage(s)</div>
          <button
            type="button"
            onClick={() => setStages([...payload.stages, newStage(payload.stages.length)])}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white"
          >
            <Plus className="h-3.5 w-3.5" />
            Add stage
          </button>
        </div>
        <div className="space-y-3">
          {payload.stages.map((stage, index) => (
            <div key={stage.id ?? `stage-${index}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Stage {index + 1}
                </div>
                <button
                  type="button"
                  onClick={() => setStages(payload.stages.filter((_, stageIndex) => stageIndex !== index))}
                  className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div>
                  <label className={labelCls}>Title</label>
                  <input
                    value={stage.title}
                    onChange={(event) => {
                      const next = payload.stages.slice();
                      next[index] = { ...next[index], title: event.target.value };
                      setStages(next);
                    }}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Order</label>
                  <input
                    type="number"
                    value={stage.stageOrder}
                    onChange={(event) => {
                      const next = payload.stages.slice();
                      next[index] = { ...next[index], stageOrder: Number(event.target.value) };
                      setStages(next);
                    }}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Weight</label>
                  <input
                    type="number"
                    value={stage.weight}
                    onChange={(event) => {
                      const next = payload.stages.slice();
                      next[index] = { ...next[index], weight: Number(event.target.value) };
                      setStages(next);
                    }}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Deadline</label>
                  <input
                    type="date"
                    value={stage.deadline ? new Date(stage.deadline).toISOString().slice(0, 10) : ""}
                    onChange={(event) => {
                      const next = payload.stages.slice();
                      next[index] = {
                        ...next[index],
                        deadline: event.target.value ? new Date(event.target.value) : null,
                      };
                      setStages(next);
                    }}
                    className={inputCls}
                  />
                </div>
                <div className="md:col-span-2 xl:col-span-4">
                  <label className={labelCls}>Description</label>
                  <textarea
                    value={stage.description ?? ""}
                    onChange={(event) => {
                      const next = payload.stages.slice();
                      next[index] = { ...next[index], description: event.target.value || null };
                      setStages(next);
                    }}
                    className={`${inputCls} resize-none`}
                    rows={2}
                  />
                </div>
                <div className="md:col-span-2 xl:col-span-4 flex flex-wrap items-center gap-4">
                  <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={stage.isMandatory}
                      onChange={(event) => {
                        const next = payload.stages.slice();
                        next[index] = { ...next[index], isMandatory: event.target.checked };
                        setStages(next);
                      }}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    Mandatory
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={stage.evidenceRequired}
                      onChange={(event) => {
                        const next = payload.stages.slice();
                        next[index] = { ...next[index], evidenceRequired: event.target.checked };
                        setStages(next);
                      }}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    Evidence required
                  </label>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Reward Tiers"
        description="Define tier windows, matching rules, and tier references used by reward components."
      >
        <div className="flex items-center justify-between">
          <div className="text-xs text-slate-500">{payload.rewardTiers.length} tier(s)</div>
          <button
            type="button"
            onClick={() => setRewardTiers([...payload.rewardTiers, newTier(payload.rewardTiers.length)])}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white"
          >
            <Plus className="h-3.5 w-3.5" />
            Add tier
          </button>
        </div>
        <div className="space-y-3">
          {payload.rewardTiers.map((tier, index) => (
            <div key={tier.id ?? tier.refKey ?? `${tier.code}-${index}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Tier {index + 1}
                </div>
                <button
                  type="button"
                  onClick={() => setRewardTiers(payload.rewardTiers.filter((_, tierIndex) => tierIndex !== index))}
                  className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div>
                  <label className={labelCls}>Reference Key</label>
                  <input
                    value={tier.refKey ?? ""}
                    onChange={(event) => {
                      const next = payload.rewardTiers.slice();
                      next[index] = { ...next[index], refKey: event.target.value || undefined };
                      setRewardTiers(next);
                    }}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Code</label>
                  <input
                    value={tier.code}
                    onChange={(event) => {
                      const next = payload.rewardTiers.slice();
                      next[index] = { ...next[index], code: event.target.value };
                      setRewardTiers(next);
                    }}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Name</label>
                  <input
                    value={tier.name}
                    onChange={(event) => {
                      const next = payload.rewardTiers.slice();
                      next[index] = { ...next[index], name: event.target.value };
                      setRewardTiers(next);
                    }}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Priority</label>
                  <input
                    type="number"
                    value={tier.priority}
                    onChange={(event) => {
                      const next = payload.rewardTiers.slice();
                      next[index] = { ...next[index], priority: Number(event.target.value) };
                      setRewardTiers(next);
                    }}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Match Mode</label>
                  <select
                    value={tier.matchMode}
                    onChange={(event) => {
                      const next = payload.rewardTiers.slice();
                      next[index] = { ...next[index], matchMode: event.target.value as BuilderRewardTier["matchMode"] };
                      setRewardTiers(next);
                    }}
                    className={inputCls}
                  >
                    {MATCH_MODES.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Effective From</label>
                  <input
                    type="date"
                    value={tier.effectiveFrom ? new Date(tier.effectiveFrom).toISOString().slice(0, 10) : ""}
                    onChange={(event) => {
                      const next = payload.rewardTiers.slice();
                      next[index] = {
                        ...next[index],
                        effectiveFrom: event.target.value ? new Date(event.target.value) : null,
                      };
                      setRewardTiers(next);
                    }}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Effective To</label>
                  <input
                    type="date"
                    value={tier.effectiveTo ? new Date(tier.effectiveTo).toISOString().slice(0, 10) : ""}
                    onChange={(event) => {
                      const next = payload.rewardTiers.slice();
                      next[index] = {
                        ...next[index],
                        effectiveTo: event.target.value ? new Date(event.target.value) : null,
                      };
                      setRewardTiers(next);
                    }}
                    className={inputCls}
                  />
                </div>
                <div className="flex items-end">
                  <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={tier.isActive}
                      onChange={(event) => {
                        const next = payload.rewardTiers.slice();
                        next[index] = { ...next[index], isActive: event.target.checked };
                        setRewardTiers(next);
                      }}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    Active
                  </label>
                </div>
              </div>
              <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Tier Rules
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const next = payload.rewardTiers.slice();
                      next[index] = { ...next[index], rules: [...next[index].rules, newRule(next[index].rules.length)] };
                      setRewardTiers(next);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600"
                  >
                    <Plus className="h-3 w-3" />
                    Add rule
                  </button>
                </div>
                <div className="space-y-3">
                  {tier.rules.map((rule, ruleIndex) => (
                    <div key={rule.id ?? `${tier.code}-${ruleIndex}`} className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 md:grid-cols-2 xl:grid-cols-5">
                      <div>
                        <label className={labelCls}>Source</label>
                        <select
                          value={rule.source}
                          onChange={(event) => {
                            const next = payload.rewardTiers.slice();
                            const rules = next[index].rules.slice();
                            rules[ruleIndex] = { ...rules[ruleIndex], source: event.target.value as BuilderRewardRule["source"] };
                            next[index] = { ...next[index], rules };
                            setRewardTiers(next);
                          }}
                          className={inputCls}
                        >
                          {REWARD_RULE_SOURCES.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className={labelCls}>Operator</label>
                        <select
                          value={rule.operator}
                          onChange={(event) => {
                            const next = payload.rewardTiers.slice();
                            const rules = next[index].rules.slice();
                            rules[ruleIndex] = { ...rules[ruleIndex], operator: event.target.value as BuilderRewardRule["operator"] };
                            next[index] = { ...next[index], rules };
                            setRewardTiers(next);
                          }}
                          className={inputCls}
                        >
                          {RULE_OPERATORS.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className={labelCls}>Field Key</label>
                        <select
                          value={rule.fieldKey ?? ""}
                          onChange={(event) => {
                            const next = payload.rewardTiers.slice();
                            const rules = next[index].rules.slice();
                            rules[ruleIndex] = { ...rules[ruleIndex], fieldKey: event.target.value || undefined };
                            next[index] = { ...next[index], rules };
                            setRewardTiers(next);
                          }}
                          className={inputCls}
                        >
                          <option value="">None</option>
                          {fieldOptions.map((field) => (
                            <option key={field.key} value={field.key}>
                              {field.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="xl:col-span-2">
                        <label className={labelCls}>Value JSON</label>
                        <div className="flex gap-2">
                          <input
                            value={typeof rule.value === "string" ? rule.value : formatJson(rule.value)}
                            onChange={(event) => {
                              const next = payload.rewardTiers.slice();
                              const rules = next[index].rules.slice();
                              let parsedValue: unknown = event.target.value;
                              try {
                                parsedValue = parseJsonValue(event.target.value);
                              } catch {
                                parsedValue = event.target.value;
                              }
                              rules[ruleIndex] = { ...rules[ruleIndex], value: parsedValue };
                              next[index] = { ...next[index], rules };
                              setRewardTiers(next);
                            }}
                            className={inputCls}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const next = payload.rewardTiers.slice();
                              next[index] = {
                                ...next[index],
                                rules: next[index].rules.filter((_, candidateIndex) => candidateIndex !== ruleIndex),
                              };
                              setRewardTiers(next);
                            }}
                            className="rounded-lg border border-slate-200 bg-white px-3 text-slate-500"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Reward Components"
        description="Attach benefit types, amount modes, distributions, and tier links."
      >
        <div className="flex items-center justify-between">
          <div className="text-xs text-slate-500">{payload.rewardComponents.length} reward component(s)</div>
          <button
            type="button"
            onClick={() => setRewardComponents([...payload.rewardComponents, newRewardComponent(payload.rewardComponents.length)])}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white"
          >
            <Plus className="h-3.5 w-3.5" />
            Add reward component
          </button>
        </div>
        <div className="space-y-3">
          {payload.rewardComponents.map((component, index) => (
            <div key={component.id ?? component.code ?? `${index}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Reward Component {index + 1}
                </div>
                <button
                  type="button"
                  onClick={() => setRewardComponents(payload.rewardComponents.filter((_, componentIndex) => componentIndex !== index))}
                  className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div>
                  <label className={labelCls}>Code</label>
                  <input
                    value={component.code}
                    onChange={(event) => {
                      const next = payload.rewardComponents.slice();
                      next[index] = { ...next[index], code: event.target.value };
                      setRewardComponents(next);
                    }}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Name</label>
                  <input
                    value={component.name}
                    onChange={(event) => {
                      const next = payload.rewardComponents.slice();
                      next[index] = { ...next[index], name: event.target.value };
                      setRewardComponents(next);
                    }}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Benefit Type</label>
                  <select
                    value={component.benefitTypeCode ?? ""}
                    onChange={(event) => {
                      const next = payload.rewardComponents.slice();
                      next[index] = { ...next[index], benefitTypeCode: event.target.value, benefitTypeId: undefined };
                      setRewardComponents(next);
                    }}
                    className={inputCls}
                  >
                    <option value="">Select...</option>
                    {benefitTypes.map((benefit) => (
                      <option key={benefit.id} value={benefit.code}>
                        {benefit.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Tier Reference</label>
                  <select
                    value={component.rewardTierRef ?? component.rewardTierCode ?? ""}
                    onChange={(event) => {
                      const next = payload.rewardComponents.slice();
                      next[index] = {
                        ...next[index],
                        rewardTierRef: event.target.value || null,
                        rewardTierCode:
                          tierRefOptions.find((tier) => tier.refKey === event.target.value)?.code ?? null,
                      };
                      setRewardComponents(next);
                    }}
                    className={inputCls}
                  >
                    <option value="">No tier binding</option>
                    {tierRefOptions.map((tier) => (
                      <option key={tier.refKey} value={tier.refKey}>
                        {tier.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Trigger</label>
                  <select
                    value={component.trigger}
                    onChange={(event) => {
                      const next = payload.rewardComponents.slice();
                      next[index] = { ...next[index], trigger: event.target.value as BuilderRewardComponent["trigger"] };
                      setRewardComponents(next);
                    }}
                    className={inputCls}
                  >
                    {REWARD_TRIGGER_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Amount Mode</label>
                  <select
                    value={component.amountMode}
                    onChange={(event) => {
                      const next = payload.rewardComponents.slice();
                      next[index] = { ...next[index], amountMode: event.target.value as BuilderRewardComponent["amountMode"] };
                      setRewardComponents(next);
                    }}
                    className={inputCls}
                  >
                    {REWARD_AMOUNT_MODES.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Amount Value</label>
                  <input
                    type="number"
                    value={component.amountValue ?? ""}
                    onChange={(event) => {
                      const next = payload.rewardComponents.slice();
                      next[index] = {
                        ...next[index],
                        amountValue: event.target.value === "" ? null : Number(event.target.value),
                      };
                      setRewardComponents(next);
                    }}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Amount Field</label>
                  <select
                    value={component.amountFieldKey ?? ""}
                    onChange={(event) => {
                      const next = payload.rewardComponents.slice();
                      next[index] = { ...next[index], amountFieldKey: event.target.value || null };
                      setRewardComponents(next);
                    }}
                    className={inputCls}
                  >
                    <option value="">None</option>
                    {fieldOptions.map((field) => (
                      <option key={field.key} value={field.key}>
                        {field.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Distribution Mode</label>
                  <select
                    value={component.distributionMode}
                    onChange={(event) => {
                      const next = payload.rewardComponents.slice();
                      next[index] = {
                        ...next[index],
                        distributionMode: event.target.value as BuilderRewardComponent["distributionMode"],
                      };
                      setRewardComponents(next);
                    }}
                    className={inputCls}
                  >
                    {DISTRIBUTION_MODES.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Single Eligible</label>
                  <select
                    value={component.singleEligibleHandling}
                    onChange={(event) => {
                      const next = payload.rewardComponents.slice();
                      next[index] = {
                        ...next[index],
                        singleEligibleHandling: event.target.value as BuilderRewardComponent["singleEligibleHandling"],
                      };
                      setRewardComponents(next);
                    }}
                    className={inputCls}
                  >
                    {SINGLE_ELIGIBLE_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Empty Share</label>
                  <select
                    value={component.emptyShareHandling}
                    onChange={(event) => {
                      const next = payload.rewardComponents.slice();
                      next[index] = {
                        ...next[index],
                        emptyShareHandling: event.target.value as BuilderRewardComponent["emptyShareHandling"],
                      };
                      setRewardComponents(next);
                    }}
                    className={inputCls}
                  >
                    {EMPTY_SHARE_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Distributions
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const next = payload.rewardComponents.slice();
                      next[index] = {
                        ...next[index],
                        distributions: [...next[index].distributions, newDistribution(next[index].distributions.length)],
                      };
                      setRewardComponents(next);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600"
                  >
                    <Plus className="h-3 w-3" />
                    Add distribution
                  </button>
                </div>
                <div className="space-y-3">
                  {component.distributions.map((distribution, distributionIndex) => (
                    <div key={distribution.id ?? `${component.code}-${distributionIndex}`} className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 md:grid-cols-2 xl:grid-cols-5">
                      <div>
                        <label className={labelCls}>Selector Type</label>
                        <select
                          value={distribution.selectorType}
                          onChange={(event) => {
                            const next = payload.rewardComponents.slice();
                            const distributions = next[index].distributions.slice();
                            distributions[distributionIndex] = {
                              ...distributions[distributionIndex],
                              selectorType: event.target.value as BuilderRewardDistribution["selectorType"],
                            };
                            next[index] = { ...next[index], distributions };
                            setRewardComponents(next);
                          }}
                          className={inputCls}
                        >
                          {SELECTOR_TYPES.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className={labelCls}>Role</label>
                        <select
                          value={distribution.contributorRoleId ?? ""}
                          onChange={(event) => {
                            const role = rolePool.find((candidate) => candidate.id === event.target.value) ?? null;
                            const next = payload.rewardComponents.slice();
                            const distributions = next[index].distributions.slice();
                            distributions[distributionIndex] = {
                              ...distributions[distributionIndex],
                              contributorRoleId: role?.id ?? null,
                              contributorRoleCode: role?.code ?? null,
                            };
                            next[index] = { ...next[index], distributions };
                            setRewardComponents(next);
                          }}
                          className={inputCls}
                        >
                          <option value="">None</option>
                          {rolePool.map((role) => (
                            <option key={role.id} value={role.id}>
                              {role.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className={labelCls}>Selector Tag</label>
                        <input
                          value={distribution.selectorTag ?? ""}
                          onChange={(event) => {
                            const next = payload.rewardComponents.slice();
                            const distributions = next[index].distributions.slice();
                            distributions[distributionIndex] = {
                              ...distributions[distributionIndex],
                              selectorTag: event.target.value || null,
                            };
                            next[index] = { ...next[index], distributions };
                            setRewardComponents(next);
                          }}
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label className={labelCls}>Share Percent</label>
                        <input
                          type="number"
                          value={distribution.sharePercent ?? ""}
                          onChange={(event) => {
                            const next = payload.rewardComponents.slice();
                            const distributions = next[index].distributions.slice();
                            distributions[distributionIndex] = {
                              ...distributions[distributionIndex],
                              sharePercent: event.target.value === "" ? null : Number(event.target.value),
                            };
                            next[index] = { ...next[index], distributions };
                            setRewardComponents(next);
                          }}
                          className={inputCls}
                        />
                      </div>
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className={labelCls}>Split Mode</label>
                          <select
                            value={distribution.splitMode ?? ""}
                            onChange={(event) => {
                              const next = payload.rewardComponents.slice();
                              const distributions = next[index].distributions.slice();
                              distributions[distributionIndex] = {
                                ...distributions[distributionIndex],
                                splitMode: event.target.value ? (event.target.value as BuilderRewardDistribution["splitMode"]) : null,
                              };
                              next[index] = { ...next[index], distributions };
                              setRewardComponents(next);
                            }}
                            className={inputCls}
                          >
                            <option value="">None</option>
                            {SPLIT_MODES.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const next = payload.rewardComponents.slice();
                            next[index] = {
                              ...next[index],
                              distributions: next[index].distributions.filter((_, candidateIndex) => candidateIndex !== distributionIndex),
                            };
                            setRewardComponents(next);
                          }}
                          className="mt-6 rounded-lg border border-slate-200 bg-white px-3 text-slate-500"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {mode === "edit" && initial?.id ? (
        <Section
          title="Reward Preview"
          description="Run a sample preview against the saved KPI to validate tier resolution and distribution."
          defaultOpen={false}
        >
          <div className="grid gap-4 xl:grid-cols-2">
            <div>
              <label className={labelCls}>Achievement Form Data JSON</label>
              <textarea
                value={previewFormDataText}
                onChange={(event) => setPreviewFormDataText(event.target.value)}
                rows={8}
                className={`${inputCls} font-mono text-xs`}
              />
            </div>
            <div>
              <label className={labelCls}>Contributors JSON</label>
              <textarea
                value={previewContributorsText}
                onChange={(event) => setPreviewContributorsText(event.target.value)}
                rows={8}
                className={`${inputCls} font-mono text-xs`}
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Effective Score</label>
              <input value={previewScore} onChange={(event) => setPreviewScore(event.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Reporting Date</label>
              <input type="date" value={previewDate} onChange={(event) => setPreviewDate(event.target.value)} className={inputCls} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void runRewardPreview()}
              disabled={previewLoading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              {previewLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronRight className="h-3.5 w-3.5" />}
              Run reward preview
            </button>
            {previewError ? <span className="text-xs text-rose-600">{previewError}</span> : null}
          </div>
          {previewResult ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <div className="text-xs text-slate-500">
                Policy Date: {previewResult.policyDate ?? "n/a"} | Recurrence: {previewResult.recurrencePolicy}
              </div>
              <div className="mt-2 space-y-2">
                {previewResult.components.map((component) => (
                  <div key={component.componentCode} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <div className="font-medium text-slate-800">
                      {component.componentName} ({component.benefitTypeCode})
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Total: {component.totalAmount} | Blocked: {component.blockedCount}
                      {component.fallbackApplied ? ` | Fallback: ${component.fallbackApplied}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </Section>
      ) : null}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          {mode === "create" ? "Create KPI" : "Save KPI"}
        </button>
      </div>
    </form>
  );
}
