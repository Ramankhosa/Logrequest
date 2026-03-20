"use client";

import { useState, useEffect } from "react";
import {
  ClipboardList,
  CheckCircle2,
  LayoutDashboard,
  PlusCircle,
  Send,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  MyKpiContext,
  MyAllocationView,
  ReviewQueueItem,
  MyDashboardSummary,
} from "@/lib/kra-kpi/shared";
import { MyAllocationCard } from "@/components/my-kpis/my-allocation-card";
import { MyReviewItem } from "@/components/my-kpis/my-review-item";
import { MyDashboard } from "@/components/my-kpis/my-dashboard";
import { MyAchievementForm } from "@/components/my-kpis/my-achievement-form";
import { MyCascadeForm } from "@/components/my-kpis/my-cascade-form";
import { AdditionalAchievementsTab } from "@/components/my-kpis/additional-achievements-tab";
import { hasReviewRole } from "@/lib/kra-kpi/assignee-access";

type Tab = "targets" | "review" | "dashboard" | "additional";

const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: "targets", label: "My Targets", icon: ClipboardList },
  { key: "review", label: "Review Queue", icon: CheckCircle2 },
  { key: "dashboard", label: "My Dashboard", icon: LayoutDashboard },
  { key: "additional", label: "Additional Achievements", icon: PlusCircle },
];

type StatusFilter =
  | "all"
  | "notStarted"
  | "inProgress"
  | "pendingReview"
  | "completed"
  | "notApproved"
  | "needsCascade";

type DeadlineFilter = "all" | "overdue" | "dueSoon" | "upcoming" | "dueThisCycle";

