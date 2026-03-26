import type { Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type {
  ContributorRewardEventView,
  ContributorRewardStateView,
  ContributorRewardView,
  RewardConsoleListResult,
  RewardConsoleTotals,
} from "./shared";
import { createNotification } from "@/lib/notifications/notification-service";
import { recalculateContributorRewardsForAchievement } from "./reward-service";
import { getUserAssignments } from "@/lib/org-structure/roles-service";

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

function formatUserName(user: { firstName: string; lastName: string } | null | undefined) {
  return user ? `${user.firstName} ${user.lastName}` : null;
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

export async function listContributorRewards(
  tenantId: string,
  filters: RewardListFilters,
): Promise<RewardConsoleListResult> {
  const where = buildRewardWhere(filters);
  const [totalRows, summaryRows, rewardRows] = await Promise.all([
    prisma.contributorReward.count({ where: { tenantId, ...where } }),
    prisma.contributorReward.findMany({
      where: { tenantId, ...where },
      select: {
        state: true,
        finalAmount: true,
        benefitType: {
          select: { code: true, name: true, unit: true },
        },
      },
    }),
    prisma.contributorReward.findMany({
      where: { tenantId, ...where },
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
      take: filters.limit ?? 50,
      skip: filters.offset ?? 0,
    }),
  ]);

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

  const rewards = rewardRows.map((row) =>
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

  return {
    rewards,
    totals: summarizeRewards(summaryRows),
    totalRows,
  };
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

  const isTenantAdmin = actorRole === "TENANT_OWNER" || actorRole === "TENANT_ADMIN";
  if (!isTenantAdmin) {
    const assignments = await getUserAssignments(tenantId, actorUserId);
    const hasApprovalAuthority = assignments.some((a) => a.approvalAuthority);
    if (!hasApprovalAuthority) {
      return {
        updatedCount: 0,
        failed: uniqueIds.map((id) => ({
          id,
          message: "You do not have reward approval authority.",
        })),
      };
    }
  }

  const note = options?.note?.trim() || null;

  const { updatedCount, failed, successfulTransitions } = await prisma.$transaction(async (tx) => {
    const rewards = await tx.contributorReward.findMany({
      where: { tenantId, id: { in: uniqueIds } },
      select: {
        id: true,
        state: true,
        contributorUserId: true,
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
