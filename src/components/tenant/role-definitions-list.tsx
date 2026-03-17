"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  AlertCircle,
  CheckCircle2,
  X,
  Shield,
  Crown,
  Users,
  Check,
} from "lucide-react";

type RoleDefinition = {
  id: string;
  roleKey: string;
  displayLabel: string;
  description: string | null;
  isUnitHead: boolean;
  approvalAuthority: boolean;
  maxPerUnit: number;
  sortOrder: number;
  isActive: boolean;
  assignmentCount: number;
};

export function RoleDefinitionsList() {
  const router = useRouter();
  const [roles, setRoles] = useState<RoleDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchRoles = useCallback(async () => {
    try {
      const res = await fetch("/api/tenant/structure/roles");
      const data = await res.json();
      if (data.status === "success") {
        setRoles(data.data);
      } else {
        setError(data.message ?? "Failed to load roles.");
      }
    } catch {
      setError("Failed to load role definitions.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRoles();
  }, [fetchRoles]);

  const handleCreated = () => {
    setAddingNew(false);
    setFeedback({ type: "success", message: "Role created." });
    void fetchRoles();
    setTimeout(() => setFeedback(null), 3000);
  };

  const handleUpdated = () => {
    setEditingId(null);
    setFeedback({ type: "success", message: "Role updated." });
    void fetchRoles();
    setTimeout(() => setFeedback(null), 3000);
  };

  const handleDelete = async (role: RoleDefinition) => {
    if (!window.confirm(`Delete role "${role.displayLabel}"?`)) return;
    setDeletingId(role.id);

    try {
      const res = await fetch(`/api/tenant/structure/roles/${role.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.status === "success") {
        setFeedback({ type: "success", message: data.message });
        void fetchRoles();
      } else {
        setFeedback({ type: "error", message: data.message });
      }
    } catch {
      setFeedback({ type: "error", message: "Delete failed." });
    } finally {
      setDeletingId(null);
      setTimeout(() => setFeedback(null), 4000);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        <AlertCircle className="h-4 w-4 shrink-0" />
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Role definitions
          </h3>
          <p className="mt-0.5 text-xs text-slate-400">
            Define the roles available in your organization hierarchy
          </p>
        </div>
        {!addingNew ? (
          <button
            type="button"
            onClick={() => setAddingNew(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            <Plus className="h-4 w-4" />
            Add role
          </button>
        ) : null}
      </div>

      {/* Feedback */}
      {feedback ? (
        <div
          className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm ${
            feedback.type === "success"
              ? "border-brand/20 bg-brand/5 text-brand"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {feedback.type === "success" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          {feedback.message}
        </div>
      ) : null}

      {/* Add form */}
      {addingNew ? (
        <RoleForm
          mode="create"
          onDone={handleCreated}
          onCancel={() => setAddingNew(false)}
        />
      ) : null}

      {/* Role list */}
      {roles.length === 0 && !addingNew ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-200 py-12 text-center">
          <Shield className="h-8 w-8 text-slate-300" />
          <div>
            <p className="text-sm font-medium text-slate-500">
              No roles defined yet
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Add roles like &ldquo;Vice-Chancellor&rdquo;,
              &ldquo;Head of School&rdquo;, or &ldquo;Faculty
              Member&rdquo;
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {roles.map((role) =>
            editingId === role.id ? (
              <RoleForm
                key={role.id}
                mode="edit"
                initial={role}
                onDone={handleUpdated}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <div
                key={role.id}
                className={`group flex items-center gap-3 rounded-xl border border-slate-200/80 bg-white px-4 py-3.5 transition hover:border-slate-300 ${
                  !role.isActive ? "opacity-50" : ""
                }`}
              >
                {/* Icon */}
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                  {role.isUnitHead ? (
                    <Crown className="h-4 w-4" />
                  ) : role.approvalAuthority ? (
                    <Shield className="h-4 w-4" />
                  ) : (
                    <Users className="h-4 w-4" />
                  )}
                </div>

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">
                      {role.displayLabel}
                    </span>
                    <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-500">
                      {role.roleKey}
                    </span>
                    {!role.isActive ? (
                      <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-500">
                        Inactive
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 flex items-center gap-3 text-[11px] text-slate-400">
                    {role.isUnitHead ? (
                      <span className="font-medium text-brand">
                        Unit head
                      </span>
                    ) : null}
                    {role.approvalAuthority ? (
                      <span>Can approve</span>
                    ) : null}
                    <span>
                      Max/unit:{" "}
                      {role.maxPerUnit === -1
                        ? "Unlimited"
                        : role.maxPerUnit}
                    </span>
                    <span>Order: {role.sortOrder}</span>
                    <span>
                      {role.assignmentCount} assignment(s)
                    </span>
                  </div>
                  {role.description ? (
                    <p className="mt-0.5 text-xs text-slate-400">
                      {role.description}
                    </p>
                  ) : null}
                </div>

                {/* Actions */}
                <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => setEditingId(role.id)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-blue-200 hover:text-blue-600"
                    title="Edit"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(role)}
                    disabled={deletingId === role.id}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-rose-200 hover:text-rose-600 disabled:opacity-50"
                    title="Delete"
                  >
                    {deletingId === role.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

// ── Role Form ────────────────────────────────────────────────────────────────

function RoleForm({
  mode,
  initial,
  onDone,
  onCancel,
}: {
  mode: "create" | "edit";
  initial?: RoleDefinition;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [roleKey, setRoleKey] = useState(initial?.roleKey ?? "");
  const [displayLabel, setDisplayLabel] = useState(
    initial?.displayLabel ?? "",
  );
  const [description, setDescription] = useState(
    initial?.description ?? "",
  );
  const [isUnitHead, setIsUnitHead] = useState(initial?.isUnitHead ?? false);
  const [approvalAuthority, setApprovalAuthority] = useState(
    initial?.approvalAuthority ?? false,
  );
  const [maxPerUnit, setMaxPerUnit] = useState(
    initial?.maxPerUnit ?? -1,
  );
  const [sortOrder, setSortOrder] = useState(initial?.sortOrder ?? 0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (mode === "create" && !/^[A-Z0-9_]{2,50}$/.test(roleKey)) {
      setError(
        "Role key must be 2-50 uppercase letters, numbers, or underscores.",
      );
      return;
    }
    if (displayLabel.trim().length < 2) {
      setError("Display label must be at least 2 characters.");
      return;
    }

    setSubmitting(true);

    try {
      const url =
        mode === "create"
          ? "/api/tenant/structure/roles"
          : `/api/tenant/structure/roles/${initial!.id}`;

      const body =
        mode === "create"
          ? {
              roleKey,
              displayLabel: displayLabel.trim(),
              description: description.trim() || undefined,
              isUnitHead,
              approvalAuthority,
              maxPerUnit,
              sortOrder,
            }
          : {
              displayLabel: displayLabel.trim(),
              description: description.trim() || null,
              isUnitHead,
              approvalAuthority,
              maxPerUnit,
              sortOrder,
            };

      const res = await fetch(url, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (data.status === "error") {
        setError(data.message);
        setSubmitting(false);
      } else {
        onDone();
      }
    } catch {
      setError("Request failed.");
      setSubmitting(false);
    }
  };

  const borderColor =
    mode === "create" ? "border-brand/20 bg-brand/5" : "border-blue-200 bg-blue-50/50";

  return (
    <form
      onSubmit={handleSubmit}
      className={`rounded-xl border ${borderColor} p-4`}
    >
      <div className="mb-3 flex items-center justify-between">
        <span
          className={`text-xs font-semibold ${mode === "create" ? "text-brand" : "text-blue-600"}`}
        >
          {mode === "create" ? "New role" : "Edit role"}
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white hover:text-slate-700"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {/* Role key (create only) */}
        {mode === "create" ? (
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Role key
            </label>
            <input
              type="text"
              placeholder="e.g. HEAD_OF_SCHOOL"
              value={roleKey}
              onChange={(e) => setRoleKey(e.target.value.toUpperCase())}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 uppercase outline-none placeholder:text-slate-400 focus:border-brand focus:ring-1 focus:ring-brand/30"
              autoFocus
            />
          </div>
        ) : null}

        {/* Display label */}
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Display label
          </label>
          <input
            type="text"
            placeholder="e.g. Head of School"
            value={displayLabel}
            onChange={(e) => setDisplayLabel(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand focus:ring-1 focus:ring-brand/30"
            autoFocus={mode === "edit"}
          />
        </div>

        {/* Description */}
        <div className="sm:col-span-2">
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Description (optional)
          </label>
          <input
            type="text"
            placeholder="Brief description of this role"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand focus:ring-1 focus:ring-brand/30"
          />
        </div>

        {/* Flags row */}
        <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={isUnitHead}
              onChange={(e) => setIsUnitHead(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand/30"
            />
            Unit head
          </label>
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={approvalAuthority}
              onChange={(e) => setApprovalAuthority(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand/30"
            />
            Approval authority
          </label>

          <div className="flex items-center gap-2">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Max/unit
            </label>
            <input
              type="number"
              value={maxPerUnit}
              onChange={(e) => setMaxPerUnit(Number(e.target.value))}
              min={-1}
              max={1000}
              className="w-20 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 outline-none focus:border-brand focus:ring-1 focus:ring-brand/30"
            />
            <span className="text-[10px] text-slate-400">-1 = unlimited</span>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Order
            </label>
            <input
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(Number(e.target.value))}
              min={0}
              max={9999}
              className="w-20 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 outline-none focus:border-brand focus:ring-1 focus:ring-brand/30"
            />
          </div>
        </div>
      </div>

      {/* Submit */}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="submit"
          disabled={submitting}
          className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-50 ${
            mode === "create"
              ? "bg-brand hover:bg-brand/90"
              : "bg-blue-600 hover:bg-blue-700"
          }`}
        >
          {submitting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          {mode === "create" ? "Create" : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300"
        >
          Cancel
        </button>
      </div>

      {error ? (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-rose-600">
          <AlertCircle className="h-3 w-3 shrink-0" />
          {error}
        </div>
      ) : null}
    </form>
  );
}