export function MyKpiHub() {
  const [activeTab, setActiveTab] = useState<Tab>("targets");
  const [periods, setPeriods] = useState<{ id: string; name: string; state: string }[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const [ctx, setCtx] = useState<MyKpiContext | null>(null);
  const [allocations, setAllocations] = useState<MyAllocationView[]>([]);
  const [reviewQueue, setReviewQueue] = useState<ReviewQueueItem[]>([]);
  const [dashboardSummary, setDashboardSummary] = useState<MyDashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sourceDeptFilter, setSourceDeptFilter] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [categoryPillFilter, setCategoryPillFilter] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<string>("default");
  const [deadlineFilter, setDeadlineFilter] = useState<DeadlineFilter>("all");
  const [todayTs] = useState(() => Date.now());

  // Bulk submit state
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ submitted: number; failed: { id: string; reason: string }[] } | null>(null);

  // Achievement form state
  const [editingAllocation, setEditingAllocation] = useState<MyAllocationView | null>(null);
  const [cascadingAllocation, setCascadingAllocation] = useState<MyAllocationView | null>(null);

  useEffect(() => {
    async function fetchPeriods() {
      const res = await fetch("/api/tenant/kra-kpi/periods");
      if (res.ok) {
        const data = await res.json();
        const active = data.filter(
          (p: { state: string }) => p.state !== "DRAFT" && p.state !== "ARCHIVED"
        );
        setPeriods(active);
        if (active.length > 0) {
          const inProgress = active.find((p: { state: string }) => p.state === "IN_PROGRESS");
          setSelectedPeriodId(inProgress?.id ?? active[0].id);
        }
      }
      setLoading(false);
    }
    fetchPeriods();
  }, []);

  useEffect(() => {
    fetch("/api/tenant/kra-kpi/my/context")
      .then((r) => r.json())
      .then(setCtx)
      .catch(() => {});
  }, []);

  async function refreshData(periodId: string) {
    setLoading(true);

    const [allocRes, reviewRes, dashRes] = await Promise.all([
      fetch(`/api/tenant/kra-kpi/my/allocations?periodId=${periodId}`),
      fetch(`/api/tenant/kra-kpi/my/review-queue?periodId=${periodId}`),
      fetch(`/api/tenant/kra-kpi/my/dashboard?periodId=${periodId}`),
    ]);

    if (allocRes.ok) setAllocations(await allocRes.json());
    if (reviewRes.ok) setReviewQueue(await reviewRes.json());
    if (dashRes.ok) setDashboardSummary(await dashRes.json());

    setLoading(false);
  }

  async function handleBulkSubmit() {
    const draftIds = allocations
      .filter((a) => a.achievement?.state === "DRAFT")
      .map((a) => a.achievement!.id);
    if (draftIds.length === 0) return;

    setBulkSubmitting(true);
    setBulkResult(null);
    setShowBulkConfirm(false);

    try {
      const res = await fetch("/api/tenant/kra-kpi/my/bulk-submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ achievementIds: draftIds }),
      });
      const data = await res.json() as { submitted: number; failed: { id: string; reason: string }[] };
      setBulkResult(data);
      if (selectedPeriodId) {
        void refreshData(selectedPeriodId);
      }
    } catch {
      setBulkResult({ submitted: 0, failed: [{ id: "", reason: "Network error" }] });
    } finally {
      setBulkSubmitting(false);
    }
  }

  useEffect(() => {
    if (!selectedPeriodId) return;

    const timer = setTimeout(() => {
      void refreshData(selectedPeriodId);
    }, 0);

    return () => clearTimeout(timer);
  }, [selectedPeriodId]);

  const canReview = ctx ? hasReviewRole(ctx) : false;
  const visibleTabs = TABS.filter((tab) => canReview || tab.key !== "review");
  const effectiveActiveTab: Tab = (!canReview && activeTab === "review") ? "targets" : activeTab;
  const cycleInfo = allocations.length > 0
    ? getCurrentCycleInfo(allocations[0], todayTs)
    : null;

  // Derive filter options
  const sourceDepts = [...new Set(allocations.map((a) => a.startingUnitName))].sort();
  const categories = [...new Set(allocations.map((a) => a.categoryLabel).filter(Boolean))].sort();

  // Apply filters
  const filteredAllocations = allocations.filter((a) => {
    if (sourceDeptFilter && a.startingUnitName !== sourceDeptFilter) return false;
    if (categoryFilter && a.categoryLabel !== categoryFilter) return false;
    if (categoryPillFilter && a.categoryKey !== categoryPillFilter && a.categoryLabel !== categoryPillFilter) return false;
    if (deadlineFilter !== "all" && !matchesDeadlineFilter(a, deadlineFilter, todayTs, cycleInfo)) {
      return false;
    }

    if (statusFilter === "all") return true;
    const ach = a.achievement;
    switch (statusFilter) {
      case "notStarted": return !ach;
      case "inProgress": return ach?.state === "DRAFT";
      case "pendingReview": return ach?.state === "SUBMITTED" || ach?.state === "RECOMMENDED";
      case "completed": return ach?.state === "VERIFIED";
      case "notApproved": return ach?.state === "REJECTED";
      case "needsCascade":
        return a.section === "department" &&
          (a.allocationType === "INDIVIDUAL" || a.allocationType === "BOTH") &&
          a.childCount === 0;
      default: return true;
    }
  });

  // Sort
  const sortedAllocations = [...filteredAllocations].sort((a, b) => {
    if (sortBy === "weightageDesc") return b.kpiWeightage - a.kpiWeightage;
    if (sortBy === "weightageAsc") return a.kpiWeightage - b.kpiWeightage;
    if (a.kraTitle !== b.kraTitle) return a.kraTitle.localeCompare(b.kraTitle);
    if (a.kpiWeightage !== b.kpiWeightage) return b.kpiWeightage - a.kpiWeightage;
    return a.kpiTitle.localeCompare(b.kpiTitle);
  });

  // Group by section
  const deptAllocations = sortedAllocations.filter((a) => a.section === "department");
  const indivAllocations = sortedAllocations.filter((a) => a.section === "individual");

  // Filter counts
  const counts = {
    all: allocations.length,
    notStarted: allocations.filter((a) => !a.achievement).length,
    inProgress: allocations.filter((a) => a.achievement?.state === "DRAFT").length,
    pendingReview: allocations.filter(
      (a) => a.achievement?.state === "SUBMITTED" || a.achievement?.state === "RECOMMENDED"
    ).length,
    completed: allocations.filter((a) => a.achievement?.state === "VERIFIED").length,
    notApproved: allocations.filter((a) => a.achievement?.state === "REJECTED").length,
    needsCascade: allocations.filter(
      (a) =>
        a.section === "department" &&
        (a.allocationType === "INDIVIDUAL" || a.allocationType === "BOTH") &&
        a.childCount === 0
    ).length,
  };

  // Category pills
  const categoryPills = (() => {
    const map = new Map<string, { label: string; key: string; count: number }>();
    for (const a of allocations) {
      const key = a.categoryKey ?? a.categoryLabel ?? "";
      const label = a.categoryLabel ?? a.categoryKey ?? "Other";
      if (key) {
        const existing = map.get(key);
        if (existing) {
          existing.count++;
        } else {
          map.set(key, { label, key, count: 1 });
        }
      }
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
  })();

  // Draft achievements count for bulk submit
  const draftAchievementCount = allocations.filter((a) => a.achievement?.state === "DRAFT").length;

  // Selected period state
  const selectedPeriod = periods.find((p) => p.id === selectedPeriodId);

  const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "notStarted", label: "Not Started" },
    { key: "inProgress", label: "In Progress" },
    { key: "pendingReview", label: "Pending Review" },
    { key: "completed", label: "Completed" },
    { key: "notApproved", label: "Not Approved" },
    { key: "needsCascade", label: "Needs Cascade" },
  ];

  if (editingAllocation) {
    return (
      <MyAchievementForm
        allocation={editingAllocation}
        onDone={() => {
          setEditingAllocation(null);
          if (selectedPeriodId) {
            void refreshData(selectedPeriodId);
          }
        }}
        onCancel={() => setEditingAllocation(null)}
      />
    );
  }

  if (cascadingAllocation && ctx) {
    return (
      <MyCascadeForm
        allocation={cascadingAllocation}
        onDone={() => {
          setCascadingAllocation(null);
          if (selectedPeriodId) {
            void refreshData(selectedPeriodId);
          }
        }}
        onCancel={() => setCascadingAllocation(null)}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <div className="flex items-center gap-4 flex-wrap">
        <label className="text-sm font-medium text-gray-700">Period:</label>
        <select
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          value={selectedPeriodId ?? ""}
          onChange={(e) => setSelectedPeriodId(e.target.value || null)}
        >
          {periods.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.state})
            </option>
          ))}
        </select>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6">
          {visibleTabs.map((tab) => {
            const Icon = tab.icon;
            const badge = tab.key === "review" ? reviewQueue.length : undefined;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  "inline-flex items-center gap-2 border-b-2 py-3 px-1 text-sm font-medium transition-colors",
                  activeTab === tab.key
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
                )}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
                {badge !== undefined && badge > 0 && (
                  <span className="ml-1 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {loading && (
        <div className="py-12 text-center text-gray-500">Loading...</div>
      )}

      {!loading && effectiveActiveTab === "targets" && (
        <div className="space-y-4">
          {cycleInfo && (
            <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
              Current cycle: <span className="font-semibold">{cycleInfo.label}</span> (ends{" "}
              {cycleInfo.endLabel})
              {cycleInfo.daysRemaining != null && (
                <span className="ml-2 text-blue-700">
                  Next deadline: {cycleInfo.daysRemaining < 0 ? "Overdue" : `${cycleInfo.daysRemaining} days`}
                </span>
              )}
            </div>
          )}

          {/* Category Quick-Access Pills */}
          {categoryPills.length > 0 && (
            <div className="flex flex-wrap gap-2 items-center">
              <button
                onClick={() => setCategoryPillFilter(null)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  categoryPillFilter === null
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                )}
              >
                All ({allocations.length})
              </button>
              {categoryPills.map((pill) => (
                <button
                  key={pill.key}
                  onClick={() => setCategoryPillFilter(pill.key === categoryPillFilter ? null : pill.key)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                    categoryPillFilter === pill.key
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  )}
                >
                  {pill.label} ({pill.count})
                </button>
              ))}
            </div>
          )}

          {/* Bulk Submit Button */}
          {draftAchievementCount > 0 && (
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowBulkConfirm(true)}
                disabled={bulkSubmitting}
                className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-green-700 disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
                {bulkSubmitting ? "Submitting..." : `Submit All Drafts (${draftAchievementCount})`}
              </button>
              {bulkResult && (
                <span className={cn(
                  "text-sm",
                  bulkResult.failed.length > 0 ? "text-amber-700" : "text-green-700"
                )}>
                  {bulkResult.submitted} submitted
                  {bulkResult.failed.length > 0 && `, ${bulkResult.failed.length} failed`}
                </span>
              )}
            </div>
          )}

          {/* Bulk Submit Confirmation Dialog */}
          {showBulkConfirm && (
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-medium text-gray-900 mb-3">
                Submit {draftAchievementCount} draft achievement{draftAchievementCount !== 1 ? "s" : ""} for verification?
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => { void handleBulkSubmit(); }}
                  className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
                >
                  Yes, Submit All
                </button>
                <button
                  onClick={() => setShowBulkConfirm(false)}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="flex flex-wrap gap-2 items-center">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setStatusFilter(f.key)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  statusFilter === f.key
                    ? "bg-blue-100 text-blue-800"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                )}
              >
                {f.label}
                <span className="text-xs opacity-70">
                  ({counts[f.key]})
                </span>
              </button>
            ))}
          </div>

          {/* Secondary filters */}
          <div className="flex flex-wrap gap-3 items-center">
            {sourceDepts.length > 1 && (
              <select
                className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                value={sourceDeptFilter}
                onChange={(e) => setSourceDeptFilter(e.target.value)}
              >
                <option value="">All Sources</option>
                {sourceDepts.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            )}
            {categories.length > 1 && (
              <select
                className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="">All Categories</option>
                {categories.map((c) => (
                  <option key={c!} value={c!}>{c}</option>
                ))}
              </select>
            )}
            <select
              className="rounded-md border border-gray-300 px-2 py-1 text-xs"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
            >
              <option value="default">Sort: Default</option>
              <option value="weightageDesc">Highest Weightage</option>
              <option value="weightageAsc">Lowest Weightage</option>
            </select>
            <select
              className="rounded-md border border-gray-300 px-2 py-1 text-xs"
              value={deadlineFilter}
              onChange={(e) => setDeadlineFilter(e.target.value as DeadlineFilter)}
            >
              <option value="all">All Deadlines</option>
              <option value="overdue">Overdue</option>
              <option value="dueSoon">Due Soon</option>
              <option value="upcoming">Upcoming</option>
              <option value="dueThisCycle">Due This Cycle</option>
            </select>
          </div>

          {/* Allocations */}
          {sortedAllocations.length === 0 && (
            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 py-12 text-center">
              <p className="text-sm text-gray-500">
                {allocations.length === 0
                  ? "No KPIs have been allocated to you for this period."
                  : "No allocations match the current filters."}
              </p>
            </div>
          )}

          {deptAllocations.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                Department KPIs
              </h3>
              {renderAllocationsByKra(
                deptAllocations,
                ctx,
                selectedPeriodId,
                setEditingAllocation,
                setCascadingAllocation,
                refreshData,
              )}
            </div>
          )}

          {indivAllocations.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                My Individual KPIs
              </h3>
              {renderAllocationsByKra(
                indivAllocations,
                ctx,
                selectedPeriodId,
                setEditingAllocation,
                setCascadingAllocation,
                refreshData,
              )}
            </div>
          )}
        </div>
      )}

      {!loading && effectiveActiveTab === "review" && (
        <div className="space-y-4">
          {reviewQueue.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 py-12 text-center">
              <p className="text-sm text-gray-500">No items pending your review.</p>
            </div>
          ) : (
            reviewQueue.map((item) => (
              <MyReviewItem
                key={item.achievementId}
                item={item}
                onActionComplete={() => {
                  if (selectedPeriodId) {
                    void refreshData(selectedPeriodId);
                  }
                }}
              />
            ))
          )}
        </div>
      )}

      {!loading && effectiveActiveTab === "dashboard" && (
        <MyDashboard summary={dashboardSummary} />
      )}

      {!loading && effectiveActiveTab === "additional" && selectedPeriodId && (
        <AdditionalAchievementsTab
          periodId={selectedPeriodId}
          periodState={selectedPeriod?.state ?? ""}
          onRefresh={() => {
            if (selectedPeriodId) {
              void refreshData(selectedPeriodId);
            }
          }}
        />
      )}
    </div>
  );
}

