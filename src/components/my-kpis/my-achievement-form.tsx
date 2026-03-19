"use client";

import { useState } from "react";
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
  const genericFields = ACHIEVEMENT_TEMPLATES.GENERIC.fields;
  const fields: AchievementFieldConfig[] = a.achievementFormConfig?.fields ?? genericFields;
  const templateLabel =
    a.achievementTemplateKey && ACHIEVEMENT_TEMPLATES[a.achievementTemplateKey]
      ? ACHIEVEMENT_TEMPLATES[a.achievementTemplateKey].label
      : "Achievement Details";

  const initialFormData =
    (ach?.achievementFormData as Record<string, unknown> | null) ??
    (!a.achievementFormConfig
      ? {
          description: ach?.evidenceDescription ?? "",
          proofLink: ach?.evidenceLinks[0] ?? "",
        }
      : {});

  const [actualValue, setActualValue] = useState<number | undefined>(ach?.actualValue ?? undefined);
  const [actualDate, setActualDate] = useState(
    formatDateInput(ach?.actualDate),
  );
  const [actualMilestone, setActualMilestone] = useState(ach?.actualMilestone ?? "");
  const [actualGrade, setActualGrade] = useState(ach?.actualGrade ?? "");
  const [actualBoolean, setActualBoolean] = useState<boolean | null>(
    ach?.actualBoolean ?? null,
  );
  const [actualRating, setActualRating] = useState<number | undefined>(ach?.actualRating ?? undefined);
  const [evidenceDescription, setEvidenceDescription] = useState(ach?.evidenceDescription ?? "");
  const [evidenceLinks, setEvidenceLinks] = useState<string[]>(ach?.evidenceLinks ?? [""]);
  const [formData, setFormData] = useState<Record<string, unknown>>(
    initialFormData,
  );
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const validateActualInput = () => {
    switch (a.measurementType) {
      case "NUMERIC":
      case "PERCENTAGE":
      case "CURRENCY":
        return actualValue != null ? null : "Enter the actual value.";
      case "BOOLEAN":
        return actualBoolean != null ? null : "Select whether the target was achieved.";
      case "RATING":
        return actualRating != null ? null : "Enter the actual rating.";
      case "MILESTONE":
        return actualMilestone ? null : "Select the milestone status.";
      case "DATE_TARGET":
        return actualDate ? null : "Select the actual completion date.";
      case "GRADE":
        return actualGrade ? null : "Select the actual grade.";
      default:
        return null;
    }
  };

  const handleSave = async (submitAfter: boolean) => {
    setError(null);
    const nextErrors: Record<string, string> = {};

    const actualInputError = validateActualInput();
    if (actualInputError) {
      nextErrors.__actual = actualInputError;
    }

    const errors: Record<string, string> = {};
    for (const f of fields) {
      if (f.required) {
        const val = formData[f.key];
        if (val == null || val === "" || (Array.isArray(val) && val.length === 0)) {
          errors[f.key] = `${f.label} is required`;
        }
      }
    }
    if (Object.keys(errors).length > 0 || Object.keys(nextErrors).length > 0) {
      setFormErrors(errors);
      setError(nextErrors.__actual ?? null);
      return;
    }

    const setter = submitAfter ? setSubmitting : setSaving;
    setter(true);

    const filteredLinks = evidenceLinks.filter((l) => l.trim());
    const genericProofLink =
      typeof formData.proofLink === "string" && formData.proofLink.trim()
        ? formData.proofLink.trim()
        : null;
    const mergedLinks = genericProofLink && !filteredLinks.includes(genericProofLink)
      ? [genericProofLink, ...filteredLinks]
      : filteredLinks;
    const derivedDescription =
      typeof formData.description === "string" && formData.description.trim()
        ? formData.description.trim()
        : evidenceDescription || undefined;
    const body = {
      periodId: a.periodId,
      kpiDefinitionId: a.kpiDefinitionId,
      targetAllocationId: a.id,
      ...(actualValue !== undefined && { actualValue }),
      ...(actualDate && { actualDate }),
      ...(actualMilestone && { actualMilestone }),
      ...(actualGrade && { actualGrade }),
      ...(actualBoolean !== null && { actualBoolean }),
      ...(actualRating !== undefined && { actualRating }),
      evidenceDescription: derivedDescription,
      evidenceLinks: mergedLinks,
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
            ...(actualDate && { actualDate }),
            ...(actualMilestone && { actualMilestone }),
            ...(actualGrade && { actualGrade }),
            ...(actualBoolean !== null && { actualBoolean }),
            ...(actualRating !== undefined && { actualRating }),
            evidenceDescription: derivedDescription,
            evidenceLinks: mergedLinks,
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
        if (!achievementId) {
          setError("Achievement was saved but the submit step could not be completed.");
          setter(false);
          return;
        }
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
        {(a.measurementType === "NUMERIC" ||
          a.measurementType === "PERCENTAGE" ||
          a.measurementType === "CURRENCY") && (
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

        {a.measurementType === "BOOLEAN" && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Actual Outcome <span className="text-red-500 ml-0.5">*</span>
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setActualBoolean(true)}
                className={`rounded-md px-3 py-2 text-sm font-medium ${
                  actualBoolean === true
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-700"
                }`}
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => setActualBoolean(false)}
                className={`rounded-md px-3 py-2 text-sm font-medium ${
                  actualBoolean === false
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-700"
                }`}
              >
                No
              </button>
            </div>
          </div>
        )}

        {a.measurementType === "RATING" && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Actual Rating <span className="text-red-500 ml-0.5">*</span>
            </label>
            <input
              type="number"
              min={1}
              max={10}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={actualRating ?? ""}
              onChange={(e) =>
                setActualRating(e.target.value ? Number(e.target.value) : undefined)
              }
              placeholder="e.g., 4"
            />
          </div>
        )}

        {a.measurementType === "MILESTONE" && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Milestone Status <span className="text-red-500 ml-0.5">*</span>
            </label>
            <select
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={actualMilestone}
              onChange={(e) => setActualMilestone(e.target.value)}
            >
              <option value="">Select status...</option>
              <option value="NOT_STARTED">Not Started</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="COMPLETED">Completed</option>
            </select>
          </div>
        )}

        {a.measurementType === "DATE_TARGET" && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Actual Date <span className="text-red-500 ml-0.5">*</span>
            </label>
            <input
              type="date"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={actualDate}
              onChange={(e) => setActualDate(e.target.value)}
            />
          </div>
        )}

        {a.measurementType === "GRADE" && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Actual Grade <span className="text-red-500 ml-0.5">*</span>
            </label>
            <select
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={actualGrade}
              onChange={(e) => setActualGrade(e.target.value)}
            >
              <option value="">Select grade...</option>
              <option value="OUTSTANDING">Outstanding</option>
              <option value="VERY_GOOD">Very Good</option>
              <option value="GOOD">Good</option>
              <option value="SATISFACTORY">Satisfactory</option>
              <option value="NEEDS_IMPROVEMENT">Needs Improvement</option>
              <option value="POOR">Poor</option>
            </select>
          </div>
        )}

        <div className="border-t border-gray-200 pt-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">{templateLabel}</h3>
          <DynamicFormRenderer
            fields={fields}
            values={formData}
            onChange={handleFormFieldChange}
            errors={formErrors}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Notes
          </label>
          <textarea
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            rows={3}
            value={evidenceDescription}
            onChange={(e) => setEvidenceDescription(e.target.value)}
            placeholder="Optional notes for reviewers..."
          />
        </div>

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

function formatDateInput(value: Date | string | null | undefined) {
  if (!value) return "";

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().slice(0, 10);
}
