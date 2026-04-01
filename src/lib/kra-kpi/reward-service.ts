import { Prisma, type Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  rewardPreviewInputSchema,
  type RewardPreviewInput,
} from "./builder-shared";
import { enrichPublicationJournalFormData } from "./publication-journal-service";

type RewardContributor = {
  id: string | null;
  userId: string | null;
  contributorRoleId: string | null;
  creditPercent: number;
  isExcludedFromReward: boolean;
  selectorTags: string[];
};

type RewardTierRuleRow = {
  source: string;
  operator: string;
  fieldKey: string | null;
  systemMetricKey: string | null;
  value: unknown;
  sortOrder: number;
};

type RewardTierRow = {
  id: string;
  tierSetKey: string;
  code: string;
  name: string;
  priority: number;
  matchMode: "HIGHEST_MATCH" | "MANUAL_SELECT";
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  isActive: boolean;
  rules: RewardTierRuleRow[];
};

type RewardDistributionRow = {
  id: string;
  contributorRoleId: string | null;
  selectorType: "ROLE" | "SELECTOR_TAG" | "REMAINDER" | "ALL_CONTRIBUTORS";
  selectorTag: string | null;
  sharePercent: number | null;
  fixedAmount: number | null;
  splitMode: "EQUAL" | "FULL_TO_MATCHED" | null;
  sortOrder: number;
};

type RewardComponentRow = {
  id: string;
  rewardTierId: string | null;
  code: string;
  name: string;
  trigger: "FINAL_VERIFY" | "MANUAL" | "STAGE_COMPLETE";
  amountMode:
    | "FIXED_VALUE"
    | "FIXED_POOL"
    | "FIXED_PER_PERSON"
    | "PERCENT_OF_FIELD"
    | "PER_UNIT"
    | "PERCENT_OF_SCORE";
  amountValue: number | null;
  amountFieldKey: string | null;
  distributionMode:
    | "DIRECT_OWNER"
    | "ROLE_PERCENT_SPLIT"
    | "FIXED_PER_PERSON"
    | "EQUAL_SPLIT"
    | "CREDIT_PERCENT_SPLIT"
    | "LEAD_ONLY";
  singleEligibleHandling: "FULL_TO_SINGLE" | "KEEP_CONFIGURED_SPLIT" | "ERROR";
  emptyShareHandling: "ROLLOVER_TO_MATCHED" | "DROP_UNALLOCATED" | "ERROR";
  sortOrder: number;
  benefitType: {
    id: string;
    code: string;
    name: string;
    unit: string;
    precision: number;
    roundingMode: string;
  };
  distributions: RewardDistributionRow[];
};

type RewardConfig = {
  tenantId: string;
  periodId: string;
  kpiDefinitionId: string;
  title: string;
  rewardRecurrencePolicy:
    | "RECURRING"
    | "ONCE_PER_PERIOD"
    | "ONCE_PER_KPI_LIFETIME"
    | "ONCE_PER_UNIQUE_KEY";
  policyDateFieldKey: string | null;
  duplicateCheckFields: string[];
  rewardTiers: RewardTierRow[];
  rewardComponents: RewardComponentRow[];
};

type RecurrenceEvaluation = {
  recurrenceKey: string | null;
  globalReason: string | null;
  blockedUserIds: Set<string>;
};

type RawAllocation = {
  contributor: RewardContributor;
  amount: number;
  source: string;
};

type FinalAllocation = {
  contributor: RewardContributor;
  rawAmount: number;
  amount: number;
  blocked: boolean;
  reason: string | null;
  source: string;
  roundingAdjustment: number;
};

type RewardResolutionComponent = {
  component: RewardComponentRow;
  matchedTier: RewardTierRow | null;
  baseAmount: number;
  fallbackApplied: string | null;
  roundingApplied: number;
  allocations: FinalAllocation[];
};

type RewardResolution = {
  policyDate: Date;
  recurrenceKey: string | null;
  matchedTiers: RewardTierRow[];
  components: RewardResolutionComponent[];
};

type PersistableRewardRow = {
  achievementContributorId: string | null;
  contributorUserId: string | null;
  benefitTypeId: string;
  rewardTierId: string | null;
  rewardComponentId: string;
  baseAmount: number;
  finalAmount: number;
  roundingAdjustment: number;
  recurrenceKey: string | null;
  idempotencyKey: string;
  explanation: Prisma.InputJsonValue;
};

type UnitSnapshot = {
  unitId: string | null;
  unitName: string | null;
  unitPath: string | null;
  unitTypeKey: string | null;
};

type LoadedAchievementRewardContext = {
  achievement: {
    id: string;
    tenantId: string;
    periodId: string;
    kpiDefinitionId: string;
    reportedByUserId: string;
    actualValue: number | null;
    actualDate: Date | null;
    computedScore: number | null;
    effectiveScore: number | null;
    reportingDate: Date;
    achievementFormData: Record<string, unknown>;
    contributors: Array<{
      id: string;
      userId: string | null;
      contributorRoleId: string | null;
      creditPercent: number;
      isExcludedFromReward: boolean;
      selectorTags: string[];
    }>;
  };
  config: RewardConfig;
  resolution: RewardResolution;
  rows: PersistableRewardRow[];
  userSnapshots: Map<string, UnitSnapshot>;
};

const ACTIVE_REWARD_STATES: Array<"DRAFT" | "PENDING" | "RELEASED"> = [
  "DRAFT",
  "PENDING",
  "RELEASED",
];
const REWARD_REVISION_DELIMITER = "::r";

export type RewardPreviewResult = {
  policyDate: string | null;
  recurrencePolicy: RewardConfig["rewardRecurrencePolicy"];
  recurrenceKey: string | null;
  matchedTiers: Array<{
    tierSetKey: string;
    code: string;
    name: string;
    effectiveFrom: string | null;
    effectiveTo: string | null;
  }>;
  components: Array<{
    componentId: string;
    componentCode: string;
    componentName: string;
    benefitTypeCode: string;
    benefitTypeName: string;
    unit: string;
    matchedTierCode: string | null;
    baseAmount: number;
    totalAmount: number;
    blockedCount: number;
    fallbackApplied: string | null;
    roundingApplied: number;
    contributors: Array<{
      contributorId: string | null;
      userId: string | null;
      contributorRoleId: string | null;
      selectorTags: string[];
      amount: number;
      blocked: boolean;
      reason: string | null;
    }>;
  }>;
  totalsByBenefit: Array<{
    benefitTypeCode: string;
    totalAmount: number;
  }>;
};

function extractBaseRewardKey(idempotencyKey: string): string {
  const markerIndex = idempotencyKey.indexOf(REWARD_REVISION_DELIMITER);
  return markerIndex >= 0 ? idempotencyKey.slice(0, markerIndex) : idempotencyKey;
}

function nextRewardRevisionKey(baseKey: string, existingKeys: string[]): string {
  const revisions = existingKeys
    .filter((value) => extractBaseRewardKey(value) === baseKey)
    .map((value) => {
      const markerIndex = value.indexOf(REWARD_REVISION_DELIMITER);
      if (markerIndex < 0) return 1;
      const raw = value.slice(markerIndex + REWARD_REVISION_DELIMITER.length);
      const parsed = Number(raw);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    });
  const nextRevision = revisions.length > 0 ? Math.max(...revisions) + 1 : 2;
  return `${baseKey}${REWARD_REVISION_DELIMITER}${nextRevision}`;
}

