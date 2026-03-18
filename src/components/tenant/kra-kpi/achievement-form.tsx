"use client";

import { useEffect, useState } from "react";
import { Loader2, Check, X, AlertCircle } from "lucide-react";

type AchievementFormProps = {
  periodId: string;
  kpiDefinitionId: string;
  measurementType: string;
  targetAllocationId?: string;
  onDone: () => void;
  onCancel: () => void;
};

export function AchievementForm({
  periodId,
  kpiDefinitionId,
  measurementType,
  targetAllocationId,
  onDone,
  onCancel,
}: AchievementFormProps) {
  const [selectedAllocationId, setSelectedAllocationId] = useState(
    targetAllocationId ?? "",
  );
  const [allocationOptions, setAllocationOptions] = useState<
    Array<{ id: string; label: string }>
  >([]);
  const [loadingAllocations, setLoadingAllocations] = useState(false);
  const [actualValue, setActualValue] = useState("");
  const [actualDate, setActualDate] = useState("");
  const [actualMilestone, setActualMilestone] = useState("");
  const [actualGrade, setActualGrade] = useState("");
  const [actualBoolean, setActualBoolean] = useState<boolean | null>(null);
  const [actualRating, setActualRating] = useState("");
  const [evidenceDescription, setEvidenceDescription] = useState("");
  const [evidenceLinks, setEvidenceLinks] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedAllocationId(targetAllocationId ?? "");
  }, [targetAllocationId]);

  useEffect(() => {
    let cancelled = false;

    const fetchAllocations = async () => {
      setLoadingAllocations(true);

      try {
        const params = new URLSearchParams({
          periodId,
          kpiDefinitionId,
        });
        const res = await fetch(`/api/tenant/kra-kpi/targets?${params}`);
        const data = (await res.json()) as Array<{
          id: string;
          assignedToUnitName: string | null;
          assignedToUserName: string | null;
          targetValue: number | null;
          targetDate: string | null;
          targetMilestone: string | null;
          targetGrade: string | null;
          targetBoolean: boolean | null;
          targetRating: number | null;
        }>;

        if (cancelled || !Array.isArray(data)) {
          return;
        }

        setAllocationOptions(
          data.map((allocation) => ({
            id: allocation.id,
            label: formatAllocationLabel(allocation),
          })),
        );
      } catch {
        if (!cancelled) {
          setAllocationOptions([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingAllocations(false);
        }
      }
    };

    void fetchAllocations();

    return () => {
      cancelled = true;
    };
  }, [kpiDefinitionId, periodId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const body: Record<string, unknown> = {
        periodId,
        kpiDefinitionId,
        ...(selectedAllocationId && { targetAllocationId: selectedAllocationId }),
        ...(evidenceDescription.trim() && { evidenceDescription: evidenceDescription.trim() }),
      };

      const links = evidenceLinks
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      if (links.length > 0) body.evidenceLinks = links;

      if (["NUMERIC", "PERCENTAGE", "CURRENCY"].includes(measurementType) && actualValue) {
        body.actualValue = Number(actualValue);
      }
      if (measurementType === "DATE_TARGET" && actualDate) {
        body.actualDate = actualDate;
      }
      if (measurementType === "MILESTONE" && actualMilestone) {
        body.actualMilestone = actualMilestone;
      }
      if (measurementType === "GRADE" && actualGrade) {
        body.actualGrade = actualGrade;
      }
      if (measurementType === "BOOLEAN" && actualBoolean !== null) {
        body.actualBoolean = actualBoolean;
      }
      if (measurementType === "RATING" && actualRating) {
        body.actualRating = Number(actualRating);
      }

      const res = await fetch("/api/tenant/kra-kpi/achievements", {
        method: "POST",
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

  const labelCls = "mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500";
  const inputCls = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand focus:ring-1 focus:ring-brand/30";

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-brand/20 bg-brand/5 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold text-brand">Record achievement</span>
        <button type="button" onClick={onCancel} className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 hover:text-slate-700">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelCls}>Target allocation</label>
          <select
            value={selectedAllocationId}
            onChange={(e) => setSelectedAllocationId(e.target.value)}
            className={inputCls}
            disabled={loadingAllocations}
          >
            <option value="">
              {loadingAllocations
                ? "Loading allocations..."
                : "Optional: link this achievement to a target allocation"}
            </option>
            {allocationOptions.map((allocation) => (
              <option key={allocation.id} value={allocation.id}>
                {allocation.label}
              </option>
            ))}
          </select>
        </div>

        {["NUMERIC", "PERCENTAGE", "CURRENCY"].includes(measurementType) && (
          <div>
            <label className={labelCls}>Actual value</label>
            <input type="number" step="any" value={actualValue} onChange={(e) => setActualValue(e.target.value)} placeholder="0" className={inputCls} autoFocus />
          </div>
        )}
        {measurementType === "DATE_TARGET" && (
          <div>
            <label className={labelCls}>Actual date</label>
            <input type="date" value={actualDate} onChange={(e) => setActualDate(e.target.value)} className={inputCls} />
          </div>
        )}
        {measurementType === "MILESTONE" && (
          <div>
            <label className={labelCls}>Actual milestone</label>
            <select value={actualMilestone} onChange={(e) => setActualMilestone(e.target.value)} className={inputCls}>
              <option value="">Select...</option>
              <option value="NOT_STARTED">Not Started</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="COMPLETED">Completed</option>
            </select>
          </div>
        )}
        {measurementType === "GRADE" && (
          <div>
            <label className={labelCls}>Actual grade</label>
            <select value={actualGrade} onChange={(e) => setActualGrade(e.target.value)} className={inputCls}>
              <option value="">Select...</option>
              {["OUTSTANDING", "VERY_GOOD", "GOOD", "SATISFACTORY", "NEEDS_IMPROVEMENT", "POOR"].map((g) => (
                <option key={g} value={g}>{g.replace(/_/g, " ")}</option>
              ))}
            </select>
          </div>
        )}
        {measurementType === "BOOLEAN" && (
          <div>
            <label className={labelCls}>Actual</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setActualBoolean(true)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${actualBoolean === true ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600"}`}>Yes</button>
              <button type="button" onClick={() => setActualBoolean(false)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${actualBoolean === false ? "bg-rose-600 text-white" : "bg-slate-100 text-slate-600"}`}>No</button>
            </div>
          </div>
        )}
        {measurementType === "RATING" && (
          <div>
            <label className={labelCls}>Actual rating</label>
            <input type="number" min={1} max={10} value={actualRating} onChange={(e) => setActualRating(e.target.value)} className={inputCls} />
          </div>
        )}

        <div className="sm:col-span-2">
          <label className={labelCls}>Evidence description</label>
          <textarea value={evidenceDescription} onChange={(e) => setEvidenceDescription(e.target.value)} rows={2} placeholder="Describe evidence supporting this achievement" className={`${inputCls} resize-none`} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>Evidence links (one per line)</label>
          <textarea value={evidenceLinks} onChange={(e) => setEvidenceLinks(e.target.value)} rows={2} placeholder="https://example.com/proof.pdf" className={`${inputCls} resize-none font-mono text-xs`} />
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button type="submit" disabled={submitting} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand/90 disabled:opacity-50">
          {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Record
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

function formatAllocationLabel(allocation: {
  assignedToUnitName: string | null;
  assignedToUserName: string | null;
  targetValue: number | null;
  targetDate: string | null;
  targetMilestone: string | null;
  targetGrade: string | null;
  targetBoolean: boolean | null;
  targetRating: number | null;
}) {
  const assignee =
    allocation.assignedToUserName ??
    allocation.assignedToUnitName ??
    "Unassigned";

  if (allocation.targetValue != null) {
    return `${assignee} - ${allocation.targetValue}`;
  }
  if (allocation.targetDate) {
    return `${assignee} - ${new Date(allocation.targetDate).toLocaleDateString()}`;
  }
  if (allocation.targetMilestone) {
    return `${assignee} - ${allocation.targetMilestone.replace(/_/g, " ")}`;
  }
  if (allocation.targetGrade) {
    return `${assignee} - ${allocation.targetGrade.replace(/_/g, " ")}`;
  }
  if (allocation.targetBoolean != null) {
    return `${assignee} - ${allocation.targetBoolean ? "Yes" : "No"}`;
  }
  if (allocation.targetRating != null) {
    return `${assignee} - ${allocation.targetRating}/10`;
  }

  return assignee;
}
