import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Builds a combined WHERE filter that captures both unit-assigned and
 * user-assigned allocations whose primary unit is in scope (Finding 3).
 */
function buildEffectiveUnitFilter(scopeUnitIds: string[] | "ALL" | undefined): Prisma.TargetAllocationWhereInput {
  if (!scopeUnitIds || scopeUnitIds === "ALL") return {};
  return {
    OR: [
      { assignedToUnitId: { in: scopeUnitIds } },
      {
        assignedToUserId: { not: null },
        assignedToUser: {
          orgAssignments: {
            some: {
              unitId: { in: scopeUnitIds },
              isPrimary: true,
            },
          },
        },
      },
    ],
  };
}

export type OverviewStats = {
  totalKpis: number;
  totalAllocations: number;
  totalAchievements: number;
  achievementsByState: {
    DRAFT: number;
    SUBMITTED: number;
    RECOMMENDED: number;
    VERIFIED: number;
    REJECTED: number;
  };
  overallCompletionPercent: number;
  overdueCount: number;
  pendingReviewCount: number;
};

export type OrgHierarchyUnit = {
  unitId: string;
  unitName: string;
  unitCode: string;
  category: string;
  totalAllocations: number;
  completedAllocations: number;
  completionPercent: number;
  averageScore: number;
  childUnitCount: number;
};

export type KpiCrossComparison = {
  kpiTitle: string;
  totalAllocations: number;
  overallAverageScore: number;
  units: {
    unitId: string;
    unitName: string;
    allocationCount: number;
    scoredCount: number;
    averageScore: number;
    completionPercent: number;
  }[];
};

export type AttentionItems = {
  overdueAchievements: number;
  zeroProgressEmployees: number;
  stalePendingReviews: number;
  lowCompletionKpis: { kpiId: string; kpiTitle: string; completionPercent: number }[];
};

export type StageBottleneck = {
  kpiTitle: string;
  stages: {
    stageOrder: number;
    title: string;
    totalAssigned: number;
    completedCount: number;
    completionPercent: number;
    averageDaysToComplete: number | null;
  }[];
};

export type PersonDetail = {
  userId: string;
  userName: string;
  unitName: string;
  allocations: {
    kpiTitle: string;
    target: string;
    stagesComplete: number;
    stagesTotal: number;
    completionPercent: number;
    score: number;
    state: string;
    isOverdue: boolean;
  }[];
  overallScore: number;
  overallCompletion: number;
};

type PublishedUnit = {
  id: string;
  name: string;
  code: string;
  parentId: string | null;
  type: { displayLabel: string };
};

async function getPublishedVersionId(tenantId: string): Promise<string | null> {
  const version = await prisma.orgStructureVersion.findFirst({
    where: { tenantId, state: { in: ["PUBLISHED", "VALIDATED"] } },
    orderBy: { versionNumber: "desc" },
    select: { id: true },
  });

  return version?.id ?? null;
}

