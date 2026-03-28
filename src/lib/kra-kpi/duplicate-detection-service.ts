import { prisma } from "@/lib/prisma";
import {
  GALGOTIA_BOOK_CHAPTER_TEMPLATE_KEY,
  GALGOTIA_EDITED_BOOK_TEMPLATE_KEY,
} from "./galgotia-template-constants";
import { getEffectiveConfig } from "./kpi-contributor-config-service";
import type { AchievementFormConfig, DuplicateCheckResult, DuplicateMatch } from "./shared";

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bigrams(value: string): string[] {
  if (value.length < 2) return [value];
  const grams: string[] = [];
  for (let index = 0; index < value.length - 1; index += 1) {
    grams.push(value.slice(index, index + 2));
  }
  return grams;
}

function diceCoefficient(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;

  const leftBigrams = bigrams(left);
  const rightBigrams = bigrams(right);
  const rightCounts = new Map<string, number>();
  for (const gram of rightBigrams) {
    rightCounts.set(gram, (rightCounts.get(gram) ?? 0) + 1);
  }

  let matches = 0;
  for (const gram of leftBigrams) {
    const count = rightCounts.get(gram) ?? 0;
    if (count > 0) {
      matches += 1;
      rightCounts.set(gram, count - 1);
    }
  }

  return (2 * matches) / (leftBigrams.length + rightBigrams.length);
}

function extractConfiguredFieldKeys(
  formConfig: AchievementFormConfig | null,
  duplicateCheckFields: string[],
): string[] {
  if (duplicateCheckFields.length > 0) {
    return duplicateCheckFields;
  }

  return (formConfig?.fields ?? [])
    .filter((field) => field.marker === "UNIQUE_CHECK")
    .map((field) => field.key);
}

function stringifyMatchValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

