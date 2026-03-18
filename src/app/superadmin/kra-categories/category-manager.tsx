"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  AlertCircle,
  CheckCircle2,
  X,
  Globe,
  Check,
} from "lucide-react";

type CategoryView = {
  id: string;
  tenantId: string | null;
  scope: string;
  categoryKey: string;
  displayLabel: string;
  description: string | null;
  colorHex: string | null;
  sortOrder: number;
  isActive: boolean;
  kraCount: number;
};

export function SuperadminCategoryManager() {
  const [categories, setCategories] = useState<CategoryView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch("/api/superadmin/kra-categories");
      setCategories(await res.json());
    } catch {
      setError("Failed to load categories.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchCategories(); }, [fetchCategories]);

  const showFeedback = (type: "success" | "error", message: string) => {
    setFeedback({ type, message });
    setTimeout(() => setFeedback(null), 3500);
  };

  const handleDelete = async (cat: CategoryView) => {
    if (!window.confirm(`Delete global category "${cat.displayLabel}"?`)) return;
    setDeletingId(cat.id);
    try {
      const res = await fetch(`/api/superadmin/kra-categories/${cat.id}`, { method: "DELETE" });
      const data = await res.json();
      data.status === "success"
        ? (showFeedback("success", data.message), void fetchCategories())
        : showFeedback("error", data.message);
    } catch {
      showFeedback("error", "Delete failed.");
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>;

  if (error) return <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"><AlertCircle className="h-4 w-4 shrink-0" /> {error}</div>;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Global KRA Categories</h3>
          <p className="mt-0.5 text-xs text-slate-400">These categories are visible to all tenants across the platform.</p>
        </div>
        {!addingNew && (
          <button type="button" onClick={() => setAddingNew(true)} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800">
            <Plus className="h-4 w-4" /> Add global category
          </button>
        )}
      </div>

      {feedback && (
        <div className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm ${feedback.type === "success" ? "border-brand/20 bg-brand/5 text-brand" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
          {feedback.type === "success" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
          {feedback.message}
        </div>
      )}

      {addingNew && (
        <GlobalCategoryForm mode="create" onDone={() => { setAddingNew(false); showFeedback("success", "Global category created."); void fetchCategories(); }} onCancel={() => setAddingNew(false)} />
      )}

      {categories.length === 0 && !addingNew ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-200 py-12 text-center">
          <Globe className="h-8 w-8 text-slate-300" />
          <p className="text-sm font-medium text-slate-500">No global categories yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {categories.map((cat) =>
            editingId === cat.id ? (
              <GlobalCategoryForm key={cat.id} mode="edit" initial={cat} onDone={() => { setEditingId(null); showFeedback("success", "Category updated."); void fetchCategories(); }} onCancel={() => setEditingId(null)} />
            ) : (
              <div key={cat.id} className={`group flex items-center gap-3 rounded-xl border border-slate-200/80 bg-white px-4 py-3.5 transition hover:border-slate-300 ${!cat.isActive ? "opacity-50" : ""}`}>
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: cat.colorHex ? `${cat.colorHex}20` : undefined, color: cat.colorHex ?? undefined }}>
                  <Globe className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">{cat.displayLabel}</span>
                    <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-500">{cat.categoryKey}</span>
                    <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold uppercase text-blue-500">GLOBAL</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-3 text-[11px] text-slate-400">
                    <span>{cat.kraCount} KRA(s)</span>
                    <span>Order: {cat.sortOrder}</span>
                    {cat.description && <span className="truncate">{cat.description}</span>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button type="button" onClick={() => setEditingId(cat.id)} className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-blue-200 hover:text-blue-600"><Pencil className="h-3.5 w-3.5" /></button>
                  <button type="button" onClick={() => handleDelete(cat)} disabled={deletingId === cat.id} className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-rose-200 hover:text-rose-600 disabled:opacity-50">
                    {deletingId === cat.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
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

function GlobalCategoryForm({ mode, initial, onDone, onCancel }: {
  mode: "create" | "edit";
  initial?: CategoryView;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [categoryKey, setCategoryKey] = useState(initial?.categoryKey ?? "");
  const [displayLabel, setDisplayLabel] = useState(initial?.displayLabel ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [colorHex, setColorHex] = useState(initial?.colorHex ?? "#6366f1");
  const [sortOrder, setSortOrder] = useState(initial?.sortOrder ?? 0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const url = mode === "create" ? "/api/superadmin/kra-categories" : `/api/superadmin/kra-categories/${initial!.id}`;
      const body = mode === "create"
        ? { categoryKey, displayLabel: displayLabel.trim(), description: description.trim() || undefined, colorHex, sortOrder }
        : { displayLabel: displayLabel.trim(), description: description.trim() || null, colorHex, sortOrder };

      const res = await fetch(url, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      data.status === "error" ? (setError(data.message), setSubmitting(false)) : onDone();
    } catch {
      setError("Request failed.");
      setSubmitting(false);
    }
  };

  const inputCls = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-brand focus:ring-1 focus:ring-brand/30";

  return (
    <form onSubmit={handleSubmit} className={`rounded-xl border p-4 ${mode === "create" ? "border-brand/20 bg-brand/5" : "border-blue-200 bg-blue-50/50"}`}>
      <div className="mb-3 flex items-center justify-between">
        <span className={`text-xs font-semibold ${mode === "create" ? "text-brand" : "text-blue-600"}`}>{mode === "create" ? "New global category" : "Edit category"}</span>
        <button type="button" onClick={onCancel} className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 hover:text-slate-700"><X className="h-3.5 w-3.5" /></button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {mode === "create" && (
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Category key</label>
            <input type="text" placeholder="e.g. RESEARCH" value={categoryKey} onChange={(e) => setCategoryKey(e.target.value.toUpperCase())} className={`${inputCls} font-mono uppercase`} autoFocus />
          </div>
        )}
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Display label</label>
          <input type="text" placeholder="e.g. Research & Innovation" value={displayLabel} onChange={(e) => setDisplayLabel(e.target.value)} className={inputCls} autoFocus={mode === "edit"} />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Description</label>
          <input type="text" placeholder="Optional" value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} />
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Color</label>
            <input type="color" value={colorHex} onChange={(e) => setColorHex(e.target.value)} className="h-8 w-8 cursor-pointer rounded-lg border border-slate-200" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Order</label>
            <input type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} min={0} max={9999} className="w-20 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-brand" />
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button type="submit" disabled={submitting} className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-50 ${mode === "create" ? "bg-brand hover:bg-brand/90" : "bg-blue-600 hover:bg-blue-700"}`}>
          {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          {mode === "create" ? "Create" : "Save"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:border-slate-300">Cancel</button>
      </div>
      {error && <div className="mt-2 flex items-center gap-1.5 text-xs text-rose-600"><AlertCircle className="h-3 w-3 shrink-0" /> {error}</div>}
    </form>
  );
}
