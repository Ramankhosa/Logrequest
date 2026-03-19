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
import { MyAchievementTrail } from "@/components/my-kpis/my-achievement-trail";

type Props = {
  allocation: MyAllocationView;
  context: MyKpiContext | null;
  onRecordAchievement: () => void;
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

  const ach = a.achievement;
  const ctx = context ?? { userId: "", headOfUnits: [], memberOfUnits: [] };

  const allocInfo = {
    assignedToUnitId: a.assignedToUnitId,
    assignedToUserId: a.assignedToUserId,
    allocationType: a.allocationType,
    state: a.state,
    childCount: a.childCount,
    parentAllocationId: a.parentAllocationId,
  };

  const canRecordFlag = canRecord(allocInfo, ctx, a.periodState);
  const canCascadeFlag = canCascade(allocInfo, ctx);
  const mustCascadeFlag = mustCascade(allocInfo, ctx);
  const showBothChoice = showBothChoiceUI(allocInfo, ctx);

  // Period state messages
  const periodMessage = getPeriodMessage(a.periodState);

  // Deadline
  const daysRemaining = a.achievementDeadline
    ? Math.ceil((new Date(a.achievementDeadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;

  // Score color
  const scoreColor = ach?.computedScore != null
    ? ach.computedScore >= 80 ? "text-green-600"
      : ach.computedScore >= 60 ? "text-blue-600"
      : ach.computedScore >= 40 ? "text-amber-600"
      : "text-red-600"
    : "";

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      {/* Must cascade banner */}
      {mustCascadeFlag && (
        <div className="flex items-center gap-2 rounded-t-lg bg-amber-50 border-b border-amber-200 px-4 py-2 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span className="font-medium">Must Distribute</span>
          <span className="text-xs">— This KPI must be distributed to individuals before recording.</span>
        </div>
      )}

      <div className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-sm font-semibold text-gray-900 truncate">{a.kpiTitle}</h4>
              <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                {a.measurementType}
              </span>
              <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                W: {a.kpiWeightage}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-3 text-xs text-gray-500 flex-wrap">
              <span>KRA: {a.kraTitle} ({a.kraWeightage})</span>
              {a.categoryLabel && (
                <span className="rounded bg-purple-50 px-1.5 py-0.5 text-purple-700">
                  {a.categoryLabel}
                </span>
              )}
              <span>From: {a.startingUnitName}</span>
            </div>
          </div>

          {/* Status + Score */}
          <div className="flex flex-col items-end gap-1">
            {ach ? (
              <AchievementStateBadge state={ach.state} />
            ) : (
              <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500">
                Not Started
              </span>
            )}
            {ach?.state === "VERIFIED" && ach.computedScore != null && (
              <span className={cn("text-sm font-bold", scoreColor)}>
                Score: {Math.round(ach.computedScore)}
              </span>
            )}
          </div>
        </div>

        {/* Target + Deadline */}
        <div className="flex items-center gap-4 flex-wrap text-sm">
          <span className="text-gray-700">
            <strong>Target:</strong>{" "}
            {a.targetValue != null
              ? `${a.targetValue}${a.unitLabel ? ` ${a.unitLabel}` : ""}`
              : "Not set yet"}
          </span>
          {a.parentTargetValue != null && a.targetValue != null && (
            <span className="text-xs text-gray-500">
              Department target: {a.parentTargetValue} | Your share: {a.targetValue} (
              {Math.round((a.targetValue / a.parentTargetValue) * 100)}%)
            </span>
          )}
          {daysRemaining != null && (
            <DeadlineBadge days={daysRemaining} />
          )}
          {a.scoringDirection === "DESCENDING" && (
            <span className="inline-flex items-center gap-1 text-xs text-gray-500">
              <TrendingDown className="h-3 w-3" /> Lower is better
            </span>
          )}
          {a.isPerCapita && (
            <span className="inline-flex items-center gap-1 text-xs text-gray-500">
              <Users className="h-3 w-3" /> Per capita metric
            </span>
          )}
        </div>

        {/* Period message */}
        {periodMessage && (
          <div className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">
            {periodMessage}
          </div>
        )}

        {/* Target updated warning */}
        {ach && ach.state === "SUBMITTED" && a.targetValue != null && (
          <TargetUpdateWarning allocation={a} />
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Record */}
          {canRecordFlag && !ach && (
            <button
              onClick={onRecordAchievement}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              <FileText className="h-3.5 w-3.5" />
              Record Achievement
            </button>
          )}

          {/* Edit draft */}
          {canRecordFlag && ach?.state === "DRAFT" && (
            <button
              onClick={onRecordAchievement}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              Edit & Submit
            </button>
          )}

          {/* Edit rejected */}
          {canRecordFlag && ach?.state === "REJECTED" && (
            <button
              onClick={onRecordAchievement}
              className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
            >
              Revise & Resubmit
            </button>
          )}

          {/* Withdraw */}
          {ach?.state === "SUBMITTED" && ach.reportedByUserId === ctx.userId && (
            <WithdrawButton achievementId={ach.id} onDone={onRefresh} />
          )}

          {/* Cascade */}
          {canCascadeFlag && (
            <button
              onClick={onCascade}
              className="inline-flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700"
            >
              <ArrowDownToLine className="h-3.5 w-3.5" />
              Distribute
            </button>
          )}

          {/* Both choice */}
          {showBothChoice && (
            <div className="flex gap-2">
              <button
                onClick={onRecordAchievement}
                className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
              >
                Record at Dept Level
              </button>
              <button
                onClick={onCascade}
                className="inline-flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700"
              >
                Distribute
              </button>
            </div>
          )}

          {/* Expand / collapse */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="ml-auto inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            {expanded ? "Less" : "More"}
          </button>
        </div>

        {/* Expanded section */}
        {expanded && (
          <div className="border-t border-gray-100 pt-3 space-y-3">
            {a.guidanceNotes && (
              <div className="text-xs text-gray-600">
                <span className="font-medium">Guidance:</span> {a.guidanceNotes}
              </div>
            )}

            {/* Achievement trail */}
            {ach && ach.verificationLog.length > 0 && (
              <MyAchievementTrail log={ach.verificationLog} />
            )}

            {/* Rejection reason */}
            {ach?.rejectionReason && (
              <div className="rounded bg-red-50 p-2 text-xs text-red-700">
                <strong>Not Approved:</strong> {ach.rejectionReason}
              </div>
            )}

            {/* Child allocations (dept head view) */}
            {a.childAllocations.length > 0 && (
              <div>
                <button
                  onClick={() => setShowChildren(!showChildren)}
                  className="text-xs text-blue-600 hover:underline"
                >
                  {showChildren ? "Hide" : "Show"} {a.childAllocations.length} distributed allocation(s)
                </button>
                {showChildren && (
                  <div className="mt-2 space-y-1">
                    {a.childAllocations.map((c) => (
                      <div
                        key={c.id}
                        className="flex items-center gap-3 text-xs text-gray-600 bg-gray-50 rounded px-2 py-1"
                      >
                        <span className="font-medium">{c.assignedToUserName ?? c.assignedToUnitName}</span>
                        <span>Target: {c.targetValue ?? "—"}</span>
                        <span>Actual: {c.actualValue ?? "—"}</span>
                        {c.achievementState && <AchievementStateBadge state={c.achievementState} />}
                        {c.computedScore != null && (
                          <span className="font-semibold">Score: {Math.round(c.computedScore)}</span>
                        )}
                      </div>
                    ))}
                    {/* Aggregate */}
                    {a.targetValue != null && (
                      <div className="mt-1 text-xs text-gray-500 font-medium border-t border-gray-200 pt-1">
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
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", c.bg, c.text)}>
      {state === "VERIFIED" && <CheckCircle2 className="h-3 w-3 mr-1" />}
      {c.label}
    </span>
  );
}

function DeadlineBadge({ days }: { days: number }) {
  if (days < 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
        <Clock className="h-3 w-3" /> Overdue
      </span>
    );
  }
  if (days <= 14) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
        <Clock className="h-3 w-3" /> {days} days left
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
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
  if (new Date(allocation.createdAt) > new Date(ach.createdAt)) {
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
      className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
    >
      {loading ? "..." : "Withdraw"}
    </button>
  );
}
