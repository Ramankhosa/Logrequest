"use client";

import type {
  TransferKpiPolicy,
  TransferKpiTargetAction,
  TransferableTarget,
} from "@/lib/personnel/shared";

const selectClassName =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-900";

export function TransferPolicyEditor({
  policy,
  onPolicyChange,
  targets,
  selectiveActions,
  onSelectiveActionChange,
}: {
  policy: TransferKpiPolicy;
  onPolicyChange: (policy: TransferKpiPolicy) => void;
  targets: TransferableTarget[];
  selectiveActions: Record<string, TransferKpiTargetAction | "">;
  onSelectiveActionChange: (
    targetAllocationId: string,
    action: TransferKpiTargetAction | "",
  ) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        {[
          {
            key: "CARRY_ALL" as const,
            label: "Carry all active targets",
            description: "Active user-owned targets stay with the member after the move.",
          },
          {
            key: "LEAVE_ALL" as const,
            label: "Leave all active targets",
            description: "Active user-owned targets convert to source-unit ownership.",
          },
          {
            key: "SELECTIVE" as const,
            label: "Choose per target",
            description: "Pick carry or leave for each editable active target.",
          },
        ].map((option) => (
          <label
            key={option.key}
            className={`flex cursor-pointer flex-col gap-2 rounded-2xl border px-4 py-4 transition ${
              policy === option.key
                ? "border-slate-900 bg-slate-950 text-white"
                : "border-slate-200 bg-white text-slate-700"
            }`}
          >
            <div className="flex items-start gap-3">
              <input
                type="radio"
                name="kpi-transfer-policy"
                value={option.key}
                checked={policy === option.key}
                onChange={() => onPolicyChange(option.key)}
                className="mt-1"
              />
              <div>
                <div className="text-sm font-semibold">{option.label}</div>
                <div
                  className={`mt-1 text-xs ${
                    policy === option.key ? "text-slate-200" : "text-slate-500"
                  }`}
                >
                  {option.description}
                </div>
              </div>
            </div>
          </label>
        ))}
      </div>

      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Review routing stays on the KPI&apos;s configured review chain. Transferring a member
        does not reroute submitted or future verification steps.
      </div>

      {targets.length > 0 ? (
        <div className="overflow-hidden rounded-[1.5rem] border border-slate-200/80 bg-white/80">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200/80 text-left">
              <thead className="bg-slate-50/80">
                <tr>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    KPI
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Period
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Target
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Status
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Decision
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/80">
                {targets.map((target) => (
                  <tr key={target.targetAllocationId} className="align-top">
                    <td className="px-4 py-4 text-sm font-semibold text-slate-900">
                      {target.kpiTitle}
                    </td>
                    <td className="px-4 py-4 text-sm text-slate-600">{target.periodName}</td>
                    <td className="px-4 py-4 text-sm text-slate-600">{target.targetDisplay}</td>
                    <td className="px-4 py-4 text-sm text-slate-600">
                      {target.isLocked ? "Locked" : "Active"}
                    </td>
                    <td className="px-4 py-4 text-sm text-slate-600">
                      {target.isLocked ? (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900">
                          Locked at source
                        </span>
                      ) : policy === "SELECTIVE" ? (
                        <select
                          className={selectClassName}
                          value={selectiveActions[target.targetAllocationId] ?? ""}
                          onChange={(event) =>
                            onSelectiveActionChange(
                              target.targetAllocationId,
                              event.target.value as TransferKpiTargetAction | "",
                            )
                          }
                        >
                          <option value="">Select action</option>
                          <option value="CARRY">Carry</option>
                          <option value="LEAVE">Leave</option>
                        </select>
                      ) : (
                        <span className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                          {policy === "CARRY_ALL" ? "Carry" : "Leave"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          No user-owned KPI targets remain on or after the effective date.
        </div>
      )}
    </div>
  );
}
