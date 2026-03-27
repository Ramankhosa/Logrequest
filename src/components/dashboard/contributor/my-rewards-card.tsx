"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Award, Clock3, RotateCcw, Wallet } from "lucide-react";
import {
  EmptyState,
  MetricCard,
  SkeletonCard,
  StatusPill,
} from "@/components/dashboard/shared";
import type { ContributorRewardStateView, MyRewardsView } from "@/lib/kra-kpi/shared";

type Props = {
  periodId: string;
};

const STATE_ORDER: ContributorRewardStateView[] = ["DRAFT", "PENDING", "RELEASED", "REVOKED"];

const STATE_META: Record<ContributorRewardStateView, {
  label: string;
  tone: "brand" | "blue" | "amber" | "rose" | "slate";
  icon: ReactNode;
}> = {
  DRAFT: {
    label: "Draft",
    tone: "slate",
    icon: <Clock3 className="h-4 w-4" />,
  },
  PENDING: {
    label: "Pending",
    tone: "amber",
    icon: <Wallet className="h-4 w-4" />,
  },
  RELEASED: {
    label: "Released",
    tone: "brand",
    icon: <Award className="h-4 w-4" />,
  },
  REVOKED: {
    label: "Revoked",
    tone: "rose",
    icon: <RotateCcw className="h-4 w-4" />,
  },
};

function formatAmount(amount: number, unit: string) {
  const formatter = new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 2,
  });

  if (unit === "INR") {
    return `INR ${formatter.format(amount)}`;
  }

  return `${formatter.format(amount)} ${unit}`;
}

function formatTimestamp(value: string | Date | null) {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export function MyRewardsCard({ periodId }: Props) {
  const [data, setData] = useState<MyRewardsView | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let ignore = false;

    async function loadRewards() {
      setLoading(true);

      try {
        const response = await fetch(`/api/tenant/kra-kpi/rewards/my?periodId=${periodId}&limit=12`);
        if (!response.ok) return;

        const next = (await response.json()) as MyRewardsView;
        if (!ignore) {
          setData(next);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    void loadRewards();

    return () => {
      ignore = true;
    };
  }, [periodId]);

  const stateCounts = useMemo(() => {
    const counts = {
      DRAFT: 0,
      PENDING: 0,
      RELEASED: 0,
      REVOKED: 0,
    } satisfies Record<ContributorRewardStateView, number>;

    for (const reward of data?.rewards ?? []) {
      counts[reward.state] += 1;
    }

    return counts;
  }, [data]);

  return (
    <div className="glass-panel rounded-[1.75rem] border border-slate-200/80 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="section-title text-xs text-slate-400">Reward Ledger</div>
          <h3 className="mt-3 text-lg font-semibold text-slate-900">Your incentive history</h3>
          <p className="mt-1 max-w-2xl text-sm leading-7 text-slate-500">
            Reward summaries stay grouped by benefit type and unit so future KPI expansions can
            add new incentive forms without corrupting totals.
          </p>
        </div>
        <StatusPill
          label={`${data?.rewards.length ?? 0} reward${(data?.rewards.length ?? 0) === 1 ? "" : "s"}`}
          tone="blue"
        />
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {STATE_ORDER.map((state) => (
          <MetricCard
            key={state}
            label={STATE_META[state].label}
            value={loading ? "--" : stateCounts[state]}
            description="Reward records in this state."
            tone={STATE_META[state].tone}
            loading={loading}
            icon={STATE_META[state].icon}
          />
        ))}
      </div>

      {loading ? (
        <div className="mt-5 space-y-3">
          <SkeletonCard variant="table-row" count={3} />
        </div>
      ) : null}

      {!loading && (!data || data.rewards.length === 0) ? (
        <div className="mt-5">
          <EmptyState
            icon={<Wallet className="h-8 w-8" />}
            title="No rewards recorded for this period"
            description="Once rewards are calculated or released, they will appear here with unit-safe totals."
          />
        </div>
      ) : null}

      {!loading && data && data.rewards.length > 0 ? (
        <div className="mt-5 grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-[1.5rem] border border-slate-200/80 bg-white/80 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              State Totals
            </div>
            <div className="mt-4 space-y-4">
              {STATE_ORDER.map((state) => (
                <div key={state} className="rounded-[1.25rem] border border-slate-200/80 bg-slate-50/80 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-semibold text-slate-900">{STATE_META[state].label}</div>
                    <StatusPill label={`${stateCounts[state]} item${stateCounts[state] === 1 ? "" : "s"}`} tone={STATE_META[state].tone} />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {data.totalsByState[state].length > 0 ? (
                      data.totalsByState[state].map((bucket) => (
                        <div
                          key={`${state}-${bucket.benefitTypeCode}-${bucket.unit}`}
                          className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600"
                        >
                          <div className="font-medium text-slate-900">{bucket.benefitTypeName}</div>
                          <div className="mt-1">{bucket.count} item{bucket.count === 1 ? "" : "s"}</div>
                          <div>{formatAmount(bucket.totalAmount, bucket.unit)}</div>
                        </div>
                      ))
                    ) : (
                      <div className="text-sm text-slate-500">No entries in this state.</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[1.5rem] border border-slate-200/80 bg-white/80 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Recent Rewards
              </div>
              <StatusPill label="Latest 12" tone="slate" />
            </div>

            <div className="mt-4 space-y-3">
              {data.rewards.map((reward) => (
                <div
                  key={reward.id}
                  className="rounded-[1.25rem] border border-slate-200/80 bg-slate-50/80 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-slate-900">{reward.kpiTitle}</div>
                      <div className="mt-1 text-sm text-slate-500">
                        {reward.benefitTypeName} | {reward.rewardComponentName}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-lg font-semibold text-slate-950">
                        {formatAmount(reward.finalAmount, reward.benefitUnit)}
                      </div>
                      <div className="mt-1">
                        <StatusPill state={reward.state} />
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-2 text-sm text-slate-500 sm:grid-cols-2">
                    <div>Created: {formatTimestamp(reward.createdAt)}</div>
                    <div>Released: {formatTimestamp(reward.releasedAt)}</div>
                    <div>Reporter Unit: {reward.reporterUnitName ?? "Unassigned"}</div>
                    <div>Owner Unit: {reward.rewardOwnerUnitName ?? "Unassigned"}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
