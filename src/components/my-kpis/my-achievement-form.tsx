"use client";

import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import type {
  AchievementFieldConfig,
  AchievementFormConfig,
  AchievementView,
  MyAllocationView,
} from "@/lib/kra-kpi/shared";
import { ACHIEVEMENT_TEMPLATES } from "@/lib/kra-kpi/shared";
import { DynamicFormRenderer } from "./dynamic-form-renderer";

export type AdditionalAchievementFormContext = {
  periodId: string;
  kpiDefinitionId: string;
  kpiTitle: string;
  kraTitle: string;
  categoryLabel: string | null;
  measurementType: MyAllocationView["measurementType"];
  unitLabel: string | null;
  defaultTarget: number | null;
  startingUnitName: string;
  achievementTemplateKey: string | null;
  achievementFormConfig: AchievementFormConfig | null;
  achievement: AchievementView | null;
};

type Props =
  | {
      allocation: MyAllocationView;
      additionalContext?: never;
      onDone: () => void;
      onCancel: () => void;
    }
  | {
      allocation?: never;
      additionalContext: AdditionalAchievementFormContext;
      onDone: () => void;
      onCancel: () => void;
    };

type FormSubject = {
  periodId: string;
  kpiDefinitionId: string;
  targetAllocationId: string | null;
  kpiTitle: string;
  kraTitle: string;
  categoryLabel: string | null;
  measurementType: MyAllocationView["measurementType"];
  unitLabel: string | null;
  targetValue: number | null;
  parentTargetValue: number | null;
  startingUnitName: string;
  achievementTemplateKey: string | null;
  achievementFormConfig: AchievementFormConfig | null;
  achievement: AchievementView | null;
  isAdditional: boolean;
};

function buildSubject(
  allocation: MyAllocationView | undefined,
  additionalContext: AdditionalAchievementFormContext | undefined,
): FormSubject {
  if (allocation) {
    return {
      periodId: allocation.periodId,
      kpiDefinitionId: allocation.kpiDefinitionId,
      targetAllocationId: allocation.id,
      kpiTitle: allocation.kpiTitle,
      kraTitle: allocation.kraTitle,
      categoryLabel: allocation.categoryLabel,
      measurementType: allocation.measurementType,
      unitLabel: allocation.unitLabel,
      targetValue: allocation.targetValue,
      parentTargetValue: allocation.parentTargetValue,
      startingUnitName: allocation.startingUnitName,
      achievementTemplateKey: allocation.achievementTemplateKey,
      achievementFormConfig: allocation.achievementFormConfig,
      achievement: allocation.achievement,
      isAdditional: false,
    };
  }

  if (!additionalContext) {
    throw new Error("MyAchievementForm requires either allocation or additionalContext.");
  }

  return {
    periodId: additionalContext.periodId,
    kpiDefinitionId: additionalContext.kpiDefinitionId,
    targetAllocationId: null,
    kpiTitle: additionalContext.kpiTitle,
    kraTitle: additionalContext.kraTitle,
    categoryLabel: additionalContext.categoryLabel,
    measurementType: additionalContext.measurementType,
    unitLabel: additionalContext.unitLabel,
    targetValue: additionalContext.defaultTarget,
    parentTargetValue: null,
    startingUnitName: additionalContext.startingUnitName,
    achievementTemplateKey: additionalContext.achievementTemplateKey,
    achievementFormConfig: additionalContext.achievementFormConfig,
    achievement: additionalContext.achievement,
    isAdditional: true,
  };
}

