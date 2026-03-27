"use client";

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  DataTable,
  ScoreBadge,
  StatusPill,
} from "@/components/dashboard/shared";
import type { ReviewQueueItem } from "@/lib/kra-kpi/shared";
import type { UserDashboardScope } from "@/lib/org-structure/scope-resolver";

type Props = {
  scope: UserDashboardScope;
  items: ReviewQueueItem[];
  loading: boolean;
  selectedAchievementId: string | null;
  onSelect: (item: ReviewQueueItem) => void;
};

function WaitingPill({ days }: { days: number }) {
  if (days > 14) {
    return <StatusPill label={`${days} days`} tone="rose" />;
  }
  if (days > 7) {
    return <StatusPill label={`${days} days`} tone="amber" />;
  }
  return <StatusPill label={`${days} days`} tone="blue" />;
}

function getScopedUnitLabel(scope: UserDashboardScope, unitId: string) {
  return (
    scope.rootScopeUnits.find((unit) => unit.unitId === unitId)?.unitName
    ?? scope.headOfUnits.find((unit) => unit.unitId === unitId)?.unitName
    ?? scope.memberOfUnits.find((unit) => unit.unitId === unitId)?.unitName
    ?? "Assigned unit"
  );
}

export function ReviewQueueTable({
  scope,
  items,
  loading,
  selectedAchievementId,
  onSelect,
}: Props) {
  const columns = useMemo<ColumnDef<ReviewQueueItem>[]>(
    () => [
      {
        header: "Contributor",
        cell: ({ row }) => (
          <div>
            <div className="font-semibold text-slate-900">{row.original.facultyName}</div>
            <div className="text-xs text-slate-500">
              {row.original.facultyDesignation ?? "Contributor"}
            </div>
          </div>
        ),
      },
      {
        header: "KPI",
        cell: ({ row }) => (
          <div>
            <div className="font-medium text-slate-900">{row.original.kpiTitle}</div>
            <div className="text-xs text-slate-500">
              {row.original.reviewUnitName
                ?? getScopedUnitLabel(scope, row.original.startingUnitId)}
            </div>
          </div>
        ),
      },
      {
        header: "Step",
        cell: ({ row }) => (
          <StatusPill
            label={row.original.reviewLevel === "RECOMMEND" ? "Recommend" : "Verify"}
            tone="blue"
          />
        ),
      },
      {
        header: "Target / Actual",
        cell: ({ row }) => (
          <div className="space-y-1 text-xs text-slate-500">
            <div>Target: <span className="font-medium text-slate-700">{row.original.targetDisplay}</span></div>
            <div>Actual: <span className="font-medium text-slate-900">{row.original.actualDisplay}</span></div>
          </div>
        ),
      },
      {
        header: "State",
        cell: ({ row }) => <StatusPill state={row.original.achievementState} />,
      },
      {
        header: "Waiting",
        cell: ({ row }) => <WaitingPill days={row.original.waitingDays} />,
      },
      {
        header: "Score",
        cell: ({ row }) => (
          <ScoreBadge
            score={row.original.effectiveScore ?? row.original.stageCompletionScore ?? null}
            size="sm"
          />
        ),
      },
    ],
    [scope],
  );

  return (
    <DataTable
      columns={columns}
      data={items}
      loading={loading}
      emptyState={{
        title: "No achievements awaiting your review",
        description: "All caught up for the selected period.",
      }}
      onRowClick={onSelect}
      rowClassName={(row) =>
        row.achievementId === selectedAchievementId
          ? "bg-blue-soft/35"
          : row.waitingDays > 14
            ? "bg-rose-50/80"
            : row.waitingDays > 7
              ? "bg-amber-50/70"
              : ""
      }
      mobileCardRenderer={(row) => (
        <button
          type="button"
          onClick={() => onSelect(row)}
          className="w-full rounded-[1.5rem] border border-slate-200/80 bg-white/75 p-4 text-left"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-semibold text-slate-900">{row.facultyName}</div>
              <div className="text-sm text-slate-500">{row.kpiTitle}</div>
            </div>
            <WaitingPill days={row.waitingDays} />
          </div>
          <div className="mt-3 text-sm text-slate-500">
            <div>{row.targetDisplay} target</div>
            <div className="font-medium text-slate-900">{row.actualDisplay} actual</div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <StatusPill state={row.achievementState} />
            <StatusPill
              label={row.reviewLevel === "RECOMMEND" ? "Recommend" : "Verify"}
              tone="blue"
            />
            <ScoreBadge
              score={row.effectiveScore ?? row.stageCompletionScore ?? null}
              size="sm"
            />
          </div>
        </button>
      )}
    />
  );
}
