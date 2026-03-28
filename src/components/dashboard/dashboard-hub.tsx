"use client";

import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import {
  BellRing,
  Building2,
  CheckCircle2,
  ClipboardList,
  Clock3,
  ExternalLink,
  Layers3,
  Network,
  Search,
  Wallet,
} from "lucide-react";
import { ContributorPanel } from "@/components/dashboard/contributor/contributor-panel";
import { OrgPanel } from "@/components/dashboard/org/org-panel";
import { RewardPanel } from "@/components/dashboard/rewards/reward-panel";
import { ReviewerPanel } from "@/components/dashboard/reviewer/reviewer-panel";
import { UnitPanel } from "@/components/dashboard/unit/unit-panel";
import {
  ConfirmDialog,
  DataTable,
  EmptyState,
  ExportButton,
  FilterBar,
  MetricCard,
  OrientationBanner,
  PeriodSelector,
  SkeletonCard,
  StatusPill,
  formatStateLabel,
  resolveDefaultPeriodId,
} from "@/components/dashboard/shared";
import { cn } from "@/lib/utils";
import type {
  MyDashboardSummary,
  ReviewQueueItem,
  StoredReviewCycleView,
} from "@/lib/kra-kpi/shared";
import type { UserDashboardScope } from "@/lib/org-structure/scope-resolver";

type DashboardHubProps = {
  scope: UserDashboardScope;
};

type DashboardTab = "my-kpis" | "reviews" | "unit" | "org" | "rewards" | "notifications";

type PeriodOption = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  state: string;
};

type NotificationItem = {
  id: string;
  type: string;
  title: string;
  message: string;
  linkUrl: string | null;
  isRead: boolean;
  createdAt: string;
};

type NotificationFilters = {
  status: string;
  type: string;
  receivedFrom: string;
  receivedTo: string;
};

const NOTIFICATION_FILTERS: NotificationFilters = {
  status: "",
  type: "",
  receivedFrom: "",
  receivedTo: "",
};

const TAB_META: Array<{
  key: DashboardTab;
  label: string;
  description: string;
  icon: React.ElementType;
}> = [
  {
    key: "my-kpis",
    label: "My KPIs",
    description: "Track score, deadlines, and KRA mix for the selected period.",
    icon: ClipboardList,
  },
  {
    key: "reviews",
    label: "My Reviews",
    description: "Triage the submissions currently waiting on your recommendation or verification.",
    icon: CheckCircle2,
  },
  {
    key: "unit",
    label: "My Unit",
    description: "Monitor your operational units with fast drill-down and completion context.",
    icon: Building2,
  },
  {
    key: "org",
    label: "Organization",
    description: "Compare units, see attention hotspots, and inspect bottlenecks in context.",
    icon: Network,
  },
  {
    key: "rewards",
    label: "Rewards",
    description: "Review incentive operations where your current access level allows it.",
    icon: Wallet,
  },
  {
    key: "notifications",
    label: "Notifications",
    description: "Filter workflow activity and jump straight into the linked work items.",
    icon: BellRing,
  },
];

