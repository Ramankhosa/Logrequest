import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getDescendantUnitIds } from "@/lib/org-structure/hierarchy-utils";
import { getUserAssignments } from "@/lib/org-structure/roles-service";
import {
  computeReviewCycles,
  isDateWithinInclusiveUtcRange,
} from "./period-service";
import {
  buildAllocationAchievementAggregate,
  summarizeAllocationLifecycle,
} from "./allocation-achievement-utils";
import { GALGOTIA_MANUAL_CREDIT_TEMPLATE_KEYS } from "./galgotia-template-constants";
import { seedDefaultTemplates } from "./external-contrib-template-service";
import { ensureApplicableRolesBaseline } from "./contributor-role-service";
import {
  achievementContributorInclude,
  mapAchievementContributors,
} from "./achievement-contributor-service";
import type {
  AchievementFieldConfig,
  AchievementSubmissionConfig,
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
  ScoringConfig,
  SubmissionTrailView,
} from "./shared";
import { formatActualDisplay, formatTargetDisplay } from "./measurement-display";

// ── Build MyKpiContext ───────────────────────────────────────────────────────

export async function getMyKpiContext(
  tenantId: string,
  userId: string,
): Promise<MyKpiContext> {
  const assignments = await getUserAssignments(tenantId, userId);

  const headOfUnits = assignments
    .filter((a) => a.isUnitHead)
    .map((a) => ({ unitId: a.unitId, unitName: a.unitName, unitCode: a.unitCode, scope: a.scope as "NODE" | "DESCENDANTS" }));

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

type ReviewScopeDetails = {
  unitIds: string[];
  unitNameById: Map<string, string>;
};

async function getReviewScopeDetails(
  tenantId: string,
  userId: string,
): Promise<ReviewScopeDetails> {
  const assignments = (await getUserAssignments(tenantId, userId))
    .filter((assignment) => assignment.isUnitHead);

  const unitIds = new Set<string>();
  const unitNameById = new Map<string, string>();

  for (const assignment of assignments) {
    unitIds.add(assignment.unitId);
    unitNameById.set(assignment.unitId, assignment.unitName);
  }

  const descendantGroups = await Promise.all(
    assignments
      .filter((assignment) => assignment.scope === "DESCENDANTS")
      .map((assignment) => getDescendantUnitIds(tenantId, assignment.unitId, true)),
  );

  const unresolvedUnitIds = new Set<string>();
  for (const descendantIds of descendantGroups) {
    for (const unitId of descendantIds) {
      unitIds.add(unitId);
      if (!unitNameById.has(unitId)) {
        unresolvedUnitIds.add(unitId);
      }
    }
  }

  if (unresolvedUnitIds.size > 0) {
    const units = await prisma.orgUnit.findMany({
      where: { id: { in: [...unresolvedUnitIds] } },
      select: { id: true, name: true },
    });

    for (const unit of units) {
      unitNameById.set(unit.id, unit.name);
    }
  }

  return {
    unitIds: [...unitIds],
    unitNameById,
  };
}

function daysWaitingSince(date: Date): number {
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000)));
}

