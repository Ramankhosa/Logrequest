"use client";

import { useState } from "react";
import { Loader2, Check, X, AlertCircle, Plus, Trash2 } from "lucide-react";
import { TooltipHint } from "./tooltip-hint";
import { TOOLTIPS } from "@/lib/kra-kpi/shared";

type Distribution = {
  assignedToUnitId?: string;
  assignedToUserId?: string;
  targetValue?: number;
  notes?: string;
};

type CascadeFormProps = {
  parentAllocationId: string;
  parentTargetValue: number | null;
  measurementType: string;
  units: { id: string; name: string }[];
  users: { id: string; name: string }[];
  onDone: () => void;
  onCancel: () => void;
};

export function TargetCascadeForm({
  parentAllocationId,
  parentTargetValue,
  measurementType,
  units,
  users,
  onDone,
  onCancel,
}: CascadeFormProps) {
  const isSummable = ["NUMERIC", "CURRENCY"].includes(measurementType);
  const [distributions, setDistributions] = useState<Distribution[]>([
    { targetValue: undefined },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addRow = () => setDistributions((d) => [...d, { targetValue: undefined }]);

  const removeRow = (idx: number) => {
    setDistributions((d) => d.filter((_, i) => i !== idx));
  };

  const updateRow = (idx: number, field: keyof Distribution, value: unknown) => {
    setDistributions((d) =>
      d.map((row, i) => (i === idx ? { ...row, [field]: value } : row)),
    );
  };

  const childSum = distributions.reduce((s, d) => s + (d.targetValue ?? 0), 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (distributions.length === 0) {
      setError("Add at least one distribution.");
      return;
    }

    if (isSummable && parentTargetValue != null && Math.abs(childSum - parentTargetValue) > 0.01) {
      setError(`Child values must sum to ${parentTargetValue}. Current sum: ${childSum}.`);
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch(`/api/tenant/kra-kpi/targets/${parentAllocationId}/cascade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ distributions }),
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

  const labelCls = "mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500";
  const inputCls = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand focus:ring-1 focus:ring-brand/30";

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <span className="text-xs font-semibold text-amber-700">Cascade target</span>
          <TooltipHint text={TOOLTIPS.TARGET_CASCADE} className="ml-1.5" />
        </div>
        <button type="button" onClick={onCancel} className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 hover:text-slate-700">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {isSummable && parentTargetValue != null && (
        <div className="mb-3 flex items-center gap-3 text-xs text-slate-600">
          <span>Parent target: <strong>{parentTargetValue}</strong></span>
          <span className={childSum === parentTargetValue ? "font-semibold text-emerald-600" : "font-semibold text-amber-600"}>
            Child sum: {childSum}
          </span>
        </div>
      )}

      <div className="space-y-2">
        {distributions.map((dist, idx) => (
          <div key={idx} className="flex items-end gap-2 rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex-1">
              <label className={labelCls}>Unit</label>
              <select value={dist.assignedToUnitId ?? ""} onChange={(e) => updateRow(idx, "assignedToUnitId", e.target.value || undefined)} className={inputCls}>
                <option value="">Select unit...</option>
                {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className={labelCls}>User (optional)</label>
              <select value={dist.assignedToUserId ?? ""} onChange={(e) => updateRow(idx, "assignedToUserId", e.target.value || undefined)} className={inputCls}>
                <option value="">No user</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            {isSummable && (
              <div className="w-28">
                <label className={labelCls}>Value</label>
                <input type="number" step="any" value={dist.targetValue ?? ""} onChange={(e) => updateRow(idx, "targetValue", e.target.value ? Number(e.target.value) : undefined)} className={inputCls} />
              </div>
            )}
            <button type="button" onClick={() => removeRow(idx)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-400 transition hover:border-rose-200 hover:text-rose-600">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      <button type="button" onClick={addRow} className="mt-2 inline-flex items-center gap-1 rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-500 transition hover:border-slate-400 hover:text-slate-700">
        <Plus className="h-3 w-3" /> Add row
      </button>

      <div className="mt-3 flex items-center gap-2">
        <button type="submit" disabled={submitting} className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-700 disabled:opacity-50">
          {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Cascade
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
