"use client";

import { useState } from "react";
import { Loader2, Check, X, AlertCircle } from "lucide-react";
import { TooltipHint } from "./tooltip-hint";
import { TOOLTIPS } from "@/lib/kra-kpi/shared";

type KraFormProps = {
  mode: "create" | "edit";
  periodId: string;
  categories: { id: string; displayLabel: string }[];
  initial?: {
    id: string;
    categoryId: string | null;
    title: string;
    description: string | null;
    weightage: number;
    sortOrder: number;
  };
  onDone: () => void;
  onCancel: () => void;
};

export function KraDefinitionForm({ mode, periodId, categories, initial, onDone, onCancel }: KraFormProps) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [weightage, setWeightage] = useState(initial?.weightage ?? 0);
  const [sortOrder, setSortOrder] = useState(initial?.sortOrder ?? 0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const url = mode === "create"
        ? "/api/tenant/kra-kpi/kras"
        : `/api/tenant/kra-kpi/kras/${initial!.id}`;

      const body = mode === "create"
        ? {
            periodId,
            title: title.trim(),
            categoryId: categoryId || undefined,
            description: description.trim() || undefined,
            weightage,
            sortOrder,
          }
        : {
            title: title.trim(),
            categoryId: categoryId || null,
            description: description.trim() || null,
            weightage,
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

  const borderColor = mode === "create" ? "border-brand/20 bg-brand/5" : "border-blue-200 bg-blue-50/50";
  const labelCls = "mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500";
  const inputCls = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand focus:ring-1 focus:ring-brand/30";

  return (
    <form onSubmit={handleSubmit} className={`rounded-xl border ${borderColor} p-4`}>
      <div className="mb-3 flex items-center justify-between">
        <span className={`text-xs font-semibold ${mode === "create" ? "text-brand" : "text-blue-600"}`}>
          {mode === "create" ? "New KRA" : "Edit KRA"}
        </span>
        <button type="button" onClick={onCancel} className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 hover:text-slate-700">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelCls}>Title</label>
          <input type="text" placeholder="e.g. Research & Innovation" value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} autoFocus />
        </div>
        <div>
          <label className={labelCls}>Category</label>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputCls}>
            <option value="">No category</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.displayLabel}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>
            Weightage <TooltipHint text={TOOLTIPS.KRA_WEIGHTAGE} className="ml-1" />
          </label>
          <input type="number" value={weightage} onChange={(e) => setWeightage(Number(e.target.value))} min={0} max={100} className={inputCls} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>Description</label>
          <input type="text" placeholder="Optional" value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Sort order</label>
          <input type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} min={0} max={9999} className="w-24 rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand/30" />
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button type="submit" disabled={submitting} className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-50 ${mode === "create" ? "bg-brand hover:bg-brand/90" : "bg-blue-600 hover:bg-blue-700"}`}>
          {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          {mode === "create" ? "Create" : "Save"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300">Cancel</button>
      </div>
      {error && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-rose-600">
          <AlertCircle className="h-3 w-3 shrink-0" /> {error}
        </div>
      )}
    </form>
  );
}
