"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import type {
  AchievementFieldConfig,
  AchievementFormConfig,
  AchievementSubmissionConfig,
  AchievementView,
  MyAllocationView,
} from "@/lib/kra-kpi/shared";
import {
  ACHIEVEMENT_TEMPLATES,
  applyAchievementFieldDefaults,
  buildFormDataValidator,
} from "@/lib/kra-kpi/shared";
import {
  applyPublicationLookupToFormData,
  buildPublicationContributorPrefill,
  buildPublicationLookupFeedbackMessage,
  getPublicationAuthorPreview,
  isPublicationLikeAchievementForm,
} from "@/lib/kra-kpi/publication-doi-client";
import { GALGOTIA_AUTO_EXCLUDE_EXTERNAL_TEMPLATE_KEYS } from "@/lib/kra-kpi/galgotia-template-constants";
import {
  getPublicationLookupStoredData,
  isFullPublicationDate,
  type PublicationLookupAuthor,
  type PublicationLookupMeta,
  type PublicationLookupResult,
} from "@/lib/kra-kpi/publication-doi-shared";
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
  submissionConfig: AchievementSubmissionConfig;
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
  assignedToUserId: string | null;
  startingUnitName: string;
  achievementTemplateKey: string | null;
  achievementFormConfig: AchievementFormConfig | null;
  submissionConfig: AchievementSubmissionConfig;
  achievement: AchievementView | null;
  isAdditional: boolean;
};

type UserOption = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  name: string;
  email: string | null;
  designation: string | null;
  primaryUnit: string | null;
};

type ContributorDraft = {
  id: string;
  type: "INTERNAL" | "EXTERNAL";
  userId: string | null;
  contributorRoleId: string;
  creditPercent: string;
  selectorTags: string[];
  note: string;
  externalData: Record<string, unknown>;
};

type PublicationLookupApiResponse = {
  status: "success" | "error";
  message: string;
  normalizedDoi?: string;
  fields?: Record<string, string | number>;
  authors?: PublicationLookupAuthor[];
  meta?: PublicationLookupMeta;
  filledFieldKeys?: string[];
  missingFieldKeys?: string[];
  warnings?: string[];
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
      assignedToUserId: allocation.assignedToUserId,
      startingUnitName: allocation.startingUnitName,
      achievementTemplateKey: allocation.achievementTemplateKey,
      achievementFormConfig: allocation.achievementFormConfig,
      submissionConfig: allocation.submissionConfig,
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
    assignedToUserId: null,
    startingUnitName: additionalContext.startingUnitName,
    achievementTemplateKey: additionalContext.achievementTemplateKey,
    achievementFormConfig: additionalContext.achievementFormConfig,
    submissionConfig: additionalContext.submissionConfig,
    achievement: additionalContext.achievement,
    isAdditional: true,
  };
}

function makeContributorId() {
  return `draft-${Math.random().toString(36).slice(2, 10)}`;
}

function autoExcludesExternalContributors(subject: FormSubject): boolean {
  return (
    typeof subject.achievementTemplateKey === "string"
    && GALGOTIA_AUTO_EXCLUDE_EXTERNAL_TEMPLATE_KEYS.has(subject.achievementTemplateKey)
  );
}

function emptyContributor(
  subject: FormSubject,
  type: "INTERNAL" | "EXTERNAL",
): ContributorDraft {
  const defaultRole =
    subject.submissionConfig.applicableRoles.find((role) => role.isDefault) ??
    subject.submissionConfig.applicableRoles[0];

  const externalDefaults = applyAchievementFieldDefaults(
    subject.submissionConfig.externalContributorFields ?? [],
    {},
  );

  return {
    id: makeContributorId(),
    type,
    userId: type === "INTERNAL" ? subject.assignedToUserId ?? null : null,
    contributorRoleId: defaultRole?.id ?? "",
    creditPercent:
      subject.submissionConfig.manualCreditEntryEnabled
        ? String(defaultRole?.defaultCreditPercent ?? "")
        : "",
    selectorTags: [],
    note: "",
    externalData: type === "EXTERNAL" ? externalDefaults : {},
  };
}