function resolveReviewUnitId(achievement: {
  state: string;
  currentVerifierUnitId: string | null;
  kpiDefinition: {
    startingUnitId: string;
    keyUnitId: string | null;
    finalUnitId: string | null;
  };
}): string {
  if (achievement.currentVerifierUnitId) {
    return achievement.currentVerifierUnitId;
  }

  if (achievement.state === "RECOMMENDED") {
    return achievement.kpiDefinition.finalUnitId
      ?? achievement.kpiDefinition.keyUnitId
      ?? achievement.kpiDefinition.startingUnitId;
  }

  if (achievement.kpiDefinition.keyUnitId && achievement.kpiDefinition.finalUnitId) {
    return achievement.kpiDefinition.keyUnitId;
  }

  return achievement.kpiDefinition.finalUnitId
    ?? achievement.kpiDefinition.keyUnitId
    ?? achievement.kpiDefinition.startingUnitId;
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

function mapSubmissionTrailRows(
  rows: Array<{
    id: string;
    achievementId: string;
    action: string;
    actorUserId: string;
    actorName: string;
    actorRole: string;
    actorUnitName: string | null;
    note: string | null;
    scoreAtAction: number | null;
    metadata: unknown;
    createdAt: Date;
  }>,
): SubmissionTrailView[] {
  return rows.map((row) => ({
    id: row.id,
    achievementId: row.achievementId,
    action: row.action,
    actorUserId: row.actorUserId,
    actorName: row.actorName,
    actorRole: row.actorRole,
    actorUnitName: row.actorUnitName,
    note: row.note,
    scoreAtAction: row.scoreAtAction,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt,
  }));
}

function mapAchievementView(
  achievement: {
    id: string;
    tenantId: string;
    periodId: string;
    kpiDefinitionId: string;
    targetAllocationId: string | null;
    reportedByUserId: string;
    oboReportedForUserId: string | null;
    isOBO: boolean;
    title: string | null;
    contributionRole: string | null;
    creditPercent: number | null;
    effectiveScore: number | null;
    stageCompletionScore: number | null;
    actualValue: number | null;
    actualDate: Date | null;
    actualMilestone: AchievementView["actualMilestone"];
    actualGrade: AchievementView["actualGrade"];
    actualBoolean: boolean | null;
    actualRating: number | null;
    evidenceDescription: string | null;
    evidenceLinks: string[];
    achievementFormData: unknown;
    computedScore: number | null;
    state: AchievementView["state"];
    recommendedByUserId: string | null;
    recommendedAt: Date | null;
    recommendationNote: string | null;
    verifiedByUserId: string | null;
    verifiedAt: Date | null;
    verificationNote: string | null;
    rejectionReason: string | null;
    verificationLog: unknown;
    duplicateCheckResult: unknown;
    contributors: Array<{
      id: string;
      type: "INTERNAL" | "EXTERNAL";
      userId: string | null;
      externalName: string | null;
      externalAffiliation: string | null;
      externalScope: "NATIONAL" | "INTERNATIONAL" | null;
      externalData: Prisma.JsonValue;
      contributorRoleId: string;
      selectorTags: string[];
      creditPercent: number;
      isExcludedFromReward: boolean;
      note: string | null;
      user?: { id: string; firstName: string; lastName: string } | null;
      contributorRole?: { id: string; name: string } | null;
    }>;
    reportingDate: Date;
    createdAt: Date;
    submissionTrail: Array<{
      id: string;
      achievementId: string;
      action: string;
      actorUserId: string;
      actorName: string;
      actorRole: string;
      actorUnitName: string | null;
      note: string | null;
      scoreAtAction: number | null;
      metadata: unknown;
      createdAt: Date;
    }>;
    kpiDefinition: { title: string };
  },
  reportedByUserName: string,
): AchievementView {
  const contributors =
    achievement.contributors.length > 0
      ? mapAchievementContributors(achievement.contributors)
      : achievement.contributionRole
        ? [{
            id: `legacy-inline-${achievement.id}`,
            type: "INTERNAL" as const,
            userId: achievement.oboReportedForUserId ?? achievement.reportedByUserId,
            userName: achievement.isOBO ? null : reportedByUserName,
            externalName: null,
            externalAffiliation: null,
            externalScope: null,
            externalData: null,
            contributorRoleId: "legacy-inline",
            roleName: achievement.contributionRole,
            selectorTags: [],
            creditPercent: achievement.creditPercent ?? 0,
            isExcludedFromReward: false,
            note: null,
          }]
        : [];

  return {
    id: achievement.id,
    tenantId: achievement.tenantId,
    periodId: achievement.periodId,
    kpiDefinitionId: achievement.kpiDefinitionId,
    kpiTitle: achievement.kpiDefinition.title,
    targetAllocationId: achievement.targetAllocationId,
    reportedByUserId: achievement.reportedByUserId,
    reportedByUserName,
    isOBO: achievement.isOBO,
    oboReportedForUserId: achievement.oboReportedForUserId,
    title: achievement.title ?? null,
    contributionRole: achievement.contributionRole ?? null,
    creditPercent: achievement.creditPercent ?? null,
    effectiveScore: achievement.effectiveScore ?? null,
    stageCompletionScore: achievement.stageCompletionScore ?? null,
    actualValue: achievement.actualValue,
    actualDate: achievement.actualDate,
    actualMilestone: achievement.actualMilestone,
    actualGrade: achievement.actualGrade,
    actualBoolean: achievement.actualBoolean,
    actualRating: achievement.actualRating,
    evidenceDescription: achievement.evidenceDescription,
    evidenceLinks: achievement.evidenceLinks,
    achievementFormData: achievement.achievementFormData as Record<string, unknown> | null,
    computedScore: achievement.computedScore,
    state: achievement.state,
    recommendedByUserId: achievement.recommendedByUserId,
    recommendedAt: achievement.recommendedAt,
    recommendationNote: achievement.recommendationNote,
    verifiedByUserId: achievement.verifiedByUserId,
    verifiedAt: achievement.verifiedAt,
    verificationNote: achievement.verificationNote,
    rejectionReason: achievement.rejectionReason,
    verificationLog: (achievement.verificationLog as VerificationLogEntry[]) ?? [],
    contributors,
    duplicateCheckResult: (achievement.duplicateCheckResult as AchievementView["duplicateCheckResult"]) ?? null,
    submissionTrail: mapSubmissionTrailRows(achievement.submissionTrail),
    reportingDate: achievement.reportingDate,
    createdAt: achievement.createdAt,
  };
}

// ── Get My Allocations ───────────────────────────────────────────────────────

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function parseExternalContributorFields(
  fields: Prisma.JsonValue | null | undefined,
): AchievementFieldConfig[] | null {
  return Array.isArray(fields) ? (fields as AchievementFieldConfig[]) : null;
}

type SubmissionConfigApplicableRole = {
  isDefault: boolean;
  contributorRole: {
    id: string;
    code: string;
    name: string;
    defaultCreditPercent: number;
  };
};

type SubmissionConfigKpiRecord = {
  id: string;
  applicableRoles: SubmissionConfigApplicableRole[];
};

function toSubmissionConfigApplicableRoles(
  roles: Awaited<ReturnType<typeof ensureApplicableRolesBaseline>>,
): SubmissionConfigApplicableRole[] {
  return roles.map((role) => ({
    isDefault: role.linkIsDefault,
    contributorRole: {
      id: role.id,
      code: role.code,
      name: role.name,
      defaultCreditPercent: role.defaultCreditPercent,
    },
  }));
}

async function hydrateMissingApplicableRoles(
  tenantId: string,
  records: SubmissionConfigKpiRecord[],
): Promise<void> {
  const missing = new Map<string, SubmissionConfigKpiRecord>();
  for (const record of records) {
    if (record.applicableRoles.length === 0) {
      missing.set(record.id, record);
    }
  }

  if (missing.size === 0) return;

  await Promise.all(
    [...missing.values()].map(async (record) => {
      const hydrated = await ensureApplicableRolesBaseline(
        record.id,
        tenantId,
        null,
      );
      record.applicableRoles = toSubmissionConfigApplicableRoles(hydrated);
    }),
  );
}

function buildSubmissionConfig(
  kpi: {
    achievementTemplateKey?: string | null;
    participantMode: "SINGLE_OWNER" | "OPTIONAL_TEAM" | "REQUIRED_TEAM";
    evidenceRequired: boolean;
    evidenceTypes: string[];
    evidenceInstructions: string | null;
    applicableRoles: Array<{
      isDefault: boolean;
      contributorRole: {
        id: string;
        code: string;
        name: string;
        defaultCreditPercent: number;
      };
    }>;
    contributorConfig: {
      allowExternalContributors: boolean;
      creditSumMode: string;
      externalContribTemplate: { fields: Prisma.JsonValue } | null;
    } | null;
    rewardComponents: Array<{
      distributions: Array<{ selectorTag: string | null }>;
    }>;
  },
  defaultExternalContributorFields: AchievementFieldConfig[] | null,
): AchievementSubmissionConfig {
  return {
    participantMode: kpi.participantMode,
    evidenceRequired: kpi.evidenceRequired,
    evidenceTypes: kpi.evidenceTypes,
    evidenceInstructions: kpi.evidenceInstructions,
    applicableRoles: kpi.applicableRoles.map((role) => ({
      id: role.contributorRole.id,
      code: role.contributorRole.code,
      name: role.contributorRole.name,
      defaultCreditPercent: role.contributorRole.defaultCreditPercent,
      isDefault: role.isDefault,
    })),
    allowExternalContributors: kpi.contributorConfig?.allowExternalContributors ?? true,
    creditSumMode:
      kpi.contributorConfig?.creditSumMode === "MAX_100" ||
      kpi.contributorConfig?.creditSumMode === "UNCAPPED"
        ? kpi.contributorConfig.creditSumMode
        : "MUST_EQUAL_100",
    externalContributorFields:
      parseExternalContributorFields(kpi.contributorConfig?.externalContribTemplate?.fields) ??
      defaultExternalContributorFields,
    contributorSelectorTags: uniqueStrings(
      kpi.rewardComponents.flatMap((component) =>
        component.distributions.map((distribution) => distribution.selectorTag),
      ),
    ),
    manualCreditEntryEnabled:
      typeof kpi.achievementTemplateKey === "string" &&
      GALGOTIA_MANUAL_CREDIT_TEMPLATE_KEYS.has(kpi.achievementTemplateKey),
  };
}

export async function getMyAllocations(
  tenantId: string,
  userId: string,
  periodId: string,
): Promise<MyAllocationView[]> {
  await seedDefaultTemplates(tenantId);
  const ctx = await getMyKpiContext(tenantId, userId);
  const headUnitIds = ctx.headOfUnits.map((u) => u.unitId);
  const defaultExternalTemplate = await prisma.externalContributorTemplate.findFirst({
    where: { tenantId, isDefault: true, isActive: true },
    select: { fields: true },
  });
  const defaultExternalContributorFields = parseExternalContributorFields(
    defaultExternalTemplate?.fields,
  );
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
          applicableRoles: {
            include: {
              contributorRole: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                  defaultCreditPercent: true,
                },
              },
            },
            orderBy: [{ sortOrder: "asc" }, { contributorRoleId: "asc" }],
          },
          contributorConfig: {
            select: {
              allowExternalContributors: true,
              creditSumMode: true,
              externalContribTemplate: {
                select: {
                  fields: true,
                },
              },
            },
          },
          rewardComponents: {
            where: { isActive: true },
            select: {
              distributions: {
                select: {
                  selectorTag: true,
                },
              },
            },
          },
          _count: { select: { stages: true } },
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
            orderBy: [{ reportingDate: "desc" }, { createdAt: "desc" }],
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
        orderBy: [{ reportingDate: "desc" }, { createdAt: "desc" }],
        include: {
          kpiDefinition: { select: { title: true } },
          contributors: { include: achievementContributorInclude },
          submissionTrail: { orderBy: { createdAt: "asc" } },
        },
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

  const filtered = allocations.filter((a) => {
    const kpi = a.kpiDefinition;
    if (kpi.state !== "ACTIVE") return false;
    if (kpi.weightage === 0) return false;
    return true;
  });

  await hydrateMissingApplicableRoles(
    tenantId,
    filtered.map((allocation) => allocation.kpiDefinition),
  );

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

    const achievements = a.achievements.map((achievement) =>
      mapAchievementView(
        achievement,
        reporterMap.get(achievement.reportedByUserId) ?? "Unknown",
      ),
    );
    const achievementAggregate = buildAllocationAchievementAggregate({
      allowMultipleAchievementsPerAllocation:
        kpi.allowMultipleAchievementsPerAllocation ?? false,
      achievements,
      measurementType: kpi.measurementType,
      scoringMethod: kpi.scoringMethod,
      scoringDirection: kpi.scoringDirection,
      scoringConfig: kpi.scoringConfig as ScoringConfig | null,
      measurementConfig: kpi.measurementConfig as MeasurementConfig | null,
      target: {
        targetValue: a.targetValue,
        targetDate: a.targetDate,
        targetMilestone: a.targetMilestone,
        targetGrade: a.targetGrade,
        targetBoolean: a.targetBoolean,
        targetRating: a.targetRating,
      },
    });

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
      allowMultipleAchievementsPerAllocation:
        kpi.allowMultipleAchievementsPerAllocation ?? false,
      periodState: a.period.state,
      periodName: a.period.name,
      periodStartDate: a.period.startDate,
      achievementDeadline: a.period.achievementDeadline,
      periodEndDate: a.period.endDate,
      reviewFrequency: a.period.reviewFrequency,
      achievement: achievements[0] ?? null,
      achievements,
      achievementAggregate,
      allowPartialCompletion: kpi.allowPartialCompletion,
      stagesDefinedCount: kpi._count.stages,
      parentTargetValue: a.parentAllocation?.targetValue ?? null,
      section,
      childAllocations: childSummaries,
      submissionConfig: buildSubmissionConfig(kpi, defaultExternalContributorFields),
    };
  });
}

