"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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

type ActionState = {
  status: "idle" | "pending" | "success" | "error";
  message: string;
};

const idleActionState: ActionState = {
  status: "idle",
  message: "",
};

export function UsersTable({
  data,
  isTenantOwner = false,
}: {
  data: DirectoryTableRow[];
  isTenantOwner?: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(data);
  const [actionState, setActionState] = useState<Record<string, ActionState>>({});

  useEffect(() => {
    setRows(data);
  }, [data]);

  const setRowAction = useCallback((membershipId: string, nextState: ActionState) => {
    setActionState((current) => ({
      ...current,
      [membershipId]: nextState,
    }));
  }, []);

  const handleRoleChange = useCallback(
    async (membershipId: string, nextRole: string) => {
      if (!confirm("Demote this admin to a tenant user?")) {
        return;
      }

      setRowAction(membershipId, {
        status: "pending",
        message: "Updating role...",
      });

      try {
        const response = await fetch(`/api/tenant/users/${membershipId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ role: nextRole }),
        });

        const result = (await response.json()) as {
          status: "success" | "error";
          message: string;
        };

        if (result.status === "success") {
          setRows((current) =>
            current.map((row) =>
              row.id === membershipId ? { ...row, role: nextRole } : row,
            ),
          );
          router.refresh();
          setRowAction(membershipId, {
            status: "success",
            message: result.message,
          });
        } else {
          setRowAction(membershipId, {
            status: "error",
            message: result.message ?? "Role update failed.",
          });
        }
      } catch {
        setRowAction(membershipId, {
          status: "error",
          message: "Role update failed.",
        });
      }
    },
    [router, setRowAction],
  );

  const handleRevoke = useCallback(
    async (membershipId: string) => {
      if (!confirm("Revoke this user's membership?")) {
        return;
      }

      setRowAction(membershipId, {
        status: "pending",
        message: "Revoking membership...",
      });

      try {
        const response = await fetch(`/api/tenant/users/${membershipId}`, {
          method: "DELETE",
        });

        const result = (await response.json()) as {
          status: "success" | "error";
          message: string;
        };

        if (result.status === "success") {
          setRows((current) =>
            current.map((row) =>
              row.id === membershipId
                ? {
                    ...row,
                    status: "REVOKED",
                    invitation: "REVOKED",
                  }
                : row,
            ),
          );
          router.refresh();
          setRowAction(membershipId, {
            status: "success",
            message: result.message,
          });
        } else {
          setRowAction(membershipId, {
            status: "error",
            message: result.message ?? "Membership revoke failed.",
          });
        }
      } catch {
        setRowAction(membershipId, {
          status: "error",
          message: "Membership revoke failed.",
        });
      }
    },
    [router, setRowAction],
  );

  const columns = useMemo(() => {
    const baseColumns = [
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

    if (!isTenantOwner) {
      return baseColumns;
    }

    return [
      ...baseColumns,
      columnHelper.display({
        id: "actions",
        header: "Actions",
        cell: (info) => {
          const row = info.row.original;
          const currentState = actionState[row.id] ?? idleActionState;
          const isPending = currentState.status === "pending";
          const canDemote = row.role === "TENANT_ADMIN";
          const canRevoke =
            row.role !== "TENANT_OWNER" && row.status !== "REVOKED";

          if (!canDemote && !canRevoke) {
            return <span className="text-xs text-slate-400">--</span>;
          }

          return (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {canDemote ? (
                  <button
                    className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 transition hover:border-slate-300 disabled:opacity-50"
                    type="button"
                    onClick={() => handleRoleChange(row.id, "TENANT_USER")}
                    disabled={isPending}
                  >
                    Demote
                  </button>
                ) : null}
                {canRevoke ? (
                  <button
                    className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 transition hover:border-rose-300 disabled:opacity-50"
                    type="button"
                    onClick={() => handleRevoke(row.id)}
                    disabled={isPending}
                  >
                    Revoke
                  </button>
                ) : null}
              </div>
              {currentState.status !== "idle" ? (
                <div
                  className={
                    currentState.status === "error"
                      ? "text-xs text-rose-600"
                      : "text-xs text-slate-500"
                  }
                >
                  {currentState.message}
                </div>
              ) : null}
            </div>
          );
        },
      }),
    ];
  }, [actionState, handleRevoke, handleRoleChange, isTenantOwner]);

  // TanStack Table intentionally manages non-memoizable helpers internally.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows,
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