export function DashboardHub({ scope }: DashboardHubProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamString = searchParams.toString();

  const [periods, setPeriods] = useState<PeriodOption[]>([]);
  const [periodLoading, setPeriodLoading] = useState(true);
  const [reviewBadge, setReviewBadge] = useState(0);
  const [notificationBadge, setNotificationBadge] = useState(0);

  const [summary, setSummary] = useState<MyDashboardSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [currentCycle, setCurrentCycle] = useState<StoredReviewCycleView | null>(null);

  const [reviewQueue, setReviewQueue] = useState<ReviewQueueItem[]>([]);
  const [reviewLoading, setReviewLoading] = useState(false);

  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notificationTotal, setNotificationTotal] = useState(0);
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [notificationFilters, setNotificationFilters] =
    useState<NotificationFilters>(NOTIFICATION_FILTERS);
  const [notificationSearch, setNotificationSearch] = useState("");
  const [showMarkAllReadConfirm, setShowMarkAllReadConfirm] = useState(false);
  const [markAllLoading, setMarkAllLoading] = useState(false);

  const deferredNotificationSearch = useDeferredValue(notificationSearch);

  const visibleTabs = useMemo(() => {
    return TAB_META.filter((tab) => {
      if (tab.key === "reviews" || tab.key === "unit") {
        return scope.headOfUnits.length > 0;
      }
      if (tab.key === "org") {
        return (
          scope.isTenantAdmin
          || scope.headOfUnits.some(
            (unit) => unit.scope === "DESCENDANTS" && unit.hasChildUnits,
          )
        );
      }
      if (tab.key === "rewards") {
        return scope.hasApprovalAuthority || scope.isTenantAdmin;
      }
      return true;
    });
  }, [scope.hasApprovalAuthority, scope.headOfUnits, scope.isTenantAdmin]);

  const requestedTab = searchParams.get("tab") as DashboardTab | null;
  const activeTab =
    visibleTabs.find((tab) => tab.key === requestedTab)?.key ?? visibleTabs[0]?.key ?? "my-kpis";

  const requestedPeriodId = searchParams.get("periodId");
  const selectedPeriodId = useMemo(() => {
    if (requestedPeriodId && periods.some((period) => period.id === requestedPeriodId)) {
      return requestedPeriodId;
    }
    return resolveDefaultPeriodId(periods);
  }, [periods, requestedPeriodId]);

  const activePeriod = periods.find((period) => period.id === selectedPeriodId) ?? null;

  useEffect(() => {
    let ignore = false;

    async function loadPeriods() {
      setPeriodLoading(true);

      try {
        const response = await fetch("/api/tenant/kra-kpi/periods");
        if (!response.ok) return;
        const data = (await response.json()) as PeriodOption[];
        if (!ignore) {
          setPeriods(data.filter((period) => period.state !== "DRAFT"));
        }
      } finally {
        if (!ignore) setPeriodLoading(false);
      }
    }

    void loadPeriods();

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (periods.length === 0 && !requestedTab) return;

    const params = new URLSearchParams(searchParamString);
    let changed = false;

    if (params.get("tab") !== activeTab) {
      params.set("tab", activeTab);
      changed = true;
    }

    if (selectedPeriodId && params.get("periodId") !== selectedPeriodId) {
      params.set("periodId", selectedPeriodId);
      changed = true;
    }

    if (changed) {
      startTransition(() => {
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      });
    }
  }, [activeTab, pathname, periods.length, requestedTab, router, searchParamString, selectedPeriodId]);

  useEffect(() => {
  }, [selectedPeriodId]);

  useEffect(() => {
    let ignore = false;

    async function refreshBadges() {
      const queries: Array<Promise<Response>> = [fetch("/api/tenant/notifications/count")];
      if (selectedPeriodId && visibleTabs.some((tab) => tab.key === "reviews")) {
        queries.push(
          fetch(`/api/tenant/kra-kpi/my/review-queue/count?periodId=${selectedPeriodId}`),
        );
      }

      const responses = await Promise.all(queries);
      const [notificationsResponse, reviewsResponse] = responses;

      if (!ignore && notificationsResponse?.ok) {
        const data = (await notificationsResponse.json()) as { count: number };
        setNotificationBadge(data.count);
      }

      if (!ignore && reviewsResponse?.ok) {
        const data = (await reviewsResponse.json()) as { count: number };
        setReviewBadge(data.count);
      } else if (!ignore && !selectedPeriodId) {
        setReviewBadge(0);
      }
    }

    void refreshBadges();

    return () => {
      ignore = true;
    };
  }, [selectedPeriodId, visibleTabs]);

  useEffect(() => {
    if (activeTab !== "my-kpis" || !selectedPeriodId) return;
    let ignore = false;

    async function loadMyDashboard() {
      setSummaryLoading(true);

      try {
        const [summaryResponse, cyclesResponse] = await Promise.all([
          fetch(`/api/tenant/kra-kpi/my/dashboard?periodId=${selectedPeriodId}`),
          fetch(`/api/tenant/kra-kpi/periods/${selectedPeriodId}/review-cycles`),
        ]);

        if (!ignore && summaryResponse.ok) {
          setSummary((await summaryResponse.json()) as MyDashboardSummary);
        }

        if (!ignore && cyclesResponse.ok) {
          const data = (await cyclesResponse.json()) as { cycles: StoredReviewCycleView[] };
          const cycles = data.cycles ?? [];
          setCurrentCycle(cycles.find((cycle) => cycle.isCurrent) ?? cycles[0] ?? null);
        }
      } finally {
        if (!ignore) setSummaryLoading(false);
      }
    }

    void loadMyDashboard();

    return () => {
      ignore = true;
    };
  }, [activeTab, selectedPeriodId]);

  useEffect(() => {
    if (activeTab !== "reviews" || !selectedPeriodId) return;
    let ignore = false;

    async function loadReviewQueue() {
      setReviewLoading(true);

      try {
        const response = await fetch(`/api/tenant/kra-kpi/my/review-queue?periodId=${selectedPeriodId}`);
        if (!ignore && response.ok) {
          setReviewQueue((await response.json()) as ReviewQueueItem[]);
        }
      } finally {
        if (!ignore) setReviewLoading(false);
      }
    }

    void loadReviewQueue();

    return () => {
      ignore = true;
    };
  }, [activeTab, selectedPeriodId]);

  useEffect(() => {
    if (activeTab !== "notifications") return;
    let ignore = false;

    async function loadNotifications() {
      setNotificationLoading(true);

      try {
        const response = await fetch("/api/tenant/notifications?limit=100&offset=0");
        if (!ignore && response.ok) {
          const data = (await response.json()) as {
            notifications: NotificationItem[];
            total: number;
            unreadCount: number;
          };
          setNotifications(data.notifications);
          setNotificationTotal(data.total);
          setNotificationBadge(data.unreadCount);
        }
      } finally {
        if (!ignore) setNotificationLoading(false);
      }
    }

    void loadNotifications();

    return () => {
      ignore = true;
    };
  }, [activeTab]);

  const filteredNotifications = useMemo(() => {
    const query = deferredNotificationSearch.trim().toLowerCase();

    return notifications.filter((notification) => {
      if (notificationFilters.status === "unread" && notification.isRead) return false;
      if (notificationFilters.status === "read" && !notification.isRead) return false;
      if (notificationFilters.type && notification.type !== notificationFilters.type) return false;

      const createdAt = new Date(notification.createdAt).getTime();
      if (notificationFilters.receivedFrom) {
        const from = new Date(notificationFilters.receivedFrom).getTime();
        if (createdAt < from) return false;
      }
      if (notificationFilters.receivedTo) {
        if (createdAt > new Date(notificationFilters.receivedTo).setHours(23, 59, 59, 999)) {
          return false;
        }
      }
      if (
        query &&
        ![notification.title, notification.message, formatStateLabel(notification.type)]
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(query))
      ) {
        return false;
      }
      return true;
    });
  }, [deferredNotificationSearch, notificationFilters, notifications]);

  const notificationSummary = useMemo(
    () => ({
      unread: notifications.filter((notification) => !notification.isRead).length,
      total: notificationTotal,
      withLinks: notifications.filter((notification) => Boolean(notification.linkUrl)).length,
      recent: notifications.filter((notification) => daysWaiting(notification.createdAt) <= 7).length,
    }),
    [notificationTotal, notifications],
  );

  const notificationTypes = useMemo(
    () =>
      [...new Set(notifications.map((notification) => notification.type))]
        .sort()
        .map((type) => ({ value: type, label: formatStateLabel(type) })),
    [notifications],
  );

  const notificationColumns = useMemo<ColumnDef<NotificationItem>[]>(
    () => [
      {
        header: "Notification",
        cell: ({ row }) => (
          <div>
            <div className="font-semibold text-slate-900">{row.original.title}</div>
            <div className="max-w-lg text-xs leading-6 text-slate-500">{row.original.message}</div>
          </div>
        ),
      },
      {
        header: "Type",
        cell: ({ row }) => <StatusPill state={row.original.type} />,
      },
      {
        header: "Received",
        cell: ({ row }) => (
          <div className="text-sm text-slate-600">
            <div>{formatDate(row.original.createdAt)}</div>
            <div className="text-xs text-slate-400">{formatRelative(row.original.createdAt)}</div>
          </div>
        ),
      },
      {
        header: "Status",
        cell: ({ row }) => (
          <StatusPill state={row.original.isRead ? "COMPLETED" : "PENDING"} />
        ),
      },
      {
        header: "Open",
        cell: ({ row }) =>
          row.original.linkUrl ? (
            <Link
              href={row.original.linkUrl}
              className="inline-flex items-center gap-1 text-sm font-semibold text-blue transition hover:text-blue/80"
            >
              Open
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          ) : (
            <span className="text-sm text-slate-400">No link</span>
          ),
      },
    ],
    [],
  );

  async function handleReviewCompleted() {
    if (!selectedPeriodId) return;

    const [queueResponse, countResponse] = await Promise.all([
      fetch(`/api/tenant/kra-kpi/my/review-queue?periodId=${selectedPeriodId}`),
      fetch(`/api/tenant/kra-kpi/my/review-queue/count?periodId=${selectedPeriodId}`),
    ]);

    if (queueResponse.ok) {
      setReviewQueue((await queueResponse.json()) as ReviewQueueItem[]);
    }
    if (countResponse.ok) {
      const data = (await countResponse.json()) as { count: number };
      setReviewBadge(data.count);
    }
  }

  async function openNotification(notification: NotificationItem) {
    if (!notification.isRead) {
      await fetch("/api/tenant/notifications/mark-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationId: notification.id }),
      });

      setNotifications((current) =>
        current.map((entry) =>
          entry.id === notification.id ? { ...entry, isRead: true } : entry,
        ),
      );
      setNotificationBadge((current) => Math.max(0, current - 1));
    }

    if (notification.linkUrl) {
      router.push(notification.linkUrl);
    }
  }

  async function markAllNotificationsRead() {
    setMarkAllLoading(true);

    try {
      await fetch("/api/tenant/notifications/mark-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      setNotifications((current) => current.map((entry) => ({ ...entry, isRead: true })));
      setNotificationBadge(0);
      setShowMarkAllReadConfirm(false);
    } finally {
      setMarkAllLoading(false);
    }
  }

  function updateQuery(updates: Partial<Record<"tab" | "periodId", string | null>>) {
    const params = new URLSearchParams(searchParamString);

    for (const [key, value] of Object.entries(updates)) {
      if (!value) params.delete(key);
      else params.set(key, value);
    }

    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  return (
    <div className="space-y-6">
      <OrientationBanner
        storageKey="kpi-dashboard-orientation"
        message="Use the period selector first, then move through the tabs from personal execution to team and organization views. The hub keeps badges and drill-down state lightweight so you can stay in context."
      />

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="glass-panel rounded-[1.75rem] border border-slate-200/80 p-5">
          <div className="section-title text-xs text-slate-400">Dashboard Scope</div>
          <h2 className="mt-3 text-xl font-semibold text-slate-900">
            Performance views adapt to your current authority.
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-500">
            Start with your own KPIs, then move outward into review, unit, and organization
            lenses only when those views are relevant to you.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <StatusPill
              label={scope.isTenantAdmin ? "Tenant Admin Scope" : "Personal Scope"}
              tone={scope.isTenantAdmin ? "brand" : "blue"}
            />
            {scope.headOfUnits.length > 0 ? (
              <StatusPill
                label={`${scope.headOfUnits.length} Head Unit${scope.headOfUnits.length > 1 ? "s" : ""}`}
                tone="blue"
              />
            ) : null}
            {scope.hasApprovalAuthority ? (
              <StatusPill label="Approval Authority" tone="amber" />
            ) : null}
            <StatusPill
              label={`${scope.memberOfUnits.length} Membership${scope.memberOfUnits.length === 1 ? "" : "s"}`}
              tone="slate"
            />
          </div>
        </div>

        <div className="glass-panel rounded-[1.75rem] border border-slate-200/80 p-5">
          <div className="section-title text-xs text-slate-400">Working Set</div>
          <h3 className="mt-3 text-lg font-semibold text-slate-900">
            {activePeriod?.name ?? "Choose a period"}
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            {activePeriod
              ? `${activePeriod.state} | ${formatDate(activePeriod.startDate)} - ${formatDate(activePeriod.endDate)}`
              : "Dashboard data loads against the selected assessment period."}
          </p>
          <div className="mt-5">
            <PeriodSelector
              periods={periods}
              selectedId={selectedPeriodId}
              onChange={(periodId) => updateQuery({ periodId })}
              className="w-full"
            />
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {visibleTabs.map((tab) => {
          const Icon = tab.icon;
          const badge =
            tab.key === "reviews"
              ? reviewBadge
              : tab.key === "notifications"
                ? notificationBadge
                : undefined;

          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => updateQuery({ tab: tab.key })}
              className={cn(
                "glass-panel rounded-[1.5rem] border border-slate-200/80 p-4 text-left transition hover:-translate-y-0.5",
                activeTab === tab.key
                  ? "border-blue/30 bg-white shadow-[0_18px_50px_rgba(37,99,235,0.08)]"
                  : "hover:border-slate-300",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <span
                  className={cn(
                    "flex h-11 w-11 items-center justify-center rounded-2xl",
                    activeTab === tab.key ? "bg-blue-soft text-blue" : "bg-slate-100 text-slate-500",
                  )}
                >
                  <Icon className="h-5 w-5" />
                </span>
                {badge && badge > 0 ? (
                  <span className="rounded-full bg-slate-950 px-2.5 py-1 text-xs font-semibold text-white">
                    {badge}
                  </span>
                ) : null}
              </div>
              <div className="mt-4">
                <div className="text-base font-semibold text-slate-900">{tab.label}</div>
                <p className="mt-1 text-sm leading-6 text-slate-500">{tab.description}</p>
              </div>
            </button>
          );
        })}
      </section>

      {periodLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SkeletonCard variant="metric" count={4} />
        </div>
      ) : null}

      {!periodLoading && activeTab === "my-kpis" && !selectedPeriodId ? (
        <EmptyState
          icon={<Layers3 className="h-8 w-8" />}
          title="No assessment period is ready yet"
          description="Create or open an assessment period to populate the KPI dashboard."
        />
      ) : null}

      {!periodLoading && activeTab === "my-kpis" && selectedPeriodId ? (
        <ContributorPanel
          periodId={selectedPeriodId}
          summary={summary}
          summaryLoading={summaryLoading}
          currentCycle={currentCycle}
        />
      ) : null}

      {!periodLoading && activeTab === "reviews" && !selectedPeriodId ? (
        <EmptyState
          icon={<CheckCircle2 className="h-8 w-8" />}
          title="Select a period to load review work"
          description="Review badges and queue items are tied to an assessment period."
        />
      ) : null}

      {!periodLoading && activeTab === "reviews" && selectedPeriodId ? (
        <ReviewerPanel
          scope={scope}
          reviewQueue={reviewQueue}
          reviewLoading={reviewLoading}
          onRefresh={() => handleReviewCompleted()}
        />
      ) : null}

      {activeTab === "notifications" ? (
        <div className="space-y-6">
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Unread"
              value={notificationSummary.unread}
              description="Unread items that still need attention."
              tone="blue"
              loading={notificationLoading}
              icon={<BellRing className="h-4 w-4" />}
            />
            <MetricCard
              label="Total"
              value={notificationSummary.total}
              description="Notifications currently loaded in the hub."
              tone="slate"
              loading={notificationLoading}
              icon={<Layers3 className="h-4 w-4" />}
            />
            <MetricCard
              label="Linked"
              value={notificationSummary.withLinks}
              description="Items that can open directly into a workflow."
              tone="brand"
              loading={notificationLoading}
              icon={<ExternalLink className="h-4 w-4" />}
            />
            <MetricCard
              label="Recent 7d"
              value={notificationSummary.recent}
              description="New activity over the last seven days."
              tone="amber"
              loading={notificationLoading}
              icon={<Clock3 className="h-4 w-4" />}
            />
          </section>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <FilterBar
              filters={[
                {
                  key: "status",
                  label: "Read State",
                  type: "select",
                  options: [
                    { value: "unread", label: "Unread" },
                    { value: "read", label: "Read" },
                  ],
                },
                {
                  key: "type",
                  label: "Notification Type",
                  type: "select",
                  options: notificationTypes,
                },
                {
                  key: "received",
                  label: "Received",
                  type: "date-range",
                },
              ]}
              active={notificationFilters}
              onChange={(key, value) =>
                setNotificationFilters((current) => ({ ...current, [key]: String(value) }))
              }
              onClear={() => setNotificationFilters(NOTIFICATION_FILTERS)}
            />
            <div className="flex flex-wrap items-center gap-3">
              <label className="glass-panel flex min-h-[72px] items-center gap-3 rounded-[1.5rem] border border-slate-200/80 px-4 py-3">
                <Search className="h-4 w-4 text-slate-400" />
                <input
                  value={notificationSearch}
                  onChange={(event) => setNotificationSearch(event.target.value)}
                  placeholder="Search title, message, or type"
                  className="w-full bg-transparent text-sm text-slate-700 outline-none"
                />
              </label>
              <ExportButton
                onClick={() =>
                  exportCsv("notifications.csv", [
                    ["Title", "Type", "Message", "Created At", "Read"],
                    ...filteredNotifications.map((item) => [
                      item.title,
                      item.type,
                      item.message,
                      formatDate(item.createdAt),
                      item.isRead ? "Yes" : "No",
                    ]),
                  ])
                }
              />
              <button
                type="button"
                onClick={() => setShowMarkAllReadConfirm(true)}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              >
                Mark all as read
              </button>
            </div>
          </div>

          <DataTable
            columns={notificationColumns}
            data={filteredNotifications}
            loading={notificationLoading}
            emptyState={{
              title: "No notifications match this view",
              description: "Adjust the filters or wait for the next workflow event.",
            }}
            onRowClick={openNotification}
            mobileCardRenderer={(row) => (
              <button
                type="button"
                onClick={() => openNotification(row)}
                className="w-full rounded-[1.5rem] border border-slate-200/80 bg-white/75 p-4 text-left"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-slate-900">{row.title}</div>
                    <div className="mt-1 text-sm leading-6 text-slate-500">{row.message}</div>
                  </div>
                  {!row.isRead ? <span className="h-2.5 w-2.5 rounded-full bg-blue" /> : null}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <StatusPill state={row.type} />
                  <StatusPill state={row.isRead ? "COMPLETED" : "PENDING"} />
                </div>
              </button>
            )}
          />
        </div>
      ) : null}

      {!periodLoading && activeTab === "unit" && !selectedPeriodId ? (
        <EmptyState
          icon={<Building2 className="h-8 w-8" />}
          title="Select a period to open your unit workspace"
          description="Member detail, KRA trends, and stage progress all depend on a selected assessment period."
        />
      ) : null}

      {!periodLoading && activeTab === "unit" && selectedPeriodId ? (
        <UnitPanel scope={scope} periodId={selectedPeriodId} />
      ) : null}

      {!periodLoading && activeTab === "org" && !selectedPeriodId ? (
        <EmptyState
          icon={<Network className="h-8 w-8" />}
          title="Select a period to open the organization view"
          description="Completion rates, hierarchy drill-down, and bottlenecks all depend on a selected assessment period."
        />
      ) : null}

      {!periodLoading && activeTab === "org" && selectedPeriodId ? (
        <OrgPanel scope={scope} periodId={selectedPeriodId} />
      ) : null}

      {activeTab === "rewards" ? (
        <div className="space-y-4">
          <div className="glass-panel rounded-[1.75rem] border border-slate-200/80 p-5">
            <h3 className="text-lg font-semibold text-slate-900">Reward operations</h3>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-500">
              {scope.isTenantAdmin
                ? "Review and transition rewards across the tenant with full access to every governed unit."
                : "Your reward actions are limited to units covered by your approval-authority assignments, including descendant units when your hierarchy scope allows it."}
            </p>
          </div>
          {selectedPeriodId ? <RewardPanel scope={scope} periodId={selectedPeriodId} /> : (
            <EmptyState
              icon={<Wallet className="h-8 w-8" />}
              title="Select a period to open reward operations"
              description="Pipeline actions and reconciliation stay period-specific so reward rows, totals, and exports remain auditable."
            />
          )}
        </div>
      ) : null}

      <ConfirmDialog
        open={showMarkAllReadConfirm}
        title="Mark all notifications as read?"
        description="This clears every unread notification currently loaded into the dashboard notification center."
        confirmLabel="Mark all as read"
        onConfirm={() => { void markAllNotificationsRead(); }}
        onCancel={() => setShowMarkAllReadConfirm(false)}
        loading={markAllLoading}
      />
    </div>
  );
}

function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatRelative(value: string | Date) {
  const days = daysWaiting(value);
  if (days <= 0) return "Today";
  if (days === 1) return "1 day ago";
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
}

function daysWaiting(value: string | Date) {
  const delta = Date.now() - new Date(value).getTime();
  return Math.max(0, Math.floor(delta / (1000 * 60 * 60 * 24)));
}

function exportCsv(filename: string, rows: Array<Array<string | number>>) {
  const content = rows
    .map((row) =>
      row
        .map((cell) => `"${String(cell).replaceAll('"', '""')}"`)
        .join(","),
    )
    .join("\n");

  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
