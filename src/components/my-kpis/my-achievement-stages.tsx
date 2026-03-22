"use client";

import { useState, useCallback, useEffect } from "react";
import {
  CheckCircle2,
  Circle,
  Loader2,
  AlertCircle,
  FileText,
  Link as LinkIcon,
  Clock,
  AlertTriangle,
  Undo2,
} from "lucide-react";

type StageProgressView = {
  progressId: string;
  stageDefinitionId: string;
  stageOrder: number;
  title: string;
  description: string | null;
  weight: number;
  isMandatory: boolean;
  evidenceRequired: boolean;
  evidenceTypes: string[];
  evidenceInstructions: string | null;
  deadline: string | null;
  isCompleted: boolean;
  completedAt: string | null;
  completedByName: string | null;
  notes: string | null;
  evidenceFiles: { name: string; url: string; type: string }[] | null;
  isOverdue: boolean;
  daysRemaining: number | null;
};

type Props = {
  achievementId: string;
  achievementState: string;
  onStageUpdate?: () => void;
};

const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand focus:ring-1 focus:ring-brand/30";

export function MyAchievementStages({ achievementId, achievementState, onStageUpdate }: Props) {
  const [stages, setStages] = useState<StageProgressView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);

  // Form for marking complete
  const [activeFormId, setActiveFormId] = useState<string | null>(null);
  const [formNotes, setFormNotes] = useState("");
  const [formEvidenceUrl, setFormEvidenceUrl] = useState("");
  const [formEvidenceFiles, setFormEvidenceFiles] = useState<{ name: string; url: string; type: string }[]>([]);

  const fetchStages = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tenant/kra-kpi/achievements/${achievementId}/stage-progress`);
      if (!res.ok) throw new Error();
      setStages(await res.json());
      setError(null);
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
  const isDraft = achievementState === "DRAFT";

  async function handleMarkComplete(progressId: string) {
    setMarkingId(progressId);
    setError(null);
    try {
      const payload: Record<string, unknown> = {};
      if (formNotes) payload.notes = formNotes;
      if (formEvidenceFiles.length > 0) payload.evidenceFiles = formEvidenceFiles;

      const res = await fetch(`/api/tenant/kra-kpi/stage-progress/${progressId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "Failed to mark stage as complete.");
        return;
      }
      setActiveFormId(null);
      setFormNotes("");
      setFormEvidenceUrl("");
      setFormEvidenceFiles([]);
      await fetchStages();
      onStageUpdate?.();
    } catch {
      setError("Failed to mark stage as complete.");
    } finally {
      setMarkingId(null);
    }
  }

  async function handleUnmark(progressId: string) {
    setMarkingId(progressId);
    setError(null);
    try {
      const res = await fetch(`/api/tenant/kra-kpi/stage-progress/${progressId}/uncomplete`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "Failed to undo stage completion.");
        return;
      }
      await fetchStages();
      onStageUpdate?.();
    } catch {
      setError("Failed to undo stage completion.");
    } finally {
      setMarkingId(null);
    }
  }

  function addEvidenceUrl() {
    if (!formEvidenceUrl.trim()) return;
    setFormEvidenceFiles((prev) => [
      ...prev,
      { name: formEvidenceUrl, url: formEvidenceUrl, type: "URL" },
    ]);
    setFormEvidenceUrl("");
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6 text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  if (stages.length === 0) return null;

  return (
    <div className="space-y-3">
      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {error}
        </div>
      )}

      {/* Progress bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="h-2 w-full rounded-full bg-slate-100">
            <div
              className="h-2 rounded-full bg-brand transition-all"
              style={{ width: `${totalWeight > 0 ? (completedWeight / totalWeight) * 100 : 0}%` }}
            />
          </div>
        </div>
        <span className="text-xs font-medium text-slate-500 tabular-nums">
          {completedCount}/{stages.length} stages
        </span>
      </div>

      <div className="text-[11px] text-slate-400 tabular-nums">
        Score: {completedWeight}/{totalWeight}
      </div>

      {/* Stage checklist */}
      <div className="space-y-1">
        {stages.map((stage) => {
          const isActive = activeFormId === stage.progressId;
          return (
            <div key={stage.progressId} className="rounded-lg border border-slate-100 bg-white p-3">
              <div className="flex items-start gap-2.5">
                {/* Completion icon */}
                <div className="mt-0.5">
                  {stage.isCompleted ? (
                    <CheckCircle2 className="h-4.5 w-4.5 text-green-500" />
                  ) : stage.isOverdue ? (
                    <AlertTriangle className="h-4.5 w-4.5 text-amber-500" />
                  ) : (
                    <Circle className="h-4.5 w-4.5 text-slate-300" />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium ${stage.isCompleted ? "text-slate-500 line-through" : "text-slate-700"}`}>
                      {stage.title}
                    </span>
                    <span className="text-[10px] text-slate-400 tabular-nums">
                      {stage.weight} pts
                    </span>
                    {stage.isMandatory && (
                      <span className="text-[9px] font-semibold uppercase text-red-400">req</span>
                    )}
                  </div>

                  {stage.description && (
                    <p className="mt-0.5 text-[11px] text-slate-400">{stage.description}</p>
                  )}

                  {/* Deadline info */}
                  {stage.deadline && (
                    <div className="mt-1 flex items-center gap-1 text-[10px]">
                      <Clock className="h-3 w-3" />
                      {stage.isOverdue ? (
                        <span className="text-red-500 font-medium">Overdue</span>
                      ) : stage.daysRemaining !== null ? (
                        <span className="text-slate-400">{stage.daysRemaining}d left</span>
                      ) : null}
                    </div>
                  )}

                  {/* Completed info */}
                  {stage.isCompleted && stage.completedAt && (
                    <p className="mt-1 text-[10px] text-green-600">
                      Completed{" "}
                      {new Date(stage.completedAt).toLocaleDateString("en-IN", {
                        month: "short",
                        day: "numeric",
                      })}
                      {stage.completedByName && ` by ${stage.completedByName}`}
                    </p>
                  )}

                  {/* Notes */}
                  {stage.notes && (
                    <p className="mt-1 text-[10px] text-slate-400 italic">&ldquo;{stage.notes}&rdquo;</p>
                  )}

                  {/* Evidence files */}
                  {stage.evidenceFiles && stage.evidenceFiles.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {stage.evidenceFiles.map((file, i) => (
                        <a
                          key={i}
                          href={file.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 rounded bg-slate-50 px-1.5 py-0.5 text-[10px] text-blue-600 hover:bg-blue-50"
                        >
                          {file.type === "URL" ? <LinkIcon className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
                          {file.name.length > 30 ? file.name.slice(0, 30) + "..." : file.name}
                        </a>
                      ))}
                    </div>
                  )}

                  {/* Mark complete form */}
                  {isActive && (
                    <div className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50/50 p-2.5">
                      <div>
                        <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                          Notes
                        </label>
                        <textarea
                          value={formNotes}
                          onChange={(e) => setFormNotes(e.target.value)}
                          placeholder="Optional notes..."
                          rows={2}
                          className={`${inputCls} resize-none text-xs`}
                        />
                      </div>
                      {stage.evidenceRequired && (
                        <div>
                          <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                            Evidence (URL)
                          </label>
                          {stage.evidenceInstructions && (
                            <p className="mb-1 text-[10px] text-slate-400">{stage.evidenceInstructions}</p>
                          )}
                          <div className="flex gap-1">
                            <input
                              type="url"
                              value={formEvidenceUrl}
                              onChange={(e) => setFormEvidenceUrl(e.target.value)}
                              placeholder="https://..."
                              className={`${inputCls} text-xs`}
                            />
                            <button
                              onClick={addEvidenceUrl}
                              disabled={!formEvidenceUrl.trim()}
                              className="shrink-0 rounded-lg bg-brand/10 px-2.5 text-xs font-medium text-brand hover:bg-brand/20 disabled:opacity-50"
                            >
                              Add
                            </button>
                          </div>
                          {formEvidenceFiles.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {formEvidenceFiles.map((f, i) => (
                                <span
                                  key={i}
                                  className="flex items-center gap-1 rounded bg-green-50 px-1.5 py-0.5 text-[10px] text-green-700"
                                >
                                  <LinkIcon className="h-3 w-3" />
                                  {f.name.length > 25 ? f.name.slice(0, 25) + "..." : f.name}
                                  <button
                                    onClick={() => setFormEvidenceFiles((prev) => prev.filter((_, j) => j !== i))}
                                    className="ml-0.5 text-red-400 hover:text-red-600"
                                  >
                                    &times;
                                  </button>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => void handleMarkComplete(stage.progressId)}
                          disabled={
                            markingId === stage.progressId ||
                            (stage.evidenceRequired && formEvidenceFiles.length === 0)
                          }
                          className="flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                        >
                          {markingId === stage.progressId ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          )}
                          Complete
                        </button>
                        <button
                          onClick={() => {
                            setActiveFormId(null);
                            setFormNotes("");
                            setFormEvidenceFiles([]);
                            setFormEvidenceUrl("");
                          }}
                          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Action buttons */}
                <div className="shrink-0">
                  {!stage.isCompleted && isDraft && !isActive && (
                    <button
                      onClick={() => {
                        if (stage.evidenceRequired || true) {
                          setActiveFormId(stage.progressId);
                          setFormNotes("");
                          setFormEvidenceFiles([]);
                          setFormEvidenceUrl("");
                        }
                      }}
                      disabled={markingId !== null}
                      className="rounded-lg bg-brand/10 px-3 py-1.5 text-[11px] font-medium text-brand hover:bg-brand/20 disabled:opacity-50"
                    >
                      Mark Complete
                    </button>
                  )}
                  {stage.isCompleted && isDraft && (
                    <button
                      onClick={() => void handleUnmark(stage.progressId)}
                      disabled={markingId !== null}
                      className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                      title="Undo completion"
                    >
                      <Undo2 className="h-3 w-3" /> Undo
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
