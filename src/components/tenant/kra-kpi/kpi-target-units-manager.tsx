"use client";

import { useEffect, useMemo, useState } from "react";
import { Building2, Loader2, Plus, Save, Trash2 } from "lucide-react";
import type { KpiTargetUnitView } from "@/lib/kra-kpi/shared";

type UnitOption = {
  id: string;
  name: string;
};

type DraftState = Record<
  string,
  {
    targetShare: string;
    notes: string;
  }
>;

function toDrafts(targetUnits: KpiTargetUnitView[]): DraftState {
  return Object.fromEntries(
    targetUnits.map((targetUnit) => [
      targetUnit.id,
      {
        targetShare:
          targetUnit.targetShare != null ? String(targetUnit.targetShare) : "",
        notes: targetUnit.notes ?? "",
      },
    ]),
  );
}

export function KpiTargetUnitsManager({
  kpiId,
  startingUnitId,
  units,
  targetUnits,
  onChanged,
}: {
  kpiId: string;
  startingUnitId: string;
  units: UnitOption[];
  targetUnits: KpiTargetUnitView[];
  onChanged: () => void;
}) {
  const [drafts, setDrafts] = useState<DraftState>({});
  const [addUnitId, setAddUnitId] = useState("");
  const [addShare, setAddShare] = useState("");
  const [addNotes, setAddNotes] = useState("");
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    setDrafts(toDrafts(targetUnits));
  }, [targetUnits]);

  const availableUnits = useMemo(
    () =>
      units.filter(
        (unit) =>
          unit.id !== startingUnitId &&
          !targetUnits.some((targetUnit) => targetUnit.unitId === unit.id),
      ),
    [startingUnitId, targetUnits, units],
  );

  const totalShare = targetUnits.reduce(
    (sum, targetUnit) => sum + (targetUnit.targetShare ?? 0),
    0,
  );

  const setDraftPatch = (
    targetUnitId: string,
    patch: Partial<{ targetShare: string; notes: string }>,
  ) => {
    setDrafts((current) => ({
      ...current,
      [targetUnitId]: {
        targetShare: current[targetUnitId]?.targetShare ?? "",
        notes: current[targetUnitId]?.notes ?? "",
        ...patch,
      },
    }));
  };

  const handleAdd = async () => {
    if (!addUnitId) return;

    setActionKey("add");
    setFeedback(null);

    try {
      const response = await fetch(`/api/tenant/kra-kpi/kpis/${kpiId}/target-units`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          unitId: addUnitId,
          targetShare: addShare.trim() ? Number(addShare) : undefined,
          notes: addNotes.trim() || undefined,
        }),
      });
      const data = await response.json();

      if (!response.ok || data.status !== "success") {
        setFeedback(data.message ?? "Failed to add target department.");
        setActionKey(null);
        return;
      }

      setAddUnitId("");
      setAddShare("");
      setAddNotes("");
      onChanged();
    } catch {
      setFeedback("Failed to add target department.");
    }

    setActionKey(null);
  };

  const handleSave = async (targetUnit: KpiTargetUnitView) => {
    const draft = drafts[targetUnit.id] ?? {
      targetShare: "",
      notes: "",
    };

    setActionKey(`save:${targetUnit.id}`);
    setFeedback(null);

    try {
      const response = await fetch(`/api/tenant/kra-kpi/kpis/${kpiId}/target-units`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          unitId: targetUnit.unitId,
          targetShare: draft.targetShare.trim() ? Number(draft.targetShare) : null,
          notes: draft.notes.trim() || null,
        }),
      });
      const data = await response.json();

      if (!response.ok || data.status !== "success") {
        setFeedback(data.message ?? "Failed to update target department.");
        setActionKey(null);
        return;
      }

      onChanged();
    } catch {
      setFeedback("Failed to update target department.");
    }

    setActionKey(null);
  };

  const handleRemove = async (unitId: string) => {
    setActionKey(`remove:${unitId}`);
    setFeedback(null);

    try {
      const response = await fetch(`/api/tenant/kra-kpi/kpis/${kpiId}/target-units`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unitId }),
      });
      const data = await response.json();

      if (!response.ok || data.status !== "success") {
        setFeedback(data.message ?? "Failed to remove target department.");
        setActionKey(null);
        return;
      }

      onChanged();
    } catch {
      setFeedback("Failed to remove target department.");
    }

    setActionKey(null);
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h5 className="text-sm font-semibold text-slate-900">
            Target Departments
          </h5>
          <p className="mt-1 text-xs text-slate-500">
            Configure the departments and optional percentage shares used for
            target-based allocation.
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
          {targetUnits.length} configured
        </span>
      </div>

      {targetUnits.length > 0 ? (
        <div className="mt-4 space-y-3">
          {targetUnits.map((targetUnit) => {
            const draft = drafts[targetUnit.id] ?? {
              targetShare: "",
              notes: "",
            };
            const isDirty =
              draft.targetShare !==
                (targetUnit.targetShare != null
                  ? String(targetUnit.targetShare)
                  : "") ||
              draft.notes !== (targetUnit.notes ?? "");
            const saveKey = `save:${targetUnit.id}`;
            const removeKey = `remove:${targetUnit.unitId}`;

            return (
              <div
                key={targetUnit.id}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex items-start gap-3">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-slate-500">
                      <Building2 className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">
                        {targetUnit.unitName}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {targetUnit.unitCode || "No code"}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleRemove(targetUnit.unitId)}
                    disabled={actionKey !== null}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 transition hover:border-rose-200 hover:text-rose-600 disabled:opacity-50"
                    title="Remove target department"
                  >
                    {actionKey === removeKey ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </button>
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-[140px_minmax(0,1fr)_auto]">
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      Share %
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      placeholder="Equal"
                      value={draft.targetShare}
                      onChange={(event) =>
                        setDraftPatch(targetUnit.id, {
                          targetShare: event.target.value,
                        })
                      }
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand focus:ring-1 focus:ring-brand/30"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      Notes
                    </label>
                    <input
                      type="text"
                      placeholder="Optional"
                      value={draft.notes}
                      onChange={(event) =>
                        setDraftPatch(targetUnit.id, {
                          notes: event.target.value,
                        })
                      }
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand focus:ring-1 focus:ring-brand/30"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleSave(targetUnit)}
                    disabled={!isDirty || actionKey !== null}
                    className="mt-[18px] inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {actionKey === saveKey ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    Save
                  </button>
                </div>
              </div>
            );
          })}

          {totalShare > 0 ? (
            <p
              className={`text-xs ${
                Math.abs(totalShare - 100) < 0.01
                  ? "text-emerald-600"
                  : "text-amber-600"
              }`}
            >
              Total configured share: {totalShare}%
              {Math.abs(totalShare - 100) < 0.01
                ? " (valid)"
                : " (if you use shares, aim for 100%)"}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
          No target departments configured yet.
        </div>
      )}

      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_120px_minmax(0,1fr)_auto]">
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Department
          </label>
          <select
            value={addUnitId}
            onChange={(event) => setAddUnitId(event.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand focus:ring-1 focus:ring-brand/30"
          >
            <option value="">Add department...</option>
            {availableUnits.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Share %
          </label>
          <input
            type="number"
            min={0}
            max={100}
            placeholder="Optional"
            value={addShare}
            onChange={(event) => setAddShare(event.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand focus:ring-1 focus:ring-brand/30"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Notes
          </label>
          <input
            type="text"
            placeholder="Optional"
            value={addNotes}
            onChange={(event) => setAddNotes(event.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand focus:ring-1 focus:ring-brand/30"
          />
        </div>
        <button
          type="button"
          onClick={() => void handleAdd()}
          disabled={!addUnitId || actionKey !== null}
          className="mt-[18px] inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {actionKey === "add" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          Add
        </button>
      </div>

      {feedback ? <p className="mt-2 text-xs text-rose-600">{feedback}</p> : null}
    </div>
  );
}