// ── Get Review Queue ─────────────────────────────────────────────────────────

async function getMyReviewQueueLegacy(
  tenantId: string,
  userId: string,
  periodId: string,
): Promise<unknown[]> {
  const ctx = await getMyKpiContext(tenantId, userId);
  if (ctx.headOfUnits.length === 0) return [];

  const headUnitIds = ctx.headOfUnits.map((u) => u.unitId);
  const items: Array<Record<string, unknown>> = [];

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
          id: true,
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
          id: true,
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

export async function getMyReviewQueue(
  tenantId: string,
  userId: string,
  periodId: string,
): Promise<ReviewQueueItem[]> {
  const reviewScope = await getReviewScopeDetails(tenantId, userId);
  if (reviewScope.unitIds.length === 0) return [];

  const achievements = await prisma.achievement.findMany({
    where: {
      tenantId,
      periodId,
      state: { in: ["SUBMITTED", "RECOMMENDED"] },
      currentVerifierUnitId: { in: reviewScope.unitIds },
      reportedByUserId: { not: userId },
    },
    include: {
      kpiDefinition: {
        select: {
          id: true,
          kraDefinition: { select: { title: true } },
          title: true,
          allowMultipleAchievementsPerAllocation: true,
          measurementType: true,
          scoringMethod: true,
          scoringDirection: true,
          scoringConfig: true,
          measurementConfig: true,
          unitLabel: true,
          guidanceNotes: true,
          startingUnitId: true,
          startingUnit: { select: { name: true } },
          keyUnitId: true,
          finalUnitId: true,
          achievementFormConfig: true,
        },
      },
      targetAllocation: {
        select: {
          targetValue: true,
          targetDate: true,
          targetMilestone: true,
          targetGrade: true,
          targetBoolean: true,
          targetRating: true,
          achievements: {
            orderBy: [{ reportingDate: "desc" }, { createdAt: "desc" }],
            select: {
              state: true,
              actualValue: true,
              actualRating: true,
              effectiveScore: true,
              stageCompletionScore: true,
              computedScore: true,
            },
          },
        },
      },
      contributors: { include: achievementContributorInclude },
      submissionTrail: { orderBy: { createdAt: "asc" } },
      stageProgress: { select: { isCompleted: true } },
    },
    orderBy: [{ reportingDate: "desc" }, { createdAt: "desc" }],
  });

  const reporterIds = [...new Set(achievements.map((achievement) => achievement.reportedByUserId))];
  const [reporters, memberships] = await Promise.all([
    reporterIds.length > 0
      ? prisma.user.findMany({
          where: { id: { in: reporterIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : Promise.resolve([]),
    reporterIds.length > 0
      ? prisma.membership.findMany({
          where: { tenantId, userId: { in: reporterIds } },
          select: { userId: true, designation: true },
        })
      : Promise.resolve([]),
  ]);

  const reporterMap = new Map(
    reporters.map((reporter) => [reporter.id, `${reporter.firstName} ${reporter.lastName}`]),
  );
  const designationMap = new Map(
    memberships.map((membership) => [membership.userId, membership.designation]),
  );

  return achievements.map((achievement): ReviewQueueItem => {
    const stagesTotal = achievement.stageProgress.length;
    const stagesComplete = achievement.stageProgress.filter((stage) => stage.isCompleted).length;
    const reviewUnitId = resolveReviewUnitId({
      state: achievement.state,
      currentVerifierUnitId: achievement.currentVerifierUnitId,
      kpiDefinition: achievement.kpiDefinition,
    });
    const reviewLevel: ReviewQueueItem["reviewLevel"] =
      achievement.state === "SUBMITTED"
      && achievement.kpiDefinition.keyUnitId
      && achievement.kpiDefinition.finalUnitId
        ? "RECOMMEND"
        : "VERIFY";
    const targetDisplay = achievement.targetAllocation
      ? formatTargetDisplay(
          achievement.kpiDefinition.measurementType,
          achievement.targetAllocation,
          achievement.kpiDefinition.unitLabel,
        )
      : "--";
    const actualDisplay = formatActualDisplay(
      achievement.kpiDefinition.measurementType,
      achievement,
      achievement.kpiDefinition.unitLabel,
    );
    const allocationAchievementAggregate = achievement.targetAllocation
      ? buildAllocationAchievementAggregate({
          allowMultipleAchievementsPerAllocation:
            achievement.kpiDefinition.allowMultipleAchievementsPerAllocation ?? false,
          achievements: achievement.targetAllocation.achievements,
          measurementType: achievement.kpiDefinition.measurementType,
          scoringMethod: achievement.kpiDefinition.scoringMethod,
          scoringDirection: achievement.kpiDefinition.scoringDirection,
          scoringConfig:
            achievement.kpiDefinition.scoringConfig as ScoringConfig | null,
          measurementConfig:
            achievement.kpiDefinition.measurementConfig as MeasurementConfig | null,
          target: achievement.targetAllocation,
        })
      : null;

    return {
      achievementId: achievement.id,
      facultyUserId: achievement.reportedByUserId,
      facultyName: reporterMap.get(achievement.reportedByUserId) ?? "Unknown",
      facultyDesignation: designationMap.get(achievement.reportedByUserId) ?? null,
      kraTitle: achievement.kpiDefinition.kraDefinition.title,
      kpiTitle: achievement.kpiDefinition.title,
      kpiDefinitionId: achievement.kpiDefinitionId,
      achievementTitle: achievement.title ?? null,
      targetValue: achievement.targetAllocation?.targetValue ?? null,
      actualValue: achievement.actualValue,
      measurementType: achievement.kpiDefinition.measurementType,
      unitLabel: achievement.kpiDefinition.unitLabel,
      achievementState: achievement.state,
      achievementFormData: achievement.achievementFormData as Record<string, unknown> | null,
      achievementFormConfig:
        achievement.kpiDefinition.achievementFormConfig as AchievementFormConfig | null,
      evidenceDescription: achievement.evidenceDescription,
      evidenceLinks: achievement.evidenceLinks,
      verificationLog: (achievement.verificationLog as VerificationLogEntry[]) ?? [],
      submissionTrail: mapSubmissionTrailRows(achievement.submissionTrail),
      reportingDate: achievement.reportingDate,
      reviewLevel,
      startingUnitId: achievement.kpiDefinition.startingUnitId,
      startingUnitName: achievement.kpiDefinition.startingUnit.name,
      reviewUnitId,
      reviewUnitName: reviewScope.unitNameById.get(reviewUnitId) ?? null,
      waitingDays: daysWaitingSince(achievement.reportingDate),
      contributionRole: achievement.contributionRole ?? null,
      creditPercent: achievement.creditPercent ?? null,
      contributors:
        achievement.contributors.length > 0
          ? mapAchievementContributors(achievement.contributors)
          : [],
      duplicateCheckResult:
        (achievement.duplicateCheckResult as ReviewQueueItem["duplicateCheckResult"]) ?? null,
      guidanceNotes: achievement.kpiDefinition.guidanceNotes,
      stageCompletionScore: achievement.stageCompletionScore ?? null,
      effectiveScore: achievement.effectiveScore ?? null,
      stagesComplete,
      stagesTotal,
      targetDisplay,
      actualDisplay,
      allowMultipleAchievementsPerAllocation:
        achievement.kpiDefinition.allowMultipleAchievementsPerAllocation ?? false,
      allocationAchievementAggregate,
    };
  });
}

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
    const lifecycle = summarizeAllocationLifecycle({
      allowMultipleAchievementsPerAllocation: a.allowMultipleAchievementsPerAllocation,
      achievements: a.achievements,
      aggregate: a.achievementAggregate,
      targetValue: a.targetValue,
    });

    if (lifecycle === "notStarted") {
      if (a.section === "department" && (a.allocationType === "INDIVIDUAL" || a.allocationType === "BOTH") && a.childCount === 0) {
        statusCounts.needsCascade++;
      } else {
        statusCounts.notStarted++;
      }
    } else {
      switch (lifecycle) {
        case "inProgress":
          statusCounts.inProgress++;
          break;
        case "pendingReview":
          statusCounts.pendingReview++;
          pendingReviewCount++;
          break;
        case "completed":
          statusCounts.completed++;
          break;
        case "notApproved":
          statusCounts.notApproved++;
          break;
        default:
          break;
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
      score:
        a.allowMultipleAchievementsPerAllocation
          ? a.achievementAggregate.officialScore
          : a.achievement?.state === "VERIFIED"
            ? (a.achievement.effectiveScore ?? a.achievement.stageCompletionScore ?? a.achievement.computedScore)
            : null,
      verified:
        a.allowMultipleAchievementsPerAllocation
          ? a.achievementAggregate.countsByState.verified > 0
          : a.achievement?.state === "VERIFIED",
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
    const isComplete =
      summarizeAllocationLifecycle({
        allowMultipleAchievementsPerAllocation: a.allowMultipleAchievementsPerAllocation,
        achievements: a.achievements,
        aggregate: a.achievementAggregate,
        targetValue: a.targetValue,
      }) === "completed";
    if (isComplete) continue;
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

async function getMyPendingCountLegacy(
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

export async function getMyPendingCount(
  tenantId: string,
  userId: string,
  periodId?: string,
): Promise<number> {
  const reviewScope = await getReviewScopeDetails(tenantId, userId);
  if (reviewScope.unitIds.length === 0) return 0;

  return prisma.achievement.count({
    where: {
      tenantId,
      ...(periodId ? { periodId } : {}),
      state: { in: ["SUBMITTED", "RECOMMENDED"] },
      currentVerifierUnitId: { in: reviewScope.unitIds },
      reportedByUserId: { not: userId },
    },
  });
}

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
  submissionConfig: AchievementSubmissionConfig;
};

export async function getAvailableKpis(
  tenantId: string,
  userId: string,
  periodId: string,
  search?: string,
  categoryKey?: string,
): Promise<AvailableKpiView[]> {
  await seedDefaultTemplates(tenantId);
  // Validate period
  const period = await prisma.assessmentPeriod.findFirst({
    where: { id: periodId, tenantId },
    select: { state: true, startDate: true, endDate: true, reviewFrequency: true },
  });
  if (!period) return [];
  const defaultExternalTemplate = await prisma.externalContributorTemplate.findFirst({
    where: { tenantId, isDefault: true, isActive: true },
    select: { fields: true },
  });
  const defaultExternalContributorFields = parseExternalContributorFields(
    defaultExternalTemplate?.fields,
  );

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
      applicableRoles: {
        include: {
          contributorRole: {
            select: {
              id: true,
              code: true,
              name: true,
              defaultCreditPercent: true,
            },
          },
        },
        orderBy: [{ sortOrder: "asc" }, { contributorRoleId: "asc" }],
      },
      contributorConfig: {
        select: {
          allowExternalContributors: true,
          creditSumMode: true,
          externalContribTemplate: {
            select: {
              fields: true,
            },
          },
        },
      },
      rewardComponents: {
        where: { isActive: true },
        select: {
          distributions: {
            select: {
              selectorTag: true,
            },
          },
        },
      },
    },
    orderBy: [
      { kraDefinition: { sortOrder: "asc" } },
      { sortOrder: "asc" },
    ],
  });

  const availableKpis = kpis.filter(
    (kpi) =>
      !allocatedKpiIds.has(kpi.id) &&
      !additionalKpiIds.has(kpi.id),
  );
  await hydrateMissingApplicableRoles(tenantId, availableKpis);

  return availableKpis.map((kpi): AvailableKpiView => ({
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
    submissionConfig: buildSubmissionConfig(kpi, defaultExternalContributorFields),
  }));
}

// ── List Additional Achievements ─────────────────────────────────────────────

async function listAdditionalAchievementsLegacy(
  tenantId: string,
  userId: string,
  periodId: string,
): Promise<unknown[]> {
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
          id: true,
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

  return achievements.map((a) => ({
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

export async function listAdditionalAchievements(
  tenantId: string,
  userId: string,
  periodId: string,
): Promise<AdditionalAchievementView[]> {
  await seedDefaultTemplates(tenantId);
  const defaultExternalTemplate = await prisma.externalContributorTemplate.findFirst({
    where: { tenantId, isDefault: true, isActive: true },
    select: { fields: true },
  });
  const defaultExternalContributorFields = parseExternalContributorFields(
    defaultExternalTemplate?.fields,
  );
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
          id: true,
          title: true,
          measurementType: true,
          unitLabel: true,
          defaultTarget: true,
          achievementTemplateKey: true,
          achievementFormConfig: true,
          participantMode: true,
          evidenceRequired: true,
          evidenceTypes: true,
          evidenceInstructions: true,
          allowPartialCompletion: true,
          startingUnitId: true,
          startingUnit: { select: { name: true } },
          applicableRoles: {
            include: {
              contributorRole: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                  defaultCreditPercent: true,
                },
              },
            },
            orderBy: [{ sortOrder: "asc" }, { contributorRoleId: "asc" }],
          },
          contributorConfig: {
            select: {
              allowExternalContributors: true,
              creditSumMode: true,
              externalContribTemplate: {
                select: {
                  fields: true,
                },
              },
            },
          },
          rewardComponents: {
            where: { isActive: true },
            select: {
              distributions: {
                select: {
                  selectorTag: true,
                },
              },
            },
          },
          _count: { select: { stages: true } },
          kraDefinition: {
            select: {
              title: true,
              category: { select: { categoryKey: true, displayLabel: true } },
            },
          },
        },
      },
      contributors: { include: achievementContributorInclude },
      submissionTrail: { orderBy: { createdAt: "asc" } },
      stageProgress: { select: { isCompleted: true } },
    },
    orderBy: [{ reportingDate: "desc" }, { createdAt: "desc" }],
  });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true },
  });
  const userName = user ? `${user.firstName} ${user.lastName}` : "Unknown";

  await hydrateMissingApplicableRoles(
    tenantId,
    achievements.map((achievement) => achievement.kpiDefinition),
  );

  return achievements.map((achievement): AdditionalAchievementView => {
    const stagesTotal = achievement.stageProgress.length;
    const stagesComplete = achievement.stageProgress.filter((stage) => stage.isCompleted).length;

    return {
      ...mapAchievementView(achievement, userName),
      kraTitle: achievement.kpiDefinition.kraDefinition.title,
      categoryLabel: achievement.kpiDefinition.kraDefinition.category?.displayLabel ?? null,
      categoryKey: achievement.kpiDefinition.kraDefinition.category?.categoryKey ?? null,
      measurementType: achievement.kpiDefinition.measurementType,
      unitLabel: achievement.kpiDefinition.unitLabel,
      defaultTarget: achievement.kpiDefinition.defaultTarget,
      achievementTemplateKey: achievement.kpiDefinition.achievementTemplateKey,
      achievementFormConfig:
        achievement.kpiDefinition.achievementFormConfig as AchievementFormConfig | null,
      startingUnitId: achievement.kpiDefinition.startingUnitId,
      startingUnitName: achievement.kpiDefinition.startingUnit.name,
      stagesComplete,
      stagesTotal,
      allowPartialCompletion: achievement.kpiDefinition.allowPartialCompletion,
      stagesDefinedCount: achievement.kpiDefinition._count.stages,
      submissionConfig: buildSubmissionConfig(
        achievement.kpiDefinition,
        defaultExternalContributorFields,
      ),
    };
  });
}
