"use client";

import { useEffect, useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type PaginationState,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState } from "./empty-state";
import { SkeletonCard } from "./skeleton-card";

export type DataTableProps<T> = {
  columns: ColumnDef<T>[];
  data: T[];
  loading?: boolean;
  emptyState?: { title: string; description: string };
  sortable?: boolean;
  pagination?: { pageSize: number };
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string;
  mobileCardRenderer?: (row: T) => React.ReactNode;
};

export function DataTable<T>({
  columns,
  data,
  loading = false,
  emptyState,
  sortable = true,
  pagination = { pageSize: 10 },
  onRowClick,
  rowClassName,
  mobileCardRenderer,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [paginationState, setPaginationState] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: pagination.pageSize,
  });

  useEffect(() => {
    setPaginationState((current) => ({ ...current, pageSize: pagination.pageSize }));
  }, [pagination.pageSize]);

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      pagination: paginationState,
    },
    onSortingChange: sortable ? setSorting : undefined,
    onPaginationChange: setPaginationState,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: sortable ? getSortedRowModel() : undefined,
    getPaginationRowModel: getPaginationRowModel(),
  });

  const visibleRows = table.getRowModel().rows;
  const totalRows = table.getFilteredRowModel().rows.length;
  const pageStart = totalRows === 0 ? 0 : paginationState.pageIndex * paginationState.pageSize + 1;
  const pageEnd = Math.min(totalRows, pageStart + visibleRows.length - 1);
  const pageSizeOptions = useMemo(() => [10, 25, 50], []);

  if (loading) {
    return (
      <div className="space-y-3">
        <SkeletonCard variant="table-row" count={5} />
      </div>
    );
  }

  if (data.length === 0 && emptyState) {
    return (
      <EmptyState
        title={emptyState.title}
        description={emptyState.description}
      />
    );
  }

  return (
    <div className="space-y-4">
      {mobileCardRenderer ? (
        <div className="space-y-3 md:hidden">
          {visibleRows.map((row) => (
            <div key={row.id}>{mobileCardRenderer(row.original)}</div>
          ))}
        </div>
      ) : null}

      <div className={cn(mobileCardRenderer ? "hidden md:block" : "block")}>
        <div className="overflow-hidden rounded-[1.5rem] border border-slate-200/80 bg-white/75">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50/90">
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map((header) => {
                      const canSort = sortable && header.column.getCanSort();
                      const sortState = header.column.getIsSorted();
                      return (
                        <th
                          key={header.id}
                          scope="col"
                          className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500"
                        >
                          {header.isPlaceholder ? null : canSort ? (
                            <button
                              type="button"
                              onClick={header.column.getToggleSortingHandler()}
                              className="inline-flex items-center gap-1 transition hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/25"
                            >
                              {flexRender(header.column.columnDef.header, header.getContext())}
                              {sortState === "asc" ? (
                                <ArrowUp className="h-3.5 w-3.5" />
                              ) : sortState === "desc" ? (
                                <ArrowDown className="h-3.5 w-3.5" />
                              ) : null}
                            </button>
                          ) : (
                            flexRender(header.column.columnDef.header, header.getContext())
                          )}
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white/85">
                {visibleRows.map((row) => (
                  <tr
                    key={row.id}
                    tabIndex={onRowClick ? 0 : undefined}
                    onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                    onKeyDown={
                      onRowClick
                        ? (event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              onRowClick(row.original);
                            }
                          }
                        : undefined
                    }
                    className={cn(
                      "transition hover:bg-slate-50/80",
                      onRowClick && "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/20",
                      rowClassName?.(row.original),
                    )}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-4 py-3 align-top text-slate-600">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
        <div>
          Showing {pageStart}-{pageEnd} of {totalRows}
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            Page size
          </label>
          <select
            value={paginationState.pageSize}
            onChange={(event) =>
              setPaginationState({ pageIndex: 0, pageSize: Number(event.target.value) })
            }
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
          >
            {pageSizeOptions.map((pageSize) => (
              <option key={pageSize} value={pageSize}>
                {pageSize}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
