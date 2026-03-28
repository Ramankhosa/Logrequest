"use client";

import {
  startTransition,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import {
  EmptyState,
  ExportButton,
  FilterBar,
  MetricCard,
  StatusPill,
} from "@/components/dashboard/shared";
import type {
  ContributorRewardView,
  RewardConsoleFilterOption,
  RewardConsoleFilterOptions,
  RewardConsoleListResult,
  RewardReconciliationGroupBy,
  RewardReconciliationResult,
} from "@/lib/kra-kpi/shared";
import type { UserDashboardScope } from "@/lib/org-structure/scope-resolver";
import { cn } from "@/lib/utils";

type RewardPanelProps = {
  scope: UserDashboardScope;
  periodId: string;
};

type RewardView = "pipeline" | "reconciliation";
type RewardAction = "PENDING" | "RELEASED" | "REVOKED";

type RewardOptionSets = {
  benefitTypes: Array<{ value: string; label: string; unit: string }>;
  units: RewardConsoleFilterOption[];
  kras: RewardConsoleFilterOption[];
};

const VIEW_OPTIONS: Array<{ key: RewardView; label: string; description: string }> = [
  {
    key: "pipeline",
    label: "Pipeline",
    description: "Filter the current reward workflow and transition only the rows you can act on.",
  },
  {
    key: "reconciliation",
    label: "Reconciliation",
    description: "Group scoped rewards by benefit type, unit, or KRA without mixing incompatible amount units.",
  },
];

const GROUP_BY_OPTIONS: Array<{ value: RewardReconciliationGroupBy; label: string }> = [
  { value: "benefitType", label: "Benefit Type" },
  { value: "unit", label: "Unit" },
  { value: "kra", label: "KRA" },
];

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

function buildRewardQuery(
  currentQuery: string,
  updates: {
    rewardView?: RewardView | null;
    rewardState?: string | null;
    rewardBenefit?: string | null;
    rewardUnit?: string | null;
    rewardKra?: string | null;
  },
) {
  const params = new URLSearchParams(currentQuery);

  if ("rewardView" in updates) {
    if (updates.rewardView) {
      params.set("rewardView", updates.rewardView);
    } else {
      params.delete("rewardView");
    }
  }

  if ("rewardState" in updates) {
    if (updates.rewardState) {
      params.set("rewardState", updates.rewardState);
    } else {
      params.delete("rewardState");
    }
  }

  if ("rewardBenefit" in updates) {
    if (updates.rewardBenefit) {
      params.set("rewardBenefit", updates.rewardBenefit);
    } else {
      params.delete("rewardBenefit");
    }
  }

  if ("rewardUnit" in updates) {
    if (updates.rewardUnit) {
      params.set("rewardUnit", updates.rewardUnit);
    } else {
      params.delete("rewardUnit");
    }
  }

  if ("rewardKra" in updates) {
    if (updates.rewardKra) {
      params.set("rewardKra", updates.rewardKra);
    } else {
      params.delete("rewardKra");
    }
  }

  return params.toString();
}

function mergeOptionSets(
  previous: RewardOptionSets,
  incoming: RewardConsoleFilterOptions | null | undefined,
): RewardOptionSets {
  if (!incoming) {
    return previous;
  }

  const benefits = new Map(previous.benefitTypes.map((option) => [option.value, option]));
  for (const option of incoming.benefitTypes) {
    benefits.set(option.benefitTypeCode, {
      value: option.benefitTypeCode,
      label: option.benefitTypeName,
      unit: option.unit,
    });
  }

  const units = new Map(previous.units.map((option) => [option.value, option]));
  for (const option of incoming.units) {
    units.set(option.value, option);
  }

  const kras = new Map(previous.kras.map((option) => [option.value, option]));
  for (const option of incoming.kras) {
    kras.set(option.value, option);
  }

  return {
    benefitTypes: [...benefits.values()].sort((left, right) => left.label.localeCompare(right.label)),
    units: [...units.values()].sort((left, right) => left.label.localeCompare(right.label)),
    kras: [...kras.values()].sort((left, right) => left.label.localeCompare(right.label)),
  };
}

function formatAmount(value: number, unit: string) {
  return `${value.toFixed(2)} ${unit}`;
}

function formatDate(value: string | Date | null | undefined) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function getActionMeta(action: RewardAction) {
  if (action === "PENDING") {
    return {
      label: "Approve",
      confirmLabel: "Approve eligible rows",
      title: "Approve selected rewards?",
      description: "Only draft rewards can move into the pending release queue.",
      tone:
        "border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100",
    };
  }
  if (action === "RELEASED") {
    return {
      label: "Release",
      confirmLabel: "Release eligible rows",
      title: "Release selected rewards?",
      description: "Only pending rewards can be released, and every release requires a payment reference.",
      tone:
        "border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
    };
  }
  return {
    label: "Revoke",
    confirmLabel: "Revoke eligible rows",
    title: "Revoke selected rewards?",
    description: "Any non-revoked reward can be revoked, but the reason is mandatory for traceability.",
    tone:
      "border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100",
  };
}

function isRewardEligible(reward: ContributorRewardView, action: RewardAction) {
  if (action === "PENDING") {
    return reward.state === "DRAFT";
  }
  if (action === "RELEASED") {
    return reward.state === "PENDING";
  }
  return reward.state !== "REVOKED";
}

function buildExportHref(periodId: string, filters: {
  state: string;
  benefitTypeCode: string;
  unitId: string;
  kraDefinitionId: string;
}) {
  const params = new URLSearchParams({ periodId });
  if (filters.state) params.set("state", filters.state);
  if (filters.benefitTypeCode) params.set("benefitTypeCode", filters.benefitTypeCode);
  if (filters.unitId) params.set("unitId", filters.unitId);
  if (filters.kraDefinitionId) params.set("kraDefinitionId", filters.kraDefinitionId);
  return `/api/tenant/kra-kpi/rewards/export?${params.toString()}`;
}

function RewardActionDialog(props: {
  action: RewardAction | null;
  open: boolean;
  selectedCount: number;
  eligibleCount: number;
  skippedCount: number;
  note: string;
  releaseReference: string;
  loading: boolean;
  onNoteChange: (value: string) => void;
  onReleaseReferenceChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const {
    action,
    open,
    selectedCount,
    eligibleCount,
    skippedCount,
    note,
    releaseReference,
    loading,
    onNoteChange,
    onReleaseReferenceChange,
    onCancel,
    onConfirm,
  } = props;

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, open]);

  if (typeof document === "undefined" || !open || !action) {
    return null;
  }

  const meta = getActionMeta(action);
  const confirmDisabled =
    loading
    || eligibleCount === 0
    || (action === "RELEASED" && !releaseReference.trim())
    || (action === "REVOKED" && !note.trim());

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/40 px-4">
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-lg rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-2xl"
      >
        <h3 className="text-lg font-semibold text-slate-900">{meta.title}</h3>
        <p className="mt-2 text-sm leading-7 text-slate-500">{meta.description}</p>

        <div className="mt-4 flex flex-wrap gap-2">
          <StatusPill label={`${selectedCount} selected`} tone="slate" />
          <StatusPill label={`${eligibleCount} eligible`} tone={eligibleCount > 0 ? "brand" : "amber"} />
          {skippedCount > 0 ? (
            <StatusPill label={`${skippedCount} skipped`} tone="rose" />
          ) : null}
        </div>

        {action === "RELEASED" ? (
          <div className="mt-5">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Release Reference
            </label>
            <input
              value={releaseReference}
              onChange={(event) => onReleaseReferenceChange(event.target.value)}
              placeholder="Enter payment or release reference"
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15"
            />
          </div>
        ) : null}

        <div className="mt-5">
          <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            {action === "REVOKED" ? "Revocation Reason" : "Action Note"}
          </label>
          <textarea
            value={note}
            onChange={(event) => onNoteChange(event.target.value)}
            rows={4}
            placeholder={
              action === "REVOKED"
                ? "Explain why these rewards are being revoked"
                : "Optional note for the audit trail"
            }
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15"
          />
        </div>

        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirmDisabled}
            className={cn(
              "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60",
              action === "RELEASED"
                ? "bg-emerald-600 hover:bg-emerald-500"
                : action === "REVOKED"
                  ? "bg-rose-600 hover:bg-rose-500"
                  : "bg-amber-500 text-slate-950 hover:bg-amber-400",
            )}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {meta.confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function RewardPanel({ scope, periodId }: RewardPanelProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamString = searchParams.toString();

  const requestedView = searchParams.get("rewardView") as RewardView | null;
  const rewardView: RewardView = requestedView === "reconciliation" ? "reconciliation" : "pipeline";
  const rewardFilters = {
    state: searchParams.get("rewardState") ?? "",
    benefitTypeCode: searchParams.get("rewardBenefit") ?? "",
    unitId: searchParams.get("rewardUnit") ?? "",
    kraDefinitionId: searchParams.get("rewardKra") ?? "",
  };

  const [pipeline, setPipeline] = useState<RewardConsoleListResult | null>(null);
  const [pipelineLoading, setPipelineLoading] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);

  const [reconciliation, setReconciliation] = useState<RewardReconciliationResult | null>(null);
  const [reconciliationLoading, setReconciliationLoading] = useState(false);
  const [reconciliationError, setReconciliationError] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<RewardReconciliationGroupBy>("benefitType");

  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(10);
  const [reloadVersion, setReloadVersion] = useState(0);

  const [selectedRewardIds, setSelectedRewardIds] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [actionDialog, setActionDialog] = useState<RewardAction | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionNote, setActionNote] = useState("");
  const [releaseReference, setReleaseReference] = useState("");

  const [optionSets, setOptionSets] = useState<RewardOptionSets>({
    benefitTypes: [],
    units: [],
    kras: [],
  });

  function replaceRewardParams(updates: {
    rewardView?: RewardView | null;
    rewardState?: string | null;
    rewardBenefit?: string | null;
    rewardUnit?: string | null;
    rewardKra?: string | null;
  }) {
    const query = buildRewardQuery(searchParamString, updates);
    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  }

  useEffect(() => {
    setPageIndex(0);
    setSelectedRewardIds([]);
  }, [periodId, rewardFilters.benefitTypeCode, rewardFilters.kraDefinitionId, rewardFilters.state, rewardFilters.unitId]);

  useEffect(() => {
    let ignore = false;

    async function loadPipeline() {
      setPipelineLoading(true);
      setPipelineError(null);

      try {
        const params = new URLSearchParams({
          periodId,
          limit: String(pageSize),
          offset: String(pageIndex * pageSize),
        });
        if (rewardFilters.state) params.set("state", rewardFilters.state);
        if (rewardFilters.benefitTypeCode) params.set("benefitTypeCode", rewardFilters.benefitTypeCode);
        if (rewardFilters.unitId) params.set("unitId", rewardFilters.unitId);
        if (rewardFilters.kraDefinitionId) params.set("kraDefinitionId", rewardFilters.kraDefinitionId);

        const response = await fetch(`/api/tenant/kra-kpi/rewards?${params.toString()}`);
        const data = (await response.json()) as RewardConsoleListResult | { message?: string };
        if (!response.ok) {
          throw new Error("message" in data ? data.message ?? "Failed to load rewards." : "Failed to load rewards.");
        }

        if (!ignore) {
          const next = data as RewardConsoleListResult;
          setPipeline(next);
          setOptionSets((current) => mergeOptionSets(current, next.filterOptions));
        }
      } catch (error) {
        if (!ignore) {
          setPipeline(null);
          setPipelineError(error instanceof Error ? error.message : "Failed to load rewards.");
        }
      } finally {
        if (!ignore) {
          setPipelineLoading(false);
        }
      }
    }

    void loadPipeline();
    return () => {
      ignore = true;
    };
  }, [pageIndex, pageSize, periodId, reloadVersion, rewardFilters.benefitTypeCode, rewardFilters.kraDefinitionId, rewardFilters.state, rewardFilters.unitId]);

  useEffect(() => {
    if (rewardView !== "reconciliation") return;
    let ignore = false;

    async function loadReconciliation() {
      setReconciliationLoading(true);
      setReconciliationError(null);

      try {
        const params = new URLSearchParams({
          periodId,
          groupBy,
        });
        if (rewardFilters.state) params.set("state", rewardFilters.state);
        if (rewardFilters.benefitTypeCode) params.set("benefitTypeCode", rewardFilters.benefitTypeCode);
        if (rewardFilters.unitId) params.set("unitId", rewardFilters.unitId);
        if (rewardFilters.kraDefinitionId) params.set("kraDefinitionId", rewardFilters.kraDefinitionId);

        const response = await fetch(`/api/tenant/kra-kpi/rewards/reconciliation?${params.toString()}`);
        const data = (await response.json()) as RewardReconciliationResult | { message?: string };
        if (!response.ok) {
          throw new Error("message" in data ? data.message ?? "Failed to load reconciliation." : "Failed to load reconciliation.");
        }

        if (!ignore) {
          setReconciliation(data as RewardReconciliationResult);
        }
      } catch (error) {
        if (!ignore) {
          setReconciliation(null);
          setReconciliationError(error instanceof Error ? error.message : "Failed to load reconciliation.");
        }
      } finally {
        if (!ignore) {
          setReconciliationLoading(false);
        }
      }
    }

    void loadReconciliation();
    return () => {
      ignore = true;
    };
  }, [groupBy, periodId, reloadVersion, rewardFilters.benefitTypeCode, rewardFilters.kraDefinitionId, rewardFilters.state, rewardFilters.unitId, rewardView]);

  const selectedRewards = useMemo(
    () => (pipeline?.rewards ?? []).filter((reward) => selectedRewardIds.includes(reward.id)),
    [pipeline?.rewards, selectedRewardIds],
  );

  const dialogEligibleRewards = useMemo(
    () => (actionDialog ? selectedRewards.filter((reward) => isRewardEligible(reward, actionDialog)) : []),
    [actionDialog, selectedRewards],
  );

  const totalCount = pipeline?.totalRows ?? 0;
  const totalPages = totalCount === 0 ? 1 : Math.ceil(totalCount / pageSize);
  const pageStart = totalCount === 0 ? 0 : pageIndex * pageSize + 1;
  const pageEnd = totalCount === 0 ? 0 : Math.min(totalCount, pageStart + (pipeline?.rewards.length ?? 0) - 1);
  const allVisibleSelected =
    (pipeline?.rewards.length ?? 0) > 0
    && (pipeline?.rewards ?? []).every((reward) => selectedRewardIds.includes(reward.id));

  const pipelineCounts = (pipeline?.totals ?? []).reduce(
    (accumulator, total) => ({
      total: accumulator.total + total.totalCount,
      draft: accumulator.draft + total.draftCount,
      pending: accumulator.pending + total.pendingCount,
      released: accumulator.released + total.releasedCount,
      revoked: accumulator.revoked + total.revokedCount,
      units: [...accumulator.units, total.unit],
      totalAmount:
        accumulator.totalAmount
        + total.draftAmount
        + total.pendingAmount
        + total.releasedAmount,
    }),
    {
      total: 0,
      draft: 0,
      pending: 0,
      released: 0,
      revoked: 0,
      units: [] as string[],
      totalAmount: 0,
    },
  );
  const amountUnits = [...new Set(pipelineCounts.units)];
  const safeAmountLabel =
    amountUnits.length === 1 && amountUnits[0]
      ? formatAmount(pipelineCounts.totalAmount, amountUnits[0])
      : "Mixed units";

  const filterDefs = [
    {
      key: "state",
      label: "State",
      type: "select" as const,
      options: [
        { value: "DRAFT", label: "Draft" },
        { value: "PENDING", label: "Pending" },
        { value: "RELEASED", label: "Released" },
        { value: "REVOKED", label: "Revoked" },
      ],
    },
    {
      key: "benefitTypeCode",
      label: "Benefit",
      type: "select" as const,
      options: optionSets.benefitTypes.map((option) => ({
        value: option.value,
        label: `${option.label} (${option.unit})`,
      })),
    },
    {
      key: "unitId",
      label: "Unit",
      type: "select" as const,
      options: optionSets.units,
    },
    {
      key: "kraDefinitionId",
      label: "KRA",
      type: "select" as const,
      options: optionSets.kras,
    },
  ];

  async function submitAction() {
    if (!actionDialog || dialogEligibleRewards.length === 0) {
      return;
    }

    setActionLoading(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/tenant/kra-kpi/rewards/transition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rewardIds: dialogEligibleRewards.map((reward) => reward.id),
          nextState: actionDialog,
          note: actionNote.trim() || undefined,
          releaseReference: releaseReference.trim() || undefined,
        }),
      });
      const data = (await response.json()) as {
        status: string;
        updatedCount: number;
        failed?: Array<{ id: string; message: string }>;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(data.message ?? "Reward transition failed.");
      }

      const skippedCount = selectedRewards.length - dialogEligibleRewards.length;
      const failedCount = data.failed?.length ?? 0;
      const segments = [`${data.updatedCount} row(s) updated`];
      if (failedCount > 0) {
        segments.push(`${failedCount} failed`);
      }
      if (skippedCount > 0) {
        segments.push(`${skippedCount} skipped`);
      }

      setFeedback({
        type: failedCount > 0 ? "error" : "success",
        message: `${segments.join(", ")}.`,
      });
      setActionDialog(null);
      setActionNote("");
      setReleaseReference("");
      setSelectedRewardIds([]);
      setReloadVersion((current) => current + 1);
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Reward transition failed.",
      });
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="glass-panel rounded-[1.75rem] border border-slate-200/80 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="section-title text-xs text-slate-400">Rewards Workspace</div>
            <h3 className="mt-3 text-lg font-semibold text-slate-900">Reward pipeline and reconciliation</h3>
            <p className="mt-2 max-w-3xl text-sm text-slate-500">
              {scope.isTenantAdmin
                ? "Tenant-wide reward operations stay available here, but bulk actions still follow the stricter reward workflow."
                : "This view stays locked to your reward-approval authority. The dashboard does not broaden access beyond the reward scope already granted to you."}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <StatusPill label={scope.isTenantAdmin ? "Tenant access" : "Scoped access"} tone="blue" />
              <StatusPill label={`${optionSets.units.length} governed units`} tone="brand" />
              <StatusPill label={`${pipelineCounts.total} filtered rewards`} tone="slate" />
            </div>
          </div>
          <div className="rounded-[1.5rem] border border-slate-200 bg-white/80 px-4 py-3 text-sm text-slate-600">
            <div className="font-semibold text-slate-900">Workflow rule</div>
            <div className="mt-1">Draft -&gt; Pending -&gt; Released</div>
            <div>Any non-revoked row can still be revoked with a reason.</div>
          </div>
        </div>
      </section>

      {feedback ? (
        <div className={cn(
          "rounded-[1.5rem] border px-4 py-3 text-sm",
          feedback.type === "success"
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-rose-200 bg-rose-50 text-rose-700",
        )}>
          {feedback.message}
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label="Rewards"
          value={pipelineCounts.total}
          description="All filtered rows across the current reward scope."
          tone="brand"
          loading={pipelineLoading}
          icon={<Wallet className="h-4 w-4" />}
        />
        <MetricCard
          label="Draft"
          value={pipelineCounts.draft}
          description="Eligible for approval into the pending queue."
          tone="amber"
          loading={pipelineLoading}
          icon={<FileSpreadsheet className="h-4 w-4" />}
        />
        <MetricCard
          label="Pending"
          value={pipelineCounts.pending}
          description="Ready for release once the payment reference is known."
          tone="blue"
          loading={pipelineLoading}
          icon={<ShieldCheck className="h-4 w-4" />}
        />
        <MetricCard
          label="Released"
          value={pipelineCounts.released}
          description="Already released with immutable release references."
          tone="brand"
          loading={pipelineLoading}
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
        <MetricCard
          label="Amount"
          value={safeAmountLabel}
          description={
            amountUnits.length <= 1
              ? "Safe total for the current filtered result."
              : "Mixed reward units detected, so the dashboard will not fake one total."
          }
          tone={amountUnits.length <= 1 ? "blue" : "rose"}
          loading={pipelineLoading}
          icon={<Wallet className="h-4 w-4" />}
        />
      </section>

      <section className="glass-panel rounded-[1.75rem] border border-slate-200/80 p-5">
        <div className="flex flex-wrap gap-2">
          {VIEW_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => replaceRewardParams({ rewardView: option.key })}
              className={cn(
                "rounded-full px-4 py-2 text-sm font-semibold transition",
                rewardView === option.key
                  ? "bg-slate-900 text-white"
                  : "border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="mt-3 text-sm text-slate-500">
          {VIEW_OPTIONS.find((option) => option.key === rewardView)?.description}
        </p>
      </section>

      <FilterBar
        filters={filterDefs}
        active={rewardFilters}
        onChange={(key, value) => {
          const nextValue = typeof value === "string" ? value : "";
          if (key === "state") {
            replaceRewardParams({ rewardState: nextValue || null });
            return;
          }
          if (key === "benefitTypeCode") {
            replaceRewardParams({ rewardBenefit: nextValue || null });
            return;
          }
          if (key === "unitId") {
            replaceRewardParams({ rewardUnit: nextValue || null });
            return;
          }
          if (key === "kraDefinitionId") {
            replaceRewardParams({ rewardKra: nextValue || null });
          }
        }}
        onClear={() =>
          replaceRewardParams({
            rewardState: null,
            rewardBenefit: null,
            rewardUnit: null,
            rewardKra: null,
          })
        }
      />

      {rewardView === "pipeline" ? (
        <>
          <section className="glass-panel rounded-[1.75rem] border border-slate-200/80 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="text-lg font-semibold text-slate-900">Bulk actions</h4>
                <p className="text-sm text-slate-500">
                  Actions only apply to eligible rows on the current page. The confirmation dialog shows skipped rows before submission.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusPill label={`${selectedRewardIds.length} selected`} tone="slate" />
                <button
                  type="button"
                  onClick={() => setActionDialog("PENDING")}
                  disabled={selectedRewardIds.length === 0}
                  className={cn(
                    "rounded-full px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
                    getActionMeta("PENDING").tone,
                  )}
                >
                  {getActionMeta("PENDING").label}
                </button>
                <button
                  type="button"
                  onClick={() => setActionDialog("RELEASED")}
                  disabled={selectedRewardIds.length === 0}
                  className={cn(
                    "rounded-full px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
                    getActionMeta("RELEASED").tone,
                  )}
                >
                  {getActionMeta("RELEASED").label}
                </button>
                <button
                  type="button"
                  onClick={() => setActionDialog("REVOKED")}
                  disabled={selectedRewardIds.length === 0}
                  className={cn(
                    "rounded-full px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
                    getActionMeta("REVOKED").tone,
                  )}
                >
                  {getActionMeta("REVOKED").label}
                </button>
              </div>
            </div>
          </section>
          {pipelineError ? (
            <EmptyState
              icon={<AlertTriangle className="h-8 w-8" />}
              title="Could not load rewards"
              description={pipelineError}
            />
          ) : pipelineLoading ? (
            <div className="flex items-center justify-center rounded-[1.75rem] border border-slate-200/80 bg-white/80 py-20">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : !pipeline || pipeline.rewards.length === 0 ? (
            <EmptyState
              icon={<Wallet className="h-8 w-8" />}
              title="No rewards match the current filters"
              description="Adjust the reward filters or clear them to bring scoped reward rows back into view."
            />
          ) : (
            <section className="space-y-4">
              <div className="overflow-hidden rounded-[1.75rem] border border-slate-200/80 bg-white/85">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50/90">
                      <tr>
                        <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                          <input
                            type="checkbox"
                            checked={allVisibleSelected}
                            onChange={() => {
                              setSelectedRewardIds((current) =>
                                allVisibleSelected
                                  ? current.filter((id) => !(pipeline.rewards ?? []).some((reward) => reward.id === id))
                                  : [...new Set([...current, ...(pipeline.rewards ?? []).map((reward) => reward.id)])],
                              );
                            }}
                          />
                        </th>
                        <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">KRA / KPI</th>
                        <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Contributor</th>
                        <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Benefit</th>
                        <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">State</th>
                        <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Units</th>
                        <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Dates</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white/85">
                      {pipeline.rewards.map((reward) => (
                        <tr key={reward.id} className="align-top transition hover:bg-slate-50/80">
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              checked={selectedRewardIds.includes(reward.id)}
                              onChange={() =>
                                setSelectedRewardIds((current) =>
                                  current.includes(reward.id)
                                    ? current.filter((id) => id !== reward.id)
                                    : [...current, reward.id],
                                )
                              }
                            />
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            <div className="font-semibold text-slate-900">{reward.kraTitle}</div>
                            <div className="mt-1">{reward.kpiTitle}</div>
                            <div className="mt-2 text-xs text-slate-400">Reward ID: {reward.id}</div>
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            <div className="font-semibold text-slate-900">{reward.contributorDisplayName}</div>
                            <div className="mt-1 text-xs text-slate-500">Reported by: {reward.reportedByUserName}</div>
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            <div className="font-semibold text-slate-900">{reward.benefitTypeName}</div>
                            <div className="mt-1">{formatAmount(reward.finalAmount, reward.benefitUnit)}</div>
                            <div className="mt-1 text-xs text-slate-500">
                              {reward.rewardTierName ?? reward.rewardTierCode ?? "No tier"} / {reward.rewardComponentName}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            <div className="flex flex-wrap gap-2">
                              <StatusPill state={reward.state} />
                            </div>
                            {reward.releaseReference ? (
                              <div className="mt-2 text-xs text-slate-500">Release ref: {reward.releaseReference}</div>
                            ) : null}
                            {reward.revocationReason ? (
                              <div className="mt-1 text-xs text-rose-600">Reason: {reward.revocationReason}</div>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            <div>{reward.rewardOwnerUnitName ?? "No owner unit"}</div>
                            <div className="mt-1 text-xs text-slate-500">Reporter: {reward.reporterUnitName ?? "No reporter unit"}</div>
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            <div>Created: {formatDate(reward.createdAt)}</div>
                            <div className="mt-1 text-xs text-slate-500">Released: {formatDate(reward.releasedAt)}</div>
                            {reward.revokedAt ? (
                              <div className="mt-1 text-xs text-rose-600">Revoked: {formatDate(reward.revokedAt)}</div>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
                <div>
                  Showing {pageStart}-{pageEnd} of {totalCount}
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Page size
                  </label>
                  <select
                    value={pageSize}
                    onChange={(event) => {
                      setPageSize(Number(event.target.value) as (typeof PAGE_SIZE_OPTIONS)[number]);
                      setPageIndex(0);
                      setSelectedRewardIds([]);
                    }}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
                  >
                    {PAGE_SIZE_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      setPageIndex((current) => Math.max(0, current - 1));
                      setSelectedRewardIds([]);
                    }}
                    disabled={pageIndex === 0}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPageIndex((current) => Math.min(totalPages - 1, current + 1));
                      setSelectedRewardIds([]);
                    }}
                    disabled={pageIndex >= totalPages - 1}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            </section>
          )}
        </>
      ) : (
        <section className="space-y-4">
          <div className="glass-panel rounded-[1.75rem] border border-slate-200/80 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="text-lg font-semibold text-slate-900">Reconciliation</h4>
                <p className="text-sm text-slate-500">
                  Amount totals exclude revoked rewards and stay split by compatible units when needed.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <select
                  value={groupBy}
                  onChange={(event) => setGroupBy(event.target.value as RewardReconciliationGroupBy)}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15"
                >
                  {GROUP_BY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ExportButton href={buildExportHref(periodId, rewardFilters)} />
              </div>
            </div>
          </div>
          {reconciliationError ? (
            <EmptyState
              icon={<AlertTriangle className="h-8 w-8" />}
              title="Could not load reconciliation"
              description={reconciliationError}
            />
          ) : reconciliationLoading ? (
            <div className="flex items-center justify-center rounded-[1.75rem] border border-slate-200/80 bg-white/80 py-20">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : !reconciliation || reconciliation.rows.length === 0 ? (
            <EmptyState
              icon={<FileSpreadsheet className="h-8 w-8" />}
              title="No reconciliation rows available"
              description="The current reward filters do not produce any reconciliation data."
            />
          ) : (
            <div className="overflow-hidden rounded-[1.75rem] border border-slate-200/80 bg-white/85">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50/90">
                    <tr>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        {GROUP_BY_OPTIONS.find((option) => option.value === groupBy)?.label ?? "Group"}
                      </th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Counts</th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Amounts</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white/85">
                    {reconciliation.rows.map((row) => (
                      <tr key={row.groupKey} className="align-top">
                        <td className="px-4 py-3 text-slate-600">
                          <div className="font-semibold text-slate-900">{row.label}</div>
                          {row.code ? <div className="mt-1 text-xs text-slate-400">{row.code}</div> : null}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          <div className="flex flex-wrap gap-2">
                            <StatusPill label={`${row.totalCount} total`} tone="slate" />
                            <StatusPill label={`${row.draftCount} draft`} tone="amber" />
                            <StatusPill label={`${row.pendingCount} pending`} tone="blue" />
                            <StatusPill label={`${row.releasedCount} released`} tone="brand" />
                            <StatusPill label={`${row.revokedCount} revoked`} tone="rose" />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {row.isMixedUnits ? (
                            <div className="space-y-1">
                              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-500">Mixed units</div>
                              {row.amountBuckets.map((bucket) => (
                                <div key={`${row.groupKey}-${bucket.unit}`} className="text-sm">
                                  {formatAmount(bucket.totalAmount, bucket.unit)}
                                  <span className="ml-2 text-xs text-slate-500">
                                    Draft {bucket.draftAmount.toFixed(2)} / Pending {bucket.pendingAmount.toFixed(2)} / Released {bucket.releasedAmount.toFixed(2)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : row.unit ? (
                            <div>
                              <div className="font-semibold text-slate-900">{formatAmount(row.totalAmount ?? 0, row.unit)}</div>
                              <div className="mt-1 text-xs text-slate-500">Revoked amount excluded from total.</div>
                            </div>
                          ) : (
                            <span className="text-slate-400">No amount rows</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t border-slate-200 bg-slate-50/80">
                    <tr>
                      <td className="px-4 py-3 font-semibold text-slate-900">{reconciliation.totals.label}</td>
                      <td className="px-4 py-3 text-slate-600">
                        <div className="flex flex-wrap gap-2">
                          <StatusPill label={`${reconciliation.totals.totalCount} total`} tone="slate" />
                          <StatusPill label={`${reconciliation.totals.draftCount} draft`} tone="amber" />
                          <StatusPill label={`${reconciliation.totals.pendingCount} pending`} tone="blue" />
                          <StatusPill label={`${reconciliation.totals.releasedCount} released`} tone="brand" />
                          <StatusPill label={`${reconciliation.totals.revokedCount} revoked`} tone="rose" />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {reconciliation.totals.isMixedUnits ? (
                          <div className="space-y-1">
                            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-500">Mixed units</div>
                            {reconciliation.totals.amountBuckets.map((bucket) => (
                              <div key={`total-${bucket.unit}`} className="text-sm">
                                {formatAmount(bucket.totalAmount, bucket.unit)}
                              </div>
                            ))}
                          </div>
                        ) : reconciliation.totals.unit ? (
                          <div className="font-semibold text-slate-900">
                            {formatAmount(reconciliation.totals.totalAmount ?? 0, reconciliation.totals.unit)}
                          </div>
                        ) : (
                          <span className="text-slate-400">No amount rows</span>
                        )}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      <RewardActionDialog
        action={actionDialog}
        open={actionDialog != null}
        selectedCount={selectedRewards.length}
        eligibleCount={dialogEligibleRewards.length}
        skippedCount={selectedRewards.length - dialogEligibleRewards.length}
        note={actionNote}
        releaseReference={releaseReference}
        loading={actionLoading}
        onNoteChange={setActionNote}
        onReleaseReferenceChange={setReleaseReference}
        onCancel={() => {
          setActionDialog(null);
          setActionNote("");
          setReleaseReference("");
        }}
        onConfirm={() => { void submitAction(); }}
      />
    </div>
  );
}