function renderAllocationsByKra(
  allocations: MyAllocationView[],
  context: MyKpiContext | null,
  selectedPeriodId: string | null,
  setEditingAllocation: (allocation: MyAllocationView) => void,
  setCascadingAllocation: (allocation: MyAllocationView) => void,
  refreshData: (periodId: string) => Promise<void>,
) {
  const groups = new Map<string, MyAllocationView[]>();

  for (const allocation of allocations) {
    const key = allocation.kraTitle;
    const existing = groups.get(key) ?? [];
    existing.push(allocation);
    groups.set(key, existing);
  }

  return [...groups.entries()].map(([kraTitle, items]) => (
    <div key={kraTitle} className="space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{kraTitle}</h4>
      {items.map((allocation) => (
        <MyAllocationCard
          key={allocation.id}
          allocation={allocation}
          context={context}
          onRecordAchievement={() => setEditingAllocation(allocation)}
          onCascade={() => setCascadingAllocation(allocation)}
          onRefresh={() => {
            if (selectedPeriodId) {
              void refreshData(selectedPeriodId);
            }
          }}
        />
      ))}
    </div>
  ));
}

function getDaysUntilDeadline(deadline: Date | null, todayTs: number) {
  if (!deadline) return null;

  return Math.ceil((new Date(deadline).getTime() - todayTs) / (1000 * 60 * 60 * 24));
}

