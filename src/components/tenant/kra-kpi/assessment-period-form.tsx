"use client";

import { useState } from "react";
import { Loader2, Check, X, AlertCircle } from "lucide-react";

type PeriodFormValues = {
  id?: string;
  name: string;
  code: string;
  periodType: "CALENDAR_YEAR" | "FINANCIAL_YEAR" | "SPECIFIC_RANGE";
  startDate: string;
  endDate: string;
  reviewFrequency: string;
  targetSettingDeadline: string;
  achievementDeadline: string;
  reviewDeadline: string;
  description: string;
};

const PERIOD_TYPES = [
  { value: "CALENDAR_YEAR", label: "Calendar Year" },
  { value: "FINANCIAL_YEAR", label: "Financial Year" },
  { value: "SPECIFIC_RANGE", label: "Specific Range" },
];

const FREQUENCIES = [
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "QUARTERLY", label: "Quarterly" },
  { value: "HALF_YEARLY", label: "Half Yearly" },
  { value: "ANNUAL", label: "Annual" },
];

function toDateInputValue(d: string | Date | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

export function AssessmentPeriodForm({
  mode,
  initial,
  onDone,
  onCancel,
}: {
  mode: "create" | "edit";
  initial?: Partial<PeriodFormValues> & { id?: string };
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [code, setCode] = useState(initial?.code ?? "");
  const [periodType, setPeriodType] = useState(initial?.periodType ?? "SPECIFIC_RANGE");
  const [startDate, setStartDate] = useState(toDateInputValue(initial?.startDate));
  const [endDate, setEndDate] = useState(toDateInputValue(initial?.endDate));
  const [reviewFrequency, setReviewFrequency] = useState(initial?.reviewFrequency ?? "ANNUAL");
  const [targetSettingDeadline, setTargetSettingDeadline] = useState(toDateInputValue(initial?.targetSettingDeadline));
  const [achievementDeadline, setAchievementDeadline] = useState(toDateInputValue(initial?.achievementDeadline));
  const [reviewDeadline, setReviewDeadline] = useState(toDateInputValue(initial?.reviewDeadline));
  const [description, setDescription] = useState(initial?.description ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const url = mode === "create"
        ? "/api/tenant/kra-kpi/periods"
        : `/api/tenant/kra-kpi/periods/${initial!.id}`;

      const body: Record<string, unknown> = mode === "create"
        ? {
            name: name.trim(),
            code: code.trim(),
            periodType,
            startDate,
            endDate,
            reviewFrequency,
            ...(targetSettingDeadline && { targetSettingDeadline }),
            ...(achievementDeadline && { achievementDeadline }),
            ...(reviewDeadline && { reviewDeadline }),
            ...(description.trim() && { description: description.trim() }),
          }
        : {
            ...(name.trim() && { name: name.trim() }),
            periodType,
            ...(startDate && { startDate }),
            ...(endDate && { endDate }),
            reviewFrequency,
            targetSettingDeadline: targetSettingDeadline || null,
            achievementDeadline: achievementDeadline || null,
            reviewDeadline: reviewDeadline || null,
            description: description.trim() || null,
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
          {mode === "create" ? "New assessment period" : "Edit period"}
        </span>
        <button type="button" onClick={onCancel} className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 hover:text-slate-700">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className={labelCls}>Name</label>
          <input type="text" placeholder="e.g. AY 2025-26" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} autoFocus />
        </div>
        {mode === "create" && (
          <div>
            <label className={labelCls}>Code</label>
            <input type="text" placeholder="e.g. AY2025-26" value={code} onChange={(e) => setCode(e.target.value)} className={inputCls} />
          </div>
        )}
        <div>
          <label className={labelCls}>Period type</label>
          <select value={periodType} onChange={(e) => setPeriodType(e.target.value as PeriodFormValues["periodType"])} className={inputCls}>
            {PERIOD_TYPES.map((pt) => <option key={pt.value} value={pt.value}>{pt.label}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Start date</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>End date</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Review frequency</label>
          <select value={reviewFrequency} onChange={(e) => setReviewFrequency(e.target.value)} className={inputCls}>
            {FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Target setting deadline</label>
          <input type="date" value={targetSettingDeadline} onChange={(e) => setTargetSettingDeadline(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Achievement deadline</label>
          <input type="date" value={achievementDeadline} onChange={(e) => setAchievementDeadline(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Review deadline</label>
          <input type="date" value={reviewDeadline} onChange={(e) => setReviewDeadline(e.target.value)} className={inputCls} />
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <label className={labelCls}>Description</label>
          <input type="text" placeholder="Optional description" value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} />
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
