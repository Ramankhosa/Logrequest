"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  Save,
  ShieldCheck,
} from "lucide-react";
import type {
  DuplicateCheckResult,
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
import { GALGOTIA_AUTO_DERIVED_SHARE_TEMPLATE_KEYS, GALGOTIA_AUTO_EXCLUDE_EXTERNAL_TEMPLATE_KEYS } from "@/lib/kra-kpi/galgotia-template-constants";
import {
  applyPublicationJournalLookupToFormData,
  getPublicationJournalLookupStoredData,
  type PublicationJournalLookupResult,
} from "@/lib/kra-kpi/publication-journal-shared";
import {
  getPublicationLookupStoredData,
  isFullPublicationDate,
  type PublicationLookupAuthor,
  type PublicationLookupMeta,
  type PublicationLookupResult,
} from "@/lib/kra-kpi/publication-doi-shared";
import { normalizeGalgotiaRewardData } from "@/lib/kra-kpi/galgotia-reward-policy";
import {
  readAchievementDraftState,
  writeAchievementDraftState,
  type AchievementFormDraftState,
} from "@/lib/kra-kpi/achievement-draft-state";
import { cn } from "@/lib/utils";
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
      achievementOverride?: AchievementView | null;
      additionalContext?: never;
      onDone: () => void;
      onCancel: () => void;
    }
  | {
      allocation?: never;
      achievementOverride?: never;
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
  allowMultipleAchievementsPerAllocation: boolean;
};

type UserOption = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  name: string;
  email: string | null;
  employeeId: string | null;
  designation: string | null;
  role: string | null;
  status: string | null;
  primaryUnit: string | null;
  primaryUnitCode: string | null;
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
  journalLookup?: PublicationJournalLookupResult | null;
};

type RewardPreviewResponse = {
  status: "success" | "error";
  message?: string;
  rewardPreview?: {
    normalizedFormData: Record<string, unknown>;
    normalizedContributors: Array<{
      id: string | null;
      type: "INTERNAL" | "EXTERNAL";
      userId: string | null;
      contributorRoleId: string | null;
      creditPercent: number;
      isExcludedFromReward: boolean;
      selectorTags: string[];
      rewardBucket: string | null;
      exclusionReason: string | null;
    }>;
    derivedAuthorshipCase: string | null;
    warnings: string[];
    errors: string[];
    rationale: string[];
    counts: {
      internal: number;
      external: number;
      eligible: number;
      excluded: number;
    };
    rewardPreview: {
      components: Array<{
        componentCode: string;
        componentName: string;
        benefitTypeName: string;
        unit: string;
        totalAmount: number;
        contributors: Array<{
          contributorId: string | null;
          userId: string | null;
          contributorRoleId: string | null;
          amount: number;
          blocked: boolean;
          reason: string | null;
        }>;
      }>;
    };
  };
  duplicateCheckResult?: DuplicateCheckResult | null;
};

type SectionKey = "overview" | "details" | "contributors" | "evidence" | "review";

type LocalDraftShadow = AchievementFormDraftState & {
  achievementId?: string | null;
  formData?: Record<string, unknown>;
};

const AUTOSAVE_DEBOUNCE_MS = 1400;

function buildDraftStorageKey(subject: FormSubject): string {
  return [
    "my-achievement-draft",
    subject.periodId,
    subject.kpiDefinitionId,
    subject.targetAllocationId ?? "additional",
    subject.assignedToUserId ?? "self",
  ].join(":");
}

function readLocalDraftState(storageKey: string): LocalDraftShadow | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalDraftShadow;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeLocalDraftState(storageKey: string, value: LocalDraftShadow) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // ignore storage failures
  }
}

function clearLocalDraftState(storageKey: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // ignore storage failures
  }
}

function snapshotFingerprint(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.some((item) => hasMeaningfulValue(item));
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((item) => hasMeaningfulValue(item));
  }
  return false;
}

function formatRewardAmount(amount: number, unit: string | null | undefined): string {
  if (!Number.isFinite(amount)) return "0";
  if (unit && /rs|rupee|inr/i.test(unit)) {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount);
  }
  return `${new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount)}${unit ? ` ${unit}` : ""}`;
}

function getStatusTone(status: string) {
  switch (status) {
    case "Saved":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "Ready":
      return "border-blue-200 bg-blue-50 text-blue-700";
    case "In progress":
      return "border-amber-200 bg-amber-50 text-amber-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-500";
  }
}

function SectionCard({
  title,
  description,
  open,
  onToggle,
  status,
  saved,
  children,
}: {
  title: string;
  description: string;
  open: boolean;
  onToggle: () => void;
  status: string;
  saved?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_18px_60px_-36px_rgba(15,23,42,0.35)]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-4 bg-slate-50 px-5 py-4 text-left"
      >
        <div>
          <div className="text-sm font-semibold text-slate-900">{title}</div>
          <div className="mt-0.5 text-xs text-slate-500">{description}</div>
        </div>
        <div className="flex items-center gap-2">
          {saved ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : null}
          <span className={cn("rounded-full border px-2.5 py-1 text-[11px] font-medium", getStatusTone(status))}>
            {status}
          </span>
          {open ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
        </div>
      </button>
      {open ? <div className="border-t border-slate-100 px-5 py-5">{children}</div> : null}
    </section>
  );
}

