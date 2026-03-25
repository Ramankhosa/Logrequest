import { Prisma, type ContributorType, type ExternalContributorScope } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ensureApplicableRolesBaseline } from "./contributor-role-service";
import { validateExternalData } from "./external-contrib-template-service";
import { getEffectiveConfig } from "./kpi-contributor-config-service";
import type { AchievementContributorView, KraKpiActionResult } from "./shared";

export const achievementContributorInputSchema = z.object({
  type: z.enum(["INTERNAL", "EXTERNAL"]).default("INTERNAL"),
  userId: z.string().trim().min(1).optional(),
  externalName: z.string().trim().min(1).max(200).optional(),
  externalAffiliation: z.string().trim().min(1).max(200).optional(),
  externalScope: z.enum(["NATIONAL", "INTERNATIONAL"]).optional(),
  externalData: z.record(z.string(), z.unknown()).optional(),
  contributorRoleId: z.string().trim().min(1),
  selectorTags: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  isExcludedFromReward: z.boolean().default(false),
  note: z.string().trim().max(1000).optional(),
});

export type AchievementContributorInput = z.input<typeof achievementContributorInputSchema>;

type DbClient = Prisma.TransactionClient | typeof prisma;

type ApplicableRoleRecord = {
  contributorRoleId: string;
  isDefault: boolean;
  contributorRole: {
    id: string;
    tenantId: string;
    code: string;
    name: string;
    defaultCreditPercent: number;
    isActive: boolean;
  };
};

type PreparedContributor = {
  type: ContributorType;
  userId: string | null;
  externalName: string | null;
  externalAffiliation: string | null;
  externalScope: ExternalContributorScope | null;
  externalData: Record<string, unknown> | null;
  contributorRoleId: string;
  selectorTags: string[];
  creditPercent: number;
  isExcludedFromReward: boolean;
  note: string | null;
  roleName: string;
};

type ContributorMutationSuccess = {
  ok: true;
  contributors: PreparedContributor[];
  shadowContributionRole: string | null;
  shadowCreditPercent: number | null;
  isTeamAchievement: boolean;
};

type ContributorMutationFailure = {
  ok: false;
  message: string;
  code: string;
};

type ContributorMutationResult = ContributorMutationSuccess | ContributorMutationFailure;

export const achievementContributorInclude = {
  user: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
    },
  },
  contributorRole: {
    select: {
      id: true,
      name: true,
    },
  },
} satisfies Prisma.AchievementContributorInclude;

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function pickShadowUserId(input: {
  reportedByUserId: string;
  oboReportedForUserId?: string | null;
}): string {
  return input.oboReportedForUserId ?? input.reportedByUserId;
}

function normalizeExternalScope(scope: string | null | undefined): ExternalContributorScope | null {
  if (scope === "NATIONAL" || scope === "INTERNATIONAL") {
    return scope;
  }
  return null;
}

