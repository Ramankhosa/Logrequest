import {
  GALGOTIA_AUTO_DERIVED_SHARE_TEMPLATE_KEYS,
  GALGOTIA_AUTO_EXCLUDE_EXTERNAL_TEMPLATE_KEYS,
  GALGOTIA_EDP_MDP_TEMPLATE_KEY,
  GALGOTIA_EQUAL_SPLIT_TEMPLATE_KEYS,
  GALGOTIA_JOURNAL_TEMPLATE_KEY,
  GALGOTIA_PHD_TEMPLATE_KEY,
  GALGOTIA_RESEARCH_GRANT_TEMPLATE_KEY,
} from "./galgotia-template-constants";

export type GalgotiaContributorType = "INTERNAL" | "EXTERNAL";

export type GalgotiaContributorPolicyInput = {
  type?: GalgotiaContributorType | null;
  userId?: string | null;
  contributorRoleId?: string | null;
  roleCode?: string | null;
  selectorTags?: string[] | null;
  creditPercent?: number | null;
  isExcludedFromReward?: boolean | null;
};

export type GalgotiaContributorPolicyOutput = {
  type: GalgotiaContributorType;
  userId: string | null;
  contributorRoleId: string | null;
  roleCode: string | null;
  selectorTags: string[];
  creditPercent: number;
  isExcludedFromReward: boolean;
  exclusionReason: string | null;
  rewardBucket: string | null;
};

export type GalgotiaRewardNormalizationResult = {
  isAutoCalculated: boolean;
  normalizedFormData: Record<string, unknown>;
  normalizedContributors: GalgotiaContributorPolicyOutput[];
  derivedAuthorshipCase: string | null;
  warnings: string[];
  errors: string[];
  rationale: string[];
};

