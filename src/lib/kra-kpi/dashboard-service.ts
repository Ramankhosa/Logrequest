import { prisma } from "@/lib/prisma";

// ── G1: Overview Stats ──────────────────────────────────────────────────────

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

export async function getOverviewStats(
  tenantId: string,
  periodId: string,
): Promise<OverviewStats> {
  const [kpiCount, allocationCount, achievements, period] = await Promise.all([
    prisma.kpiDefinition.count({
      where: { kraDefinition: { tenantId, periodId }, state: "ACTIVE" },
    }),
    prisma.targetAllocation.count({
      where: { tenantId, kpiDefinition: { kraDefinition: { periodId } } },
    }),
    prisma.achievement.findMany({
      where: { tenantId, targetAllocation: { kpiDefinition: { kraDefinition: { periodId } } } },
      select: { state: true },
    }),
    prisma.assessmentPeriod.findUnique({
      where: { id: periodId },
      select: { endDate: true },
    }),
  ]);

  const byState = { DRAFT: 0, SUBMITTED: 0, RECOMMENDED: 0, VERIFIED: 0, REJECTED: 0 };
  for (const a of achievements) {
    if (a.state in byState) byState[a.state as keyof typeof byState]++;
  }

  const totalAchievements = achievements.length;
  const overallCompletionPercent =
    allocationCount > 0 ? Math.round((byState.VERIFIED / allocationCount) * 10000) / 100 : 0;

  // Overdue: allocations with no VERIFIED achievement past period end date
  let overdueCount = 0;
  if (period && new Date() > period.endDate) {
    const allocationsWithVerified = await prisma.achievement.groupBy({
      by: ["targetAllocationId"],
      where: {
        tenantId,
        state: "VERIFIED",
        targetAllocation: { kpiDefinition: { kraDefinition: { periodId } } },
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
    pendingReviewCount: byState.SUBMITTED,
  };
}

// ── G2: Org Hierarchy Stats ─────────────────────────────────────────────────

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

export async function getOrgHierarchyStats(
  tenantId: string,
  periodId: string,
  parentUnitId?: string,
): Promise<{ units: OrgHierarchyUnit[] }> {
  const units = await prisma.orgUnit.findMany({
    where: {
      tenantId,
      parentId: parentUnitId ?? null,
    },
    select: {
      id: true,
      name: true,
      code: true,
      category: true,
      _count: { select: { children: true } },
    },
    orderBy: { name: "asc" },
  });

  const result: OrgHierarchyUnit[] = [];

  for (const unit of units) {
    // Get all descendant unit IDs including this unit
    const unitIds = [unit.id];

    const allocations = await prisma.targetAllocation.findMany({
      where: {
        tenantId,
        kpiDefinition: { kraDefinition: { periodId } },
        OR: [
          { assignedToUnitId: { in: unitIds } },
          { assignedToUser: { orgUnits: { some: { orgUnitId: { in: unitIds } } } } },
        ],
      },
      select: {
        id: true,
        achievements: {
          select: { state: true, effectiveScore: true, stageCompletionScore: true },
        },
      },
    });

    const total = allocations.length;
    let completed = 0;
    let scoreSum = 0;
    let scoreCount = 0;

    for (const alloc of allocations) {
      const verified = alloc.achievements.some((a) => a.state === "VERIFIED");
      if (verified) completed++;
      for (const a of alloc.achievements) {
        const s = a.effectiveScore ?? a.stageCompletionScore ?? 0;
        if (s > 0) {
          scoreSum += s;
          scoreCount++;
        }
      }
    }

    result.push({
      unitId: unit.id,
      unitName: unit.name,
      unitCode: unit.code,
      category: unit.category,
      totalAllocations: total,
      completedAllocations: completed,
      completionPercent: total > 0 ? Math.round((completed / total) * 10000) / 100 : 0,
      averageScore: scoreCount > 0 ? Math.round((scoreSum / scoreCount) * 100) / 100 : 0,
      childUnitCount: unit._count.children,
    });
  }

  return { units: result };
}

// ── G3: KPI Cross-Comparison ────────────────────────────────────────────────

export type KpiCrossComparison = {
  kpiTitle: string;
  targetTotal: number;
  achievedTotal: number;
  units: {
    unitId: string;
    unitName: string;
    target: number;
    achieved: number;
    completionPercent: number;
    achievementCount: number;
  }[];
};

export async function getKpiCrossComparison(
  tenantId: string,
  periodId: string,
  kpiId: string,
): Promise<KpiCrossComparison | null> {
  const kpi = await prisma.kpiDefinition.findFirst({
    where: { id: kpiId, kraDefinition: { tenantId, periodId } },
    select: { title: true },
  });
  if (!kpi) return null;

  const allocations = await prisma.targetAllocation.findMany({
    where: {
      tenantId,
      kpiDefinitionId: kpiId,
    },
    select: {
      targetValue: true,
      assignedToUnitId: true,
      assignedToUnit: { select: { id: true, name: true } },
      achievements: {
        select: { state: true, actualValue: true },
      },
    },
  });

  const unitMap = new Map<string, { name: string; target: number; achieved: number; count: number }>();

  for (const alloc of allocations) {
    const unitId = alloc.assignedToUnitId ?? alloc.assignedToUnit?.id ?? "unassigned";
    const unitName = alloc.assignedToUnit?.name ?? "Unassigned";
    const entry = unitMap.get(unitId) ?? { name: unitName, target: 0, achieved: 0, count: 0 };
    entry.target += parseFloat(alloc.targetValue ?? "0");
    for (const a of alloc.achievements) {
      if (a.state === "VERIFIED" || a.state === "SUBMITTED" || a.state === "RECOMMENDED") {
        entry.achieved += a.actualValue ?? 0;
        entry.count++;
      }
    }
    unitMap.set(unitId, entry);
  }

  let targetTotal = 0;
  let achievedTotal = 0;
  const units = Array.from(unitMap.entries()).map(([unitId, data]) => {
    targetTotal += data.target;
    achievedTotal += data.achieved;
    return {
      unitId,
      unitName: data.name,
      target: data.target,
      achieved: data.achieved,
      completionPercent: data.target > 0 ? Math.round((data.achieved / data.target) * 10000) / 100 : 0,
      achievementCount: data.count,
    };
  });

  return { kpiTitle: kpi.title, targetTotal, achievedTotal, units };
}

// ── G4: Attention Items ─────────────────────────────────────────────────────

export type AttentionItems = {
  overdueAchievements: number;
  zeroProgressEmployees: number;
  stalePendingReviews: number;
  lowCompletionKpis: { kpiId: string; kpiTitle: string; completionPercent: number }[];
};

export async function getAttentionItems(
  tenantId: string,
  periodId: string,
): Promise<AttentionItems> {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Overdue: submitted after period end or not submitted at all
  const period = await prisma.assessmentPeriod.findUnique({
    where: { id: periodId },
    select: { endDate: true },
  });

  let overdueAchievements = 0;
  if (period && now > period.endDate) {
    const allocWithoutSubmission = await prisma.targetAllocation.count({
      where: {
        tenantId,
        kpiDefinition: { kraDefinition: { periodId } },
        achievements: { none: { state: { in: ["SUBMITTED", "RECOMMENDED", "VERIFIED"] } } },
      },
    });
    overdueAchievements = allocWithoutSubmission;
  }

  // Zero progress: employees with allocations but zero completed stages
  const allocsWithProgress = await prisma.targetAllocation.findMany({
    where: {
      tenantId,
      kpiDefinition: { kraDefinition: { periodId } },
    },
    select: {
      id: true,
      assignedToUserId: true,
      stageProgress: { where: { isCompleted: true }, select: { id: true } },
      achievements: { select: { id: true } },
    },
  });

  const usersWithProgress = new Set<string>();
  const usersWithAllocs = new Set<string>();
  for (const alloc of allocsWithProgress) {
    if (alloc.assignedToUserId) {
      usersWithAllocs.add(alloc.assignedToUserId);
      if (alloc.stageProgress.length > 0 || alloc.achievements.length > 0) {
        usersWithProgress.add(alloc.assignedToUserId);
      }
    }
  }
  const zeroProgressEmployees = [...usersWithAllocs].filter((u) => !usersWithProgress.has(u)).length;

  // Stale pending reviews: submitted > 7 days ago
  const stalePendingReviews = await prisma.achievement.count({
    where: {
      tenantId,
      state: "SUBMITTED",
      updatedAt: { lt: sevenDaysAgo },
      targetAllocation: { kpiDefinition: { kraDefinition: { periodId } } },
    },
  });

  // Low completion KPIs: < 50%
  const kpis = await prisma.kpiDefinition.findMany({
    where: { kraDefinition: { tenantId, periodId }, state: "ACTIVE" },
    select: {
      id: true,
      title: true,
      targetAllocations: {
        select: {
          achievements: { select: { state: true } },
        },
      },
    },
  });

  const lowCompletionKpis: AttentionItems["lowCompletionKpis"] = [];
  for (const kpi of kpis) {
    const totalAllocs = kpi.targetAllocations.length;
    if (totalAllocs === 0) continue;
    const verified = kpi.targetAllocations.filter((ta) =>
      ta.achievements.some((a) => a.state === "VERIFIED"),
    ).length;
    const pct = Math.round((verified / totalAllocs) * 10000) / 100;
    if (pct < 50) {
      lowCompletionKpis.push({ kpiId: kpi.id, kpiTitle: kpi.title, completionPercent: pct });
    }
  }

  return { overdueAchievements, zeroProgressEmployees, stalePendingReviews, lowCompletionKpis };
}

// ── G5: Stage Bottleneck Analysis ───────────────────────────────────────────

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

export async function getStageBottleneckAnalysis(
  tenantId: string,
  periodId: string,
  kpiId: string,
): Promise<StageBottleneck | null> {
  const kpi = await prisma.kpiDefinition.findFirst({
    where: { id: kpiId, kraDefinition: { tenantId, periodId } },
    select: { title: true },
  });
  if (!kpi) return null;

  const stageDefs = await prisma.kpiStageDefinition.findMany({
    where: { kpiDefinitionId: kpiId },
    orderBy: { stageOrder: "asc" },
    select: {
      id: true,
      stageOrder: true,
      title: true,
      stageProgress: {
        select: { isCompleted: true, completedAt: true, createdAt: true },
      },
    },
  });

  return {
    kpiTitle: kpi.title,
    stages: stageDefs.map((sd) => {
      const total = sd.stageProgress.length;
      const completed = sd.stageProgress.filter((p) => p.isCompleted);
      let avgDays: number | null = null;

      if (completed.length > 0) {
        const totalDays = completed.reduce((sum, p) => {
          if (p.completedAt && p.createdAt) {
            return sum + (p.completedAt.getTime() - p.createdAt.getTime()) / (1000 * 60 * 60 * 24);
          }
          return sum;
        }, 0);
        avgDays = Math.round((totalDays / completed.length) * 10) / 10;
      }

      return {
        stageOrder: sd.stageOrder,
        title: sd.title,
        totalAssigned: total,
        completedCount: completed.length,
        completionPercent: total > 0 ? Math.round((completed.length / total) * 10000) / 100 : 0,
        averageDaysToComplete: avgDays,
      };
    }),
  };
}

// ── G6: Person Detail ───────────────────────────────────────────────────────

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

export async function getPersonDetail(
  tenantId: string,
  periodId: string,
  userId: string,
): Promise<PersonDetail | null> {
  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      orgUnits: {
        select: { orgUnit: { select: { name: true } } },
        take: 1,
      },
    },
  });
  if (!user) return null;

  const allocations = await prisma.targetAllocation.findMany({
    where: {
      tenantId,
      assignedToUserId: userId,
      kpiDefinition: { kraDefinition: { periodId } },
    },
    select: {
      id: true,
      targetValue: true,
      kpiDefinition: {
        select: {
          title: true,
          kraDefinition: { select: { period: { select: { endDate: true } } } },
        },
      },
      stageProgress: {
        select: { isCompleted: true },
      },
      achievements: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          state: true,
          effectiveScore: true,
          stageCompletionScore: true,
          computedScore: true,
        },
      },
    },
  });

  const now = new Date();
  let totalScore = 0;
  let totalCompleted = 0;

  const allocViews = allocations.map((alloc) => {
    const totalStages = alloc.stageProgress.length;
    const completedStages = alloc.stageProgress.filter((sp) => sp.isCompleted).length;
    const latest = alloc.achievements[0];
    const score = latest?.effectiveScore ?? latest?.stageCompletionScore ?? latest?.computedScore ?? 0;
    const state = latest?.state ?? "NOT_STARTED";
    const endDate = alloc.kpiDefinition.kraDefinition.period.endDate;
    const isOverdue = now > endDate && state !== "VERIFIED";

    if (state === "VERIFIED") totalCompleted++;
    totalScore += score;

    return {
      kpiTitle: alloc.kpiDefinition.title,
      target: alloc.targetValue ?? "—",
      stagesComplete: completedStages,
      stagesTotal: totalStages,
      completionPercent: totalStages > 0 ? Math.round((completedStages / totalStages) * 100) : 0,
      score,
      state,
      isOverdue,
    };
  });

  return {
    userId: user.id,
    userName: `${user.firstName} ${user.lastName}`,
    unitName: user.orgUnits[0]?.orgUnit?.name ?? "—",
    allocations: allocViews,
    overallScore: Math.round(totalScore * 100) / 100,
    overallCompletion:
      allocations.length > 0 ? Math.round((totalCompleted / allocations.length) * 100) : 0,
  };
}
