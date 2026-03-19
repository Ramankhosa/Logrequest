"use client";

import type { VerificationLogEntry } from "@/lib/kra-kpi/shared";

type Props = {
  log: VerificationLogEntry[];
};

const ACTION_ICONS: Record<string, string> = {
  submitted: "📝",
  recommended: "👍",
  verified: "✅",
  "not approved": "❌",
  "sent back": "↩️",
  withdrawn: "⏪",
};

export function MyAchievementTrail({ log }: Props) {
  if (log.length === 0) return null;

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
        Verification Trail
      </h4>
      <div className="relative border-l-2 border-gray-200 pl-4 space-y-3">
        {log.map((entry, i) => {
          const date = new Date(entry.at);
          const icon = ACTION_ICONS[entry.action] ?? "•";
          return (
            <div key={i} className="relative">
              <div className="absolute -left-[1.375rem] top-0.5 h-3 w-3 rounded-full bg-white border-2 border-gray-300" />
              <div className="text-xs text-gray-600">
                <span className="mr-1">{icon}</span>
                <span className="font-medium">
                  {date.toLocaleDateString("en-IN", {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
                {" — "}
                <span>{entry.userName}</span>
                {" "}
                <span className="text-gray-500">{entry.action}</span>
                {entry.note && (
                  <span className="text-gray-500">: &ldquo;{entry.note}&rdquo;</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