export function MyAchievementForm({
  allocation,
  additionalContext,
  onDone,
  onCancel,
}: Props) {
  const subject = buildSubject(allocation, additionalContext);
  const ach = subject.achievement;
  const isEdit = ach != null && (ach.state === "DRAFT" || ach.state === "REJECTED");
  const genericFields = ACHIEVEMENT_TEMPLATES.GENERIC.fields;
  const fields: AchievementFieldConfig[] = subject.achievementFormConfig?.fields ?? genericFields;
  const templateLabel =
    subject.achievementTemplateKey && ACHIEVEMENT_TEMPLATES[subject.achievementTemplateKey]
      ? ACHIEVEMENT_TEMPLATES[subject.achievementTemplateKey].label
      : "Achievement Details";

  const initialFormData =
    (ach?.achievementFormData as Record<string, unknown> | null) ??
    (!subject.achievementFormConfig
      ? {
          description: ach?.evidenceDescription ?? "",
          proofLink: ach?.evidenceLinks[0] ?? "",
        }
      : {});

  const [actualValue, setActualValue] = useState<number | undefined>(ach?.actualValue ?? undefined);
  const [actualDate, setActualDate] = useState(formatDateInput(ach?.actualDate));
  const [actualMilestone, setActualMilestone] = useState(ach?.actualMilestone ?? "");
  const [actualGrade, setActualGrade] = useState(ach?.actualGrade ?? "");
  const [actualBoolean, setActualBoolean] = useState<boolean | null>(ach?.actualBoolean ?? null);
  const [actualRating, setActualRating] = useState<number | undefined>(ach?.actualRating ?? undefined);
  const [evidenceDescription, setEvidenceDescription] = useState(ach?.evidenceDescription ?? "");
  const [evidenceLinks, setEvidenceLinks] = useState<string[]>(ach?.evidenceLinks ?? [""]);
  const [formData, setFormData] = useState<Record<string, unknown>>(initialFormData);
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
    switch (subject.measurementType) {
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
    for (const field of fields) {
      if (!field.required) continue;
      const value = formData[field.key];
      if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) {
        errors[field.key] = `${field.label} is required`;
      }
    }

    if (Object.keys(errors).length > 0 || Object.keys(nextErrors).length > 0) {
      setFormErrors(errors);
      setError(nextErrors.__actual ?? null);
      return;
    }

    const setter = submitAfter ? setSubmitting : setSaving;
    setter(true);

    const filteredLinks = evidenceLinks.filter((link) => link.trim());
    const genericProofLink =
      typeof formData.proofLink === "string" && formData.proofLink.trim()
        ? formData.proofLink.trim()
        : null;
    const mergedLinks =
      genericProofLink && !filteredLinks.includes(genericProofLink)
        ? [genericProofLink, ...filteredLinks]
        : filteredLinks;
    const derivedDescription =
      typeof formData.description === "string" && formData.description.trim()
        ? formData.description.trim()
        : evidenceDescription || undefined;

    const body = {
      periodId: subject.periodId,
      kpiDefinitionId: subject.kpiDefinitionId,
      ...(!subject.isAdditional &&
        subject.targetAllocationId && { targetAllocationId: subject.targetAllocationId }),
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
      let response: Response;
      if (isEdit && ach) {
        response = await fetch(`/api/tenant/kra-kpi/achievements/${ach.id}`, {
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
        response = await fetch(
          subject.isAdditional
            ? "/api/tenant/kra-kpi/my/additional-achievements"
            : "/api/tenant/kra-kpi/achievements",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
        );
      }

      const data = await response.json();
      if (data.status === "error") {
        setError(data.message);
        setter(false);
        return;
      }

      if (submitAfter) {
        const achievementId = isEdit ? ach!.id : data.id ?? ach?.id;
        if (!achievementId) {
          setError("Achievement was saved but the submit step could not be completed.");
          setter(false);
          return;
        }

        const submitResponse = await fetch(
          `/api/tenant/kra-kpi/achievements/${achievementId}/submit`,
          { method: "POST" },
        );
        const submitData = await submitResponse.json();
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
          {isEdit ? "Edit" : "Record"} Achievement — {subject.kpiTitle}
        </h2>
      </div>

      <div className="space-y-1 rounded-lg bg-gray-50 p-4 text-sm text-gray-600">
        <div>KRA: {subject.kraTitle} | Category: {subject.categoryLabel ?? "—"}</div>
        <div>
          {subject.isAdditional ? "Default target" : "Target"}: {subject.targetValue ?? "—"}{" "}
          {subject.unitLabel ?? ""} | Type: {subject.measurementType}
        </div>
        <div>Source unit: {subject.startingUnitName}</div>
        {!subject.isAdditional &&
          subject.parentTargetValue != null &&
          subject.targetValue != null && (
            <div>
              Department target: {subject.parentTargetValue} | Your share: {subject.targetValue} (
              {Math.round((subject.targetValue / subject.parentTargetValue) * 100)}%)
            </div>
          )}
      </div>

      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      <div className="space-y-4">
        {(subject.measurementType === "NUMERIC" ||
          subject.measurementType === "PERCENTAGE" ||
          subject.measurementType === "CURRENCY") && (
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Actual Value {subject.unitLabel ? `(${subject.unitLabel})` : ""}
              <span className="ml-0.5 text-red-500">*</span>
            </label>
            <input
              type="number"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={actualValue ?? ""}
              onChange={(event) =>
                setActualValue(event.target.value ? Number(event.target.value) : undefined)
              }
              placeholder={`e.g., ${subject.targetValue ?? ""}`}
            />
          </div>
        )}

        {subject.measurementType === "BOOLEAN" && (
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Actual Outcome <span className="ml-0.5 text-red-500">*</span>
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

        {subject.measurementType === "RATING" && (
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Actual Rating <span className="ml-0.5 text-red-500">*</span>
            </label>
            <input
              type="number"
              min={1}
              max={10}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={actualRating ?? ""}
              onChange={(event) =>
                setActualRating(event.target.value ? Number(event.target.value) : undefined)
              }
              placeholder="e.g., 4"
            />
          </div>
        )}

        {subject.measurementType === "MILESTONE" && (
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Milestone Status <span className="ml-0.5 text-red-500">*</span>
            </label>
            <select
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={actualMilestone}
              onChange={(event) => setActualMilestone(event.target.value)}
            >
              <option value="">Select status...</option>
              <option value="NOT_STARTED">Not Started</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="COMPLETED">Completed</option>
            </select>
          </div>
        )}

        {subject.measurementType === "DATE_TARGET" && (
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Actual Date <span className="ml-0.5 text-red-500">*</span>
            </label>
            <input
              type="date"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={actualDate}
              onChange={(event) => setActualDate(event.target.value)}
            />
          </div>
        )}

        {subject.measurementType === "GRADE" && (
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Actual Grade <span className="ml-0.5 text-red-500">*</span>
            </label>
            <select
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={actualGrade}
              onChange={(event) => setActualGrade(event.target.value)}
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
          <h3 className="mb-3 text-sm font-semibold text-gray-700">{templateLabel}</h3>
          <DynamicFormRenderer
            fields={fields}
            values={formData}
            onChange={handleFormFieldChange}
            errors={formErrors}
          />
        </div>

        {subject.isAdditional && subject.targetValue == null && (
          <div className="rounded p-2 text-xs text-amber-600">
            Score will be assessed by the verifier (no default target configured).
          </div>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Notes</label>
          <textarea
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            rows={3}
            value={evidenceDescription}
            onChange={(event) => setEvidenceDescription(event.target.value)}
            placeholder="Optional notes for reviewers..."
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Evidence Links
          </label>
          {evidenceLinks.map((link, index) => (
            <div key={index} className="mb-2 flex gap-2">
              <input
                type="url"
                className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
                value={link}
                onChange={(event) => {
                  const next = [...evidenceLinks];
                  next[index] = event.target.value;
                  setEvidenceLinks(next);
                }}
                placeholder="https://..."
              />
              {evidenceLinks.length > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    setEvidenceLinks(evidenceLinks.filter((_, itemIndex) => itemIndex !== index))
                  }
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

      <div className="flex items-center gap-3 border-t border-gray-200 pt-4">
        <button
          onClick={() => void handleSave(false)}
          disabled={saving || submitting}
          className="inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save as Draft"}
        </button>
        <button
          onClick={() => void handleSave(true)}
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
