import { prisma } from "@/lib/prisma";
import { getUserAssignments } from "@/lib/org-structure/roles-service";
import {
  computeReviewCycles,
  isDateWithinInclusiveUtcRange,
} from "./period-service";
import type {
  MyKpiContext,
  MyAllocationView,
  AchievementView,
  AdditionalAchievementView,
  ReviewQueueItem,
  MyDashboardSummary,
  ChildAllocationSummary,
  AchievementFormConfig,
  VerificationLogEntry,
  MeasurementConfig,
} from "./shared";

// ── Build MyKpiContext ───────────────────────────────────────────────────────

export async function getMyKpiContext(
  tenantId: string,
  userId: string,
): Promise<MyKpiContext> {
  const assignments = await getUserAssignments(tenantId, userId);

  const headOfUnits = assignments
    .filter((a) => a.isUnitHead)
    .map((a) => ({ unitId: a.unitId, unitName: a.unitName, unitCode: a.unitCode }));

  const memberOfUnits = assignments.map((a) => ({
    unitId: a.unitId,
    unitName: a.unitName,
    unitCode: a.unitCode,
  }));

  return { userId, headOfUnits, memberOfUnits };
}

export async function isUserHeadOfUnit(
  tenantId: string,
  userId: string,
  unitId: string,
): Promise<boolean> {
  const context = await getMyKpiContext(tenantId, userId);

  return context.headOfUnits.some((unit) => unit.unitId === unitId);
}

function findCycleNumberForDate(
  reportingDate: Date,
  period: { startDate: Date; endDate: Date; reviewFrequency: string },
): number {
  const cycles = computeReviewCycles(
    period.startDate,
    period.endDate,
    period.reviewFrequency,
  );

  const cycle = cycles.find(
    (item) => isDateWithinInclusiveUtcRange(reportingDate, item.startDate, item.endDate),
  );

  return cycle?.cycleNumber ?? 1;
}

async function getPrimaryUserUnitId(
  tenantId: string,
  userId: string,
): Promise<string | null> {
  const publishedVersion = await prisma.orgStructureVersion.findFirst({
    where: {
      tenantId,
      state: { in: ["PUBLISHED", "VALIDATED"] },
    },
    orderBy: { versionNumber: "desc" },
    select: { id: true },
  });

  if (publishedVersion) {
    const primaryAssignment = await prisma.userOrgAssignment.findFirst({
      where: {
        versionId: publishedVersion.id,
        userId,
        isPrimary: true,
      },
      select: { unitId: true },
    });

    if (primaryAssignment?.unitId) {
      return primaryAssignment.unitId;
    }

    const fallbackAssignment = await prisma.userOrgAssignment.findFirst({
      where: {
        versionId: publishedVersion.id,
        userId,
      },
      orderBy: { isPrimary: "desc" },
      select: { unitId: true },
    });

    if (fallbackAssignment?.unitId) {
      return fallbackAssignment.unitId;
    }
  }

  const assignments = await getUserAssignments(tenantId, userId);
  return assignments[0]?.unitId ?? null;
}

async function getAchievementScopeUnitIds(
  tenantId: string,
  achievement: {
    reportedByUserId: string;
    targetAllocation: {
      assignedToUnitId: string | null;
      assignedToUserId: string | null;
    } | null;
  },
): Promise<string[]> {
  if (achievement.targetAllocation?.assignedToUnitId) {
    return [achievement.targetAllocation.assignedToUnitId];
  }

  const assigneeUserId =
    achievement.targetAllocation?.assignedToUserId ?? achievement.reportedByUserId;
  const primaryUnitId = await getPrimaryUserUnitId(tenantId, assigneeUserId);

  return primaryUnitId ? [primaryUnitId] : [];
}

// ── Get My Allocations ───────────────────────────────────────────────────────