export async function runDuplicateDetection(input: {
  tenantId: string;
  periodId: string;
  kpiDefinitionId: string;
  achievementId?: string;
  achievementTitle?: string | null;
  achievementFormData?: Record<string, unknown> | null;
  formConfig?: AchievementFormConfig | null;
  contributorUserIds?: string[];
}): Promise<DuplicateCheckResult> {
  const effectiveConfig = await getEffectiveConfig(input.kpiDefinitionId, input.tenantId);
  const duplicateFieldKeys = extractConfiguredFieldKeys(
    input.formConfig ?? null,
    effectiveConfig?.duplicateCheckFields ?? [],
  );

  const exactChecks = duplicateFieldKeys
    .map((fieldKey) => ({
      fieldKey,
      submittedValue: stringifyMatchValue(input.achievementFormData?.[fieldKey]),
    }))
    .filter((entry): entry is { fieldKey: string; submittedValue: string } => Boolean(entry.submittedValue))
    .map((entry) => ({
      fieldKey: entry.fieldKey,
      submittedValue: normalizeText(entry.submittedValue),
      originalValue: entry.submittedValue,
    }));

  const normalizedTitle = normalizeText(input.achievementTitle ?? "");

  if (exactChecks.length === 0 && normalizedTitle.length === 0) {
    return {
      checked: true,
      hasDuplicates: false,
      matches: [],
    };
  }

  const achievements = await prisma.achievement.findMany({
    where: {
      tenantId: input.tenantId,
      kpiDefinitionId: input.kpiDefinitionId,
      ...(input.achievementId ? { id: { not: input.achievementId } } : {}),
    },
    select: {
      id: true,
      periodId: true,
      state: true,
      title: true,
      achievementFormData: true,
      reportedByUserId: true,
    },
  });

  const reporterIds = [...new Set(achievements.map((achievement) => achievement.reportedByUserId))];
  const reporters =
    reporterIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: reporterIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
  const reporterNameMap = new Map(
    reporters.map((reporter) => [reporter.id, `${reporter.firstName} ${reporter.lastName}`.trim()]),
  );

  const matches: DuplicateMatch[] = [];

  for (const achievement of achievements) {
    const existingFormData =
      (achievement.achievementFormData as Record<string, unknown> | null) ?? {};

    for (const check of exactChecks) {
      const existingValue = stringifyMatchValue(existingFormData[check.fieldKey]);
      if (!existingValue) continue;
      if (normalizeText(existingValue) !== check.submittedValue) continue;

      matches.push({
        achievementId: achievement.id,
        matchedField: check.fieldKey,
        matchedValue: check.originalValue,
        reportedByName: reporterNameMap.get(achievement.reportedByUserId) ?? "Unknown",
        reportedByUserId: achievement.reportedByUserId,
        sameReporter: false,
        achievementState: achievement.state,
        achievementTitle: achievement.title,
        periodId: achievement.periodId,
        samePeriod: achievement.periodId === input.periodId,
        similarity: "EXACT",
      });
    }

    if (normalizedTitle.length > 0 && achievement.periodId === input.periodId) {
      const existingTitle = normalizeText(achievement.title ?? "");
      if (!existingTitle) continue;
      const similarity = diceCoefficient(normalizedTitle, existingTitle);
      if (similarity >= 0.72) {
        matches.push({
          achievementId: achievement.id,
          matchedField: "title",
          matchedValue: achievement.title ?? "",
          reportedByName: reporterNameMap.get(achievement.reportedByUserId) ?? "Unknown",
          reportedByUserId: achievement.reportedByUserId,
          sameReporter: false,
          achievementState: achievement.state,
          achievementTitle: achievement.title,
          periodId: achievement.periodId,
          samePeriod: true,
          similarity: "FUZZY",
        });
      }
    }
  }

  const templateKey = input.formConfig?.templateKey ?? null;
  const pairedTemplateKey =
    templateKey === GALGOTIA_EDITED_BOOK_TEMPLATE_KEY
      ? GALGOTIA_BOOK_CHAPTER_TEMPLATE_KEY
      : templateKey === GALGOTIA_BOOK_CHAPTER_TEMPLATE_KEY
        ? GALGOTIA_EDITED_BOOK_TEMPLATE_KEY
        : null;
  const normalizedIsbn = normalizeText(
    stringifyMatchValue(input.achievementFormData?.isbn) ?? "",
  );
  const contributorUserIds = [...new Set((input.contributorUserIds ?? []).filter(Boolean))];

  if (pairedTemplateKey && normalizedIsbn && contributorUserIds.length > 0) {
    const crossTemplateAchievements = await prisma.achievement.findMany({
      where: {
        tenantId: input.tenantId,
        ...(input.achievementId ? { id: { not: input.achievementId } } : {}),
        contributors: {
          some: {
            type: "INTERNAL",
            userId: { in: contributorUserIds },
          },
        },
      },
      select: {
        id: true,
        periodId: true,
        state: true,
        title: true,
        reportedByUserId: true,
        achievementFormData: true,
        kpiDefinition: {
          select: {
            title: true,
            achievementFormConfig: true,
          },
        },
        contributors: {
          select: {
            type: true,
            userId: true,
          },
        },
      },
    });

    for (const achievement of crossTemplateAchievements) {
      const otherTemplateKey =
        achievement.kpiDefinition.achievementFormConfig &&
        typeof achievement.kpiDefinition.achievementFormConfig === "object" &&
        "templateKey" in achievement.kpiDefinition.achievementFormConfig &&
        typeof achievement.kpiDefinition.achievementFormConfig.templateKey === "string"
          ? achievement.kpiDefinition.achievementFormConfig.templateKey
          : null;
      if (otherTemplateKey !== pairedTemplateKey) continue;

      const otherFormData =
        (achievement.achievementFormData as Record<string, unknown> | null) ?? {};
      const otherIsbn = normalizeText(stringifyMatchValue(otherFormData.isbn) ?? "");
      if (!otherIsbn || otherIsbn !== normalizedIsbn) continue;

      const overlappingUserIds = achievement.contributors
        .filter(
          (contributor) =>
            contributor.type === "INTERNAL"
            && contributor.userId != null
            && contributorUserIds.includes(contributor.userId),
        )
        .map((contributor) => contributor.userId!)
        .sort();
      if (overlappingUserIds.length === 0) continue;

      matches.push({
        achievementId: achievement.id,
        matchedField: "isbn",
        matchedValue: stringifyMatchValue(input.achievementFormData?.isbn) ?? "",
        reportedByName: reporterNameMap.get(achievement.reportedByUserId) ?? "Unknown",
        reportedByUserId: achievement.reportedByUserId,
        sameReporter: false,
        achievementState: achievement.state,
        achievementTitle: achievement.title,
        periodId: achievement.periodId,
        samePeriod: achievement.periodId === input.periodId,
        similarity: "EXACT",
        matchType: "POLICY_WARNING",
        note:
          "Same contributor already has a related edited-book or chapter claim for this ISBN. Reviewer must enforce the Rs. 20,000 same-book combined limit manually.",
        relatedKpiTitle: achievement.kpiDefinition.title,
      });
    }
  }

  const deduped = new Map<string, DuplicateMatch>();
  for (const match of matches) {
    const key = `${match.achievementId}:${match.matchedField}:${match.similarity}:${match.matchType ?? "DUPLICATE"}`;
    if (!deduped.has(key)) {
      deduped.set(key, match);
    }
  }

  return {
    checked: true,
    hasDuplicates: deduped.size > 0,
    matches: [...deduped.values()],
  };
}
