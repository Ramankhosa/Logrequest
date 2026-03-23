"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Users } from "lucide-react";
import {
  EXTERNAL_CONTRIBUTOR_CREDIT_SUM_MODE_OPTIONS,
  type ExternalContributorCreditSumMode,
} from "@/lib/kra-kpi/external-contrib-shared";
import type { AchievementFieldConfig } from "@/lib/kra-kpi/shared";

type TemplateRow = {
  id: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
};

type EffectiveContributorConfig = {
  id: string | null;
  kpiDefinitionId: string;
  externalContribTemplateId: string | null;
  externalContribTemplateName: string | null;
  allowExternalContributors: boolean;
  duplicateCheckFields: string[];
  creditSumMode: ExternalContributorCreditSumMode;
  inheritedTemplate: boolean;
};

type RawContributorConfig = {
  id: string;
  externalContribTemplateId: string | null;
  allowExternalContributors: boolean;
  duplicateCheckFields: string[];
  creditSumMode: ExternalContributorCreditSumMode;
} | null;

type ContributorConfigResponse = {
  config: RawContributorConfig;
  effectiveConfig: EffectiveContributorConfig;
};

export function KpiContributorConfig({
  kpiDefinitionId,
  achievementFields,
}: {
  kpiDefinitionId: string;
  achievementFields: AchievementFieldConfig[];
}) {
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [allowExternalContributors, setAllowExternalContributors] = useState(true);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [effectiveTemplateName, setEffectiveTemplateName] = useState<string | null>(null);
  const [inheritedTemplate, setInheritedTemplate] = useState(true);
  const [duplicateCheckFields, setDuplicateCheckFields] = useState<string[]>([]);
  const [creditSumMode, setCreditSumMode] =
    useState<ExternalContributorCreditSumMode>("MUST_EQUAL_100");

  const fieldOptions = useMemo(
    () =>
      [...achievementFields]
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .map((field) => ({ key: field.key, label: field.label })),
    [achievementFields],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [templateResponse, configResponse] = await Promise.all([
        fetch("/api/tenant/kra-kpi/external-contrib-templates"),
        fetch(`/api/tenant/kra-kpi/kpis/${kpiDefinitionId}/contributor-config?includeRaw=true`),
      ]);

      const templateData = (await templateResponse.json()) as TemplateRow[];
      const configData = (await configResponse.json()) as ContributorConfigResponse;

      if (!Array.isArray(templateData) || !configData?.effectiveConfig) {
        setError("Failed to load contributor configuration.");
        return;
      }

      setTemplates(templateData.filter((template) => template.isActive));
      setAllowExternalContributors(configData.effectiveConfig.allowExternalContributors);
      setDuplicateCheckFields(configData.effectiveConfig.duplicateCheckFields);
      setCreditSumMode(configData.effectiveConfig.creditSumMode);
      setEffectiveTemplateName(configData.effectiveConfig.externalContribTemplateName);
      setInheritedTemplate(configData.effectiveConfig.inheritedTemplate);
      setSelectedTemplateId(configData.config?.externalContribTemplateId ?? "");
    } catch {
      setError("Failed to load contributor configuration.");
    } finally {
      setLoading(false);
    }
  }, [kpiDefinitionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleDuplicateField = (fieldKey: string, checked: boolean) => {
    setDuplicateCheckFields((current) => {
      if (checked) {
        return current.includes(fieldKey) ? current : [...current, fieldKey];
      }
      return current.filter((value) => value !== fieldKey);
    });
  };

  const removeUnavailableField = (fieldKey: string) => {
    setDuplicateCheckFields((current) => current.filter((value) => value !== fieldKey));
  };

  const unavailableFields = duplicateCheckFields.filter(
    (fieldKey) => !fieldOptions.some((field) => field.key === fieldKey),
  );

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setFeedback(null);

    try {
      const response = await fetch(`/api/tenant/kra-kpi/kpis/${kpiDefinitionId}/contributor-config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allowExternalContributors,
          externalContribTemplateId: selectedTemplateId || null,
          duplicateCheckFields,
          creditSumMode,
        }),
      });
      const data = await response.json();
      if (data.status === "error") {
        setError(data.message);
        setSaving(false);
        return;
      }

      setFeedback(data.message ?? "Contributor config saved.");
      setTimeout(() => setFeedback(null), 3500);
      await load();
    } catch {
      setError("Save failed.");
      setSaving(false);
      return;
    }

    setSaving(false);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading external contributor settings...
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Users className="h-4 w-4 text-slate-500" />
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          External Contributors
        </p>
      </div>
      <p className="mb-4 text-xs text-slate-500">
        Configure whether this KPI accepts contributors outside the tenant and which profile template to use.
      </p>

      <div className="space-y-4">
        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={allowExternalContributors}
            onChange={(event) => setAllowExternalContributors(event.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand/30"
          />
          Allow external contributors on this KPI
        </label>

        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Template
          </label>
          <select
            value={selectedTemplateId}
            onChange={(event) => setSelectedTemplateId(event.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand/30"
          >
            <option value="">
              Use tenant default{effectiveTemplateName ? ` (${effectiveTemplateName})` : ""}
            </option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
                {template.isDefault ? " (default)" : ""}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            {selectedTemplateId
              ? "This KPI will use an explicit external contributor template."
              : inheritedTemplate
                ? `No explicit template selected. Current default: ${effectiveTemplateName ?? "none"}.`
                : "This KPI is linked to a specific template."}
          </p>
        </div>

        <div>
          <label className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Credit sum rule
          </label>
          <div className="grid gap-2">
            {EXTERNAL_CONTRIBUTOR_CREDIT_SUM_MODE_OPTIONS.map((option) => (
              <label
                key={option.value}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2"
              >
                <input
                  type="radio"
                  name={`external-credit-mode-${kpiDefinitionId}`}
                  checked={creditSumMode === option.value}
                  onChange={() => setCreditSumMode(option.value)}
                  className="mt-0.5 h-3.5 w-3.5 border-slate-300 text-brand focus:ring-brand/30"
                />
                <span>
                  <span className="block text-sm font-medium text-slate-800">{option.label}</span>
                  <span className="block text-xs text-slate-500">{option.description}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Duplicate check fields
          </label>
          {fieldOptions.length === 0 ? (
            <p className="text-xs text-slate-400">
              This KPI does not have achievement form fields yet. Duplicate checks can be added after the form is configured.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {fieldOptions.map((field) => (
                <label
                  key={field.key}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                >
                  <input
                    type="checkbox"
                    checked={duplicateCheckFields.includes(field.key)}
                    onChange={(event) => toggleDuplicateField(field.key, event.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-brand focus:ring-brand/30"
                  />
                  <span>{field.label}</span>
                  <span className="font-mono text-[10px] text-slate-400">{field.key}</span>
                </label>
              ))}
            </div>
          )}

          {unavailableFields.length > 0 && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-xs font-medium text-amber-800">
                Saved duplicate-check keys that are not on the current KPI form:
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {unavailableFields.map((fieldKey) => (
                  <button
                    key={fieldKey}
                    type="button"
                    onClick={() => removeUnavailableField(fieldKey)}
                    className="rounded-full border border-amber-300 bg-white px-2.5 py-1 font-mono text-[10px] text-amber-800 transition hover:border-amber-400"
                  >
                    Remove {fieldKey}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-3 flex items-center gap-1.5 text-xs text-rose-600">
          <AlertCircle className="h-3 w-3 shrink-0" />
          {error}
        </div>
      )}
      {feedback && (
        <div className="mt-3 flex items-center gap-1.5 text-xs text-emerald-700">
          <CheckCircle2 className="h-3 w-3 shrink-0" />
          {feedback}
        </div>
      )}

      <button
        type="button"
        disabled={saving}
        onClick={() => void handleSave()}
        className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
      >
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        Save external contributor config
      </button>
    </div>
  );
}
