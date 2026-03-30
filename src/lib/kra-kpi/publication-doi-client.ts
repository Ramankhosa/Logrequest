import {
  applyAchievementFieldDefaults,
  type AchievementFieldConfig,
  type AchievementSubmissionConfig,
  type AchievementSubmissionRoleView,
} from "@/lib/kra-kpi/shared";
import {
  PUBLICATION_LOOKUP_HIDDEN_KEY,
  PUBLICATION_MANAGED_FIELD_KEYS,
  isFullPublicationDate,
  normalizePublicationPersonName,
  type PublicationManagedFieldKey,
  type PublicationLookupAuthor,
  type PublicationLookupResult,
  type PublicationLookupStoredData,
} from "@/lib/kra-kpi/publication-doi-shared";

export type PublicationLookupUser = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
};

export type PublicationContributorDraft = {
  id: string;
  type: "INTERNAL" | "EXTERNAL";
  userId: string | null;
  contributorRoleId: string;
  creditPercent: string;
  selectorTags: string[];
  note: string;
  externalData: Record<string, unknown>;
};

export type PublicationContributorPrefillResult = {
  contributors: PublicationContributorDraft[];
  matchedInternalCount: number;
  externalCount: number;
  skippedExternalCount: number;
  warnings: string[];
};

export type PublicationLookupApplyResult = {
  formData: Record<string, unknown>;
  visibleFilledFieldKeys: PublicationManagedFieldKey[];
  visibleMissingFieldKeys: PublicationManagedFieldKey[];
  publicationDateNote: string | null;
};

function makeDraftId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `draft-${crypto.randomUUID()}`;
  }
  return `draft-${Math.random().toString(36).slice(2, 10)}`;
}

function getFieldMap(fields: AchievementFieldConfig[]) {
  return new Map(fields.map((field) => [field.key, field]));
}

function getVisibleManagedFieldKeys(
  fields: AchievementFieldConfig[],
): PublicationManagedFieldKey[] {
  const fieldMap = getFieldMap(fields);
  return PUBLICATION_MANAGED_FIELD_KEYS.filter((key) => fieldMap.has(key));
}

