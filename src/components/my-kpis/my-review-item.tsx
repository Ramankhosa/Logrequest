"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { ReviewQueueItem } from "@/lib/kra-kpi/shared";
import { MyAchievementTrail } from "./my-achievement-trail";
import { DynamicFormRenderer } from "./dynamic-form-renderer";

type Props = {
  item: ReviewQueueItem;
  onActionComplete: () => void;
};

export function MyReviewItem({ item, onActionComplete }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState("");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRecommend = item.reviewLevel === "RECOMMEND";
  const approveLabel = isRecommend ? "Recommend" : "Verify";
  const rejectLabel = isRecommend ? "Send Back" : "Not Approve";

  const handleAction = async (approved: boolean) => {
    if (!approved && !note.trim()) {
      setError("Please provide a reason.");
      return;
    }

    setProcessing(true);
    setError(null);

    const res = await fetch("/api/tenant/kra-kpi/my/recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        achievementId: item.achievementId,
        approved,
        note: note.trim() || undefined,
        level: item.reviewLevel,
      }),
    });

    const data = await res.json();
    setProcessing(false);

    if (data.status === "error") {
      setError(data.message);
      return;
    }

    onActionComplete();
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-gray-900">{item.kpiTitle}</span>
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                isRecommend
                  ? "bg-blue-100 text-blue-700"
                  : "bg-indigo-100 text-indigo-700"
              }`}>
                {isRecommend ? "Needs Recommendation" : "Needs Verification"}
              </span>
            </div>
            <div className="mt-1 text-xs text-gray-500">
              <span className="font-medium">{item.facultyName}</span>
              {item.facultyDesignation && ` — ${item.facultyDesignation}`}
            </div>
          </div>
          <div className="text-right text-sm">
            <div className="text-gray-500">
              Target: <strong>{item.targetValue ?? "—"}</strong>
              {item.unitLabel ? ` ${item.unitLabel}` : ""}
            </div>
            <div className="text-gray-700">
              Actual: <strong>{item.actualValue ?? "—"}</strong>
            </div>
          </div>
        </div>

        {/* Evidence summary */}
        {item.evidenceDescription && (
          <div className="text-xs text-gray-600 bg-gray-50 rounded p-2">
            {item.evidenceDescription}
          </div>
        )}

        {item.evidenceLinks.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {item.evidenceLinks.map((link, i) => (
              <a
                key={i}
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:underline truncate max-w-xs"
              >
                Evidence {i + 1}
              </a>
            ))}
          </div>
        )}

        {/* Expand for details */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          {expanded ? "Less details" : "More details"}
        </button>

        {expanded && (
          <div className="border-t border-gray-100 pt-3 space-y-3">
            {/* Form data */}
            {item.achievementFormData && item.achievementFormConfig && (
              <div>
                <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Form Data</h4>
                <DynamicFormRenderer
                  fields={item.achievementFormConfig.fields}
                  values={item.achievementFormData}
                  onChange={() => {}}
                  readOnly
                />
              </div>
            )}

            {/* Trail */}
            {item.verificationLog.length > 0 && (
              <MyAchievementTrail log={item.verificationLog} />
            )}
          </div>
        )}

        {/* Action area */}
        {error && (
          <div className="rounded-md bg-red-50 p-2 text-xs text-red-700">{error}</div>
        )}

        <div className="flex items-center gap-3 border-t border-gray-100 pt-3">
          <input
            type="text"
            className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
            placeholder={`Add a note (${rejectLabel.toLowerCase()} requires a reason)...`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            onClick={() => handleAction(true)}
            disabled={processing}
            className="inline-flex items-center rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {processing ? "..." : approveLabel}
          </button>
          <button
            onClick={() => handleAction(false)}
            disabled={processing}
            className="inline-flex items-center rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {processing ? "..." : rejectLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