function rewardRowsEquivalent(
  reward: {
    achievementContributorId: string | null;
    contributorUserId: string | null;
    benefitTypeId: string;
    rewardTierId: string | null;
    rewardComponentId: string;
    baseAmount: number;
    finalAmount: number;
    roundingAdjustment: number;
    recurrenceKey: string | null;
  },
  row: PersistableRewardRow,
): boolean {
  return (
    reward.achievementContributorId === row.achievementContributorId &&
    reward.contributorUserId === row.contributorUserId &&
    reward.benefitTypeId === row.benefitTypeId &&
    reward.rewardTierId === row.rewardTierId &&
    reward.rewardComponentId === row.rewardComponentId &&
    reward.baseAmount === row.baseAmount &&
    reward.finalAmount === row.finalAmount &&
    reward.roundingAdjustment === row.roundingAdjustment &&
    reward.recurrenceKey === row.recurrenceKey
  );
}

async function loadPublishedVersionId(tenantId: string): Promise<string | null> {
  const version = await prisma.orgStructureVersion.findFirst({
    where: {
      tenantId,
      state: { in: ["PUBLISHED", "VALIDATED"] },
    },
    orderBy: [{ versionNumber: "desc" }, { createdAt: "desc" }],
    select: { id: true },
  });
  return version?.id ?? null;
}

async function loadUserUnitSnapshots(
  tenantId: string,
  userIds: string[],
): Promise<Map<string, UnitSnapshot>> {
  const distinctUserIds = [...new Set(userIds.filter((value) => value.trim().length > 0))];
  if (distinctUserIds.length === 0) return new Map();

  const versionId = await loadPublishedVersionId(tenantId);
  if (!versionId) return new Map();

  const assignments = await prisma.userOrgAssignment.findMany({
    where: {
      versionId,
      userId: { in: distinctUserIds },
    },
    orderBy: [{ isPrimary: "desc" }, { updatedAt: "desc" }],
    select: {
      userId: true,
      unit: {
        select: {
          id: true,
          name: true,
          path: true,
          type: {
            select: {
              typeKey: true,
            },
          },
        },
      },
    },
  });

  const snapshots = new Map<string, UnitSnapshot>();
  for (const assignment of assignments) {
    if (snapshots.has(assignment.userId)) continue;
    snapshots.set(assignment.userId, {
      unitId: assignment.unit.id,
      unitName: assignment.unit.name,
      unitPath: assignment.unit.path ?? null,
      unitTypeKey: assignment.unit.type.typeKey,
    });
  }

  return snapshots;
}

async function appendContributorRewardEvent(
  tx: Prisma.TransactionClient,
  input: {
    rewardId: string;
    tenantId: string;
    actorUserId?: string | null;
    actorRole?: Role | null;
    action: string;
    fromState?: "DRAFT" | "PENDING" | "RELEASED" | "REVOKED" | null;
    toState?: "DRAFT" | "PENDING" | "RELEASED" | "REVOKED" | null;
    note?: string | null;
    metadata?: Prisma.InputJsonValue;
  },
) {
  await tx.contributorRewardEvent.create({
    data: {
      rewardId: input.rewardId,
      tenantId: input.tenantId,
      actorUserId: input.actorUserId ?? null,
      actorRole: input.actorRole ?? null,
      action: input.action,
      fromState: input.fromState ?? null,
      toState: input.toState ?? null,
      note: input.note ?? null,
      metadata: input.metadata,
    },
  });
}

function buildRewardCreateData(
  tenantId: string,
  achievement: LoadedAchievementRewardContext["achievement"],
  row: PersistableRewardRow,
  snapshots: {
    reporter: UnitSnapshot | null;
    owner: UnitSnapshot | null;
  },
  idempotencyKey: string,
  options?: {
    supersedesRewardId?: string | null;
  },
) {
  return {
    tenantId,
    periodId: achievement.periodId,
    kpiDefinitionId: achievement.kpiDefinitionId,
    achievementId: achievement.id,
    achievementContributorId: row.achievementContributorId,
    contributorUserId: row.contributorUserId,
    benefitTypeId: row.benefitTypeId,
    rewardTierId: row.rewardTierId,
    rewardComponentId: row.rewardComponentId,
    recurrenceKey: row.recurrenceKey,
    state: "DRAFT" as const,
    baseAmount: row.baseAmount,
    finalAmount: row.finalAmount,
    roundingAdjustment: row.roundingAdjustment,
    idempotencyKey,
    explanation: row.explanation,
    rewardOwnerUnitId: snapshots.owner?.unitId ?? null,
    rewardOwnerUnitName: snapshots.owner?.unitName ?? null,
    rewardOwnerUnitPath: snapshots.owner?.unitPath ?? null,
    rewardOwnerUnitTypeKey: snapshots.owner?.unitTypeKey ?? null,
    reporterUnitId: snapshots.reporter?.unitId ?? null,
    reporterUnitName: snapshots.reporter?.unitName ?? null,
    reporterUnitPath: snapshots.reporter?.unitPath ?? null,
    reporterUnitTypeKey: snapshots.reporter?.unitTypeKey ?? null,
    supersedesRewardId: options?.supersedesRewardId ?? null,
  };
}

function buildRewardReplacementMatchKey(input: {
  achievementContributorId: string | null;
  contributorUserId: string | null;
  benefitTypeId: string;
}): string {
  return [
    input.benefitTypeId,
    input.achievementContributorId ?? "no-contributor-row",
    input.contributorUserId ?? "no-user",
  ].join(":");
}

function parseInput(input: RewardPreviewInput): RewardPreviewInput {
  const parsed = rewardPreviewInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid reward preview input.");
  }
  return parsed.data;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function parseDateLike(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function coerceNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  const leftDate = parseDateLike(left);
  const rightDate = parseDateLike(right);
  if (leftDate || rightDate) {
    return leftDate?.toISOString() === rightDate?.toISOString();
  }
  return left === right;
}

