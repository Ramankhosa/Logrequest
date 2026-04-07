"use client";

import { useMemo, useState } from "react";
import type { TenantPermissionRole } from "@prisma/client";
import type {
  TenantPermissionAssignmentView,
  TenantPermissionRoleDefinition,
} from "@/lib/tenant-permissions/service";
import { SlideOver } from "@/components/dashboard/shared/slide-over";
import { Shield, ShieldAlert, CheckCircle2, Users } from "lucide-react";

type Props = {
  initialAssignments: TenantPermissionAssignmentView[];
  roleDefinitions: TenantPermissionRoleDefinition[];
};

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-slate-900";

export function AccessControlManager({ initialAssignments, roleDefinitions }: Props) {
  const [rows, setRows] = useState(initialAssignments);
  const [query, setQuery] = useState("");
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // View Mode
  const [viewMode, setViewMode] = useState<"person" | "role">("person");

  // --- Person-centric State ---
  const [selectedUser, setSelectedUser] = useState<TenantPermissionAssignmentView | null>(null);
  const [draftRoles, setDraftRoles] = useState<TenantPermissionRole[]>([]);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);

  // --- Role-centric State ---
  const [selectedRole, setSelectedRole] = useState<TenantPermissionRoleDefinition | null>(null);
  const [draftUserIds, setDraftUserIds] = useState<string[]>([]);
  const [isSavingMultiple, setIsSavingMultiple] = useState(false);
  const [slideOverSearch, setSlideOverSearch] = useState("");

  // --- Derived State ---
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

  const filteredSlideOverUsers = useMemo(() => {
    const normalized = slideOverSearch.trim().toLowerCase();
    if (!normalized) return rows;
    return rows.filter((row) =>
      [row.name, row.email, row.employeeId ?? "", row.primaryUnitName ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [slideOverSearch, rows]);

  // --- Person-centric Handlers ---
  function handleManageAccess(user: TenantPermissionAssignmentView) {
    setSelectedUser(user);
    setDraftRoles([...user.permissionRoles]);
    setFeedback(null);
  }

  function toggleDraftRole(roleCode: TenantPermissionRole) {
    setDraftRoles((current) =>
      current.includes(roleCode)
        ? current.filter((code) => code !== roleCode)
        : [...current, roleCode].sort(),
    );
  }

  async function saveRoles() {
    if (!selectedUser) return;
    
    setSavingUserId(selectedUser.userId);
    setFeedback(null);
    try {
      const response = await fetch("/api/tenant/access-control", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetUserId: selectedUser.userId,
          roleCodes: draftRoles,
        }),
      });
      const payload = await response.json();
      if (!response.ok || payload.status === "error") {
        setFeedback({ type: "error", message: payload.message ?? "Failed to update access roles." });
        return;
      }
      
      setRows((current) =>
        current.map((row) =>
          row.userId !== selectedUser.userId
            ? row
            : { ...row, permissionRoles: draftRoles },
        ),
      );
      
      setFeedback({ type: "success", message: `Updated access roles for ${selectedUser.name}.` });
      setSelectedUser(null);
    } catch {
      setFeedback({ type: "error", message: "Failed to update access roles." });
    } finally {
      setSavingUserId(null);
    }
  }

  // --- Role-centric Handlers ---
  function handleManageRole(role: TenantPermissionRoleDefinition) {
    setSelectedRole(role);
    setSlideOverSearch("");
    const usersWithRole = rows.filter((r) => r.permissionRoles.includes(role.code)).map((r) => r.userId);
    setDraftUserIds(usersWithRole);
    setFeedback(null);
  }

  function toggleDraftUser(userId: string) {
    setDraftUserIds((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId],
    );
  }

  async function saveRoleUsers() {
    if (!selectedRole) return;
    
    setIsSavingMultiple(true);
    setFeedback(null);
    
    try {
      const initialUserIds = rows
        .filter((r) => r.permissionRoles.includes(selectedRole.code))
        .map((r) => r.userId);

      const addedIds = draftUserIds.filter((id) => !initialUserIds.includes(id));
      const removedIds = initialUserIds.filter((id) => !draftUserIds.includes(id));
      const changedIds = [...addedIds, ...removedIds];

      if (changedIds.length === 0) {
        setSelectedRole(null);
        return;
      }

      // Process updates in parallel
      const updates = changedIds.map((userId) => {
        const user = rows.find((r) => r.userId === userId)!;
        const isAdding = addedIds.includes(userId);
        const newRoles = isAdding
          ? [...user.permissionRoles, selectedRole.code].sort()
          : user.permissionRoles.filter((code) => code !== selectedRole.code);

        return fetch("/api/tenant/access-control", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetUserId: userId,
            roleCodes: newRoles,
          }),
        }).then(async (res) => {
          if (!res.ok) throw new Error("Failed");
          return { userId, newRoles };
        });
      });

      const results = await Promise.all(updates);

      // Update local state
      setRows((current) =>
        current.map((row) => {
          const update = results.find((r) => r.userId === row.userId);
          return update ? { ...row, permissionRoles: update.newRoles } : row;
        })
      );

      setFeedback({ type: "success", message: `Updated users for role ${selectedRole.label}.` });
      setSelectedRole(null);
    } catch {
      setFeedback({ type: "error", message: "Failed to update some users. Please try again." });
    } finally {
      setIsSavingMultiple(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-[1.75rem] border border-slate-200/80 bg-white/85 p-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-4">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                Tenant Access
              </p>
              <h2 className="text-lg font-semibold text-slate-900">Access Control</h2>
              <p className="text-sm text-slate-500">
                Assign additive permission roles without changing a person&apos;s base tenant membership.
              </p>
            </div>
            
            <div className="inline-flex items-center gap-1 rounded-xl bg-slate-100/80 p-1">
              <button
                onClick={() => setViewMode("person")}
                className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${
                  viewMode === "person" 
                    ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200/50" 
                    : "text-slate-500 hover:text-slate-900"
                }`}
              >
                By Person
              </button>
              <button
                onClick={() => setViewMode("role")}
                className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${
                  viewMode === "role" 
                    ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200/50" 
                    : "text-slate-500 hover:text-slate-900"
                }`}
              >
                By Role
              </button>
            </div>
          </div>

          {viewMode === "person" && (
            <div className="w-full max-w-sm">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                Search People
              </label>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className={inputCls}
                placeholder="Name, employee id, unit, email..."
              />
            </div>
          )}
        </div>
      </section>

      {feedback && !selectedUser && !selectedRole ? (
        <div
          className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm ${
            feedback.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {feedback.type === "success" ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
          ) : (
            <ShieldAlert className="h-5 w-5 text-rose-500" />
          )}
          {feedback.message}
        </div>
      ) : null}

      <section className="space-y-3">
        {viewMode === "person" ? (
          filteredRows.length === 0 ? (
            <div className="rounded-[1.75rem] border border-slate-200/80 bg-white/85 p-8 text-center text-sm text-slate-500">
              No matching users found.
            </div>
          ) : (
            filteredRows.map((row) => (
              <div
                key={row.userId}
                className="flex flex-col gap-4 rounded-[1.75rem] border border-slate-200/80 bg-white/85 p-5 transition hover:border-slate-300 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-slate-900">{row.name}</h3>
                    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-slate-600">
                      {row.baseRole}
                    </span>
                    {row.membershipStatus !== "ACTIVE" && (
                      <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-700">
                        {row.membershipStatus}
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-slate-500">{row.email}</div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
                    {row.employeeId ? <span>ID: {row.employeeId}</span> : null}
                    {row.designation ? <span>{row.designation}</span> : null}
                    {row.primaryUnitName ? (
                      <span className="flex items-center gap-1">
                        <span className="h-1 w-1 rounded-full bg-slate-300" />
                        {row.primaryUnitName} ({row.primaryUnitCode})
                      </span>
                    ) : null}
                  </div>
                  
                  {row.permissionRoles.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5 pt-2">
                      {row.permissionRoles.map((roleCode) => {
                        const def = roleDefinitions.find((d) => d.code === roleCode);
                        return (
                          <span
                            key={roleCode}
                            className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700"
                          >
                            <Shield className="h-3 w-3" />
                            {def?.label || roleCode}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
                
                <div className="shrink-0 pt-2 sm:pt-0">
                  <button
                    type="button"
                    onClick={() => handleManageAccess(row)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-slate-900 sm:w-auto"
                  >
                    Manage Access
                  </button>
                </div>
              </div>
            ))
          )
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {roleDefinitions.map((role) => {
              const assignedCount = rows.filter((r) => r.permissionRoles.includes(role.code)).length;
              
              return (
                <div
                  key={role.code}
                  className="flex flex-col justify-between rounded-[1.75rem] border border-slate-200/80 bg-white/85 p-5 transition hover:border-slate-300"
                >
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
                        <Shield className="h-4 w-4" />
                      </div>
                      <h3 className="text-base font-semibold text-slate-900">{role.label}</h3>
                    </div>
                    <p className="text-sm text-slate-500">{role.description}</p>
                    <div className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                      <Users className="h-4 w-4 text-slate-400" />
                      {assignedCount} {assignedCount === 1 ? "person" : "people"} assigned
                    </div>
                  </div>
                  <div className="mt-6">
                    <button
                      type="button"
                      onClick={() => handleManageRole(role)}
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-slate-900"
                    >
                      Manage Users
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* SlideOver for Person-centric view */}
      <SlideOver
        open={!!selectedUser}
        onClose={() => {
          setSelectedUser(null);
          setFeedback(null);
        }}
        title="Manage Access Roles"
        subtitle={selectedUser ? `Editing roles for ${selectedUser.name}` : undefined}
      >
        {selectedUser && (
          <div className="flex h-full flex-col">
            <div className="flex-1 space-y-6">
              {feedback && selectedUser ? (
                <div
                  className={`rounded-xl border px-4 py-3 text-sm ${
                    feedback.type === "success"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-rose-200 bg-rose-50 text-rose-700"
                  }`}
                >
                  {feedback.message}
                </div>
              ) : null}

              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-900">Available Roles</h3>
                <div className="grid gap-3">
                  {roleDefinitions.map((definition) => {
                    const isSelected = draftRoles.includes(definition.code);
                    return (
                      <label
                        key={definition.code}
                        className={`relative flex cursor-pointer items-start gap-4 rounded-2xl border p-4 transition-colors ${
                          isSelected
                            ? "border-indigo-600 bg-indigo-50/50 ring-1 ring-indigo-600"
                            : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex h-5 items-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleDraftRole(definition.code)}
                            className="h-5 w-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600"
                          />
                        </div>
                        <div className="flex-1">
                          <span className={`block font-medium ${isSelected ? "text-indigo-900" : "text-slate-900"}`}>
                            {definition.label}
                          </span>
                          <span className={`mt-1 block text-sm ${isSelected ? "text-indigo-700" : "text-slate-500"}`}>
                            {definition.description}
                          </span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="sticky bottom-0 -mx-5 -mb-5 mt-8 border-t border-slate-200 bg-white p-5">
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedUser(null)}
                  className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void saveRoles()}
                  disabled={savingUserId === selectedUser.userId}
                  className="inline-flex items-center justify-center rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {savingUserId === selectedUser.userId ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </div>
          </div>
        )}
      </SlideOver>

      {/* SlideOver for Role-centric view */}
      <SlideOver
        open={!!selectedRole}
        onClose={() => {
          setSelectedRole(null);
          setFeedback(null);
        }}
        title="Manage Users"
        subtitle={selectedRole ? `Assigning users to ${selectedRole.label}` : undefined}
      >
        {selectedRole && (
          <div className="flex h-full flex-col">
            <div className="flex-1 space-y-6">
              {feedback && selectedRole ? (
                <div
                  className={`rounded-xl border px-4 py-3 text-sm ${
                    feedback.type === "success"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-rose-200 bg-rose-50 text-rose-700"
                  }`}
                >
                  {feedback.message}
                </div>
              ) : null}

              <div className="space-y-4">
                <input
                  value={slideOverSearch}
                  onChange={(e) => setSlideOverSearch(e.target.value)}
                  placeholder="Search people..."
                  className={inputCls}
                />
                
                <div className="space-y-2">
                  {filteredSlideOverUsers.length === 0 ? (
                    <p className="py-4 text-center text-sm text-slate-500">No users found.</p>
                  ) : (
                    filteredSlideOverUsers.map((user) => {
                      const isSelected = draftUserIds.includes(user.userId);
                      return (
                        <label
                          key={user.userId}
                          className={`relative flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors ${
                            isSelected
                              ? "border-indigo-600 bg-indigo-50/50 ring-1 ring-indigo-600"
                              : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                          }`}
                        >
                          <div className="flex h-5 items-center">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleDraftUser(user.userId)}
                              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600"
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="truncate text-sm font-medium text-slate-900">
                              {user.name}
                            </div>
                            <div className="truncate text-xs text-slate-500">
                              {user.email}
                              {user.primaryUnitName ? ` · ${user.primaryUnitName}` : ""}
                            </div>
                          </div>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            <div className="sticky bottom-0 -mx-5 -mb-5 mt-8 border-t border-slate-200 bg-white p-5">
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedRole(null)}
                  className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void saveRoleUsers()}
                  disabled={isSavingMultiple}
                  className="inline-flex items-center justify-center rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSavingMultiple ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </div>
          </div>
        )}
      </SlideOver>
    </div>
  );
}
