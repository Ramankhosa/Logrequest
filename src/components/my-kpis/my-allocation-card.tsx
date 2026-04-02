"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  ArrowDownToLine,
  TrendingDown,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { MyAllocationView, MyKpiContext } from "@/lib/kra-kpi/shared";
import {
  canRecord,
  canCascade,
  mustCascade,
  showBothChoiceUI,
} from "@/lib/kra-kpi/assignee-access";
import { summarizeAllocationLifecycle } from "@/lib/kra-kpi/allocation-achievement-utils";
import { MyAchievementTrail } from "@/components/my-kpis/my-achievement-trail";

type Props = {
  allocation: MyAllocationView;
  context: MyKpiContext | null;
  onRecordAchievement: (achievement?: MyAllocationView["achievement"]) => void;
  onCascade: () => void;
  onRefresh: () => void;
};

export function MyAllocationCard({
  allocation: a,
  context,
  onRecordAchievement,
  onCascade,
  onRefresh,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [showChildren, setShowChildren] = useState(false);
  const [expandedRequestId, setExpandedRequestId] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  const ach = a.achievement;
  const isMultiRequest = a.allowMultipleAchievementsPerAllocation;
  const ctx = context ?? { userId: "", headOfUnits: [], memberOfUnits: [] };

  const allocInfo = {
    assignedToUnitId: a.assignedToUnitId,
    assignedToUserId: a.assignedToUserId,
    allocationType: a.allocationType,
    state: a.state,
    childCount: a.childCount,
    parentAllocationId: a.parentAllocationId,
  };

  const targetConfigured = hasConfiguredTarget(a);
  const canRecordFlag = targetConfigured && canRecord(allocInfo, ctx, a.periodState);
  const canCascadeFlag = targetConfigured && canCascade(allocInfo, ctx);
  const mustCascadeFlag = mustCascade(allocInfo, ctx);
  const showBothChoice = showBothChoiceUI(allocInfo, ctx);
  const lifecycle = summarizeAllocationLifecycle({
    allowMultipleAchievementsPerAllocation: a.allowMultipleAchievementsPerAllocation,
    achievements: a.achievements,
    aggregate: a.achievementAggregate,
    targetValue: a.targetValue,
  });

  // Period state messages
  const periodMessage = getPeriodMessage(a.periodState);

  // Deadline
  const daysRemaining = a.achievementDeadline
    ? Math.ceil((new Date(a.achievementDeadline).getTime() - now) / (1000 * 60 * 60 * 24))
    : null;

  // Score color
  const scoreColor = ach?.computedScore != null
    ? ach.computedScore >= 80 ? "text-green-600"
      : ach.computedScore >= 60 ? "text-blue-600"
      : ach.computedScore >= 40 ? "text-amber-600"
      : "text-red-600"
    : "";
  const aggregateScore = a.achievementAggregate.officialScore;
  const aggregateScoreColor = aggregateScore != null
    ? aggregateScore >= 80 ? "text-green-600"
      : aggregateScore >= 60 ? "text-blue-600"
      : aggregateScore >= 40 ? "text-amber-600"
      : "text-red-600"
    : "";

  return (
    <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_20px_70px_-50px_rgba(15,23,42,0.35)]">
      {/* Must cascade banner */}
      {mustCascadeFlag && (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span className="font-medium">Must Distribute</span>
          <span className="text-xs">— This KPI must be distributed to individuals before recording.</span>
        </div>
      )}

      <div className="space-y-4 p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="truncate text-base font-semibold tracking-tight text-slate-950">{a.kpiTitle}</h4>
              <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                {a.measurementType}
              </span>
              <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                W: {a.kpiWeightage}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-3 text-xs text-slate-500 flex-wrap">
              <span>KRA: {a.kraTitle} ({a.kraWeightage})</span>
              {a.categoryLabel && (
                <span className="rounded-full bg-cyan-50 px-2.5 py-1 text-cyan-700">
                  {a.categoryLabel}
                </span>
              )}
              <span>From: {a.startingUnitName}</span>
            </div>
          </div>

          {/* Status + Score */}
          <div className="flex flex-col items-end gap-1">
            {isMultiRequest ? (
              a.achievementAggregate.totalRequests > 0 ? (
              <AchievementStateBadge state={mapLifecycleToBadgeState(lifecycle)} />
              ) : (
                <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">
                  Not Started
                </span>
              )
            ) : ach ? (
              <AchievementStateBadge state={ach.state} />
            ) : (
              <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">
                Not Started
              </span>
            )}
            {isMultiRequest && aggregateScore != null ? (
              <span className={cn("text-sm font-bold", aggregateScoreColor)}>
                Score: {Math.round(aggregateScore)}
              </span>
            ) : ach?.state === "VERIFIED" && ach.computedScore != null && (
              <span className={cn("text-sm font-bold", scoreColor)}>
                Score: {Math.round(ach.computedScore)}
              </span>
            )}
          </div>
        </div>

        {/* Target + Deadline */}
        <div className="flex items-center gap-4 flex-wrap text-sm">
          <span className="rounded-full bg-slate-50 px-3 py-1 text-slate-700">
            <strong>Target:</strong>{" "}
            {a.targetValue != null
              ? `${a.targetValue}${a.unitLabel ? ` ${a.unitLabel}` : ""}`
              : "Not set yet"}
          </span>
          {a.parentTargetValue != null && a.targetValue != null && (
            <span className="text-xs text-slate-500">
              Department target: {a.parentTargetValue} | Your share: {a.targetValue} (
              {Math.round((a.targetValue / a.parentTargetValue) * 100)}%)
            </span>
          )}
          {daysRemaining != null && (
            <DeadlineBadge days={daysRemaining} />
          )}
          {a.scoringDirection === "DESCENDING" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-3 py-1 text-xs text-slate-500">
              <TrendingDown className="h-3 w-3" /> Lower is better
            </span>
          )}
          {a.isPerCapita && (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-3 py-1 text-xs text-slate-500">
              <Users className="h-3 w-3" /> Per capita metric
            </span>
          )}
        </div>

        {/* Period message */}
        {periodMessage && (
          <div className="rounded-2xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
            {periodMessage}
          </div>
        )}

        {/* Target updated warning */}
        {ach &&
          (ach.state === "SUBMITTED" || ach.state === "RECOMMENDED") &&
          a.targetValue != null && (
          <TargetUpdateWarning allocation={a} />
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Record */}
          {!showBothChoice && canRecordFlag && (!ach || isMultiRequest) && (
            <button
              onClick={() => onRecordAchievement(null)}
              className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700"
            >
              <FileText className="h-3.5 w-3.5" />
              {isMultiRequest ? "Add Achievement Request" : "Record Achievement"}
            </button>
          )}

          {/* Edit draft */}
          {!isMultiRequest && !showBothChoice && canRecordFlag && ach?.state === "DRAFT" && (
            <button
              onClick={() => onRecordAchievement(ach)}
              className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700"
            >
              Edit & Submit
            </button>
          )}

          {/* Edit rejected */}
          {!isMultiRequest && !showBothChoice && canRecordFlag && ach?.state === "REJECTED" && (
            <button
              onClick={() => onRecordAchievement(ach)}
              className="inline-flex items-center gap-1.5 rounded-full bg-amber-600 px-4 py-2 text-xs font-medium text-white hover:bg-amber-700"
            >
              Revise & Resubmit
            </button>
          )}

          {/* Withdraw */}
          {ach?.state === "SUBMITTED" && ach.reportedByUserId === ctx.userId && (
            <WithdrawButton achievementId={ach.id} onDone={onRefresh} />
          )}

          {/* Cascade */}
          {!showBothChoice && canCascadeFlag && (
            <button
              onClick={onCascade}
              className="inline-flex items-center gap-1.5 rounded-full bg-green-600 px-4 py-2 text-xs font-medium text-white hover:bg-green-700"
            >
              <ArrowDownToLine className="h-3.5 w-3.5" />
              Distribute
            </button>
          )}

          {/* Both choice */}
          {showBothChoice && (
            <div className="flex gap-2">
              <button
                onClick={() => onRecordAchievement(null)}
                className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700"
              >
                Record at Dept Level
              </button>
              <button
                onClick={onCascade}
                className="inline-flex items-center gap-1.5 rounded-full bg-green-600 px-4 py-2 text-xs font-medium text-white hover:bg-green-700"
              >
                Distribute
              </button>
            </div>
          )}

          {/* Expand / collapse */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="ml-auto inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-700"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            {expanded ? "Less" : "More"}
          </button>
        </div>

        {isMultiRequest && (
          <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-700">
              <span>
                <strong>Verified progress:</strong>{" "}
                {a.achievementAggregate.officialActualValue}
                {a.targetValue != null ? ` / ${a.targetValue}` : ""}
              </span>
              <span>
                <strong>Total requests:</strong> {a.achievementAggregate.totalRequests}
              </span>
              <span>
                <strong>Draft:</strong> {a.achievementAggregate.countsByState.draft}
              </span>
              <span>
                <strong>Pending:</strong>{" "}
                {a.achievementAggregate.countsByState.submitted + a.achievementAggregate.countsByState.recommended}
              </span>
              <span>
                <strong>Rejected:</strong> {a.achievementAggregate.countsByState.rejected}
              </span>
            </div>

            {a.achievements.length === 0 ? (
              <div className="mt-3 rounded-2xl bg-white px-3 py-3 text-xs text-slate-500">
                No achievement requests have been recorded for this KPI yet.
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                {a.achievements.map((request) => {
                  const canEditRequest =
                    canRecordFlag && (request.state === "DRAFT" || request.state === "REJECTED");
                  const expandedRequest = expandedRequestId === request.id;
                  return (
                    <div key={request.id} className="rounded-[20px] border border-slate-200 bg-white px-4 py-3 shadow-[0_14px_30px_-28px_rgba(15,23,42,0.35)]">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-medium text-slate-900">
                              {request.title ?? `Request ${request.id.slice(0, 8)}`}
                            </span>
                            <AchievementStateBadge state={request.state} />
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            Recorded on {new Date(request.reportingDate).toLocaleDateString()}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {canEditRequest ? (
                            <button
                              onClick={() => onRecordAchievement(request)}
                              className={`rounded-full px-3 py-1.5 text-xs font-medium text-white ${
                                request.state === "REJECTED"
                                  ? "bg-amber-600 hover:bg-amber-700"
                                  : "bg-blue-600 hover:bg-blue-700"
                              }`}
                            >
                              {request.state === "REJECTED" ? "Revise" : "Edit"}
                            </button>
                          ) : null}
                          {request.state === "SUBMITTED" && request.reportedByUserId === ctx.userId ? (
                            <WithdrawButton achievementId={request.id} onDone={onRefresh} />
                          ) : null}
                          <button
                            onClick={() => setExpandedRequestId(expandedRequest ? null : request.id)}
                            className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-700"
                          >
                            {expandedRequest ? "Hide details" : "Show details"}
                          </button>
                        </div>
                      </div>

                      {expandedRequest ? (
                        <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
                          {request.duplicateCheckResult?.matches?.length ? (
                            <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                              <div className="mb-2 flex items-center gap-2 font-semibold">
                                <AlertTriangle className="h-4 w-4" />
                                Duplicate and policy checks
                              </div>
                              <div className="space-y-2">
                                {request.duplicateCheckResult.matches.map((match) => (
                                  <div key={`${match.achievementId}-${match.matchedField}-${match.matchType ?? match.similarity}`}>
                                    <div>
                                      {match.matchType === "POLICY_WARNING" ? "Policy warning" : "Possible duplicate"}:{" "}
                                      {match.achievementTitle ?? "Untitled achievement"}
                                    </div>
                                    <div className="text-amber-800/80">
                                      Field: {match.matchedField} | Value: {match.matchedValue || "--"} | Reporter: {match.reportedByName}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          {request.rejectionReason ? (
                            <div className="rounded bg-red-50 p-2 text-xs text-red-700">
                              <strong>Not Approved:</strong> {request.rejectionReason}
                            </div>
                          ) : null}

                          {(request.submissionTrail.length > 0 || request.verificationLog.length > 0) ? (
                            <MyAchievementTrail trail={request.submissionTrail} log={request.verificationLog} />
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Expanded section */}
        {expanded && (
          <div className="space-y-3 border-t border-slate-100 pt-4">
            {a.guidanceNotes && (
              <div className="rounded-2xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <span className="font-medium">Guidance:</span> {a.guidanceNotes}
              </div>
            )}

            {!isMultiRequest && ach?.duplicateCheckResult?.matches?.length ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <div className="mb-2 flex items-center gap-2 font-semibold">
                  <AlertTriangle className="h-4 w-4" />
                  Duplicate and policy checks
                </div>
                <div className="space-y-2">
                  {ach.duplicateCheckResult.matches.map((match) => (
                    <div key={`${match.achievementId}-${match.matchedField}-${match.matchType ?? match.similarity}`}>
                      <div>
                        {match.matchType === "POLICY_WARNING" ? "Policy warning" : "Possible duplicate"}:
                        {" "}
                        {match.achievementTitle ?? "Untitled achievement"}
                        {match.relatedKpiTitle ? ` (${match.relatedKpiTitle})` : ""}
                      </div>
                      <div className="text-amber-800/80">
                        Field: {match.matchedField} | Value: {match.matchedValue || "--"} | Reporter: {match.reportedByName}
                      </div>
                      {match.note ? (
                        <div className="text-amber-800/80">{match.note}</div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Achievement trail */}
            {!isMultiRequest && ach && (ach.submissionTrail.length > 0 || ach.verificationLog.length > 0) && (
              <MyAchievementTrail trail={ach.submissionTrail} log={ach.verificationLog} />
            )}

            {/* Rejection reason */}
            {!isMultiRequest && ach?.rejectionReason && (
              <div className="rounded-2xl bg-red-50 p-3 text-xs text-red-700">
                <strong>Not Approved:</strong> {ach.rejectionReason}
              </div>
            )}

            {/* Child allocations (dept head view) */}
            {a.childAllocations.length > 0 && (
              <div>
                <button
                  onClick={() => setShowChildren(!showChildren)}
                  className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
                >
                  {showChildren ? "Hide" : "Show"} {a.childAllocations.length} distributed allocation(s)
                </button>
                {showChildren && (
                  <div className="mt-3 space-y-2">
                    {a.childAllocations.map((c) => (
                      <div
                        key={c.id}
                        className="flex items-center gap-3 rounded-2xl bg-slate-50 px-3 py-2 text-xs text-slate-600"
                      >
                        <span className="font-medium">{c.assignedToUserName ?? c.assignedToUnitName}</span>
                        <span>Target: {c.targetValue ?? "--"}</span>
                        <span>Actual: {c.actualValue ?? "--"}</span>
                        {c.achievementState && <AchievementStateBadge state={c.achievementState} />}
                        {c.computedScore != null && (
                          <span className="font-semibold">Score: {Math.round(c.computedScore)}</span>
                        )}
                      </div>
                    ))}
                    {/* Aggregate */}
                    {a.targetValue != null && (
                      <div className="mt-1 border-t border-slate-200 pt-2 text-xs font-medium text-slate-500">
                        Aggregate: {a.childAllocations.reduce((s, c) => s + (c.actualValue ?? 0), 0)} of {a.targetValue} achieved |{" "}
                        {a.childAllocations.filter((c) => c.achievementState === "SUBMITTED" || c.achievementState === "RECOMMENDED").length} submitted,{" "}
                        {a.childAllocations.filter((c) => c.achievementState === "VERIFIED").length} verified
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function mapLifecycleToBadgeState(
  lifecycle: ReturnType<typeof summarizeAllocationLifecycle>,
) {
  switch (lifecycle) {
    case "completed":
      return "VERIFIED";
    case "pendingReview":
      return "SUBMITTED";
    case "notApproved":
      return "REJECTED";
    case "inProgress":
      return "DRAFT";
    default:
      return "DRAFT";
  }
}

function AchievementStateBadge({ state }: { state: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    DRAFT: { bg: "bg-gray-100", text: "text-gray-600", label: "Draft" },
    SUBMITTED: { bg: "bg-blue-100", text: "text-blue-700", label: "Submitted" },
    RECOMMENDED: { bg: "bg-indigo-100", text: "text-indigo-700", label: "Recommended" },
    VERIFIED: { bg: "bg-green-100", text: "text-green-700", label: "Verified" },
    REJECTED: { bg: "bg-red-100", text: "text-red-700", label: "Not Approved" },
  };
  const c = config[state] ?? config.DRAFT;
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium", c.bg, c.text)}>
      {state === "VERIFIED" && <CheckCircle2 className="h-3 w-3 mr-1" />}
      {c.label}
    </span>
  );
}

function DeadlineBadge({ days }: { days: number }) {
  if (days < 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700">
        <Clock className="h-3 w-3" /> Overdue
      </span>
    );
  }
  if (days <= 14) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">
        <Clock className="h-3 w-3" /> {days} days left
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
      <Clock className="h-3 w-3" /> {days} days left
    </span>
  );
}

function getPeriodMessage(state: string): string | null {
  switch (state) {
    case "OPEN": return "Targets are being set. Recording not yet available.";
    case "UNDER_REVIEW": return "Period is under review.";
    case "CLOSED": return "Period is closed. Read-only.";
    case "ARCHIVED": return "Period is archived. Read-only.";
    default: return null;
  }
}

function TargetUpdateWarning({ allocation }: { allocation: MyAllocationView }) {
  const ach = allocation.achievement;
  if (!ach) return null;
  const latestSubmitAt =
    getLatestSubmitTimestamp(ach.submissionTrail, ach.verificationLog) ?? ach.createdAt;
  if (new Date(allocation.updatedAt) > new Date(latestSubmitAt)) {
    return (
      <div className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">
        <AlertTriangle className="h-3 w-3 inline mr-1" />
        Target was updated after your submission.
      </div>
    );
  }
  return null;
}

function WithdrawButton({ achievementId, onDone }: { achievementId: string; onDone: () => void }) {
  const [loading, setLoading] = useState(false);

  const handleWithdraw = async () => {
    if (!confirm("Withdraw this submission? It will return to draft.")) return;
    setLoading(true);
    const res = await fetch("/api/tenant/kra-kpi/my/withdraw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ achievementId }),
    });
    setLoading(false);
    if (res.ok) onDone();
    else {
      const data = await res.json();
      alert(data.message ?? "Failed to withdraw.");
    }
  };

  return (
    <button
      onClick={handleWithdraw}
      disabled={loading}
      className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
    >
      {loading ? "..." : "Withdraw"}
    </button>
  );
}

function hasConfiguredTarget(allocation: MyAllocationView) {
  return (
    allocation.targetValue != null ||
    allocation.targetDate != null ||
    allocation.targetMilestone != null ||
    allocation.targetGrade != null ||
    allocation.targetBoolean != null ||
    allocation.targetRating != null
  );
}

function getLatestSubmitTimestamp(
  trail: NonNullable<MyAllocationView["achievement"]>["submissionTrail"] | undefined,
  log: NonNullable<MyAllocationView["achievement"]>["verificationLog"] | undefined,
) {
  if (trail && trail.length > 0) {
    const submitEntries = trail.filter(
      (entry) => entry.action === "SUBMITTED" || entry.action === "RESUBMITTED",
    );
    if (submitEntries.length > 0) {
      return submitEntries[submitEntries.length - 1]?.createdAt ?? null;
    }
  }

  if (!log) return null;

  const submitEntries = log.filter((entry) => entry.level === "SUBMIT");
  if (submitEntries.length === 0) return null;

  return submitEntries[submitEntries.length - 1]?.at ?? null;
}