function normalizeRoleToken(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function scopeLabel(scope: ExternalContributorScope | null): string | undefined {
  if (scope === "NATIONAL") return "National";
  if (scope === "INTERNATIONAL") return "International";
  return undefined;
}

function computeCredits(
  contributors: Array<{
    isExcludedFromReward: boolean;
    contributorRoleId: string;
    roleName: string;
    defaultCreditPercent: number;
  }>,
  creditSumMode: "MUST_EQUAL_100" | "MAX_100" | "UNCAPPED",
): number[] {
  if (contributors.length === 0) {
    return [];
  }

  if (creditSumMode === "UNCAPPED") {
    return contributors.map((row) =>
      row.isExcludedFromReward ? 0 : round2(row.defaultCreditPercent),
    );
  }

  const includedIndexes = contributors
    .map((row, index) => ({ row, index }))
    .filter((entry) => !entry.row.isExcludedFromReward);

  if (includedIndexes.length === 0) {
    return contributors.map(() => 0);
  }

  const totalDefaults = includedIndexes.reduce(
    (sum, entry) => sum + entry.row.defaultCreditPercent,
    0,
  );

  const credits = contributors.map(() => 0);
  if (totalDefaults <= 0) {
    const evenShare = round2(100 / includedIndexes.length);
    let consumed = 0;
    for (const [position, entry] of includedIndexes.entries()) {
      const value =
        position === includedIndexes.length - 1
          ? round2(100 - consumed)
          : evenShare;
      credits[entry.index] = value;
      consumed += value;
    }
    return credits;
  }

  let consumed = 0;
  for (const [position, entry] of includedIndexes.entries()) {
    const scaled =
      position === includedIndexes.length - 1
        ? round2(100 - consumed)
        : round2((entry.row.defaultCreditPercent / totalDefaults) * 100);
    credits[entry.index] = scaled;
    consumed += scaled;
  }

  return credits;
}

async function getApplicableRoleMap(
  kpiDefinitionId: string,
  tenantId: string,
  legacyContributionRoles: unknown,
  tx: DbClient,
): Promise<Map<string, ApplicableRoleRecord>> {
  await ensureApplicableRolesBaseline(
    kpiDefinitionId,
    tenantId,
    legacyContributionRoles,
    tx,
  );

  const links = await tx.kpiApplicableRole.findMany({
    where: { kpiDefinitionId },
    include: {
      contributorRole: {
        select: {
          id: true,
          tenantId: true,
          code: true,
          name: true,
          defaultCreditPercent: true,
          isActive: true,
        },
      },
    },
    orderBy: [{ sortOrder: "asc" }, { contributorRole: { name: "asc" } }],
  });

  return new Map(links.map((link) => [link.contributorRoleId, link]));
}

async function getDefaultApplicableRole(
  kpiDefinitionId: string,
  tenantId: string,
  legacyContributionRoles: unknown,
  tx: DbClient,
): Promise<ApplicableRoleRecord> {
  const roleMap = await getApplicableRoleMap(
    kpiDefinitionId,
    tenantId,
    legacyContributionRoles,
    tx,
  );
  const defaultRole = [...roleMap.values()].find((row) => row.isDefault);
  if (!defaultRole) {
    throw new Error(`No default applicable contributor role found for KPI ${kpiDefinitionId}.`);
  }
  return defaultRole;
}

export async function buildStarterContributorInputs(input: {
  tenantId: string;
  kpiDefinitionId: string;
  legacyContributionRoles?: unknown;
  userId: string;
  preferredRoleName?: string | null;
  tx?: DbClient;
}): Promise<AchievementContributorInput[]> {
  const tx = input.tx ?? prisma;
  const applicableRoles = await getApplicableRoleMap(
    input.kpiDefinitionId,
    input.tenantId,
    input.legacyContributionRoles ?? null,
    tx,
  );

  const preferredRole =
    input.preferredRoleName != null
      ? [...applicableRoles.values()].find(
          (row) =>
            row.contributorRole.isActive &&
            (
              row.contributorRole.name.localeCompare(input.preferredRoleName!, undefined, {
                sensitivity: "accent",
              }) === 0
              || normalizeRoleToken(row.contributorRole.name)
                === normalizeRoleToken(input.preferredRoleName!)
              || normalizeRoleToken(row.contributorRole.code)
                === normalizeRoleToken(input.preferredRoleName!)
            ),
        )
      : null;
  const fallbackRole =
    preferredRole ??
    [...applicableRoles.values()].find((row) => row.isDefault && row.contributorRole.isActive) ??
    [...applicableRoles.values()].find((row) => row.contributorRole.isActive);

  if (!fallbackRole) {
    throw new Error(`No active applicable contributor role found for KPI ${input.kpiDefinitionId}.`);
  }

  return [
    {
      type: "INTERNAL",
      userId: input.userId,
      contributorRoleId: fallbackRole.contributorRoleId,
      isExcludedFromReward: false,
    },
  ];
}

async function prepareContributors(input: {
  tenantId: string;
  kpiDefinitionId: string;
  legacyContributionRoles?: unknown;
  reportedByUserId: string;
  oboReportedForUserId?: string | null;
  contributors: AchievementContributorInput[];
  tx: DbClient;
}): Promise<ContributorMutationResult> {
  const parsed = z.array(achievementContributorInputSchema).safeParse(input.contributors);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid contributor input.",
      code: "CONTRIBUTOR_NOT_FOUND",
    };
  }

  const contributors = parsed.data;
  const roleMap = await getApplicableRoleMap(
    input.kpiDefinitionId,
    input.tenantId,
    input.legacyContributionRoles ?? null,
    input.tx,
  );
  const effectiveConfig = await getEffectiveConfig(input.kpiDefinitionId, input.tenantId);
  if (!effectiveConfig) {
    return {
      ok: false,
      message: "KPI contributor configuration not found.",
      code: "KPI_NOT_FOUND",
    };
  }

  const seenInternalUserIds = new Set<string>();
  const preparedBase: Array<
    Omit<PreparedContributor, "creditPercent"> & { defaultCreditPercent: number }
  > = [];

  for (const contributor of contributors) {
    const applicableRole = roleMap.get(contributor.contributorRoleId);
    if (!applicableRole || !applicableRole.contributorRole.isActive) {
      return {
        ok: false,
        message: "Contributor role is not an active applicable role for this KPI.",
        code: "CONTRIBUTOR_ROLE_NOT_APPLICABLE",
      };
    }

    if (contributor.type === "INTERNAL") {
      if (!contributor.userId) {
        return {
          ok: false,
          message: "Internal contributors must include a user.",
          code: "CONTRIBUTOR_NOT_FOUND",
        };
      }
      if (seenInternalUserIds.has(contributor.userId)) {
        return {
          ok: false,
          message: "The same internal contributor cannot be added twice.",
          code: "CONTRIBUTOR_DUPLICATE_USER",
        };
      }
      const membership = await input.tx.membership.findFirst({
        where: {
          tenantId: input.tenantId,
          userId: contributor.userId,
        },
        select: { userId: true },
      });
      if (!membership) {
        return {
          ok: false,
          message: "Selected internal contributor was not found in this tenant.",
          code: "CONTRIBUTOR_NOT_FOUND",
        };
      }
      seenInternalUserIds.add(contributor.userId);
      preparedBase.push({
        type: "INTERNAL",
        userId: contributor.userId,
        externalName: null,
        externalAffiliation: null,
        externalScope: null,
        externalData: null,
        contributorRoleId: contributor.contributorRoleId,
        selectorTags: contributor.selectorTags ?? [],
        isExcludedFromReward: contributor.isExcludedFromReward,
        note: contributor.note ?? null,
        roleName: applicableRole.contributorRole.name,
        defaultCreditPercent: applicableRole.contributorRole.defaultCreditPercent,
      });
      continue;
    }

    if (!effectiveConfig.allowExternalContributors) {
      return {
        ok: false,
        message: "External contributors are not allowed for this KPI.",
        code: "CONTRIBUTOR_EXTERNAL_NOT_ALLOWED",
      };
    }

    if (!contributor.externalName || !contributor.externalAffiliation) {
      return {
        ok: false,
        message: "External contributors must include name and affiliation.",
        code: "CONTRIBUTOR_EXTERNAL_NOT_ALLOWED",
      };
    }

    if (effectiveConfig.externalContribTemplateId) {
      const validation = await validateExternalData(
        effectiveConfig.externalContribTemplateId,
        input.tenantId,
        {
          ...(contributor.externalData ?? {}),
          name: contributor.externalName,
          affiliation: contributor.externalAffiliation,
          ...(scopeLabel(normalizeExternalScope(contributor.externalScope)) != null
            ? { scope: scopeLabel(normalizeExternalScope(contributor.externalScope)) }
            : {}),
        },
      );
      if (!validation.valid) {
        return {
          ok: false,
          message: validation.errors[0] ?? "Invalid external contributor details.",
          code: "CONTRIBUTOR_EXTERNAL_NOT_ALLOWED",
        };
      }
    }

    preparedBase.push({
      type: "EXTERNAL",
      userId: null,
      externalName: contributor.externalName,
      externalAffiliation: contributor.externalAffiliation,
      externalScope: normalizeExternalScope(contributor.externalScope),
      externalData: (contributor.externalData as Record<string, unknown> | undefined) ?? null,
      contributorRoleId: contributor.contributorRoleId,
      selectorTags: contributor.selectorTags ?? [],
      isExcludedFromReward: contributor.isExcludedFromReward,
      note: contributor.note ?? null,
      roleName: applicableRole.contributorRole.name,
      defaultCreditPercent: applicableRole.contributorRole.defaultCreditPercent,
    });
  }

  const credits = computeCredits(
    preparedBase.map((row) => ({
      isExcludedFromReward: row.isExcludedFromReward,
      contributorRoleId: row.contributorRoleId,
      roleName: row.roleName,
      defaultCreditPercent: row.defaultCreditPercent,
    })),
    effectiveConfig.creditSumMode,
  );

  const prepared = preparedBase.map((row, index) => ({
    type: row.type,
    userId: row.userId,
    externalName: row.externalName,
    externalAffiliation: row.externalAffiliation,
    externalScope: row.externalScope,
    externalData: row.externalData,
    contributorRoleId: row.contributorRoleId,
    selectorTags: row.selectorTags,
    creditPercent: credits[index] ?? 0,
    isExcludedFromReward: row.isExcludedFromReward,
    note: row.note,
    roleName: row.roleName,
  }));

  const shadowUserId = pickShadowUserId({
    reportedByUserId: input.reportedByUserId,
    oboReportedForUserId: input.oboReportedForUserId,
  });
  const shadowContributor =
    prepared.find((row) => row.type === "INTERNAL" && row.userId === shadowUserId) ?? null;

  return {
    ok: true,
    contributors: prepared,
    shadowContributionRole: shadowContributor?.roleName ?? null,
    shadowCreditPercent: shadowContributor?.creditPercent ?? null,
    isTeamAchievement: prepared.length > 1,
  };
}

