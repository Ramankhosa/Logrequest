"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Archive,
  AlertCircle,
  Check,
  CheckCircle2,
  Loader2,
  Pencil,
  Plus,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { ExternalTemplateFieldBuilder } from "@/components/tenant/kra-kpi/external-template-field-builder";
import { BASE_EXTERNAL_CONTRIBUTOR_FIELDS } from "@/lib/kra-kpi/external-contrib-shared";
import type { AchievementFieldConfig } from "@/lib/kra-kpi/shared";

type ExternalTemplateRow = {
  id: string;
  name: string;
  description: string | null;
  fields: AchievementFieldConfig[];
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
  kpiConfigCount?: number;
};

function cloneFields(fields: AchievementFieldConfig[]): AchievementFieldConfig[] {
  return fields.map((field) => ({
    ...field,
    options: field.options ? [...field.options] : undefined,
  }));
}

export function ExternalTemplateManager() {
  const [rows, setRows] = useState<ExternalTemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(
    null,
  );
  const [addingNew, setAddingNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [defaultingId, setDefaultingId] = useState<string | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);

  const fetchRows = useCallback(async () => {
    try {
      const query = includeArchived ? "?includeArchived=true" : "";
      const response = await fetch(`/api/tenant/kra-kpi/external-contrib-templates${query}`);
      const data = await response.json();
      setRows(Array.isArray(data) ? data : []);
      setError(null);
    } catch {
      setError("Failed to load external contributor templates.");
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

  const handleArchive = async (row: ExternalTemplateRow) => {
    if (!window.confirm(`Archive external contributor template "${row.name}"?`)) {
      return;
    }

    setArchivingId(row.id);
    try {
      const response = await fetch(`/api/tenant/kra-kpi/external-contrib-templates/${row.id}`, {
        method: "DELETE",
      });
      const data = await response.json();
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

  const handleSetDefault = async (row: ExternalTemplateRow) => {
    setDefaultingId(row.id);
    try {
      const response = await fetch(
        `/api/tenant/kra-kpi/external-contrib-templates/${row.id}/default`,
        {
          method: "POST",
        },
      );
      const data = await response.json();
      if (data.status === "success") {
        showFeedback("success", data.message);
        void fetchRows();
      } else {
        showFeedback("error", data.message);
      }
    } catch {
      showFeedback("error", "Default update failed.");
    } finally {
      setDefaultingId(null);
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
          <h3 className="text-sm font-semibold text-slate-900">External Contributor Templates</h3>
          <p className="mt-0.5 text-xs text-slate-400">
            Define what data to capture for industry partners, collaborators, and other external contributors.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(event) => {
                setIncludeArchived(event.target.checked);
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
              Add template
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
        <ExternalTemplateForm
          mode="create"
          onDone={() => {
            setAddingNew(false);
            showFeedback("success", "External contributor template created.");
            void fetchRows();
          }}
          onCancel={() => setAddingNew(false)}
        />
      )}

      {rows.length === 0 && !addingNew ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-200 py-12 text-center">
          <Users className="h-8 w-8 text-slate-300" />
          <p className="text-sm font-medium text-slate-500">No external contributor templates</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((row) =>
            editingId === row.id ? (
              <ExternalTemplateForm
                key={row.id}
                mode="edit"
                initial={row}
                onDone={() => {
                  setEditingId(null);
                  showFeedback("success", "External contributor template updated.");
                  void fetchRows();
                }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <div
                key={row.id}
                className={`group flex flex-wrap items-center gap-3 rounded-xl border border-slate-200/80 bg-white px-4 py-3.5 transition hover:border-slate-300 ${!row.isActive ? "opacity-60" : ""}`}
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                  <Users className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">{row.name}</span>
                    {row.isDefault && (
                      <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                        Default
                      </span>
                    )}
                    {!row.isActive && (
                      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-500">
                        Archived
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-400">
                    Fields: {row.fields.length} · KPIs linked: {row.kpiConfigCount ?? 0} · Order:{" "}
                    {row.sortOrder}
                    {row.description ? ` · ${row.description}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  {!row.isDefault && row.isActive && (
                    <button
                      type="button"
                      onClick={() => void handleSetDefault(row)}
                      disabled={defaultingId === row.id}
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-emerald-200 hover:text-emerald-700 disabled:opacity-50"
                      title="Set default"
                    >
                      {defaultingId === row.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ShieldCheck className="h-3.5 w-3.5" />
                      )}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setEditingId(row.id)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-blue-200 hover:text-blue-600"
                    title="Edit"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  {row.isActive && (
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
                  )}
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

function ExternalTemplateForm({
  mode,
  initial,
  onDone,
  onCancel,
}: {
  mode: "create" | "edit";
  initial?: ExternalTemplateRow;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [sortOrder, setSortOrder] = useState(initial?.sortOrder ?? 0);
  const [fields, setFields] = useState<AchievementFieldConfig[]>(
    initial?.fields ? cloneFields(initial.fields) : cloneFields(BASE_EXTERNAL_CONTRIBUTOR_FIELDS),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const url =
        mode === "create"
          ? "/api/tenant/kra-kpi/external-contrib-templates"
          : `/api/tenant/kra-kpi/external-contrib-templates/${initial!.id}`;
      const body =
        mode === "create"
          ? {
              name: name.trim(),
              description: description.trim() || undefined,
              sortOrder,
              fields,
            }
          : {
              name: name.trim(),
              description: description.trim() || null,
              sortOrder,
              fields,
            };

      const response = await fetch(url, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (data.status === "error") {
        setError(data.message);
        setSubmitting(false);
        return;
      }

      onDone();
    } catch {
      setError("Request failed.");
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className={`rounded-xl border p-4 ${mode === "create" ? "border-brand/20 bg-brand/5" : "border-blue-200 bg-blue-50/50"}`}
    >
      <div className="mb-3 flex items-center justify-between">
        <span
          className={`text-xs font-semibold ${mode === "create" ? "text-brand" : "text-blue-600"}`}
        >
          {mode === "create" ? "New external contributor template" : "Edit external contributor template"}
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
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand/30"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Sort order
          </label>
          <input
            type="number"
            min={0}
            max={9999}
            value={sortOrder}
            onChange={(event) => setSortOrder(Number(event.target.value))}
            className="w-24 rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand/30"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Description
          </label>
          <textarea
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand/30"
          />
        </div>
        <div className="sm:col-span-2">
          <ExternalTemplateFieldBuilder value={fields} onChange={setFields} />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
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
      {error && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-rose-600">
          <AlertCircle className="h-3 w-3 shrink-0" /> {error}
        </div>
      )}
    </form>
  );
}
