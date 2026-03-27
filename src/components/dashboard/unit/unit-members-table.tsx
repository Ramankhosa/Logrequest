"use client";

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  CompletionBar,
  DataTable,
  ScoreBadge,
  StatusPill,
} from "@/components/dashboard/shared";
import type { UnitMemberSummary } from "@/lib/kra-kpi/dashboard-service";

type UnitMembersTableProps = {
  members: UnitMemberSummary[];
  loading?: boolean;
  showPrimaryUnitColumn: boolean;
  onSelectMember: (member: UnitMemberSummary) => void;
};

function getAlertLabel(level: UnitMemberSummary["alertLevel"]) {
  switch (level) {
    case "brand":
      return "Strong";
    case "blue":
      return "Healthy";
    case "amber":
      return "Watch";
    case "rose":
      return "At Risk";
    case "slate":
    default:
      return "No Activity";
  }
}

export function UnitMembersTable({
  members,
  loading = false,
  showPrimaryUnitColumn,
  onSelectMember,
}: UnitMembersTableProps) {
  const columns = useMemo<ColumnDef<UnitMemberSummary>[]>(
    () => [
      {
        header: "Member",
        cell: ({ row }) => (
          <div>
            <div className="font-semibold text-slate-900">{row.original.userName}</div>
            <div className="text-xs text-slate-500">
              {row.original.completedAllocations}/{row.original.totalAllocations} allocations complete
            </div>
          </div>
        ),
      },
      ...(showPrimaryUnitColumn
        ? [
            {
              header: "Primary Unit",
              cell: ({ row }) => (
                <span className="text-sm text-slate-600">{row.original.primaryUnitName}</span>
              ),
            } satisfies ColumnDef<UnitMemberSummary>,
          ]
        : []),
      {
        header: "Completion",
        cell: ({ row }) => (
          <div className="min-w-[160px]">
            <CompletionBar percent={row.original.completionPercent} />
          </div>
        ),
      },
      {
        header: "Avg Score",
        cell: ({ row }) => <ScoreBadge score={row.original.overallScore} size="sm" />,
      },
      {
        header: "Overdue",
        cell: ({ row }) => row.original.overdueCount,
      },
      {
        header: "Alert",
        cell: ({ row }) => (
          <StatusPill
            label={getAlertLabel(row.original.alertLevel)}
            tone={row.original.alertLevel}
          />
        ),
      },
    ],
    [showPrimaryUnitColumn],
  );

  return (
    <DataTable
      columns={columns}
      data={members}
      loading={loading}
      emptyState={{
        title: "No scoped members found",
        description: "This unit has no members or scoped KPI allocations for the selected period.",
      }}
      onRowClick={onSelectMember}
      mobileCardRenderer={(member) => (
        <button
          type="button"
          onClick={() => onSelectMember(member)}
          className="w-full rounded-[1.5rem] border border-slate-200/80 bg-white/75 p-4 text-left"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-semibold text-slate-900">{member.userName}</div>
              <div className="text-sm text-slate-500">{member.primaryUnitName}</div>
            </div>
            <ScoreBadge score={member.overallScore} size="sm" />
          </div>
          <div className="mt-4 space-y-3">
            <CompletionBar percent={member.completionPercent} />
            <div className="flex flex-wrap gap-2">
              <StatusPill
                label={`${member.completedAllocations}/${member.totalAllocations} complete`}
                tone="slate"
              />
              <StatusPill label={`${member.overdueCount} overdue`} tone="amber" />
              <StatusPill label={getAlertLabel(member.alertLevel)} tone={member.alertLevel} />
            </div>
          </div>
        </button>
      )}
    />
  );
}