function arrayify(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function roundValue(value: number, precision: number, roundingMode: string): number {
  const factor = 10 ** precision;
  switch (roundingMode) {
    case "UP":
      return Math.ceil(value * factor) / factor;
    case "DOWN":
      return Math.floor(value * factor) / factor;
    case "HALF_UP":
    default:
      return Math.round((value + Number.EPSILON) * factor) / factor;
  }
}

function resolvePolicyDate(config: RewardConfig, input: RewardPreviewInput): Date {
  const fromField = config.policyDateFieldKey
    ? parseDateLike(input.achievementFormData[config.policyDateFieldKey])
    : null;
  return fromField ?? input.actualDate ?? input.reportingDate ?? new Date();
}

function resolveRuleSourceValue(rule: RewardTierRuleRow, input: RewardPreviewInput): unknown {
  switch (rule.source) {
    case "FORM_FIELD":
      return rule.fieldKey ? input.achievementFormData[rule.fieldKey] : undefined;
    case "ACTUAL_VALUE":
      return input.actualValue;
    case "COMPUTED_SCORE":
      return input.computedScore;
    case "EFFECTIVE_SCORE":
      return input.effectiveScore;
    case "SYSTEM_METRIC":
      return rule.systemMetricKey ? input.systemMetrics[rule.systemMetricKey] : undefined;
    case "TEAM_SIZE":
      return input.contributors.length;
    case "MANUAL_SELECTION":
      return input.manualTierCode;
    case "CONTRIBUTOR_TAG":
      return [...new Set(input.contributors.flatMap((contributor) => contributor.selectorTags ?? []))];
    case "CONTRIBUTOR_COUNT":
      return input.contributors.filter((contributor) => !contributor.isExcludedFromReward).length;
    default:
      return undefined;
  }
}

function evaluateOperator(left: unknown, operator: string, right: unknown): boolean {
  switch (operator) {
    case "eq":
      return valuesEqual(left, right);
    case "neq":
      return !valuesEqual(left, right);
    case "gt":
      return (coerceNumber(left) ?? Number.NEGATIVE_INFINITY) >
        (coerceNumber(right) ?? Number.POSITIVE_INFINITY);
    case "gte":
      return (coerceNumber(left) ?? Number.NEGATIVE_INFINITY) >=
        (coerceNumber(right) ?? Number.POSITIVE_INFINITY);
    case "lt":
      return (coerceNumber(left) ?? Number.POSITIVE_INFINITY) <
        (coerceNumber(right) ?? Number.NEGATIVE_INFINITY);
    case "lte":
      return (coerceNumber(left) ?? Number.POSITIVE_INFINITY) <=
        (coerceNumber(right) ?? Number.NEGATIVE_INFINITY);
    case "contains":
      if (typeof left === "string" && typeof right === "string") return left.includes(right);
      if (Array.isArray(left)) return left.some((value) => valuesEqual(value, right));
      return false;
    case "not_contains":
      return !evaluateOperator(left, "contains", right);
    case "in":
      return arrayify(right).some((value) => valuesEqual(left, value));
    case "not_in":
      return !evaluateOperator(left, "in", right);
    case "has_any": {
      const leftValues = arrayify(left);
      return arrayify(right).some((value) =>
        leftValues.some((leftValue) => valuesEqual(leftValue, value)),
      );
    }
    case "has_all": {
      const leftValues = arrayify(left);
      return arrayify(right).every((value) =>
        leftValues.some((leftValue) => valuesEqual(leftValue, value)),
      );
    }
    default:
      return false;
  }
}

function buildRecurrenceKey(config: RewardConfig, input: RewardPreviewInput): string | null {
  if (config.rewardRecurrencePolicy !== "ONCE_PER_UNIQUE_KEY") return null;
  const entries = config.duplicateCheckFields
    .map((fieldKey) => [fieldKey, input.achievementFormData[fieldKey]] as const)
    .filter(([, value]) => value != null && `${value}`.trim().length > 0)
    .map(([fieldKey, value]) => `${fieldKey}=${String(value).trim()}`);
  return entries.length > 0 ? entries.join("|") : null;
}

function isDateWithinWindow(
  value: Date,
  effectiveFrom: Date | null,
  effectiveTo: Date | null,
): boolean {
  if (effectiveFrom && value < effectiveFrom) return false;
  if (effectiveTo && value > effectiveTo) return false;
  return true;
}

function normalizeContributors(contributors: RewardPreviewInput["contributors"]): RewardContributor[] {
  return contributors.map((contributor) => ({
    id: contributor.id ?? null,
    userId: contributor.userId ?? null,
    contributorRoleId: contributor.contributorRoleId ?? null,
    creditPercent: contributor.creditPercent ?? 0,
    isExcludedFromReward: contributor.isExcludedFromReward ?? false,
    selectorTags: contributor.selectorTags ?? [],
  }));
}

function contributorKey(contributor: RewardContributor): string {
  return contributor.id ?? contributor.userId ?? `anon:${contributor.selectorTags.join(",")}:${contributor.contributorRoleId ?? "none"}`;
}

function getEligibleContributors(contributors: RewardContributor[]): RewardContributor[] {
  return contributors.filter((contributor) => !contributor.isExcludedFromReward);
}

function matchesDistributionSelector(
  selector: RewardDistributionRow,
  contributor: RewardContributor,
): boolean {
  switch (selector.selectorType) {
    case "ROLE":
      return (
        selector.contributorRoleId != null &&
        contributor.contributorRoleId === selector.contributorRoleId
      );
    case "SELECTOR_TAG":
      return selector.selectorTag != null && contributor.selectorTags.includes(selector.selectorTag);
    case "ALL_CONTRIBUTORS":
      return true;
    default:
      return false;
  }
}

function buildTierMatches(
  config: RewardConfig,
  input: RewardPreviewInput,
  policyDate: Date,
): RewardTierRow[] {
  const tierSets = new Map<string, RewardTierRow[]>();
  for (const tier of config.rewardTiers) {
    if (!tier.isActive) continue;
    if (!isDateWithinWindow(policyDate, tier.effectiveFrom, tier.effectiveTo)) continue;
    const current = tierSets.get(tier.tierSetKey) ?? [];
    current.push(tier);
    tierSets.set(tier.tierSetKey, current);
  }

  const matched: RewardTierRow[] = [];
  for (const tiers of tierSets.values()) {
    const manualMatches = tiers
      .filter((tier) => tier.matchMode === "MANUAL_SELECT")
      .filter((tier) => input.manualTierCode != null && tier.code === input.manualTierCode);
    if (manualMatches.length > 0) {
      manualMatches.sort((left, right) => left.priority - right.priority || left.code.localeCompare(right.code));
      matched.push(manualMatches[0]);
      continue;
    }

    const autoMatches = tiers.filter((tier) =>
      tier.rules
        .slice()
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .every((rule) =>
          evaluateOperator(resolveRuleSourceValue(rule, input), rule.operator, rule.value),
        ),
    );
    if (autoMatches.length === 0) continue;
    autoMatches.sort((left, right) => left.priority - right.priority || left.code.localeCompare(right.code));
    matched.push(autoMatches[0]);
  }

  return matched;
}

async function loadRewardConfig(
  kpiDefinitionId: string,
  tenantId: string,
): Promise<RewardConfig | null> {
  const row = await prisma.kpiDefinition.findFirst({
    where: { id: kpiDefinitionId, kraDefinition: { tenantId } },
    select: {
      id: true,
      title: true,
      rewardRecurrencePolicy: true,
      policyDateFieldKey: true,
      kraDefinition: {
        select: {
          periodId: true,
        },
      },
      contributorConfig: {
        select: {
          duplicateCheckFields: true,
        },
      },
      rewardTiers: {
        where: { isActive: true },
        include: {
          rules: {
            orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
            select: {
              source: true,
              operator: true,
              fieldKey: true,
              systemMetricKey: true,
              value: true,
              sortOrder: true,
            },
          },
        },
        orderBy: [{ tierSetKey: "asc" }, { priority: "asc" }, { code: "asc" }],
      },
      rewardComponents: {
        where: { isActive: true, trigger: "FINAL_VERIFY" },
        include: {
          benefitType: {
            select: {
              id: true,
              code: true,
              name: true,
              unit: true,
              precision: true,
              roundingMode: true,
            },
          },
          distributions: {
            orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
            select: {
              id: true,
              contributorRoleId: true,
              selectorType: true,
              selectorTag: true,
              sharePercent: true,
              fixedAmount: true,
              splitMode: true,
              sortOrder: true,
            },
          },
        },
        orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      },
    },
  });

  if (!row) return null;

  return {
    tenantId,
    periodId: row.kraDefinition.periodId,
    kpiDefinitionId: row.id,
    title: row.title,
    rewardRecurrencePolicy: row.rewardRecurrencePolicy,
    policyDateFieldKey: row.policyDateFieldKey,
    duplicateCheckFields: asStringArray(row.contributorConfig?.duplicateCheckFields),
    rewardTiers: row.rewardTiers.map((tier) => ({
      id: tier.id,
      tierSetKey: tier.tierSetKey,
      code: tier.code,
      name: tier.name,
      priority: tier.priority,
      matchMode: tier.matchMode,
      effectiveFrom: tier.effectiveFrom,
      effectiveTo: tier.effectiveTo,
      isActive: tier.isActive,
      rules: tier.rules,
    })),
    rewardComponents: row.rewardComponents.map((component) => ({
      id: component.id,
      rewardTierId: component.rewardTierId,
      code: component.code,
      name: component.name,
      trigger: component.trigger,
      amountMode: component.amountMode,
      amountValue: component.amountValue,
      amountFieldKey: component.amountFieldKey,
      distributionMode: component.distributionMode,
      singleEligibleHandling: component.singleEligibleHandling,
      emptyShareHandling: component.emptyShareHandling,
      sortOrder: component.sortOrder,
      benefitType: component.benefitType,
      distributions: component.distributions.map((distribution) => ({
        id: distribution.id,
        contributorRoleId: distribution.contributorRoleId,
        selectorType: distribution.selectorType as RewardDistributionRow["selectorType"],
        selectorTag: distribution.selectorTag,
        sharePercent: distribution.sharePercent,
        fixedAmount: distribution.fixedAmount,
        splitMode: distribution.splitMode as RewardDistributionRow["splitMode"],
        sortOrder: distribution.sortOrder,
      })),
    })),
  };
}

async function evaluateRecurrence(
  config: RewardConfig,
  contributors: RewardContributor[],
  achievementId: string | undefined,
  recurrenceKey: string | null,
): Promise<RecurrenceEvaluation> {
  if (config.rewardRecurrencePolicy === "RECURRING") {
    return { recurrenceKey, globalReason: null, blockedUserIds: new Set() };
  }

  if (config.rewardRecurrencePolicy === "ONCE_PER_UNIQUE_KEY") {
    if (!recurrenceKey) {
      return {
        recurrenceKey,
        globalReason: null,
        blockedUserIds: new Set(),
      };
    }

    const count = await prisma.contributorReward.count({
      where: {
        kpiDefinitionId: config.kpiDefinitionId,
        recurrenceKey,
        state: { in: ACTIVE_REWARD_STATES },
        ...(achievementId ? { achievementId: { not: achievementId } } : {}),
      },
    });

    return {
      recurrenceKey,
      globalReason:
        count > 0
          ? "Reward already claimed for the configured unique key."
          : null,
      blockedUserIds: new Set(),
    };
  }

  const userIds = contributors
    .map((contributor) => contributor.userId)
    .filter((value): value is string => value != null);
  if (userIds.length === 0) {
    return { recurrenceKey, globalReason: null, blockedUserIds: new Set() };
  }

  const rows = await prisma.contributorReward.findMany({
    where: {
      kpiDefinitionId: config.kpiDefinitionId,
      contributorUserId: { in: userIds },
      state: { in: ACTIVE_REWARD_STATES },
      ...(config.rewardRecurrencePolicy === "ONCE_PER_PERIOD"
        ? { periodId: config.periodId }
        : {}),
      ...(achievementId ? { achievementId: { not: achievementId } } : {}),
    },
    select: {
      contributorUserId: true,
    },
  });

  return {
    recurrenceKey,
    globalReason: null,
    blockedUserIds: new Set(
      rows
        .map((row) => row.contributorUserId)
        .filter((value): value is string => value != null),
    ),
  };
}

function resolveComponentBaseAmount(
  component: RewardComponentRow,
  input: RewardPreviewInput,
  eligibleCount: number,
): number {
  const configuredAmount = component.amountValue ?? 0;
  const amountFieldValue =
    component.amountFieldKey != null
      ? coerceNumber(input.achievementFormData[component.amountFieldKey])
      : null;
  switch (component.amountMode) {
    case "FIXED_VALUE":
    case "FIXED_POOL":
      return configuredAmount;
    case "FIXED_PER_PERSON":
      return configuredAmount * eligibleCount;
    case "PERCENT_OF_FIELD": {
      const sourceValue = amountFieldValue ?? input.actualValue ?? 0;
      return sourceValue * (configuredAmount / 100);
    }
    case "PER_UNIT": {
      const sourceValue = amountFieldValue ?? input.actualValue ?? 0;
      return sourceValue * configuredAmount;
    }
    case "PERCENT_OF_SCORE": {
      const scoreValue = input.effectiveScore ?? input.computedScore ?? 0;
      return scoreValue * (configuredAmount / 100);
    }
    default:
      return 0;
  }
}

function allocateEqually(
  recipients: RewardContributor[],
  amount: number,
  source: string,
): RawAllocation[] {
  if (recipients.length === 0 || amount <= 0) return [];
  const share = amount / recipients.length;
  return recipients.map((contributor) => ({
    contributor,
    amount: share,
    source,
  }));
}

function allocateDirectOwner(
  eligible: RewardContributor[],
  baseAmount: number,
): { allocations: RawAllocation[]; fallbackApplied: string | null } {
  const recipient = eligible[0];
  if (!recipient || baseAmount <= 0) {
    return { allocations: [], fallbackApplied: null };
  }
  return {
    allocations: [{ contributor: recipient, amount: baseAmount, source: "DIRECT_OWNER" }],
    fallbackApplied: null,
  };
}

function allocateLeadOnly(
  component: RewardComponentRow,
  eligible: RewardContributor[],
  baseAmount: number,
): { allocations: RawAllocation[]; fallbackApplied: string | null } {
  if (eligible.length === 0 || baseAmount <= 0) {
    return { allocations: [], fallbackApplied: null };
  }

  const selector = component.distributions.find(
    (distribution) => distribution.selectorType !== "REMAINDER",
  );
  const recipient =
    selector != null
      ? eligible.find((contributor) => matchesDistributionSelector(selector, contributor))
      : eligible[0];

  return {
    allocations: recipient
      ? [{ contributor: recipient, amount: baseAmount, source: "LEAD_ONLY" }]
      : [],
    fallbackApplied: recipient ? null : "NO_LEAD_MATCH",
  };
}

function allocateByCredit(
  eligible: RewardContributor[],
  baseAmount: number,
): { allocations: RawAllocation[]; fallbackApplied: string | null } {
  if (eligible.length === 0 || baseAmount <= 0) {
    return { allocations: [], fallbackApplied: null };
  }

  const totalCredit = eligible.reduce(
    (sum, contributor) => sum + Math.max(contributor.creditPercent, 0),
    0,
  );
  if (totalCredit <= 0) {
    return {
      allocations: allocateEqually(eligible, baseAmount, "CREDIT_PERCENT_SPLIT_FALLBACK_EQUAL"),
      fallbackApplied: "CREDIT_ZERO_EQUAL_SPLIT",
    };
  }

  return {
    allocations: eligible.map((contributor) => ({
      contributor,
      amount: baseAmount * (Math.max(contributor.creditPercent, 0) / totalCredit),
      source: "CREDIT_PERCENT_SPLIT",
    })),
    fallbackApplied: null,
  };
}

function allocateFixedPerPerson(
  component: RewardComponentRow,
  eligible: RewardContributor[],
): { allocations: RawAllocation[]; fallbackApplied: string | null } {
  if (eligible.length === 0) {
    return { allocations: [], fallbackApplied: null };
  }

  if (component.distributions.length === 0) {
    const defaultAmount = component.amountValue ?? 0;
    return {
      allocations: eligible.map((contributor) => ({
        contributor,
        amount: defaultAmount,
        source: "FIXED_PER_PERSON_DEFAULT",
      })),
      fallbackApplied: null,
    };
  }

  const allocations: RawAllocation[] = [];
  for (const distribution of component.distributions) {
    const matched = eligible.filter((contributor) =>
      matchesDistributionSelector(distribution, contributor),
    );
    const fixedAmount = distribution.fixedAmount ?? component.amountValue ?? 0;
    for (const contributor of matched) {
      allocations.push({
        contributor,
        amount: fixedAmount,
        source: `FIXED_PER_PERSON:${distribution.selectorType}`,
      });
    }
  }
  return { allocations, fallbackApplied: null };
}

function allocateRolePercentSplit(
  component: RewardComponentRow,
  eligible: RewardContributor[],
  baseAmount: number,
): { allocations: RawAllocation[]; fallbackApplied: string | null } {
  if (eligible.length === 0 || baseAmount <= 0) {
    return { allocations: [], fallbackApplied: null };
  }

  if (eligible.length === 1 && component.singleEligibleHandling === "FULL_TO_SINGLE") {
    return {
      allocations: [{ contributor: eligible[0], amount: baseAmount, source: "FULL_TO_SINGLE" }],
      fallbackApplied: "FULL_TO_SINGLE",
    };
  }

  const distributions = component.distributions
    .slice()
    .sort((left, right) => left.sortOrder - right.sortOrder);
  if (distributions.length === 0) {
    return {
      allocations: allocateDirectOwner(eligible, baseAmount).allocations,
      fallbackApplied: "DIRECT_OWNER_FALLBACK",
    };
  }

  const matchedByKey = new Set<string>();
  const successfulGroups: Array<{
    distribution: RewardDistributionRow;
    recipients: RewardContributor[];
    amount: number;
  }> = [];
  let rolloverAmount = 0;

  for (const distribution of distributions) {
    const configuredShare = distribution.sharePercent ?? 0;
    const shareAmount = baseAmount * (configuredShare / 100);
    const recipients =
      distribution.selectorType === "REMAINDER"
        ? eligible.filter((contributor) => !matchedByKey.has(contributorKey(contributor)))
        : eligible.filter((contributor) => matchesDistributionSelector(distribution, contributor));

    if (distribution.selectorType !== "REMAINDER") {
      for (const contributor of recipients) {
        matchedByKey.add(contributorKey(contributor));
      }
    }

    if (recipients.length === 0) {
      if (component.emptyShareHandling === "ERROR") {
        return { allocations: [], fallbackApplied: "EMPTY_SELECTOR_ERROR" };
      }
      if (component.emptyShareHandling === "ROLLOVER_TO_MATCHED") {
        rolloverAmount += shareAmount;
      }
      continue;
    }

    successfulGroups.push({
      distribution,
      recipients,
      amount: shareAmount,
    });
  }

  if (successfulGroups.length === 0) {
    return { allocations: [], fallbackApplied: "NO_SUCCESSFUL_GROUPS" };
  }

  if (rolloverAmount > 0) {
    successfulGroups[0].amount += rolloverAmount;
  }

  const allocations: RawAllocation[] = [];
  for (const group of successfulGroups) {
    allocations.push(
      ...allocateEqually(
        group.recipients,
        group.amount,
        `${group.distribution.selectorType}:${group.distribution.selectorTag ?? "default"}`,
      ),
    );
  }

  return {
    allocations,
    fallbackApplied: rolloverAmount > 0 ? "ROLLOVER_TO_MATCHED" : null,
  };
}

function configLabelForRecurrence(recurrence: RecurrenceEvaluation): string {
  if (recurrence.globalReason) return recurrence.globalReason;
  return "Reward blocked by KPI recurrence policy.";
}

function computeRoundedAllocations(
  component: RewardComponentRow,
  rawAllocations: RawAllocation[],
  recurrence: RecurrenceEvaluation,
): { allocations: FinalAllocation[]; roundingApplied: number } {
  if (rawAllocations.length === 0) {
    return { allocations: [], roundingApplied: 0 };
  }

  const precision = component.benefitType.precision ?? 2;
  const roundingMode = component.benefitType.roundingMode ?? "HALF_UP";
  const roundedAllocations: FinalAllocation[] = rawAllocations.map((allocation) => {
    const blocked =
      recurrence.globalReason != null ||
      (allocation.contributor.userId != null &&
        recurrence.blockedUserIds.has(allocation.contributor.userId));
    const roundedAmount = roundValue(allocation.amount, precision, roundingMode);
    return {
      contributor: allocation.contributor,
      rawAmount: allocation.amount,
      amount: blocked ? 0 : roundedAmount,
      blocked,
      reason:
        recurrence.globalReason ??
        (allocation.contributor.userId != null &&
        recurrence.blockedUserIds.has(allocation.contributor.userId)
          ? configLabelForRecurrence(recurrence)
          : null),
      source: allocation.source,
      roundingAdjustment: blocked ? 0 : roundedAmount - allocation.amount,
    };
  });

  const unblocked = roundedAllocations.filter((allocation) => !allocation.blocked);
  if (unblocked.length === 0) {
    return { allocations: roundedAllocations, roundingApplied: 0 };
  }

  const rawTotal = rawAllocations
    .filter((allocation) => {
      if (recurrence.globalReason) return false;
      const userId = allocation.contributor.userId;
      return !(userId != null && recurrence.blockedUserIds.has(userId));
    })
    .reduce((sum, allocation) => sum + allocation.amount, 0);
  const roundedTarget = roundValue(rawTotal, precision, roundingMode);
  const roundedTotal = unblocked.reduce((sum, allocation) => sum + allocation.amount, 0);
  const difference = roundValue(roundedTarget - roundedTotal, precision, roundingMode);

  if (Math.abs(difference) > 0) {
    const lead = roundedAllocations.find((allocation) => !allocation.blocked);
    if (lead) {
      lead.amount = roundValue(lead.amount + difference, precision, roundingMode);
      lead.roundingAdjustment += difference;
    }
  }

  return {
    allocations: roundedAllocations,
    roundingApplied: difference,
  };
}

function resolveComponentAllocations(
  component: RewardComponentRow,
  eligible: RewardContributor[],
  baseAmount: number,
): { rawAllocations: RawAllocation[]; fallbackApplied: string | null } {
  switch (component.distributionMode) {
    case "DIRECT_OWNER":
      return {
        rawAllocations: allocateDirectOwner(eligible, baseAmount).allocations,
        fallbackApplied: null,
      };
    case "ROLE_PERCENT_SPLIT": {
      const result = allocateRolePercentSplit(component, eligible, baseAmount);
      return { rawAllocations: result.allocations, fallbackApplied: result.fallbackApplied };
    }
    case "FIXED_PER_PERSON": {
      const result = allocateFixedPerPerson(component, eligible);
      return { rawAllocations: result.allocations, fallbackApplied: result.fallbackApplied };
    }
    case "EQUAL_SPLIT":
      return {
        rawAllocations: allocateEqually(eligible, baseAmount, "EQUAL_SPLIT"),
        fallbackApplied: null,
      };
    case "CREDIT_PERCENT_SPLIT": {
      const result = allocateByCredit(eligible, baseAmount);
      return { rawAllocations: result.allocations, fallbackApplied: result.fallbackApplied };
    }
    case "LEAD_ONLY": {
      const result = allocateLeadOnly(component, eligible, baseAmount);
      return { rawAllocations: result.allocations, fallbackApplied: result.fallbackApplied };
    }
    default:
      return { rawAllocations: [], fallbackApplied: null };
  }
}

async function resolveRewards(
  config: RewardConfig,
  input: RewardPreviewInput,
): Promise<RewardResolution> {
  const policyDate = resolvePolicyDate(config, input);
  const recurrenceKey = buildRecurrenceKey(config, input);
  const contributors = normalizeContributors(input.contributors);
  const eligible = getEligibleContributors(contributors);
  const matchedTiers = buildTierMatches(config, input, policyDate);
  const matchedTierById = new Map(matchedTiers.map((tier) => [tier.id, tier]));
  const recurrence = await evaluateRecurrence(config, contributors, input.achievementId, recurrenceKey);

  const components: RewardResolutionComponent[] = [];
  for (const component of config.rewardComponents) {
    const matchedTier =
      component.rewardTierId != null ? (matchedTierById.get(component.rewardTierId) ?? null) : null;
    if (component.rewardTierId != null && !matchedTier) continue;

    const baseAmount = resolveComponentBaseAmount(component, input, eligible.length);
    const { rawAllocations, fallbackApplied } = resolveComponentAllocations(component, eligible, baseAmount);
    const rounded = computeRoundedAllocations(component, rawAllocations, recurrence);

    components.push({
      component,
      matchedTier,
      baseAmount,
      fallbackApplied,
      roundingApplied: rounded.roundingApplied,
      allocations: rounded.allocations,
    });
  }

  return {
    policyDate,
    recurrenceKey,
    matchedTiers,
    components,
  };
}

function buildPreviewResult(config: RewardConfig, resolution: RewardResolution): RewardPreviewResult {
  const totals = new Map<string, number>();

  const components = resolution.components.map((componentResult) => {
    const totalAmount = componentResult.allocations.reduce(
      (sum, allocation) => sum + allocation.amount,
      0,
    );
    const benefitKey = componentResult.component.benefitType.code;
    totals.set(benefitKey, (totals.get(benefitKey) ?? 0) + totalAmount);

    return {
      componentId: componentResult.component.id,
      componentCode: componentResult.component.code,
      componentName: componentResult.component.name,
      benefitTypeCode: benefitKey,
      benefitTypeName: componentResult.component.benefitType.name,
      unit: componentResult.component.benefitType.unit,
      matchedTierCode: componentResult.matchedTier?.code ?? null,
      baseAmount: componentResult.baseAmount,
      totalAmount,
      blockedCount: componentResult.allocations.filter((allocation) => allocation.blocked).length,
      fallbackApplied: componentResult.fallbackApplied,
      roundingApplied: componentResult.roundingApplied,
      contributors: componentResult.allocations.map((allocation) => ({
        contributorId: allocation.contributor.id,
        userId: allocation.contributor.userId,
        contributorRoleId: allocation.contributor.contributorRoleId,
        selectorTags: allocation.contributor.selectorTags,
        amount: allocation.amount,
        blocked: allocation.blocked,
        reason: allocation.reason,
      })),
    };
  });

  return {
    policyDate: resolution.policyDate.toISOString(),
    recurrencePolicy: config.rewardRecurrencePolicy,
    recurrenceKey: resolution.recurrenceKey,
    matchedTiers: resolution.matchedTiers.map((tier) => ({
      tierSetKey: tier.tierSetKey,
      code: tier.code,
      name: tier.name,
      effectiveFrom: tier.effectiveFrom?.toISOString() ?? null,
      effectiveTo: tier.effectiveTo?.toISOString() ?? null,
    })),
    components,
    totalsByBenefit: [...totals.entries()].map(([benefitTypeCode, totalAmount]) => ({
      benefitTypeCode,
      totalAmount,
    })),
  };
}

function buildPersistableRows(
  achievementId: string,
  config: RewardConfig,
  resolution: RewardResolution,
): PersistableRewardRow[] {
  const rows: PersistableRewardRow[] = [];
  for (const componentResult of resolution.components) {
    for (const allocation of componentResult.allocations) {
      if (allocation.blocked || allocation.amount <= 0) continue;

      const contributorIdentity =
        allocation.contributor.id ??
        allocation.contributor.userId ??
        `owner:${config.kpiDefinitionId}`;

      rows.push({
        achievementContributorId: allocation.contributor.id,
        contributorUserId: allocation.contributor.userId,
        benefitTypeId: componentResult.component.benefitType.id,
        rewardTierId: componentResult.matchedTier?.id ?? null,
        rewardComponentId: componentResult.component.id,
        baseAmount: allocation.rawAmount,
        finalAmount: allocation.amount,
        roundingAdjustment: allocation.roundingAdjustment,
        recurrenceKey: resolution.recurrenceKey,
        idempotencyKey: [achievementId, componentResult.component.id, contributorIdentity].join(":"),
        explanation: {
          policyDate: resolution.policyDate.toISOString(),
          recurrencePolicy: config.rewardRecurrencePolicy,
          recurrenceKey: resolution.recurrenceKey,
          tierCode: componentResult.matchedTier?.code ?? null,
          componentCode: componentResult.component.code,
          benefitTypeCode: componentResult.component.benefitType.code,
          distributionMode: componentResult.component.distributionMode,
          source: allocation.source,
          fallbackApplied: componentResult.fallbackApplied,
          roundingApplied: allocation.roundingAdjustment,
          selectorTags: allocation.contributor.selectorTags,
        } satisfies Record<string, unknown>,
      });
    }
  }
  return rows;
}

function withSyntheticOwner(
  input: RewardPreviewInput,
  reportedByUserId: string,
): RewardPreviewInput {
  if (input.contributors.length > 0) return input;
  return {
    ...input,
    contributors: [
      {
        id: undefined,
        userId: reportedByUserId,
        contributorRoleId: null,
        creditPercent: 100,
        isExcludedFromReward: false,
        selectorTags: [],
      },
    ],
  };
}

async function enrichRewardPreviewInputFormData(
  tenantId: string,
  input: RewardPreviewInput,
): Promise<RewardPreviewInput> {
  const enriched = await enrichPublicationJournalFormData({
    tenantId,
    formData: input.achievementFormData ?? {},
    mode: "fillMissing",
  });

  return {
    ...input,
    achievementFormData: enriched.formData ?? {},
  };
}

async function loadAchievementRewardContext(
  achievementId: string,
  tenantId: string,
): Promise<LoadedAchievementRewardContext | null> {
  const achievement = await prisma.achievement.findFirst({
    where: { id: achievementId, tenantId, state: "VERIFIED" },
    select: {
      id: true,
      tenantId: true,
      periodId: true,
      kpiDefinitionId: true,
      reportedByUserId: true,
      actualValue: true,
      actualDate: true,
      computedScore: true,
      effectiveScore: true,
      reportingDate: true,
      achievementFormData: true,
      contributors: {
        select: {
          id: true,
          userId: true,
          contributorRoleId: true,
          creditPercent: true,
          isExcludedFromReward: true,
          selectorTags: true,
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
    },
  });
  if (!achievement) return null;

  const config = await loadRewardConfig(achievement.kpiDefinitionId, tenantId);
  if (!config || config.rewardComponents.length === 0) {
    return null;
  }

  const parsedInput = parseInput({
    achievementId: achievement.id,
    actualValue: achievement.actualValue,
    actualDate: achievement.actualDate,
    computedScore: achievement.computedScore,
    effectiveScore: achievement.effectiveScore,
    reportingDate: achievement.reportingDate,
    achievementFormData:
      (achievement.achievementFormData as Record<string, unknown> | null) ?? {},
    contributors: achievement.contributors.map((contributor) => ({
      id: contributor.id,
      userId: contributor.userId ?? undefined,
      contributorRoleId: contributor.contributorRoleId ?? undefined,
      creditPercent: contributor.creditPercent,
      isExcludedFromReward: contributor.isExcludedFromReward,
      selectorTags: contributor.selectorTags ?? [],
    })),
    systemMetrics: {},
  });
  const input = withSyntheticOwner(
    await enrichRewardPreviewInputFormData(tenantId, parsedInput),
    achievement.reportedByUserId,
  );

  const resolution = await resolveRewards(config, input);
  const rows = buildPersistableRows(achievement.id, config, resolution);

  const snapshotUserIds = [
    achievement.reportedByUserId,
    ...rows
      .map((row) => row.contributorUserId)
      .filter((value): value is string => value != null),
  ];
  const userSnapshots = await loadUserUnitSnapshots(tenantId, snapshotUserIds);

  return {
    achievement: {
      ...achievement,
      achievementFormData:
        (input.achievementFormData as Record<string, unknown> | null) ?? {},
    },
    config,
    resolution,
    rows,
    userSnapshots,
  };
}

export async function previewKpiRewards(
  kpiDefinitionId: string,
  tenantId: string,
  input: RewardPreviewInput,
): Promise<RewardPreviewResult | null> {
  const config = await loadRewardConfig(kpiDefinitionId, tenantId);
  if (!config) return null;

  const parsedInput = parseInput(input);
  const enrichedInput = await enrichRewardPreviewInputFormData(
    tenantId,
    parsedInput,
  );
  const resolution = await resolveRewards(config, enrichedInput);
  return buildPreviewResult(config, resolution);
}

export async function syncContributorRewardsForAchievement(
  achievementId: string,
  tenantId: string,
  actorUserId?: string,
  actorRole?: Role,
): Promise<{ createdCount: number }> {
  const context = await loadAchievementRewardContext(achievementId, tenantId);
  if (!context) return { createdCount: 0 };

  const { achievement, config, resolution, rows, userSnapshots } = context;
  if (rows.length === 0) {
    return { createdCount: 0 };
  }

  const result = await prisma.$transaction(async (tx) => {
    const reporterSnapshot = userSnapshots.get(achievement.reportedByUserId) ?? null;
    const created = await tx.contributorReward.createMany({
      data: rows.map((row) => ({
        ...buildRewardCreateData(
          tenantId,
          achievement,
          row,
          {
            reporter: reporterSnapshot,
            owner: row.contributorUserId ? (userSnapshots.get(row.contributorUserId) ?? null) : null,
          },
          row.idempotencyKey,
        ),
      })),
      skipDuplicates: true,
    });

    if (created.count > 0) {
      const insertedRows = await tx.contributorReward.findMany({
        where: {
          achievementId: achievement.id,
          idempotencyKey: { in: rows.map((row) => row.idempotencyKey) },
        },
        select: { id: true, idempotencyKey: true },
      });

      for (const rewardRow of insertedRows) {
        await appendContributorRewardEvent(tx, {
          rewardId: rewardRow.id,
          tenantId,
          actorUserId,
          actorRole,
          action: "CALCULATED",
          fromState: null,
          toState: "DRAFT",
          note: "Reward created after final verification.",
          metadata: { idempotencyKey: rewardRow.idempotencyKey } satisfies Prisma.InputJsonValue,
        });
      }
    }

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId: actorUserId ?? null,
        actorRole: actorRole ?? null,
        targetType: "AchievementReward",
        targetId: achievement.id,
        action: "CALCULATE",
        newState: {
          rewardRowCount: rows.length,
          createdCount: created.count,
          recurrencePolicy: config.rewardRecurrencePolicy,
          recurrenceKey: resolution.recurrenceKey,
        } as object,
      },
    });

    return created.count;
  });

  return { createdCount: result };
}