function buildSubject(
  allocation: MyAllocationView | undefined,
  additionalContext: AdditionalAchievementFormContext | undefined,
  achievementOverride?: AchievementView | null,
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
      achievement: achievementOverride ?? allocation.achievement,
      isAdditional: false,
      allowMultipleAchievementsPerAllocation:
        allocation.allowMultipleAchievementsPerAllocation,
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
    allowMultipleAchievementsPerAllocation: false,
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

function isEditableAchievementState(state: string | null | undefined) {
  return state === "DRAFT" || state === "REJECTED";
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
  input: {
    contributors: ContributorDraft[];
    manualCreditEntryEnabled: boolean;
    autoExcludeExternal: boolean;
  },
) {
  return input.contributors.map((contributor) => {
    const parsedCreditPercent =
      input.manualCreditEntryEnabled
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
      ...(input.autoExcludeExternal ? { isExcludedFromReward: true } : {}),
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
  achievementOverride,
  additionalContext,
  onDone,
  onCancel,
}: Props) {
  const subject = buildSubject(allocation, additionalContext, achievementOverride);
  const ach = subject.achievement;
  const storageKey = buildDraftStorageKey(subject);
  const hydratedLocalDraftRef = useRef(false);
  const forceSingleItemActualValue =
    !subject.isAdditional && subject.allowMultipleAchievementsPerAllocation;
  const isEdit = ach != null && (ach.state === "DRAFT" || ach.state === "REJECTED");
  const genericFields = ACHIEVEMENT_TEMPLATES.GENERIC.fields;
  const fields: AchievementFieldConfig[] = subject.achievementFormConfig?.fields ?? genericFields;
  const renderedFields = useMemo(
    () =>
      subject.achievementTemplateKey === "GU_JOURNAL_PUB"
        ? fields.filter((field) => field.key !== "authorshipCase")
        : fields,
    [fields, subject.achievementTemplateKey],
  );
  const templateLabel =
    subject.achievementTemplateKey && ACHIEVEMENT_TEMPLATES[subject.achievementTemplateKey]
      ? ACHIEVEMENT_TEMPLATES[subject.achievementTemplateKey].label
      : "Achievement Details";
  const excludesExternalContributors = autoExcludesExternalContributors(subject);
  const allowManualCreditEntry =
    subject.submissionConfig.manualCreditEntryEnabled &&
    !GALGOTIA_AUTO_DERIVED_SHARE_TEMPLATE_KEYS.has(subject.achievementTemplateKey ?? "");
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
  const savedDraftState = useMemo(
    () => readAchievementDraftState((ach?.achievementFormData as Record<string, unknown> | null) ?? null),
    [ach?.achievementFormData],
  );
  const roleNameById = useMemo(
    () => new Map(subject.submissionConfig.applicableRoles.map((role) => [role.id, role.name])),
    [subject.submissionConfig.applicableRoles],
  );
  const roleCodeById = useMemo(
    () => new Map(subject.submissionConfig.applicableRoles.map((role) => [role.id, role.code])),
    [subject.submissionConfig.applicableRoles],
  );

  const initialFormData = applyAchievementFieldDefaults(
    fields,
    (() => {
      const raw =
        (ach?.achievementFormData as Record<string, unknown> | null) ??
        (!subject.achievementFormConfig
          ? {
              description: ach?.evidenceDescription ?? "",
              proofLink: ach?.evidenceLinks[0] ?? "",
            }
          : {});
      const cleaned = { ...(raw ?? {}) };
      delete cleaned.__draftState;
      return cleaned;
    })(),
  );

  const [workingAchievementId, setWorkingAchievementId] = useState<string | null>(ach?.id ?? null);
  const [actualValue, setActualValue] = useState<number | undefined>(
    forceSingleItemActualValue ? 1 : savedDraftState?.actualValue ?? ach?.actualValue ?? undefined,
  );
  const [actualDate, setActualDate] = useState(savedDraftState?.actualDate ?? formatDateInput(ach?.actualDate));
  const [actualMilestone, setActualMilestone] = useState(savedDraftState?.actualMilestone ?? ach?.actualMilestone ?? "");
  const [actualGrade, setActualGrade] = useState(savedDraftState?.actualGrade ?? ach?.actualGrade ?? "");
  const [actualBoolean, setActualBoolean] = useState<boolean | null>(savedDraftState?.actualBoolean ?? ach?.actualBoolean ?? null);
  const [actualRating, setActualRating] = useState<number | undefined>(savedDraftState?.actualRating ?? ach?.actualRating ?? undefined);
  const [evidenceDescription, setEvidenceDescription] = useState(savedDraftState?.evidenceDescription ?? ach?.evidenceDescription ?? "");
  const [evidenceLinks, setEvidenceLinks] = useState<string[]>(savedDraftState?.evidenceLinks ?? ach?.evidenceLinks ?? [""]);
  const [formData, setFormData] = useState<Record<string, unknown>>(initialFormData);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [users, setUsers] = useState<UserOption[]>([]);
  const [contributors, setContributors] = useState<ContributorDraft[]>(
    savedDraftState?.contributors?.length
      ? savedDraftState.contributors.map((contributor) => ({
          id: contributor.id,
          type: contributor.type,
          userId: contributor.userId ?? null,
          contributorRoleId: contributor.contributorRoleId,
          creditPercent: contributor.creditPercent,
          selectorTags: contributor.selectorTags ?? [],
          note: contributor.note ?? "",
          externalData: contributor.externalData ?? {},
        }))
      : ach?.contributors.length
        ? ach.contributors.map((contributor) => mapAchievementContributorToDraft(subject, contributor))
        : [],
  );
  const [openContributorCards, setOpenContributorCards] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      (
        savedDraftState?.contributors?.map((contributor) => contributor.id) ??
        ach?.contributors.map((contributor) => contributor.id) ??
        []
      ).map((id) => [id, true]),
    ),
  );
  const [submissionNote, setSubmissionNote] = useState(savedDraftState?.submissionNote ?? "");
  const [loadingUsers, setLoadingUsers] = useState(showContributorSection);
  const [doiLookupLoading, setDoiLookupLoading] = useState(false);
  const [doiLookupFeedback, setDoiLookupFeedback] = useState<{
    type: "success" | "error" | "warning";
    message: string;
    details: string[];
  } | null>(null);
  const [showAllPublicationAuthors, setShowAllPublicationAuthors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autosaving, setAutosaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [rewardPreview, setRewardPreview] = useState<RewardPreviewResponse["rewardPreview"] | null>(null);
  const [duplicateWarnings, setDuplicateWarnings] = useState<DuplicateCheckResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>(() => {
    const savedSections =
      savedDraftState?.sectionStates && typeof savedDraftState.sectionStates === "object"
        ? (savedDraftState.sectionStates as Partial<Record<SectionKey, boolean>>)
        : null;
    return {
      overview: savedSections?.overview ?? true,
      details: savedSections?.details ?? true,
      contributors: savedSections?.contributors ?? showContributorSection,
      evidence: savedSections?.evidence ?? false,
      review: savedSections?.review ?? false,
    };
  });
  const rewardDerivationPreview = useMemo(
    () =>
      normalizeGalgotiaRewardData({
        templateKey: subject.achievementTemplateKey,
        formData,
        contributors: contributors.map((contributor) => ({
          id: contributor.id,
          type: contributor.type,
          userId: contributor.userId,
          contributorRoleId: contributor.contributorRoleId || null,
          roleCode: roleCodeById.get(contributor.contributorRoleId) ?? null,
          creditPercent: contributor.creditPercent.trim() ? Number(contributor.creditPercent) : 0,
          isExcludedFromReward: contributor.type === "EXTERNAL" && excludesExternalContributors,
          selectorTags: contributor.selectorTags,
        })),
      }),
    [contributors, excludesExternalContributors, formData, roleCodeById, subject.achievementTemplateKey],
  );
  const effectiveFormData = rewardDerivationPreview.normalizedFormData;
  const contributorsForSave = useMemo(
    () =>
      mapContributorDraftsForSave({
        contributors,
        manualCreditEntryEnabled: subject.submissionConfig.manualCreditEntryEnabled,
        autoExcludeExternal: excludesExternalContributors,
      }),
    [
      contributors,
      excludesExternalContributors,
      subject.submissionConfig.manualCreditEntryEnabled,
    ],
  );
  const currentSectionFingerprints = useMemo<Record<SectionKey, string>>(
    () => ({
      overview: snapshotFingerprint({
        actualValue: forceSingleItemActualValue ? 1 : actualValue ?? null,
        actualDate,
        actualMilestone,
        actualGrade,
        actualBoolean,
        actualRating: actualRating ?? null,
      }),
      details: snapshotFingerprint(effectiveFormData),
      contributors: snapshotFingerprint(contributors),
      evidence: snapshotFingerprint({
        evidenceDescription,
        evidenceLinks,
      }),
      review: snapshotFingerprint({
        submissionNote,
        openSections,
      }),
    }),
    [
      actualBoolean,
      actualDate,
      actualGrade,
      actualMilestone,
      actualRating,
      actualValue,
      contributors,
      effectiveFormData,
      evidenceDescription,
      evidenceLinks,
      forceSingleItemActualValue,
      openSections,
      submissionNote,
    ],
  );
  const currentFingerprint = useMemo(
    () => snapshotFingerprint(currentSectionFingerprints),
    [currentSectionFingerprints],
  );
  const [lastSavedFingerprint, setLastSavedFingerprint] = useState<string | null>(isEdit ? currentFingerprint : null);
  const [lastSavedSectionFingerprints, setLastSavedSectionFingerprints] = useState<Record<SectionKey, string> | null>(
    isEdit ? currentSectionFingerprints : null,
  );
  const userById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const publicationLookup = useMemo(
    () => getPublicationLookupStoredData(formData),
    [formData],
  );
  const publicationJournalLookup = useMemo(
    () => getPublicationJournalLookupStoredData(formData),
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
  const journalPolicyAlert =
    publicationJournalLookup?.policyStatus === "BLACKLISTED"
      ? {
          type: "error" as const,
          message: publicationJournalLookup.policyNote
            ? `This journal is blacklisted by your institution: ${publicationJournalLookup.policyNote}`
            : "This journal is blacklisted by your institution.",
        }
      : publicationJournalLookup?.policyStatus === "DISABLED"
        ? {
            type: "warning" as const,
            message: publicationJournalLookup.policyNote
              ? `This journal is disabled by your institution: ${publicationJournalLookup.policyNote}`
              : "This journal is disabled by your institution.",
          }
        : null;

  useEffect(() => {
    if (hydratedLocalDraftRef.current) {
      return;
    }

    hydratedLocalDraftRef.current = true;
    const localDraft = readLocalDraftState(storageKey);
    if (!localDraft) {
      return;
    }

    const resolvedAchievementId =
      ach && isEditableAchievementState(ach.state)
        ? ach.id
        : localDraft.achievementId ?? null;

    if (resolvedAchievementId) {
      setWorkingAchievementId(resolvedAchievementId);
    }
    if (resolvedAchievementId !== (localDraft.achievementId ?? null)) {
      writeLocalDraftState(storageKey, {
        ...localDraft,
        achievementId: resolvedAchievementId,
      });
    }
    if (localDraft.formData) {
      setFormData(applyAchievementFieldDefaults(fields, localDraft.formData));
    }
    if (!forceSingleItemActualValue && localDraft.actualValue !== undefined) {
      setActualValue(localDraft.actualValue ?? undefined);
    }
    if (typeof localDraft.actualDate === "string") setActualDate(localDraft.actualDate);
    if (typeof localDraft.actualMilestone === "string") setActualMilestone(localDraft.actualMilestone);
    if (typeof localDraft.actualGrade === "string") setActualGrade(localDraft.actualGrade);
    if (localDraft.actualBoolean !== undefined) setActualBoolean(localDraft.actualBoolean ?? null);
    if (localDraft.actualRating !== undefined) setActualRating(localDraft.actualRating ?? undefined);
    if (typeof localDraft.evidenceDescription === "string") setEvidenceDescription(localDraft.evidenceDescription);
    if (Array.isArray(localDraft.evidenceLinks) && localDraft.evidenceLinks.length > 0) setEvidenceLinks(localDraft.evidenceLinks);
    if (typeof localDraft.submissionNote === "string") setSubmissionNote(localDraft.submissionNote);
    if (localDraft.sectionStates && typeof localDraft.sectionStates === "object") {
      setOpenSections((prev) => ({
        ...prev,
        ...(localDraft.sectionStates as Partial<Record<SectionKey, boolean>>),
      }));
    }
    if (Array.isArray(localDraft.contributors)) {
      setContributors(
        localDraft.contributors.map((contributor) => ({
          id: contributor.id,
          type: contributor.type,
          userId: contributor.userId ?? null,
          contributorRoleId: contributor.contributorRoleId,
          creditPercent: contributor.creditPercent,
          selectorTags: contributor.selectorTags ?? [],
          note: contributor.note ?? "",
          externalData: contributor.externalData ?? {},
        })),
      );
      setOpenContributorCards(
        Object.fromEntries(localDraft.contributors.map((contributor) => [contributor.id, true])),
      );
    }
  }, [ach, fields, forceSingleItemActualValue, storageKey]);

  useEffect(() => {
    setOpenContributorCards((prev) => {
      const next: Record<string, boolean> = {};
      for (const contributor of contributors) {
        next[contributor.id] = prev[contributor.id] ?? true;
      }
      return next;
    });
  }, [contributors]);

  useEffect(() => {
    writeLocalDraftState(storageKey, {
      achievementId: workingAchievementId,
      formData,
      actualValue: forceSingleItemActualValue ? 1 : actualValue ?? null,
      actualDate,
      actualMilestone,
      actualGrade,
      actualBoolean,
      actualRating: actualRating ?? null,
      evidenceDescription,
      evidenceLinks,
      submissionNote,
      contributors,
      sectionStates: openSections,
    });
  }, [actualBoolean, actualDate, actualGrade, actualMilestone, actualRating, actualValue, contributors, evidenceDescription, evidenceLinks, forceSingleItemActualValue, formData, openSections, storageKey, submissionNote, workingAchievementId]);

  useEffect(() => {
    if (submitting) {
      return;
    }
    if (lastSavedFingerprint && currentFingerprint === lastSavedFingerprint) {
      return;
    }

    const timer = window.setTimeout(async () => {
      setAutosaving(true);
      setSyncError(null);
      try {
        const response = await fetch(
          workingAchievementId
            ? `/api/tenant/kra-kpi/achievements/${workingAchievementId}`
            : subject.isAdditional
              ? "/api/tenant/kra-kpi/my/additional-achievements"
              : "/api/tenant/kra-kpi/achievements",
          {
            method: workingAchievementId ? "PATCH" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              saveMode: "DRAFT_PARTIAL",
              periodId: subject.periodId,
              kpiDefinitionId: subject.kpiDefinitionId,
              ...(!subject.isAdditional && subject.targetAllocationId ? { targetAllocationId: subject.targetAllocationId } : {}),
              ...(forceSingleItemActualValue || actualValue !== undefined ? { actualValue: forceSingleItemActualValue ? 1 : actualValue } : {}),
              ...(actualDate ? { actualDate } : {}),
              ...(actualMilestone ? { actualMilestone } : {}),
              ...(actualGrade ? { actualGrade } : {}),
              ...(actualBoolean !== null ? { actualBoolean } : {}),
              ...(actualRating !== undefined ? { actualRating } : {}),
              evidenceDescription,
              evidenceLinks: evidenceLinks.filter((link) => link.trim()),
              achievementFormData: writeAchievementDraftState(effectiveFormData, {
                actualValue: forceSingleItemActualValue ? 1 : actualValue ?? null,
                actualDate,
                actualMilestone,
                actualGrade,
                actualBoolean,
                actualRating: actualRating ?? null,
                evidenceDescription,
                evidenceLinks,
                submissionNote,
                contributors,
                sectionStates: openSections,
                lastSavedAt: lastSavedAt ?? undefined,
              }),
              ...(contributors.length > 0 ? { contributors: contributorsForSave } : {}),
            }),
          },
        );
        const payload = (await response.json()) as { status: "success" | "error"; id?: string; message?: string };
        if (payload.status === "success") {
          if (payload.id) {
            setWorkingAchievementId(payload.id);
          }
          setLastSavedFingerprint(currentFingerprint);
          setLastSavedSectionFingerprints(currentSectionFingerprints);
          setLastSavedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
        } else {
          setSyncError(payload.message ?? "Autosave failed. Local draft is still preserved.");
        }
      } catch {
        setSyncError("Autosave failed. Local draft is still preserved.");
      } finally {
        setAutosaving(false);
      }
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [actualBoolean, actualDate, actualGrade, actualMilestone, actualRating, actualValue, contributors, contributorsForSave, currentFingerprint, currentSectionFingerprints, effectiveFormData, evidenceDescription, evidenceLinks, forceSingleItemActualValue, formData, lastSavedAt, lastSavedFingerprint, openSections, storageKey, subject.isAdditional, subject.kpiDefinitionId, subject.periodId, subject.targetAllocationId, submissionNote, submitting, workingAchievementId]);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const response = await fetch("/api/tenant/kra-kpi/my/achievement-preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            periodId: subject.periodId,
            kpiDefinitionId: subject.kpiDefinitionId,
            achievementId: workingAchievementId ?? undefined,
            actualValue: forceSingleItemActualValue ? 1 : actualValue ?? null,
            actualDate: actualDate || undefined,
            reportingDate: new Date().toISOString(),
            achievementFormData: effectiveFormData,
            contributors: contributors.map((contributor) => ({
              id: contributor.id,
              type: contributor.type,
              userId: contributor.userId ?? undefined,
              contributorRoleId: contributor.contributorRoleId || null,
              creditPercent: contributor.creditPercent.trim() ? Number(contributor.creditPercent) : 0,
              isExcludedFromReward: contributor.type === "EXTERNAL" && excludesExternalContributors,
              selectorTags: contributor.selectorTags,
            })),
            systemMetrics: {},
          }),
        });
        const payload = (await response.json()) as RewardPreviewResponse;
        if (!response.ok || payload.status === "error" || !payload.rewardPreview) {
          setRewardPreview(null);
          setDuplicateWarnings(null);
          setPreviewError(payload.message ?? "Reward preview could not be calculated.");
          return;
        }
        setRewardPreview(payload.rewardPreview);
        setDuplicateWarnings(payload.duplicateCheckResult ?? null);
      } catch {
        setRewardPreview(null);
        setDuplicateWarnings(null);
        setPreviewError("Reward preview could not be calculated.");
      } finally {
        setPreviewLoading(false);
      }
    }, 450);

    return () => window.clearTimeout(timer);
  }, [actualDate, actualValue, contributors, effectiveFormData, excludesExternalContributors, forceSingleItemActualValue, subject.kpiDefinitionId, subject.periodId, workingAchievementId]);

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
      const journalApplied = payload.journalLookup
        ? applyPublicationJournalLookupToFormData({
            fields,
            currentValues: applied.formData,
            lookup: payload.journalLookup,
            mode: "overwrite",
          })
        : null;
      const nextFormData = journalApplied?.formData ?? applied.formData;
      const filledFieldKeys = [
        ...new Set([
          ...applied.visibleFilledFieldKeys,
          ...(journalApplied?.visibleFilledFieldKeys ?? []),
        ]),
      ];
      const missingFieldKeys = [
        ...new Set([
          ...applied.visibleMissingFieldKeys,
          ...(journalApplied?.visibleMissingFieldKeys ?? []),
        ]),
      ].filter((key) => !filledFieldKeys.includes(key));

      setFormData(nextFormData);
      setShowAllPublicationAuthors(false);
      setFormErrors((prev) => {
        const next = { ...prev };
        for (const key of filledFieldKeys) {
          delete next[key];
        }
        return next;
      });

      const feedbackType =
        missingFieldKeys.length > 0 ||
        lookupResult.warnings.length > 0 ||
        (payload.journalLookup?.warnings.length ?? 0) > 0
          ? "warning"
          : "success";
      const details = [
        ...lookupResult.warnings,
        ...(payload.journalLookup?.warnings ?? []),
        ...(
          missingFieldKeys.length > 0
            ? [`Manual entry still required for: ${missingFieldKeys.join(", ")}`]
            : []
        ),
      ];

      setDoiLookupFeedback({
        type: feedbackType,
        message: buildPublicationLookupFeedbackMessage({
          filledCount: filledFieldKeys.length,
          missingCount: missingFieldKeys.length,
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
        return forceSingleItemActualValue || actualValue != null
          ? null
          : "Enter the actual value.";
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
    const parsedForm = formValidator.safeParse(effectiveFormData);
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
      typeof effectiveFormData.proofLink === "string" && effectiveFormData.proofLink.trim()
        ? effectiveFormData.proofLink.trim()
        : null;
    const mergedLinks =
      genericProofLink && !filteredLinks.includes(genericProofLink)
        ? [genericProofLink, ...filteredLinks]
        : filteredLinks;
    const derivedDescription =
      typeof effectiveFormData.description === "string" && effectiveFormData.description.trim()
        ? effectiveFormData.description.trim()
        : evidenceDescription || undefined;
    const persistedActualValue = forceSingleItemActualValue ? 1 : actualValue;

    const body = {
      saveMode: "DRAFT_COMPLETE",
      periodId: subject.periodId,
      kpiDefinitionId: subject.kpiDefinitionId,
      ...(!subject.isAdditional &&
        subject.targetAllocationId && { targetAllocationId: subject.targetAllocationId }),
      ...(persistedActualValue !== undefined && { actualValue: persistedActualValue }),
      ...(actualDate && { actualDate }),
      ...(actualMilestone && { actualMilestone }),
      ...(actualGrade && { actualGrade }),
      ...(actualBoolean !== null && { actualBoolean }),
      ...(actualRating !== undefined && { actualRating }),
      evidenceDescription: derivedDescription,
      evidenceLinks: mergedLinks,
      achievementFormData: writeAchievementDraftState(Object.keys(effectiveFormData).length > 0 ? effectiveFormData : undefined, {
        actualValue: forceSingleItemActualValue ? 1 : actualValue ?? null,
        actualDate,
        actualMilestone,
        actualGrade,
        actualBoolean,
        actualRating: actualRating ?? null,
        evidenceDescription,
        evidenceLinks,
        submissionNote,
        contributors,
        sectionStates: openSections,
      }),
      ...(contributors.length > 0 ? { contributors: contributorsForSave } : {}),
    };

    try {
      let response: Response;
      if (workingAchievementId) {
        response = await fetch(`/api/tenant/kra-kpi/achievements/${workingAchievementId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            saveMode: "DRAFT_COMPLETE",
            ...(persistedActualValue !== undefined && { actualValue: persistedActualValue }),
            ...(actualDate && { actualDate }),
            ...(actualMilestone && { actualMilestone }),
            ...(actualGrade && { actualGrade }),
            ...(actualBoolean !== null && { actualBoolean }),
            ...(actualRating !== undefined && { actualRating }),
            evidenceDescription: derivedDescription,
            evidenceLinks: mergedLinks,
            achievementFormData: writeAchievementDraftState(Object.keys(effectiveFormData).length > 0 ? effectiveFormData : undefined, {
              actualValue: forceSingleItemActualValue ? 1 : actualValue ?? null,
              actualDate,
              actualMilestone,
              actualGrade,
              actualBoolean,
              actualRating: actualRating ?? null,
              evidenceDescription,
              evidenceLinks,
              submissionNote,
              contributors,
              sectionStates: openSections,
            }),
            ...(contributors.length > 0 ? { contributors: contributorsForSave } : {}),
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

      const nextAchievementId = data.id ?? workingAchievementId;
      if (nextAchievementId) {
        setWorkingAchievementId(nextAchievementId);
      }
      setLastSavedFingerprint(currentFingerprint);
      setLastSavedSectionFingerprints(currentSectionFingerprints);
      setLastSavedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));

      if (submitAfter) {
        const achievementId = nextAchievementId;
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
      if (submitAfter) {
        clearLocalDraftState(storageKey);
      }
      onDone();
    } catch {
      setError("Failed to save. Please try again.");
      setter(false);
    }
  };

  const overviewReady = validateActualInput() == null;
  const overviewStarted =
    forceSingleItemActualValue ||
    actualValue != null ||
    Boolean(actualDate) ||
    Boolean(actualMilestone) ||
    Boolean(actualGrade) ||
    actualBoolean !== null ||
    actualRating != null;
  const detailsReady = formValidator.safeParse(effectiveFormData).success;
  const detailsStarted = renderedFields.some((field) => hasMeaningfulValue(formData[field.key]));
  const contributorReady =
    !showContributorSection || validateContributors({ contributors, showContributorSection, subject }) == null;
  const contributorStarted = contributors.length > 0;
  const evidenceReady = !subject.submissionConfig.evidenceRequired || hasEvidence(evidenceDescription, evidenceLinks);
  const evidenceStarted = hasEvidence(evidenceDescription, evidenceLinks);
  const reviewReady =
    overviewReady &&
    detailsReady &&
    contributorReady &&
    evidenceReady;
  const reviewStarted = submissionNote.trim().length > 0;
  const previewContributors =
    rewardPreview?.normalizedContributors ??
    rewardDerivationPreview.normalizedContributors.map((contributor, index) => ({
      id: contributors[index]?.id ?? null,
      ...contributor,
    }));
  const previewWarnings =
    rewardPreview
      ? [...(rewardPreview.warnings ?? []), ...(rewardPreview.errors ?? [])]
      : [...rewardDerivationPreview.warnings, ...rewardDerivationPreview.errors];
  const derivedAuthorshipCase =
    rewardPreview?.derivedAuthorshipCase ?? rewardDerivationPreview.derivedAuthorshipCase;
  const rewardCounts = rewardPreview?.counts ?? {
    internal: previewContributors.filter((contributor) => contributor.type === "INTERNAL").length,
    external: previewContributors.filter((contributor) => contributor.type === "EXTERNAL").length,
    eligible: previewContributors.filter((contributor) => !contributor.isExcludedFromReward).length,
    excluded: previewContributors.filter((contributor) => contributor.isExcludedFromReward).length,
  };
  const rewardComponents = useMemo(
    () => rewardPreview?.rewardPreview.components ?? [],
    [rewardPreview],
  );
  const rewardTotalAmount = rewardComponents.reduce((sum, component) => sum + component.totalAmount, 0);
  const rewardUnit = rewardComponents[0]?.unit ?? subject.unitLabel ?? null;
  const rewardAmountsByContributorKey = useMemo(() => {
    const amounts = new Map<string, { amount: number; blocked: boolean; reasons: string[] }>();
    for (const component of rewardComponents) {
      for (const contributor of component.contributors) {
        const key = contributor.contributorId ?? contributor.userId;
        if (!key) continue;
        const current = amounts.get(key) ?? { amount: 0, blocked: false, reasons: [] };
        current.amount += contributor.amount;
        current.blocked = current.blocked || contributor.blocked;
        if (contributor.reason) {
          current.reasons.push(contributor.reason);
        }
        amounts.set(key, current);
      }
    }
    return amounts;
  }, [rewardComponents]);
  const previewContributorRows = previewContributors.map((contributor, index) => {
    const draftContributor =
      contributors.find((row) => row.id === contributor.id) ??
      contributors.find((row) => row.userId != null && row.userId === contributor.userId) ??
      contributors[index];
    const externalName =
      draftContributor?.type === "EXTERNAL" && typeof draftContributor.externalData.name === "string"
        ? draftContributor.externalData.name
        : null;
    const contributorName =
      (contributor.userId ? userById.get(contributor.userId)?.name : null) ??
      externalName ??
      `Contributor ${index + 1}`;
    const roleName =
      (contributor.contributorRoleId ? roleNameById.get(contributor.contributorRoleId) : null) ??
      "Role pending";
    const rewardKey = contributor.id ?? contributor.userId ?? `row-${index}`;
    const rewardAmount = rewardAmountsByContributorKey.get(rewardKey)?.amount ?? 0;
    const blocked = rewardAmountsByContributorKey.get(rewardKey)?.blocked ?? false;
    const rewardReasons = rewardAmountsByContributorKey.get(rewardKey)?.reasons ?? [];
    return {
      key: rewardKey,
      name: contributorName,
      roleName,
      type: contributor.type,
      amount: rewardAmount,
      blocked,
      rewardReasons,
      creditPercent: contributor.creditPercent,
      isExcludedFromReward: contributor.isExcludedFromReward,
      exclusionReason: contributor.exclusionReason,
    };
  });
  const duplicateMessages =
    duplicateWarnings?.matches.map((match) =>
      match.note ??
      `${match.relatedKpiTitle ?? match.achievementTitle ?? "Another submission"} matches ${match.matchedField}: ${match.matchedValue}`,
    ) ?? [];
  const sectionSaved = (key: SectionKey) =>
    lastSavedSectionFingerprints?.[key] != null &&
    lastSavedSectionFingerprints[key] === currentSectionFingerprints[key];
  const resolveSectionStatus = (key: SectionKey, ready: boolean, started: boolean) => {
    if (sectionSaved(key) && (ready || started)) return "Saved";
    if (ready) return "Ready";
    if (started) return "In progress";
    return "Not started";
  };
  const overviewStatus = resolveSectionStatus("overview", overviewReady, overviewStarted);
  const detailsStatus = resolveSectionStatus("details", detailsReady, detailsStarted);
  const contributorStatus = resolveSectionStatus("contributors", contributorReady, contributorStarted);
  const evidenceStatus = resolveSectionStatus("evidence", evidenceReady, evidenceStarted);
  const reviewStatus = resolveSectionStatus("review", reviewReady, reviewStarted || reviewReady);
  const allSectionsSaved = currentFingerprint === lastSavedFingerprint;
  const syncBadgeTone = syncError
    ? "border-rose-200 bg-rose-50 text-rose-700"
    : autosaving
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : allSectionsSaved
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : "border-slate-200 bg-slate-100 text-slate-600";
  const syncLabel = syncError
    ? "Local draft only"
    : autosaving
      ? "Saving draft..."
      : allSectionsSaved
        ? `Saved${lastSavedAt ? ` at ${lastSavedAt}` : ""}`
        : "Changes pending sync";

  return (
    <div className="space-y-6 pb-8">
      <div className="flex items-center gap-3">
        <button
          onClick={onCancel}
          className="inline-flex items-center gap-1 text-sm text-slate-500 transition hover:text-slate-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
      </div>

      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-[linear-gradient(135deg,#ffffff_0%,#f8fafc_52%,#eef6ff_100%)] p-6 shadow-[0_28px_90px_-54px_rgba(15,23,42,0.4)]">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
                {isEdit ? "Draft in progress" : "New achievement"}
              </span>
              <span className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold", syncBadgeTone)}>
                <Save className="h-3.5 w-3.5" />
                {syncLabel}
              </span>
            </div>
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-slate-950">
                {isEdit ? "Edit" : "Record"} Achievement
              </h2>
              <p className="mt-1 text-sm text-slate-600">{subject.kpiTitle}</p>
            </div>
            <p className="max-w-3xl text-sm leading-6 text-slate-600">
              Capture the achievement once. For Galgotias reward templates, the system derives the applicable case,
              internal eligibility, and per-member reward split from the contributor roles and author counts.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[340px]">
            <div className="rounded-2xl border border-white/70 bg-white/80 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">KRA</div>
              <div className="mt-1 text-sm font-semibold text-slate-900">{subject.kraTitle}</div>
              <div className="mt-1 text-xs text-slate-500">Category: {subject.categoryLabel ?? "—"}</div>
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/80 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                {subject.isAdditional ? "Default target" : "Target"}
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-900">
                {subject.targetValue ?? "—"} {subject.unitLabel ?? ""}
              </div>
              <div className="mt-1 text-xs text-slate-500">Type: {subject.measurementType}</div>
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/80 p-4 sm:col-span-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Source unit</div>
              <div className="mt-1 text-sm font-semibold text-slate-900">{subject.startingUnitName}</div>
              {!subject.isAdditional &&
                subject.parentTargetValue != null &&
                subject.targetValue != null && (
                  <div className="mt-1 text-xs text-slate-500">
                    Department target: {subject.parentTargetValue} | Your share: {subject.targetValue} (
                    {Math.round((subject.targetValue / subject.parentTargetValue) * 100)}%)
                  </div>
                )}
            </div>
          </div>
        </div>
      </section>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      {syncError ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{syncError}</div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <SectionCard
            title="Overview"
            description="Record the KPI outcome for this request."
            open={openSections.overview}
            onToggle={() => setOpenSections((prev) => ({ ...prev, overview: !prev.overview }))}
            status={overviewStatus}
            saved={sectionSaved("overview")}
          >
            <div className="space-y-4">
        {(subject.measurementType === "NUMERIC" ||
          subject.measurementType === "PERCENTAGE" ||
          subject.measurementType === "CURRENCY") && (
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Actual Value {subject.unitLabel ? `(${subject.unitLabel})` : ""}
              <span className="ml-0.5 text-red-500">*</span>
            </label>
            {forceSingleItemActualValue ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                Each achievement request counts as 1 for this KPI. Official progress is calculated from verified requests only.
              </div>
            ) : (
              <input
                type="number"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                value={actualValue ?? ""}
                onChange={(event) =>
                  setActualValue(event.target.value ? Number(event.target.value) : undefined)
                }
                placeholder={`e.g., ${subject.targetValue ?? ""}`}
              />
            )}
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

            </div>
          </SectionCard>

          <SectionCard
            title="Achievement Details"
            description="Fill the KPI-specific fields and reward-driving data."
            open={openSections.details}
            onToggle={() => setOpenSections((prev) => ({ ...prev, details: !prev.details }))}
            status={detailsStatus}
            saved={sectionSaved("details")}
          >
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">{templateLabel}</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Capture the achievement facts here. Reward distribution is derived separately from policy.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {subject.achievementTemplateKey === "GU_JOURNAL_PUB" ? (
                    <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                      Derived case: {derivedAuthorshipCase ?? "Waiting for author roles"}
                    </span>
                  ) : null}
                  {GALGOTIA_AUTO_DERIVED_SHARE_TEMPLATE_KEYS.has(subject.achievementTemplateKey ?? "") ? (
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                      Reward split auto-calculated
                    </span>
                  ) : null}
                  {isPublicationLikeForm && (
                    <button
                      type="button"
                      onClick={() => { void handleFetchByDoi(); }}
                      disabled={doiLookupLoading}
                      className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {doiLookupLoading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : null}
                      Fetch by DOI
                    </button>
                  )}
                </div>
              </div>

              {doiLookupFeedback ? (
                <div
                  className={cn(
                    "rounded-2xl border p-3 text-xs",
                    doiLookupFeedback.type === "error"
                      ? "border-red-200 bg-red-50 text-red-700"
                      : doiLookupFeedback.type === "warning"
                        ? "border-amber-200 bg-amber-50 text-amber-800"
                        : "border-emerald-200 bg-emerald-50 text-emerald-700",
                  )}
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

              {journalPolicyAlert ? (
                <div
                  className={cn(
                    "rounded-2xl border p-3 text-xs",
                    journalPolicyAlert.type === "error"
                      ? "border-rose-200 bg-rose-50 text-rose-700"
                      : "border-amber-200 bg-amber-50 text-amber-800",
                  )}
                >
                  <div className="font-medium">{journalPolicyAlert.message}</div>
                </div>
              ) : null}

              <div className="rounded-[22px] border border-slate-200 bg-slate-50/60 p-4">
                <DynamicFormRenderer
                  fields={renderedFields}
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
            </div>
          </SectionCard>

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
          <SectionCard
            title="Contributors"
            description="Add the team members, internal/external status, and roles."
            open={openSections.contributors}
            onToggle={() => setOpenSections((prev) => ({ ...prev, contributors: !prev.contributors }))}
            status={contributorStatus}
            saved={sectionSaved("contributors")}
          >
            <div className="space-y-4">
              <div className="rounded-[22px] border border-slate-200 bg-slate-50/70 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Contributor setup</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      Participant mode: {subject.submissionConfig.participantMode.replace(/_/g, " ").toLowerCase()}.
                      {" "}Credit policy: {subject.submissionConfig.creditSumMode.replace(/_/g, " ").toLowerCase()}.
                    </p>
                    <p className="mt-2 text-xs text-slate-600">
                      Internal: {rewardCounts.internal} | External: {rewardCounts.external} | Eligible for payout: {rewardCounts.eligible}
                    </p>
                    {allowManualCreditEntry ? (
                      <p className="mt-1 text-xs text-amber-700">
                        Enter the exact contributor credit percentages that should drive reward distribution for this template.
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-emerald-700">
                        You only need to record members and roles. The system calculates the reward share automatically.
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {publicationLookup?.authors.length ? (
                      <button
                        type="button"
                        onClick={handlePrefillContributors}
                        disabled={loadingUsers}
                        className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Pre-fill from DOI
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setContributors((prev) => [...prev, emptyContributor(subject, "INTERNAL")])}
                      className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      + Internal contributor
                    </button>
                    {subject.submissionConfig.allowExternalContributors && (
                      <button
                        type="button"
                        onClick={() => setContributors((prev) => [...prev, emptyContributor(subject, "EXTERNAL")])}
                        className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        + External contributor
                      </button>
                    )}
                  </div>
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
                {contributors.map((contributor, index) => {
                  const contributorLabel =
                    contributor.type === "INTERNAL"
                      ? userById.get(contributor.userId ?? "")?.name ?? `Internal contributor ${index + 1}`
                      : typeof contributor.externalData.name === "string" && contributor.externalData.name.trim()
                        ? contributor.externalData.name
                        : `External contributor ${index + 1}`;
                  const contributorRole = roleNameById.get(contributor.contributorRoleId) ?? "Role pending";
                  const contributorReadyState =
                    contributor.contributorRoleId.trim().length > 0 &&
                    (contributor.type === "EXTERNAL" || Boolean(contributor.userId));
                  const previewContributor = previewContributorRows.find((row) =>
                    row.key === contributor.id || (contributor.userId ? row.key === contributor.userId : false),
                  );
                  const contributorCardOpen = openContributorCards[contributor.id] ?? true;

                  return (
                  <div key={contributor.id} className="overflow-hidden rounded-[22px] border border-slate-200 bg-white">
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
                      <button
                        type="button"
                        onClick={() =>
                          setOpenContributorCards((prev) => ({
                            ...prev,
                            [contributor.id]: !prev[contributor.id],
                          }))
                        }
                        className="flex min-w-0 flex-1 items-start gap-3 text-left"
                      >
                        {contributorCardOpen ? (
                          <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                        ) : (
                          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                        )}
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-slate-900">{contributorLabel}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600">
                              {contributor.type.toLowerCase()}
                            </span>
                            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600">
                              {contributorRole}
                            </span>
                            {previewContributor ? (
                              <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700">
                                Est. {formatRewardAmount(previewContributor.amount, rewardUnit)}
                              </span>
                            ) : null}
                            {contributorReadyState ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                                <CheckCircle2 className="h-3 w-3" />
                                Ready
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setContributors((prev) => prev.filter((row) => row.id !== contributor.id))
                        }
                        className="text-xs font-medium text-rose-600 hover:text-rose-700"
                      >
                        Remove
                      </button>
                    </div>

                    {contributorCardOpen && (
                    <div className="space-y-3 p-4">
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

                    {allowManualCreditEntry && (
                      <div className="mt-3">
                        <label className="mb-1 block text-sm font-medium text-gray-700">
                          Credit Percent
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step="0.01"
                          disabled={contributor.type === "EXTERNAL" && excludesExternalContributors}
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
                        {contributor.type === "EXTERNAL" && excludesExternalContributors && (
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
                    )}
                  </div>
                  );
                })}
              </div>
            )}
            </div>
          </SectionCard>
        )}

          <SectionCard
            title="Evidence And Notes"
            description="Attach supporting notes and links for the reviewer."
            open={openSections.evidence}
            onToggle={() => setOpenSections((prev) => ({ ...prev, evidence: !prev.evidence }))}
            status={evidenceStatus}
            saved={sectionSaved("evidence")}
          >
            <div className="space-y-4">
              {(subject.submissionConfig.evidenceInstructions ||
                subject.submissionConfig.evidenceTypes.length > 0 ||
                subject.submissionConfig.evidenceRequired) && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
                  <div className="flex items-center gap-2 font-semibold uppercase tracking-wide">
                    <FileText className="h-4 w-4" />
                    Evidence Guidance
                  </div>
                  {subject.submissionConfig.evidenceInstructions && (
                    <p className="mt-2">{subject.submissionConfig.evidenceInstructions}</p>
                  )}
                  <p className="mt-2">
                    Evidence {subject.submissionConfig.evidenceRequired ? "is required" : "can be attached"} for this KPI.
                  </p>
                  {subject.submissionConfig.evidenceTypes.length > 0 && (
                    <p className="mt-2">
                      Accepted evidence types: {subject.submissionConfig.evidenceTypes.join(", ")}
                    </p>
                  )}
                </div>
              )}

              {subject.isAdditional && subject.targetValue == null && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                  Score will be assessed by the verifier because no default target is configured.
                </div>
              )}

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Notes</label>
                <textarea
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                  rows={3}
                  value={evidenceDescription}
                  onChange={(event) => setEvidenceDescription(event.target.value)}
                  placeholder="Optional notes for reviewers..."
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Evidence Links</label>
                {evidenceLinks.map((link, index) => (
                  <div key={index} className="mb-2 flex gap-2">
                    <input
                      type="url"
                      className="flex-1 rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
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
                        className="text-xs font-medium text-rose-500 hover:text-rose-700"
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
                    className="text-xs font-medium text-blue-600 hover:text-blue-800"
                  >
                    + Add link
                  </button>
                )}
              </div>
            </div>
          </SectionCard>

          <SectionCard
            title="Review And Submit"
            description="Add a final remark and submit when all sections are ready."
            open={openSections.review}
            onToggle={() => setOpenSections((prev) => ({ ...prev, review: !prev.review }))}
            status={reviewStatus}
            saved={sectionSaved("review")}
          >
            <div className="space-y-4">
              <div className={cn(
                "rounded-2xl border px-4 py-3 text-sm",
                reviewReady
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-amber-200 bg-amber-50 text-amber-800",
              )}>
                {reviewReady
                  ? "This request is ready for submission."
                  : "Some required sections are still incomplete. You can keep saving a partial draft without losing progress."}
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Submission remark
                </label>
                <textarea
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                  rows={2}
                  value={submissionNote}
                  onChange={(event) => setSubmissionNote(event.target.value)}
                  placeholder="Optional note for the recommending/verifying authority"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
                <button
                  onClick={() => void handleSave(false)}
                  disabled={saving || submitting}
                  className="inline-flex items-center rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save as Draft"}
                </button>
                <button
                  onClick={() => void handleSave(true)}
                  disabled={saving || submitting}
                  className="inline-flex items-center rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
                >
                  {submitting ? "Submitting..." : "Save & Submit"}
                </button>
                <button
                  onClick={onCancel}
                  className="text-sm text-slate-500 hover:text-slate-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          </SectionCard>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_18px_60px_-40px_rgba(15,23,42,0.35)]">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <ShieldCheck className="h-4 w-4 text-slate-500" />
              Progress Snapshot
            </div>
            <div className="mt-4 space-y-2">
              {[
                ["Overview", overviewStatus],
                ["Achievement Details", detailsStatus],
                ...(showContributorSection ? [["Contributors", contributorStatus] as const] : []),
                ["Evidence And Notes", evidenceStatus],
                ["Review And Submit", reviewStatus],
              ].map(([label, status]) => (
                <div key={label} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-xs">
                  <span className="font-medium text-slate-600">{label}</span>
                  <span className={cn("rounded-full border px-2.5 py-1 font-semibold", getStatusTone(status))}>
                    {status}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_18px_60px_-40px_rgba(15,23,42,0.35)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">Reward Estimate</div>
                <div className="mt-1 text-xs text-slate-500">
                  Server-derived split based on current form data.
                </div>
              </div>
              {previewLoading ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : null}
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <div className="rounded-2xl bg-slate-50 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Estimated total</div>
                <div className="mt-1 text-xl font-semibold text-slate-950">
                  {formatRewardAmount(rewardTotalAmount, rewardUnit)}
                </div>
              </div>
              <div className="rounded-2xl bg-slate-50 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Eligibility</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">
                  {rewardCounts.eligible} eligible / {rewardCounts.internal + rewardCounts.external} listed
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  Internal {rewardCounts.internal} | External {rewardCounts.external}
                </div>
              </div>
            </div>

            {subject.achievementTemplateKey === "GU_JOURNAL_PUB" ? (
              <div className="mt-3 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-800">
                Journal case: <span className="font-semibold">{derivedAuthorshipCase ?? "Waiting for author roles"}</span>
              </div>
            ) : null}

            {previewError ? (
              <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
                {previewError}
              </div>
            ) : null}

            <div className="mt-4 space-y-2">
              {previewContributorRows.length > 0 ? (
                previewContributorRows.map((contributor) => (
                  <div key={contributor.key} className="rounded-2xl border border-slate-200 px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{contributor.name}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {contributor.roleName} | {contributor.type.toLowerCase()}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold text-slate-900">
                          {formatRewardAmount(contributor.amount, rewardUnit)}
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500">
                          Share {contributor.creditPercent}%
                        </div>
                      </div>
                    </div>
                    {contributor.isExcludedFromReward ? (
                      <div className="mt-2 text-xs text-amber-700">
                        Excluded from reward{contributor.exclusionReason ? `: ${contributor.exclusionReason}` : "."}
                      </div>
                    ) : null}
                    {contributor.rewardReasons.length > 0 ? (
                      <div className="mt-2 text-xs text-slate-500">
                        {contributor.rewardReasons.join(" ")}
                      </div>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-xs text-slate-500">
                  Add the required details and contributors to calculate the reward estimate.
                </div>
              )}
            </div>
          </div>

          {(previewWarnings.length > 0 || duplicateMessages.length > 0) && (
            <div className="rounded-[24px] border border-amber-200 bg-amber-50 p-5 shadow-[0_18px_60px_-40px_rgba(15,23,42,0.25)]">
              <div className="text-sm font-semibold text-amber-900">Warnings</div>
              <div className="mt-3 space-y-2 text-xs text-amber-900">
                {previewWarnings.map((warning) => (
                  <div key={warning} className="rounded-xl bg-white/60 px-3 py-2">
                    {warning}
                  </div>
                ))}
                {duplicateMessages.map((warning) => (
                  <div key={warning} className="rounded-xl bg-white/60 px-3 py-2">
                    {warning}
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>
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
