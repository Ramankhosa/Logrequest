"use client";

import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { format } from "date-fns";
import { StatusBadge } from "@/components/status-badge";
import { type TenantDirectoryRow } from "@/lib/tenant-admin/service";

type DirectoryTableRow = TenantDirectoryRow;

const columnHelper = createColumnHelper<DirectoryTableRow>();

const columns = [
  columnHelper.accessor("name", {
    header: "User",
    cell: (info) => (
      <div>
        <div className="text-sm font-semibold text-slate-900">{info.getValue()}</div>
        <div className="text-xs text-slate-500">{info.row.original.email}</div>
      </div>
    ),
  }),
  columnHelper.accessor("role", {
    header: "Role",
    cell: (info) => info.getValue(),
  }),
  columnHelper.accessor("status", {
    header: "Status",
    cell: (info) => <StatusBadge label={info.getValue()} />,
  }),
  columnHelper.accessor("invitation", {
    header: "Invitation",
    cell: (info) => <StatusBadge label={info.getValue()} tone="slate" />,
  }),
  columnHelper.accessor("lastAccess", {
    header: "Last access",
    cell: (info) => format(new Date(info.getValue()), "dd MMM yyyy"),
  }),
];

export function UsersTable({ data }: { data: DirectoryTableRow[] }) {
  // TanStack Table intentionally manages non-memoizable helpers internally.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="overflow-hidden rounded-[1.5rem] border border-slate-200/80 bg-white/80">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200/80 text-left">
          <thead className="bg-slate-50/80">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500"
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-slate-200/80">
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="align-top">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-4 text-sm text-slate-600">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-8 text-center text-sm text-slate-500"
                >
                  No users
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
