"use client";

import { Bot } from "lucide-react";
import { label, COPILOT_MODE_LABELS, EFFECTIVE_SOURCE_LABELS, inputClassName, labelClassName, textAreaClassName } from "./constants";
import type { AccreditationManagerHook } from "./use-accreditation-manager";

type Props = Pick<
  AccreditationManagerHook,
  | "scope" | "submitting"
  | "selectedVersion"
  | "copilotConfig" | "availableLlmProfiles"
  | "tenantCopilotEnabled" | "canEditSelectedVersionCopilot"
  | "saveCopilotSettings"
>;

function tryParseJson(value: string): { ok: true; value: unknown } | { ok: false; error: string } {
  if (!value.trim()) return { ok: true, value: null };
  try { return { ok: true, value: JSON.parse(value) }; }
  catch { return { ok: false, error: "Invalid JSON." }; }
}

export function CopilotTab(props: Props) {
  const {
    scope, submitting,
    selectedVersion,
    copilotConfig, availableLlmProfiles,
    tenantCopilotEnabled, canEditSelectedVersionCopilot,
    saveCopilotSettings,
  } = props;

  if (scope === "tenant" && !tenantCopilotEnabled) {
    return (
      <div className="rounded-[1.75rem] border border-slate-200 bg-slate-50 px-6 py-8 text-center">
        <Bot className="mx-auto mb-3 h-8 w-8 text-slate-300" />
        <h3 className="text-sm font-semibold text-slate-700">Copilot Not Enabled</h3>
        <p className="mt-1 text-sm text-slate-500">
          Accreditation copilot is not enabled for this tenant. Contact a superadmin to enable this feature.
        </p>
      </div>
    );
  }

  if (!selectedVersion) {
    return (
      <div className="rounded-[1.75rem] border border-dashed border-slate-200 bg-white/55 px-6 py-12 text-center">
        <p className="text-sm text-slate-500">Select a framework version from the Frameworks tab to configure copilot settings.</p>
      </div>
    );
  }

  if (!copilotConfig) {
    return (
      <div className="rounded-[1.75rem] border border-dashed border-slate-200 bg-white/55 px-6 py-12 text-center">
        <p className="text-sm text-slate-500">No copilot configuration available for this version.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      {/* Current status */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-slate-900">Current Configuration</h3>

        <div className="grid gap-3 sm:grid-cols-3">
          <StatusCard label="Mode" value={label(COPILOT_MODE_LABELS, copilotConfig.copilotMode)} />
          <StatusCard label="Assistant Pack" value={copilotConfig.assistantPackKey ?? "Auto-resolve"} />
          <StatusCard label="LLM Profile" value={copilotConfig.llmProfile?.displayName ?? "Deterministic only"} />
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
          <span className="text-xs font-medium text-slate-400">Effective source: </span>
          <strong className="text-slate-900">{label(EFFECTIVE_SOURCE_LABELS, copilotConfig.effectiveSource.type)}</strong>
          {" \u00b7 "}{copilotConfig.effectiveSource.bodyCode}
          {copilotConfig.effectiveSource.versionCode ? ` ${copilotConfig.effectiveSource.versionCode}` : ""}
        </div>

        {copilotConfig.lockState.isLocked ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {copilotConfig.lockState.reason ?? "This version inherits locked body-level copilot settings from its global source."}
          </div>
        ) : null}

        {scope === "superadmin" ? (
          <a
            href="/superadmin/llm-config"
            className="inline-block rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Manage LLM Profiles
          </a>
        ) : null}
      </div>

      {/* Edit form */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <h3 className="mb-1 text-sm font-semibold text-slate-900">Version Policy</h3>
        <p className="mb-4 text-xs text-slate-500">Body-level settings define provider/model policy. Block-level rules refine behavior.</p>

        <form className="space-y-4" onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const configText = String(fd.get("llmConfig") ?? "");
          const parsed = tryParseJson(configText);
          if (!parsed.ok) return;

          void saveCopilotSettings(selectedVersion.id, {
            copilotMode: String(fd.get("copilotMode") ?? "DETERMINISTIC_ONLY"),
            assistantPackKey: String(fd.get("assistantPackKey") ?? "") || null,
            llmProfileId: String(fd.get("llmProfileId") ?? "") || null,
            llmConfig: parsed.value,
          });
        }}>
          <div>
            <label className={labelClassName} htmlFor="cc-mode">Copilot Mode</label>
            <select id="cc-mode" name="copilotMode" defaultValue={copilotConfig.copilotMode} disabled={!canEditSelectedVersionCopilot || submitting} className={inputClassName}>
              {Object.entries(COPILOT_MODE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>

          <div>
            <label className={labelClassName} htmlFor="cc-pack">Assistant Pack Key (optional)</label>
            <input id="cc-pack" name="assistantPackKey" defaultValue={copilotConfig.assistantPackKey ?? ""} disabled={!canEditSelectedVersionCopilot || submitting} className={inputClassName} placeholder="Leave blank for auto-resolve" />
          </div>

          <div>
            <label className={labelClassName} htmlFor="cc-profile">LLM Profile</label>
            <select id="cc-profile" name="llmProfileId" defaultValue={copilotConfig.llmProfileId ?? ""} disabled={!canEditSelectedVersionCopilot || submitting} className={inputClassName}>
              <option value="">No profile (deterministic fallback)</option>
              {availableLlmProfiles.map((p) => <option key={p.id} value={p.id}>{p.displayName} &middot; {p.primaryModel.code}</option>)}
            </select>
          </div>

          <div>
            <label className={labelClassName} htmlFor="cc-config">LLM Policy (JSON)</label>
            <textarea id="cc-config" name="llmConfig" defaultValue={JSON.stringify(copilotConfig.llmConfig ?? {}, null, 2)} disabled={!canEditSelectedVersionCopilot || submitting} className={textAreaClassName} />
          </div>

          <button type="submit" disabled={!canEditSelectedVersionCopilot || submitting} className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:bg-slate-300 disabled:text-slate-500">
            {submitting ? "Saving..." : "Save Copilot Settings"}
          </button>
        </form>
      </div>
    </div>
  );
}

function StatusCard({ label: cardLabel, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{cardLabel}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}
