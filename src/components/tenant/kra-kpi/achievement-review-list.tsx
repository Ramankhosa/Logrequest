"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  ClipboardCheck,
  ExternalLink,
} from "lucide-react";
import { StatusBadge } from "@/components/status-badge";

type AchievementView = {
  id: string;
  kpiTitle: string;
  reportedByUserName: string;
  actualValue: number | null;
  actualDate: string | null;
  actualMilestone: string | null;
  actualGrade: string | null;
  actualBoolean: boolean | null;
  actualRating: number | null;
  evidenceDescription: string | null;
  evidenceLinks: string[];
  computedScore: number | null;
  state: string;
  verificationNote: string | null;
  rejectionReason: string | null;
  reportingDate: string;
};

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
  const [verifyNote, setVerifyNote] = useState("");
  const [showNoteFor, setShowNoteFor] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ periodId });
      if (kpiDefinitionId) params.set("kpiDefinitionId", kpiDefinitionId);
      if (filter !== "ALL") params.set("state", filter);
      const res = await fetch(`/api/tenant/kra-kpi/achievements?${params}`);
      setAchievements(await res.json());
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [periodId, filter, kpiDefinitionId]);

  useEffect(() => { void fetchData(); }, [fetchData]);

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
        body: JSON.stringify({ approved, note: verifyNote || undefined }),
      });
      const data = await res.json();
      if (data.status === "success") {
        showFeedback("success", data.message);
        setShowNoteFor(null);
        setVerifyNote("");
        void fetchData();
      } else {
        showFeedback("error", data.message);
      }
    } catch { showFeedback("error", "Verification failed."); }
    finally { setActionId(null); }
  };

  function formatActual(a: AchievementView): string {
    if (a.actualValue != null) return String(a.actualValue);
    if (a.actualDate) return new Date(a.actualDate).toLocaleDateString();
    if (a.actualMilestone) return a.actualMilestone.replace(/_/g, " ");
    if (a.actualGrade) return a.actualGrade.replace(/_/g, " ");
    if (a.actualBoolean != null) return a.actualBoolean ? "Yes" : "No";
    if (a.actualRating != null) return `${a.actualRating}/10`;
    return "—";
  }

  if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Achievements & Verification</h3>
        <div className="flex gap-1">
          {["ALL", "DRAFT", "SUBMITTED", "RECOMMENDED", "VERIFIED", "REJECTED"].map((s) => (
            <button key={s} type="button" onClick={() => setFilter(s)} className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${filter === s ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
              {s === "ALL" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {feedback && (
        <div className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm ${feedback.type === "success" ? "border-brand/20 bg-brand/5 text-brand" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
          {feedback.type === "success" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
          {feedback.message}
        </div>
      )}

      {achievements.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">
          No achievements found
        </div>
      ) : (
        <div className="space-y-2">
          {achievements.map((ach) => (
            <div key={ach.id} className="rounded-xl border border-slate-200/80 bg-white px-4 py-3.5 transition hover:border-slate-300">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                  <ClipboardCheck className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">{ach.kpiTitle}</span>
                    <StatusBadge label={ach.state} />
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
                    <span>By: {ach.reportedByUserName}</span>
                    <span className="font-semibold text-slate-600">Actual: {formatActual(ach)}</span>
                    {ach.computedScore != null && <span>Score: <strong className="text-slate-700">{ach.computedScore.toFixed(1)}</strong></span>}
                    <span>{new Date(ach.reportingDate).toLocaleDateString()}</span>
                  </div>
                  {ach.evidenceDescription && <p className="mt-1 text-xs text-slate-500">{ach.evidenceDescription}</p>}
                  {ach.evidenceLinks.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-2">
                      {ach.evidenceLinks.map((link, i) => (
                        <a key={i} href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-brand hover:underline">
                          <ExternalLink className="h-3 w-3" /> Link {i + 1}
                        </a>
                      ))}
                    </div>
                  )}
                  {ach.rejectionReason && (
                    <div className="mt-1 rounded-md bg-rose-50 px-2 py-1 text-xs text-rose-600">
                      Rejection: {ach.rejectionReason}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {ach.state === "SUBMITTED" && (
                    <>
                      {showNoteFor === ach.id ? (
                        <div className="flex items-center gap-1">
                          <input type="text" placeholder="Note (optional)" value={verifyNote} onChange={(e) => setVerifyNote(e.target.value)} className="w-40 rounded-lg border border-slate-200 px-2 py-1 text-xs outline-none focus:border-brand" />
                          <button type="button" onClick={() => handleVerify(ach.id, true)} disabled={actionId === ach.id} className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50" title="Approve">
                            {actionId === ach.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                          </button>
                          <button type="button" onClick={() => handleVerify(ach.id, false)} disabled={actionId === ach.id} className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-500 text-white hover:bg-rose-600 disabled:opacity-50" title="Reject">
                            <XCircle className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button type="button" onClick={() => setShowNoteFor(ach.id)} className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100">
                          <ClipboardCheck className="h-3 w-3" /> Review
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
