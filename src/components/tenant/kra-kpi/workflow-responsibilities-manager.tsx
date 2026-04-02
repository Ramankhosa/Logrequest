"use client";

import { useMemo, useState } from "react";
import type {
  KpiWorkflowResponsibilityView,
  OpenWorkflowAssignmentView,
  WorkflowReviewerOption,
} from "@/lib/kra-kpi/workflow-service";

type Props = {
  initialResponsibilities: KpiWorkflowResponsibilityView[];
  reviewerOptions: WorkflowReviewerOption[];
  initialAssignments: OpenWorkflowAssignmentView[];
  canManageLiveWorkflow: boolean;
};

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-slate-900";

function reviewerLabel(option: WorkflowReviewerOption) {
  return `${option.name}${option.employeeId ? ` (${option.employeeId})` : ""}`;
}

export function WorkflowResponsibilitiesManager({
  initialResponsibilities,
  reviewerOptions,
  initialAssignments,
  canManageLiveWorkflow,
}: Props) {
  const [responsibilities, setResponsibilities] = useState(initialResponsibilities);
  const [assignments, setAssignments] = useState(initialAssignments);
  const [query, setQuery] = useState("");
  const [savingKpiId, setSavingKpiId] = useState<string | null>(null);
  const [savingAchievementId, setSavingAchievementId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [reassignSelections, setReassignSelections] = useState<Record<string, string>>(
    Object.fromEntries(
      initialAssignments.map((assignment) => [
        assignment.achievementId,
        assignment.currentVerifierUserId ?? "",
      ]),
    ),
  );

  const filteredResponsibilities = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return responsibilities;
    return responsibilities.filter((row) =>
      [
        row.periodName,
        row.kraTitle,
        row.kpiTitle,
        row.startingUnitName,
        row.keyUnitName ?? "",
        row.finalUnitName ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [query, responsibilities]);

  const filteredAssignments = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return assignments;
    return assignments.filter((row) =>
      [
        row.reporterName,
        row.kpiTitle,
        row.kraTitle,
        row.periodName,
        row.currentVerifierUnitName ?? "",
        row.currentVerifierUserName ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [assignments, query]);

  function optionsForUnit(unitId: string | null) {
    if (!unitId) return [];
    return reviewerOptions.filter((option) => option.unitIds.includes(unitId));
  }

  function updateResponsibilityField(
    kpiId: string,
    field: "keyReviewerUserId" | "finalReviewerUserId",
    value: string | null,
  ) {
    setResponsibilities((current) =>
      current.map((row) => (row.kpiId === kpiId ? { ...row, [field]: value } : row)),
    );
  }

  async function saveResponsibility(row: KpiWorkflowResponsibilityView) {
    setSavingKpiId(row.kpiId);
    setFeedback(null);
    try {
      const response = await fetch(`/api/tenant/kra-kpi/kpis/${row.kpiId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyReviewerUserId: row.keyReviewerUserId || null,
          finalReviewerUserId: row.finalReviewerUserId || null,
        }),
      });
      const payload = await response.json();
      if (!response.ok || payload.status === "error") {
        setFeedback({ type: "error", message: payload.message ?? "Failed to update workflow ownership." });
        return;
      }
      setFeedback({ type: "success", message: `Updated workflow defaults for ${row.kpiTitle}.` });
    } catch {
      setFeedback({ type: "error", message: "Failed to update workflow defaults." });
    } finally {
      setSavingKpiId(null);
    }
  }

  async function reassign(assignment: OpenWorkflowAssignmentView) {
    const nextReviewerUserId = reassignSelections[assignment.achievementId]?.trim();
    if (!nextReviewerUserId || nextReviewerUserId === assignment.currentVerifierUserId) {
      setFeedback({ type: "error", message: "Select a different reviewer before reassigning." });
      return;
    }

    setSavingAchievementId(assignment.achievementId);
    setFeedback(null);
    try {
      const response = await fetch(
        `/api/tenant/kra-kpi/achievements/${assignment.achievementId}/reassign-reviewer`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nextReviewerUserId,
            note: "Reassigned from workflow responsibilities console.",
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok || payload.status === "error") {
        setFeedback({ type: "error", message: payload.message ?? "Failed to reassign workflow owner." });
        return;
      }
      const nextReviewer = reviewerOptions.find((option) => option.userId === nextReviewerUserId);
      setAssignments((current) =>
        current.map((row) =>
          row.achievementId === assignment.achievementId
            ? {
                ...row,
                currentVerifierUserId: nextReviewerUserId,
                currentVerifierUserName: nextReviewer?.name ?? row.currentVerifierUserName,
              }
            : row,
        ),
      );
      setFeedback({ type: "success", message: `Reassigned ${assignment.kpiTitle}.` });
    } catch {
      setFeedback({ type: "error", message: "Failed to reassign workflow owner." });
    } finally {
      setSavingAchievementId(null);
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-[1.75rem] border border-slate-200/80 bg-white/85 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Workflow</p>
            <h2 className="text-lg font-semibold text-slate-900">Workflow Responsibilities</h2>
            <p className="text-sm text-slate-500">
              Set KPI-wise named reviewers and reassign live requests without changing unit routing.
            </p>
          </div>
          <div className="w-full max-w-sm">
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Search
            </label>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className={inputCls}
              placeholder="KPI, period, unit, reporter..."
            />
          </div>
        </div>
      </section>

      {feedback ? (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm ${
            feedback.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {feedback.message}
        </div>
      ) : null}

      <section className="overflow-hidden rounded-[1.75rem] border border-slate-200/80 bg-white/85">
        <div className="border-b border-slate-200/80 px-5 py-4">
          <h3 className="text-sm font-semibold text-slate-900">KPI Workflow Defaults</h3>
          <p className="mt-1 text-sm text-slate-500">
            Named reviewers are optional. Leave blank to fall back to the routed unit head.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200/80 text-left">
            <thead className="bg-slate-50/80">
              <tr>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">KPI</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Routing</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Named Reviewers</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Warnings</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/80">
              {filteredResponsibilities.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">
                    No matching KPIs found.
                  </td>
                </tr>
              ) : (
                filteredResponsibilities.map((row) => (
                  <tr key={row.kpiId} className="align-top">
                    <td className="px-4 py-4">
                      <div className="space-y-1">
                        <div className="text-sm font-semibold text-slate-900">{row.kpiTitle}</div>
                        <div className="text-sm text-slate-500">{row.kraTitle}</div>
                        <div className="text-xs text-slate-400">{row.periodName}</div>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-sm text-slate-600">
                      <div>Starting: {row.startingUnitName}</div>
                      <div>Key: {row.keyUnitName ?? "—"}</div>
                      <div>Final: {row.finalUnitName ?? "—"}</div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="grid gap-3 xl:grid-cols-2">
                        <div className="space-y-1">
                          <label className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                            Key Reviewer
                          </label>
                          <select
                            value={row.keyReviewerUserId ?? ""}
                            onChange={(event) =>
                              updateResponsibilityField(row.kpiId, "keyReviewerUserId", event.target.value || null)
                            }
                            className={inputCls}
                            disabled={!row.keyUnitId}
                          >
                            <option value="">Fallback to unit head</option>
                            {optionsForUnit(row.keyUnitId).map((option) => (
                              <option key={option.userId} value={option.userId}>
                                {reviewerLabel(option)}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                            Final Reviewer
                          </label>
                          <select
                            value={row.finalReviewerUserId ?? ""}
                            onChange={(event) =>
                              updateResponsibilityField(row.kpiId, "finalReviewerUserId", event.target.value || null)
                            }
                            className={inputCls}
                            disabled={!row.finalUnitId}
                          >
                            <option value="">Fallback to unit head</option>
                            {optionsForUnit(row.finalUnitId).map((option) => (
                              <option key={option.userId} value={option.userId}>
                                {reviewerLabel(option)}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      {row.workflowWarnings.length > 0 ? (
                        <div className="space-y-2">
                          {row.workflowWarnings.map((warning, index) => (
                            <div
                              key={`${row.kpiId}:${index}`}
                              className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700"
                            >
                              {warning}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-sm text-slate-400">No warnings</span>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <button
                        type="button"
                        onClick={() => void saveResponsibility(row)}
                        disabled={savingKpiId === row.kpiId}
                        className="inline-flex items-center rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {savingKpiId === row.kpiId ? "Saving..." : "Save"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {canManageLiveWorkflow ? (
        <section className="overflow-hidden rounded-[1.75rem] border border-slate-200/80 bg-white/85">
          <div className="border-b border-slate-200/80 px-5 py-4">
            <h3 className="text-sm font-semibold text-slate-900">Open Workflow Assignments</h3>
            <p className="mt-1 text-sm text-slate-500">
              Reassign live requests to another eligible reviewer in the current verifier unit.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200/80 text-left">
              <thead className="bg-slate-50/80">
                <tr>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Request</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Reporter</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">State</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Current Owner</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Reassign</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/80">
                {filteredAssignments.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">
                      No open workflow assignments found.
                    </td>
                  </tr>
                ) : (
                  filteredAssignments.map((assignment) => (
                    <tr key={assignment.achievementId} className="align-top">
                      <td className="px-4 py-4">
                        <div className="space-y-1">
                          <div className="text-sm font-semibold text-slate-900">{assignment.kpiTitle}</div>
                          <div className="text-sm text-slate-500">{assignment.kraTitle}</div>
                          <div className="text-xs text-slate-400">{assignment.periodName}</div>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-600">{assignment.reporterName}</td>
                      <td className="px-4 py-4 text-sm text-slate-600">
                        <div>{assignment.state}</div>
                        <div className="text-xs text-slate-400">{assignment.reviewLevel}</div>
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-600">
                        <div>{assignment.currentVerifierUnitName ?? "—"}</div>
                        <div className="text-xs text-slate-400">
                          {assignment.currentVerifierUserName ?? "Unit head routing"}
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex min-w-[280px] gap-2">
                          <select
                            value={reassignSelections[assignment.achievementId] ?? ""}
                            onChange={(event) =>
                              setReassignSelections((current) => ({
                                ...current,
                                [assignment.achievementId]: event.target.value,
                              }))
                            }
                            className={inputCls}
                            disabled={!assignment.currentVerifierUnitId}
                          >
                            <option value="">Select reviewer...</option>
                            {optionsForUnit(assignment.currentVerifierUnitId).map((option) => (
                              <option key={option.userId} value={option.userId}>
                                {reviewerLabel(option)}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => void reassign(assignment)}
                            disabled={savingAchievementId === assignment.achievementId || !assignment.currentVerifierUnitId}
                            className="inline-flex items-center rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {savingAchievementId === assignment.achievementId ? "Saving..." : "Reassign"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
