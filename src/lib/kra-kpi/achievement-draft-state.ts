export const ACHIEVEMENT_DRAFT_STATE_KEY = "__draftState";

export type AchievementContributorDraftSnapshot = {
  id: string;
  type: "INTERNAL" | "EXTERNAL";
  userId: string | null;
  contributorRoleId: string;
  creditPercent: string;
  selectorTags: string[];
  note: string;
  externalData: Record<string, unknown>;
};

export type AchievementFormDraftState = {
  actualValue?: number | null;
  actualDate?: string;
  actualMilestone?: string;
  actualGrade?: string;
  actualBoolean?: boolean | null;
  actualRating?: number | null;
  evidenceDescription?: string;
  evidenceLinks?: string[];
  submissionNote?: string;
  contributors?: AchievementContributorDraftSnapshot[];
  sectionStates?: Record<string, unknown>;
  activeSectionKey?: string | null;
  lastSavedAt?: string;
  workingAchievementId?: string | null;
};

export function readAchievementDraftState(
  formData: Record<string, unknown> | null | undefined,
): AchievementFormDraftState | null {
  const raw = formData?.[ACHIEVEMENT_DRAFT_STATE_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  return raw as AchievementFormDraftState;
}

export function writeAchievementDraftState(
  formData: Record<string, unknown> | null | undefined,
  draftState: AchievementFormDraftState | null | undefined,
): Record<string, unknown> | undefined {
  const base = { ...(formData ?? {}) };

  if (!draftState || Object.keys(draftState).length === 0) {
    delete base[ACHIEVEMENT_DRAFT_STATE_KEY];
  } else {
    base[ACHIEVEMENT_DRAFT_STATE_KEY] = draftState;
  }

  return Object.keys(base).length > 0 ? base : undefined;
}

export function stripAchievementDraftState(
  formData: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
  if (!formData) return undefined;
  if (!(ACHIEVEMENT_DRAFT_STATE_KEY in formData)) {
    return Object.keys(formData).length > 0 ? { ...formData } : undefined;
  }

  const next = { ...formData };
  delete next[ACHIEVEMENT_DRAFT_STATE_KEY];
  return Object.keys(next).length > 0 ? next : undefined;
}
