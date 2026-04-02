"use client";

import { useMemo, useState } from "react";
import type { TenantPermissionRole } from "@prisma/client";
import type {
  TenantPermissionAssignmentView,
  TenantPermissionRoleDefinition,
} from "@/lib/tenant-permissions/service";

type Props = {
  initialAssignments: TenantPermissionAssignmentView[];
  roleDefinitions: TenantPermissionRoleDefinition[];
};

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-slate-900";

export function AccessControlManager({ initialAssignments, roleDefinitions }: Props) {
  const [rows, setRows] = useState(initialAssignments);
  const [query, setQuery] = useState("");
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return rows;
    return rows.filter((row) =>
      [
        row.name,
        row.email,
        row.employeeId ?? "",
        row.designation ?? "",
        row.primaryUnitName ?? "",
        row.primaryUnitCode ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [query, rows]);

  function toggleRole(userId: string, roleCode: TenantPermissionRole) {
    setRows((current) =>
      current.map((row) =>
        row.userId !== userId
          ? row
          : {
              ...row,
              permissionRoles: row.permissionRoles.includes(roleCode)
                ? row.permissionRoles.filter((code) => code !== roleCode)
                : [...row.permissionRoles, roleCode].sort(),
            },
      ),
    );
  }

  async function saveRow(row: TenantPermissionAssignmentView) {
    setSavingUserId(row.userId);
    setFeedback(null);
    try {
      const response = await fetch("/api/tenant/access-control", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetUserId: row.userId,
          roleCodes: row.permissionRoles,
        }),
      });
      const payload = await response.json();
      if (!response.ok || payload.status === "error") {
        setFeedback({ type: "error", message: payload.message ?? "Failed to update access roles." });
        return;
      }
      setFeedback({ type: "success", message: `Updated access roles for ${row.name}.` });
    } catch {
      setFeedback({ type: "error", message: "Failed to update access roles." });
    } finally {
      setSavingUserId(null);
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-[1.75rem] border border-slate-200/80 bg-white/85 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              Tenant Access
            </p>
            <h2 className="text-lg font-semibold text-slate-900">Access Control</h2>
            <p className="text-sm text-slate-500">
              Assign additive permission roles without changing a person&apos;s base tenant membership.
            </p>
          </div>
          <div className="w-full max-w-sm">
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Search
            </label>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className={inputCls}
              placeholder="Name, employee id, unit, email..."
            />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {roleDefinitions.map((definition) => (
            <span
              key={definition.code}
              className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700"
              title={definition.description}
            >
              {definition.label}
            </span>
          ))}
        </div>
      </section>

      {feedback ? (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm ${
            feedback.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {feedback.message}
        </div>
      ) : null}

      <section className="overflow-hidden rounded-[1.75rem] border border-slate-200/80 bg-white/85">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200/80 text-left">
            <thead className="bg-slate-50/80">
              <tr>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Person</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Base Role</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Primary Unit</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Access Status</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Permission Roles</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/80">
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                    No matching users found.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => (
                  <tr key={row.userId} className="align-top">
                    <td className="px-4 py-4">
                      <div className="space-y-1">
                        <div className="text-sm font-semibold text-slate-900">{row.name}</div>
                        <div className="text-sm text-slate-500">{row.email}</div>
                        <div className="text-xs text-slate-400">
                          {row.employeeId ?? "No employee id"}
                          {row.designation ? ` · ${row.designation}` : ""}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-sm text-slate-600">{row.baseRole}</td>
                    <td className="px-4 py-4 text-sm text-slate-600">
                      {row.primaryUnitName ? `${row.primaryUnitName} (${row.primaryUnitCode})` : "—"}
                    </td>
                    <td className="px-4 py-4 text-sm text-slate-600">{row.membershipStatus}</td>
                    <td className="px-4 py-4">
                      <div className="grid gap-2 md:grid-cols-2">
                        {roleDefinitions.map((definition) => (
                          <label
                            key={`${row.userId}:${definition.code}`}
                            className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-sm text-slate-700"
                          >
                            <input
                              type="checkbox"
                              checked={row.permissionRoles.includes(definition.code)}
                              onChange={() => toggleRole(row.userId, definition.code)}
                              className="mt-0.5 h-4 w-4 rounded border-slate-300"
                            />
                            <span>
                              <span className="block font-medium text-slate-900">{definition.label}</span>
                              <span className="block text-xs text-slate-500">{definition.description}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <button
                        type="button"
                        onClick={() => void saveRow(row)}
                        disabled={savingUserId === row.userId}
                        className="inline-flex items-center rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {savingUserId === row.userId ? "Saving..." : "Save roles"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
