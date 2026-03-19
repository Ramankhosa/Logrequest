"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ClipboardList,
  CheckCircle2,
  LayoutDashboard,
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

type Tab = "targets" | "review" | "dashboard";

const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: "targets", label: "My Targets", icon: ClipboardList },
  { key: "review", label: "Review Queue", icon: CheckCircle2 },
  { key: "dashboard", label: "My Dashboard", icon: LayoutDashboard },
];

type StatusFilter =
  | "all"
  | "notStarted"
  | "inProgress"
  | "pendingReview"
  | "completed"
  | "notApproved"
  | "needsCascade";

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
  const [sortBy, setSortBy] = useState<string>("default");

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

  const refreshData = useCallback(async () => {
    if (!selectedPeriodId) return;
    setLoading(true);

    const [allocRes, reviewRes, dashRes] = await Promise.all([
      fetch(`/api/tenant/kra-kpi/my/allocations?periodId=${selectedPeriodId}`),
      fetch(`/api/tenant/kra-kpi/my/review-queue?periodId=${selectedPeriodId}`),
      fetch(`/api/tenant/kra-kpi/my/dashboard?periodId=${selectedPeriodId}`),
    ]);

    if (allocRes.ok) setAllocations(await allocRes.json());
    if (reviewRes.ok) setReviewQueue(await reviewRes.json());
    if (dashRes.ok) setDashboardSummary(await dashRes.json());

    setLoading(false);
  }, [selectedPeriodId]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  // Derive filter options
  const sourceDepts = [...new Set(allocations.map((a) => a.startingUnitName))].sort();
  const categories = [...new Set(allocations.map((a) => a.categoryLabel).filter(Boolean))].sort();

  // Apply filters
  const filteredAllocations = allocations.filter((a) => {
    if (sourceDeptFilter && a.startingUnitName !== sourceDeptFilter) return false;
    if (categoryFilter && a.categoryLabel !== categoryFilter) return false;

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
    return 0; // default: keep grouped by KRA
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
        onDone={() => { setEditingAllocation(null); refreshData(); }}
        onCancel={() => setEditingAllocation(null)}
      />
    );
  }

  if (cascadingAllocation && ctx) {
    return (
      <MyCascadeForm
        allocation={cascadingAllocation}
        context={ctx}
        onDone={() => { setCascadingAllocation(null); refreshData(); }}
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
          {TABS.map((tab) => {
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

      {!loading && activeTab === "targets" && (
        <div className="space-y-4">
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
              {deptAllocations.map((a) => (
                <MyAllocationCard
                  key={a.id}
                  allocation={a}
                  context={ctx}
                  onRecordAchievement={() => setEditingAllocation(a)}
                  onCascade={() => setCascadingAllocation(a)}
                  onRefresh={refreshData}
                />
              ))}
            </div>
          )}

          {indivAllocations.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                My Individual KPIs
              </h3>
              {indivAllocations.map((a) => (
                <MyAllocationCard
                  key={a.id}
                  allocation={a}
                  context={ctx}
                  onRecordAchievement={() => setEditingAllocation(a)}
                  onCascade={() => setCascadingAllocation(a)}
                  onRefresh={refreshData}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {!loading && activeTab === "review" && (
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
                onActionComplete={refreshData}
              />
            ))
          )}
        </div>
      )}

      {!loading && activeTab === "dashboard" && (
        <MyDashboard summary={dashboardSummary} />
      )}
    </div>
  );
}
