"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Play, RefreshCw, XCircle } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { TransferPolicyEditor } from "@/components/tenant/personnel-transfer-policy-editor";
import type {
  TransferKpiPolicy,
  TransferKpiTargetAction,
  TransferSetupOptions,
  TransferView,
  TransferableTarget,
} from "@/lib/personnel/shared";

const inputClassName =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-900";

export function PersonnelTransferDetailClient({
  transfer,
  setup,
  previewTargets,
}: {
  transfer: TransferView;
  setup: TransferSetupOptions;
  previewTargets: TransferableTarget[];
}) {
  const router = useRouter();
  const [policy, setPolicy] = useState<TransferKpiPolicy>(
    transfer.kpiTransferPolicy ?? "CARRY_ALL",
  );
  const [selectiveActions, setSelectiveActions] = useState<
    Record<string, TransferKpiTargetAction | "">
  >(
    Object.fromEntries(
      transfer.kpiTransferDetails.map((detail) => [detail.targetAllocationId, detail.action]),
    ),
  );
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [reassignSelections, setReassignSelections] = useState<Record<string, string>>({});

  const sourceCandidates = useMemo(
    () =>
      setup.members.filter(
        (member) =>
          member.sourceUnitCode === transfer.sourceUnitCode &&
          member.membershipId !== transfer.membershipId,
      ),
    [setup.members, transfer.membershipId, transfer.sourceUnitCode],
  );

  const detachedTargets = useMemo(() => {
    const latestByTarget = new Map<string, TransferView["targetActions"][number]>();
    for (const action of transfer.targetActions) {
      latestByTarget.set(action.targetAllocationId, action);
    }
    return [...latestByTarget.values()].filter(
      (action) =>
        action.action === "LEFT_BEHIND" || action.action === "LOCKED_SOURCE_ONLY",
    );
  }, [transfer.targetActions]);

  function setSelectiveAction(
    targetAllocationId: string,
    action: TransferKpiTargetAction | "",
  ) {
    setSelectiveActions((current) => ({
      ...current,
      [targetAllocationId]: action,
    }));
  }

  async function sendAction(
    endpoint: string,
    method: "PATCH" | "POST",
    body: Record<string, unknown>,
    successMessage: string,
  ) {
    setIsBusy(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await response.json()) as {
        status: "success" | "error";
        message?: string;
      };

      if (!response.ok || json.status === "error") {
        setError(json.message ?? "The request could not be completed.");
        return;
      }

      setMessage(json.message ?? successMessage);
      router.refresh();
    } catch {
      setError("The request could not be completed.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleConfigure() {
    const activeTargets = previewTargets.filter((target) => !target.isLocked);
    if (
      policy === "SELECTIVE" &&
      activeTargets.some((target) => !selectiveActions[target.targetAllocationId])
    ) {
      setError("Selective portability requires an explicit action for every active target.");
      return;
    }

    await sendAction(
      `/api/tenant/personnel/transfers/${transfer.id}`,
      "PATCH",
      {
        action: "configure",
        kpiTransferPolicy: policy,
        kpiTransferDetails:
          policy === "SELECTIVE"
            ? activeTargets.map((target) => ({
                targetAllocationId: target.targetAllocationId,
                action: selectiveActions[target.targetAllocationId],
              }))
            : [],
      },
      "Transfer portability updated.",
    );
  }

  async function handleApprove() {
    await sendAction(
      `/api/tenant/personnel/transfers/${transfer.id}`,
      "PATCH",
      { action: "approve" },
      "Transfer approved.",
    );
  }

  async function handleReject() {
    const reason = window.prompt("Reason for rejection (optional):") ?? undefined;
    await sendAction(
      `/api/tenant/personnel/transfers/${transfer.id}`,
      "PATCH",
      { action: "reject", reason },
      "Transfer rejected.",
    );
  }

  async function handleCancel() {
    const reason = window.prompt("Reason for cancellation (optional):") ?? undefined;
    await sendAction(
      `/api/tenant/personnel/transfers/${transfer.id}`,
      "PATCH",
      { action: "cancel", reason },
      "Transfer cancelled.",
    );
  }

  async function handleExecute() {
    const completionNotes = window.prompt("Completion notes (optional):") ?? undefined;
    await sendAction(
      `/api/tenant/personnel/transfers/${transfer.id}/execute`,
      "POST",
      { completionNotes },
      "Transfer executed.",
    );
  }

  async function handleReassign(targetAllocationId: string) {
    const newUserId = reassignSelections[targetAllocationId];
    if (!newUserId) {
      setError("Select a source-unit member before reassigning a detached target.");
      return;
    }

    await sendAction(
      "/api/tenant/personnel/transfers/reassign",
      "POST",
      {
        transferId: transfer.id,
        targetAllocationId,
        newUserId,
      },
      "Detached KPI target reassigned.",
    );
  }

  return (
    <div className="space-y-8">
      <section className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
        <div className="rounded-[2rem] border border-slate-200/80 bg-white/90 p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Transfer
              </p>
              <h2 className="text-2xl font-semibold text-slate-900">{transfer.userName}</h2>
              <p className="mt-1 text-sm text-slate-500">{transfer.userEmail}</p>
            </div>
            <StatusBadge label={transfer.status} />
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <InfoCard label="Source" value={`${transfer.sourceUnitName} (${transfer.sourceUnitCode})`} />
            <InfoCard label="Target" value={`${transfer.targetUnitName} (${transfer.targetUnitCode})`} />
            <InfoCard label="Effective" value={formatDate(transfer.effectiveDate)} />
            <InfoCard
              label="Roles"
              value={transfer.newRoleDefinitionIds.length ? String(transfer.newRoleDefinitionIds.length) : "None"}
            />
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            {transfer.status === "PROPOSED" ? (
              <>
                <ActionButton
                  icon={<CheckCircle2 className="h-4 w-4" />}
                  label="Approve"
                  onClick={handleApprove}
                  disabled={isBusy}
                />
                <ActionButton
                  icon={<XCircle className="h-4 w-4" />}
                  label="Reject"
                  onClick={handleReject}
                  disabled={isBusy}
                  tone="secondary"
                />
                <ActionButton
                  icon={<XCircle className="h-4 w-4" />}
                  label="Cancel"
                  onClick={handleCancel}
                  disabled={isBusy}
                  tone="secondary"
                />
              </>
            ) : null}
            {transfer.status === "APPROVED" ? (
              <>
                <ActionButton
                  icon={<Play className="h-4 w-4" />}
                  label="Execute"
                  onClick={handleExecute}
                  disabled={isBusy}
                />
                <ActionButton
                  icon={<XCircle className="h-4 w-4" />}
                  label="Cancel"
                  onClick={handleCancel}
                  disabled={isBusy}
                  tone="secondary"
                />
              </>
            ) : null}
          </div>

          {transfer.reason ? (
            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <span className="font-semibold text-slate-900">Reason:</span> {transfer.reason}
            </div>
          ) : null}
          {transfer.completionNotes ? (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <span className="font-semibold text-slate-900">Completion Notes:</span>{" "}
              {transfer.completionNotes}
            </div>
          ) : null}
        </div>

        <div className="rounded-[2rem] border border-slate-200/80 bg-slate-950 p-6 text-slate-100">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            Timeline
          </p>
          <ol className="mt-5 space-y-4">
            {transfer.statusEvents.length ? (
              transfer.statusEvents.map((event) => (
                <li key={event.id} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-white">
                      {formatLabel(event.eventType)}
                    </span>
                    <span className="text-xs text-slate-400">{formatDateTime(event.createdAt)}</span>
                  </div>
                  {event.note ? <p className="mt-2 text-sm text-slate-300">{event.note}</p> : null}
                </li>
              ))
            ) : (
              <li className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
                No status events recorded yet.
              </li>
            )}
          </ol>
        </div>
      </section>

      {transfer.status === "PROPOSED" || transfer.status === "APPROVED" ? (
        <section className="rounded-[2rem] border border-slate-200/80 bg-white/90 p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Portability
              </p>
              <h3 className="text-xl font-semibold text-slate-900">Configure KPI Portability</h3>
            </div>
            <button
              type="button"
              onClick={handleConfigure}
              disabled={isBusy}
              className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <RefreshCw className="h-4 w-4" />
              Save Portability
            </button>
          </div>

          <div className="mt-6">
            <TransferPolicyEditor
              policy={policy}
              onPolicyChange={setPolicy}
              targets={previewTargets}
              selectiveActions={selectiveActions}
              onSelectiveActionChange={setSelectiveAction}
            />
          </div>
        </section>
      ) : null}

      <section className="rounded-[2rem] border border-slate-200/80 bg-white/90 p-6 shadow-sm">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            KPI Actions
          </p>
          <h3 className="text-xl font-semibold text-slate-900">Per-Target Outcomes</h3>
        </div>

        <div className="mt-6 overflow-hidden rounded-[1.5rem] border border-slate-200/80 bg-white/80">
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
                    Action
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Notes
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/80">
                {transfer.targetActions.length ? (
                  transfer.targetActions.map((action) => (
                    <tr key={action.id}>
                      <td className="px-4 py-4 text-sm font-semibold text-slate-900">
                        {action.targetTitle}
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-600">{action.periodName}</td>
                      <td className="px-4 py-4 text-sm text-slate-600">{formatLabel(action.action)}</td>
                      <td className="px-4 py-4 text-sm text-slate-600">
                        {action.notes ?? "—"}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-8 text-center text-sm text-slate-500"
                    >
                      No target actions recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {transfer.status === "COMPLETED" && detachedTargets.length ? (
        <section className="rounded-[2rem] border border-slate-200/80 bg-white/90 p-6 shadow-sm">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Reassign
            </p>
            <h3 className="text-xl font-semibold text-slate-900">Detached Source-Unit Targets</h3>
          </div>

          <div className="mt-6 space-y-4">
            {detachedTargets.map((action) => (
              <div
                key={action.targetAllocationId}
                className="grid gap-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 lg:grid-cols-[1fr_320px_auto]"
              >
                <div>
                  <p className="text-sm font-semibold text-slate-900">{action.targetTitle}</p>
                  <p className="mt-1 text-sm text-slate-500">{action.periodName}</p>
                  <p className="mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                    {formatLabel(action.action)}
                  </p>
                </div>
                <select
                  className={inputClassName}
                  value={reassignSelections[action.targetAllocationId] ?? ""}
                  onChange={(event) =>
                    setReassignSelections((current) => ({
                      ...current,
                      [action.targetAllocationId]: event.target.value,
                    }))
                  }
                >
                  <option value="">Select source-unit member</option>
                  {sourceCandidates.map((member) => (
                    <option key={member.userId} value={member.userId}>
                      {member.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => handleReassign(action.targetAllocationId)}
                  disabled={isBusy}
                  className="rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  Reassign
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {message}
        </div>
      ) : null}
    </div>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  disabled,
  tone = "primary",
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled: boolean;
  tone?: "primary" | "secondary";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-white ${
        tone === "primary"
          ? "bg-slate-950 text-white hover:bg-slate-800"
          : "border border-slate-200 bg-white text-slate-700 hover:border-slate-300"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function formatLabel(value: string) {
  return value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDate(value: Date) {
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(value: Date) {
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
