"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, Loader2, RefreshCw, Wallet, XCircle } from "lucide-react";
import type { ContributorRewardView, RewardConsoleListResult } from "@/lib/kra-kpi/shared";
import { StatusBadge } from "@/components/status-badge";

type BenefitTypeOption = {
  id: string;
  code: string;
  name: string;
  unit: string;
};

type UnitOption = {
  id: string;
  name: string;
  code: string;
  typeKey: string;
};

type Props = {
  periodId?: string | null;
  kraDefinitionId?: string | null;
  kpiDefinitionId?: string | null;
};

const REWARD_STATES = ["ALL", "DRAFT", "PENDING", "RELEASED", "REVOKED"] as const;

function formatDate(value: string | Date | null) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatAmount(row: ContributorRewardView) {
  return `${row.finalAmount.toFixed(2)} ${row.benefitUnit}`;
}

export function RewardOpsConsole({ periodId, kraDefinitionId, kpiDefinitionId }: Props) {
  const [state, setState] = useState<(typeof REWARD_STATES)[number]>("ALL");
  const [benefitTypeCode, setBenefitTypeCode] = useState("");
  const [unitId, setUnitId] = useState("");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [rewards, setRewards] = useState<RewardConsoleListResult | null>(null);
  const [benefitTypes, setBenefitTypes] = useState<BenefitTypeOption[]>([]);
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [selectedRewardIds, setSelectedRewardIds] = useState<string[]>([]);
  const [expandedRewardId, setExpandedRewardId] = useState<string | null>(null);
  const [transitionNote, setTransitionNote] = useState("");
  const [releaseReference, setReleaseReference] = useState("");
  const [acting, setActing] = useState(false);

  const fetchReferenceData = async () => {
    const [benefitRes, unitRes] = await Promise.all([
      fetch("/api/tenant/kra-kpi/benefit-types"),
      fetch("/api/tenant/structure/units"),
    ]);
    if (benefitRes.ok) {
      setBenefitTypes((await benefitRes.json()) as BenefitTypeOption[]);
    }
    if (unitRes.ok) {
      setUnits((await unitRes.json()) as UnitOption[]);
    }
  };

  const fetchRewards = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (periodId) params.set("periodId", periodId);
      if (kraDefinitionId) params.set("kraDefinitionId", kraDefinitionId);
      if (kpiDefinitionId) params.set("kpiDefinitionId", kpiDefinitionId);
      if (state !== "ALL") params.set("state", state);
      if (benefitTypeCode) params.set("benefitTypeCode", benefitTypeCode);
      if (unitId) params.set("unitId", unitId);
      if (createdFrom) params.set("createdFrom", createdFrom);
      if (createdTo) params.set("createdTo", createdTo);
      params.set("limit", "100");

      const response = await fetch(`/api/tenant/kra-kpi/rewards?${params.toString()}`);
      const data = (await response.json()) as RewardConsoleListResult | { message?: string };
      if (!response.ok) {
        throw new Error("message" in data ? data.message ?? "Failed to load rewards." : "Failed to load rewards.");
      }
      setRewards(data as RewardConsoleListResult);
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to load rewards.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchReferenceData();
  }, []);

  useEffect(() => {
    void fetchRewards();
  }, [periodId, kraDefinitionId, kpiDefinitionId, state, benefitTypeCode, unitId, createdFrom, createdTo]);

  const allVisibleSelected = useMemo(() => {
    const ids = rewards?.rewards.map((reward) => reward.id) ?? [];
    return ids.length > 0 && ids.every((id) => selectedRewardIds.includes(id));
  }, [rewards, selectedRewardIds]);

  const toggleSelectAll = () => {
    const ids = rewards?.rewards.map((reward) => reward.id) ?? [];
    setSelectedRewardIds(allVisibleSelected ? [] : ids);
  };

  const toggleSelectOne = (rewardId: string) => {
    setSelectedRewardIds((previous) =>
      previous.includes(rewardId)
        ? previous.filter((id) => id !== rewardId)
        : [...previous, rewardId],
    );
  };

  const runTransition = async (nextState: "DRAFT" | "PENDING" | "RELEASED" | "REVOKED") => {
    if (selectedRewardIds.length === 0) {
      setFeedback({ type: "error", message: "Select at least one reward row." });
      return;
    }
    if (nextState === "REVOKED" && !transitionNote.trim()) {
      setFeedback({ type: "error", message: "Revocation requires a remark." });
      return;
    }

    setActing(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/tenant/kra-kpi/rewards/transition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rewardIds: selectedRewardIds,
          nextState,
          note: transitionNote.trim() || undefined,
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
        throw new Error(data.message ?? "Reward state update failed.");
      }

      const failedCount = data.failed?.length ?? 0;
      setFeedback({
        type: failedCount > 0 ? "error" : "success",
        message:
          failedCount > 0
            ? `${data.updatedCount} reward(s) updated, ${failedCount} failed.`
            : `${data.updatedCount} reward(s) updated.`,
      });
      setSelectedRewardIds([]);
      setTransitionNote("");
      setReleaseReference("");
      await fetchRewards();
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Reward state update failed.",
      });
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Reward Operations</h3>
          <p className="text-xs text-slate-500">
            Track generated rewards, update release state, and review reward history.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { void fetchRewards(); }}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      <div className="grid gap-3 rounded-2xl border border-slate-200/80 bg-white/70 p-4 md:grid-cols-5">
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            State
          </label>
          <select
            value={state}
            onChange={(event) => setState(event.target.value as (typeof REWARD_STATES)[number])}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
          >
            {REWARD_STATES.map((option) => (
              <option key={option} value={option}>
                {option === "ALL" ? "All states" : option}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Benefit Type
          </label>
          <select
            value={benefitTypeCode}
            onChange={(event) => setBenefitTypeCode(event.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
          >
            <option value="">All benefit types</option>
            {benefitTypes.map((benefitType) => (
              <option key={benefitType.id} value={benefitType.code}>
                {benefitType.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Unit
          </label>
          <select
            value={unitId}
            onChange={(event) => setUnitId(event.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
          >
            <option value="">All units</option>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name} ({unit.typeKey})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Created From
          </label>
          <input
            type="date"
            value={createdFrom}
            onChange={(event) => setCreatedFrom(event.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
          />
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Created To
          </label>
          <input
            type="date"
            value={createdTo}
            onChange={(event) => setCreatedTo(event.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
          />
        </div>
      </div>

      {feedback && (
        <div className={`rounded-xl border px-3 py-2 text-sm ${feedback.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
          {feedback.message}
        </div>
      )}

      {rewards?.totals.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {rewards.totals.map((total) => (
            <div key={total.benefitTypeCode} className="rounded-2xl border border-slate-200/80 bg-white/70 p-4">
              <div className="flex items-center gap-2 text-slate-900">
                <Wallet className="h-4 w-4 text-slate-500" />
                <span className="text-sm font-semibold">{total.benefitTypeName}</span>
              </div>
              <div className="mt-2 text-xs text-slate-500">{total.totalCount} rewards</div>
              <div className="mt-1 text-lg font-semibold text-slate-900">
                {total.totalAmount.toFixed(2)} {total.unit}
              </div>
              <div className="mt-3 space-y-1 text-xs text-slate-500">
                <div>Draft: {total.draftCount} / {total.draftAmount.toFixed(2)} {total.unit}</div>
                <div>Pending: {total.pendingCount} / {total.pendingAmount.toFixed(2)} {total.unit}</div>
                <div>Released: {total.releasedCount} / {total.releasedAmount.toFixed(2)} {total.unit}</div>
                <div>Revoked: {total.revokedCount} / {total.revokedAmount.toFixed(2)} {total.unit}</div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="rounded-2xl border border-slate-200/80 bg-white/70 p-4">
        <div className="grid gap-3 md:grid-cols-[2fr,1fr,1fr,auto,auto,auto] md:items-end">
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Action Remark
            </label>
            <input
              value={transitionNote}
              onChange={(event) => setTransitionNote(event.target.value)}
              placeholder="Required for revoke; optional otherwise"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Release Ref
            </label>
            <input
              value={releaseReference}
              onChange={(event) => setReleaseReference(event.target.value)}
              placeholder="Optional reference"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
            />
          </div>
          <div className="text-xs text-slate-500">
            {selectedRewardIds.length} reward(s) selected
          </div>
          <button
            type="button"
            disabled={acting}
            onClick={() => { void runTransition("PENDING"); }}
            className="inline-flex items-center justify-center rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 transition hover:bg-amber-100 disabled:opacity-50"
          >
            Mark Pending
          </button>
          <button
            type="button"
            disabled={acting}
            onClick={() => { void runTransition("RELEASED"); }}
            className="inline-flex items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
          >
            Release
          </button>
          <button
            type="button"
            disabled={acting}
            onClick={() => { void runTransition("REVOKED"); }}
            className="inline-flex items-center justify-center rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
          >
            Revoke
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center rounded-2xl border border-slate-200/80 bg-white/70 py-12">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      ) : !rewards || rewards.rewards.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-400">
          No rewards found for the current filters.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/70">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50/80 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">
                    <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll} />
                  </th>
                  <th className="px-4 py-3">Reward</th>
                  <th className="px-4 py-3">Contributor</th>
                  <th className="px-4 py-3">State</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Units</th>
                  <th className="px-4 py-3">Dates</th>
                  <th className="px-4 py-3 text-right">History</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rewards.rewards.map((reward) => {
                  const expanded = expandedRewardId === reward.id;
                  return (
                    <Fragment key={reward.id}>
                      <tr key={reward.id} className="align-top">
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selectedRewardIds.includes(reward.id)}
                            onChange={() => toggleSelectOne(reward.id)}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900">{reward.kpiTitle}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            {reward.rewardTierName ?? reward.rewardTierCode ?? "No tier"} / {reward.rewardComponentName}
                          </div>
                          <div className="mt-1 text-xs text-slate-400">Achievement: {reward.achievementId}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900">{reward.contributorDisplayName}</div>
                          <div className="mt-1 text-xs text-slate-500">Reported by: {reward.reportedByUserName}</div>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge label={reward.state} />
                          {reward.replacedByRewardId && (
                            <div className="mt-1 text-xs text-amber-600">Replaced</div>
                          )}
                          {reward.supersedesRewardId && (
                            <div className="mt-1 text-xs text-slate-500">Replacement row</div>
                          )}
                        </td>
                        <td className="px-4 py-3 font-semibold text-slate-900">
                          {formatAmount(reward)}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          <div>{reward.rewardOwnerUnitName ?? "-"}</div>
                          <div className="mt-1">Reporter: {reward.reporterUnitName ?? "-"}</div>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          <div>Created: {formatDate(reward.createdAt)}</div>
                          <div className="mt-1">Released: {formatDate(reward.releasedAt)}</div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => setExpandedRewardId(expanded ? null : reward.id)}
                            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                          >
                            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                            Details
                          </button>
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="bg-slate-50/60">
                          <td colSpan={8} className="px-4 py-4">
                            <div className="grid gap-4 lg:grid-cols-2">
                              <div className="space-y-2 text-xs text-slate-600">
                                <div><span className="font-semibold text-slate-700">Benefit:</span> {reward.benefitTypeName}</div>
                                <div><span className="font-semibold text-slate-700">Status remark:</span> {reward.statusRemark ?? "-"}</div>
                                <div><span className="font-semibold text-slate-700">Release ref:</span> {reward.releaseReference ?? "-"}</div>
                                <div><span className="font-semibold text-slate-700">Revocation reason:</span> {reward.revocationReason ?? "-"}</div>
                              </div>
                              <div>
                                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                  Reward History
                                </div>
                                <div className="space-y-2">
                                  {reward.events.length === 0 ? (
                                    <div className="text-xs text-slate-400">No history entries yet.</div>
                                  ) : reward.events.map((event) => (
                                    <div key={event.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                                      <div className="flex items-center justify-between gap-2">
                                        <div className="font-medium text-slate-800">{event.action}</div>
                                        <div className="text-slate-400">{formatDate(event.createdAt)}</div>
                                      </div>
                                      <div className="mt-1">
                                        {event.fromState ?? "-"} {"->"} {event.toState ?? "-"}
                                      </div>
                                      {event.actorName && (
                                        <div className="mt-1 text-slate-500">By {event.actorName}</div>
                                      )}
                                      {event.note && (
                                        <div className="mt-1 text-slate-500">{event.note}</div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