function coercePublicationFieldValue(
  field: AchievementFieldConfig,
  value: string | number,
): unknown {
  if (field.type === "NUMBER") {
    if (typeof value === "number") {
      return value;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  if (typeof value === "number") {
    return String(value);
  }

  return value;
}

function getDefaultRole(roles: AchievementSubmissionRoleView[]) {
  return roles.find((role) => role.isDefault) ?? roles[0] ?? null;
}

function pickContributorRoleId(
  author: PublicationLookupAuthor,
  roles: AchievementSubmissionRoleView[],
): string {
  const roleByCode = new Map(roles.map((role) => [role.code, role.id]));
  const preferredCodes = author.isCorresponding
    ? ["CORRESPONDING_AUTHOR", "CORRESPONDING", "FIRST_AUTHOR", "LEAD_AUTHOR", "AUTHOR"]
    : author.position === "first" || author.sequence === "first"
      ? ["FIRST_AUTHOR", "LEAD_AUTHOR", "AUTHOR"]
      : ["CO_AUTHOR", "AUTHOR"];

  for (const code of preferredCodes) {
    const roleId = roleByCode.get(code);
    if (roleId) {
      return roleId;
    }
  }

  return getDefaultRole(roles)?.id ?? "";
}

function buildSelectorTags(
  author: PublicationLookupAuthor,
  availableTags: string[],
): string[] {
  const tags: string[] = [];

  if (
    availableTags.includes("FIRST_AUTHOR") &&
    (author.position === "first" || author.sequence === "first")
  ) {
    tags.push("FIRST_AUTHOR");
  }

  if (availableTags.includes("CORRESPONDING_AUTHOR") && author.isCorresponding) {
    tags.push("CORRESPONDING_AUTHOR");
  }

  return tags;
}

function buildExternalContributorData(
  author: PublicationLookupAuthor,
  fields: AchievementFieldConfig[] | null,
): Record<string, unknown> {
  const defaults = applyAchievementFieldDefaults(fields ?? [], {});
  const next: Record<string, unknown> = {
    ...defaults,
    name: author.name,
    affiliation: author.affiliations[0] ?? "",
  };

  const fieldKeys = new Set((fields ?? []).map((field) => field.key));
  if (fieldKeys.has("scope")) {
    next.scope =
      author.institutionCountry &&
      author.institutionCountry.toUpperCase() !== "IN"
        ? "International"
        : "National";
  }
  if (fieldKeys.has("orcid") && author.orcid) {
    next.orcid = author.orcid;
  }

  return next;
}

export function isPublicationLikeAchievementForm(
  fields: AchievementFieldConfig[],
): boolean {
  const keys = new Set(fields.map((field) => field.key));
  const hasDoi = keys.has("doi");
  const hasPublicationTarget = PUBLICATION_MANAGED_FIELD_KEYS.some(
    (key) => key !== "doi" && keys.has(key),
  );

  return hasDoi && hasPublicationTarget;
}

export function applyPublicationLookupToFormData(input: {
  fields: AchievementFieldConfig[];
  currentValues: Record<string, unknown>;
  lookup: PublicationLookupResult;
}): PublicationLookupApplyResult {
  const fieldMap = getFieldMap(input.fields);
  const nextFormData: Record<string, unknown> = {
    ...input.currentValues,
    [PUBLICATION_LOOKUP_HIDDEN_KEY]: {
      ...input.lookup.meta,
      authors: input.lookup.authors,
    } satisfies PublicationLookupStoredData,
  };

  const visibleManagedFieldKeys = getVisibleManagedFieldKeys(input.fields);
  const visibleFilledFieldKeys: PublicationManagedFieldKey[] = [];

  for (const key of visibleManagedFieldKeys) {
    const field = fieldMap.get(key);
    const rawValue = input.lookup.fields[key];
    if (!field || rawValue == null) {
      continue;
    }

    const coercedValue = coercePublicationFieldValue(field, rawValue);
    if (coercedValue === undefined) {
      continue;
    }

    nextFormData[key] = coercedValue;
    visibleFilledFieldKeys.push(key);
  }

  const visibleMissingFieldKeys = visibleManagedFieldKeys.filter(
    (key) => !visibleFilledFieldKeys.includes(key),
  );

  return {
    formData: nextFormData,
    visibleFilledFieldKeys,
    visibleMissingFieldKeys,
    publicationDateNote:
      visibleManagedFieldKeys.includes("publicationDate") &&
      typeof input.lookup.meta.rawPublicationDate === "string" &&
      input.lookup.meta.rawPublicationDate.trim().length > 0 &&
      !isFullPublicationDate(input.lookup.meta.rawPublicationDate)
        ? "Publication year/month found from DOI; enter the exact date manually."
        : null,
  };
}

export function buildPublicationLookupFeedbackMessage(input: {
  filledCount: number;
  missingCount: number;
}): string {
  if (input.missingCount > 0) {
    return `Auto-filled ${input.filledCount} fields; ${input.missingCount} still need manual entry.`;
  }
  return `Auto-filled ${input.filledCount} fields from DOI metadata.`;
}

export function getPublicationAuthorPreview(
  authors: PublicationLookupAuthor[],
  expanded: boolean,
  limit = 20,
) {
  const visibleAuthors = expanded ? authors : authors.slice(0, limit);
  return {
    visibleAuthors,
    hiddenCount: expanded ? 0 : Math.max(authors.length - limit, 0),
    isTruncated: authors.length > limit,
  };
}

export function buildPublicationContributorPrefill(input: {
  authors: PublicationLookupAuthor[];
  users: PublicationLookupUser[];
  submissionConfig: AchievementSubmissionConfig;
}): PublicationContributorPrefillResult {
  const warnings: string[] = [];
  const contributors: PublicationContributorDraft[] = [];
  const roles = input.submissionConfig.applicableRoles;
  const defaultRole = getDefaultRole(roles);
  const matchedUserIds = new Set<string>();
  const normalizedUsers = input.users.map((user) => ({
    ...user,
    normalizedName: normalizePublicationPersonName(
      `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim(),
    ),
  }));

  let matchedInternalCount = 0;
  let externalCount = 0;
  let skippedExternalCount = 0;

  for (const author of input.authors) {
    const normalizedAuthorName = normalizePublicationPersonName(author.name);
    const matchedUser =
      normalizedAuthorName.length > 0
        ? normalizedUsers.find((user) => user.normalizedName === normalizedAuthorName) ?? null
        : null;
    const contributorRoleId = pickContributorRoleId(author, roles);
    const selectorTags = buildSelectorTags(
      author,
      input.submissionConfig.contributorSelectorTags,
    );

    if (matchedUser?.id) {
      if (matchedUserIds.has(matchedUser.id)) {
        warnings.push(`Skipped duplicate author match for ${author.name}.`);
        continue;
      }

      matchedUserIds.add(matchedUser.id);
      matchedInternalCount += 1;
      contributors.push({
        id: makeDraftId(),
        type: "INTERNAL",
        userId: matchedUser.id,
        contributorRoleId: contributorRoleId || defaultRole?.id || "",
        creditPercent: input.submissionConfig.manualCreditEntryEnabled
          ? String(
              roles.find((role) => role.id === contributorRoleId)?.defaultCreditPercent ??
                defaultRole?.defaultCreditPercent ??
                "",
            )
          : "",
        selectorTags,
        note: "",
        externalData: {},
      });
      continue;
    }

    if (!input.submissionConfig.allowExternalContributors) {
      skippedExternalCount += 1;
      warnings.push(
        `Skipped ${author.name} because this KPI does not allow external contributors.`,
      );
      continue;
    }

    externalCount += 1;
    contributors.push({
      id: makeDraftId(),
      type: "EXTERNAL",
      userId: null,
      contributorRoleId: contributorRoleId || defaultRole?.id || "",
      creditPercent: input.submissionConfig.manualCreditEntryEnabled
        ? String(
            roles.find((role) => role.id === contributorRoleId)?.defaultCreditPercent ??
              defaultRole?.defaultCreditPercent ??
              "",
          )
        : "",
      selectorTags,
      note: "",
      externalData: buildExternalContributorData(
        author,
        input.submissionConfig.externalContributorFields,
      ),
    });
  }

  return {
    contributors,
    matchedInternalCount,
    externalCount,
    skippedExternalCount,
    warnings,
  };
}
