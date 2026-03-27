"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Building2,
  Layers3,
  Network,
  Target,
  Users2,
} from "lucide-react";
import {
  Breadcrumb,
  EmptyState,
  MetricCard,
  ScoreBadge,
  StatusPill,
} from "@/components/dashboard/shared";
import { PersonDetailSlideout } from "@/components/dashboard/unit/person-detail-slideout";
import { UnitMembersTable } from "@/components/dashboard/unit/unit-members-table";
import type {
  AttentionItems,
  CrossUnitComparison,
  DrillDownNode,
  OrgHierarchyUnit,
  PersonDetail,
  StageBottleneck,
  UnitMemberSummary,
} from "@/lib/kra-kpi/dashboard-service";
import type { ContributorRewardView } from "@/lib/kra-kpi/shared";
import type {
  DashboardOrgUnitRef,
  UserDashboardScope,
} from "@/lib/org-structure/scope-resolver";
import { CrossUnitHeatmap } from "./cross-unit-heatmap";
import { KraDetailTable } from "./kra-detail-table";
import { PeriodComparisonChart } from "./period-comparison-chart";
import { UnitChildrenTable } from "./unit-children-table";

type OrgPanelProps = {
  scope: UserDashboardScope;
  periodId: string;
};

type OrgView = "children" | "members" | "kra-detail" | "compare-units" | "compare-periods";

type DrillDownResponse = {
  selection: {
    entryRoots: DashboardOrgUnitRef[];
    currentNode: DashboardOrgUnitRef | null;
    breadcrumb: DashboardOrgUnitRef[];
    visibleChildren: DashboardOrgUnitRef[];
  };
  node: DrillDownNode;
};

const VIEW_OPTIONS: Array<{
  key: OrgView;
  label: string;
  description: string;
}> = [
  {
    key: "children",
    label: "Sub-Units",
    description: "Move deeper into the visible hierarchy branch.",
  },
  {
    key: "members",
    label: "Members",
    description: "Inspect people, allocations, stages, and scoped rewards.",
  },
  {
    key: "kra-detail",
    label: "KRA Detail",
    description: "Expand KRAs to compare KPI completion and score.",
  },
  {
    key: "compare-units",
    label: "Compare Units",
    description: "Compare sibling units or root entries side by side.",
  },
  {
    key: "compare-periods",
    label: "Compare Periods",
    description: "Track one scoped KPI across selected periods.",
  },
];

function buildOrgQuery(
  currentQuery: string,
  updates: {
    orgUnitId?: string | null;
    orgView?: OrgView | null;
    orgKpiId?: string | null;
    orgPeriods?: string[] | null;
  },
) {
  const params = new URLSearchParams(currentQuery);

  if ("orgUnitId" in updates) {
    if (updates.orgUnitId) {
      params.set("orgUnitId", updates.orgUnitId);
    } else {
      params.delete("orgUnitId");
    }
  }

  if ("orgView" in updates) {
    if (updates.orgView) {
      params.set("orgView", updates.orgView);
    } else {
      params.delete("orgView");
    }
  }

  if ("orgKpiId" in updates) {
    if (updates.orgKpiId) {
      params.set("orgKpiId", updates.orgKpiId);
    } else {
      params.delete("orgKpiId");
    }
  }

  if ("orgPeriods" in updates) {
    if (updates.orgPeriods && updates.orgPeriods.length > 0) {
      params.set("orgPeriods", updates.orgPeriods.join(","));
    } else {
      params.delete("orgPeriods");
    }
  }

  return params.toString();
}