function mapAchievementContributorToDraft(
  subject: FormSubject,
  contributor: AchievementView["contributors"][number],
): ContributorDraft {
  const externalData = (contributor.externalData as Record<string, unknown> | null) ?? {};
  return {
    id: contributor.id,
    type: contributor.type,
    userId: contributor.userId,
    contributorRoleId: contributor.contributorRoleId,
    creditPercent:
      subject.submissionConfig.manualCreditEntryEnabled && contributor.creditPercent != null
        ? String(contributor.creditPercent)
        : "",
    selectorTags: contributor.selectorTags ?? [],
    note: contributor.note ?? "",
    externalData:
      contributor.type === "EXTERNAL"
        ? {
            ...applyAchievementFieldDefaults(
              subject.submissionConfig.externalContributorFields ?? [],
              externalData,
            ),
            name: externalData.name ?? contributor.externalName ?? "",
            affiliation: externalData.affiliation ?? contributor.externalAffiliation ?? "",
            scope:
              externalData.scope ??
              (contributor.externalScope === "INTERNATIONAL"
                ? "International"
                : contributor.externalScope === "NATIONAL"
                  ? "National"
                  : ""),
          }
        : {},
  };
}

function hasEvidence(description: string, links: string[]) {
  return Boolean(description.trim()) || links.some((link) => link.trim().length > 0);
}

function mapContributorDraftsForSave(
  subject: FormSubject,
  contributors: ContributorDraft[],
) {
  const autoExcludeExternal = autoExcludesExternalContributors(subject);

  return contributors.map((contributor) => {
    const parsedCreditPercent =
      subject.submissionConfig.manualCreditEntryEnabled
        && contributor.creditPercent.trim().length > 0
        ? Number(contributor.creditPercent)
        : undefined;

    if (contributor.type === "INTERNAL") {
      return {
        type: "INTERNAL" as const,
        userId: contributor.userId ?? undefined,
        contributorRoleId: contributor.contributorRoleId,
        ...(parsedCreditPercent != null && Number.isFinite(parsedCreditPercent)
          ? { creditPercent: parsedCreditPercent }
          : {}),
        selectorTags: contributor.selectorTags,
        note: contributor.note || undefined,
      };
    }

    const externalData = contributor.externalData ?? {};
    const scopeValue =
      externalData.scope === "International"
        ? "INTERNATIONAL"
        : externalData.scope === "National"
          ? "NATIONAL"
          : undefined;

    return {
      type: "EXTERNAL" as const,
      contributorRoleId: contributor.contributorRoleId,
      ...(parsedCreditPercent != null && Number.isFinite(parsedCreditPercent)
        ? { creditPercent: parsedCreditPercent }
        : {}),
      ...(autoExcludeExternal ? { isExcludedFromReward: true } : {}),
      selectorTags: contributor.selectorTags,
      note: contributor.note || undefined,
      externalName:
        typeof externalData.name === "string" && externalData.name.trim()
          ? externalData.name.trim()
          : undefined,
      externalAffiliation:
        typeof externalData.affiliation === "string" && externalData.affiliation.trim()
          ? externalData.affiliation.trim()
          : undefined,
      externalScope: scopeValue,
      externalData,
    };
  });
}

