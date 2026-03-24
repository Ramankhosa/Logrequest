"use client";

import { useState, useCallback, useEffect } from "react";
import {
  CheckCircle2,
  Circle,
  Loader2,
  AlertCircle,
  Send,
  X,
  FileText,
  Link as LinkIcon,
} from "lucide-react";

type StageProgressView = {
  progressId: string;
  stageOrder: number;
  title: string;
  weight: number;
  isCompleted: boolean;
  completedAt: string | null;
  notes: string | null;
  evidenceFiles: { name: string; url: string; type: string }[] | null;
};

type Props = {
  achievementId: string;
  achievementTitle: string | null;
  kpiTitle: string;
  contributionRole: string | null;
  creditPercent: number | null;
  stageCompletionScore: number | null;
  onSubmit: () => void;
  onCancel: () => void;
};

export function MyAchievementSubmit({
  achievementId,
  achievementTitle,
  kpiTitle,
  contributionRole,
  creditPercent,
  stageCompletionScore,
  onSubmit,
  onCancel,
}: Props) {
  const [stages, setStages] = useState<StageProgressView[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStages = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tenant/kra-kpi/achievements/${achievementId}/stage-progress`);
      if (!res.ok) throw new Error();
      setStages(await res.json());
    } catch {
      setError("Failed to load stage progress.");
    } finally {
      setLoading(false);
    }
  }, [achievementId]);

  useEffect(() => {
    void fetchStages();
  }, [fetchStages]);

  const completedCount = stages.filter((s) => s.isCompleted).length;
  const totalWeight = stages.reduce((s, x) => s + x.weight, 0);
  const completedWeight = stages.filter((s) => s.isCompleted).reduce((s, x) => s + x.weight, 0);

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenant/kra-kpi/achievements/${achievementId}/submit`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok || data.status === "error") {
        setError(data.message ?? "Failed to submit.");
        return;
      }
      onSubmit();
    } catch {
      setError("Failed to submit.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">
          Submit: {achievementTitle ?? kpiTitle}
        </h3>
        <button
          onClick={onCancel}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-xs text-red-700">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {error}
        </div>
      )}

      {/* KPI Info */}
      <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 space-y-1.5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          From KPI
        </div>
        <p className="text-sm font-medium text-slate-700">{kpiTitle}</p>
        {contributionRole && (
          <p className="text-xs text-slate-500">
            Role: {contributionRole}
            {creditPercent != null && (
              <span className="text-slate-400"> ({creditPercent}% share)</span>
            )}
          </p>
        )}
      </div>

      {/* Stage Summary */}
      {loading ? (
        <div className="flex items-center justify-center py-4 text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : stages.length > 0 ? (
        <div className="rounded-lg border border-slate-200 p-3 space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Stage Summary
          </div>
          <div className="space-y-1.5">
            {stages.map((stage) => (
              <div key={stage.progressId} className="flex items-center gap-2 text-xs">
                {stage.isCompleted ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                ) : (
                  <Circle className="h-3.5 w-3.5 text-slate-300 shrink-0" />
                )}
                <span className={stage.isCompleted ? "text-slate-500" : "text-slate-700"}>
                  {stage.title}
                </span>
                <span className="text-[10px] text-slate-400 tabular-nums">({stage.weight} pts)</span>
                {stage.isCompleted && stage.completedAt && (
                  <span className="ml-auto text-[10px] text-slate-400">
                    {new Date(stage.completedAt).toLocaleDateString("en-IN", {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                )}
              </div>
            ))}
          </div>

          <div className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-600">
            <div className="flex justify-between">
              <span>Stage Score</span>
              <span className="tabular-nums font-medium">
                {completedWeight}/{totalWeight}
              </span>
            </div>
            {creditPercent != null && (
              <div className="flex justify-between text-slate-500">
                <span>Contributor Share</span>
                <span className="tabular-nums font-medium">{creditPercent}%</span>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* Submit button */}
      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={() => void handleSubmit()}
          disabled={submitting}
          className="flex items-center gap-1.5 rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50"
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          Submit for Review
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-500 hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