export function OrgPanel({ scope, periodId }: OrgPanelProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamString = searchParams.toString();

  const requestedOrgUnitId = searchParams.get("orgUnitId");
  const requestedView = searchParams.get("orgView") as OrgView | null;
  const requestedKpiId = searchParams.get("orgKpiId") ?? "";
  const requestedPeriods = (searchParams.get("orgPeriods") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const requestedOrgUnitQuery = requestedOrgUnitId
    ? `&orgUnitId=${encodeURIComponent(requestedOrgUnitId)}`
    : "";

  const [summary, setSummary] = useState<DrillDownResponse | null>(null);
  const [attention, setAttention] = useState<AttentionItems | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [children, setChildren] = useState<OrgHierarchyUnit[]>([]);
  const [childrenLoading, setChildrenLoading] = useState(false);
  const [childrenError, setChildrenError] = useState<string | null>(null);

  const [members, setMembers] = useState<UnitMemberSummary[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);

  const [comparison, setComparison] = useState<CrossUnitComparison | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonError, setComparisonError] = useState<string | null>(null);

  const [selectedStageKpiId, setSelectedStageKpiId] = useState<string | null>(null);
  const [stageAnalysis, setStageAnalysis] = useState<StageBottleneck | null>(null);
  const [stageLoading, setStageLoading] = useState(false);
  const [stageError, setStageError] = useState<string | null>(null);

  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [personDetail, setPersonDetail] = useState<PersonDetail | null>(null);
  const [personRewards, setPersonRewards] = useState<ContributorRewardView[]>([]);
  const [personLoading, setPersonLoading] = useState(false);
  const [personError, setPersonError] = useState<string | null>(null);
  const [rewardLoading, setRewardLoading] = useState(false);
  const [rewardError, setRewardError] = useState<string | null>(null);

  const replaceOrgParams = useCallback((updates: {
    orgUnitId?: string | null;
    orgView?: OrgView | null;
    orgKpiId?: string | null;
    orgPeriods?: string[] | null;
  }) => {
    const query = buildOrgQuery(searchParamString, updates);
    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  }, [pathname, router, searchParamString]);

  useEffect(() => {
    let ignore = false;

    async function loadSummary() {
      setSummaryLoading(true);
      setSummaryError(null);

      try {
        const [summaryResponse, attentionResponse] = await Promise.all([
          fetch(
            `/api/tenant/kra-kpi/dashboard/drill-down?periodId=${encodeURIComponent(periodId)}${requestedOrgUnitId ? `&unitId=${encodeURIComponent(requestedOrgUnitId)}` : ""}`,
          ),
          fetch(
            `/api/tenant/kra-kpi/dashboard/attention?periodId=${encodeURIComponent(periodId)}${requestedOrgUnitId ? `&orgUnitId=${encodeURIComponent(requestedOrgUnitId)}` : ""}`,
          ),
        ]);

        const [summaryData, attentionData] = await Promise.all([
          summaryResponse.json() as Promise<DrillDownResponse | { message?: string }>,
          attentionResponse.json() as Promise<AttentionItems | { message?: string }>,
        ]);

        if (!summaryResponse.ok) {
          throw new Error("message" in summaryData ? summaryData.message ?? "Failed to load organization summary." : "Failed to load organization summary.");
        }

        if (!ignore) {
          setSummary(summaryData as DrillDownResponse);
          setAttention(attentionResponse.ok ? (attentionData as AttentionItems) : null);
        }
      } catch (loadError) {
        if (!ignore) {
          setSummary(null);
          setAttention(null);
          setSummaryError(
            loadError instanceof Error
              ? loadError.message
              : "Failed to load organization summary.",
          );
        }
      } finally {
        if (!ignore) {
          setSummaryLoading(false);
        }
      }
    }

    void loadSummary();
    return () => {
      ignore = true;
    };
  }, [periodId, requestedOrgUnitId]);

  useEffect(() => {
    if (!summary || requestedOrgUnitId || summary.selection.entryRoots.length !== 1) return;
    replaceOrgParams({ orgUnitId: summary.selection.entryRoots[0]!.unitId });
  }, [replaceOrgParams, requestedOrgUnitId, summary]);

  const hasNavigableChildren = (summary?.selection.visibleChildren.length ?? 0) > 0;
  const resolvedView: OrgView =
    requestedView && (requestedView !== "children" || hasNavigableChildren)
      ? requestedView
      : hasNavigableChildren
        ? "children"
        : "members";

  useEffect(() => {
    if (!requestedView || requestedView !== resolvedView) {
      replaceOrgParams({ orgView: resolvedView });
    }
  }, [replaceOrgParams, requestedView, resolvedView]);

  useEffect(() => {
    setSelectedPersonId(null);
    setPersonDetail(null);
    setPersonRewards([]);
    setPersonError(null);
    setRewardError(null);
  }, [periodId, requestedOrgUnitId]);

  useEffect(() => {
    if (!summary) {
      setSelectedStageKpiId(null);
      return;
    }
    const options = summary.node.stageKpiOptions;
    setSelectedStageKpiId((current) =>
      options.some((option) => option.kpiId === current)
        ? current
        : options[0]?.kpiId ?? null,
    );
  }, [summary]);

  useEffect(() => {
    if (resolvedView !== "children") return;
    let ignore = false;

    async function loadChildren() {
      setChildrenLoading(true);
      setChildrenError(null);

      try {
        const response = await fetch(
          `/api/tenant/kra-kpi/dashboard/org-hierarchy?periodId=${encodeURIComponent(periodId)}${requestedOrgUnitId ? `&parentUnitId=${encodeURIComponent(requestedOrgUnitId)}` : ""}`,
        );
        const data = (await response.json()) as { units?: OrgHierarchyUnit[]; message?: string };
        if (!response.ok) {
          throw new Error(data.message ?? "Failed to load child units.");
        }
        if (!ignore) {
          setChildren(data.units ?? []);
        }
      } catch (loadError) {
        if (!ignore) {
          setChildren([]);
          setChildrenError(
            loadError instanceof Error ? loadError.message : "Failed to load child units.",
          );
        }
      } finally {
        if (!ignore) {
          setChildrenLoading(false);
        }
      }
    }

    void loadChildren();
    return () => {
      ignore = true;
    };
  }, [periodId, requestedOrgUnitId, resolvedView]);

  useEffect(() => {
    if (resolvedView !== "members") return;
    let ignore = false;

    async function loadMembers() {
      setMembersLoading(true);
      setMembersError(null);

      try {
        const response = await fetch(
          `/api/tenant/kra-kpi/dashboard/org-members?periodId=${encodeURIComponent(periodId)}${requestedOrgUnitId ? `&unitId=${encodeURIComponent(requestedOrgUnitId)}` : ""}`,
        );
        const data = (await response.json()) as { members?: UnitMemberSummary[]; message?: string };
        if (!response.ok) {
          throw new Error(data.message ?? "Failed to load members.");
        }
        if (!ignore) {
          setMembers(data.members ?? []);
        }
      } catch (loadError) {
        if (!ignore) {
          setMembers([]);
          setMembersError(
            loadError instanceof Error ? loadError.message : "Failed to load members.",
          );
        }
      } finally {
        if (!ignore) {
          setMembersLoading(false);
        }
      }
    }

    void loadMembers();
    return () => {
      ignore = true;
    };
  }, [periodId, requestedOrgUnitId, resolvedView]);

  useEffect(() => {
    if (resolvedView !== "compare-units") return;
    let ignore = false;

    async function loadComparison() {
      setComparisonLoading(true);
      setComparisonError(null);

      try {
        const response = await fetch(
          `/api/tenant/kra-kpi/dashboard/cross-unit?periodId=${encodeURIComponent(periodId)}${requestedOrgUnitId ? `&parentUnitId=${encodeURIComponent(requestedOrgUnitId)}` : ""}`,
        );
        const data = (await response.json()) as CrossUnitComparison | { message?: string };
        if (!response.ok) {
          throw new Error("message" in data ? data.message ?? "Failed to compare units." : "Failed to compare units.");
        }
        if (!ignore) {
          setComparison(data as CrossUnitComparison);
        }
      } catch (loadError) {
        if (!ignore) {
          setComparison(null);
          setComparisonError(
            loadError instanceof Error ? loadError.message : "Failed to compare units.",
          );
        }
      } finally {
        if (!ignore) {
          setComparisonLoading(false);
        }
      }
    }

    void loadComparison();
    return () => {
      ignore = true;
    };
  }, [periodId, requestedOrgUnitId, resolvedView]);

  useEffect(() => {
    const stageKpiId = selectedStageKpiId;
    if (!stageKpiId) {
      setStageAnalysis(null);
      return;
    }
    const stageAnalysisUrl = `/api/tenant/kra-kpi/dashboard/stage-bottleneck?periodId=${encodeURIComponent(periodId)}&kpiId=${encodeURIComponent(stageKpiId)}${requestedOrgUnitQuery}`;

    let ignore = false;

    async function loadStageAnalysis() {
      setStageLoading(true);
      setStageError(null);

      try {
        const response = await fetch(stageAnalysisUrl);
        const data = (await response.json()) as StageBottleneck | { message?: string };
        if (!response.ok) {
          throw new Error("message" in data ? data.message ?? "Failed to load stage bottleneck." : "Failed to load stage bottleneck.");
        }
        if (!ignore) {
          setStageAnalysis(data as StageBottleneck);
        }
      } catch (loadError) {
        if (!ignore) {
          setStageAnalysis(null);
          setStageError(
            loadError instanceof Error
              ? loadError.message
              : "Failed to load stage bottleneck.",
          );
        }
      } finally {
        if (!ignore) {
          setStageLoading(false);
        }
      }
    }

    void loadStageAnalysis();
    return () => {
      ignore = true;
    };
  }, [periodId, requestedOrgUnitId, requestedOrgUnitQuery, selectedStageKpiId]);

  useEffect(() => {
    const personId = selectedPersonId;
    if (!personId) return;
    const personUrl = `/api/tenant/kra-kpi/dashboard/person?periodId=${encodeURIComponent(periodId)}&userId=${encodeURIComponent(personId)}${requestedOrgUnitQuery}`;
    const rewardsUrl = `/api/tenant/kra-kpi/dashboard/person-rewards?periodId=${encodeURIComponent(periodId)}&userId=${encodeURIComponent(personId)}${requestedOrgUnitQuery}`;
    let ignore = false;

    async function loadPerson() {
      setPersonLoading(true);
      setRewardLoading(true);
      setPersonError(null);
      setRewardError(null);

      try {
        const [personResponse, rewardsResponse] = await Promise.all([
          fetch(personUrl),
          fetch(rewardsUrl),
        ]);
        const [personData, rewardsData] = await Promise.all([
          personResponse.json() as Promise<PersonDetail | { message?: string }>,
          rewardsResponse.json() as Promise<{ rewards?: ContributorRewardView[]; message?: string }>,
        ]);

        if (!personResponse.ok) {
          throw new Error("message" in personData ? personData.message ?? "Failed to load member detail." : "Failed to load member detail.");
        }

        if (!ignore) {
          setPersonDetail(personData as PersonDetail);
          setPersonRewards(rewardsResponse.ok ? rewardsData.rewards ?? [] : []);
          if (!rewardsResponse.ok) {
            setRewardError(rewardsData.message ?? "Failed to load scoped rewards.");
          }
        }
      } catch (loadError) {
        if (!ignore) {
          setPersonDetail(null);
          setPersonRewards([]);
          setPersonError(
            loadError instanceof Error ? loadError.message : "Failed to load member detail.",
          );
        }
      } finally {
        if (!ignore) {
          setPersonLoading(false);
          setRewardLoading(false);
        }
      }
    }

    void loadPerson();
    return () => {
      ignore = true;
    };
  }, [periodId, requestedOrgUnitId, requestedOrgUnitQuery, selectedPersonId]);

  const sortedMembers = useMemo(
    () =>
      [...members].sort((left, right) => {
        if (left.overallScore !== right.overallScore) {
          return left.overallScore - right.overallScore;
        }
        if (left.overdueCount !== right.overdueCount) {
          return right.overdueCount - left.overdueCount;
        }
        return left.userName.localeCompare(right.userName);
      }),
    [members],
  );

  const comparisonKpiOptions = useMemo(
    () =>
      summary?.node.kraBreakdown.flatMap((kra) =>
        kra.kpis.map((kpi) => ({
          sourceKpiId: kpi.sourceKpiId,
          kraTitle: kra.kraTitle,
          kpiTitle: kpi.kpiTitle,
        })),
      ) ?? [],
    [summary],
  );

  useEffect(() => {
    if (resolvedView !== "compare-periods") return;
    if (comparisonKpiOptions.length === 0) {
      if (requestedKpiId) {
        replaceOrgParams({ orgKpiId: null });
      }
      return;
    }
    if (!comparisonKpiOptions.some((kpi) => kpi.sourceKpiId === requestedKpiId)) {
      replaceOrgParams({ orgKpiId: comparisonKpiOptions[0]!.sourceKpiId });
    }
  }, [comparisonKpiOptions, replaceOrgParams, requestedKpiId, resolvedView]);

  const attentionCards = [
    {
      label: "Overdue Achievements",
      value: attention?.overdueAchievements ?? 0,
      tone: (attention?.overdueAchievements ?? 0) > 0 ? "rose" : "slate",
    },
    {
      label: "Zero Progress",
      value: attention?.zeroProgressEmployees ?? 0,
      tone: (attention?.zeroProgressEmployees ?? 0) > 0 ? "amber" : "slate",
    },
    {
      label: "Stale Reviews",
      value: attention?.stalePendingReviews ?? 0,
      tone: (attention?.stalePendingReviews ?? 0) > 0 ? "amber" : "slate",
    },
    {
      label: "Low Completion KPIs",
      value: attention?.lowCompletionKpis.length ?? 0,
      tone: (attention?.lowCompletionKpis.length ?? 0) > 0 ? "rose" : "slate",
    },
  ] as const;

  if (summaryError) {
    return (
      <EmptyState
        icon={<AlertTriangle className="h-8 w-8" />}
        title="Could not load organization workspace"
        description={summaryError}
      />
    );
  }

  if (!summary && summaryLoading) {
    return (
      <div className="space-y-4">
        <div className="h-40 animate-pulse rounded-[1.75rem] bg-slate-100" />
        <div className="h-48 animate-pulse rounded-[1.75rem] bg-slate-100" />
      </div>
    );
  }

  if (!summary) {
    return (
      <EmptyState
        icon={<Network className="h-8 w-8" />}
        title="Organization workspace unavailable"
        description="No organization drill-down scope is currently available for this user."
      />
    );
  }

  return (
    <div className="space-y-6">
      <section className="glass-panel rounded-[1.75rem] border border-slate-200/80 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="section-title text-xs text-slate-400">Organization Workspace</div>
            <h3 className="mt-3 text-lg font-semibold text-slate-900">
              {summary.node.unitName}
            </h3>
            <p className="mt-2 text-sm text-slate-500">
              {scope.isTenantAdmin
                ? "Tenant-wide hierarchy drill-down with scoped comparisons and adaptive KPI analytics."
                : "Hierarchy drill-down stays constrained to the descendant units you currently govern."}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <StatusPill
                label={`${summary.selection.entryRoots.length} root entry points`}
                tone="blue"
              />
              <StatusPill
                label={`${summary.node.navigableChildCount} visible children`}
                tone="brand"
              />
              <StatusPill
                label={`${summary.node.stageKpiOptions.length} staged KPIs`}
                tone="slate"
              />
            </div>
          </div>
          {summary.node.unitId ? <ScoreBadge score={summary.node.averageScore} size="sm" /> : null}
        </div>

        <div className="mt-5">
          <Breadcrumb
            items={[
              {
                label: "All visible units",
                onClick: summary.selection.currentNode ? () => replaceOrgParams({ orgUnitId: null }) : undefined,
              },
              ...summary.selection.breadcrumb.map((item, index) => ({
                label: item.unitName,
                onClick:
                  index < summary.selection.breadcrumb.length - 1
                    ? () => replaceOrgParams({ orgUnitId: item.unitId })
                    : undefined,
              })),
            ]}
          />
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label="Members"
          value={summary.node.memberCount}
          description="Primary members plus allocation-only assignees inside this node."
          tone="brand"
          loading={summaryLoading}
          icon={<Users2 className="h-4 w-4" />}
        />
        <MetricCard
          label="Allocations"
          value={summary.node.totalAllocations}
          description="Current period KPI allocations in the selected node scope."
          tone="blue"
          loading={summaryLoading}
          icon={<Target className="h-4 w-4" />}
        />
        <MetricCard
          label="Completion"
          value={`${summary.node.completionPercent}%`}
          description="Verified completion rate across the selected hierarchy node."
          tone="amber"
          loading={summaryLoading}
          icon={<Layers3 className="h-4 w-4" />}
        />
        <MetricCard
          label="Average Score"
          value={summary.node.averageScore}
          description="Stored scoring only, without re-running KPI calculations."
          tone="brand"
          loading={summaryLoading}
          icon={<Building2 className="h-4 w-4" />}
        />
        <MetricCard
          label="Overdue"
          value={summary.node.overdueCount}
          description="Past-deadline allocations inside this node scope."
          tone={summary.node.overdueCount > 0 ? "rose" : "slate"}
          loading={summaryLoading}
          icon={<AlertTriangle className="h-4 w-4" />}
        />
      </section>

      <section className="glass-panel rounded-[1.75rem] border border-slate-200/80 p-5">
        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div>
            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Attention
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {attentionCards.map((card) => (
                <div
                  key={card.label}
                  className="rounded-[1.25rem] border border-slate-200/80 bg-white/80 px-4 py-4"
                >
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                    {card.label}
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-slate-900">
                    {card.value}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Stage Focus
            </div>
            {summary.node.stageKpiOptions.length === 0 ? (
              <EmptyState
                title="No staged KPIs"
                description="Stage bottleneck analysis appears when the current node has staged KPI allocations."
              />
            ) : (
              <div className="space-y-3">
                <select
                  value={selectedStageKpiId ?? ""}
                  onChange={(event) => setSelectedStageKpiId(event.target.value)}
                  className="w-full rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15"
                >
                  {summary.node.stageKpiOptions.map((option) => (
                    <option key={option.kpiId} value={option.kpiId}>
                      {option.kraTitle} | {option.kpiTitle}
                    </option>
                  ))}
                </select>
                {stageError ? (
                  <div className="rounded-[1.25rem] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                    {stageError}
                  </div>
                ) : stageLoading ? (
                  <div className="h-24 animate-pulse rounded-[1.25rem] bg-slate-100" />
                ) : stageAnalysis ? (
                  <div className="space-y-2">
                    {stageAnalysis.stages.map((stage) => (
                      <div
                        key={`${stageAnalysis.kpiTitle}-${stage.stageOrder}`}
                        className="rounded-[1.25rem] border border-slate-200/80 bg-white/85 px-4 py-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="font-medium text-slate-900">
                            {stage.stageOrder}. {stage.title}
                          </div>
                          <StatusPill
                            label={`${stage.completedCount}/${stage.totalAssigned}`}
                            tone="blue"
                          />
                        </div>
                        <div className="mt-2 text-sm text-slate-500">
                          {stage.completionPercent}% completion
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="glass-panel rounded-[1.75rem] border border-slate-200/80 p-5">
        <div className="flex flex-wrap gap-2">
          {VIEW_OPTIONS.filter((view) => view.key !== "children" || hasNavigableChildren).map((view) => (
            <button
              key={view.key}
              type="button"
              onClick={() => replaceOrgParams({ orgView: view.key })}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                resolvedView === view.key
                  ? "bg-slate-900 text-white"
                  : "border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900"
              }`}
            >
              {view.label}
            </button>
          ))}
        </div>
        <p className="mt-3 text-sm text-slate-500">
          {VIEW_OPTIONS.find((view) => view.key === resolvedView)?.description}
        </p>
      </section>

      {resolvedView === "children" ? (
        childrenError ? (
          <EmptyState
            title="Could not load sub-units"
            description={childrenError}
          />
        ) : (
          <UnitChildrenTable
            units={children}
            loading={childrenLoading}
            onDrillDown={(unitId) => replaceOrgParams({ orgUnitId: unitId, orgView: null })}
          />
        )
      ) : null}

      {resolvedView === "members" ? (
        membersError ? (
          <EmptyState
            title="Could not load members"
            description={membersError}
          />
        ) : (
          <UnitMembersTable
            members={sortedMembers}
            loading={membersLoading}
            showPrimaryUnitColumn={(summary.selection.currentNode == null) || summary.node.navigableChildCount > 0}
            onSelectMember={(member) => setSelectedPersonId(member.userId)}
          />
        )
      ) : null}

      {resolvedView === "kra-detail" ? (
        <KraDetailTable kraBreakdown={summary.node.kraBreakdown} />
      ) : null}

      {resolvedView === "compare-units" ? (
        comparisonError ? (
          <EmptyState
            title="Could not compare units"
            description={comparisonError}
          />
        ) : (
          <CrossUnitHeatmap comparison={comparison} loading={comparisonLoading} />
        )
      ) : null}

      {resolvedView === "compare-periods" ? (
        <PeriodComparisonChart
          periodId={periodId}
          orgUnitId={requestedOrgUnitId}
          kpiOptions={comparisonKpiOptions}
          selectedSourceKpiId={requestedKpiId}
          selectedPeriodIds={requestedPeriods}
          onSourceKpiChange={(orgKpiId) => replaceOrgParams({ orgKpiId })}
          onSelectedPeriodIdsChange={(orgPeriods) => replaceOrgParams({ orgPeriods })}
        />
      ) : null}

      <PersonDetailSlideout
        open={Boolean(selectedPersonId)}
        onClose={() => setSelectedPersonId(null)}
        person={personDetail}
        rewards={personRewards}
        loading={personLoading}
        rewardLoading={rewardLoading}
        error={personError}
        rewardError={rewardError}
      />
    </div>
  );
}
