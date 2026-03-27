"use client";

import type { SubmissionTrailView, VerificationLogEntry } from "@/lib/kra-kpi/shared";

type Props = {
  trail?: SubmissionTrailView[];
  log?: VerificationLogEntry[];
};

type TimelineEntry = {
  id: string;
  action: string;
  note: string | null;
  actorName: string;
  actorRole: string | null;
  at: Date;
  metadata: Record<string, unknown> | null;
};

function coerceDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

const ACTION_MARKERS: Record<string, string> = {
  SUBMITTED: "S",
  RESUBMITTED: "R",
  RECOMMENDED: "R",
  VERIFIED: "V",
  REJECTED: "X",
  SENT_BACK: "B",
  WITHDRAWN: "W",
  CORRECTED: "C",
  REWARD_RECALCULATED: "$",
  REWARD_REVOKED: "!",
  REWARD_RELEASED: "$",
  REWARD_MARKED_PENDING: "P",
  submitted: "S",
  recommended: "R",
  verified: "V",
  "not approved": "X",
  "sent back": "B",
  withdrawn: "W",
};

function prettifyAction(action: string) {
  return action
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeEntries(trail?: SubmissionTrailView[], log?: VerificationLogEntry[]): TimelineEntry[] {
  if (trail && trail.length > 0) {
    return trail.map((entry) => ({
      id: entry.id,
      action: entry.action,
      note: entry.note,
      actorName: entry.actorName,
      actorRole: entry.actorRole,
      at: coerceDate(entry.createdAt),
      metadata: entry.metadata,
    }));
  }

  return (log ?? []).map((entry, index) => ({
    id: `${entry.userId}-${entry.at}-${index}`,
    action: entry.action,
    note: entry.note ?? null,
    actorName: entry.userName,
    actorRole: entry.level,
    at: new Date(entry.at),
    metadata: null,
  }));
}

export function MyAchievementTrail({ trail, log }: Props) {
  const entries = normalizeEntries(trail, log);
  if (entries.length === 0) return null;

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        Activity Timeline
      </h4>
      <div className="relative space-y-3 border-l-2 border-gray-200 pl-4">
        {entries.map((entry) => {
          const changedFields = Array.isArray(entry.metadata?.changedFieldKeys)
            ? entry.metadata.changedFieldKeys.filter(
                (value): value is string => typeof value === "string" && value.trim().length > 0,
              )
            : [];

          return (
            <div key={entry.id} className="relative">
              <div className="absolute -left-[1.375rem] top-0.5 flex h-3 w-3 items-center justify-center rounded-full border-2 border-gray-300 bg-white text-[8px] font-semibold text-gray-500" />
              <div className="space-y-1 text-xs text-gray-600">
                <div>
                  <span className="mr-1 font-semibold text-gray-500">
                    {ACTION_MARKERS[entry.action] ?? "•"}
                  </span>
                  <span className="font-medium">
                    {entry.at.toLocaleDateString("en-IN", {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                  {" — "}
                  <span>{entry.actorName}</span>
                  {entry.actorRole ? (
                    <span className="text-gray-400"> ({entry.actorRole})</span>
                  ) : null}
                  {" "}
                  <span className="text-gray-500">{prettifyAction(entry.action)}</span>
                  {entry.note ? (
                    <span className="text-gray-500">: &ldquo;{entry.note}&rdquo;</span>
                  ) : null}
                </div>
                {changedFields.length > 0 ? (
                  <div className="text-[11px] text-gray-500">
                    Changed: {changedFields.join(", ")}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
