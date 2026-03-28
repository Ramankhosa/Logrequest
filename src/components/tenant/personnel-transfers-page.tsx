"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ExternalLink } from "lucide-react";
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

export function PersonnelTransfersPageClient({
  setup,
  initialTransfers,
  initialMembershipId,
}: {
  setup: TransferSetupOptions;
  initialTransfers: TransferView[];
  initialMembershipId?: string;
}) {
  const router = useRouter();
  const [membershipId, setMembershipId] = useState(
    initialMembershipId && setup.members.some((member) => member.membershipId === initialMembershipId)
      ? initialMembershipId
      : (setup.members[0]?.membershipId ?? ""),
  );
  const [targetUnitId, setTargetUnitId] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [reason, setReason] = useState("");
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [policy, setPolicy] = useState<TransferKpiPolicy>("CARRY_ALL");
  const [selectiveActions, setSelectiveActions] = useState<
    Record<string, TransferKpiTargetAction | "">
  >({});
  const [targets, setTargets] = useState<TransferableTarget[]>([]);
  const [previewError, setPreviewError] = useState("");
  const [apiError, setApiError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  const selectedMember = useMemo(
    () => setup.members.find((member) => member.membershipId === membershipId) ?? null,
    [membershipId, setup.members],
  );

  const targetUnits = useMemo(
    () =>
      setup.units.filter((unit) => unit.code !== selectedMember?.sourceUnitCode),
    [selectedMember?.sourceUnitCode, setup.units],
  );

  useEffect(() => {
    setTargetUnitId("");
    setSelectedRoleIds([]);
    setTargets([]);
    setSelectiveActions({});
    setPreviewError("");
  }, [membershipId]);

  useEffect(() => {
    if (!selectedMember || !effectiveDate) return;

    const controller = new AbortController();
    const params = new URLSearchParams({
      membershipId: selectedMember.membershipId,
      sourceUnitId: selectedMember.sourceUnitId,
      effectiveDate,
    });

    setIsPreviewLoading(true);
    setPreviewError("");

    fetch(`/api/tenant/personnel/transfers/targets?${params.toString()}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const json = (await response.json()) as {
          status: "success" | "error";
          message?: string;
          targets?: TransferableTarget[];
        };
        if (!response.ok || json.status === "error") {
          throw new Error(json.message ?? "Target preview could not be loaded.");
        }
        setTargets(json.targets ?? []);
      })
      .catch((error: unknown) => {
        if ((error as { name?: string }).name === "AbortError") return;
        setTargets([]);
        setPreviewError(
          error instanceof Error ? error.message : "Target preview could not be loaded.",
        );
      })
      .finally(() => setIsPreviewLoading(false));

    return () => controller.abort();
  }, [effectiveDate, selectedMember]);

  function setSelectiveAction(
    targetAllocationId: string,
    action: TransferKpiTargetAction | "",
  ) {
    setSelectiveActions((current) => ({
      ...current,
      [targetAllocationId]: action,
    }));
  }

  async function handleSubmit() {
    if (!selectedMember) {
      setApiError("Select a member before creating a transfer.");
      return;
    }
    if (!targetUnitId) {
      setApiError("Select a target unit.");
      return;
    }

    const activeTargets = targets.filter((target) => !target.isLocked);
    if (
      policy === "SELECTIVE" &&
      activeTargets.some((target) => !selectiveActions[target.targetAllocationId])
    ) {
      setApiError("Selective portability requires an explicit action for every active target.");
      return;
    }

    setApiError("");
    setIsSubmitting(true);

    try {
      const body = {
        membershipId: selectedMember.membershipId,
        sourceUnitId: selectedMember.sourceUnitId,
        targetUnitId,
        effectiveDate,
        reason: reason.trim() || undefined,
        newRoleDefinitionIds: selectedRoleIds,
        kpiTransferPolicy: policy,
        kpiTransferDetails:
          policy === "SELECTIVE"
            ? activeTargets.map((target) => ({
                targetAllocationId: target.targetAllocationId,
                action: selectiveActions[target.targetAllocationId],
              }))
            : [],
      };

      const response = await fetch("/api/tenant/personnel/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await response.json()) as {
        status: "success" | "error";
        message?: string;
        transferId?: string;
      };

      if (!response.ok || json.status === "error") {
        setApiError(json.message ?? "Transfer could not be created.");
        return;
      }

      if (json.transferId) {
        router.push(`/tenant-admin/personnel/transfers/${json.transferId}`);
        router.refresh();
        return;
      }

      router.refresh();
    } catch {
      setApiError("Transfer could not be created.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6 rounded-[2rem] border border-slate-200/80 bg-white/90 p-6 shadow-sm">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Initiate
            </p>
            <h2 className="text-xl font-semibold text-slate-900">New Department Transfer</h2>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label="Employee"
              input={
                <select
                  className={inputClassName}
                  value={membershipId}
                  onChange={(event) => setMembershipId(event.target.value)}
                >
                  {setup.members.map((member) => (
                    <option key={member.membershipId} value={member.membershipId}>
                      {member.name} ({member.sourceUnitCode})
                    </option>
                  ))}
                </select>
              }
            />
            <Field
              label="Effective Date"
              input={
                <input
                  className={inputClassName}
                  type="date"
                  value={effectiveDate}
                  onChange={(event) => setEffectiveDate(event.target.value)}
                />
              }
            />
            <Field
              label="Source Unit"
              input={
                <input
                  className={`${inputClassName} bg-slate-50`}
                  value={
                    selectedMember
                      ? `${selectedMember.sourceUnitName} (${selectedMember.sourceUnitCode})`
                      : ""
                  }
                  disabled
                />
              }
            />
            <Field
              label="Target Unit"
              input={
                <select
                  className={inputClassName}
                  value={targetUnitId}
                  onChange={(event) => setTargetUnitId(event.target.value)}
                >
                  <option value="">Select a target unit</option>
                  {targetUnits.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name} ({unit.code})
                    </option>
                  ))}
                </select>
              }
            />
          </div>

          <Field
            label="Reason"
            input={
              <textarea
                className={`${inputClassName} min-h-28 resize-y`}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Optional context for the transfer"
              />
            }
          />

          <Field
            label="Roles In Target Unit"
            hint="Selected source-unit roles will be removed during execution."
            input={
              <select
                multiple
                className={`${inputClassName} min-h-36`}
                value={selectedRoleIds}
                onChange={(event) =>
                  setSelectedRoleIds(
                    Array.from(event.target.selectedOptions).map((option) => option.value),
                  )
                }
              >
                {setup.roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.displayLabel}
                    {role.isUnitHead ? " (Unit Head)" : ""}
                  </option>
                ))}
              </select>
            }
          />

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-900">KPI Portability</p>
                <p className="text-sm text-slate-500">
                  Locked targets stay with the source department automatically.
                </p>
              </div>
              {isPreviewLoading ? (
                <span className="text-sm text-slate-500">Loading targets…</span>
              ) : null}
            </div>

            {previewError ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {previewError}
              </div>
            ) : (
              <TransferPolicyEditor
                policy={policy}
                onPolicyChange={setPolicy}
                targets={targets}
                selectiveActions={selectiveActions}
                onSelectiveActionChange={setSelectiveAction}
              />
            )}
          </div>

          {apiError ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {apiError}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!selectedMember || isSubmitting}
              className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              Create Transfer
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="rounded-[2rem] border border-slate-200/80 bg-slate-950 p-6 text-slate-100">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            Summary
          </p>
          <div className="mt-4 space-y-4">
            <SummaryRow
              label="Selected member"
              value={selectedMember?.name ?? "None"}
              subvalue={selectedMember?.email ?? null}
            />
            <SummaryRow
              label="Source"
              value={
                selectedMember
                  ? `${selectedMember.sourceUnitName} (${selectedMember.sourceUnitCode})`
                  : "None"
              }
            />
            <SummaryRow
              label="Target"
              value={
                targetUnits.find((unit) => unit.id === targetUnitId)
                  ? `${targetUnits.find((unit) => unit.id === targetUnitId)!.name} (${targetUnits.find((unit) => unit.id === targetUnitId)!.code})`
                  : "Not selected"
              }
            />
            <SummaryRow
              label="Portable targets"
              value={String(targets.length)}
              subvalue={`${targets.filter((target) => target.isLocked).length} locked at source`}
            />
            <SummaryRow
              label="Target roles"
              value={selectedRoleIds.length ? String(selectedRoleIds.length) : "None"}
            />
          </div>
        </div>
      </section>

      <section className="rounded-[2rem] border border-slate-200/80 bg-white/90 p-6 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Existing
            </p>
            <h2 className="text-xl font-semibold text-slate-900">Transfer Queue</h2>
          </div>
        </div>

        <div className="mt-6 overflow-hidden rounded-[1.5rem] border border-slate-200/80 bg-white/80">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200/80 text-left">
              <thead className="bg-slate-50/80">
                <tr>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Member
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Route
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Effective Date
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Status
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Open
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/80">
                {initialTransfers.length ? (
                  initialTransfers.map((transfer) => (
                    <tr key={transfer.id}>
                      <td className="px-4 py-4 text-sm font-semibold text-slate-900">
                        {transfer.userName}
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-600">
                        {transfer.sourceUnitCode} → {transfer.targetUnitCode}
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-600">
                        {formatDate(transfer.effectiveDate)}
                      </td>
                      <td className="px-4 py-4">
                        <StatusBadge label={transfer.status} />
                      </td>
                      <td className="px-4 py-4">
                        <Link
                          href={`/tenant-admin/personnel/transfers/${transfer.id}`}
                          className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline"
                        >
                          View
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Link>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-8 text-center text-sm text-slate-500"
                    >
                      No transfer records yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

function Field({
  label,
  input,
  hint,
}: {
  label: string;
  input: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      {input}
      {hint ? <span className="text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}

function SummaryRow({
  label,
  value,
  subvalue,
}: {
  label: string;
  value: string;
  subvalue?: string | null;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-white">{value}</p>
      {subvalue ? <p className="mt-1 text-xs text-slate-400">{subvalue}</p> : null}
    </div>
  );
}

function formatDate(value: Date) {
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
