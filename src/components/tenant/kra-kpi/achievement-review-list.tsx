"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  ExternalLink,
  Loader2,
  Pencil,
  XCircle,
} from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { MyAchievementTrail } from "@/components/my-kpis/my-achievement-trail";
import type { SubmissionTrailView, VerificationLogEntry } from "@/lib/kra-kpi/shared";

type AchievementView = {
  id: string;
  kpiTitle: string;
  reportedByUserId: string;
  reportedByUserName: string;
  actualValue: number | null;
  actualDate: string | null;
  actualMilestone: string | null;
  actualGrade: string | null;
  actualBoolean: boolean | null;
  actualRating: number | null;
  evidenceDescription: string | null;
  evidenceLinks: string[];
  achievementFormData: Record<string, unknown> | null;
  computedScore: number | null;
  state: string;
  recommendationNote: string | null;
  verificationNote: string | null;
  rejectionReason: string | null;
  reportingDate: string;
  verificationLog: VerificationLogEntry[];
  submissionTrail: SubmissionTrailView[];
};

type CorrectionDraft = {
  actualValue: string;
  actualDate: string;
  actualMilestone: string;
  actualGrade: string;
  actualBoolean: "" | "true" | "false";
  actualRating: string;
  evidenceDescription: string;
  evidenceLinks: string;
  achievementFormDataJson: string;
  note: string;
};

function formatActual(achievement: AchievementView): string {
  if (achievement.actualValue != null) return String(achievement.actualValue);
  if (achievement.actualDate) return new Date(achievement.actualDate).toLocaleDateString();
  if (achievement.actualMilestone) return achievement.actualMilestone.replace(/_/g, " ");
  if (achievement.actualGrade) return achievement.actualGrade.replace(/_/g, " ");
  if (achievement.actualBoolean != null) return achievement.actualBoolean ? "Yes" : "No";
  if (achievement.actualRating != null) return `${achievement.actualRating}/10`;
  return "-";
}

function formatFormValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value == null) return "-";
  return String(value);
}

function getPendingLabel(state: string) {
  switch (state) {
    case "SUBMITTED":
      return "Pending review";
    case "RECOMMENDED":
      return "Pending final approval";
    case "VERIFIED":
      return "Approved";
    case "REJECTED":
      return "Returned";
    default:
      return null;
  }
}

function makeCorrectionDraft(achievement: AchievementView): CorrectionDraft {
  return {
    actualValue: achievement.actualValue != null ? String(achievement.actualValue) : "",
    actualDate: achievement.actualDate ? new Date(achievement.actualDate).toISOString().slice(0, 10) : "",
    actualMilestone: achievement.actualMilestone ?? "",
    actualGrade: achievement.actualGrade ?? "",
    actualBoolean:
      achievement.actualBoolean == null ? "" : achievement.actualBoolean ? "true" : "false",
    actualRating: achievement.actualRating != null ? String(achievement.actualRating) : "",
    evidenceDescription: achievement.evidenceDescription ?? "",
    evidenceLinks: achievement.evidenceLinks.join("\n"),
    achievementFormDataJson: JSON.stringify(achievement.achievementFormData ?? {}, null, 2),
    note: "",
  };
}