function getCurrentCycleInfo(allocation: MyAllocationView, todayTs: number) {
  if (allocation.reviewFrequency === "ANNUAL") {
    return null;
  }

  const start = new Date(allocation.periodStartDate);
  const end = new Date(allocation.periodEndDate);
  const today = new Date(todayTs);
  let cycleStart = new Date(start);
  let cycleIndex = 1;

  while (cycleStart < end) {
    const cycleEnd = advanceCycleEnd(cycleStart, allocation.reviewFrequency, end);
    const isCurrent =
      today >= cycleStart && (today < cycleEnd || today.getTime() === cycleEnd.getTime());

    if (isCurrent) {
      return {
        label: getCycleLabel(allocation.reviewFrequency, cycleIndex, cycleStart),
        endLabel: cycleEnd.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
        daysRemaining: getDaysUntilDeadline(allocation.achievementDeadline, todayTs),
      };
    }

    cycleStart = cycleEnd;
    cycleIndex += 1;
  }

  return null;
}

function matchesDeadlineFilter(
  allocation: MyAllocationView,
  filter: DeadlineFilter,
  todayTs: number,
  cycleInfo: ReturnType<typeof getCurrentCycleInfo>,
) {
  if (allocation.achievement?.state === "VERIFIED") {
    return false;
  }

  const days = getDaysUntilDeadline(allocation.achievementDeadline, todayTs);
  if (days == null) {
    return filter === "all";
  }

  if (filter === "overdue") return days < 0;
  if (filter === "dueSoon") return days >= 0 && days <= 14;
  if (filter === "upcoming") return days > 14;
  if (filter === "dueThisCycle") return cycleInfo != null;

  return true;
}

