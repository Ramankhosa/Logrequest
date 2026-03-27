"use client";

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ChevronRight } from "lucide-react";
import {
  CompletionBar,
  DataTable,
  ScoreBadge,
  StatusPill,
} from "@/components/dashboard/shared";
import type { OrgHierarchyUnit } from "@/lib/kra-kpi/dashboard-service";

type UnitChildrenTableProps = {
  units: OrgHierarchyUnit[];
  loading?: boolean;
  onDrillDown: (unitId: string) => void;
};

export function UnitChildrenTable({
  units,
  loading = false,
  onDrillDown,
}: UnitChildrenTableProps) {
  const data = useMemo(
    () =>
      [...units].sort((left, right) =>
        left.completionPercent === right.completionPercent
          ? left.unitName.localeCompare(right.unitName)
          : left.completionPercent - right.completionPercent,
      ),
    [units],
  );

  const columns = useMemo<ColumnDef<OrgHierarchyUnit>[]>(
    () => [
      {
        header: "Unit",
        cell: ({ row }) => (
          <div>
            <div className="font-semibold text-slate-900">{row.original.unitName}</div>
            <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
              <span>{row.original.unitCode}</span>
              <StatusPill label={row.original.category} tone="slate" />
            </div>
          </div>
        ),
      },
      {
        header: "Allocations",
        cell: ({ row }) => row.original.totalAllocations,
      },
      {
        header: "Completed",
        cell: ({ row }) => row.original.completedAllocations,
      },
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
        cell: ({ row }) => <ScoreBadge score={row.original.averageScore} size="sm" />,
      },
      {
        header: "→",
        cell: () => <ChevronRight className="h-4 w-4 text-slate-400" />,
      },
    ],
    [],
  );

  return (
    <DataTable
      columns={columns}
      data={data}
      loading={loading}
      emptyState={{
        title: "No sub-units under this node",
        description: "There are no visible child units in the current organization scope.",
      }}
      onRowClick={(row) => onDrillDown(row.unitId)}
      mobileCardRenderer={(unit) => (
        <button
          type="button"
          onClick={() => onDrillDown(unit.unitId)}
          className="w-full rounded-[1.5rem] border border-slate-200/80 bg-white/75 p-4 text-left"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-semibold text-slate-900">{unit.unitName}</div>
              <div className="mt-1 text-sm text-slate-500">
                {unit.unitCode} | {unit.category}
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-slate-400" />
          </div>
          <div className="mt-4 space-y-3">
            <CompletionBar percent={unit.completionPercent} />
            <div className="flex flex-wrap gap-2">
              <ScoreBadge score={unit.averageScore} size="sm" />
              <StatusPill label={`${unit.totalAllocations} allocations`} tone="slate" />
            </div>
          </div>
        </button>
      )}
    />
  );
}
