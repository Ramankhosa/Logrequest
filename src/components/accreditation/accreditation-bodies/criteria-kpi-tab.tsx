"use client";

import { TreePine, Link2 } from "lucide-react";
import { EmptyState } from "@/components/dashboard/shared";
import { inputClassName, labelClassName, textAreaClassName } from "./constants";
import type { AccreditationManagerHook } from "./use-accreditation-manager";

type Props = Pick<
  AccreditationManagerHook,
  | "submitting"
  | "selectedVersion"
  | "flatCriteria" | "leafCriteria" | "selectedCriterionId" | "setSelectedCriterionId" | "selectedCriterion"
  | "blockKpis"
  | "kpis" | "selectedKpiId" | "setSelectedKpiId" | "links"
  | "canEditSelectedBody" | "canEditRuntimeCriteria"
  | "toggleBlockActive"
  | "createKpiLink" | "deleteKpiLink"
>;

export function CriteriaKpiTab(props: Props) {
  const {
    submitting,
    selectedVersion,
    flatCriteria, leafCriteria, selectedCriterionId, setSelectedCriterionId, selectedCriterion,
    blockKpis,
    kpis, selectedKpiId, setSelectedKpiId, links,
    canEditRuntimeCriteria,
    toggleBlockActive,
    createKpiLink, deleteKpiLink,
  } = props;

  if (!selectedVersion) {
    return (
      <div className="rounded-[1.75rem] border border-dashed border-slate-200 bg-white/55 px-6 py-12 text-center">
        <p className="text-sm text-slate-500">Select a framework version from the Frameworks tab to manage criteria and KPI links.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Criteria tree + KPI reverse lookup */}
      <div className="grid gap-6 xl:grid-cols-[22rem,1fr]">
        {/* Criteria tree */}
        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Criteria Tree</h3>
            <p className="text-xs text-slate-500">Published criteria structure. Select a criterion to see linked KPIs.</p>
          </div>

          {flatCriteria.length === 0 ? (
            <EmptyState
              icon={<TreePine className="h-7 w-7" />}
              title="No criteria yet"
              description="Criteria are generated from published template blocks. Publish a template first."
            />
          ) : (
            <div className="space-y-1.5">
              {flatCriteria.map((criterion) => (
                <button
                  key={criterion.id}
                  type="button"
                  onClick={() => setSelectedCriterionId(criterion.id)}
                  className={`w-full rounded-2xl border px-4 py-2.5 text-left transition ${
                    selectedCriterionId === criterion.id
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                  style={{ paddingLeft: `${criterion.depth * 18 + 16}px` }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">{criterion.blockCode} &middot; {criterion.title}</p>
                      <p className="mt-0.5 text-xs opacity-75">
                        {criterion.isLeaf ? "Leaf metric" : "Group"} &middot; Level {criterion.depth + 1}
                      </p>
                    </div>
                    {canEditRuntimeCriteria && selectedCriterionId === criterion.id ? (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); void toggleBlockActive(criterion.id, criterion.isActive); }}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); void toggleBlockActive(criterion.id, criterion.isActive); } }}
                        className="shrink-0 rounded-full border border-white/30 px-3 py-0.5 text-xs text-white"
                      >
                        {criterion.isActive ? "Archive" : "Restore"}
                      </span>
                    ) : null}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* KPI reverse lookup */}
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
          {!selectedCriterion ? (
            <p className="py-8 text-center text-sm text-slate-500">Select a criterion to see which KPIs are linked to it.</p>
          ) : (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-semibold text-slate-900">KPIs linked to {selectedCriterion.blockCode}</h4>
                <p className="text-xs text-slate-500">{selectedCriterion.title}</p>
              </div>
              {blockKpis.length === 0 ? (
                <p className="py-4 text-center text-sm text-slate-500">No KPIs linked to this criterion yet.</p>
              ) : (
                <div className="space-y-2">
                  {blockKpis.map((kpi) => (
                    <div key={kpi.linkId} className="rounded-xl bg-white px-4 py-3">
                      <p className="text-sm font-semibold text-slate-900">{kpi.title}</p>
                      <p className="text-xs text-slate-500">{kpi.kraTitle} &middot; {kpi.periodName}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* KPI Registry Links */}
      <div className="rounded-[1.75rem] border border-slate-200/80 bg-white/85 p-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">KPI Registry Links</h3>
            <p className="text-xs text-slate-500">Link tenant KPI definitions to measurable accreditation criteria.</p>
          </div>
          <div className="min-w-72">
            <label className={labelClassName}>Selected KPI</label>
            <select
              value={selectedKpiId ?? ""}
              onChange={(e) => setSelectedKpiId(e.target.value || null)}
              className={inputClassName}
            >
              <option value="">Select KPI</option>
              {kpis.map((kpi) => (
                <option key={kpi.id} value={kpi.id}>{kpi.title} &middot; {kpi.kraTitle} &middot; {kpi.periodName}</option>
              ))}
            </select>
          </div>
        </div>

        {selectedKpiId ? (
          <div className="grid gap-6 xl:grid-cols-2">
            {/* Create link */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <h4 className="mb-1 text-sm font-semibold text-slate-900">Create Link</h4>
              <p className="mb-3 text-xs text-slate-500">Only active measurable leaf blocks can be linked.</p>
              <form className="space-y-3" onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                void createKpiLink(selectedKpiId, {
                  blockId: String(fd.get("blockId") ?? ""),
                  notes: String(fd.get("notes") ?? "") || null,
                });
                e.currentTarget.reset();
              }}>
                <div>
                  <label className={labelClassName}>Leaf Criterion</label>
                  <select name="blockId" defaultValue={selectedCriterion?.isLeaf ? selectedCriterion.id : ""} className={inputClassName}>
                    <option value="">Select leaf block</option>
                    {leafCriteria.filter((c) => c.isActive).map((c) => (
                      <option key={c.id} value={c.id}>{c.blockCode} &middot; {c.title}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClassName}>Notes (optional)</label>
                  <textarea name="notes" className={textAreaClassName} placeholder="Why this KPI maps to this criterion" />
                </div>
                <button type="submit" disabled={submitting} className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:bg-slate-300">
                  Create Link
                </button>
              </form>
            </div>

            {/* Existing links */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <h4 className="mb-1 text-sm font-semibold text-slate-900">Existing Links</h4>
              <p className="mb-3 text-xs text-slate-500">Current accreditation links for this KPI.</p>
              {links.length === 0 ? (
                <p className="py-4 text-center text-sm text-slate-500">No links for this KPI yet.</p>
              ) : (
                <div className="space-y-2">
                  {links.map((link) => (
                    <div key={link.id} className="flex items-start justify-between gap-3 rounded-xl bg-white px-4 py-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{link.blockCode} &middot; {link.blockTitle}</p>
                        <p className="text-xs text-slate-500">{link.bodyCode} &middot; {link.versionCode}</p>
                        {link.notes ? <p className="mt-1 text-xs text-slate-600">{link.notes}</p> : null}
                      </div>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => void deleteKpiLink(link.id)}
                        className="shrink-0 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-200 py-8 text-sm text-slate-500">
            <Link2 className="h-4 w-4" />
            Select a KPI above to manage its accreditation links.
          </div>
        )}
      </div>
    </div>
  );
}
