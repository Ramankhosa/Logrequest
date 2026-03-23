"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  Pencil,
  Loader2,
  AlertCircle,
  CheckCircle2,
  X,
  Check,
  Users,
  Archive,
} from "lucide-react";

type ContributorRoleRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  defaultCreditPercent: number;
  isActive: boolean;
  sortOrder: number;
};

export function ContributorRoleManager() {
  const [rows, setRows] = useState<ContributorRoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);

  const fetchRows = useCallback(async () => {
    try {
      const q = includeArchived ? "?includeArchived=true" : "";
      const res = await fetch(`/api/tenant/kra-kpi/contributor-roles${q}`);
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
      setError(null);
    } catch {
      setError("Failed to load contributor roles.");
    } finally {
      setLoading(false);
    }
  }, [includeArchived]);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  const showFeedback = (type: "success" | "error", message: string) => {
    setFeedback({ type, message });
    setTimeout(() => setFeedback(null), 3500);
  };

  const handleArchive = async (row: ContributorRoleRow) => {
    if (!window.confirm(`Archive contributor role "${row.name}"?`)) return;
    setArchivingId(row.id);
    try {
      const res = await fetch(`/api/tenant/kra-kpi/contributor-roles/${row.id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.status === "success") {
        showFeedback("success", data.message);
        void fetchRows();
      } else {
        showFeedback("error", data.message);
      }
    } catch {
      showFeedback("error", "Archive failed.");
    } finally {
      setArchivingId(null);
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Contributor Roles</h3>
          <p className="mt-0.5 text-xs text-slate-400">
            Roles people can play on achievements (PI, lead author, etc.). KPIs choose which apply.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => {
                setIncludeArchived(e.target.checked);
                setLoading(true);
              }}
              className="h-3.5 w-3.5 rounded border-slate-300 text-brand focus:ring-brand/30"
            />
            Show archived
          </label>
          {!addingNew && (
            <button
              type="button"
              onClick={() => setAddingNew(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              <Plus className="h-4 w-4" />
              Add role
            </button>
          )}
        </div>
      </div>

      {feedback && (
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
      )}

      {addingNew && (
        <ContributorRoleForm
          mode="create"
          onDone={() => {
            setAddingNew(false);
            showFeedback("success", "Contributor role created.");
            void fetchRows();
          }}
          onCancel={() => setAddingNew(false)}
        />
      )}

      {rows.length === 0 && !addingNew ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-200 py-12 text-center">
          <Users className="h-8 w-8 text-slate-300" />
          <p className="text-sm font-medium text-slate-500">No contributor roles</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row) =>
            editingId === row.id ? (
              <ContributorRoleForm
                key={row.id}
                mode="edit"
                initial={row}
                onDone={() => {
                  setEditingId(null);
                  showFeedback("success", "Contributor role updated.");
                  void fetchRows();
                }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <div
                key={row.id}
                className={`group flex flex-wrap items-center gap-3 rounded-xl border border-slate-200/80 bg-white px-4 py-3.5 transition hover:border-slate-300 ${!row.isActive ? "opacity-60" : ""}`}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
                  <Users className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">{row.name}</span>
                    <span className="rounded-lg bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-slate-500">
                      {row.code}
                    </span>
                    <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                      Default {row.defaultCreditPercent}%
                    </span>
                    {!row.isActive && (
                      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-500">
                        Archived
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-400">
                    Order: {row.sortOrder}
                    {row.description ? ` · ${row.description}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => setEditingId(row.id)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-blue-200 hover:text-blue-600"
                    title="Edit"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  {row.isActive ? (
                    <button
                      type="button"
                      onClick={() => void handleArchive(row)}
                      disabled={archivingId === row.id}
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-rose-200 hover:text-rose-600 disabled:opacity-50"
                      title="Archive"
                    >
                      {archivingId === row.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Archive className="h-3.5 w-3.5" />
                      )}
                    </button>
                  ) : null}
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

function ContributorRoleForm({
  mode,
  initial,
  onDone,
  onCancel,
}: {
  mode: "create" | "edit";
  initial?: ContributorRoleRow;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState(initial?.code ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [defaultCreditPercent, setDefaultCreditPercent] = useState(
    initial?.defaultCreditPercent?.toString() ?? "50",
  );
  const [description, setDescription] = useState(initial?.description ?? "");
  const [sortOrder, setSortOrder] = useState(initial?.sortOrder ?? 0);
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    const pct = Number(defaultCreditPercent);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      setErr("Default credit must be between 0 and 100.");
      return;
    }
    setSubmitting(true);
    try {
      const url =
        mode === "create"
          ? "/api/tenant/kra-kpi/contributor-roles"
          : `/api/tenant/kra-kpi/contributor-roles/${initial!.id}`;
      const body =
        mode === "create"
          ? {
              code: code.trim().toUpperCase(),
              name: name.trim(),
              defaultCreditPercent: pct,
              description: description.trim() || undefined,
              sortOrder,
            }
          : {
              name: name.trim(),
              defaultCreditPercent: pct,
              description: description.trim() || null,
              sortOrder,
              isActive,
            };
      const res = await fetch(url, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.status === "error") {
        setErr(data.message);
        setSubmitting(false);
      } else {
        onDone();
      }
    } catch {
      setErr("Request failed.");
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className={`rounded-xl border p-4 ${mode === "create" ? "border-brand/20 bg-brand/5" : "border-blue-200 bg-blue-50/50"}`}
    >
      <div className="mb-3 flex items-center justify-between">
        <span
          className={`text-xs font-semibold ${mode === "create" ? "text-brand" : "text-blue-600"}`}
        >
          {mode === "create" ? "New contributor role" : "Edit contributor role"}
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 hover:text-slate-700"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {mode === "create" && (
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Code
            </label>
            <input
              type="text"
              placeholder="LEAD_AUTHOR"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm uppercase outline-none focus:border-brand focus:ring-1 focus:ring-brand/30"
            />
          </div>
        )}
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand/30"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Default credit %
          </label>
          <input
            type="number"
            min={0}
            max={100}
            step={0.5}
            value={defaultCreditPercent}
            onChange={(e) => setDefaultCreditPercent(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand/30"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Description
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand/30"
          />
        </div>
        <div className="flex items-center gap-4">
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Sort order
            </label>
            <input
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(Number(e.target.value))}
              min={0}
              max={9999}
              className="w-24 rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand/30"
            />
          </div>
          {mode === "edit" && (
            <label className="mt-5 inline-flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand/30"
              />
              Active
            </label>
          )}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="submit"
          disabled={submitting}
          className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-50 ${mode === "create" ? "bg-brand hover:bg-brand/90" : "bg-blue-600 hover:bg-blue-700"}`}
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
          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300"
        >
          Cancel
        </button>
      </div>
      {err && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-rose-600">
          <AlertCircle className="h-3 w-3 shrink-0" /> {err}
        </div>
      )}
    </form>
  );
}