function advanceCycleEnd(start: Date, frequency: MyAllocationView["reviewFrequency"], maxEnd: Date) {
  const next = new Date(start);

  switch (frequency) {
    case "DAILY":
      next.setDate(next.getDate() + 1);
      break;
    case "WEEKLY":
      next.setDate(next.getDate() + 7);
      break;
    case "MONTHLY":
      next.setMonth(next.getMonth() + 1);
      break;
    case "QUARTERLY":
      next.setMonth(next.getMonth() + 3);
      break;
    case "HALF_YEARLY":
      next.setMonth(next.getMonth() + 6);
      break;
    case "ANNUAL":
    default:
      next.setFullYear(next.getFullYear() + 1);
      break;
  }

  return next > maxEnd ? new Date(maxEnd) : next;
}

function getCycleLabel(
  frequency: MyAllocationView["reviewFrequency"],
  index: number,
  start: Date,
) {
  switch (frequency) {
    case "MONTHLY":
      return start.toLocaleDateString("en-US", { month: "short", year: "numeric" });
    case "QUARTERLY":
      return `Q${index}`;
    case "HALF_YEARLY":
      return `H${index}`;
    case "WEEKLY":
      return `Week ${index}`;
    case "DAILY":
      return start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    case "ANNUAL":
    default:
      return `Cycle ${index}`;
  }
}