export async function setAchievementContributors(input: {
  achievementId: string;
  tenantId: string;
  kpiDefinitionId: string;
  legacyContributionRoles?: unknown;
  reportedByUserId: string;
  oboReportedForUserId?: string | null;
  contributors: AchievementContributorInput[];
  tx?: DbClient;
}): Promise<ContributorMutationResult> {
  const tx = input.tx ?? prisma;
  const prepared = await prepareContributors({
    tenantId: input.tenantId,
    kpiDefinitionId: input.kpiDefinitionId,
    legacyContributionRoles: input.legacyContributionRoles,
    reportedByUserId: input.reportedByUserId,
    oboReportedForUserId: input.oboReportedForUserId,
    contributors: input.contributors,
    tx,
  });

  if (!prepared.ok) {
    return prepared;
  }

  await tx.achievementContributor.deleteMany({
    where: { achievementId: input.achievementId },
  });

  if (prepared.contributors.length > 0) {
    await tx.achievementContributor.createMany({
      data: prepared.contributors.map((row) => ({
        achievementId: input.achievementId,
        type: row.type,
        userId: row.userId,
        externalName: row.externalName,
        externalAffiliation: row.externalAffiliation,
        externalScope: row.externalScope,
        externalData: row.externalData as Prisma.InputJsonValue | undefined,
        contributorRoleId: row.contributorRoleId,
        selectorTags: row.selectorTags,
        creditPercent: row.creditPercent,
        isExcludedFromReward: row.isExcludedFromReward,
        note: row.note,
      })),
    });
  }

  await tx.achievement.update({
    where: { id: input.achievementId },
    data: {
      contributionRole: prepared.shadowContributionRole,
      creditPercent: prepared.shadowCreditPercent,
      isTeamAchievement: prepared.isTeamAchievement,
    },
  });

  return prepared;
}