export async function getMyAllocations(
  tenantId: string,
  userId: string,
  periodId: string,
): Promise<MyAllocationView[]> {
  const ctx = await getMyKpiContext(tenantId, userId);
  const headUnitIds = ctx.headOfUnits.map((u) => u.unitId);

  // Fetch allocations where:
  // 1. assigned to user directly, OR
  // 2. assigned to a unit the user heads (dept-level)
  const allocations = await prisma.targetAllocation.findMany({
    where: {
      tenantId,
      periodId,
      OR: [
        { assignedToUserId: userId },
        ...(headUnitIds.length > 0
          ? [{ assignedToUnitId: { in: headUnitIds } }]
          : []),
      ],
    },
    include: {
      kpiDefinition: {
        include: {
          kraDefinition: {
            select: {
              id: true,
              title: true,
              weightage: true,
              category: { select: { displayLabel: true, categoryKey: true } },
            },
          },
          startingUnit: { select: { id: true, name: true } },
        },
      },
      assignedToUnit: { select: { name: true } },
      assignedToUser: { select: { id: true, firstName: true, lastName: true } },
      parentAllocation: { select: { targetValue: true } },
      childAllocations: {
        include: {
          assignedToUser: { select: { id: true, firstName: true, lastName: true } },
          assignedToUnit: { select: { id: true, name: true } },
          achievements: {
            where: { reportedByUserId: { not: undefined } },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              state: true,
              actualValue: true,
              computedScore: true,
            },
          },
        },
      },
      achievements: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { kpiDefinition: { select: { title: true } } },
      },
      period: {
        select: {
          state: true,
          name: true,
          startDate: true,
          achievementDeadline: true,
          endDate: true,
          reviewFrequency: true,
        },
      },
      _count: { select: { childAllocations: true, achievements: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // Filter out: KPI DRAFT or 0 weightage
  const filtered = allocations.filter((a) => {
    const kpi = a.kpiDefinition;
    if (kpi.state !== "ACTIVE") return false;
    if (kpi.weightage === 0) return false;
    return true;
  });

  // Build user name lookup for achievement views
  const reporterIds = filtered
    .flatMap((a) => a.achievements.map((ach) => ach.reportedByUserId))
    .filter(Boolean);
  const reporters = reporterIds.length > 0
    ? await prisma.user.findMany({
        where: { id: { in: [...new Set(reporterIds)] } },
        select: { id: true, firstName: true, lastName: true },
      })
    : [];
  const reporterMap = new Map(
    reporters.map((u) => [u.id, `${u.firstName} ${u.lastName}`]),
  );

  return filtered.map((a): MyAllocationView => {
    const kpi = a.kpiDefinition;
    const kra = kpi.kraDefinition;
    const latestAch = a.achievements[0] ?? null;
    const isHead = headUnitIds.includes(a.assignedToUnitId ?? "");
    const section: "department" | "individual" = a.assignedToUnitId && isHead
      ? "department"
      : "individual";

    const childSummaries: ChildAllocationSummary[] = a.childAllocations.map((c) => {
      const childAch = c.achievements[0] ?? null;
      return {
        id: c.id,
        assignedToUserId: c.assignedToUser?.id ?? null,
        assignedToUnitId: c.assignedToUnit?.id ?? null,
        assignedToUserName: c.assignedToUser
          ? `${c.assignedToUser.firstName} ${c.assignedToUser.lastName}`
          : null,
        assignedToUnitName: c.assignedToUnit?.name ?? null,
        targetValue: c.targetValue,
        achievementState: childAch?.state ?? null,
        actualValue: childAch?.actualValue ?? null,
        computedScore: childAch?.computedScore ?? null,
      };
    });

    const achievementView: AchievementView | null = latestAch
      ? {
          id: latestAch.id,
          tenantId: latestAch.tenantId,
          periodId: latestAch.periodId,
          kpiDefinitionId: latestAch.kpiDefinitionId,
          kpiTitle: latestAch.kpiDefinition.title,
          targetAllocationId: latestAch.targetAllocationId,
          reportedByUserId: latestAch.reportedByUserId,
          reportedByUserName: reporterMap.get(latestAch.reportedByUserId) ?? "Unknown",
          actualValue: latestAch.actualValue,
          actualDate: latestAch.actualDate,
          actualMilestone: latestAch.actualMilestone,
          actualGrade: latestAch.actualGrade,
          actualBoolean: latestAch.actualBoolean,
          actualRating: latestAch.actualRating,
          evidenceDescription: latestAch.evidenceDescription,
          evidenceLinks: latestAch.evidenceLinks,
          achievementFormData: latestAch.achievementFormData as Record<string, unknown> | null,
          computedScore: latestAch.computedScore,
          state: latestAch.state,
          recommendedByUserId: latestAch.recommendedByUserId,
          recommendedAt: latestAch.recommendedAt,
          recommendationNote: latestAch.recommendationNote,
          verifiedByUserId: latestAch.verifiedByUserId,
          verifiedAt: latestAch.verifiedAt,
          verificationNote: latestAch.verificationNote,
          rejectionReason: latestAch.rejectionReason,
          verificationLog: (latestAch.verificationLog as VerificationLogEntry[]) ?? [],
          reportingDate: latestAch.reportingDate,
          createdAt: latestAch.createdAt,
        }
      : null;

    return {
      id: a.id,
      tenantId: a.tenantId,
      periodId: a.periodId,
      kpiDefinitionId: a.kpiDefinitionId,
      kpiTitle: kpi.title,
      assignedToUnitId: a.assignedToUnitId,
      assignedToUnitName: a.assignedToUnit?.name ?? null,
      assignedToUserId: a.assignedToUserId,
      assignedToUserName: a.assignedToUser
        ? `${a.assignedToUser.firstName} ${a.assignedToUser.lastName}`
        : null,
      allocatedByUserId: a.allocatedByUserId,
      targetValue: a.targetValue,
      targetDate: a.targetDate,
      targetMilestone: a.targetMilestone,
      targetGrade: a.targetGrade,
      targetBoolean: a.targetBoolean,
      targetRating: a.targetRating,
      state: a.state,
      lockedAt: a.lockedAt,
      parentAllocationId: a.parentAllocationId,
      notes: a.notes,
      childCount: a._count.childAllocations,
      achievementCount: a._count.achievements,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      // Extended fields
      kraTitle: kra.title,
      kraWeightage: kra.weightage,
      categoryLabel: kra.category?.displayLabel ?? null,
      categoryKey: kra.category?.categoryKey ?? null,
      measurementType: kpi.measurementType,
      measurementConfig: kpi.measurementConfig as MeasurementConfig | null,
      unitLabel: kpi.unitLabel,
      kpiWeightage: kpi.weightage,
      defaultTarget: kpi.defaultTarget,
      scoringDirection: kpi.scoringDirection,
      isPerCapita: kpi.isPerCapita,
      allocationType: kpi.allocationType,
      startingUnitId: kpi.startingUnit.id,
      startingUnitName: kpi.startingUnit.name,
      guidanceNotes: kpi.guidanceNotes,
      achievementTemplateKey: kpi.achievementTemplateKey,
      achievementFormConfig: kpi.achievementFormConfig as AchievementFormConfig | null,
      periodState: a.period.state,
      periodName: a.period.name,
      periodStartDate: a.period.startDate,
      achievementDeadline: a.period.achievementDeadline,
      periodEndDate: a.period.endDate,
      reviewFrequency: a.period.reviewFrequency,
      achievement: achievementView,
      parentTargetValue: a.parentAllocation?.targetValue ?? null,
      section,
      childAllocations: childSummaries,
    };
  });
}

// ── Get Review Queue ─────────────────────────────────────────────────────────

export async function getMyReviewQueue(
  tenantId: string,
  userId: string,
  periodId: string,
): Promise<ReviewQueueItem[]> {
  const ctx = await getMyKpiContext(tenantId, userId);
  if (ctx.headOfUnits.length === 0) return [];

  const headUnitIds = ctx.headOfUnits.map((u) => u.unitId);
  const items: ReviewQueueItem[] = [];

  // Level 1: Recommendation queue — SUBMITTED achievements scoped to the user's review units
  const submittedAchievements = await prisma.achievement.findMany({
    where: {
      tenantId,
      periodId,
      state: "SUBMITTED",
      reportedByUserId: { not: userId },
    },
    include: {
      kpiDefinition: {
        select: {
          title: true,
          measurementType: true,
          unitLabel: true,
          startingUnitId: true,
          achievementFormConfig: true,
        },
      },
      targetAllocation: {
        select: { targetValue: true, assignedToUnitId: true, assignedToUserId: true },
      },
    },
  });

  // Filter: only include items where user is actually head of the unit
  for (const ach of submittedAchievements) {
    const assigneeUnitIds = await getAchievementScopeUnitIds(tenantId, {
      reportedByUserId: ach.reportedByUserId,
      targetAllocation: ach.targetAllocation,
    });
    if (assigneeUnitIds.length === 0) continue;

    const usesShortcut = assigneeUnitIds.includes(ach.kpiDefinition.startingUnitId);
    const canRecommend = assigneeUnitIds.some((unitId) => headUnitIds.includes(unitId));
    const canVerify = headUnitIds.includes(ach.kpiDefinition.startingUnitId);

    if (usesShortcut) {
      if (!canVerify) continue;
    } else if (!canRecommend) {
      continue;
    }

    const reporter = await prisma.user.findUnique({
      where: { id: ach.reportedByUserId },
      select: { firstName: true, lastName: true },
    });
    const membership = await prisma.membership.findFirst({
      where: { tenantId, userId: ach.reportedByUserId },
      select: { designation: true },
    });

    items.push({
      achievementId: ach.id,
      facultyUserId: ach.reportedByUserId,
      facultyName: reporter ? `${reporter.firstName} ${reporter.lastName}` : "Unknown",
      facultyDesignation: membership?.designation ?? null,
      kpiTitle: ach.kpiDefinition.title,
      kpiDefinitionId: ach.kpiDefinitionId,
      targetValue: ach.targetAllocation?.targetValue ?? null,
      actualValue: ach.actualValue,
      measurementType: ach.kpiDefinition.measurementType,
      unitLabel: ach.kpiDefinition.unitLabel,
      achievementState: ach.state,
      achievementFormData: ach.achievementFormData as Record<string, unknown> | null,
      achievementFormConfig: ach.kpiDefinition.achievementFormConfig as AchievementFormConfig | null,
      evidenceDescription: ach.evidenceDescription,
      evidenceLinks: ach.evidenceLinks,
      verificationLog: (ach.verificationLog as VerificationLogEntry[]) ?? [],
      reportingDate: ach.reportingDate,
      reviewLevel: usesShortcut ? "VERIFY" : "RECOMMEND",
      startingUnitId: ach.kpiDefinition.startingUnitId,
    });
  }

  // Level 2: Verification queue — RECOMMENDED achievements for KPIs starting from units the user heads
  const recommendedAchievements = await prisma.achievement.findMany({
    where: {
      tenantId,
      periodId,
      state: "RECOMMENDED",
      kpiDefinition: { startingUnitId: { in: headUnitIds } },
    },
    include: {
      kpiDefinition: {
        select: {
          title: true,
          measurementType: true,
          unitLabel: true,
          startingUnitId: true,
          achievementFormConfig: true,
        },
      },
      targetAllocation: {
        select: { targetValue: true },
      },
    },
  });

  for (const ach of recommendedAchievements) {
    const reporter = await prisma.user.findUnique({
      where: { id: ach.reportedByUserId },
      select: { firstName: true, lastName: true },
    });
    const membership = await prisma.membership.findFirst({
      where: { tenantId, userId: ach.reportedByUserId },
      select: { designation: true },
    });

    items.push({
      achievementId: ach.id,
      facultyUserId: ach.reportedByUserId,
      facultyName: reporter ? `${reporter.firstName} ${reporter.lastName}` : "Unknown",
      facultyDesignation: membership?.designation ?? null,
      kpiTitle: ach.kpiDefinition.title,
      kpiDefinitionId: ach.kpiDefinitionId,
      targetValue: ach.targetAllocation?.targetValue ?? null,
      actualValue: ach.actualValue,
      measurementType: ach.kpiDefinition.measurementType,
      unitLabel: ach.kpiDefinition.unitLabel,
      achievementState: ach.state,
      achievementFormData: ach.achievementFormData as Record<string, unknown> | null,
      achievementFormConfig: ach.kpiDefinition.achievementFormConfig as AchievementFormConfig | null,
      evidenceDescription: ach.evidenceDescription,
      evidenceLinks: ach.evidenceLinks,
      verificationLog: (ach.verificationLog as VerificationLogEntry[]) ?? [],
      reportingDate: ach.reportingDate,
      reviewLevel: "VERIFY",
      startingUnitId: ach.kpiDefinition.startingUnitId,
    });
  }

  return items;
}

// ── Get Dashboard Summary ────────────────────────────────────────────────────

export async function getMyDashboardSummary(
  tenantId: string,
  userId: string,
  periodId: string,
): Promise<MyDashboardSummary | null> {
  const period = await prisma.assessmentPeriod.findFirst({
    where: { id: periodId, tenantId },
    select: { name: true },
  });
  if (!period) return null;

  const allocs = await getMyAllocations(tenantId, userId, periodId);

  const statusCounts: Record<string, number> = {
    notStarted: 0,
    inProgress: 0,
    pendingReview: 0,
    completed: 0,
    notApproved: 0,
    needsCascade: 0,
  };

  const kraMap = new Map<string, {
    kraId: string;
    kraTitle: string;
    kraWeightage: number;
    kpis: { weightage: number; score: number | null; verified: boolean }[];
  }>();

  let pendingReviewCount = 0;

  for (const a of allocs) {
    const ach = a.achievement;

    if (!ach) {
      if (a.section === "department" && (a.allocationType === "INDIVIDUAL" || a.allocationType === "BOTH") && a.childCount === 0) {
        statusCounts.needsCascade++;
      } else {
        statusCounts.notStarted++;
      }
    } else {
      switch (ach.state) {
        case "DRAFT": statusCounts.inProgress++; break;
        case "SUBMITTED":
        case "RECOMMENDED": statusCounts.pendingReview++; pendingReviewCount++; break;
        case "VERIFIED": statusCounts.completed++; break;
        case "REJECTED": statusCounts.notApproved++; break;
      }
    }

    // Build KRA breakdown
    const kraKey = a.kraTitle;
    if (!kraMap.has(kraKey)) {
      kraMap.set(kraKey, {
        kraId: kraKey,
        kraTitle: a.kraTitle,
        kraWeightage: a.kraWeightage,
        kpis: [],
      });
    }
    kraMap.get(kraKey)!.kpis.push({
      weightage: a.kpiWeightage,
      score: ach?.state === "VERIFIED" ? ach.computedScore : null,
      verified: ach?.state === "VERIFIED",
    });
  }

  // Compute weighted score
  let weightedScore = 0;
  let maxPossible = 0;
  const kraBreakdown: MyDashboardSummary["kraBreakdown"] = [];

  for (const [, kra] of kraMap) {
    let kraScore = 0;
    let kraVerified = 0;
    let kraScoreSum = 0;
    for (const kpi of kra.kpis) {
      maxPossible += kpi.weightage;
      if (kpi.verified && kpi.score != null) {
        weightedScore += (kpi.score * kpi.weightage) / 100;
        kraScoreSum += kpi.score;
        kraVerified++;
      }
    }

    kraScore = kraVerified > 0 ? kraScoreSum / kraVerified : 0;
    kraBreakdown.push({
      kraId: kra.kraId,
      kraTitle: kra.kraTitle,
      kraWeightage: kra.kraWeightage,
      kpiCount: kra.kpis.length,
      verifiedCount: kraVerified,
      avgScore: Math.round(kraScore * 100) / 100,
    });
  }

  const overallPercentage = maxPossible > 0
    ? Math.round((weightedScore / maxPossible) * 100 * 100) / 100
    : 0;

  // Additional achievements (targetAllocationId IS NULL)
  const additionalAchievementsList = await prisma.achievement.findMany({
    where: {
      tenantId,
      periodId,
      reportedByUserId: userId,
      targetAllocationId: null,
    },
    include: {
      kpiDefinition: {
        select: {
          title: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const additionalAchievements = {
    total: additionalAchievementsList.length,
    verified: additionalAchievementsList.filter((a) => a.state === "VERIFIED").length,
    pending: additionalAchievementsList.filter(
      (a) => a.state === "SUBMITTED" || a.state === "RECOMMENDED",
    ).length,
    notApproved: additionalAchievementsList.filter((a) => a.state === "REJECTED").length,
    items: additionalAchievementsList.map((achievement) => ({
      id: achievement.id,
      kpiTitle: achievement.kpiDefinition.title,
      state: achievement.state,
      reportingDate: achievement.reportingDate,
    })),
  };

  // Upcoming deadline count (within 7 days) and overdue count
  const today = new Date();
  const in7Days = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  let upcomingDeadlineCount = 0;
  let overdueCount = 0;

  for (const a of allocs) {
    if (a.achievement?.state === "VERIFIED") continue;
    if (!a.achievementDeadline) continue;
    const deadline = new Date(a.achievementDeadline);
    if (deadline < today) {
      overdueCount++;
    } else if (deadline <= in7Days) {
      upcomingDeadlineCount++;
    }
  }

  return {
    periodId,
    periodName: period.name,
    totalAllocations: allocs.length,
    statusCounts,
    overallWeightedScore: Math.round(weightedScore * 100) / 100,
    maxPossibleScore: maxPossible,
    overallPercentage,
    kraBreakdown,
    pendingReviewCount,
    additionalAchievements,
    upcomingDeadlineCount,
    overdueCount,
  };
}

// ── Get Unit Members (for cascade) ───────────────────────────────────────────

export async function getMyUnitMembers(
  tenantId: string,
  unitId: string,
): Promise<{ userId: string; userName: string; isUnitHead: boolean }[]> {
  const version = await prisma.orgStructureVersion.findFirst({
    where: {
      tenantId,
      state: { in: ["PUBLISHED", "VALIDATED"] },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!version) return [];

  const assignments = await prisma.orgRoleAssignment.findMany({
    where: {
      versionId: version.id,
      unitId,
      isActive: true,
    },
    include: {
      user: { select: { id: true, firstName: true, lastName: true } },
      roleDefinition: { select: { isUnitHead: true } },
    },
  });

  const userMap = new Map<string, { userId: string; userName: string; isUnitHead: boolean }>();
  for (const a of assignments) {
    const existing = userMap.get(a.userId);
    const isHead = a.roleDefinition?.isUnitHead ?? false;
    if (!existing) {
      userMap.set(a.userId, {
        userId: a.userId,
        userName: `${a.user.firstName} ${a.user.lastName}`,
        isUnitHead: isHead,
      });
    } else if (isHead) {
      existing.isUnitHead = true;
    }
  }

  return Array.from(userMap.values());
}

// ── Get Child Units (for cascade to sub-units) ──────────────────────────────

export async function getMyChildUnits(
  tenantId: string,
  unitId: string,
): Promise<{ unitId: string; unitName: string; unitCode: string }[]> {
  const children = await prisma.orgUnit.findMany({
    where: { parentId: unitId, tenantId },
    select: { id: true, name: true, code: true },
    orderBy: { sortOrder: "asc" },
  });

  return children.map((c) => ({
    unitId: c.id,
    unitName: c.name,
    unitCode: c.code,
  }));
}

// ── Pending Action Count (for nav badge) ─────────────────────────────────────

export async function getMyPendingCount(
  tenantId: string,
  userId: string,
): Promise<number> {
  const ctx = await getMyKpiContext(tenantId, userId);
  if (ctx.headOfUnits.length === 0) return 0;

  const headUnitIds = ctx.headOfUnits.map((u) => u.unitId);
  let submittedCount = 0;

  const submittedAchievements = await prisma.achievement.findMany({
    where: {
      tenantId,
      state: "SUBMITTED",
    },
    include: {
      kpiDefinition: {
        select: { startingUnitId: true },
      },
      targetAllocation: {
        select: { assignedToUnitId: true, assignedToUserId: true },
      },
    },
  });

  for (const ach of submittedAchievements) {
    const assigneeUnitIds = await getAchievementScopeUnitIds(tenantId, {
      reportedByUserId: ach.reportedByUserId,
      targetAllocation: ach.targetAllocation,
    });
    if (assigneeUnitIds.length === 0) continue;

    const usesShortcut = assigneeUnitIds.includes(ach.kpiDefinition.startingUnitId);
    const canRecommend = assigneeUnitIds.some((unitId) => headUnitIds.includes(unitId));
    const canVerify = headUnitIds.includes(ach.kpiDefinition.startingUnitId);

    if ((usesShortcut && canVerify) || (!usesShortcut && canRecommend)) {
      submittedCount++;
    }
  }

  const recommendedCount = await prisma.achievement.count({
    where: {
      tenantId,
      state: "RECOMMENDED",
      kpiDefinition: { startingUnitId: { in: headUnitIds } },
    },
  });

  return submittedCount + recommendedCount;
}

// ── Available KPIs for Additional Achievements ───────────────────────────────

export type AvailableKpiView = {
  kpiId: string;
  kpiTitle: string;
  kpiDescription: string | null;
  kpiWeightage: number;
  measurementType: string;
  unitLabel: string | null;
  achievementTemplateKey: string | null;
  achievementFormConfig: AchievementFormConfig | null;
  kraId: string;
  kraTitle: string;
  categoryKey: string | null;
  categoryLabel: string | null;
  startingUnitId: string;
  startingUnitName: string;
  defaultTarget: number | null;
  isAllocated: boolean;
  hasExistingAdditional: boolean;
};

export async function getAvailableKpis(
  tenantId: string,
  userId: string,
  periodId: string,
  search?: string,
  categoryKey?: string,
): Promise<AvailableKpiView[]> {
  // Validate period
  const period = await prisma.assessmentPeriod.findFirst({
    where: { id: periodId, tenantId },
    select: { state: true, startDate: true, endDate: true, reviewFrequency: true },
  });
  if (!period) return [];

  // Get user's existing allocations for this period
  const ctx = await getMyKpiContext(tenantId, userId);
  const headUnitIds = ctx.headOfUnits.map((u) => u.unitId);

  const userAllocations = await prisma.targetAllocation.findMany({
    where: {
      tenantId,
      periodId,
      OR: [
        { assignedToUserId: userId },
        ...(headUnitIds.length > 0 ? [{ assignedToUnitId: { in: headUnitIds } }] : []),
      ],
    },
    select: { kpiDefinitionId: true },
  });
  const allocatedKpiIds = new Set(userAllocations.map((a) => a.kpiDefinitionId));

  // Get user's existing additional achievements
  const existingAdditional = await prisma.achievement.findMany({
    where: {
      tenantId,
      periodId,
      reportedByUserId: userId,
      targetAllocationId: null,
    },
    select: { kpiDefinitionId: true, reportingDate: true },
  });
  const currentCycleNumber = findCycleNumberForDate(new Date(), period);
  const additionalKpiIds = new Set(
    existingAdditional
      .filter(
        (achievement) =>
          findCycleNumberForDate(achievement.reportingDate, period) === currentCycleNumber,
      )
      .map((achievement) => achievement.kpiDefinitionId),
  );

  // Find all ACTIVE KPIs in the period
  const kpis = await prisma.kpiDefinition.findMany({
    where: {
      state: "ACTIVE",
      kraDefinition: {
        tenantId,
        periodId,
        state: "ACTIVE",
        ...(categoryKey
          ? { category: { categoryKey } }
          : {}),
      },
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: "insensitive" } },
              { description: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: {
      kraDefinition: {
        include: {
          category: { select: { categoryKey: true, displayLabel: true } },
        },
      },
      startingUnit: { select: { id: true, name: true } },
    },
    orderBy: [
      { kraDefinition: { sortOrder: "asc" } },
      { sortOrder: "asc" },
    ],
  });

  return kpis
    .filter(
      (kpi) =>
        !allocatedKpiIds.has(kpi.id) &&
        !additionalKpiIds.has(kpi.id),
    )
    .map((kpi): AvailableKpiView => ({
    kpiId: kpi.id,
    kpiTitle: kpi.title,
    kpiDescription: kpi.description,
    kpiWeightage: kpi.weightage,
    measurementType: kpi.measurementType,
    unitLabel: kpi.unitLabel,
    achievementTemplateKey: kpi.achievementTemplateKey,
    achievementFormConfig: kpi.achievementFormConfig as AchievementFormConfig | null,
    kraId: kpi.kraDefinitionId,
    kraTitle: kpi.kraDefinition.title,
    categoryKey: kpi.kraDefinition.category?.categoryKey ?? null,
    categoryLabel: kpi.kraDefinition.category?.displayLabel ?? null,
    startingUnitId: kpi.startingUnit.id,
    startingUnitName: kpi.startingUnit.name,
    defaultTarget: kpi.defaultTarget,
    isAllocated: false,
    hasExistingAdditional: false,
  }));
}

// ── List Additional Achievements ─────────────────────────────────────────────

export async function listAdditionalAchievements(
  tenantId: string,
  userId: string,
  periodId: string,
): Promise<AdditionalAchievementView[]> {
  const achievements = await prisma.achievement.findMany({
    where: {
      tenantId,
      periodId,
      reportedByUserId: userId,
      targetAllocationId: null,
    },
    include: {
      kpiDefinition: {
        select: {
          title: true,
          measurementType: true,
          unitLabel: true,
          defaultTarget: true,
          achievementTemplateKey: true,
          achievementFormConfig: true,
          startingUnitId: true,
          startingUnit: { select: { name: true } },
          kraDefinition: {
            select: {
              title: true,
              category: { select: { categoryKey: true, displayLabel: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true },
  });
  const userName = user ? `${user.firstName} ${user.lastName}` : "Unknown";

  return achievements.map((a): AdditionalAchievementView => ({
    id: a.id,
    tenantId: a.tenantId,
    periodId: a.periodId,
    kpiDefinitionId: a.kpiDefinitionId,
    kpiTitle: a.kpiDefinition.title,
    targetAllocationId: a.targetAllocationId,
    reportedByUserId: a.reportedByUserId,
    reportedByUserName: userName,
    actualValue: a.actualValue,
    actualDate: a.actualDate,
    actualMilestone: a.actualMilestone,
    actualGrade: a.actualGrade,
    actualBoolean: a.actualBoolean,
    actualRating: a.actualRating,
    evidenceDescription: a.evidenceDescription,
    evidenceLinks: a.evidenceLinks,
    achievementFormData: a.achievementFormData as Record<string, unknown> | null,
    computedScore: a.computedScore,
    state: a.state,
    recommendedByUserId: a.recommendedByUserId,
    recommendedAt: a.recommendedAt,
    recommendationNote: a.recommendationNote,
    verifiedByUserId: a.verifiedByUserId,
    verifiedAt: a.verifiedAt,
    verificationNote: a.verificationNote,
    rejectionReason: a.rejectionReason,
    verificationLog: (a.verificationLog as VerificationLogEntry[]) ?? [],
    reportingDate: a.reportingDate,
    createdAt: a.createdAt,
    kraTitle: a.kpiDefinition.kraDefinition.title,
    categoryLabel: a.kpiDefinition.kraDefinition.category?.displayLabel ?? null,
    categoryKey: a.kpiDefinition.kraDefinition.category?.categoryKey ?? null,
    measurementType: a.kpiDefinition.measurementType,
    unitLabel: a.kpiDefinition.unitLabel,
    defaultTarget: a.kpiDefinition.defaultTarget,
    achievementTemplateKey: a.kpiDefinition.achievementTemplateKey,
    achievementFormConfig: a.kpiDefinition.achievementFormConfig as AchievementFormConfig | null,
    startingUnitId: a.kpiDefinition.startingUnitId,
    startingUnitName: a.kpiDefinition.startingUnit.name,
  }));
}
