import type { KpiMeasurementType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getPublishedVersionId } from "@/lib/org-structure/hierarchy-utils";
import type {
  AllocationAchievementAggregateView,
  MeasurementConfig,
  ScoringConfig,
  StageProgressView,
} from "./shared";
import { formatTargetDisplay } from "./measurement-display";
import { getStageProgressForAchievement } from "./stage-progress-service";
import {
  buildAllocationAchievementAggregate,
  isAllocationOfficiallyComplete,
} from "./allocation-achievement-utils";

/**
 * Builds a combined WHERE filter that captures both unit-assigned and
 * user-assigned allocations whose primary unit is in scope (Finding 3).
 */
function buildEffectiveUnitFilter(
  tenantId: string,
  scopeUnitIds: string[] | "ALL" | undefined,
): Prisma.TargetAllocationWhereInput {
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
              version: {
                tenantId,
                state: "PUBLISHED",
              },
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
  navigableChildCount: number;
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

export type UnitSummary = {
  unitId: string;
  unitName: string;
  unitCode: string;
  scopeMode: "NODE" | "DESCENDANTS";
  effectiveUnitCount: number;
  memberCount: number;
  totalAllocations: number;
  completedAllocations: number;
  completionPercent: number;
  averageScore: number;
  kraBreakdown: {
    kraId: string;
    kraTitle: string;
    weightage: number;
    totalAllocations: number;
    completedAllocations: number;
    completionPercent: number;
    averageScore: number;
  }[];
  stageKpiOptions: {
    kpiId: string;
    kpiTitle: string;
    allocationCount: number;
    stageCount: number;
    completionPercent: number;
  }[];
};

export type UnitMemberSummary = {
  userId: string;
  userName: string;
  primaryUnitId: string | null;
  primaryUnitName: string;
  totalAllocations: number;
  completedAllocations: number;
  completionPercent: number;
  overallScore: number;
  overdueCount: number;
  alertLevel: "brand" | "blue" | "amber" | "rose" | "slate";
};

export type PersonDetail = {
  userId: string;
  userName: string;
  primaryUnitId: string | null;
  primaryUnitCode: string | null;
  unitName: string;
  allocations: {
    allocationId: string;
    kpiDefinitionId: string;
    kpiTitle: string;
    measurementType: KpiMeasurementType;
    unitLabel: string | null;
    target: string;
    targetDisplay: string;
    latestAchievementId: string | null;
    stagesComplete: number;
    stagesTotal: number;
    completionPercent: number;
    score: number;
    state: string;
    isOverdue: boolean;
    stageRows: StageProgressView[];
  }[];
  overallScore: number;
  averageScore: number;
  overallCompletion: number;
};

type PublishedUnit = {
  id: string;
  name: string;
  code: string;
  parentId: string | null;
  level: number;
  path: string | null;
  sortOrder: number;
  type: { displayLabel: string };
};

export type DrillDownNode = {
  unitId: string | null;
  unitName: string;
  unitCode: string | null;
  category: string;
  level: number;
  childUnitCount: number;
  navigableChildCount: number;
  memberCount: number;
  totalAllocations: number;
  completedAllocations: number;
  completionPercent: number;
  averageScore: number;
  overdueCount: number;
  kraBreakdown: Array<{
    kraId: string;
    kraTitle: string;
    weightage: number;
    totalAllocations: number;
    completedAllocations: number;
    completionPercent: number;
    averageScore: number;
    kpis: Array<{
      sourceKpiId: string;
      kpiTitle: string;
      measurementType: KpiMeasurementType;
      unitLabel: string | null;
      stageCount: number;
      numericComparable: boolean;
      totalAllocations: number;
      completedAllocations: number;
      completionPercent: number;
      averageScore: number;
    }>;
  }>;
  stageKpiOptions: Array<{
    kpiId: string;
    kraId: string;
    kraTitle: string;
    kpiTitle: string;
    allocationCount: number;
    stageCount: number;
    completionPercent: number;
  }>;
};

export type CrossUnitComparison = {
  units: Array<{
    unitId: string;
    unitName: string;
    unitCode: string;
    category: string;
    totalAllocations: number;
    completedAllocations: number;
    completionPercent: number;
    averageScore: number;
    memberCount: number;
    kraBreakdown: Array<{
      kraId: string;
      kraTitle: string;
      totalAllocations: number;
      completedAllocations: number;
      completionPercent: number;
      averageScore: number;
    }>;
  }>;
};

export type PeriodComparisonResult = {
  sourceKpi: {
    sourceKpiId: string;
    kraTitle: string;
    kpiTitle: string;
    measurementType: KpiMeasurementType;
    unitLabel: string | null;
  };
  comparisonMode: "NUMERIC" | "SCORE_ONLY";
  periods: Array<{
    periodId: string;
    periodName: string;
    matchStatus: "matched" | "missing" | "ambiguous";
    kpiId: string | null;
    measurementType: KpiMeasurementType | null;
    totalAllocations: number;
    verifiedCount: number;
    completionPercent: number;
    averageScore: number;
    targetTotal: number | null;
    achievedTotal: number | null;
    candidateMatches: Array<{
      kpiId: string;
      kraTitle: string;
      kpiTitle: string;
      measurementType: KpiMeasurementType;
    }>;
  }>;
};

type AggregatedAllocation = {
  id: string;
  assignedToUserId: string | null;
  resolvedUnitId: string | null;
  targetValue: number | null;
  targetRating: number | null;
  targetDate: Date | null;
  targetMilestone: string | null;
  targetGrade: string | null;
  targetBoolean: boolean | null;
  kpiDefinitionId: string;
  kpiTitle: string;
  measurementType: KpiMeasurementType;
  unitLabel: string | null;
  stageCount: number;
  allowMultipleAchievementsPerAllocation: boolean;
  achievementAggregate: AllocationAchievementAggregateView;
  officialActualValue: number;
  officialScore: number | null;
  kraId: string;
  kraTitle: string;
  kraWeightage: number;
  latestAchievement: {
    id: string;
    state: string;
    effectiveScore: number | null;
    stageCompletionScore: number | null;
    computedScore: number | null;
    actualValue: number | null;
    actualRating: number | null;
    stageProgress: Array<{ isCompleted: boolean }>;
  } | null;
  hasVerifiedAchievement: boolean;
};

type ScopedAggregationSummary = {
  totalAllocations: number;
  completedAllocations: number;
  completionPercent: number;
  averageScore: number;
  overdueCount: number;
  memberIds: Set<string>;
  kraBreakdown: DrillDownNode["kraBreakdown"];
  stageKpiOptions: DrillDownNode["stageKpiOptions"];
};

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
      level: true,
      path: true,
      sortOrder: true,
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

function buildUnitMap(units: PublishedUnit[]) {
  return new Map(units.map((unit) => [unit.id, unit]));
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

function isNumericComparableMeasurement(measurementType: KpiMeasurementType) {
  return (
    measurementType === "NUMERIC" ||
    measurementType === "PERCENTAGE" ||
    measurementType === "CURRENCY" ||
    measurementType === "RATING"
  );
}

function normalizeComparisonKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
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

async function loadScopedAggregationData(
  tenantId: string,
  periodId: string,
  scopeUnitIds?: string[] | "ALL",
) {
  const scopeFilter = buildEffectiveUnitFilter(tenantId, scopeUnitIds);
  const [units, period, allocations] = await Promise.all([
    getPublishedUnits(tenantId),
    prisma.assessmentPeriod.findFirst({
      where: { id: periodId, tenantId },
      select: { achievementDeadline: true, endDate: true },
    }),
    prisma.targetAllocation.findMany({
      where: { tenantId, periodId, ...scopeFilter },
      select: {
        id: true,
        assignedToUnitId: true,
        assignedToUserId: true,
        targetValue: true,
        targetRating: true,
        kpiDefinitionId: true,
        kpiDefinition: {
          select: {
            title: true,
            measurementType: true,
            unitLabel: true,
            allowMultipleAchievementsPerAllocation: true,
            scoringMethod: true,
            scoringDirection: true,
            scoringConfig: true,
            measurementConfig: true,
            _count: { select: { stages: true } },
            kraDefinition: {
              select: {
                id: true,
                title: true,
                weightage: true,
              },
            },
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
            actualValue: true,
            actualRating: true,
            stageProgress: { select: { isCompleted: true } },
          },
        },
      },
    }),
  ]);

  const primaryAssignmentMap = await getPrimaryAssignmentMap(
    tenantId,
    allocations
      .map((allocation) => allocation.assignedToUserId)
      .filter((userId): userId is string => Boolean(userId)),
  );

  const rows: AggregatedAllocation[] = allocations.map((allocation) => ({
    id: allocation.id,
    assignedToUserId: allocation.assignedToUserId,
    resolvedUnitId:
      allocation.assignedToUnitId
      ?? (allocation.assignedToUserId
        ? primaryAssignmentMap.get(allocation.assignedToUserId) ?? null
        : null),
    targetValue: allocation.targetValue,
    targetRating: allocation.targetRating,
    targetDate: null,
    targetMilestone: null,
    targetGrade: null,
    targetBoolean: null,
    kpiDefinitionId: allocation.kpiDefinitionId,
    kpiTitle: allocation.kpiDefinition.title,
    measurementType: allocation.kpiDefinition.measurementType,
    unitLabel: allocation.kpiDefinition.unitLabel,
    stageCount: allocation.kpiDefinition._count.stages,
    allowMultipleAchievementsPerAllocation:
      allocation.kpiDefinition.allowMultipleAchievementsPerAllocation,
    achievementAggregate: buildAllocationAchievementAggregate({
      allowMultipleAchievementsPerAllocation:
        allocation.kpiDefinition.allowMultipleAchievementsPerAllocation,
      achievements: allocation.achievements,
      measurementType: allocation.kpiDefinition.measurementType,
      scoringMethod: allocation.kpiDefinition.scoringMethod,
      scoringDirection: allocation.kpiDefinition.scoringDirection,
      scoringConfig: allocation.kpiDefinition.scoringConfig as ScoringConfig | null,
      measurementConfig: allocation.kpiDefinition.measurementConfig as MeasurementConfig | null,
      target: {
        targetValue: allocation.targetValue,
        targetDate: null,
        targetMilestone: null,
        targetGrade: null,
        targetBoolean: null,
        targetRating: allocation.targetRating,
      },
    }),
    officialActualValue: 0,
    officialScore: null,
    kraId: allocation.kpiDefinition.kraDefinition.id,
    kraTitle: allocation.kpiDefinition.kraDefinition.title,
    kraWeightage: allocation.kpiDefinition.kraDefinition.weightage,
    latestAchievement: allocation.achievements[0] ?? null,
    hasVerifiedAchievement: false,
  }));

  rows.forEach((row, index) => {
    const sourceAllocation = allocations[index];
    row.officialActualValue = row.allowMultipleAchievementsPerAllocation
      ? row.achievementAggregate.officialActualValue
      : row.latestAchievement?.actualRating ?? row.latestAchievement?.actualValue ?? 0;
    row.officialScore = row.allowMultipleAchievementsPerAllocation
      ? row.achievementAggregate.officialScore
      : row.latestAchievement
        ? scoreFromAchievement(row.latestAchievement)
        : null;
    row.hasVerifiedAchievement = isAllocationOfficiallyComplete({
      allowMultipleAchievementsPerAllocation: row.allowMultipleAchievementsPerAllocation,
      aggregate: row.achievementAggregate,
      targetValue: row.targetValue,
      achievements: sourceAllocation?.achievements ?? [],
    });
  });

  return {
    units,
    unitMap: buildUnitMap(units),
    childrenMap: buildChildrenMap(units),
    dueDate: period?.achievementDeadline ?? period?.endDate ?? null,
    rows,
  };
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

// Legacy formatter kept for backward-compatible diffs while dashboard consumers migrate.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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

function roundToTwo(value: number) {
  return Math.round(value * 100) / 100;
}

function toPercent(completed: number, total: number) {
  return total > 0 ? roundToTwo((completed / total) * 100) : 0;
}

function formatUserName(user: { firstName: string; lastName: string } | null | undefined) {
  return user ? `${user.firstName} ${user.lastName}` : "Unknown";
}

function isAllocationCompleted(achievements: Array<{ state: string }>) {
  return achievements.some((achievement) => achievement.state === "VERIFIED");
}

function scoreToAlertLevel(
  score: number,
  completionPercent: number,
  overdueCount: number,
): UnitMemberSummary["alertLevel"] {
  if (overdueCount > 0) return "rose";
  if (completionPercent === 0 && score === 0) return "slate";
  if (score >= 80 && completionPercent >= 80) return "brand";
  if (score >= 50 && completionPercent >= 50) return "blue";
  if (score >= 25 || completionPercent >= 25) return "amber";
  return "rose";
}

function summarizeScopedAllocations(
  rows: AggregatedAllocation[],
  dueDate: Date | null,
): ScopedAggregationSummary {
  const memberIds = new Set<string>();
  const kraBuckets = new Map<string, {
    kraId: string;
    kraTitle: string;
    weightage: number;
    totalAllocations: number;
    completedAllocations: number;
    scoreTotal: number;
    scoredCount: number;
    kpiBuckets: Map<string, {
      sourceKpiId: string;
      kpiTitle: string;
      measurementType: KpiMeasurementType;
      unitLabel: string | null;
      stageCount: number;
      numericComparable: boolean;
      totalAllocations: number;
      completedAllocations: number;
      scoreTotal: number;
      scoredCount: number;
    }>;
  }>();
  const stageBuckets = new Map<string, {
    kpiId: string;
    kraId: string;
    kraTitle: string;
    kpiTitle: string;
    allocationCount: number;
    stageCount: number;
    completedStages: number;
    totalStages: number;
  }>();
  const now = new Date();

  let completedAllocations = 0;
  let overdueCount = 0;
  let scoreTotal = 0;
  let scoredCount = 0;

  for (const row of rows) {
    if (row.assignedToUserId) {
      memberIds.add(row.assignedToUserId);
    }

    if (row.hasVerifiedAchievement) {
      completedAllocations += 1;
    }

    if (row.officialScore != null) {
      scoreTotal += row.officialScore;
      scoredCount += 1;
    }

    if (dueDate && now > dueDate && !row.hasVerifiedAchievement) {
      overdueCount += 1;
    }

    const kraBucket = kraBuckets.get(row.kraId) ?? {
      kraId: row.kraId,
      kraTitle: row.kraTitle,
      weightage: row.kraWeightage,
      totalAllocations: 0,
      completedAllocations: 0,
      scoreTotal: 0,
      scoredCount: 0,
      kpiBuckets: new Map(),
    };
    kraBucket.totalAllocations += 1;
    if (row.hasVerifiedAchievement) {
      kraBucket.completedAllocations += 1;
    }
    if (row.officialScore != null) {
      kraBucket.scoreTotal += row.officialScore;
      kraBucket.scoredCount += 1;
    }

    const kpiBucket = kraBucket.kpiBuckets.get(row.kpiDefinitionId) ?? {
      sourceKpiId: row.kpiDefinitionId,
      kpiTitle: row.kpiTitle,
      measurementType: row.measurementType,
      unitLabel: row.unitLabel,
      stageCount: row.stageCount,
      numericComparable: isNumericComparableMeasurement(row.measurementType),
      totalAllocations: 0,
      completedAllocations: 0,
      scoreTotal: 0,
      scoredCount: 0,
    };
    kpiBucket.totalAllocations += 1;
    if (row.hasVerifiedAchievement) {
      kpiBucket.completedAllocations += 1;
    }
    if (row.officialScore != null) {
      kpiBucket.scoreTotal += row.officialScore;
      kpiBucket.scoredCount += 1;
    }
    kraBucket.kpiBuckets.set(row.kpiDefinitionId, kpiBucket);
    kraBuckets.set(row.kraId, kraBucket);

    if (row.stageCount > 0) {
      const completedStages = row.latestAchievement?.stageProgress.filter((stage) => stage.isCompleted).length ?? 0;
      const totalStages = row.latestAchievement?.stageProgress.length ?? row.stageCount;
      const stageBucket = stageBuckets.get(row.kpiDefinitionId) ?? {
        kpiId: row.kpiDefinitionId,
        kraId: row.kraId,
        kraTitle: row.kraTitle,
        kpiTitle: row.kpiTitle,
        allocationCount: 0,
        stageCount: row.stageCount,
        completedStages: 0,
        totalStages: 0,
      };
      stageBucket.allocationCount += 1;
      stageBucket.completedStages += completedStages;
      stageBucket.totalStages += totalStages;
      stageBuckets.set(row.kpiDefinitionId, stageBucket);
    }
  }

  return {
    totalAllocations: rows.length,
    completedAllocations,
    completionPercent: toPercent(completedAllocations, rows.length),
    averageScore: scoredCount > 0 ? roundToTwo(scoreTotal / scoredCount) : 0,
    overdueCount,
    memberIds,
    kraBreakdown: [...kraBuckets.values()]
      .map((bucket) => ({
        kraId: bucket.kraId,
        kraTitle: bucket.kraTitle,
        weightage: bucket.weightage,
        totalAllocations: bucket.totalAllocations,
        completedAllocations: bucket.completedAllocations,
        completionPercent: toPercent(bucket.completedAllocations, bucket.totalAllocations),
        averageScore: bucket.scoredCount > 0 ? roundToTwo(bucket.scoreTotal / bucket.scoredCount) : 0,
        kpis: [...bucket.kpiBuckets.values()]
          .map((kpi) => ({
            sourceKpiId: kpi.sourceKpiId,
            kpiTitle: kpi.kpiTitle,
            measurementType: kpi.measurementType,
            unitLabel: kpi.unitLabel,
            stageCount: kpi.stageCount,
            numericComparable: kpi.numericComparable,
            totalAllocations: kpi.totalAllocations,
            completedAllocations: kpi.completedAllocations,
            completionPercent: toPercent(kpi.completedAllocations, kpi.totalAllocations),
            averageScore: kpi.scoredCount > 0 ? roundToTwo(kpi.scoreTotal / kpi.scoredCount) : 0,
          }))
          .sort((left, right) => left.kpiTitle.localeCompare(right.kpiTitle)),
      }))
      .sort((left, right) => left.kraTitle.localeCompare(right.kraTitle)),
    stageKpiOptions: [...stageBuckets.values()]
      .map((bucket) => ({
        kpiId: bucket.kpiId,
        kraId: bucket.kraId,
        kraTitle: bucket.kraTitle,
        kpiTitle: bucket.kpiTitle,
        allocationCount: bucket.allocationCount,
        stageCount: bucket.stageCount,
        completionPercent: toPercent(bucket.completedStages, bucket.totalStages),
      }))
      .sort((left, right) =>
        left.completionPercent === right.completionPercent
          ? left.kpiTitle.localeCompare(right.kpiTitle)
          : left.completionPercent - right.completionPercent,
      ),
  };
}

export async function getOverviewStats(
  tenantId: string,
  periodId: string,
  scopeUnitIds?: string[] | "ALL",
): Promise<OverviewStats> {
  const scopeFilter = buildEffectiveUnitFilter(tenantId, scopeUnitIds);
  const allocationWhere: Prisma.TargetAllocationWhereInput = { tenantId, periodId, ...scopeFilter };

  const [kpiCount, allocationCount, achievements, scopedData] = await Promise.all([
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
    loadScopedAggregationData(tenantId, periodId, scopeUnitIds),
  ]);

  const byState = { DRAFT: 0, SUBMITTED: 0, RECOMMENDED: 0, VERIFIED: 0, REJECTED: 0 };
  for (const achievement of achievements) {
    byState[achievement.state]++;
  }

  const totalAchievements = achievements.length;
  const overallSummary = summarizeScopedAllocations(scopedData.rows, scopedData.dueDate);

  return {
    totalKpis: kpiCount,
    totalAllocations: allocationCount,
    totalAchievements,
    achievementsByState: byState,
    overallCompletionPercent: overallSummary.completionPercent,
    overdueCount: overallSummary.overdueCount,
    pendingReviewCount: byState.SUBMITTED + byState.RECOMMENDED,
  };
}

export async function getOrgHierarchyStats(
  tenantId: string,
  periodId: string,
  unitIds: string[],
  scopeUnitIds?: string[] | "ALL",
): Promise<{ units: OrgHierarchyUnit[] }> {
  if (unitIds.length === 0) return { units: [] };

  const data = await loadScopedAggregationData(tenantId, periodId, scopeUnitIds);
  if (data.units.length === 0) return { units: [] };

  const allowedUnitIds = new Set(
    scopeUnitIds && scopeUnitIds !== "ALL"
      ? scopeUnitIds
      : data.units.map((unit) => unit.id),
  );

  return {
    units: unitIds
      .map((unitId) => data.unitMap.get(unitId))
      .filter((unit): unit is PublishedUnit => Boolean(unit))
      .map((unit) => {
        const descendantIds = new Set(
          [...collectDescendantIds(unit.id, data.childrenMap)].filter((id) => allowedUnitIds.has(id)),
        );
        const summary = summarizeScopedAllocations(
          data.rows.filter((row) => row.resolvedUnitId && descendantIds.has(row.resolvedUnitId)),
          data.dueDate,
        );

        return {
          unitId: unit.id,
          unitName: unit.name,
          unitCode: unit.code,
          category: unit.type.displayLabel,
          totalAllocations: summary.totalAllocations,
          completedAllocations: summary.completedAllocations,
          completionPercent: summary.completionPercent,
          averageScore: summary.averageScore,
          childUnitCount: (data.childrenMap.get(unit.id) ?? []).length,
          navigableChildCount: (data.childrenMap.get(unit.id) ?? []).filter((child) =>
            allowedUnitIds.has(child.id),
          ).length,
        };
      }),
  };
}

export async function getDrillDownNode(
  tenantId: string,
  periodId: string,
  options: {
    unitId?: string | null;
    effectiveUnitIds: string[];
    visibleChildUnitIds?: string[];
  },
): Promise<DrillDownNode | null> {
  const effectiveUnitIds = [...new Set(options.effectiveUnitIds)];
  const data = await loadScopedAggregationData(tenantId, periodId, effectiveUnitIds);
  if (data.units.length === 0) return null;

  const currentUnit =
    options.unitId != null
      ? data.unitMap.get(options.unitId) ?? null
      : null;

  if (options.unitId && !currentUnit) {
    return null;
  }

  const versionId = await getPublishedVersionId(tenantId);
  const primaryMembers = versionId
    ? await prisma.userOrgAssignment.findMany({
        where: {
          versionId,
          isPrimary: true,
          unitId: { in: effectiveUnitIds },
        },
        select: { userId: true },
      })
    : [];

  const summary = summarizeScopedAllocations(data.rows, data.dueDate);
  const memberIds = new Set(summary.memberIds);
  for (const member of primaryMembers) {
    memberIds.add(member.userId);
  }

  return {
    unitId: currentUnit?.id ?? null,
    unitName: currentUnit?.name ?? "All visible units",
    unitCode: currentUnit?.code ?? null,
    category: currentUnit?.type.displayLabel ?? "Scoped Portfolio",
    level: currentUnit?.level ?? -1,
    childUnitCount: currentUnit
      ? (data.childrenMap.get(currentUnit.id) ?? []).length
      : (options.visibleChildUnitIds?.length ?? 0),
    navigableChildCount: currentUnit
      ? (options.visibleChildUnitIds?.length
        ?? (data.childrenMap.get(currentUnit.id) ?? []).filter((child) =>
          effectiveUnitIds.includes(child.id),
        ).length)
      : (options.visibleChildUnitIds?.length ?? 0),
    memberCount: memberIds.size,
    totalAllocations: summary.totalAllocations,
    completedAllocations: summary.completedAllocations,
    completionPercent: summary.completionPercent,
    averageScore: summary.averageScore,
    overdueCount: summary.overdueCount,
    kraBreakdown: summary.kraBreakdown,
    stageKpiOptions: summary.stageKpiOptions,
  };
}

export async function getCrossUnitComparison(
  tenantId: string,
  periodId: string,
  unitIds: string[],
  scopeUnitIds?: string[] | "ALL",
): Promise<CrossUnitComparison> {
  if (unitIds.length === 0) {
    return { units: [] };
  }

  const [data, versionId] = await Promise.all([
    loadScopedAggregationData(tenantId, periodId, scopeUnitIds),
    getPublishedVersionId(tenantId),
  ]);
  if (data.units.length === 0) {
    return { units: [] };
  }

  const allowedUnitIds = new Set(
    scopeUnitIds && scopeUnitIds !== "ALL"
      ? scopeUnitIds
      : data.units.map((unit) => unit.id),
  );
  const primaryAssignments = versionId
    ? await prisma.userOrgAssignment.findMany({
        where: {
          versionId,
          isPrimary: true,
          unitId: { in: [...allowedUnitIds] },
        },
        select: { userId: true, unitId: true },
      })
    : [];

  return {
    units: unitIds
      .map((unitId) => data.unitMap.get(unitId))
      .filter((unit): unit is PublishedUnit => Boolean(unit))
      .map((unit) => {
        const descendantIds = new Set(
          [...collectDescendantIds(unit.id, data.childrenMap)].filter((id) => allowedUnitIds.has(id)),
        );
        const summary = summarizeScopedAllocations(
          data.rows.filter((row) => row.resolvedUnitId && descendantIds.has(row.resolvedUnitId)),
          data.dueDate,
        );
        const memberIds = new Set(summary.memberIds);
        for (const assignment of primaryAssignments) {
          if (descendantIds.has(assignment.unitId)) {
            memberIds.add(assignment.userId);
          }
        }

        return {
          unitId: unit.id,
          unitName: unit.name,
          unitCode: unit.code,
          category: unit.type.displayLabel,
          totalAllocations: summary.totalAllocations,
          completedAllocations: summary.completedAllocations,
          completionPercent: summary.completionPercent,
          averageScore: summary.averageScore,
          memberCount: memberIds.size,
          kraBreakdown: summary.kraBreakdown.map((kra) => ({
            kraId: kra.kraId,
            kraTitle: kra.kraTitle,
            totalAllocations: kra.totalAllocations,
            completedAllocations: kra.completedAllocations,
            completionPercent: kra.completionPercent,
            averageScore: kra.averageScore,
          })),
        };
      }),
  };
}

export async function getKpiPeriodComparison(
  tenantId: string,
  sourceKpiId: string,
  periodIds: string[],
  scopeUnitIds?: string[] | "ALL",
): Promise<PeriodComparisonResult | null> {
  const uniquePeriodIds = [...new Set(periodIds.filter(Boolean))];
  const scopeFilter = buildEffectiveUnitFilter(tenantId, scopeUnitIds);
  const sourceKpi = await prisma.kpiDefinition.findFirst({
    where: { id: sourceKpiId, kraDefinition: { tenantId } },
    select: {
      id: true,
      title: true,
      measurementType: true,
      unitLabel: true,
      kraDefinition: {
        select: {
          title: true,
          periodId: true,
        },
      },
    },
  });
  if (!sourceKpi) return null;

  const sourceAllocationCount = await prisma.targetAllocation.count({
    where: {
      tenantId,
      periodId: sourceKpi.kraDefinition.periodId,
      kpiDefinitionId: sourceKpi.id,
      ...scopeFilter,
    },
  });
  if (sourceAllocationCount === 0) {
    return null;
  }

  const sourceCompositeKey = `${normalizeComparisonKey(sourceKpi.kraDefinition.title)}::${normalizeComparisonKey(sourceKpi.title)}`;
  const requestedPeriods = await prisma.assessmentPeriod.findMany({
    where: { tenantId, id: { in: uniquePeriodIds } },
    select: { id: true, name: true },
  });
  const orderMap = new Map(uniquePeriodIds.map((periodId, index) => [periodId, index]));
  requestedPeriods.sort(
    (left, right) => (orderMap.get(left.id) ?? 0) - (orderMap.get(right.id) ?? 0),
  );

  const periodScopedKpis = await prisma.kpiDefinition.findMany({
    where: {
      kraDefinition: {
        tenantId,
        periodId: { in: uniquePeriodIds },
      },
      state: "ACTIVE",
    },
    select: {
      id: true,
      title: true,
      measurementType: true,
      unitLabel: true,
      kraDefinition: {
        select: {
          title: true,
          periodId: true,
        },
      },
    },
  });

  const matchesByPeriod = new Map<string, typeof periodScopedKpis>();
  for (const kpi of periodScopedKpis) {
    const comparisonKey = `${normalizeComparisonKey(kpi.kraDefinition.title)}::${normalizeComparisonKey(kpi.title)}`;
    if (comparisonKey !== sourceCompositeKey) continue;
    const entries = matchesByPeriod.get(kpi.kraDefinition.periodId) ?? [];
    entries.push(kpi);
    matchesByPeriod.set(kpi.kraDefinition.periodId, entries);
  }

  const matchedKpiIds = requestedPeriods.flatMap((period) => {
    if (period.id === sourceKpi.kraDefinition.periodId) {
      return [sourceKpi.id];
    }
    const matches = matchesByPeriod.get(period.id) ?? [];
    return matches.length === 1 ? [matches[0]!.id] : [];
  });

  const allocations = matchedKpiIds.length
    ? await prisma.targetAllocation.findMany({
        where: {
          tenantId,
          periodId: { in: uniquePeriodIds },
          kpiDefinitionId: { in: matchedKpiIds },
          ...scopeFilter,
        },
        select: {
          periodId: true,
          kpiDefinitionId: true,
          targetValue: true,
          targetDate: true,
          targetMilestone: true,
          targetGrade: true,
          targetBoolean: true,
          targetRating: true,
          kpiDefinition: {
            select: {
              allowMultipleAchievementsPerAllocation: true,
              measurementType: true,
              scoringMethod: true,
              scoringDirection: true,
              scoringConfig: true,
              measurementConfig: true,
            },
          },
          achievements: {
            orderBy: [{ reportingDate: "desc" }, { createdAt: "desc" }],
            select: {
              state: true,
              effectiveScore: true,
              stageCompletionScore: true,
              computedScore: true,
              actualValue: true,
              actualRating: true,
            },
          },
        },
      })
    : [];

  const metrics = new Map<string, {
    totalAllocations: number;
    verifiedCount: number;
    scoreTotal: number;
    scoredCount: number;
    targetTotal: number;
    achievedTotal: number;
  }>();
  for (const allocation of allocations) {
    const key = `${allocation.periodId}:${allocation.kpiDefinitionId}`;
    const entry = metrics.get(key) ?? {
      totalAllocations: 0,
      verifiedCount: 0,
      scoreTotal: 0,
      scoredCount: 0,
      targetTotal: 0,
      achievedTotal: 0,
    };

    entry.totalAllocations += 1;
    const aggregate = buildAllocationAchievementAggregate({
      allowMultipleAchievementsPerAllocation:
        allocation.kpiDefinition.allowMultipleAchievementsPerAllocation,
      achievements: allocation.achievements,
      measurementType: allocation.kpiDefinition.measurementType,
      scoringMethod: allocation.kpiDefinition.scoringMethod,
      scoringDirection: allocation.kpiDefinition.scoringDirection,
      scoringConfig: allocation.kpiDefinition.scoringConfig as ScoringConfig | null,
      measurementConfig: allocation.kpiDefinition.measurementConfig as MeasurementConfig | null,
      target: {
        targetValue: allocation.targetValue,
        targetDate: allocation.targetDate,
        targetMilestone: allocation.targetMilestone,
        targetGrade: allocation.targetGrade,
        targetBoolean: allocation.targetBoolean,
        targetRating: allocation.targetRating,
      },
    });
    if (isAllocationOfficiallyComplete({
      allowMultipleAchievementsPerAllocation:
        allocation.kpiDefinition.allowMultipleAchievementsPerAllocation,
      aggregate,
      targetValue: allocation.targetValue,
      achievements: allocation.achievements,
    })) {
      entry.verifiedCount += 1;
    }
    entry.targetTotal += allocation.targetRating ?? allocation.targetValue ?? 0;
    const latestAchievement = allocation.achievements[0] ?? null;
    const officialScore = allocation.kpiDefinition.allowMultipleAchievementsPerAllocation
      ? aggregate.officialScore
      : latestAchievement
        ? scoreFromAchievement(latestAchievement)
        : null;
    const officialActual = allocation.kpiDefinition.allowMultipleAchievementsPerAllocation
      ? aggregate.officialActualValue
      : latestAchievement?.actualRating ?? latestAchievement?.actualValue ?? 0;
    if (officialScore != null) {
      entry.scoreTotal += officialScore;
      entry.scoredCount += 1;
    }
    entry.achievedTotal += officialActual;

    metrics.set(key, entry);
  }

  const matchedMeasurementTypes = new Set<KpiMeasurementType>();
  const periods = requestedPeriods.map((period) => {
    if (period.id === sourceKpi.kraDefinition.periodId) {
      matchedMeasurementTypes.add(sourceKpi.measurementType);
      const currentMetrics = metrics.get(`${period.id}:${sourceKpi.id}`);
      return {
        periodId: period.id,
        periodName: period.name,
        matchStatus: "matched" as const,
        kpiId: sourceKpi.id,
        measurementType: sourceKpi.measurementType,
        totalAllocations: currentMetrics?.totalAllocations ?? 0,
        verifiedCount: currentMetrics?.verifiedCount ?? 0,
        completionPercent: toPercent(
          currentMetrics?.verifiedCount ?? 0,
          currentMetrics?.totalAllocations ?? 0,
        ),
        averageScore:
          (currentMetrics?.scoredCount ?? 0) > 0
            ? roundToTwo((currentMetrics?.scoreTotal ?? 0) / (currentMetrics?.scoredCount ?? 1))
            : 0,
        targetTotal: currentMetrics?.targetTotal ?? 0,
        achievedTotal: currentMetrics?.achievedTotal ?? 0,
        candidateMatches: [],
      };
    }

    const matches = matchesByPeriod.get(period.id) ?? [];
    if (matches.length === 0) {
      return {
        periodId: period.id,
        periodName: period.name,
        matchStatus: "missing" as const,
        kpiId: null,
        measurementType: null,
        totalAllocations: 0,
        verifiedCount: 0,
        completionPercent: 0,
        averageScore: 0,
        targetTotal: null,
        achievedTotal: null,
        candidateMatches: [],
      };
    }

    if (matches.length > 1) {
      return {
        periodId: period.id,
        periodName: period.name,
        matchStatus: "ambiguous" as const,
        kpiId: null,
        measurementType: null,
        totalAllocations: 0,
        verifiedCount: 0,
        completionPercent: 0,
        averageScore: 0,
        targetTotal: null,
        achievedTotal: null,
        candidateMatches: matches
          .map((match) => ({
            kpiId: match.id,
            kraTitle: match.kraDefinition.title,
            kpiTitle: match.title,
            measurementType: match.measurementType,
          }))
          .sort((left, right) => left.kpiTitle.localeCompare(right.kpiTitle)),
      };
    }

    const match = matches[0]!;
    matchedMeasurementTypes.add(match.measurementType);
    const matchMetrics = metrics.get(`${period.id}:${match.id}`);
    return {
      periodId: period.id,
      periodName: period.name,
      matchStatus: "matched" as const,
      kpiId: match.id,
      measurementType: match.measurementType,
      totalAllocations: matchMetrics?.totalAllocations ?? 0,
      verifiedCount: matchMetrics?.verifiedCount ?? 0,
      completionPercent: toPercent(
        matchMetrics?.verifiedCount ?? 0,
        matchMetrics?.totalAllocations ?? 0,
      ),
      averageScore:
        (matchMetrics?.scoredCount ?? 0) > 0
          ? roundToTwo((matchMetrics?.scoreTotal ?? 0) / (matchMetrics?.scoredCount ?? 1))
          : 0,
      targetTotal: matchMetrics?.targetTotal ?? 0,
      achievedTotal: matchMetrics?.achievedTotal ?? 0,
      candidateMatches: [],
    };
  });

  const numericMode =
    isNumericComparableMeasurement(sourceKpi.measurementType) &&
    [...matchedMeasurementTypes].every((measurementType) => measurementType === sourceKpi.measurementType);

  return {
    sourceKpi: {
      sourceKpiId: sourceKpi.id,
      kraTitle: sourceKpi.kraDefinition.title,
      kpiTitle: sourceKpi.title,
      measurementType: sourceKpi.measurementType,
      unitLabel: sourceKpi.unitLabel,
    },
    comparisonMode: numericMode ? "NUMERIC" : "SCORE_ONLY",
    periods: periods.map((period) => ({
      ...period,
      targetTotal: numericMode && period.matchStatus === "matched" ? period.targetTotal : null,
      achievedTotal: numericMode && period.matchStatus === "matched" ? period.achievedTotal : null,
    })),
  };
}

export async function getKpiCrossComparison(
  tenantId: string,
  periodId: string,
  kpiId: string,
  scopeUnitIds?: string[] | "ALL",
): Promise<KpiCrossComparison | null> {
  const kpi = await prisma.kpiDefinition.findFirst({
    where: { id: kpiId, kraDefinition: { tenantId, periodId } },
    select: {
      title: true,
      measurementType: true,
      allowMultipleAchievementsPerAllocation: true,
      scoringMethod: true,
      scoringDirection: true,
      scoringConfig: true,
      measurementConfig: true,
    },
  });
  if (!kpi) return null;

  const scopeFilter = buildEffectiveUnitFilter(tenantId, scopeUnitIds);
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
      targetValue: true,
      targetDate: true,
      targetMilestone: true,
      targetGrade: true,
      targetBoolean: true,
      targetRating: true,
      assignedToUnit: { select: { id: true, name: true } },
      achievements: {
        orderBy: [{ reportingDate: "desc" }, { createdAt: "desc" }],
        select: {
          state: true,
          effectiveScore: true,
          stageCompletionScore: true,
          computedScore: true,
          actualValue: true,
          actualRating: true,
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
    completedCount: number;
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
      completedCount: 0,
      scoredCount: 0,
      scoreTotal: 0,
    };
    entry.allocationCount += 1;
    const latestAchievement = allocation.achievements[0] ?? null;
    const aggregate = buildAllocationAchievementAggregate({
      allowMultipleAchievementsPerAllocation: kpi.allowMultipleAchievementsPerAllocation,
      achievements: allocation.achievements,
      measurementType: kpi.measurementType,
      scoringMethod: kpi.scoringMethod,
      scoringDirection: kpi.scoringDirection,
      scoringConfig: kpi.scoringConfig as ScoringConfig | null,
      measurementConfig: kpi.measurementConfig as MeasurementConfig | null,
      target: {
        targetValue: allocation.targetValue,
        targetDate: allocation.targetDate,
        targetMilestone: allocation.targetMilestone,
        targetGrade: allocation.targetGrade,
        targetBoolean: allocation.targetBoolean,
        targetRating: allocation.targetRating,
      },
    });
    const officialScore = kpi.allowMultipleAchievementsPerAllocation
      ? aggregate.officialScore
      : latestAchievement
        ? scoreFromAchievement(latestAchievement)
        : null;
    const isComplete = isAllocationOfficiallyComplete({
      allowMultipleAchievementsPerAllocation: kpi.allowMultipleAchievementsPerAllocation,
      aggregate,
      targetValue: allocation.targetValue,
      achievements: allocation.achievements,
    });
    if (isComplete) {
      entry.completedCount += 1;
    }
    if (officialScore != null) {
      entry.scoreTotal += officialScore;
      entry.scoredCount += 1;
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
          ? Math.round((unit.completedCount / unit.allocationCount) * 10000) / 100
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
  const scopeFilter = buildEffectiveUnitFilter(tenantId, scopeUnitIds);
  const scopedData = await loadScopedAggregationData(tenantId, periodId, scopeUnitIds);
  const scopedSummary = summarizeScopedAllocations(scopedData.rows, scopedData.dueDate);

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

  const kpiBuckets = new Map<string, { kpiTitle: string; totalAllocations: number; completedAllocations: number }>();
  for (const row of scopedData.rows) {
    const bucket = kpiBuckets.get(row.kpiDefinitionId) ?? {
      kpiTitle: row.kpiTitle,
      totalAllocations: 0,
      completedAllocations: 0,
    };
    bucket.totalAllocations += 1;
    if (row.hasVerifiedAchievement) {
      bucket.completedAllocations += 1;
    }
    kpiBuckets.set(row.kpiDefinitionId, bucket);
  }

  const lowCompletionKpis = [...kpiBuckets.entries()]
    .map(([kpiId, bucket]) => {
      const totalAllocations = bucket.totalAllocations;
      const completionPercent =
        totalAllocations > 0
          ? Math.round((bucket.completedAllocations / totalAllocations) * 10000) / 100
          : 0;

      return {
        kpiId,
        kpiTitle: bucket.kpiTitle,
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
    overdueAchievements: scopedSummary.overdueCount,
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

  const scopeFilter = buildEffectiveUnitFilter(tenantId, scopeUnitIds);
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

export async function getUnitSummary(
  tenantId: string,
  periodId: string,
  unitId: string,
  scopeMode: "NODE" | "DESCENDANTS",
  effectiveUnitIds: string[],
): Promise<UnitSummary | null> {
  const versionId = await getPublishedVersionId(tenantId);
  if (!versionId) return null;

  const scopedUnitIds = [...new Set(effectiveUnitIds)];
  const scopeFilter = buildEffectiveUnitFilter(tenantId, scopedUnitIds);

  const [unit, allocations, primaryMembers] = await Promise.all([
    prisma.orgUnit.findFirst({
      where: { tenantId, versionId, id: unitId },
      select: { id: true, name: true, code: true },
    }),
    prisma.targetAllocation.findMany({
      where: {
        tenantId,
        periodId,
        ...scopeFilter,
      },
      select: {
        assignedToUserId: true,
        targetValue: true,
        targetDate: true,
        targetMilestone: true,
        targetGrade: true,
        targetBoolean: true,
        targetRating: true,
        kpiDefinitionId: true,
        kpiDefinition: {
          select: {
            id: true,
            title: true,
            measurementType: true,
            allowMultipleAchievementsPerAllocation: true,
            scoringMethod: true,
            scoringDirection: true,
            scoringConfig: true,
            measurementConfig: true,
            _count: { select: { stages: true } },
            kraDefinition: {
              select: {
                id: true,
                title: true,
                weightage: true,
              },
            },
          },
        },
        achievements: {
          orderBy: [{ reportingDate: "desc" }, { createdAt: "desc" }],
          select: {
            state: true,
            effectiveScore: true,
            stageCompletionScore: true,
            computedScore: true,
            actualValue: true,
            actualRating: true,
            stageProgress: { select: { isCompleted: true } },
          },
        },
      },
    }),
    prisma.userOrgAssignment.findMany({
      where: {
        versionId,
        isPrimary: true,
        unitId: { in: scopedUnitIds },
      },
      select: { userId: true },
    }),
  ]);

  if (!unit) return null;

  let completedAllocations = 0;
  let scoreTotal = 0;
  let scoredCount = 0;
  const memberIds = new Set(primaryMembers.map((member) => member.userId));
  const kraBuckets = new Map<string, {
    kraId: string;
    kraTitle: string;
    weightage: number;
    totalAllocations: number;
    completedAllocations: number;
    scoreTotal: number;
    scoredCount: number;
  }>();
  const stageBuckets = new Map<string, {
    kpiId: string;
    kpiTitle: string;
    allocationCount: number;
    stageCount: number;
    completedStages: number;
    totalStages: number;
  }>();

  for (const allocation of allocations) {
    if (allocation.assignedToUserId) {
      memberIds.add(allocation.assignedToUserId);
    }

    const latestAchievement = allocation.achievements[0] ?? null;
    const aggregate = buildAllocationAchievementAggregate({
      allowMultipleAchievementsPerAllocation:
        allocation.kpiDefinition.allowMultipleAchievementsPerAllocation,
      achievements: allocation.achievements,
      measurementType: allocation.kpiDefinition.measurementType,
      scoringMethod: allocation.kpiDefinition.scoringMethod,
      scoringDirection: allocation.kpiDefinition.scoringDirection,
      scoringConfig: allocation.kpiDefinition.scoringConfig as ScoringConfig | null,
      measurementConfig: allocation.kpiDefinition.measurementConfig as MeasurementConfig | null,
      target: {
        targetValue: allocation.targetValue,
        targetDate: allocation.targetDate,
        targetMilestone: allocation.targetMilestone,
        targetGrade: allocation.targetGrade,
        targetBoolean: allocation.targetBoolean,
        targetRating: allocation.targetRating,
      },
    });
    const allocationCompleted = isAllocationOfficiallyComplete({
      allowMultipleAchievementsPerAllocation:
        allocation.kpiDefinition.allowMultipleAchievementsPerAllocation,
      aggregate,
      targetValue: allocation.targetValue,
      achievements: allocation.achievements,
    });
    const latestScore = allocation.kpiDefinition.allowMultipleAchievementsPerAllocation
      ? aggregate.officialScore
      : latestAchievement
        ? scoreFromAchievement(latestAchievement)
        : null;

    if (allocationCompleted) {
      completedAllocations += 1;
    }
    if (latestScore != null) {
      scoreTotal += latestScore;
      scoredCount += 1;
    }

    const kra = allocation.kpiDefinition.kraDefinition;
    const kraBucket = kraBuckets.get(kra.id) ?? {
      kraId: kra.id,
      kraTitle: kra.title,
      weightage: kra.weightage,
      totalAllocations: 0,
      completedAllocations: 0,
      scoreTotal: 0,
      scoredCount: 0,
    };
    kraBucket.totalAllocations += 1;
    if (allocationCompleted) {
      kraBucket.completedAllocations += 1;
    }
    if (latestScore != null) {
      kraBucket.scoreTotal += latestScore;
      kraBucket.scoredCount += 1;
    }
    kraBuckets.set(kra.id, kraBucket);

    if (allocation.kpiDefinition._count.stages > 0) {
      const stageCount = allocation.kpiDefinition._count.stages;
      const completedStages = latestAchievement?.stageProgress.filter((stage) => stage.isCompleted).length ?? 0;
      const totalStages = latestAchievement?.stageProgress.length ?? stageCount;
      const stageBucket = stageBuckets.get(allocation.kpiDefinitionId) ?? {
        kpiId: allocation.kpiDefinitionId,
        kpiTitle: allocation.kpiDefinition.title,
        allocationCount: 0,
        stageCount,
        completedStages: 0,
        totalStages: 0,
      };
      stageBucket.allocationCount += 1;
      stageBucket.completedStages += completedStages;
      stageBucket.totalStages += totalStages;
      stageBuckets.set(allocation.kpiDefinitionId, stageBucket);
    }
  }

  return {
    unitId: unit.id,
    unitName: unit.name,
    unitCode: unit.code,
    scopeMode,
    effectiveUnitCount: scopedUnitIds.length,
    memberCount: memberIds.size,
    totalAllocations: allocations.length,
    completedAllocations,
    completionPercent: toPercent(completedAllocations, allocations.length),
    averageScore: scoredCount > 0 ? roundToTwo(scoreTotal / scoredCount) : 0,
    kraBreakdown: [...kraBuckets.values()]
      .map((bucket) => ({
        kraId: bucket.kraId,
        kraTitle: bucket.kraTitle,
        weightage: bucket.weightage,
        totalAllocations: bucket.totalAllocations,
        completedAllocations: bucket.completedAllocations,
        completionPercent: toPercent(bucket.completedAllocations, bucket.totalAllocations),
        averageScore: bucket.scoredCount > 0 ? roundToTwo(bucket.scoreTotal / bucket.scoredCount) : 0,
      }))
      .sort((left, right) => left.kraTitle.localeCompare(right.kraTitle)),
    stageKpiOptions: [...stageBuckets.values()]
      .map((bucket) => ({
        kpiId: bucket.kpiId,
        kpiTitle: bucket.kpiTitle,
        allocationCount: bucket.allocationCount,
        stageCount: bucket.stageCount,
        completionPercent: toPercent(bucket.completedStages, bucket.totalStages),
      }))
      .sort((left, right) =>
        left.completionPercent === right.completionPercent
          ? left.kpiTitle.localeCompare(right.kpiTitle)
          : left.completionPercent - right.completionPercent,
      ),
  };
}

export async function getUnitMembersSummary(
  tenantId: string,
  periodId: string,
  effectiveUnitIds: string[],
): Promise<UnitMemberSummary[]> {
  const versionId = await getPublishedVersionId(tenantId);
  if (!versionId) return [];

  const scopedUnitIds = [...new Set(effectiveUnitIds)];
  const scopeFilter = buildEffectiveUnitFilter(tenantId, scopedUnitIds);
  const [period, primaryAssignments, allocations] = await Promise.all([
    prisma.assessmentPeriod.findFirst({
      where: { id: periodId, tenantId },
      select: { achievementDeadline: true, endDate: true },
    }),
    prisma.userOrgAssignment.findMany({
      where: {
        versionId,
        isPrimary: true,
        unitId: { in: scopedUnitIds },
      },
      select: {
        userId: true,
        unitId: true,
        unit: { select: { name: true } },
        user: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.targetAllocation.findMany({
      where: {
        tenantId,
        periodId,
        assignedToUserId: { not: null },
        ...scopeFilter,
      },
      select: {
        assignedToUserId: true,
        targetValue: true,
        targetDate: true,
        targetMilestone: true,
        targetGrade: true,
        targetBoolean: true,
        targetRating: true,
        assignedToUser: { select: { firstName: true, lastName: true } },
        kpiDefinition: {
          select: {
            measurementType: true,
            allowMultipleAchievementsPerAllocation: true,
            scoringMethod: true,
            scoringDirection: true,
            scoringConfig: true,
            measurementConfig: true,
          },
        },
        achievements: {
          orderBy: [{ reportingDate: "desc" }, { createdAt: "desc" }],
          select: {
            state: true,
            effectiveScore: true,
            stageCompletionScore: true,
            computedScore: true,
            actualValue: true,
            actualRating: true,
          },
        },
      },
    }),
  ]);

  const dueDate = period?.achievementDeadline ?? period?.endDate ?? null;
  const now = new Date();
  const members = new Map<string, {
    userId: string;
    userName: string;
    primaryUnitId: string | null;
    primaryUnitName: string;
    totalAllocations: number;
    completedAllocations: number;
    scoreTotal: number;
    scoredCount: number;
    overdueCount: number;
  }>();

  for (const assignment of primaryAssignments) {
    members.set(assignment.userId, {
      userId: assignment.userId,
      userName: formatUserName(assignment.user),
      primaryUnitId: assignment.unitId,
      primaryUnitName: assignment.unit.name,
      totalAllocations: 0,
      completedAllocations: 0,
      scoreTotal: 0,
      scoredCount: 0,
      overdueCount: 0,
    });
  }

  for (const allocation of allocations) {
    if (!allocation.assignedToUserId) continue;

    const entry = members.get(allocation.assignedToUserId) ?? {
      userId: allocation.assignedToUserId,
      userName: formatUserName(allocation.assignedToUser),
      primaryUnitId: null,
      primaryUnitName: "Unassigned",
      totalAllocations: 0,
      completedAllocations: 0,
      scoreTotal: 0,
      scoredCount: 0,
      overdueCount: 0,
    };

    entry.totalAllocations += 1;
    const latestAchievement = allocation.achievements[0] ?? null;
    const aggregate = buildAllocationAchievementAggregate({
      allowMultipleAchievementsPerAllocation:
        allocation.kpiDefinition.allowMultipleAchievementsPerAllocation,
      achievements: allocation.achievements,
      measurementType: allocation.kpiDefinition.measurementType,
      scoringMethod: allocation.kpiDefinition.scoringMethod,
      scoringDirection: allocation.kpiDefinition.scoringDirection,
      scoringConfig: allocation.kpiDefinition.scoringConfig as ScoringConfig | null,
      measurementConfig: allocation.kpiDefinition.measurementConfig as MeasurementConfig | null,
      target: {
        targetValue: allocation.targetValue,
        targetDate: allocation.targetDate,
        targetMilestone: allocation.targetMilestone,
        targetGrade: allocation.targetGrade,
        targetBoolean: allocation.targetBoolean,
        targetRating: allocation.targetRating,
      },
    });
    const allocationCompleted = isAllocationOfficiallyComplete({
      allowMultipleAchievementsPerAllocation:
        allocation.kpiDefinition.allowMultipleAchievementsPerAllocation,
      aggregate,
      targetValue: allocation.targetValue,
      achievements: allocation.achievements,
    });
    if (allocationCompleted) {
      entry.completedAllocations += 1;
    }

    const officialScore = allocation.kpiDefinition.allowMultipleAchievementsPerAllocation
      ? aggregate.officialScore
      : latestAchievement
        ? scoreFromAchievement(latestAchievement)
        : null;
    if (officialScore != null) {
      entry.scoreTotal += officialScore;
      entry.scoredCount += 1;
    }

    if (dueDate && now > dueDate && !allocationCompleted) {
      entry.overdueCount += 1;
    }

    members.set(allocation.assignedToUserId, entry);
  }

  return [...members.values()]
    .map((entry) => {
      const overallScore = entry.scoredCount > 0 ? roundToTwo(entry.scoreTotal / entry.scoredCount) : 0;
      const completionPercent = toPercent(entry.completedAllocations, entry.totalAllocations);
      return {
        userId: entry.userId,
        userName: entry.userName,
        primaryUnitId: entry.primaryUnitId,
        primaryUnitName: entry.primaryUnitName,
        totalAllocations: entry.totalAllocations,
        completedAllocations: entry.completedAllocations,
        completionPercent,
        overallScore,
        overdueCount: entry.overdueCount,
        alertLevel: scoreToAlertLevel(overallScore, completionPercent, entry.overdueCount),
      };
    })
    .sort((left, right) => left.userName.localeCompare(right.userName));
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

  const primaryAssignment = versionId
    ? await prisma.userOrgAssignment.findFirst({
        where: { versionId, userId, isPrimary: true },
        include: { unit: { select: { name: true, code: true } } },
      })
    : null;

  const scopeFilter = buildEffectiveUnitFilter(tenantId, scopeUnitIds);
  const allocations = await prisma.targetAllocation.findMany({
    where: {
      tenantId,
      periodId,
      assignedToUserId: userId,
      ...scopeFilter,
    },
    select: {
      id: true,
      kpiDefinitionId: true,
      targetValue: true,
      targetDate: true,
      targetMilestone: true,
      targetGrade: true,
      targetBoolean: true,
      targetRating: true,
      kpiDefinition: {
        select: {
          title: true,
          measurementType: true,
          unitLabel: true,
          allowMultipleAchievementsPerAllocation: true,
          scoringMethod: true,
          scoringDirection: true,
          scoringConfig: true,
          measurementConfig: true,
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
          actualValue: true,
          actualRating: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const period = await prisma.assessmentPeriod.findFirst({
    where: { id: periodId, tenantId },
    select: { achievementDeadline: true, endDate: true },
  });
  if (
    scopeUnitIds &&
    scopeUnitIds !== "ALL" &&
    primaryAssignment &&
    !scopeUnitIds.includes(primaryAssignment.unitId) &&
    allocations.length === 0
  ) {
    return null;
  }
  if (scopeUnitIds && scopeUnitIds !== "ALL" && !primaryAssignment && allocations.length === 0) {
    return null;
  }
  const dueDate = period?.achievementDeadline ?? period?.endDate ?? null;
  const now = new Date();

  let overallScore = 0;
  let scoredCount = 0;
  let completedCount = 0;

  const allocationRows = await Promise.all(
    allocations.map(async (allocation) => {
      const latestAchievement = allocation.achievements[0] ?? null;
      const aggregate = buildAllocationAchievementAggregate({
        allowMultipleAchievementsPerAllocation:
          allocation.kpiDefinition.allowMultipleAchievementsPerAllocation,
        achievements: allocation.achievements,
        measurementType: allocation.kpiDefinition.measurementType,
        scoringMethod: allocation.kpiDefinition.scoringMethod,
        scoringDirection: allocation.kpiDefinition.scoringDirection,
        scoringConfig: allocation.kpiDefinition.scoringConfig as ScoringConfig | null,
        measurementConfig: allocation.kpiDefinition.measurementConfig as MeasurementConfig | null,
        target: {
          targetValue: allocation.targetValue,
          targetDate: allocation.targetDate,
          targetMilestone: allocation.targetMilestone,
          targetGrade: allocation.targetGrade,
          targetBoolean: allocation.targetBoolean,
          targetRating: allocation.targetRating,
        },
      });
      const stageRows = latestAchievement
        ? await getStageProgressForAchievement(latestAchievement.id, tenantId)
        : [];
      const stagesTotal = stageRows.length || allocation.kpiDefinition._count.stages;
      const stagesComplete = stageRows.filter((stage) => stage.isCompleted).length;
      const state = latestAchievement?.state ?? "NOT_STARTED";
      const score = allocation.kpiDefinition.allowMultipleAchievementsPerAllocation
        ? aggregate.officialScore ?? 0
        : scoreFromAchievement(latestAchievement);
      const targetDisplay = formatTargetDisplay(
        allocation.kpiDefinition.measurementType,
        allocation,
        allocation.kpiDefinition.unitLabel,
      );
      const isOverdue =
        stageRows.length > 0
          ? stageRows.some((stage) => stage.isOverdue)
          : Boolean(dueDate && now > dueDate && state !== "VERIFIED");
      const isComplete = isAllocationOfficiallyComplete({
        allowMultipleAchievementsPerAllocation:
          allocation.kpiDefinition.allowMultipleAchievementsPerAllocation,
        aggregate,
        targetValue: allocation.targetValue,
        achievements: allocation.achievements,
      });
      const progressCompletionPercent =
        stagesTotal > 0
          ? Math.round((stagesComplete / stagesTotal) * 100)
          : allocation.kpiDefinition.allowMultipleAchievementsPerAllocation && allocation.targetValue
            ? Math.min(100, Math.round((aggregate.officialActualValue / allocation.targetValue) * 100))
            : isComplete
              ? 100
              : 0;

      overallScore += score;
      if (
        allocation.kpiDefinition.allowMultipleAchievementsPerAllocation
          ? aggregate.officialScore != null
          : latestAchievement != null
      ) {
        scoredCount += 1;
      }
      if (isComplete) {
        completedCount += 1;
      }

      return {
        allocationId: allocation.id,
        kpiDefinitionId: allocation.kpiDefinitionId,
        kpiTitle: allocation.kpiDefinition.title,
        measurementType: allocation.kpiDefinition.measurementType,
        unitLabel: allocation.kpiDefinition.unitLabel,
        target: targetDisplay,
        targetDisplay,
        latestAchievementId: latestAchievement?.id ?? null,
        stagesComplete,
        stagesTotal,
        completionPercent: progressCompletionPercent,
        score,
        state,
        isOverdue,
        stageRows,
      };
    }),
  );

  return {
    userId: user.id,
    userName: `${user.firstName} ${user.lastName}`,
    unitName: primaryAssignment?.unit?.name ?? "—",
    primaryUnitId: primaryAssignment?.unitId ?? null,
    primaryUnitCode: primaryAssignment?.unit?.code ?? null,
    allocations: allocationRows,
    overallScore: roundToTwo(overallScore),
    averageScore: scoredCount > 0 ? roundToTwo(overallScore / scoredCount) : 0,
    overallCompletion:
      allocationRows.length > 0 ? Math.round((completedCount / allocationRows.length) * 100) : 0,
  };
}