export async function ensureAchievementContributorRows(input: {
  achievementId: string;
  tenantId: string;
  kpiDefinitionId: string;
  legacyContributionRoles?: unknown;
  reportedByUserId: string;
  oboReportedForUserId?: string | null;
  contributionRole?: string | null;
  tx?: DbClient;
}): Promise<ContributorMutationResult> {
  const tx = input.tx ?? prisma;
  const existingCount = await tx.achievementContributor.count({
    where: { achievementId: input.achievementId },
  });
  if (existingCount > 0) {
    const rows = await tx.achievementContributor.findMany({
      where: { achievementId: input.achievementId },
      include: {
        contributorRole: {
          select: {
            name: true,
          },
        },
      },
    });
    const shadowUserId = pickShadowUserId({
      reportedByUserId: input.reportedByUserId,
      oboReportedForUserId: input.oboReportedForUserId,
    });
    const shadowRow =
      rows.find((row) => row.type === "INTERNAL" && row.userId === shadowUserId) ?? null;
    return {
      ok: true,
      contributors: rows.map((row) => ({
        type: row.type,
        userId: row.userId,
        externalName: row.externalName,
        externalAffiliation: row.externalAffiliation,
        externalScope: row.externalScope,
        externalData: (row.externalData as Record<string, unknown> | null) ?? null,
        contributorRoleId: row.contributorRoleId,
        selectorTags: row.selectorTags,
        creditPercent: row.creditPercent,
        isExcludedFromReward: row.isExcludedFromReward,
        note: row.note,
        roleName: row.contributorRole.name,
      })),
      shadowContributionRole: shadowRow?.contributorRole.name ?? null,
      shadowCreditPercent: shadowRow?.creditPercent ?? null,
      isTeamAchievement: rows.length > 1,
    };
  }

  const shadowUserId = pickShadowUserId({
    reportedByUserId: input.reportedByUserId,
    oboReportedForUserId: input.oboReportedForUserId,
  });
  const starter = await buildStarterContributorInputs({
    tenantId: input.tenantId,
    kpiDefinitionId: input.kpiDefinitionId,
    legacyContributionRoles: input.legacyContributionRoles,
    userId: shadowUserId,
    preferredRoleName: input.contributionRole,
    tx,
  });

  return setAchievementContributors({
    achievementId: input.achievementId,
    tenantId: input.tenantId,
    kpiDefinitionId: input.kpiDefinitionId,
    legacyContributionRoles: input.legacyContributionRoles,
    reportedByUserId: input.reportedByUserId,
    oboReportedForUserId: input.oboReportedForUserId,
    contributors: starter,
    tx,
  });
}

