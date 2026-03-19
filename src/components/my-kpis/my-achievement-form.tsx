"use client";

import { useState, useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import type { MyAllocationView, AchievementFieldConfig } from "@/lib/kra-kpi/shared";
import { ACHIEVEMENT_TEMPLATES } from "@/lib/kra-kpi/shared";
import { DynamicFormRenderer } from "./dynamic-form-renderer";

type Props = {
  allocation: MyAllocationView;
  onDone: () => void;
  onCancel: () => void;
};

export function MyAchievementForm({ allocation, onDone, onCancel }: Props) {
  const a = allocation;
  const ach = a.achievement;
  const isEdit = ach != null && (ach.state === "DRAFT" || ach.state === "REJECTED");

  // Standard actual value
  const [actualValue, setActualValue] = useState<number | undefined>(ach?.actualValue ?? undefined);
  const [evidenceDescription, setEvidenceDescription] = useState(ach?.evidenceDescription ?? "");
  const [evidenceLinks, setEvidenceLinks] = useState<string[]>(ach?.evidenceLinks ?? [""]);

  // Dynamic form data
  const formConfig = a.achievementFormConfig;
  const fields: AchievementFieldConfig[] = formConfig?.fields ?? [];
  const [formData, setFormData] = useState<Record<string, unknown>>(
    (ach?.achievementFormData as Record<string, unknown>) ?? {}
  );
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Use generic template if no form config
  const showGenericFields = fields.length === 0;

  useEffect(() => {
    if (!formConfig && a.achievementTemplateKey) {
      const tmpl = ACHIEVEMENT_TEMPLATES[a.achievementTemplateKey];
      if (tmpl) {
        // Already handled by achievementFormConfig on the KPI
      }
    }
  }, [formConfig, a.achievementTemplateKey]);

  const handleFormFieldChange = (key: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    if (formErrors[key]) {
      setFormErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const handleSave = async (submitAfter: boolean) => {
    setError(null);

    // Validate required fields
    const errors: Record<string, string> = {};
    for (const f of fields) {
      if (f.required) {
        const val = formData[f.key];
        if (val == null || val === "" || (Array.isArray(val) && val.length === 0)) {
          errors[f.key] = `${f.label} is required`;
        }
      }
    }
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    const setter = submitAfter ? setSubmitting : setSaving;
    setter(true);

    const filteredLinks = evidenceLinks.filter((l) => l.trim());
    const body = {
      periodId: a.periodId,
      kpiDefinitionId: a.kpiDefinitionId,
      targetAllocationId: a.id,
      ...(actualValue !== undefined && { actualValue }),
      evidenceDescription: evidenceDescription || undefined,
      evidenceLinks: filteredLinks,
      achievementFormData: Object.keys(formData).length > 0 ? formData : undefined,
    };

    try {
      let res: Response;
      if (isEdit && ach) {
        res = await fetch(`/api/tenant/kra-kpi/achievements/${ach.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(actualValue !== undefined && { actualValue }),
            evidenceDescription: evidenceDescription || undefined,
            evidenceLinks: filteredLinks,
            achievementFormData: Object.keys(formData).length > 0 ? formData : undefined,
          }),
        });
      } else {
        res = await fetch("/api/tenant/kra-kpi/achievements", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }

      const data = await res.json();
      if (data.status === "error") {
        setError(data.message);
        setter(false);
        return;
      }

      // If submit requested, submit the achievement
      if (submitAfter) {
        const achievementId = isEdit ? ach!.id : data.id ?? ach?.id;
        if (achievementId) {
          const submitRes = await fetch(`/api/tenant/kra-kpi/achievements/${achievementId}/submit`, {
            method: "POST",
          });
          const submitData = await submitRes.json();
          if (submitData.status === "error") {
            setError(submitData.message);
            setter(false);
            return;
          }
        }
      }

      setter(false);
      onDone();
    } catch {
      setError("Failed to save. Please try again.");
      setter(false);
    }
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
          {isEdit ? "Edit" : "Record"} Achievement — {a.kpiTitle}
        </h2>
      </div>

      {/* Context info */}
      <div className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600 space-y-1">
        <div>KRA: {a.kraTitle} | Category: {a.categoryLabel ?? "—"}</div>
        <div>
          Target: {a.targetValue ?? "—"} {a.unitLabel ?? ""} | Type: {a.measurementType}
        </div>
        {a.parentTargetValue != null && a.targetValue != null && (
          <div>
            Department target: {a.parentTargetValue} | Your share: {a.targetValue} (
            {Math.round((a.targetValue / a.parentTargetValue) * 100)}%)
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      <div className="space-y-4">
        {/* Standard actual value */}
        {(a.measurementType === "NUMERIC" || a.measurementType === "PERCENTAGE" || a.measurementType === "CURRENCY") && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Actual Value {a.unitLabel ? `(${a.unitLabel})` : ""}
              <span className="text-red-500 ml-0.5">*</span>
            </label>
            <input
              type="number"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={actualValue ?? ""}
              onChange={(e) => setActualValue(e.target.value ? Number(e.target.value) : undefined)}
              placeholder={`e.g., ${a.targetValue ?? ""}`}
            />
          </div>
        )}

        {/* Dynamic template fields */}
        {fields.length > 0 && (
          <div className="border-t border-gray-200 pt-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">
              {a.achievementTemplateKey
                ? ACHIEVEMENT_TEMPLATES[a.achievementTemplateKey]?.label ?? "Details"
                : "Details"}
            </h3>
            <DynamicFormRenderer
              fields={fields}
              values={formData}
              onChange={handleFormFieldChange}
              errors={formErrors}
            />
          </div>
        )}

        {/* Generic fields if no template */}
        {showGenericFields && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Evidence Description
            </label>
            <textarea
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              rows={3}
              value={evidenceDescription}
              onChange={(e) => setEvidenceDescription(e.target.value)}
              placeholder="Describe your achievement and evidence..."
            />
          </div>
        )}

        {/* Evidence links */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Evidence Links
          </label>
          {evidenceLinks.map((link, i) => (
            <div key={i} className="flex gap-2 mb-2">
              <input
                type="url"
                className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
                value={link}
                onChange={(e) => {
                  const next = [...evidenceLinks];
                  next[i] = e.target.value;
                  setEvidenceLinks(next);
                }}
                placeholder="https://..."
              />
              {evidenceLinks.length > 1 && (
                <button
                  type="button"
                  onClick={() => setEvidenceLinks(evidenceLinks.filter((_, j) => j !== i))}
                  className="text-xs text-red-500 hover:text-red-700"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          {evidenceLinks.length < 10 && (
            <button
              type="button"
              onClick={() => setEvidenceLinks([...evidenceLinks, ""])}
              className="text-xs text-blue-600 hover:text-blue-800"
            >
              + Add link
            </button>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 border-t border-gray-200 pt-4">
        <button
          onClick={() => handleSave(false)}
          disabled={saving || submitting}
          className="inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save as Draft"}
        </button>
        <button
          onClick={() => handleSave(true)}
          disabled={saving || submitting}
          className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? "Submitting..." : "Save & Submit"}
        </button>
        <button
          onClick={onCancel}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