type PrimarySecondarySplitInput = {
  contributors: GalgotiaContributorPolicyOutput[];
  primaryRoleCode: string;
  secondaryRoleCode: string;
  primaryLabel: string;
  secondaryLabel: string;
};

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeToken(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isInternalContributor(input: GalgotiaContributorPolicyInput): boolean {
  if (input.type === "INTERNAL") return true;
  if (input.type === "EXTERNAL") return false;
  return typeof input.userId === "string" && input.userId.trim().length > 0;
}

function matchesRoleCode(
  contributor: Pick<GalgotiaContributorPolicyOutput, "roleCode" | "selectorTags">,
  roleCode: string,
): boolean {
  const normalizedRoleCode = normalizeToken(roleCode);
  if (normalizeToken(contributor.roleCode) === normalizedRoleCode) {
    return true;
  }
  return contributor.selectorTags.some((tag) => normalizeToken(tag) === normalizedRoleCode);
}

function buildEvenShares(indexes: number[], totalPercent: number): number[] {
  if (indexes.length === 0 || totalPercent <= 0) {
    return [];
  }

  const shares = indexes.map(() => 0);
  let consumed = 0;
  const step = round2(totalPercent / indexes.length);
  for (const [offset] of indexes.entries()) {
    shares[offset] =
      offset === indexes.length - 1
        ? round2(totalPercent - consumed)
        : step;
    consumed += shares[offset] ?? 0;
  }

  return shares;
}

function assignPoolShares(
  credits: number[],
  contributors: GalgotiaContributorPolicyOutput[],
  input: { sharePercent: number; rewardBucket: string; matches: (row: GalgotiaContributorPolicyOutput) => boolean },
) {
  const indexes = contributors
    .map((contributor, index) => ({ contributor, index }))
    .filter((entry) => !entry.contributor.isExcludedFromReward && input.matches(entry.contributor))
    .map((entry) => entry.index);

  const shares = buildEvenShares(indexes, input.sharePercent);
  for (const [offset, index] of indexes.entries()) {
    credits[index] = round2((credits[index] ?? 0) + (shares[offset] ?? 0));
    contributors[index] = {
      ...contributors[index]!,
      rewardBucket: input.rewardBucket,
    };
  }
}

function countPositiveCredits(credits: number[]): number {
  return credits.filter((value) => value > 0).length;
}

function deriveJournalCase(
  contributors: GalgotiaContributorPolicyOutput[],
  formData: Record<string, unknown>,
): {
  caseCode: string | null;
  credits: number[];
  warnings: string[];
  errors: string[];
  rationale: string[];
} {
  const warnings: string[] = [];
  const errors: string[] = [];
  const rationale: string[] = [];

  const eligibleInternal = contributors
    .map((contributor, index) => ({ contributor, index }))
    .filter(
      (entry) =>
        entry.contributor.type === "INTERNAL" &&
        !entry.contributor.isExcludedFromReward,
    );

  const internalIndexes = eligibleInternal.map((entry) => entry.index);
  const firstIndexes = eligibleInternal
    .filter((entry) => matchesRoleCode(entry.contributor, "FIRST_AUTHOR"))
    .map((entry) => entry.index);
  const correspondingIndexes = eligibleInternal
    .filter((entry) => matchesRoleCode(entry.contributor, "CORRESPONDING_AUTHOR"))
    .map((entry) => entry.index);
  const coAuthorIndexes = eligibleInternal
    .filter((entry) => matchesRoleCode(entry.contributor, "CO_AUTHOR"))
    .map((entry) => entry.index);

  const totalAuthors =
    typeof formData.totalAuthors === "number"
      ? formData.totalAuthors
      : typeof formData.totalAuthors === "string" && formData.totalAuthors.trim().length > 0
        ? Number(formData.totalAuthors)
        : null;
  const guAuthorsCount =
    typeof formData.guAuthorsCount === "number"
      ? formData.guAuthorsCount
      : typeof formData.guAuthorsCount === "string" && formData.guAuthorsCount.trim().length > 0
        ? Number(formData.guAuthorsCount)
        : null;

  if (Number.isFinite(totalAuthors) && totalAuthors != null && totalAuthors < contributors.length) {
    warnings.push("Total authors is lower than the number of contributor rows in the form.");
  }
  if (Number.isFinite(totalAuthors) && Number.isFinite(guAuthorsCount) && totalAuthors! < guAuthorsCount!) {
    warnings.push("Total authors is lower than the declared number of internal Galgotias authors.");
  }
  if (Number.isFinite(guAuthorsCount) && guAuthorsCount != null && guAuthorsCount !== internalIndexes.length) {
    warnings.push(
      `Declared internal Galgotias authors (${guAuthorsCount}) does not match the ${internalIndexes.length} internal contributor rows.`,
    );
  }

  rationale.push(`Internal contributors considered for payout: ${internalIndexes.length}`);
  rationale.push(`Internal first authors: ${firstIndexes.length}`);
  rationale.push(`Internal corresponding authors: ${correspondingIndexes.length}`);
  rationale.push(`Internal co-authors: ${coAuthorIndexes.length}`);

  if (internalIndexes.length === 0) {
    errors.push("Add at least one internal Galgotias contributor before reward allocation can be derived.");
    return {
      caseCode: null,
      credits: contributors.map(() => 0),
      warnings,
      errors,
      rationale,
    };
  }

  const hasFirst = firstIndexes.length > 0;
  const hasCorresponding = correspondingIndexes.length > 0;
  const hasCoAuthor = coAuthorIndexes.length > 0;
  const credits = contributors.map(() => 0);

  if (hasFirst && hasCorresponding && hasCoAuthor) {
    assignPoolShares(credits, contributors, {
      sharePercent: 35,
      rewardBucket: "FIRST_AUTHOR",
      matches: (row) => matchesRoleCode(row, "FIRST_AUTHOR"),
    });
    assignPoolShares(credits, contributors, {
      sharePercent: 35,
      rewardBucket: "CORRESPONDING_AUTHOR",
      matches: (row) => matchesRoleCode(row, "CORRESPONDING_AUTHOR"),
    });
    assignPoolShares(credits, contributors, {
      sharePercent: 30,
      rewardBucket: "CO_AUTHOR",
      matches: (row) => matchesRoleCode(row, "CO_AUTHOR"),
    });
    return { caseCode: "CASE_1", credits, warnings, errors, rationale };
  }

  if (hasFirst && hasCorresponding && !hasCoAuthor) {
    assignPoolShares(credits, contributors, {
      sharePercent: 50,
      rewardBucket: "FIRST_AUTHOR",
      matches: (row) => matchesRoleCode(row, "FIRST_AUTHOR"),
    });
    assignPoolShares(credits, contributors, {
      sharePercent: 50,
      rewardBucket: "CORRESPONDING_AUTHOR",
      matches: (row) => matchesRoleCode(row, "CORRESPONDING_AUTHOR"),
    });
    return { caseCode: "CASE_2", credits, warnings, errors, rationale };
  }

  if ((hasFirst || hasCorresponding) && hasCoAuthor) {
    const leadRoleCode = hasFirst ? "FIRST_AUTHOR" : "CORRESPONDING_AUTHOR";
    assignPoolShares(credits, contributors, {
      sharePercent: 60,
      rewardBucket: leadRoleCode,
      matches: (row) => matchesRoleCode(row, leadRoleCode),
    });
    assignPoolShares(credits, contributors, {
      sharePercent: 40,
      rewardBucket: "CO_AUTHOR",
      matches: (row) => matchesRoleCode(row, "CO_AUTHOR"),
    });
    return { caseCode: "CASE_3", credits, warnings, errors, rationale };
  }

  if (hasFirst || hasCorresponding) {
    const leadRoleCode = hasFirst ? "FIRST_AUTHOR" : "CORRESPONDING_AUTHOR";
    assignPoolShares(credits, contributors, {
      sharePercent: 100,
      rewardBucket: leadRoleCode,
      matches: (row) => matchesRoleCode(row, leadRoleCode),
    });
    return { caseCode: "CASE_4", credits, warnings, errors, rationale };
  }

  if (hasCoAuthor) {
    assignPoolShares(credits, contributors, {
      sharePercent: 100,
      rewardBucket: "CO_AUTHOR",
      matches: (row) => matchesRoleCode(row, "CO_AUTHOR"),
    });
    return { caseCode: "CASE_5", credits, warnings, errors, rationale };
  }

  errors.push(
    "The journal authorship case could not be derived. Assign FIRST_AUTHOR, CORRESPONDING_AUTHOR, or CO_AUTHOR roles to the internal contributors.",
  );
  return { caseCode: null, credits, warnings, errors, rationale };
}

function derivePrimarySecondaryCredits(
  input: PrimarySecondarySplitInput,
): { credits: number[]; warnings: string[]; rationale: string[] } {
  const credits = input.contributors.map(() => 0);
  const warnings: string[] = [];
  const rationale: string[] = [];

  const eligibleIndexes = input.contributors
    .map((contributor, index) => ({ contributor, index }))
    .filter((entry) => !entry.contributor.isExcludedFromReward)
    .map((entry) => entry.index);
  const primaryIndexes = input.contributors
    .map((contributor, index) => ({ contributor, index }))
    .filter(
      (entry) =>
        !entry.contributor.isExcludedFromReward &&
        matchesRoleCode(entry.contributor, input.primaryRoleCode),
    )
    .map((entry) => entry.index);
  const secondaryIndexes = input.contributors
    .map((contributor, index) => ({ contributor, index }))
    .filter(
      (entry) =>
        !entry.contributor.isExcludedFromReward &&
        matchesRoleCode(entry.contributor, input.secondaryRoleCode),
    )
    .map((entry) => entry.index);

  rationale.push(`${input.primaryLabel}: ${primaryIndexes.length}`);
  rationale.push(`${input.secondaryLabel}: ${secondaryIndexes.length}`);

  if (eligibleIndexes.length === 1) {
    credits[eligibleIndexes[0]!] = 100;
    return { credits, warnings, rationale };
  }

  if (primaryIndexes.length > 0 && secondaryIndexes.length === 0) {
    warnings.push(`No ${input.secondaryLabel.toLowerCase()} found, so the ${input.primaryLabel.toLowerCase()} pool receives the full reward.`);
    assignPoolShares(credits, input.contributors, {
      sharePercent: 100,
      rewardBucket: input.primaryRoleCode,
      matches: (row) => matchesRoleCode(row, input.primaryRoleCode),
    });
    return { credits, warnings, rationale };
  }

  if (primaryIndexes.length === 0 && secondaryIndexes.length > 0) {
    warnings.push(`No ${input.primaryLabel.toLowerCase()} found, so the ${input.secondaryLabel.toLowerCase()} pool receives the full reward.`);
    assignPoolShares(credits, input.contributors, {
      sharePercent: 100,
      rewardBucket: input.secondaryRoleCode,
      matches: (row) => matchesRoleCode(row, input.secondaryRoleCode),
    });
    return { credits, warnings, rationale };
  }

  assignPoolShares(credits, input.contributors, {
    sharePercent: 60,
    rewardBucket: input.primaryRoleCode,
    matches: (row) => matchesRoleCode(row, input.primaryRoleCode),
  });
  assignPoolShares(credits, input.contributors, {
    sharePercent: 40,
    rewardBucket: input.secondaryRoleCode,
    matches: (row) => matchesRoleCode(row, input.secondaryRoleCode),
  });
  return { credits, warnings, rationale };
}

function deriveEqualSplitCredits(
  contributors: GalgotiaContributorPolicyOutput[],
): { credits: number[]; rationale: string[] } {
  const credits = contributors.map(() => 0);
  const eligibleIndexes = contributors
    .map((contributor, index) => ({ contributor, index }))
    .filter((entry) => !entry.contributor.isExcludedFromReward)
    .map((entry) => entry.index);
  const shares = buildEvenShares(eligibleIndexes, 100);
  for (const [offset, index] of eligibleIndexes.entries()) {
    credits[index] = shares[offset] ?? 0;
    contributors[index] = {
      ...contributors[index]!,
      rewardBucket: "EQUAL_SPLIT",
    };
  }

  return {
    credits,
    rationale: [`Eligible contributors sharing reward equally: ${eligibleIndexes.length}`],
  };
}

export function isGalgotiaAutoCalculatedTemplate(templateKey: string | null | undefined): boolean {
  return typeof templateKey === "string" && GALGOTIA_AUTO_DERIVED_SHARE_TEMPLATE_KEYS.has(templateKey);
}

export function normalizeGalgotiaRewardData(input: {
  templateKey: string | null | undefined;
  formData?: Record<string, unknown> | null | undefined;
  contributors: GalgotiaContributorPolicyInput[];
}): GalgotiaRewardNormalizationResult {
  const templateKey = input.templateKey ?? null;
  const formData = { ...(input.formData ?? {}) };
  const isAutoCalculated = isGalgotiaAutoCalculatedTemplate(templateKey);

  const normalizedContributors = input.contributors.map((contributor) => {
    const type = isInternalContributor(contributor) ? "INTERNAL" : "EXTERNAL";
    const autoExcludeExternal =
      templateKey != null &&
      GALGOTIA_AUTO_EXCLUDE_EXTERNAL_TEMPLATE_KEYS.has(templateKey) &&
      type === "EXTERNAL";

    return {
      type,
      userId: contributor.userId ?? null,
      contributorRoleId: contributor.contributorRoleId ?? null,
      roleCode: contributor.roleCode ?? null,
      selectorTags: contributor.selectorTags ?? [],
      creditPercent: round2(contributor.creditPercent ?? 0),
      isExcludedFromReward: Boolean(contributor.isExcludedFromReward) || autoExcludeExternal,
      exclusionReason: autoExcludeExternal
        ? "External contributors are recorded for authorship history but excluded from the Galgotias payout."
        : contributor.isExcludedFromReward
          ? "Contributor is marked as excluded from reward."
          : null,
      rewardBucket: null,
    } satisfies GalgotiaContributorPolicyOutput;
  });

  if (!isAutoCalculated) {
    return {
      isAutoCalculated,
      normalizedFormData: formData,
      normalizedContributors,
      derivedAuthorshipCase:
        typeof formData.authorshipCase === "string" ? formData.authorshipCase : null,
      warnings: [],
      errors: [],
      rationale: [],
    };
  }

  let warnings: string[] = [];
  let errors: string[] = [];
  let rationale: string[] = [];
  let credits = normalizedContributors.map((contributor) => contributor.creditPercent);
  let derivedAuthorshipCase: string | null = null;

  if (templateKey === GALGOTIA_JOURNAL_TEMPLATE_KEY) {
    const journal = deriveJournalCase(normalizedContributors, formData);
    derivedAuthorshipCase = journal.caseCode;
    credits = journal.credits;
    warnings = journal.warnings;
    errors = journal.errors;
    rationale = journal.rationale;
    if (journal.caseCode) {
      formData.authorshipCase = journal.caseCode;
    }
  } else if (templateKey === GALGOTIA_PHD_TEMPLATE_KEY) {
    const phd = derivePrimarySecondaryCredits({
      contributors: normalizedContributors,
      primaryRoleCode: "SUPERVISOR",
      secondaryRoleCode: "CO_SUPERVISOR",
      primaryLabel: "Supervisor",
      secondaryLabel: "Co-supervisor",
    });
    credits = phd.credits;
    warnings = phd.warnings;
    rationale = phd.rationale;
  } else if (templateKey === GALGOTIA_RESEARCH_GRANT_TEMPLATE_KEY) {
    const grant = derivePrimarySecondaryCredits({
      contributors: normalizedContributors,
      primaryRoleCode: "PI",
      secondaryRoleCode: "CO_PI",
      primaryLabel: "PI",
      secondaryLabel: "Co-PI",
    });
    credits = grant.credits;
    warnings = grant.warnings;
    rationale = grant.rationale;
  } else if (
    GALGOTIA_EQUAL_SPLIT_TEMPLATE_KEYS.has(templateKey ?? "") ||
    templateKey === GALGOTIA_EDP_MDP_TEMPLATE_KEY
  ) {
    const equal = deriveEqualSplitCredits(normalizedContributors);
    credits = equal.credits;
    rationale = equal.rationale;
  }

  if (countPositiveCredits(credits) === 0 && normalizedContributors.some((row) => !row.isExcludedFromReward)) {
    errors = [
      ...errors,
      "No reward-eligible contributor could be resolved from the selected Galgotias roles.",
    ];
  }

  return {
    isAutoCalculated,
    normalizedFormData: formData,
    normalizedContributors: normalizedContributors.map((contributor, index) => ({
      ...contributor,
      creditPercent: credits[index] ?? 0,
    })),
    derivedAuthorshipCase,
    warnings,
    errors,
    rationale,
  };
}
