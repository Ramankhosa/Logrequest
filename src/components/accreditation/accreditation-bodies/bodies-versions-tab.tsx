"use client";

import { useState } from "react";
import { Plus, Building2, GitBranch } from "lucide-react";
import { SlideOver, EmptyState } from "@/components/dashboard/shared";
import { label, LIFECYCLE_LABELS, LIFECYCLE_CLASSES, SCOPE_LABELS, inputClassName, labelClassName } from "./constants";
import type { AccreditationManagerHook } from "./use-accreditation-manager";

type Props = Pick<
  AccreditationManagerHook,
  | "scope" | "submitting"
  | "bodies" | "selectedBodyId" | "setSelectedBodyId" | "selectedBody"
  | "versions" | "selectedVersionId" | "setSelectedVersionId" | "selectedVersion"
  | "canEditSelectedBody" | "canEditRuntimeCriteria"
  | "createBody" | "toggleBodyActive"
  | "createVersion" | "toggleVersionActive" | "forkVersion"
>;

export function BodiesVersionsTab(props: Props) {
  const {
    scope, submitting,
    bodies, selectedBodyId, setSelectedBodyId, selectedBody,
    versions, selectedVersionId, setSelectedVersionId, selectedVersion,
    canEditSelectedBody, canEditRuntimeCriteria,
    createBody, toggleBodyActive,
    createVersion, toggleVersionActive, forkVersion,
  } = props;

  const [showCreateBody, setShowCreateBody] = useState(false);
  const [showCreateVersion, setShowCreateVersion] = useState(false);

  return (
    <>
      {scope === "tenant" && selectedBody?.scope === "GLOBAL" ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Global frameworks are visible for reference and KPI mapping. Create a tenant body to maintain your own framework.
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        {/* Bodies */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Accreditation Bodies</h3>
              <p className="text-xs text-slate-500">
                {scope === "tenant" ? "Global frameworks plus your tenant-owned frameworks." : "Platform-level accreditation bodies."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowCreateBody(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-800"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Body
            </button>
          </div>

          {bodies.length === 0 ? (
            <EmptyState
              icon={<Building2 className="h-7 w-7" />}
              title="No accreditation bodies yet"
              description="Create an accreditation body to start defining frameworks, versions, and criteria."
              actionLabel="Add First Body"
              onAction={() => setShowCreateBody(true)}
            />
          ) : (
            <div className="space-y-2">
              {bodies.map((body) => (
                <button
                  key={body.id}
                  type="button"
                  onClick={() => setSelectedBodyId(body.id)}
                  className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                    selectedBodyId === body.id
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">{body.name}</p>
                      <p className="mt-1 text-xs opacity-75">
                        {body.code} &middot; {label(SCOPE_LABELS, body.scope)} &middot; {body.versionCount} version{body.versionCount !== 1 ? "s" : ""}
                        {body.country ? ` &middot; ${body.country}` : ""}
                      </p>
                    </div>
                    {canEditSelectedBody && body.id === selectedBodyId ? (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); void toggleBodyActive(body.id, body.isActive); }}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); void toggleBodyActive(body.id, body.isActive); } }}
                        className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium ${
                          selectedBodyId === body.id ? "border-white/30 text-white" : "border-slate-300 text-slate-600"
                        }`}
                      >
                        {body.isActive ? "Archive" : "Restore"}
                      </span>
                    ) : null}
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Versions */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Versions</h3>
              <p className="text-xs text-slate-500">
                {selectedBody ? `Framework versions for ${selectedBody.name}` : "Select a body to see versions."}
              </p>
            </div>
            {selectedBody && canEditRuntimeCriteria ? (
              <button
                type="button"
                onClick={() => setShowCreateVersion(true)}
                className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-800"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Version
              </button>
            ) : null}
          </div>

          {!selectedBody ? (
            <div className="rounded-[1.75rem] border border-dashed border-slate-200 bg-white/55 px-6 py-12 text-center">
              <p className="text-sm text-slate-500">Select an accreditation body to manage its versions.</p>
            </div>
          ) : versions.length === 0 ? (
            <EmptyState
              icon={<GitBranch className="h-7 w-7" />}
              title="No versions yet"
              description={`No framework versions defined for ${selectedBody.name}. Versions represent different editions of a framework (e.g. NAAC 2024).`}
            />
          ) : (
            <div className="space-y-2">
              {versions.map((version) => (
                <button
                  key={version.id}
                  type="button"
                  onClick={() => setSelectedVersionId(version.id)}
                  className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                    selectedVersionId === version.id
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">{version.versionName || version.versionCode}</p>
                      <p className="mt-1 text-xs opacity-75">
                        {version.versionCode} &middot; Base {version.scoreBase}
                        {typeof version.blockCount === "number" ? ` &middot; ${version.blockCount} blocks` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${
                        selectedVersionId === version.id
                          ? "border-white/20 bg-white/10 text-white"
                          : LIFECYCLE_CLASSES[version.lifecycleStatus] ?? "border-slate-200 bg-slate-50 text-slate-600"
                      }`}>
                        {label(LIFECYCLE_LABELS, version.lifecycleStatus)}
                      </span>
                      {canEditSelectedBody && selectedVersionId === version.id ? (
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); void toggleVersionActive(version.id, version.isActive); }}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); void toggleVersionActive(version.id, version.isActive); } }}
                          className={`rounded-full border px-3 py-1 text-xs font-medium ${
                            selectedVersionId === version.id ? "border-white/30 text-white" : "border-slate-300 text-slate-600"
                          }`}
                        >
                          {version.isActive ? "Archive" : "Restore"}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </button>
              ))}

              {/* Fork button for tenant on global published versions */}
              {scope === "tenant" && selectedBody.scope === "GLOBAL" && selectedVersion?.lifecycleStatus === "PUBLISHED" ? (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => { if (selectedVersion) void forkVersion(selectedVersion.id); }}
                  className="mt-2 w-full rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                >
                  Fork into Tenant Draft
                </button>
              ) : null}
            </div>
          )}
        </section>
      </div>

      {/* Create Body SlideOver */}
      <SlideOver open={showCreateBody} onClose={() => setShowCreateBody(false)} title="Add Accreditation Body" subtitle="Define a new accreditation or quality-assurance body.">
        <form className="space-y-5" onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          void createBody({
            code: String(fd.get("code") ?? ""),
            name: String(fd.get("name") ?? ""),
            country: String(fd.get("country") ?? "") || null,
            description: String(fd.get("description") ?? "") || null,
          }).then(() => setShowCreateBody(false));
        }}>
          <div><label className={labelClassName} htmlFor="cb-code">Code</label><input id="cb-code" name="code" className={inputClassName} placeholder="e.g. NAAC" required /></div>
          <div><label className={labelClassName} htmlFor="cb-name">Name</label><input id="cb-name" name="name" className={inputClassName} placeholder="e.g. National Assessment and Accreditation Council" required /></div>
          <div><label className={labelClassName} htmlFor="cb-country">Country (optional)</label><input id="cb-country" name="country" className={inputClassName} placeholder="e.g. India" /></div>
          <div><label className={labelClassName} htmlFor="cb-desc">Description (optional)</label><textarea id="cb-desc" name="description" className={`${inputClassName} min-h-[5rem]`} placeholder="Brief description of this body" /></div>
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={submitting} className="flex-1 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:bg-slate-300">{submitting ? "Creating..." : "Create Body"}</button>
            <button type="button" onClick={() => setShowCreateBody(false)} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50">Cancel</button>
          </div>
        </form>
      </SlideOver>

      {/* Create Version SlideOver */}
      <SlideOver open={showCreateVersion} onClose={() => setShowCreateVersion(false)} title="Add Version" subtitle={selectedBody ? `New version for ${selectedBody.name}` : "New framework version"}>
        <form className="space-y-5" onSubmit={(e) => {
          e.preventDefault();
          if (!selectedBody) return;
          const fd = new FormData(e.currentTarget);
          void createVersion(selectedBody.id, {
            versionCode: String(fd.get("versionCode") ?? ""),
            versionName: String(fd.get("versionName") ?? ""),
            scoreBase: Number(String(fd.get("scoreBase") ?? "100")) || 100,
            lifecycleStatus: fd.get("createAsDraft") === "on" ? "DRAFT" : "PUBLISHED",
          }).then(() => setShowCreateVersion(false));
        }}>
          <div><label className={labelClassName} htmlFor="cv-code">Version Code</label><input id="cv-code" name="versionCode" className={inputClassName} placeholder="e.g. 2024-v1" required /></div>
          <div><label className={labelClassName} htmlFor="cv-name">Version Name</label><input id="cv-name" name="versionName" className={inputClassName} placeholder="e.g. NAAC Revised Framework 2024" required /></div>
          <div><label className={labelClassName} htmlFor="cv-base">Score Base</label><input id="cv-base" name="scoreBase" type="number" className={inputClassName} defaultValue={100} /></div>
          <label className="flex items-center gap-2 text-sm text-slate-600"><input name="createAsDraft" type="checkbox" className="h-4 w-4 rounded" />Create as admin-only draft</label>
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={submitting} className="flex-1 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:bg-slate-300">{submitting ? "Creating..." : "Create Version"}</button>
            <button type="button" onClick={() => setShowCreateVersion(false)} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50">Cancel</button>
          </div>
        </form>
      </SlideOver>
    </>
  );
}