export async function getDefaultApplicableRoleId(input: {
  tenantId: string;
  kpiDefinitionId: string;
  legacyContributionRoles?: unknown;
  tx?: DbClient;
}): Promise<string> {
  const tx = input.tx ?? prisma;
  const role = await getDefaultApplicableRole(
    input.kpiDefinitionId,
    input.tenantId,
    input.legacyContributionRoles ?? null,
    tx,
  );
  return role.contributorRoleId;
}

export function mapAchievementContributors(
  contributors: Array<{
    id: string;
    type: ContributorType;
    userId: string | null;
    externalName: string | null;
    externalAffiliation: string | null;
    externalScope: ExternalContributorScope | null;
    externalData: Prisma.JsonValue;
    contributorRoleId: string;
    selectorTags: string[];
    creditPercent: number;
    isExcludedFromReward: boolean;
    note: string | null;
    user?: { id: string; firstName: string; lastName: string } | null;
    contributorRole?: { id: string; name: string } | null;
  }>,
): AchievementContributorView[] {
  return contributors.map((row) => ({
    id: row.id,
    type: row.type,
    userId: row.userId,
    userName: row.user
      ? `${row.user.firstName} ${row.user.lastName}`.trim()
      : null,
    externalName: row.externalName,
    externalAffiliation: row.externalAffiliation,
    externalScope: row.externalScope,
    externalData: (row.externalData as Record<string, unknown> | null) ?? null,
    contributorRoleId: row.contributorRoleId,
    roleName: row.contributorRole?.name ?? "Unknown",
    selectorTags: row.selectorTags ?? [],
    creditPercent: row.creditPercent,
    isExcludedFromReward: row.isExcludedFromReward,
    note: row.note,
  }));
}

export function contributorMutationToActionResult(
  result: ContributorMutationResult,
): KraKpiActionResult | null {
  if (result.ok) return null;
  return {
    status: "error",
    message: result.message,
    code: result.code,
  };
}
