"use client";

import {
  CompletionBar,
  EmptyState,
  ScoreBadge,
  SlideOver,
  StatusPill,
} from "@/components/dashboard/shared";
import type { PersonDetail } from "@/lib/kra-kpi/dashboard-service";
import type { ContributorRewardView } from "@/lib/kra-kpi/shared";

type PersonDetailSlideoutProps = {
  open: boolean;
  onClose: () => void;
  person: PersonDetail | null;
  rewards: ContributorRewardView[];
  loading?: boolean;
  rewardLoading?: boolean;
  error?: string | null;
  rewardError?: string | null;
};

function formatDate(value: Date | string | null) {
  if (!value) return "No deadline";
  return new Date(value).toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatAmount(reward: ContributorRewardView) {
  return `${reward.finalAmount.toFixed(2)} ${reward.benefitUnit}`;
}

function getStageTone(stage: { isCompleted: boolean; isOverdue: boolean }) {
  if (stage.isCompleted) return "brand";
  if (stage.isOverdue) return "rose";
  return "amber";
}

function getStageLabel(stage: { isCompleted: boolean; isOverdue: boolean }) {
  if (stage.isCompleted) return "Completed";
  if (stage.isOverdue) return "Overdue";
  return "Pending";
}

export function PersonDetailSlideout({
  open,
  onClose,
  person,
  rewards,
  loading = false,
  rewardLoading = false,
  error,
  rewardError,
}: PersonDetailSlideoutProps) {
  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title={person?.userName ?? "Member detail"}
      subtitle={
        person
          ? `${person.primaryUnitId ? person.unitName : "Unassigned"} | ${person.allocations.length} allocations`
          : "Allocation detail, stage progress, and scoped rewards."
      }
      width="lg"
    >
      {loading ? (
        <div className="space-y-4">
          <div className="h-24 animate-pulse rounded-[1.5rem] bg-slate-100" />
          <div className="h-40 animate-pulse rounded-[1.5rem] bg-slate-100" />
          <div className="h-32 animate-pulse rounded-[1.5rem] bg-slate-100" />
        </div>
      ) : error ? (
        <EmptyState
          title="Could not load member detail"
          description={error}
        />
      ) : !person ? (
        <EmptyState
          title="No member selected"
          description="Choose a member from the table to inspect allocations, stages, and rewards."
        />
      ) : (
        <div className="space-y-6">
          <section className="rounded-[1.5rem] border border-slate-200/80 bg-slate-50/70 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Member Snapshot
                </div>
                <div className="mt-2 text-lg font-semibold text-slate-900">{person.userName}</div>
                <div className="text-sm text-slate-500">
                  {person.primaryUnitId ? person.unitName : "Unassigned"}
                </div>
              </div>
              <ScoreBadge score={person.averageScore || person.overallScore} size="sm" />
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Overall Score
                </div>
                <div className="mt-2 text-2xl font-semibold text-slate-900">
                  {person.overallScore}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Average Score
                </div>
                <div className="mt-2 text-2xl font-semibold text-slate-900">
                  {person.averageScore}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Completion
                </div>
                <div className="mt-2">
                  <CompletionBar percent={person.overallCompletion} />
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Allocations</h3>
              <p className="text-sm text-slate-500">
                Targets stay measurement-aware so new KPI types do not require dashboard rewrites.
              </p>
            </div>
            {person.allocations.length === 0 ? (
              <EmptyState
                title="No scoped allocations"
                description="This member has no KPI allocations within the selected unit scope for the current period."
              />
            ) : (
              <div className="space-y-4">
                {person.allocations.map((allocation) => (
                  <article
                    key={allocation.allocationId}
                    className="rounded-[1.5rem] border border-slate-200/80 bg-white/80 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h4 className="font-semibold text-slate-900">{allocation.kpiTitle}</h4>
                        <div className="mt-1 flex flex-wrap gap-2">
                          <StatusPill state={allocation.state} />
                          {allocation.isOverdue ? (
                            <StatusPill label="Overdue" tone="rose" />
                          ) : null}
                          <StatusPill
                            label={allocation.measurementType.replaceAll("_", " ")}
                            tone="slate"
                          />
                        </div>
                      </div>
                      <ScoreBadge score={allocation.score} size="sm" />
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                          Target
                        </div>
                        <div className="mt-2 text-sm font-medium text-slate-900">
                          {allocation.targetDisplay}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                          Stages
                        </div>
                        <div className="mt-2 text-sm font-medium text-slate-900">
                          {allocation.stagesComplete}/{allocation.stagesTotal}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                          Completion
                        </div>
                        <div className="mt-2">
                          <CompletionBar percent={allocation.completionPercent} />
                        </div>
                      </div>
                    </div>

                    {allocation.stageRows.length > 0 ? (
                      <div className="mt-4 space-y-2">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                          Stage Progress
                        </div>
                        {allocation.stageRows.map((stage) => (
                          <div
                            key={stage.progressId}
                            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-3 py-3"
                          >
                            <div>
                              <div className="font-medium text-slate-900">
                                {stage.stageOrder}. {stage.title}
                              </div>
                              <div className="text-xs text-slate-500">
                                Deadline {formatDate(stage.deadline)}
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <StatusPill
                                label={getStageLabel(stage)}
                                tone={getStageTone(stage)}
                              />
                              <StatusPill label={`${stage.weight}%`} tone="slate" />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Rewards</h3>
              <p className="text-sm text-slate-500">
                Read-only reward visibility stays scoped to the selected unit.
              </p>
            </div>
            {rewardError ? (
              <div className="rounded-[1.25rem] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                {rewardError}
              </div>
            ) : null}
            {rewardLoading ? (
              <div className="h-24 animate-pulse rounded-[1.5rem] bg-slate-100" />
            ) : rewards.length === 0 ? (
              <EmptyState
                title="No scoped rewards"
                description="No reward rows are available for this member inside the selected unit scope."
              />
            ) : (
              <div className="space-y-3">
                {rewards.map((reward) => (
                  <article
                    key={reward.id}
                    className="rounded-[1.5rem] border border-slate-200/80 bg-white/80 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-slate-900">{reward.kpiTitle}</div>
                        <div className="text-sm text-slate-500">
                          {reward.benefitTypeName} | {reward.rewardComponentName}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-base font-semibold text-slate-900">
                          {formatAmount(reward)}
                        </div>
                        <div className="mt-1">
                          <StatusPill state={reward.state} />
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <StatusPill
                        label={reward.rewardOwnerUnitName ?? "No owner unit"}
                        tone="slate"
                      />
                      <StatusPill
                        label={reward.reporterUnitName ?? "No reporter unit"}
                        tone="blue"
                      />
                      <StatusPill
                        label={`Created ${formatDate(reward.createdAt)}`}
                        tone="slate"
                      />
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </SlideOver>
  );
}
