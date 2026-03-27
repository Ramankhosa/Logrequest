import type { Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type {
  ContributorRewardEventView,
  ContributorRewardStateView,
  ContributorRewardView,
  MyRewardsView,
  RewardConsoleListResult,
  RewardConsoleTotals,
  RewardStateTotalsView,
} from "./shared";
import { createNotification } from "@/lib/notifications/notification-service";
import { recalculateContributorRewardsForAchievement } from "./reward-service";
import { getUserAssignments } from "@/lib/org-structure/roles-service";
import { getDescendantUnitIds } from "@/lib/org-structure/hierarchy-utils";

type RewardListFilters = {
  periodId?: string;
  kraDefinitionId?: string;
  kpiDefinitionId?: string;
  achievementId?: string;
  state?: ContributorRewardStateView | "ALL";
  benefitTypeCode?: string;
  contributorUserId?: string;
  reportedByUserId?: string;
  unitId?: string;
  createdFrom?: Date;
  createdTo?: Date;
  releasedFrom?: Date;
  releasedTo?: Date;
  limit?: number;
  offset?: number;
};

type RewardTransitionResult = {
  updatedCount: number;
  failed: Array<{ id: string; message: string }>;
};

type RewardAccessScope = {
  mode: "global" | "scoped";
  accessibleUnitIds: string[];
};

type RewardAccessRecord = {
  rewardOwnerUnitId: string | null;
  reporterUnitId: string | null;
  kpiDefinition: {
    startingUnitId: string;
    keyUnitId: string | null;
    finalUnitId: string | null;
  };
};

export class RewardAccessDeniedError extends Error {
  constructor(message = "You do not have permission to manage rewards.") {
    super(message);
    this.name = "RewardAccessDeniedError";
  }
}

function formatUserName(user: { firstName: string; lastName: string } | null | undefined) {
  return user ? `${user.firstName} ${user.lastName}` : null;
}

function isRewardAdmin(role: Role | null | undefined) {
  return role === "TENANT_OWNER" || role === "TENANT_ADMIN" || role === "SUPERADMIN";
}

async function resolveRewardAccessScope(
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
): Promise<RewardAccessScope | null> {
  if (isRewardAdmin(actorRole)) {
    return {
      mode: "global",
      accessibleUnitIds: [],
    };
  }

  const approvalAssignments = (await getUserAssignments(tenantId, actorUserId))
    .filter((assignment) => assignment.approvalAuthority);
  if (approvalAssignments.length === 0) {
    return null;
  }

  const accessibleUnitIds = new Set<string>();
  const descendantScopes = approvalAssignments
    .filter((assignment) => assignment.scope === "DESCENDANTS")
    .map((assignment) => assignment.unitId);

  for (const assignment of approvalAssignments) {
    accessibleUnitIds.add(assignment.unitId);
  }

  const descendantUnitGroups = await Promise.all(
    descendantScopes.map((unitId) => getDescendantUnitIds(tenantId, unitId, true)),
  );
  for (const descendantUnitIds of descendantUnitGroups) {
    for (const unitId of descendantUnitIds) {
      accessibleUnitIds.add(unitId);
    }
  }

  if (accessibleUnitIds.size === 0) {
    return null;
  }

  return {
    mode: "scoped",
    accessibleUnitIds: [...accessibleUnitIds],
  };
}

export async function getRewardConsoleAccessScope(
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
): Promise<RewardAccessScope> {
  const accessScope = await resolveRewardAccessScope(tenantId, actorUserId, actorRole);
  if (!accessScope) {
    throw new RewardAccessDeniedError("You do not have reward approval authority.");
  }
  return accessScope;
}

function buildRewardAccessWhere(accessScope?: RewardAccessScope): Prisma.ContributorRewardWhereInput {
  if (!accessScope || accessScope.mode === "global") {
    return {};
  }

  return {
    OR: [
      { rewardOwnerUnitId: { in: accessScope.accessibleUnitIds } },
      { reporterUnitId: { in: accessScope.accessibleUnitIds } },
      { kpiDefinition: { startingUnitId: { in: accessScope.accessibleUnitIds } } },
      { kpiDefinition: { keyUnitId: { in: accessScope.accessibleUnitIds } } },
      { kpiDefinition: { finalUnitId: { in: accessScope.accessibleUnitIds } } },
    ],
  };
}

function mergeRewardWhere(
  ...clauses: Prisma.ContributorRewardWhereInput[]
): Prisma.ContributorRewardWhereInput {
  const nonEmptyClauses = clauses.filter((clause) => Object.keys(clause).length > 0);
  if (nonEmptyClauses.length === 0) {
    return {};
  }
  if (nonEmptyClauses.length === 1) {
    return nonEmptyClauses[0]!;
  }
  return {
    AND: nonEmptyClauses,
  };
}

function rewardFallsWithinScope(
  reward: RewardAccessRecord,
  accessibleUnitIds: Set<string>,
): boolean {
  return [
    reward.rewardOwnerUnitId,
    reward.reporterUnitId,
    reward.kpiDefinition.startingUnitId,
    reward.kpiDefinition.keyUnitId,
    reward.kpiDefinition.finalUnitId,
  ].some((unitId) => unitId != null && accessibleUnitIds.has(unitId));
}

function mapRewardEvent(event: {
  id: string;
  rewardId: string;
  action: string;
  actorUserId: string | null;
  actorRole: Role | null;
  fromState: ContributorRewardStateView | null;
  toState: ContributorRewardStateView | null;
  note: string | null;
  metadata: Prisma.JsonValue;
  createdAt: Date;
  actorUser: { firstName: string; lastName: string } | null;
}): ContributorRewardEventView {
  return {
    id: event.id,
    rewardId: event.rewardId,
    action: event.action,
    actorUserId: event.actorUserId,
    actorName: formatUserName(event.actorUser),
    actorRole: event.actorRole,
    fromState: event.fromState,
    toState: event.toState,
    note: event.note,
    metadata: (event.metadata as Record<string, unknown> | null) ?? null,
    createdAt: event.createdAt,
  };
}

function mapRewardRow(row: {
  id: string;
  achievementId: string;
  kpiDefinitionId: string;
  contributorUserId: string | null;
  benefitTypeId: string;
  state: ContributorRewardStateView;
  baseAmount: number;
  finalAmount: number;
  roundingAdjustment: number;
  statusRemark: string | null;
  releaseReference: string | null;
  releasedAt: Date | null;
  releasedById: string | null;
  revokedAt: Date | null;
  revokedById: string | null;
  revocationReason: string | null;
  rewardOwnerUnitId: string | null;
  rewardOwnerUnitName: string | null;
  reporterUnitId: string | null;
  reporterUnitName: string | null;
  createdAt: Date;
  updatedAt: Date;
  supersedesRewardId: string | null;
  replacedByRewardId: string | null;
  rewardTier: { code: string; name: string } | null;
  rewardComponent: { code: string; name: string };
  benefitType: { id: string; code: string; name: string; unit: string };
  achievement: {
    reportedByUserId: string;
    reportedByUserName: string;
    kpiDefinition: { title: string };
  };
  contributorUser: { firstName: string; lastName: string } | null;
  releasedByUser: { firstName: string; lastName: string } | null;
  revokedByUser: { firstName: string; lastName: string } | null;
  events: Array<{
    id: string;
    rewardId: string;
    action: string;
    actorUserId: string | null;
    actorRole: Role | null;
    fromState: ContributorRewardStateView | null;
    toState: ContributorRewardStateView | null;
    note: string | null;
    metadata: Prisma.JsonValue;
    createdAt: Date;
    actorUser: { firstName: string; lastName: string } | null;
  }>;
}): ContributorRewardView {
  const contributorName = formatUserName(row.contributorUser);
  const reportedByUserName = row.achievement.reportedByUserName || "Unknown";

  return {
    id: row.id,
    achievementId: row.achievementId,
    kpiDefinitionId: row.kpiDefinitionId,
    kpiTitle: row.achievement.kpiDefinition.title,
    reportedByUserId: row.achievement.reportedByUserId,
    reportedByUserName,
    contributorUserId: row.contributorUserId,
    contributorUserName: contributorName,
    contributorDisplayName: contributorName ?? reportedByUserName,
    benefitTypeId: row.benefitTypeId,
    benefitTypeCode: row.benefitType.code,
    benefitTypeName: row.benefitType.name,
    benefitUnit: row.benefitType.unit,
    rewardTierCode: row.rewardTier?.code ?? null,
    rewardTierName: row.rewardTier?.name ?? null,
    rewardComponentCode: row.rewardComponent.code,
    rewardComponentName: row.rewardComponent.name,
    state: row.state,
    baseAmount: row.baseAmount,
    finalAmount: row.finalAmount,
    roundingAdjustment: row.roundingAdjustment,
    statusRemark: row.statusRemark,
    releaseReference: row.releaseReference,
    releasedAt: row.releasedAt,
    releasedByUserId: row.releasedById,
    releasedByUserName: formatUserName(row.releasedByUser),
    revokedAt: row.revokedAt,
    revokedByUserId: row.revokedById,
    revokedByUserName: formatUserName(row.revokedByUser),
    revocationReason: row.revocationReason,
    rewardOwnerUnitId: row.rewardOwnerUnitId,
    rewardOwnerUnitName: row.rewardOwnerUnitName,
    reporterUnitId: row.reporterUnitId,
    reporterUnitName: row.reporterUnitName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    supersedesRewardId: row.supersedesRewardId,
    replacedByRewardId: row.replacedByRewardId,
    events: row.events.map(mapRewardEvent),
  };
}

function buildRewardWhere(filters: RewardListFilters): Prisma.ContributorRewardWhereInput {
  return {
    ...(filters.periodId ? { periodId: filters.periodId } : {}),
    ...(filters.kraDefinitionId
      ? { kpiDefinition: { kraDefinitionId: filters.kraDefinitionId } }
      : {}),
    ...(filters.kpiDefinitionId ? { kpiDefinitionId: filters.kpiDefinitionId } : {}),
    ...(filters.achievementId ? { achievementId: filters.achievementId } : {}),
    ...(filters.state && filters.state !== "ALL" ? { state: filters.state } : {}),
    ...(filters.benefitTypeCode ? { benefitType: { code: filters.benefitTypeCode } } : {}),
    ...(filters.contributorUserId ? { contributorUserId: filters.contributorUserId } : {}),
    ...(filters.reportedByUserId
      ? { achievement: { reportedByUserId: filters.reportedByUserId } }
      : {}),
    ...(filters.unitId
      ? {
          OR: [
            { rewardOwnerUnitId: filters.unitId },
            { reporterUnitId: filters.unitId },
          ],
        }
      : {}),
    ...(filters.createdFrom || filters.createdTo
      ? {
          createdAt: {
            ...(filters.createdFrom ? { gte: filters.createdFrom } : {}),
            ...(filters.createdTo ? { lte: filters.createdTo } : {}),
          },
        }
      : {}),
    ...(filters.releasedFrom || filters.releasedTo
      ? {
          releasedAt: {
            ...(filters.releasedFrom ? { gte: filters.releasedFrom } : {}),
            ...(filters.releasedTo ? { lte: filters.releasedTo } : {}),
          },
        }
      : {}),
  };
}

function summarizeRewards(
  rows: Array<{
    state: ContributorRewardStateView;
    finalAmount: number;
    benefitType: { code: string; name: string; unit: string };
  }>,
): RewardConsoleTotals[] {
  const buckets = new Map<string, RewardConsoleTotals>();
  for (const row of rows) {
    const bucketKey = row.benefitType.code;
    const bucket =
      buckets.get(bucketKey) ??
      {
        benefitTypeCode: row.benefitType.code,
        benefitTypeName: row.benefitType.name,
        unit: row.benefitType.unit,
        totalCount: 0,
        draftCount: 0,
        pendingCount: 0,
        releasedCount: 0,
        revokedCount: 0,
        totalAmount: 0,
        draftAmount: 0,
        pendingAmount: 0,
        releasedAmount: 0,
        revokedAmount: 0,
      };

    bucket.totalCount += 1;
    bucket.totalAmount += row.finalAmount;
    if (row.state === "DRAFT") {
      bucket.draftCount += 1;
      bucket.draftAmount += row.finalAmount;
    } else if (row.state === "PENDING") {
      bucket.pendingCount += 1;
      bucket.pendingAmount += row.finalAmount;
    } else if (row.state === "RELEASED") {
      bucket.releasedCount += 1;
      bucket.releasedAmount += row.finalAmount;
    } else if (row.state === "REVOKED") {
      bucket.revokedCount += 1;
      bucket.revokedAmount += row.finalAmount;
    }
    buckets.set(bucketKey, bucket);
  }

  return [...buckets.values()].sort((left, right) =>
    left.benefitTypeName.localeCompare(right.benefitTypeName),
  );
}

function buildEmptyRewardStateTotals(): Record<ContributorRewardStateView, RewardStateTotalsView[]> {
  return {
    DRAFT: [],
    PENDING: [],
    RELEASED: [],
    REVOKED: [],
  };
}

function summarizeRewardsByState(
  rows: Array<{
    state: ContributorRewardStateView;
    finalAmount: number;
    benefitType: { code: string; name: string; unit: string };
  }>,
) {
  const totalsByState = buildEmptyRewardStateTotals();
  const stateBuckets = new Map<string, RewardStateTotalsView>();

  for (const row of rows) {
    const bucketKey = `${row.state}:${row.benefitType.code}:${row.benefitType.unit}`;
    const bucket = stateBuckets.get(bucketKey) ?? {
      benefitTypeCode: row.benefitType.code,
      benefitTypeName: row.benefitType.name,
      unit: row.benefitType.unit,
      count: 0,
      totalAmount: 0,
    };

    bucket.count += 1;
    bucket.totalAmount += row.finalAmount;
    stateBuckets.set(bucketKey, bucket);
  }

  for (const [bucketKey, bucket] of stateBuckets.entries()) {
    const [state] = bucketKey.split(":") as [ContributorRewardStateView];
    totalsByState[state].push(bucket);
  }

  for (const state of Object.keys(totalsByState) as ContributorRewardStateView[]) {
    totalsByState[state].sort((left, right) => {
      if (left.benefitTypeName !== right.benefitTypeName) {
        return left.benefitTypeName.localeCompare(right.benefitTypeName);
      }
      return left.unit.localeCompare(right.unit);
    });
  }

  return totalsByState;
}

async function loadRewardViews(
  where: Prisma.ContributorRewardWhereInput,
  take: number,
  skip: number,
): Promise<ContributorRewardView[]> {
  const rewardRows = await prisma.contributorReward.findMany({
    where,
    include: {
      rewardTier: { select: { code: true, name: true } },
      rewardComponent: { select: { code: true, name: true } },
      benefitType: { select: { id: true, code: true, name: true, unit: true } },
      achievement: {
        select: {
          reportedByUserId: true,
          kpiDefinition: { select: { title: true } },
        },
      },
      contributorUser: { select: { firstName: true, lastName: true } },
      events: {
        include: {
          actorUser: { select: { firstName: true, lastName: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
    skip,
  });

  const userIds = [
    ...new Set(
      rewardRows.flatMap((row) => [
        row.releasedById,
        row.revokedById,
        row.achievement.reportedByUserId,
      ]).filter((value): value is string => value != null),
    ),
  ];
  const users =
    userIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
  const userMap = new Map(users.map((user) => [user.id, user]));

  return rewardRows.map((row) =>
    mapRewardRow({
      ...row,
      achievement: {
        ...row.achievement,
        reportedByUserName:
          formatUserName(userMap.get(row.achievement.reportedByUserId) ?? null) ?? "Unknown",
      },
      releasedByUser: row.releasedById ? userMap.get(row.releasedById) ?? null : null,
      revokedByUser: row.revokedById ? userMap.get(row.revokedById) ?? null : null,
    }),
  );
}

export async function listContributorRewards(
  tenantId: string,
  filters: RewardListFilters,
  accessScope?: RewardAccessScope,
): Promise<RewardConsoleListResult> {
  const where = mergeRewardWhere(
    { tenantId },
    buildRewardWhere(filters),
    buildRewardAccessWhere(accessScope),
  );
  const [totalRows, summaryRows, rewardRows] = await Promise.all([
    prisma.contributorReward.count({ where }),
    prisma.contributorReward.findMany({
      where,
      select: {
        state: true,
        finalAmount: true,
        benefitType: {
          select: { code: true, name: true, unit: true },
        },
      },
    }),
    loadRewardViews(where, filters.limit ?? 50, filters.offset ?? 0),
  ]);

  return {
    rewards: rewardRows,
    totals: summarizeRewards(summaryRows),
    totalRows,
  };
}

export async function listMyRewards(
  tenantId: string,
  actorUserId: string,
  filters: Pick<RewardListFilters, "periodId" | "limit" | "offset"> = {},
): Promise<MyRewardsView> {
  const where = mergeRewardWhere(
    { tenantId },
    filters.periodId ? { periodId: filters.periodId } : {},
    {
      OR: [
        { contributorUserId: actorUserId },
        {
          contributorUserId: null,
          achievement: { reportedByUserId: actorUserId },
        },
      ],
    },
  );

  const [summaryRows, rewards] = await Promise.all([
    prisma.contributorReward.findMany({
      where,
      select: {
        state: true,
        finalAmount: true,
        benefitType: {
          select: { code: true, name: true, unit: true },
        },
      },
    }),
    loadRewardViews(where, filters.limit ?? 25, filters.offset ?? 0),
  ]);

  return {
    rewards,
    totalsByState: summarizeRewardsByState(summaryRows),
  };
}

export async function listContributorRewardsForActor(
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
  filters: RewardListFilters,
): Promise<RewardConsoleListResult> {
  const accessScope = await getRewardConsoleAccessScope(tenantId, actorUserId, actorRole);
  return listContributorRewards(tenantId, filters, accessScope);
}

async function logRewardTransitionAndNotify(input: {
  rewardId: string;
  tenantId: string;
  actorUserId: string;
  actorRole: Role;
  fromState: ContributorRewardStateView;
  toState: ContributorRewardStateView;
  note: string | null;
}) {
  const reward = await prisma.contributorReward.findUnique({
    where: { id: input.rewardId },
    include: {
      achievement: {
        select: {
          kpiDefinition: { select: { title: true } },
        },
      },
    },
  });
  if (!reward) return;

  if (reward.contributorUserId && reward.contributorUserId !== input.actorUserId) {
    await createNotification(
      input.tenantId,
      reward.contributorUserId,
      `REWARD_${input.toState}`,
      `reward:${reward.id}:event:${input.toState}`,
      `Reward ${input.toState.toLowerCase()}`,
      `${reward.achievement.kpiDefinition.title} reward is now ${input.toState.toLowerCase()}.`,
      "ContributorReward",
      reward.id,
      "/tenant-admin/kra-kpi",
    );
  }
}

export async function transitionContributorRewards(
  tenantId: string,
  rewardIds: string[],
  nextState: "DRAFT" | "PENDING" | "RELEASED" | "REVOKED",
  actorUserId: string,
  actorRole: Role,
  options?: { note?: string | null; releaseReference?: string | null },
): Promise<RewardTransitionResult> {
  const uniqueIds = [...new Set(rewardIds)];
  if (uniqueIds.length === 0) {
    return { updatedCount: 0, failed: [] };
  }

  const accessScope = await resolveRewardAccessScope(tenantId, actorUserId, actorRole);
  if (!accessScope) {
    return {
      updatedCount: 0,
      failed: uniqueIds.map((id) => ({
        id,
        message: "You do not have reward approval authority.",
      })),
    };
  }
  const scopedUnitIds =
    accessScope.mode === "scoped" ? new Set(accessScope.accessibleUnitIds) : null;

  const note = options?.note?.trim() || null;

  const { updatedCount, failed, successfulTransitions } = await prisma.$transaction(async (tx) => {
    const rewards = await tx.contributorReward.findMany({
      where: { tenantId, id: { in: uniqueIds } },
      select: {
        id: true,
        state: true,
        contributorUserId: true,
        rewardOwnerUnitId: true,
        reporterUnitId: true,
        kpiDefinition: {
          select: {
            startingUnitId: true,
            keyUnitId: true,
            finalUnitId: true,
          },
        },
      },
    });
    const rewardMap = new Map(rewards.map((reward) => [reward.id, reward]));

    const txFailed: RewardTransitionResult["failed"] = [];
    let txUpdatedCount = 0;
    const txSuccessful: Array<{ rewardId: string; fromState: string }> = [];

    for (const rewardId of uniqueIds) {
      const reward = rewardMap.get(rewardId);
      if (!reward) {
        txFailed.push({ id: rewardId, message: "Reward not found." });
        continue;
      }

      if (scopedUnitIds && !rewardFallsWithinScope(reward, scopedUnitIds)) {
        txFailed.push({
          id: rewardId,
          message: "You do not have permission to act on this reward.",
        });
        continue;
      }

      const allowed =
        (nextState === "DRAFT" && reward.state === "PENDING") ||
        (nextState === "PENDING" && reward.state === "DRAFT") ||
        (nextState === "RELEASED" && (reward.state === "DRAFT" || reward.state === "PENDING")) ||
        (nextState === "REVOKED" && reward.state !== "REVOKED");

      if (!allowed) {
        txFailed.push({
          id: rewardId,
          message: `Cannot move reward from ${reward.state} to ${nextState}.`,
        });
        continue;
      }

      if (nextState === "REVOKED" && !note) {
        txFailed.push({ id: rewardId, message: "Revocation requires a reason." });
        continue;
      }

      const updated = await tx.contributorReward.updateMany({
        where: { id: rewardId, tenantId, state: reward.state },
        data: {
          state: nextState,
          statusRemark: note,
          ...(nextState === "RELEASED"
            ? {
                releasedAt: new Date(),
                releasedById: actorUserId,
                releaseReference: options?.releaseReference?.trim() || null,
              }
            : {}),
          ...(nextState === "REVOKED"
            ? {
                revokedAt: new Date(),
                revokedById: actorUserId,
                revocationReason: note,
              }
            : {}),
        },
      });

      if (updated.count === 0) {
        txFailed.push({ id: rewardId, message: "Reward state changed before this action completed." });
        continue;
      }

      const event = await tx.contributorRewardEvent.create({
        data: {
          rewardId,
          tenantId,
          actorUserId,
          actorRole,
          action: nextState === "RELEASED" ? "RELEASED" : nextState === "REVOKED" ? "REVOKED" : "STATUS_UPDATED",
          fromState: reward.state,
          toState: nextState,
          note,
          metadata:
            nextState === "RELEASED" && options?.releaseReference
              ? ({ releaseReference: options.releaseReference } satisfies Prisma.InputJsonValue)
              : undefined,
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          actorUserId,
          actorRole,
          targetType: "ContributorReward",
          targetId: rewardId,
          action: nextState === "REVOKED" ? "REVOKE" : "UPDATE_STATE",
          previousState: { state: reward.state } satisfies Prisma.InputJsonValue,
          newState: {
            state: nextState,
            note,
            eventId: event.id,
          } satisfies Prisma.InputJsonValue,
        },
      });

      txUpdatedCount += 1;
      txSuccessful.push({ rewardId, fromState: reward.state });
    }

    return { updatedCount: txUpdatedCount, failed: txFailed, successfulTransitions: txSuccessful };
  });

  for (const { rewardId, fromState } of successfulTransitions) {
    await logRewardTransitionAndNotify({
      rewardId,
      tenantId,
      actorUserId,
      actorRole,
      fromState: fromState as ContributorRewardStateView,
      toState: nextState,
      note,
    });
  }

  return { updatedCount, failed };
}

export async function correctAchievementAndRefreshRewards(
  input: {
    achievementId: string;
    tenantId: string;
    actorUserId: string;
    actorRole: Role;
    note: string;
  },
) {
  return recalculateContributorRewardsForAchievement(
    input.achievementId,
    input.tenantId,
    input.actorUserId,
    input.actorRole,
    input.note,
  );
}
