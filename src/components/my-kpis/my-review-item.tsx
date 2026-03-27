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
  const rejectLabel = isRecommend ? "Send Back" : "Reject";

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
        rejectionType: !approved ? (isRecommend ? "SEND_BACK" : "REJECT") : undefined,
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
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-gray-900">{item.kpiTitle}</span>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  isRecommend
                    ? "bg-blue-100 text-blue-700"
                    : "bg-indigo-100 text-indigo-700"
                }`}
              >
                {isRecommend ? "Needs Recommendation" : "Needs Verification"}
              </span>
            </div>
            <div className="mt-1 text-xs text-gray-500">
              <span className="font-medium">{item.facultyName}</span>
              {item.facultyDesignation ? ` | ${item.facultyDesignation}` : ""}
            </div>
          </div>
          <div className="text-right text-sm">
            <div className="text-gray-500">
              Target: <strong>{item.targetDisplay}</strong>
            </div>
            <div className="text-gray-700">
              Actual: <strong>{item.actualDisplay}</strong>
            </div>
          </div>
        </div>

        {item.evidenceDescription ? (
          <div className="rounded bg-gray-50 p-2 text-xs text-gray-600">
            {item.evidenceDescription}
          </div>
        ) : null}

        {item.evidenceLinks.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {item.evidenceLinks.map((link, index) => (
              <a
                key={`${link}-${index}`}
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className="max-w-xs truncate text-xs text-blue-600 hover:underline"
              >
                Evidence {index + 1}
              </a>
            ))}
          </div>
        ) : null}

        <button
          onClick={() => setExpanded(!expanded)}
          className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          {expanded ? "Less details" : "More details"}
        </button>

        {expanded ? (
          <div className="space-y-3 border-t border-gray-100 pt-3">
            {item.achievementFormData && item.achievementFormConfig ? (
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase text-gray-500">Form Data</h4>
                <DynamicFormRenderer
                  fields={item.achievementFormConfig.fields}
                  values={item.achievementFormData}
                  onChange={() => {}}
                  readOnly
                />
              </div>
            ) : null}

            {item.submissionTrail.length > 0 || item.verificationLog.length > 0 ? (
              <MyAchievementTrail trail={item.submissionTrail} log={item.verificationLog} />
            ) : null}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-md bg-red-50 p-2 text-xs text-red-700">{error}</div>
        ) : null}

        <div className="flex items-center gap-3 border-t border-gray-100 pt-3">
          <input
            type="text"
            className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
            placeholder={`Add a note (${rejectLabel.toLowerCase()} requires a reason)...`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
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