async function getPublishedUnits(tenantId: string): Promise<PublishedUnit[]> {
  const versionId = await getPublishedVersionId(tenantId);
  if (!versionId) return [];

  return prisma.orgUnit.findMany({
    where: { tenantId, versionId },
    select: {
      id: true,
      name: true,
      code: true,
      parentId: true,
      type: { select: { displayLabel: true } },
    },
    orderBy: [{ level: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
  });
}

function buildChildrenMap(units: PublishedUnit[]): Map<string | null, PublishedUnit[]> {
  const map = new Map<string | null, PublishedUnit[]>();
  for (const unit of units) {
    const siblings = map.get(unit.parentId) ?? [];
    siblings.push(unit);
    map.set(unit.parentId, siblings);
  }
  return map;
}

function collectDescendantIds(
  rootUnitId: string,
  childrenMap: Map<string | null, PublishedUnit[]>,
): Set<string> {
  const ids = new Set<string>();
  const queue = [rootUnitId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (ids.has(current)) continue;
    ids.add(current);
    for (const child of childrenMap.get(current) ?? []) {
      queue.push(child.id);
    }
  }

  return ids;
}

async function getPrimaryAssignmentMap(
  tenantId: string,
  userIds: string[],
): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();

  const versionId = await getPublishedVersionId(tenantId);
  if (!versionId) return new Map();

  const assignments = await prisma.userOrgAssignment.findMany({
    where: {
      versionId,
      userId: { in: userIds },
    },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: { userId: true, unitId: true, isPrimary: true },
  });

  const map = new Map<string, string>();
  for (const assignment of assignments) {
    if (!map.has(assignment.userId)) {
      map.set(assignment.userId, assignment.unitId);
    }
  }

  return map;
}

function scoreFromAchievement(achievement: {
  effectiveScore: number | null;
  stageCompletionScore: number | null;
  computedScore: number | null;
} | null | undefined): number {
  return achievement?.effectiveScore
    ?? achievement?.stageCompletionScore
    ?? achievement?.computedScore
    ?? 0;
}

function formatTargetValue(allocation: {
  targetValue: number | null;
  targetDate: Date | null;
  targetMilestone: string | null;
  targetGrade: string | null;
  targetBoolean: boolean | null;
  targetRating: number | null;
}): string {
  if (allocation.targetValue != null) return String(allocation.targetValue);
  if (allocation.targetDate != null) return allocation.targetDate.toISOString().slice(0, 10);
  if (allocation.targetMilestone != null) return allocation.targetMilestone;
  if (allocation.targetGrade != null) return allocation.targetGrade;
  if (allocation.targetBoolean != null) return allocation.targetBoolean ? "Yes" : "No";
  if (allocation.targetRating != null) return String(allocation.targetRating);
  return "—";
}

export async function getOverviewStats(
  tenantId: string,
  periodId: string,
  scopeUnitIds?: string[] | "ALL",
): Promise<OverviewStats> {
  const scopeFilter = buildEffectiveUnitFilter(scopeUnitIds);
  const allocationWhere: Prisma.TargetAllocationWhereInput = { tenantId, periodId, ...scopeFilter };

  const [kpiCount, allocationCount, achievements, period] = await Promise.all([
    prisma.kpiDefinition.count({
      where: { kraDefinition: { tenantId, periodId }, state: "ACTIVE" },
    }),
    prisma.targetAllocation.count({ where: allocationWhere }),
    prisma.achievement.findMany({
      where: {
        tenantId,
        periodId,
        ...(scopeFilter.OR
          ? { targetAllocation: scopeFilter }
          : {}),
      },
      select: { state: true },
    }),
    prisma.assessmentPeriod.findFirst({
      where: { id: periodId, tenantId },
      select: { achievementDeadline: true, endDate: true },
    }),
  ]);

  const byState = { DRAFT: 0, SUBMITTED: 0, RECOMMENDED: 0, VERIFIED: 0, REJECTED: 0 };
  for (const achievement of achievements) {
    byState[achievement.state]++;
  }

  const totalAchievements = achievements.length;
  const overallCompletionPercent =
    allocationCount > 0 ? Math.round((byState.VERIFIED / allocationCount) * 10000) / 100 : 0;

  let overdueCount = 0;
  const dueDate = period?.achievementDeadline ?? period?.endDate ?? null;
  if (dueDate && new Date() > dueDate) {
    const allocationsWithVerified = await prisma.achievement.groupBy({
      by: ["targetAllocationId"],
      where: {
        tenantId,
        periodId,
        state: "VERIFIED",
        targetAllocationId: { not: null },
        ...(scopeFilter.OR
          ? { targetAllocation: scopeFilter }
          : {}),
      },
    });
    overdueCount = allocationCount - allocationsWithVerified.length;
  }

  return {
    totalKpis: kpiCount,
    totalAllocations: allocationCount,
    totalAchievements,
    achievementsByState: byState,
    overallCompletionPercent,
    overdueCount: Math.max(0, overdueCount),
    pendingReviewCount: byState.SUBMITTED + byState.RECOMMENDED,
  };
}

export async function getOrgHierarchyStats(
  tenantId: string,
  periodId: string,
  parentUnitId?: string,
  scopeUnitIds?: string[] | "ALL",
): Promise<{ units: OrgHierarchyUnit[] }> {
  const units = await getPublishedUnits(tenantId);
  if (units.length === 0) return { units: [] };

  const childrenMap = buildChildrenMap(units);
  const visibleUnits = childrenMap.get(parentUnitId ?? null) ?? [];
  if (visibleUnits.length === 0) return { units: [] };

  const scopeFilter = buildEffectiveUnitFilter(scopeUnitIds);
  const allocations = await prisma.targetAllocation.findMany({
    where: { tenantId, periodId, ...scopeFilter },
    select: {
      assignedToUnitId: true,
      assignedToUserId: true,
      achievements: {
        orderBy: [{ reportingDate: "desc" }, { createdAt: "desc" }],
        select: {
          state: true,
          effectiveScore: true,
          stageCompletionScore: true,
          computedScore: true,
        },
      },
    },
  });

  const primaryAssignmentMap = await getPrimaryAssignmentMap(
    tenantId,
    allocations
      .map((allocation) => allocation.assignedToUserId)
      .filter((userId): userId is string => Boolean(userId)),
  );

  const results = visibleUnits.map((unit): OrgHierarchyUnit => {
    const descendantIds = collectDescendantIds(unit.id, childrenMap);
    const scopedAllocations = allocations.filter((allocation) => {
      const allocationUnitId =
        allocation.assignedToUnitId
        ?? (allocation.assignedToUserId
          ? primaryAssignmentMap.get(allocation.assignedToUserId) ?? null
          : null);
      return allocationUnitId ? descendantIds.has(allocationUnitId) : false;
    });

    const totalAllocations = scopedAllocations.length;
    const completedAllocations = scopedAllocations.filter((allocation) =>
      allocation.achievements.some((achievement) => achievement.state === "VERIFIED"),
    ).length;
    const latestScores = scopedAllocations
      .map((allocation) => scoreFromAchievement(allocation.achievements[0]))
      .filter((score) => score > 0);

    return {
      unitId: unit.id,
      unitName: unit.name,
      unitCode: unit.code,
      category: unit.type.displayLabel,
      totalAllocations,
      completedAllocations,
      completionPercent:
        totalAllocations > 0
          ? Math.round((completedAllocations / totalAllocations) * 10000) / 100
          : 0,
      averageScore:
        latestScores.length > 0
          ? Math.round((latestScores.reduce((sum, score) => sum + score, 0) / latestScores.length) * 100) / 100
          : 0,
      childUnitCount: (childrenMap.get(unit.id) ?? []).length,
    };
  });

  return { units: results };
}

export async function getKpiCrossComparison(
  tenantId: string,
  periodId: string,
  kpiId: string,
  scopeUnitIds?: string[] | "ALL",
): Promise<KpiCrossComparison | null> {
  const kpi = await prisma.kpiDefinition.findFirst({
    where: { id: kpiId, kraDefinition: { tenantId, periodId } },
    select: { title: true },
  });
  if (!kpi) return null;

  const scopeFilter = buildEffectiveUnitFilter(scopeUnitIds);
  const allocations = await prisma.targetAllocation.findMany({
    where: {
      tenantId,
      periodId,
      kpiDefinitionId: kpiId,
      ...scopeFilter,
    },
    select: {
      assignedToUnitId: true,
      assignedToUserId: true,
      assignedToUnit: { select: { id: true, name: true } },
      achievements: {
        orderBy: [{ reportingDate: "desc" }, { createdAt: "desc" }],
        select: {
          state: true,
          effectiveScore: true,
          stageCompletionScore: true,
          computedScore: true,
        },
      },
    },
  });

  const primaryAssignmentMap = await getPrimaryAssignmentMap(
    tenantId,
    allocations
      .map((allocation) => allocation.assignedToUserId)
      .filter((userId): userId is string => Boolean(userId)),
  );
  const units = await getPublishedUnits(tenantId);
  const unitNameMap = new Map(units.map((unit) => [unit.id, unit.name]));

  const unitMap = new Map<string, {
    name: string;
    allocationCount: number;
    scoredCount: number;
    scoreTotal: number;
  }>();
  for (const allocation of allocations) {
    const unitId =
      allocation.assignedToUnitId
      ?? (allocation.assignedToUserId
        ? primaryAssignmentMap.get(allocation.assignedToUserId) ?? "unassigned"
        : "unassigned");
    const unitName =
      allocation.assignedToUnit?.name
      ?? unitNameMap.get(unitId)
      ?? "Unassigned";
    const entry = unitMap.get(unitId) ?? {
      name: unitName,
      allocationCount: 0,
      scoredCount: 0,
      scoreTotal: 0,
    };
    entry.allocationCount += 1;

    const latestAchievement = allocation.achievements[0];
    if (latestAchievement && ["SUBMITTED", "RECOMMENDED", "VERIFIED"].includes(latestAchievement.state)) {
      const score =
        latestAchievement.effectiveScore
        ?? latestAchievement.stageCompletionScore
        ?? latestAchievement.computedScore;

      if (score != null) {
        entry.scoreTotal += score;
        entry.scoredCount += 1;
      }
    }

    unitMap.set(unitId, entry);
  }

  let totalAllocations = 0;
  let totalScore = 0;
  let scoredCount = 0;
  const unitRows = Array.from(unitMap.entries()).map(([unitId, unit]) => {
    totalAllocations += unit.allocationCount;
    totalScore += unit.scoreTotal;
    scoredCount += unit.scoredCount;

    return {
      unitId,
      unitName: unit.name,
      allocationCount: unit.allocationCount,
      scoredCount: unit.scoredCount,
      averageScore:
        unit.scoredCount > 0
          ? Math.round((unit.scoreTotal / unit.scoredCount) * 100) / 100
          : 0,
      completionPercent:
        unit.allocationCount > 0
          ? Math.round((unit.scoredCount / unit.allocationCount) * 10000) / 100
          : 0,
    };
  });

  return {
    kpiTitle: kpi.title,
    totalAllocations,
    overallAverageScore:
      scoredCount > 0 ? Math.round((totalScore / scoredCount) * 100) / 100 : 0,
    units: unitRows,
  };
}

export async function getAttentionItems(
  tenantId: string,
  periodId: string,
  scopeUnitIds?: string[] | "ALL",
): Promise<AttentionItems> {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const period = await prisma.assessmentPeriod.findFirst({
    where: { id: periodId, tenantId },
    select: { achievementDeadline: true, endDate: true },
  });

  const scopeFilter = buildEffectiveUnitFilter(scopeUnitIds);

  let overdueAchievements = 0;
  const dueDate = period?.achievementDeadline ?? period?.endDate ?? null;
  if (dueDate && now > dueDate) {
    const allocationsWithVerified = await prisma.achievement.groupBy({
      by: ["targetAllocationId"],
      where: {
        tenantId,
        periodId,
        state: "VERIFIED",
        targetAllocationId: { not: null },
        ...(scopeFilter.OR ? { targetAllocation: scopeFilter } : {}),
      },
    });
    const allocationCount = await prisma.targetAllocation.count({
      where: { tenantId, periodId, ...scopeFilter },
    });
    overdueAchievements = Math.max(0, allocationCount - allocationsWithVerified.length);
  }

  const allocations = await prisma.targetAllocation.findMany({
    where: {
      tenantId,
      periodId,
      assignedToUserId: { not: null },
      ...scopeFilter,
    },
    select: {
      assignedToUserId: true,
      achievements: { select: { id: true } },
      stageProgress: { where: { isCompleted: true }, select: { id: true } },
    },
  });

  const usersWithAllocations = new Set<string>();
  const usersWithProgress = new Set<string>();
  for (const allocation of allocations) {
    if (!allocation.assignedToUserId) continue;
    usersWithAllocations.add(allocation.assignedToUserId);
    if (allocation.achievements.length > 0 || allocation.stageProgress.length > 0) {
      usersWithProgress.add(allocation.assignedToUserId);
    }
  }

  const stalePendingReviews = await prisma.achievement.count({
    where: {
      tenantId,
      periodId,
      state: { in: ["SUBMITTED", "RECOMMENDED"] },
      updatedAt: { lt: sevenDaysAgo },
      ...(scopeFilter.OR ? { targetAllocation: scopeFilter } : {}),
    },
  });

  const kpis = await prisma.kpiDefinition.findMany({
    where: { kraDefinition: { tenantId, periodId }, state: "ACTIVE" },
    select: {
      id: true,
      title: true,
      targetAllocations: {
        where: scopeFilter,
        select: {
          achievements: { select: { state: true } },
        },
      },
    },
  });

  const lowCompletionKpis = kpis
    .map((kpi) => {
      const totalAllocations = kpi.targetAllocations.length;
      const verifiedAllocations = kpi.targetAllocations.filter((allocation) =>
        allocation.achievements.some((achievement) => achievement.state === "VERIFIED"),
      ).length;
      const completionPercent =
        totalAllocations > 0
          ? Math.round((verifiedAllocations / totalAllocations) * 10000) / 100
          : 0;

      return {
        kpiId: kpi.id,
        kpiTitle: kpi.title,
        completionPercent,
        totalAllocations,
      };
    })
    .filter((kpi) => kpi.totalAllocations > 0 && kpi.completionPercent < 50)
    .map(({ kpiId, kpiTitle, completionPercent }) => ({
      kpiId,
      kpiTitle,
      completionPercent,
    }));

  return {
    overdueAchievements,
    zeroProgressEmployees: [...usersWithAllocations].filter((userId) => !usersWithProgress.has(userId)).length,
    stalePendingReviews,
    lowCompletionKpis,
  };
}

export async function getStageBottleneckAnalysis(
  tenantId: string,
  periodId: string,
  kpiId: string,
  scopeUnitIds?: string[] | "ALL",
): Promise<StageBottleneck | null> {
  const kpi = await prisma.kpiDefinition.findFirst({
    where: { id: kpiId, kraDefinition: { tenantId, periodId } },
    select: { title: true },
  });
  if (!kpi) return null;

  const scopeFilter = buildEffectiveUnitFilter(scopeUnitIds);
  const stageDefinitions = await prisma.kpiStageDefinition.findMany({
    where: { kpiDefinitionId: kpiId },
    orderBy: { stageOrder: "asc" },
    select: {
      stageOrder: true,
      title: true,
      stageProgress: {
        where: scopeFilter.OR
          ? { targetAllocation: scopeFilter }
          : {},
        select: {
          isCompleted: true,
          completedAt: true,
          createdAt: true,
        },
      },
    },
  });

  return {
    kpiTitle: kpi.title,
    stages: stageDefinitions.map((stage) => {
      const totalAssigned = stage.stageProgress.length;
      const completed = stage.stageProgress.filter((progress) => progress.isCompleted);
      const averageDaysToComplete =
        completed.length > 0
          ? Math.round(
              (completed.reduce((sum, progress) => {
                if (!progress.completedAt) return sum;
                return sum + ((progress.completedAt.getTime() - progress.createdAt.getTime()) / (1000 * 60 * 60 * 24));
              }, 0) / completed.length)
              * 10,
            ) / 10
          : null;

      return {
        stageOrder: stage.stageOrder,
        title: stage.title,
        totalAssigned,
        completedCount: completed.length,
        completionPercent:
          totalAssigned > 0 ? Math.round((completed.length / totalAssigned) * 10000) / 100 : 0,
        averageDaysToComplete,
      };
    }),
  };
}

export async function getPersonDetail(
  tenantId: string,
  periodId: string,
  userId: string,
  scopeUnitIds?: string[] | "ALL",
): Promise<PersonDetail | null> {
  const [user, versionId] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, firstName: true, lastName: true },
    }),
    getPublishedVersionId(tenantId),
  ]);
  if (!user) return null;

  // Access check: if scope is limited, verify user's primary unit is in scope
  if (scopeUnitIds && scopeUnitIds !== "ALL" && versionId) {
    const primaryUnit = await prisma.userOrgAssignment.findFirst({
      where: { versionId, userId, isPrimary: true },
      select: { unitId: true },
    });
    if (primaryUnit && !scopeUnitIds.includes(primaryUnit.unitId)) {
      return null;
    }
  }

  const primaryAssignment = versionId
    ? await prisma.userOrgAssignment.findFirst({
        where: { versionId, userId, isPrimary: true },
        include: { unit: { select: { name: true } } },
      })
    : null;

  const scopeFilter = buildEffectiveUnitFilter(scopeUnitIds);
  const allocations = await prisma.targetAllocation.findMany({
    where: {
      tenantId,
      periodId,
      assignedToUserId: userId,
      ...scopeFilter,
    },
    select: {
      targetValue: true,
      targetDate: true,
      targetMilestone: true,
      targetGrade: true,
      targetBoolean: true,
      targetRating: true,
      kpiDefinition: {
        select: {
          title: true,
          _count: { select: { stages: true } },
        },
      },
      achievements: {
        orderBy: [{ reportingDate: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          state: true,
          effectiveScore: true,
          stageCompletionScore: true,
          computedScore: true,
          stageProgress: { select: { isCompleted: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const period = await prisma.assessmentPeriod.findFirst({
    where: { id: periodId, tenantId },
    select: { achievementDeadline: true, endDate: true },
  });
  const dueDate = period?.achievementDeadline ?? period?.endDate ?? null;
  const now = new Date();

  let overallScore = 0;
  let completedCount = 0;

  const allocationRows = allocations.map((allocation) => {
    const latestAchievement = allocation.achievements[0];
    const stagesTotal = latestAchievement?.stageProgress.length ?? allocation.kpiDefinition._count.stages;
    const stagesComplete =
      latestAchievement?.stageProgress.filter((stage) => stage.isCompleted).length ?? 0;
    const state = latestAchievement?.state ?? "NOT_STARTED";
    const score = scoreFromAchievement(latestAchievement);
    const isOverdue = Boolean(dueDate && now > dueDate && state !== "VERIFIED");

    overallScore += score;
    if (state === "VERIFIED") {
      completedCount += 1;
    }

    return {
      kpiTitle: allocation.kpiDefinition.title,
      target: formatTargetValue(allocation),
      stagesComplete,
      stagesTotal,
      completionPercent: stagesTotal > 0 ? Math.round((stagesComplete / stagesTotal) * 100) : 0,
      score,
      state,
      isOverdue,
    };
  });

  return {
    userId: user.id,
    userName: `${user.firstName} ${user.lastName}`,
    unitName: primaryAssignment?.unit?.name ?? "—",
    allocations: allocationRows,
    overallScore: Math.round(overallScore * 100) / 100,
    overallCompletion:
      allocationRows.length > 0 ? Math.round((completedCount / allocationRows.length) * 100) : 0,
  };
}