export function AchievementReviewList({
  periodId,
  kpiDefinitionId,
}: {
  periodId: string;
  kpiDefinitionId?: string;
}) {
  const [achievements, setAchievements] = useState<AchievementView[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("ALL");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [showReviewFor, setShowReviewFor] = useState<string | null>(null);
  const [correctionFor, setCorrectionFor] = useState<string | null>(null);
  const [correctionDraft, setCorrectionDraft] = useState<CorrectionDraft | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ periodId });
      if (kpiDefinitionId) params.set("kpiDefinitionId", kpiDefinitionId);
      if (filter !== "ALL") params.set("state", filter);
      const res = await fetch(`/api/tenant/kra-kpi/achievements?${params.toString()}`);
      setAchievements((await res.json()) as AchievementView[]);
    } catch {
      setFeedback({ type: "error", message: "Failed to load achievements." });
    } finally {
      setLoading(false);
    }
  }, [periodId, filter, kpiDefinitionId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const showFeedback = (type: "success" | "error", message: string) => {
    setFeedback({ type, message });
    setTimeout(() => setFeedback(null), 3500);
  };

  const handleVerify = async (id: string, approved: boolean) => {
    setActionId(id);
    try {
      const res = await fetch(`/api/tenant/kra-kpi/achievements/${id}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved, note: reviewNote.trim() || undefined }),
      });
      const data = await res.json();
      if (data.status === "success") {
        showFeedback("success", data.message);
        setShowReviewFor(null);
        setReviewNote("");
        void fetchData();
      } else {
        showFeedback("error", data.message);
      }
    } catch {
      showFeedback("error", "Review action failed.");
    } finally {
      setActionId(null);
    }
  };

  const startCorrection = (achievement: AchievementView) => {
    setExpandedId(achievement.id);
    setCorrectionFor(achievement.id);
    setCorrectionDraft(makeCorrectionDraft(achievement));
  };

  const handleCorrectionSave = async (achievementId: string) => {
    if (!correctionDraft) return;
    if (!correctionDraft.note.trim()) {
      showFeedback("error", "A correction remark is required.");
      return;
    }

    let achievementFormData: Record<string, unknown> | undefined;
    if (correctionDraft.achievementFormDataJson.trim()) {
      try {
        achievementFormData = JSON.parse(correctionDraft.achievementFormDataJson) as Record<string, unknown>;
      } catch {
        showFeedback("error", "Achievement form data must be valid JSON.");
        return;
      }
    }

    setActionId(achievementId);
    try {
      const response = await fetch(`/api/tenant/kra-kpi/achievements/${achievementId}/correct`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(correctionDraft.actualValue ? { actualValue: Number(correctionDraft.actualValue) } : {}),
          ...(correctionDraft.actualDate ? { actualDate: correctionDraft.actualDate } : {}),
          ...(correctionDraft.actualMilestone ? { actualMilestone: correctionDraft.actualMilestone } : {}),
          ...(correctionDraft.actualGrade ? { actualGrade: correctionDraft.actualGrade } : {}),
          ...(correctionDraft.actualBoolean
            ? { actualBoolean: correctionDraft.actualBoolean === "true" }
            : {}),
          ...(correctionDraft.actualRating ? { actualRating: Number(correctionDraft.actualRating) } : {}),
          evidenceDescription: correctionDraft.evidenceDescription,
          evidenceLinks: correctionDraft.evidenceLinks
            .split("\n")
            .map((value) => value.trim())
            .filter(Boolean),
          achievementFormData,
          note: correctionDraft.note.trim(),
        }),
      });
      const data = await response.json();
      if (!response.ok || data.status === "error") {
        showFeedback("error", data.message ?? "Correction failed.");
        return;
      }

      showFeedback("success", data.message ?? "Achievement corrected.");
      setCorrectionFor(null);
      setCorrectionDraft(null);
      void fetchData();
    } catch {
      showFeedback("error", "Correction failed.");
    } finally {
      setActionId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Achievements and Approval Queue</h3>
        <div className="flex gap-1">
          {["ALL", "DRAFT", "SUBMITTED", "RECOMMENDED", "VERIFIED", "REJECTED"].map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setFilter(option)}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                filter === option
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-500 hover:bg-slate-200"
              }`}
            >
              {option === "ALL" ? "All" : option.charAt(0) + option.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {feedback && (
        <div className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm ${feedback.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
          {feedback.type === "success" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          {feedback.message}
        </div>
      )}

      {achievements.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">
          No achievements found
        </div>
      ) : (
        <div className="space-y-3">
          {achievements.map((achievement) => {
            const pendingLabel = getPendingLabel(achievement.state);
            const expanded = expandedId === achievement.id;
            const reviewOpen = showReviewFor === achievement.id;
            const correctionOpen = correctionFor === achievement.id && correctionDraft != null;
            const canReview =
              achievement.state === "SUBMITTED" || achievement.state === "RECOMMENDED";
            const canCorrect = achievement.state === "VERIFIED";

            return (
              <div key={achievement.id} className="rounded-xl border border-slate-200/80 bg-white px-4 py-3.5">
                <div className="flex items-start gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                    <ClipboardCheck className="h-4 w-4" />
                  </div>

                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">{achievement.kpiTitle}</span>
                      <StatusBadge label={achievement.state} />
                      {pendingLabel && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                          {pendingLabel}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
                      <span>By: {achievement.reportedByUserName}</span>
                      <span className="font-semibold text-slate-600">Actual: {formatActual(achievement)}</span>
                      {achievement.computedScore != null && (
                        <span>
                          Score: <strong className="text-slate-700">{achievement.computedScore.toFixed(1)}</strong>
                        </span>
                      )}
                      <span>{new Date(achievement.reportingDate).toLocaleDateString()}</span>
                    </div>

                    {achievement.evidenceDescription && (
                      <p className="text-xs text-slate-500">{achievement.evidenceDescription}</p>
                    )}

                    {achievement.evidenceLinks.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {achievement.evidenceLinks.map((link, index) => (
                          <a
                            key={`${achievement.id}-${index}`}
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-brand hover:underline"
                          >
                            <ExternalLink className="h-3 w-3" />
                            Link {index + 1}
                          </a>
                        ))}
                      </div>
                    )}

                    {(achievement.recommendationNote || achievement.verificationNote || achievement.rejectionReason) && (
                      <div className="grid gap-1 text-xs text-slate-600 md:grid-cols-3">
                        <div>Recommendation: {achievement.recommendationNote ?? "-"}</div>
                        <div>Approval: {achievement.verificationNote ?? "-"}</div>
                        <div>Rejection: {achievement.rejectionReason ?? "-"}</div>
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <button
                      type="button"
                      onClick={() => setExpandedId(expanded ? null : achievement.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      Details
                    </button>

                    {canReview && (
                      <button
                        type="button"
                        onClick={() => setShowReviewFor(reviewOpen ? null : achievement.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Review
                      </button>
                    )}

                    {canCorrect && (
                      <button
                        type="button"
                        onClick={() => startCorrection(achievement)}
                        className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] font-semibold text-amber-700 hover:bg-amber-100"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Correct
                      </button>
                    )}
                  </div>
                </div>

                {(expanded || reviewOpen || correctionOpen) && (
                  <div className="mt-4 space-y-4 border-t border-slate-100 pt-4">
                    {(achievement.submissionTrail.length > 0 || achievement.verificationLog.length > 0) && (
                      <MyAchievementTrail trail={achievement.submissionTrail} log={achievement.verificationLog} />
                    )}

                    {achievement.achievementFormData && Object.keys(achievement.achievementFormData).length > 0 && (
                      <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
                        <div className="mb-2 font-semibold uppercase tracking-wide text-slate-500">
                          Form Details
                        </div>
                        <div className="grid gap-2 md:grid-cols-2">
                          {Object.entries(achievement.achievementFormData).map(([key, value]) => (
                            <div key={key}>
                              <span className="font-medium text-slate-700">{key}:</span> {formatFormValue(value)}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {reviewOpen && (
                      <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-[1fr,auto,auto] md:items-end">
                        <div>
                          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Review Remark
                          </label>
                          <input
                            type="text"
                            placeholder="Optional for approve, required for reject"
                            value={reviewNote}
                            onChange={(event) => setReviewNote(event.target.value)}
                            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => { void handleVerify(achievement.id, true); }}
                          disabled={actionId === achievement.id}
                          className="inline-flex items-center justify-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          {actionId === achievement.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => { void handleVerify(achievement.id, false); }}
                          disabled={actionId === achievement.id}
                          className="inline-flex items-center justify-center gap-1 rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          Reject
                        </button>
                      </div>
                    )}

                    {correctionOpen && correctionDraft && (
                      <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
                        <div className="text-sm font-semibold text-slate-900">Verified Correction</div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <input
                            type="number"
                            step="any"
                            value={correctionDraft.actualValue}
                            onChange={(event) =>
                              setCorrectionDraft((previous) => previous ? { ...previous, actualValue: event.target.value } : previous)
                            }
                            placeholder="Actual value"
                            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                          />
                          <input
                            type="date"
                            value={correctionDraft.actualDate}
                            onChange={(event) =>
                              setCorrectionDraft((previous) => previous ? { ...previous, actualDate: event.target.value } : previous)
                            }
                            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                          />
                          <input
                            type="text"
                            value={correctionDraft.actualMilestone}
                            onChange={(event) =>
                              setCorrectionDraft((previous) => previous ? { ...previous, actualMilestone: event.target.value } : previous)
                            }
                            placeholder="Milestone"
                            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                          />
                          <input
                            type="text"
                            value={correctionDraft.actualGrade}
                            onChange={(event) =>
                              setCorrectionDraft((previous) => previous ? { ...previous, actualGrade: event.target.value } : previous)
                            }
                            placeholder="Grade"
                            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                          />
                          <select
                            value={correctionDraft.actualBoolean}
                            onChange={(event) =>
                              setCorrectionDraft((previous) => previous ? { ...previous, actualBoolean: event.target.value as CorrectionDraft["actualBoolean"] } : previous)
                            }
                            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                          >
                            <option value="">Boolean outcome</option>
                            <option value="true">Yes</option>
                            <option value="false">No</option>
                          </select>
                          <input
                            type="number"
                            value={correctionDraft.actualRating}
                            onChange={(event) =>
                              setCorrectionDraft((previous) => previous ? { ...previous, actualRating: event.target.value } : previous)
                            }
                            placeholder="Rating"
                            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                          />
                        </div>

                        <textarea
                          rows={2}
                          value={correctionDraft.evidenceDescription}
                          onChange={(event) =>
                            setCorrectionDraft((previous) => previous ? { ...previous, evidenceDescription: event.target.value } : previous)
                          }
                          placeholder="Evidence description"
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                        />

                        <textarea
                          rows={2}
                          value={correctionDraft.evidenceLinks}
                          onChange={(event) =>
                            setCorrectionDraft((previous) => previous ? { ...previous, evidenceLinks: event.target.value } : previous)
                          }
                          placeholder="Evidence links, one per line"
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                        />

                        <textarea
                          rows={6}
                          value={correctionDraft.achievementFormDataJson}
                          onChange={(event) =>
                            setCorrectionDraft((previous) => previous ? { ...previous, achievementFormDataJson: event.target.value } : previous)
                          }
                          placeholder="Achievement form data JSON"
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-700"
                        />

                        <textarea
                          rows={2}
                          value={correctionDraft.note}
                          onChange={(event) =>
                            setCorrectionDraft((previous) => previous ? { ...previous, note: event.target.value } : previous)
                          }
                          placeholder="Correction remark"
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                        />

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => { void handleCorrectionSave(achievement.id); }}
                            disabled={actionId === achievement.id}
                            className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                          >
                            {actionId === achievement.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pencil className="h-3.5 w-3.5" />}
                            Save correction
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setCorrectionFor(null);
                              setCorrectionDraft(null);
                            }}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