function validateContributors(input: {
  contributors: ContributorDraft[];
  showContributorSection: boolean;
  subject: FormSubject;
}): string | null {
  if (!input.showContributorSection || input.contributors.length === 0) {
    return null;
  }

  const contributorRoles = new Set(
    input.subject.submissionConfig.applicableRoles.map((role) => role.id),
  );
  const autoExcludeExternal = autoExcludesExternalContributors(input.subject);
  const externalValidator = input.subject.submissionConfig.externalContributorFields
    ? buildFormDataValidator(input.subject.submissionConfig.externalContributorFields)
    : null;

  for (const contributor of input.contributors) {
    if (!contributor.contributorRoleId || !contributorRoles.has(contributor.contributorRoleId)) {
      return "Every contributor must use a valid KPI role.";
    }

    if (contributor.type === "INTERNAL") {
      if (!contributor.userId) {
        return "Select a tenant user for every internal contributor.";
      }
      continue;
    }

    if (!input.subject.submissionConfig.allowExternalContributors) {
      return "External contributors are not enabled for this KPI.";
    }

    if (externalValidator) {
      const parsed = externalValidator.safeParse(contributor.externalData ?? {});
      if (!parsed.success) {
        return parsed.error.issues[0]?.message ?? "Invalid external contributor details.";
      }
    }

    const externalData = contributor.externalData ?? {};
    if (
      typeof externalData.name !== "string" ||
      externalData.name.trim().length === 0 ||
      typeof externalData.affiliation !== "string" ||
      externalData.affiliation.trim().length === 0
    ) {
      return "External contributors require name and affiliation.";
    }
  }

  if (input.subject.submissionConfig.manualCreditEntryEnabled) {
    let total = 0;

    for (const contributor of input.contributors) {
      if (contributor.type === "EXTERNAL" && autoExcludeExternal) {
        continue;
      }

      const trimmed = contributor.creditPercent.trim();
      if (!trimmed.length) {
        return "Enter a credit percent for every contributor who should share the reward.";
      }
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
        return "Contributor credit percent must be between 0 and 100.";
      }
      total += parsed;
    }

    if (
      input.subject.submissionConfig.creditSumMode === "MUST_EQUAL_100"
      && Math.abs(total - 100) > 0.01
    ) {
      return "Contributor credit percentages must add up to exactly 100.";
    }
    if (
      input.subject.submissionConfig.creditSumMode === "MAX_100"
      && total > 100.01
    ) {
      return "Contributor credit percentages cannot exceed 100.";
    }
  }

  return null;
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
  const showContributorSection =
    subject.submissionConfig.participantMode !== "SINGLE_OWNER" ||
    subject.submissionConfig.allowExternalContributors ||
    subject.submissionConfig.contributorSelectorTags.length > 0 ||
    (ach?.contributors.length ?? 0) > 0;
  const isPublicationLikeForm = useMemo(
    () => isPublicationLikeAchievementForm(fields),
    [fields],
  );
  const formValidator = useMemo(() => buildFormDataValidator(fields), [fields]);

  const initialFormData =
    applyAchievementFieldDefaults(
      fields,
      (ach?.achievementFormData as Record<string, unknown> | null) ??
        (!subject.achievementFormConfig
          ? {
              description: ach?.evidenceDescription ?? "",
              proofLink: ach?.evidenceLinks[0] ?? "",
            }
          : {}),
    );

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
  const [users, setUsers] = useState<UserOption[]>([]);
  const [contributors, setContributors] = useState<ContributorDraft[]>(
    ach?.contributors.length
      ? ach.contributors.map((contributor) => mapAchievementContributorToDraft(subject, contributor))
      : [],
  );
  const [submissionNote, setSubmissionNote] = useState("");
  const [loadingUsers, setLoadingUsers] = useState(showContributorSection);
  const [doiLookupLoading, setDoiLookupLoading] = useState(false);
  const [doiLookupFeedback, setDoiLookupFeedback] = useState<{
    type: "success" | "error" | "warning";
    message: string;
    details: string[];
  } | null>(null);
  const [showAllPublicationAuthors, setShowAllPublicationAuthors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const publicationLookup = useMemo(
    () => getPublicationLookupStoredData(formData),
    [formData],
  );
  const publicationDateFieldInfo = publicationLookup?.rawPublicationDate
    && !isFullPublicationDate(publicationLookup.rawPublicationDate)
    ? "Publication year/month found from DOI; enter the exact date manually."
    : null;
  const publicationAuthorPreview = useMemo(
    () => getPublicationAuthorPreview(publicationLookup?.authors ?? [], showAllPublicationAuthors),
    [publicationLookup, showAllPublicationAuthors],
  );

  useEffect(() => {
    if (!showContributorSection) {
      setLoadingUsers(false);
      return;
    }

    let cancelled = false;
    async function loadUsers() {
      setLoadingUsers(true);
      try {
        const response = await fetch("/api/tenant/users");
        if (!response.ok) return;
        const rows = (await response.json()) as UserOption[];
        if (!cancelled) {
          setUsers(Array.isArray(rows) ? rows : []);
        }
      } finally {
        if (!cancelled) {
          setLoadingUsers(false);
        }
      }
    }

    void loadUsers();
    return () => {
      cancelled = true;
    };
  }, [showContributorSection]);

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

  const handleFetchByDoi = async () => {
    const doiValue =
      typeof formData.doi === "string"
        ? formData.doi.trim()
        : "";

    if (!doiValue) {
      setDoiLookupFeedback({
        type: "error",
        message: "Enter a DOI before fetching metadata.",
        details: [],
      });
      return;
    }

    setDoiLookupLoading(true);
    setDoiLookupFeedback(null);

    try {
      const response = await fetch("/api/tenant/kra-kpi/publication-doi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doi: doiValue }),
      });
      const payload = (await response.json()) as PublicationLookupApiResponse;

      if (!response.ok || payload.status === "error" || !payload.meta) {
        setDoiLookupFeedback({
          type: "error",
          message: payload.message || "DOI metadata lookup failed.",
          details: [],
        });
        return;
      }

      const lookupResult: PublicationLookupResult = {
        normalizedDoi: payload.normalizedDoi ?? payload.meta.normalizedDoi,
        fields: (payload.fields ?? {}) as PublicationLookupResult["fields"],
        authors: Array.isArray(payload.authors) ? payload.authors : [],
        meta: payload.meta,
        filledFieldKeys: (payload.filledFieldKeys ?? payload.meta.filledFieldKeys) as PublicationLookupResult["filledFieldKeys"],
        missingFieldKeys: (payload.missingFieldKeys ?? payload.meta.missingFieldKeys) as PublicationLookupResult["missingFieldKeys"],
        warnings: payload.warnings ?? payload.meta.warnings,
      };

      const applied = applyPublicationLookupToFormData({
        fields,
        currentValues: formData,
        lookup: lookupResult,
      });

      setFormData(applied.formData);
      setShowAllPublicationAuthors(false);
      setFormErrors((prev) => {
        const next = { ...prev };
        for (const key of applied.visibleFilledFieldKeys) {
          delete next[key];
        }
        return next;
      });

      const feedbackType =
        applied.visibleMissingFieldKeys.length > 0 || lookupResult.warnings.length > 0
          ? "warning"
          : "success";
      const details = [
        ...lookupResult.warnings,
        ...(
          applied.visibleMissingFieldKeys.length > 0
            ? [`Manual entry still required for: ${applied.visibleMissingFieldKeys.join(", ")}`]
            : []
        ),
      ];

      setDoiLookupFeedback({
        type: feedbackType,
        message: buildPublicationLookupFeedbackMessage({
          filledCount: applied.visibleFilledFieldKeys.length,
          missingCount: applied.visibleMissingFieldKeys.length,
        }),
        details,
      });
    } catch (lookupError) {
      setDoiLookupFeedback({
        type: "error",
        message:
          lookupError instanceof Error && lookupError.message
            ? lookupError.message
            : "DOI metadata lookup failed.",
        details: [],
      });
    } finally {
      setDoiLookupLoading(false);
    }
  };

  const handlePrefillContributors = () => {
    if (!publicationLookup || publicationLookup.authors.length === 0) {
      setDoiLookupFeedback({
        type: "error",
        message: "Fetch DOI metadata first to pre-fill contributors.",
        details: [],
      });
      return;
    }

    if (contributors.length > 0) {
      const shouldReplace = window.confirm(
        "Replace the current draft contributor list with authors from the DOI record?",
      );
      if (!shouldReplace) {
        return;
      }
    }

    const prefill = buildPublicationContributorPrefill({
      authors: publicationLookup.authors,
      users,
      submissionConfig: subject.submissionConfig,
    });

    if (prefill.contributors.length === 0) {
      setDoiLookupFeedback({
        type: "warning",
        message: "No contributors could be pre-filled from the DOI record.",
        details: prefill.warnings,
      });
      return;
    }

    setContributors(prefill.contributors);
    setDoiLookupFeedback({
      type: prefill.warnings.length > 0 || prefill.skippedExternalCount > 0
        ? "warning"
        : "success",
      message: `Prepared ${prefill.contributors.length} contributor drafts from the DOI record.`,
      details: [
        `Matched internal users: ${prefill.matchedInternalCount}`,
        `Prepared external drafts: ${prefill.externalCount}`,
        ...(prefill.skippedExternalCount > 0
          ? [`Skipped authors because external contributors are disabled: ${prefill.skippedExternalCount}`]
          : []),
        ...prefill.warnings,
      ],
    });
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
    const parsedForm = formValidator.safeParse(formData);
    if (!parsedForm.success) {
      for (const issue of parsedForm.error.issues) {
        const key = typeof issue.path[0] === "string" ? issue.path[0] : "__form";
        if (!errors[key]) {
          errors[key] = issue.message;
        }
      }
    }

    if (submitAfter && subject.submissionConfig.evidenceRequired && !hasEvidence(evidenceDescription, evidenceLinks)) {
      nextErrors.__evidence = "Evidence is required for this KPI.";
    }

    const contributorValidationError = validateContributors({
      contributors,
      showContributorSection,
      subject,
    });
    if (contributorValidationError) {
      nextErrors.__contributors = contributorValidationError;
    }

    if (Object.keys(errors).length > 0 || Object.keys(nextErrors).length > 0) {
      setFormErrors(errors);
      setError(nextErrors.__actual ?? nextErrors.__evidence ?? nextErrors.__contributors ?? errors.__form ?? null);
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
      ...(contributors.length > 0 ? { contributors: mapContributorDraftsForSave(subject, contributors) } : {}),
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
            ...(contributors.length > 0 ? { contributors: mapContributorDraftsForSave(subject, contributors) } : {}),
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
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ note: submissionNote.trim() || undefined }),
          },
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
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-gray-700">{templateLabel}</h3>
            {isPublicationLikeForm && (
              <button
                type="button"
                onClick={() => { void handleFetchByDoi(); }}
                disabled={doiLookupLoading}
                className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {doiLookupLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                Fetch by DOI
              </button>
            )}
          </div>

          {doiLookupFeedback ? (
            <div
              className={`mb-3 rounded-md border p-3 text-xs ${
                doiLookupFeedback.type === "error"
                  ? "border-red-200 bg-red-50 text-red-700"
                  : doiLookupFeedback.type === "warning"
                    ? "border-amber-200 bg-amber-50 text-amber-800"
                    : "border-emerald-200 bg-emerald-50 text-emerald-700"
              }`}
            >
              <div className="font-medium">{doiLookupFeedback.message}</div>
              {doiLookupFeedback.details.length > 0 && (
                <div className="mt-1 space-y-1">
                  {doiLookupFeedback.details.map((detail) => (
                    <div key={detail}>{detail}</div>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          <DynamicFormRenderer
            fields={fields}
            values={formData}
            onChange={handleFormFieldChange}
            errors={formErrors}
            fieldInfo={
              publicationDateFieldInfo
                ? { publicationDate: publicationDateFieldInfo }
                : undefined
            }
          />
        </div>

        {(subject.submissionConfig.evidenceInstructions ||
          subject.submissionConfig.evidenceTypes.length > 0 ||
          subject.submissionConfig.evidenceRequired) && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <div className="font-semibold uppercase tracking-wide">Evidence Guidance</div>
            {subject.submissionConfig.evidenceInstructions && (
              <p className="mt-1">{subject.submissionConfig.evidenceInstructions}</p>
            )}
            <p className="mt-1">
              Evidence {subject.submissionConfig.evidenceRequired ? "is required" : "can be attached"} for this KPI.
            </p>
            {subject.submissionConfig.evidenceTypes.length > 0 && (
              <p className="mt-1">
                Accepted evidence types: {subject.submissionConfig.evidenceTypes.join(", ")}
              </p>
            )}
          </div>
        )}

        {showContributorSection && (
          <div className="border-t border-gray-200 pt-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-700">Contributors</h3>
                <p className="text-xs text-gray-500">
                  Participant mode: {subject.submissionConfig.participantMode.replace(/_/g, " ").toLowerCase()}.
                  {" "}Credit policy: {subject.submissionConfig.creditSumMode.replace(/_/g, " ").toLowerCase()}.
                </p>
                {subject.submissionConfig.manualCreditEntryEnabled && (
                  <p className="mt-1 text-xs text-amber-700">
                    Enter the exact contributor credit percentages that should drive reward distribution for this template.
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {publicationLookup?.authors.length ? (
                  <button
                    type="button"
                    onClick={handlePrefillContributors}
                    disabled={loadingUsers}
                    className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Pre-fill Contributors from DOI
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setContributors((prev) => [...prev, emptyContributor(subject, "INTERNAL")])}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  + Internal contributor
                </button>
                {subject.submissionConfig.allowExternalContributors && (
                  <button
                    type="button"
                    onClick={() => setContributors((prev) => [...prev, emptyContributor(subject, "EXTERNAL")])}
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    + External contributor
                  </button>
                )}
              </div>
            </div>

            {publicationLookup?.authors.length ? (
              <div className="mb-3 rounded-md border border-blue-100 bg-blue-50/70 p-3 text-xs text-blue-900">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold">
                    {publicationLookup.authors.length} author
                    {publicationLookup.authors.length === 1 ? "" : "s"} found in this DOI record
                  </div>
                  {publicationAuthorPreview.isTruncated ? (
                    <button
                      type="button"
                      onClick={() => setShowAllPublicationAuthors((prev) => !prev)}
                      className="text-xs font-medium text-blue-700 hover:text-blue-800"
                    >
                      {showAllPublicationAuthors ? "Collapse" : "Show all authors"}
                    </button>
                  ) : null}
                </div>

                {publicationAuthorPreview.isTruncated && !showAllPublicationAuthors ? (
                  <div className="mt-1 text-blue-800">
                    Showing first 20 of {publicationLookup.authors.length} authors.
                  </div>
                ) : null}

                <div
                  className={`mt-2 space-y-2 ${
                    showAllPublicationAuthors && publicationLookup.authors.length > 20
                      ? "max-h-72 overflow-y-auto pr-1"
                      : ""
                  }`}
                >
                  {publicationAuthorPreview.visibleAuthors.map((author, index) => (
                    <div key={`${author.name}-${index}`} className="rounded bg-white/70 px-2 py-1.5">
                      <div className="font-medium text-blue-950">{author.name}</div>
                      <div className="text-blue-800">
                        Suggested:{" "}
                        {author.isCorresponding
                          ? "corresponding author"
                          : author.position === "first" || author.sequence === "first"
                            ? "first author"
                            : "co-author"}
                        {" | "}
                        {author.affiliationMatchesTenantName ? "possible internal affiliation" : "external affiliation"}
                      </div>
                      {author.affiliations[0] ? (
                        <div className="text-blue-800">{author.affiliations[0]}</div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {loadingUsers ? (
              <div className="text-xs text-gray-500">Loading contributor directory...</div>
            ) : contributors.length === 0 ? (
              <div className="rounded-md bg-gray-50 p-3 text-xs text-gray-500">
                No contributors added yet. If you leave this blank, the system will default the achievement to the reporting user.
              </div>
            ) : (
              <div className="space-y-3">
                {contributors.map((contributor, index) => (
                  <div key={contributor.id} className="rounded-md border border-gray-200 p-3">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Contributor {index + 1}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setContributors((prev) => prev.filter((row) => row.id !== contributor.id))
                        }
                        className="text-xs text-red-600 hover:text-red-700"
                      >
                        Remove
                      </button>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-sm font-medium text-gray-700">Contributor Type</label>
                        <select
                          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                          value={contributor.type}
                          onChange={(event) =>
                            setContributors((prev) =>
                              prev.map((row) =>
                                row.id === contributor.id
                                  ? emptyContributor(subject, event.target.value as ContributorDraft["type"])
                                  : row,
                              ),
                            )
                          }
                        >
                          <option value="INTERNAL">Internal</option>
                          {subject.submissionConfig.allowExternalContributors && (
                            <option value="EXTERNAL">External</option>
                          )}
                        </select>
                      </div>

                      <div>
                        <label className="mb-1 block text-sm font-medium text-gray-700">Role</label>
                        <select
                          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                          value={contributor.contributorRoleId}
                          onChange={(event) =>
                            setContributors((prev) =>
                              prev.map((row) =>
                                row.id === contributor.id
                                  ? { ...row, contributorRoleId: event.target.value }
                                  : row,
                              ),
                            )
                          }
                        >
                          <option value="">Select role...</option>
                          {subject.submissionConfig.applicableRoles.map((role) => (
                            <option key={role.id} value={role.id}>
                              {role.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {contributor.type === "INTERNAL" ? (
                      <div className="mt-3">
                        <label className="mb-1 block text-sm font-medium text-gray-700">User</label>
                        <select
                          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                          value={contributor.userId ?? ""}
                          onChange={(event) =>
                            setContributors((prev) =>
                              prev.map((row) =>
                                row.id === contributor.id
                                  ? { ...row, userId: event.target.value || null }
                                  : row,
                              ),
                            )
                          }
                        >
                          <option value="">Select user...</option>
                          {users.map((user) => (
                            <option key={user.id} value={user.id}>
                              {user.name}
                              {user.designation ? ` - ${user.designation}` : ""}
                              {user.primaryUnit ? ` (${user.primaryUnit})` : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div className="mt-3 rounded-md bg-gray-50 p-3">
                        <DynamicFormRenderer
                          fields={subject.submissionConfig.externalContributorFields ?? []}
                          values={contributor.externalData}
                          onChange={(key, value) =>
                            setContributors((prev) =>
                              prev.map((row) =>
                                row.id === contributor.id
                                  ? {
                                      ...row,
                                      externalData: {
                                        ...row.externalData,
                                        [key]: value,
                                      },
                                    }
                                  : row,
                              ),
                            )
                          }
                        />
                      </div>
                    )}

                    {subject.submissionConfig.manualCreditEntryEnabled && (
                      <div className="mt-3">
                        <label className="mb-1 block text-sm font-medium text-gray-700">
                          Credit Percent
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step="0.01"
                          disabled={contributor.type === "EXTERNAL" && autoExcludesExternalContributors(subject)}
                          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500"
                          value={contributor.creditPercent}
                          onChange={(event) =>
                            setContributors((prev) =>
                              prev.map((row) =>
                                row.id === contributor.id
                                  ? { ...row, creditPercent: event.target.value }
                                  : row,
                              ),
                            )
                          }
                          placeholder="e.g. 35"
                        />
                        {contributor.type === "EXTERNAL" && autoExcludesExternalContributors(subject) && (
                          <p className="mt-1 text-xs text-amber-700">
                            External contributors are recorded for authorship history but excluded from payout for this template.
                          </p>
                        )}
                      </div>
                    )}

                    {subject.submissionConfig.contributorSelectorTags.length > 0 && (
                      <div className="mt-3">
                        <label className="mb-1 block text-sm font-medium text-gray-700">
                          Reward selector tags
                        </label>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {subject.submissionConfig.contributorSelectorTags.map((tag) => {
                            const checked = contributor.selectorTags.includes(tag);
                            return (
                              <label key={tag} className="flex items-center gap-2 text-sm text-gray-700">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(event) =>
                                    setContributors((prev) =>
                                      prev.map((row) =>
                                        row.id === contributor.id
                                          ? {
                                              ...row,
                                              selectorTags: event.target.checked
                                                ? [...row.selectorTags, tag]
                                                : row.selectorTags.filter((value) => value !== tag),
                                            }
                                          : row,
                                      ),
                                    )
                                  }
                                  className="rounded border-gray-300"
                                />
                                {tag}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="mt-3">
                      <label className="mb-1 block text-sm font-medium text-gray-700">Notes</label>
                      <textarea
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                        rows={2}
                        value={contributor.note}
                        onChange={(event) =>
                          setContributors((prev) =>
                            prev.map((row) =>
                              row.id === contributor.id
                                ? { ...row, note: event.target.value }
                                : row,
                            ),
                          )
                        }
                        placeholder="Optional contributor note"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

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

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Submission remark
          </label>
          <textarea
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            rows={2}
            value={submissionNote}
            onChange={(event) => setSubmissionNote(event.target.value)}
            placeholder="Optional note for the recommending/verifying authority"
          />
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
