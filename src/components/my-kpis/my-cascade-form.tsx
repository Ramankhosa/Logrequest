"use client";

import { useState, useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import type { MyAllocationView } from "@/lib/kra-kpi/shared";

type UnitMember = {
  userId: string;
  userName: string;
  isUnitHead: boolean;
};

type ChildUnit = {
  unitId: string;
  unitName: string;
  unitCode: string;
};

type Distribution = {
  assignedToUserId?: string;
  assignedToUnitId?: string;
  name: string;
  targetValue: number;
};

type Props = {
  allocation: MyAllocationView;
  onDone: () => void;
  onCancel: () => void;
};

export function MyCascadeForm({ allocation, onDone, onCancel }: Props) {
  const a = allocation;
  const [members, setMembers] = useState<UnitMember[]>([]);
  const [childUnits, setChildUnits] = useState<ChildUnit[]>([]);
  const [distributions, setDistributions] = useState<Distribution[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"users" | "units">("users");

  const isSummable = a.measurementType === "NUMERIC" || a.measurementType === "CURRENCY";
  const existingChildSum = a.childAllocations.reduce((s, c) => s + (c.targetValue ?? 0), 0);
  const remainingTarget = (a.targetValue ?? 0) - existingChildSum;

  useEffect(() => {
    async function load() {
      if (!a.assignedToUnitId) {
        setLoading(false);
        return;
      }
      const blockedUserIds = new Set(
        a.childAllocations
          .map((child) => child.assignedToUserId)
          .filter((value): value is string => Boolean(value)),
      );
      const blockedUnitIds = new Set(
        a.childAllocations
          .map((child) => child.assignedToUnitId)
          .filter((value): value is string => Boolean(value)),
      );
      const [membersRes, unitsRes] = await Promise.all([
        fetch(`/api/tenant/kra-kpi/my/unit-members?unitId=${a.assignedToUnitId}`),
        fetch(`/api/tenant/kra-kpi/my/child-units?unitId=${a.assignedToUnitId}`),
      ]);

      if (membersRes.ok) {
        const data: UnitMember[] = await membersRes.json();
        setMembers(
          data.filter(
            (member) => !member.isUnitHead && !blockedUserIds.has(member.userId),
          ),
        );
      }
      if (unitsRes.ok) {
        const data: ChildUnit[] = await unitsRes.json();
        setChildUnits(
          data.filter((unit) => !blockedUnitIds.has(unit.unitId)),
        );
      }

      setLoading(false);
    }
    load();
  }, [a.assignedToUnitId, a.childAllocations]);

  const addDistribution = (userId?: string, unitId?: string, name?: string) => {
    const existing = distributions.find(
      (d) => d.assignedToUserId === userId && d.assignedToUnitId === unitId
    );
    if (existing) return;

    setDistributions((prev) => [
      ...prev,
      {
        assignedToUserId: userId,
        assignedToUnitId: unitId,
        name: name ?? "Unknown",
        targetValue: 0,
      },
    ]);
  };

  const removeDistribution = (index: number) => {
    setDistributions((prev) => prev.filter((_, i) => i !== index));
  };

  const updateTargetValue = (index: number, value: number) => {
    setDistributions((prev) =>
      prev.map((d, i) => (i === index ? { ...d, targetValue: value } : d))
    );
  };

  const distributeEvenly = () => {
    if (distributions.length === 0) return;
    const perPerson = remainingTarget / distributions.length;
    setDistributions((prev) =>
      prev.map((d) => ({
        ...d,
        targetValue: Math.round(perPerson * 100) / 100,
      }))
    );
  };

  const currentSum = distributions.reduce((s, d) => s + d.targetValue, 0);

  const handleSubmit = async () => {
    setError(null);
    if (distributions.length === 0) {
      setError("Add at least one distribution.");
      return;
    }

    if (isSummable) {
      const totalSum = existingChildSum + currentSum;
      if (Math.abs(totalSum - (a.targetValue ?? 0)) > 0.01) {
        setError(
          `Total must equal ${a.targetValue}. Current: ${totalSum} (existing: ${existingChildSum}, new: ${currentSum}).`
        );
        return;
      }
    }

    setSubmitting(true);

    const res = await fetch("/api/tenant/kra-kpi/my/cascade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parentAllocationId: a.id,
        distributions: distributions.map((d) => ({
          assignedToUserId: d.assignedToUserId,
          assignedToUnitId: d.assignedToUnitId,
          targetValue: isSummable ? d.targetValue : (a.targetValue ?? undefined),
        })),
      }),
    });

    const data = await res.json();
    setSubmitting(false);

    if (data.status === "error") {
      setError(data.message);
      return;
    }

    onDone();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onCancel}
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <h2 className="text-lg font-semibold text-gray-900">
          Distribute — {a.kpiTitle}
        </h2>
      </div>

      <div className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600 space-y-1">
        <div>Total Target: {a.targetValue ?? "—"} {a.unitLabel ?? ""}</div>
        {existingChildSum > 0 && (
          <div>Already distributed: {existingChildSum} | Remaining: {remainingTarget}</div>
        )}
        <div>Type: {a.allocationType} | Measurement: {a.measurementType}</div>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <div className="py-8 text-center text-gray-500">Loading members...</div>
      ) : (
        <div className="space-y-4">
          {/* Mode toggle */}
          {childUnits.length > 0 && a.allocationType !== "INDIVIDUAL" && (
            <div className="flex gap-2">
              <button
                onClick={() => setMode("users")}
                className={`px-3 py-1.5 text-xs rounded-md font-medium ${
                  mode === "users" ? "bg-blue-100 text-blue-800" : "bg-gray-100 text-gray-600"
                }`}
              >
                To Individuals
              </button>
              <button
                onClick={() => setMode("units")}
                className={`px-3 py-1.5 text-xs rounded-md font-medium ${
                  mode === "units" ? "bg-blue-100 text-blue-800" : "bg-gray-100 text-gray-600"
                }`}
              >
                To Sub-Units
              </button>
            </div>
          )}

          {/* Available targets */}
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-2">
              {mode === "users" ? "Select Members" : "Select Sub-Units"}
            </h3>
            <div className="flex flex-wrap gap-2">
              {mode === "users" &&
                members.map((m) => {
                  const isAdded = distributions.some((d) => d.assignedToUserId === m.userId);
                  return (
                    <button
                      key={m.userId}
                      onClick={() => addDistribution(m.userId, undefined, m.userName)}
                      disabled={isAdded}
                      className={`px-3 py-1.5 text-xs rounded-md border ${
                        isAdded
                          ? "border-green-300 bg-green-50 text-green-700"
                          : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      {m.userName} {isAdded ? "✓" : "+"}
                    </button>
                  );
                })}
              {mode === "units" &&
                childUnits.map((u) => {
                  const isAdded = distributions.some((d) => d.assignedToUnitId === u.unitId);
                  return (
                    <button
                      key={u.unitId}
                      onClick={() => addDistribution(undefined, u.unitId, u.unitName)}
                      disabled={isAdded}
                      className={`px-3 py-1.5 text-xs rounded-md border ${
                        isAdded
                          ? "border-green-300 bg-green-50 text-green-700"
                          : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      {u.unitName} {isAdded ? "✓" : "+"}
                    </button>
                  );
                })}
            </div>
          </div>

          {/* Distribution table */}
          {distributions.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-gray-700">Distribution</h3>
                {isSummable && (
                  <button
                    onClick={distributeEvenly}
                    className="text-xs text-blue-600 hover:text-blue-800"
                  >
                    Distribute Evenly
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {distributions.map((d, i) => (
                  <div key={i} className="flex items-center gap-3 bg-gray-50 rounded-md px-3 py-2">
                    <span className="text-sm font-medium text-gray-700 flex-1">{d.name}</span>
                    {isSummable ? (
                      <input
                        type="number"
                        className="w-28 rounded-md border border-gray-300 px-2 py-1 text-sm"
                        value={d.targetValue}
                        onChange={(e) => updateTargetValue(i, Number(e.target.value))}
                        placeholder="Target"
                      />
                    ) : (
                      <span className="text-sm text-gray-500">
                        Target: {a.targetValue ?? "replicated"}
                      </span>
                    )}
                    <button
                      onClick={() => removeDistribution(i)}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>

              {isSummable && (
                <div className="mt-2 text-sm text-gray-600">
                  Sum: {currentSum} / {remainingTarget}
                  {Math.abs(currentSum - remainingTarget) > 0.01 && (
                    <span className="ml-2 text-red-600">
                      (must equal {remainingTarget})
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3 border-t border-gray-200 pt-4">
        <button
          onClick={handleSubmit}
          disabled={submitting || distributions.length === 0}
          className="inline-flex items-center rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
        >
          {submitting ? "Distributing..." : `Distribute to ${distributions.length}`}
        </button>
        <button onClick={onCancel} className="text-sm text-gray-500 hover:text-gray-700">
          Cancel
        </button>
      </div>
    </div>
  );
}
