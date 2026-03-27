"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Search,
  Target,
  Users2,
} from "lucide-react";
import { MyReviewItem } from "@/components/my-kpis/my-review-item";
import {
  FilterBar,
  MetricCard,
  ScoreBadge,
  StatusPill,
} from "@/components/dashboard/shared";
import type { ReviewQueueItem } from "@/lib/kra-kpi/shared";
import type { UserDashboardScope } from "@/lib/org-structure/scope-resolver";
import { ReviewQueueTable } from "./review-queue-table";

type Props = {
  scope: UserDashboardScope;
  reviewQueue: ReviewQueueItem[];
  reviewLoading: boolean;
  onRefresh: () => Promise<void> | void;
};

type ReviewFilters = {
  unitId: string;
  stage: string;
  state: string;
};

const DEFAULT_FILTERS: ReviewFilters = {
  unitId: "",
  stage: "",
  state: "",
};

export function ReviewerPanel({
  scope,
  reviewQueue,
  reviewLoading,
  onRefresh,
}: Props) {
  const [filters, setFilters] = useState<ReviewFilters>(DEFAULT_FILTERS);
  const [search, setSearch] = useState("");
  const [selectedAchievementId, setSelectedAchievementId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search);

  useEffect(() => {
    if (reviewQueue.length === 0) {
      setSelectedAchievementId(null);
      return;
    }

    if (!selectedAchievementId || !reviewQueue.some((item) => item.achievementId === selectedAchievementId)) {
      setSelectedAchievementId(reviewQueue[0]!.achievementId);
    }
  }, [reviewQueue, selectedAchievementId]);

  const unitOptions = useMemo(
    () =>
      [...new Map(
        reviewQueue
          .filter((item) => item.reviewUnitId && item.reviewUnitName)
          .map((item) => [item.reviewUnitId!, { value: item.reviewUnitId!, label: item.reviewUnitName! }]),
      ).values()].sort((left, right) => left.label.localeCompare(right.label)),
    [reviewQueue],
  );

  const filteredQueue = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();

    return [...reviewQueue]
      .filter((item) => {
        if (filters.unitId && item.reviewUnitId !== filters.unitId) return false;
        if (filters.stage && item.reviewLevel !== filters.stage) return false;
        if (filters.state && item.achievementState !== filters.state) return false;

        if (
          query
          && ![
            item.facultyName,
            item.kpiTitle,
            item.reviewUnitName,
            item.targetDisplay,
            item.actualDisplay,
          ]
            .filter((value): value is string => Boolean(value))
            .some((value) => value.toLowerCase().includes(query))
        ) {
          return false;
        }

        return true;
      })
      .sort((left, right) => right.waitingDays - left.waitingDays);
  }, [deferredSearch, filters.stage, filters.state, filters.unitId, reviewQueue]);

  const selectedReview =
    reviewQueue.find((item) => item.achievementId === selectedAchievementId)
    ?? filteredQueue[0]
    ?? null;

  const reviewSummary = useMemo(
    () => ({
      pending: reviewQueue.length,
      recommend: reviewQueue.filter((item) => item.reviewLevel === "RECOMMEND").length,
      verify: reviewQueue.filter((item) => item.reviewLevel === "VERIFY").length,
      stale: reviewQueue.filter((item) => item.waitingDays > 7).length,
      critical: reviewQueue.filter((item) => item.waitingDays > 14).length,
    }),
    [reviewQueue],
  );

  async function handleActionComplete() {
    await onRefresh();
    setFeedback("Review queue refreshed.");
  }

  return (
    <div className="space-y-6">
      {feedback ? (
        <div className="rounded-[1.25rem] border border-brand/15 bg-brand-soft/75 px-4 py-3 text-sm font-medium text-brand">
          {feedback}
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label="Pending"
          value={reviewSummary.pending}
          description="All items waiting on you."
          tone="blue"
          loading={reviewLoading}
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
        <MetricCard
          label="Recommend"
          value={reviewSummary.recommend}
          description="Items in recommendation stage."
          tone="brand"
          loading={reviewLoading}
          icon={<Users2 className="h-4 w-4" />}
        />
        <MetricCard
          label="Verify"
          value={reviewSummary.verify}
          description="Items needing final verification."
          tone="blue"
          loading={reviewLoading}
          icon={<Target className="h-4 w-4" />}
        />
        <MetricCard
          label="Stale > 7d"
          value={reviewSummary.stale}
          description="Queue items drifting past the target review window."
          tone={reviewSummary.stale > 0 ? "amber" : "slate"}
          loading={reviewLoading}
          icon={<AlertTriangle className="h-4 w-4" />}
        />
        <MetricCard
          label="Critical > 14d"
          value={reviewSummary.critical}
          description="Items at highest production-risk delay."
          tone={reviewSummary.critical > 0 ? "rose" : "slate"}
          loading={reviewLoading}
          icon={<AlertTriangle className="h-4 w-4" />}
        />
      </section>

      <div className="grid gap-4 xl:grid-cols-[1fr_auto]">
        <FilterBar
          filters={[
            {
              key: "unitId",
              label: "Review Unit",
              type: "select",
              options: unitOptions,
            },
            {
              key: "stage",
              label: "Review Step",
              type: "select",
              options: [
                { value: "RECOMMEND", label: "Recommend" },
                { value: "VERIFY", label: "Verify" },
              ],
            },
            {
              key: "state",
              label: "Achievement State",
              type: "select",
              options: [
                { value: "SUBMITTED", label: "Submitted" },
                { value: "RECOMMENDED", label: "Recommended" },
              ],
            },
          ]}
          active={filters}
          onChange={(key, value) =>
            setFilters((current) => ({ ...current, [key]: String(value) }))
          }
          onClear={() => setFilters(DEFAULT_FILTERS)}
        />
        <label className="glass-panel flex min-h-[72px] items-center gap-3 rounded-[1.5rem] border border-slate-200/80 px-4 py-3">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search contributor, KPI, or measured values"
            className="w-full bg-transparent text-sm text-slate-700 outline-none"
          />
        </label>
      </div>

      <ReviewQueueTable
        scope={scope}
        items={filteredQueue}
        loading={reviewLoading}
        selectedAchievementId={selectedAchievementId}
        onSelect={(item) => {
          setSelectedAchievementId(item.achievementId);
          setFeedback(null);
        }}
      />

      {selectedReview ? (
        <div className="glass-panel rounded-[1.75rem] border border-slate-200/80 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="section-title text-xs text-slate-400">Inline Review Detail</div>
              <h3 className="mt-3 text-lg font-semibold text-slate-900">{selectedReview.kpiTitle}</h3>
              <p className="mt-1 text-sm text-slate-500">
                {selectedReview.facultyName}
                {selectedReview.reviewUnitName ? ` | ${selectedReview.reviewUnitName}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusPill state={selectedReview.achievementState} />
              <StatusPill
                label={selectedReview.reviewLevel === "RECOMMEND" ? "Recommend" : "Verify"}
                tone="blue"
              />
              <StatusPill label={`${selectedReview.waitingDays} days waiting`} tone={selectedReview.waitingDays > 14 ? "rose" : selectedReview.waitingDays > 7 ? "amber" : "blue"} />
              <ScoreBadge
                score={selectedReview.effectiveScore ?? selectedReview.stageCompletionScore ?? null}
                size="sm"
              />
            </div>
          </div>

          <div className="mt-4 grid gap-3 rounded-[1.5rem] border border-slate-200/80 bg-white/80 p-4 md:grid-cols-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Target</div>
              <div className="mt-2 text-base font-semibold text-slate-900">{selectedReview.targetDisplay}</div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Actual</div>
              <div className="mt-2 text-base font-semibold text-slate-900">{selectedReview.actualDisplay}</div>
            </div>
          </div>

          <div className="mt-4 rounded-[1.5rem] border border-slate-200/80 bg-white/80 p-4">
            <MyReviewItem item={selectedReview} onActionComplete={() => { void handleActionComplete(); }} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