export async function recalculateContributorRewardsForAchievement(
  achievementId: string,
  tenantId: string,
  actorUserId?: string,
  actorRole?: Role,
  reason?: string | null,
): Promise<{ createdCount: number; updatedCount: number; revokedCount: number }> {
  const context = await loadAchievementRewardContext(achievementId, tenantId);
  if (!context) {
    return { createdCount: 0, updatedCount: 0, revokedCount: 0 };
  }

  const { achievement, rows, userSnapshots } = context;
  const reporterSnapshot = userSnapshots.get(achievement.reportedByUserId) ?? null;
  const desiredByBase = new Map(rows.map((row) => [extractBaseRewardKey(row.idempotencyKey), row]));

  const existingRewards = await prisma.contributorReward.findMany({
    where: {
      tenantId,
      achievementId,
      state: { in: ACTIVE_REWARD_STATES },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  const existingKeys = existingRewards.map((reward) => reward.idempotencyKey);
  const note = reason?.trim() || "Reward recalculated after verified achievement correction.";

  return prisma.$transaction(async (tx) => {
    let createdCount = 0;
    let updatedCount = 0;
    let revokedCount = 0;
    const supersededRewardIdsByBaseKey = new Map<string, string>();
    const releasedReplacementCandidatesByMatchKey = new Map<string, string[]>();

    for (const reward of existingRewards) {
      const baseKey = extractBaseRewardKey(reward.idempotencyKey);
      const desiredRow = desiredByBase.get(baseKey) ?? null;

      if (!desiredRow) {
        await tx.contributorReward.update({
          where: { id: reward.id },
          data: {
            state: "REVOKED",
            statusRemark: note,
            revokedAt: new Date(),
            revokedById: actorUserId ?? null,
            revocationReason: note,
          },
        });
        await appendContributorRewardEvent(tx, {
          rewardId: reward.id,
          tenantId,
          actorUserId,
          actorRole,
          action: "REVOKED",
          fromState: reward.state,
          toState: "REVOKED",
          note,
          metadata: { trigger: "ACHIEVEMENT_CORRECTION" } satisfies Prisma.InputJsonValue,
        });
        if (reward.state === "RELEASED") {
          const replacementMatchKey = buildRewardReplacementMatchKey({
            achievementContributorId: reward.achievementContributorId,
            contributorUserId: reward.contributorUserId,
            benefitTypeId: reward.benefitTypeId,
          });
          const existingCandidateIds =
            releasedReplacementCandidatesByMatchKey.get(replacementMatchKey) ?? [];
          existingCandidateIds.push(reward.id);
          releasedReplacementCandidatesByMatchKey.set(
            replacementMatchKey,
            existingCandidateIds,
          );
        }
        revokedCount += 1;
        continue;
      }

      if (rewardRowsEquivalent(reward, desiredRow)) {
        desiredByBase.delete(baseKey);
        continue;
      }

      if (reward.state === "RELEASED") {
        await tx.contributorReward.update({
          where: { id: reward.id },
          data: {
            state: "REVOKED",
            statusRemark: note,
            revokedAt: new Date(),
            revokedById: actorUserId ?? null,
            revocationReason: note,
          },
        });
        await appendContributorRewardEvent(tx, {
          rewardId: reward.id,
          tenantId,
          actorUserId,
          actorRole,
          action: "REVOKED",
          fromState: reward.state,
          toState: "REVOKED",
          note,
          metadata: { trigger: "ACHIEVEMENT_CORRECTION" } satisfies Prisma.InputJsonValue,
        });
        supersededRewardIdsByBaseKey.set(baseKey, reward.id);
        const replacementMatchKey = buildRewardReplacementMatchKey({
          achievementContributorId: reward.achievementContributorId,
          contributorUserId: reward.contributorUserId,
          benefitTypeId: reward.benefitTypeId,
        });
        const existingCandidateIds =
          releasedReplacementCandidatesByMatchKey.get(replacementMatchKey) ?? [];
        existingCandidateIds.push(reward.id);
        releasedReplacementCandidatesByMatchKey.set(
          replacementMatchKey,
          existingCandidateIds,
        );
        revokedCount += 1;
        continue;
      }

      await tx.contributorReward.update({
        where: { id: reward.id },
        data: {
          achievementContributorId: desiredRow.achievementContributorId,
          contributorUserId: desiredRow.contributorUserId,
          benefitTypeId: desiredRow.benefitTypeId,
          rewardTierId: desiredRow.rewardTierId,
          rewardComponentId: desiredRow.rewardComponentId,
          recurrenceKey: desiredRow.recurrenceKey,
          state: "DRAFT",
          statusRemark: note,
          baseAmount: desiredRow.baseAmount,
          finalAmount: desiredRow.finalAmount,
          roundingAdjustment: desiredRow.roundingAdjustment,
          explanation: desiredRow.explanation,
          rewardOwnerUnitId:
            desiredRow.contributorUserId != null
              ? (userSnapshots.get(desiredRow.contributorUserId)?.unitId ?? null)
              : null,
          rewardOwnerUnitName:
            desiredRow.contributorUserId != null
              ? (userSnapshots.get(desiredRow.contributorUserId)?.unitName ?? null)
              : null,
          rewardOwnerUnitPath:
            desiredRow.contributorUserId != null
              ? (userSnapshots.get(desiredRow.contributorUserId)?.unitPath ?? null)
              : null,
          rewardOwnerUnitTypeKey:
            desiredRow.contributorUserId != null
              ? (userSnapshots.get(desiredRow.contributorUserId)?.unitTypeKey ?? null)
              : null,
          reporterUnitId: reporterSnapshot?.unitId ?? null,
          reporterUnitName: reporterSnapshot?.unitName ?? null,
          reporterUnitPath: reporterSnapshot?.unitPath ?? null,
          reporterUnitTypeKey: reporterSnapshot?.unitTypeKey ?? null,
        },
      });
      await appendContributorRewardEvent(tx, {
        rewardId: reward.id,
        tenantId,
        actorUserId,
        actorRole,
        action: "RECALCULATED",
        fromState: reward.state,
        toState: "DRAFT",
        note,
        metadata: { trigger: "ACHIEVEMENT_CORRECTION" } satisfies Prisma.InputJsonValue,
      });
      updatedCount += 1;
      desiredByBase.delete(baseKey);
    }

    const createdKeys = [...existingKeys];
    for (const [baseKey, desiredRow] of desiredByBase) {
      const idempotencyKey = createdKeys.includes(baseKey)
        ? nextRewardRevisionKey(baseKey, createdKeys)
        : baseKey;
      createdKeys.push(idempotencyKey);
      const replacementMatchKey = buildRewardReplacementMatchKey({
        achievementContributorId: desiredRow.achievementContributorId,
        contributorUserId: desiredRow.contributorUserId,
        benefitTypeId: desiredRow.benefitTypeId,
      });
      const supersededRewardId =
        supersededRewardIdsByBaseKey.get(baseKey)
        ?? releasedReplacementCandidatesByMatchKey.get(replacementMatchKey)?.shift()
        ?? null;

      const created = await tx.contributorReward.create({
        data: buildRewardCreateData(
          tenantId,
          achievement,
          desiredRow,
          {
            reporter: reporterSnapshot,
            owner:
              desiredRow.contributorUserId != null
                ? (userSnapshots.get(desiredRow.contributorUserId) ?? null)
                : null,
          },
          idempotencyKey,
          {
            supersedesRewardId: supersededRewardId,
          },
        ),
      });
      if (supersededRewardId) {
        await tx.contributorReward.update({
          where: { id: supersededRewardId },
          data: {
            replacedByRewardId: created.id,
          },
        });
      }
      await appendContributorRewardEvent(tx, {
        rewardId: created.id,
        tenantId,
        actorUserId,
        actorRole,
        action: "CALCULATED",
        fromState: null,
        toState: "DRAFT",
        note,
        metadata: {
          trigger: "ACHIEVEMENT_CORRECTION",
          supersedesBaseKey: baseKey,
        } satisfies Prisma.InputJsonValue,
      });
      createdCount += 1;
    }

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId: actorUserId ?? null,
        actorRole: actorRole ?? null,
        targetType: "AchievementReward",
        targetId: achievementId,
        action: "RECALCULATE",
        newState: {
          createdCount,
          updatedCount,
          revokedCount,
        } satisfies Prisma.InputJsonValue,
      },
    });

    return { createdCount, updatedCount, revokedCount };
  });
}
