import { Prisma, type KraDefinitionState, type Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { KraKpiActionResult, KraDefinitionView } from "./shared";

// ── Constants ────────────────────────────────────────────────────────────────

const tenantOwnerRole = "TENANT_OWNER" satisfies Role;
const tenantAdminRole = "TENANT_ADMIN" satisfies Role;

// ── Schemas ──────────────────────────────────────────────────────────────────

const createKraSchema = z.object({
  periodId: z.string().trim().min(1),
  categoryId: z.string().trim().min(1).optional(),
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(1000).optional(),
  weightage: z.number().int().min(0).max(100).default(0),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});

const updateKraSchema = z.object({
  categoryId: z.string().trim().min(1).nullable().optional(),
  title: z.string().trim().min(2).max(200).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  weightage: z.number().int().min(0).max(100).optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

const changeKraStateSchema = z.object({
  state: z.enum(["DRAFT", "ACTIVE"]),
});

const copyKrasFromPeriodSchema = z.object({
  sourcePeriodId: z.string().trim().min(1, "Select a source period."),
});

export type CreateKraInput = z.input<typeof createKraSchema>;
export type UpdateKraInput = z.input<typeof updateKraSchema>;
export type ChangeKraStateInput = z.input<typeof changeKraStateSchema>;
export type CopyKrasFromPeriodInput = z.input<typeof copyKrasFromPeriodSchema>;

// ── Helpers ──────────────────────────────────────────────────────────────────

function isAdminOrOwner(role: Role): boolean {
  return (
    role === tenantOwnerRole ||
    role === tenantAdminRole ||
    role === "SUPERADMIN"
  );
}

function canModifyKraInPeriodState(state: string): boolean {
  return state === "DRAFT" || state === "OPEN" || state === "UNDER_REVIEW";
}

function toOptionalJsonInput(value: unknown): Prisma.InputJsonValue | undefined {
  return value == null ? undefined : (value as Prisma.InputJsonValue);
}

// ── List KRAs ────────────────────────────────────────────────────────────────

export async function listKras(
  tenantId: string,
  periodId?: string
): Promise<KraDefinitionView[]> {
  const kras = await prisma.kraDefinition.findMany({
    where: {
      tenantId,
      ...(periodId && { periodId }),
    },
    include: {
      period: { select: { name: true } },
      category: { select: { displayLabel: true } },
      kpiDefinitions: {
        where: { state: { not: "ARCHIVED" } },
        select: { weightage: true, state: true },
      },
    },
    orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
  });

  return kras.map((k) => {
    const activeKpis = k.kpiDefinitions.filter((kpi) => kpi.state === "ACTIVE");
    const draftKpiCount = k.kpiDefinitions.filter((kpi) => kpi.state === "DRAFT").length;

    return {
      id: k.id,
      tenantId: k.tenantId,
      periodId: k.periodId,
      periodName: k.period.name,
      categoryId: k.categoryId,
      categoryLabel: k.category?.displayLabel ?? null,
      title: k.title,
      description: k.description,
      weightage: k.weightage,
      state: k.state,
      sortOrder: k.sortOrder,
      kpiCount: k.kpiDefinitions.length,
      kpiWeightageSum: k.kpiDefinitions.reduce((sum, kpi) => sum + kpi.weightage, 0),
      activeKpiCount: activeKpis.length,
      activeKpiWeightageSum: activeKpis.reduce((sum, kpi) => sum + kpi.weightage, 0),
      draftKpiCount,
      createdAt: k.createdAt,
    };
  });
}

// ── Get KRA ──────────────────────────────────────────────────────────────────

export async function getKra(
  kraId: string,
  tenantId: string
): Promise<KraDefinitionView | null> {
  const k = await prisma.kraDefinition.findFirst({
    where: { id: kraId, tenantId },
    include: {
      period: { select: { name: true } },
      category: { select: { displayLabel: true } },
      kpiDefinitions: {
        where: { state: { not: "ARCHIVED" } },
        select: { weightage: true, state: true },
      },
    },
  });
  if (!k) return null;

  const activeKpis = k.kpiDefinitions.filter((kpi) => kpi.state === "ACTIVE");
  const draftKpiCount = k.kpiDefinitions.filter((kpi) => kpi.state === "DRAFT").length;

  return {
    id: k.id,
    tenantId: k.tenantId,
    periodId: k.periodId,
    periodName: k.period.name,
    categoryId: k.categoryId,
    categoryLabel: k.category?.displayLabel ?? null,
    title: k.title,
    description: k.description,
    weightage: k.weightage,
    state: k.state,
    sortOrder: k.sortOrder,
    kpiCount: k.kpiDefinitions.length,
    kpiWeightageSum: k.kpiDefinitions.reduce((sum, kpi) => sum + kpi.weightage, 0),
    activeKpiCount: activeKpis.length,
    activeKpiWeightageSum: activeKpis.reduce((sum, kpi) => sum + kpi.weightage, 0),
    draftKpiCount,
    createdAt: k.createdAt,
  };
}

// ── Create KRA ───────────────────────────────────────────────────────────────

export async function createKra(
  tenantId: string,
  input: CreateKraInput,
  actorUserId: string,
  actorRole: Role
): Promise<KraKpiActionResult> {
  if (!isAdminOrOwner(actorRole)) {
    return { status: "error", message: "Insufficient permissions to create KRAs." };
  }

  const parsed = createKraSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;

  // Verify period exists and belongs to tenant
  const period = await prisma.assessmentPeriod.findFirst({
    where: { id: data.periodId, tenantId },
  });
  if (!period) {
    return { status: "error", message: "Assessment period not found." };
  }

  // Period must be editable to add KRAs
  if (!canModifyKraInPeriodState(period.state)) {
    return {
      status: "error",
      message: `Cannot add KRAs to a period in "${period.state}" state.`,
    };
  }

  // Verify category if provided
  if (data.categoryId) {
    const cat = await prisma.kraCategoryDefinition.findFirst({
      where: {
        id: data.categoryId,
        OR: [{ tenantId: null }, { tenantId }],
        isActive: true,
      },
    });
    if (!cat) {
      return { status: "error", message: "Category not found or inactive." };
    }
  }

  // Check weightage sum won't exceed 100
  const existingSum = await prisma.kraDefinition.aggregate({
    where: { periodId: data.periodId, tenantId, state: { not: "ARCHIVED" } },
    _sum: { weightage: true },
  });
  const currentSum = existingSum._sum.weightage ?? 0;
  if (currentSum + data.weightage > 100) {
    return {
      status: "error",
      message: `Adding weightage ${data.weightage} would exceed total 100. Current sum: ${currentSum}, remaining: ${100 - currentSum}.`,
    };
  }

  const created = await prisma.$transaction(async (tx) => {
    const kra = await tx.kraDefinition.create({
      data: {
        tenantId,
        periodId: data.periodId,
        categoryId: data.categoryId,
        title: data.title,
        description: data.description,
        weightage: data.weightage,
        sortOrder: data.sortOrder,
        createdByUserId: actorUserId,
      },
    });

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "KraDefinition",
        targetId: kra.id,
        action: "CREATE",
        newState: { title: data.title, weightage: data.weightage },
      },
    });

    return kra;
  });

  return {
    status: "success",
    message: `KRA "${data.title}" created.`,
    id: created.id,
  };
}

// ── Update KRA ───────────────────────────────────────────────────────────────

export async function copyKrasFromPeriod(
  targetPeriodId: string,
  tenantId: string,
  input: CopyKrasFromPeriodInput,
  actorUserId: string,
  actorRole: Role,
): Promise<KraKpiActionResult> {
  if (!isAdminOrOwner(actorRole)) {
    return { status: "error", code: "PERMISSION_DENIED", message: "Insufficient permissions." };
  }

  const parsed = copyKrasFromPeriodSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  const { sourcePeriodId } = parsed.data;
  if (sourcePeriodId === targetPeriodId) {
    return {
      status: "error",
      message: "Choose a different source period.",
    };
  }

  const [sourcePeriod, targetPeriod] = await Promise.all([
    prisma.assessmentPeriod.findFirst({
      where: { id: sourcePeriodId, tenantId },
      select: { id: true, name: true },
    }),
    prisma.assessmentPeriod.findFirst({
      where: { id: targetPeriodId, tenantId },
      select: { id: true, name: true, state: true },
    }),
  ]);

  if (!sourcePeriod) {
    return {
      status: "error",
      code: "PERIOD_NOT_FOUND",
      message: "Source assessment period not found.",
    };
  }

  if (!targetPeriod) {
    return {
      status: "error",
      code: "PERIOD_NOT_FOUND",
      message: "Assessment period not found.",
    };
  }

  if (!canModifyKraInPeriodState(targetPeriod.state)) {
    return {
      status: "error",
      code: "PERIOD_STATE_CONFLICT",
      message: `Cannot copy KRAs into a period in "${targetPeriod.state}" state.`,
    };
  }

  const existingTargetKraCount = await prisma.kraDefinition.count({
    where: {
      tenantId,
      periodId: targetPeriodId,
      state: { not: "ARCHIVED" },
    },
  });
  if (existingTargetKraCount > 0) {
    return {
      status: "error",
      code: "TARGET_PERIOD_NOT_EMPTY",
      message: "This period already has KRAs. Clear them first, then copy.",
    };
  }

  const sourceKras = await prisma.kraDefinition.findMany({
    where: {
      tenantId,
      periodId: sourcePeriodId,
      state: { not: "ARCHIVED" },
    },
    include: {
      kpiDefinitions: {
        where: { state: { not: "ARCHIVED" } },
        include: {
          applicableRoles: {
            orderBy: [{ sortOrder: "asc" }, { contributorRoleId: "asc" }],
          },
          contributorConfig: true,
          stages: {
            orderBy: [{ stageOrder: "asc" }, { title: "asc" }],
          },
          rewardTiers: {
            include: {
              rules: {
                orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
              },
            },
            orderBy: [{ priority: "asc" }, { code: "asc" }],
          },
          rewardComponents: {
            include: {
              distributions: {
                orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
              },
            },
            orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
          },
          targetUnits: {
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
      },
    },
    orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
  });

  if (sourceKras.length === 0) {
    return {
      status: "error",
      code: "SOURCE_PERIOD_EMPTY",
      message: "The selected source period has no KRAs to copy.",
    };
  }

  let copiedKraCount = 0;
  let copiedKpiCount = 0;
  let copiedTargetUnitCount = 0;

  await prisma.$transaction(async (tx) => {
    for (const sourceKra of sourceKras) {
      const copiedKra = await tx.kraDefinition.create({
        data: {
          tenantId,
          periodId: targetPeriodId,
          categoryId: sourceKra.categoryId,
          title: sourceKra.title,
          description: sourceKra.description,
          weightage: sourceKra.weightage,
          state: sourceKra.state,
          sortOrder: sourceKra.sortOrder,
          createdByUserId: actorUserId,
        },
      });
      copiedKraCount += 1;

      for (const sourceKpi of sourceKra.kpiDefinitions) {
        const copiedKpi = await tx.kpiDefinition.create({
          data: {
            kraDefinitionId: copiedKra.id,
            title: sourceKpi.title,
            description: sourceKpi.description,
            measurementType: sourceKpi.measurementType,
            unitLabel: sourceKpi.unitLabel,
            weightage: sourceKpi.weightage,
            defaultTarget: sourceKpi.defaultTarget,
            measurementConfig: toOptionalJsonInput(sourceKpi.measurementConfig),
            scoringMethod: sourceKpi.scoringMethod,
            scoringDirection: sourceKpi.scoringDirection,
            scoringConfig: toOptionalJsonInput(sourceKpi.scoringConfig),
            isPerCapita: sourceKpi.isPerCapita,
            allocationType: sourceKpi.allocationType,
            startingUnitId: sourceKpi.startingUnitId,
            achievementTemplateKey: sourceKpi.achievementTemplateKey,
            achievementFormConfig: toOptionalJsonInput(sourceKpi.achievementFormConfig),
            keyUnitId: sourceKpi.keyUnitId,
            finalUnitId: sourceKpi.finalUnitId,
            sopDescription: sourceKpi.sopDescription,
            sopFiles: toOptionalJsonInput(sourceKpi.sopFiles),
            evidenceRequired: sourceKpi.evidenceRequired,
            evidenceTypes: sourceKpi.evidenceTypes,
            evidenceInstructions: sourceKpi.evidenceInstructions,
            isTeamKpi: sourceKpi.isTeamKpi,
            teamCreditMethod: sourceKpi.teamCreditMethod,
            participantMode: sourceKpi.participantMode,
            rewardRecurrencePolicy: sourceKpi.rewardRecurrencePolicy,
            policyDateFieldKey: sourceKpi.policyDateFieldKey,
            state: sourceKpi.state,
            sortOrder: sourceKpi.sortOrder,
            guidanceNotes: sourceKpi.guidanceNotes,
          },
        });
        copiedKpiCount += 1;

        if (sourceKpi.contributorConfig) {
          await tx.kpiContributorConfig.create({
            data: {
              kpiDefinitionId: copiedKpi.id,
              externalContribTemplateId: sourceKpi.contributorConfig.externalContribTemplateId,
              allowExternalContributors: sourceKpi.contributorConfig.allowExternalContributors,
              duplicateCheckFields: toOptionalJsonInput(
                sourceKpi.contributorConfig.duplicateCheckFields,
              ),
              creditSumMode: sourceKpi.contributorConfig.creditSumMode,
            },
          });
        }

        if (sourceKpi.applicableRoles.length > 0) {
          await tx.kpiApplicableRole.createMany({
            data: sourceKpi.applicableRoles.map((role) => ({
              kpiDefinitionId: copiedKpi.id,
              contributorRoleId: role.contributorRoleId,
              isDefault: role.isDefault,
              sortOrder: role.sortOrder,
            })),
          });
        }

        const stageIdMap = new Map<string, string>();
        for (const sourceStage of sourceKpi.stages) {
          const copiedStage = await tx.kpiStageDefinition.create({
            data: {
              kpiDefinitionId: copiedKpi.id,
              stageOrder: sourceStage.stageOrder,
              title: sourceStage.title,
              description: sourceStage.description,
              isMandatory: sourceStage.isMandatory,
              weight: sourceStage.weight,
              evidenceRequired: sourceStage.evidenceRequired,
              evidenceTypes: sourceStage.evidenceTypes,
              evidenceInstructions: sourceStage.evidenceInstructions,
              deadline: sourceStage.deadline,
            },
          });
          stageIdMap.set(sourceStage.id, copiedStage.id);
        }

        const rewardTierIdMap = new Map<string, string>();
        for (const sourceTier of sourceKpi.rewardTiers) {
          const copiedTier = await tx.kpiRewardTier.create({
            data: {
              kpiDefinitionId: copiedKpi.id,
              tierSetKey: sourceTier.tierSetKey,
              code: sourceTier.code,
              name: sourceTier.name,
              description: sourceTier.description,
              priority: sourceTier.priority,
              matchMode: sourceTier.matchMode,
              effectiveFrom: sourceTier.effectiveFrom,
              effectiveTo: sourceTier.effectiveTo,
              isActive: sourceTier.isActive,
              metadata: toOptionalJsonInput(sourceTier.metadata),
            },
          });
          rewardTierIdMap.set(sourceTier.id, copiedTier.id);

          if (sourceTier.rules.length > 0) {
            await tx.kpiRewardRule.createMany({
              data: sourceTier.rules.map((rule) => ({
                rewardTierId: copiedTier.id,
                source: rule.source,
                operator: rule.operator,
                fieldKey: rule.fieldKey,
                systemMetricKey: rule.systemMetricKey,
                value: toOptionalJsonInput(rule.value),
                sortOrder: rule.sortOrder,
                metadata: toOptionalJsonInput(rule.metadata),
              })),
            });
          }
        }

        const rewardComponentIdMap = new Map<string, string>();
        for (const sourceComponent of sourceKpi.rewardComponents) {
          const copiedComponent = await tx.kpiRewardComponent.create({
            data: {
              kpiDefinitionId: copiedKpi.id,
              rewardTierId: sourceComponent.rewardTierId
                ? (rewardTierIdMap.get(sourceComponent.rewardTierId) ?? null)
                : null,
              stageDefinitionId: sourceComponent.stageDefinitionId
                ? (stageIdMap.get(sourceComponent.stageDefinitionId) ?? null)
                : null,
              benefitTypeId: sourceComponent.benefitTypeId,
              code: sourceComponent.code,
              name: sourceComponent.name,
              description: sourceComponent.description,
              trigger: sourceComponent.trigger,
              amountMode: sourceComponent.amountMode,
              amountValue: sourceComponent.amountValue,
              amountFieldKey: sourceComponent.amountFieldKey,
              distributionMode: sourceComponent.distributionMode,
              singleEligibleHandling: sourceComponent.singleEligibleHandling,
              emptyShareHandling: sourceComponent.emptyShareHandling,
              isActive: sourceComponent.isActive,
              sortOrder: sourceComponent.sortOrder,
              metadata: toOptionalJsonInput(sourceComponent.metadata),
            },
          });
          rewardComponentIdMap.set(sourceComponent.id, copiedComponent.id);
        }

        for (const sourceComponent of sourceKpi.rewardComponents) {
          const copiedComponentId = rewardComponentIdMap.get(sourceComponent.id);
          if (!copiedComponentId) continue;

          if (sourceComponent.parentComponentId) {
            await tx.kpiRewardComponent.update({
              where: { id: copiedComponentId },
              data: {
                parentComponentId:
                  rewardComponentIdMap.get(sourceComponent.parentComponentId) ?? null,
              },
            });
          }

          if (sourceComponent.distributions.length > 0) {
            await tx.kpiRewardDistribution.createMany({
              data: sourceComponent.distributions.map((distribution) => ({
                rewardComponentId: copiedComponentId,
                contributorRoleId: distribution.contributorRoleId,
                selectorType: distribution.selectorType,
                selectorTag: distribution.selectorTag,
                sharePercent: distribution.sharePercent,
                fixedAmount: distribution.fixedAmount,
                splitMode: distribution.splitMode,
                sortOrder: distribution.sortOrder,
                metadata: toOptionalJsonInput(distribution.metadata),
              })),
            });
          }
        }

        for (const sourceTargetUnit of sourceKpi.targetUnits) {
          await tx.kpiTargetUnit.create({
            data: {
              kpiDefinitionId: copiedKpi.id,
              unitId: sourceTargetUnit.unitId,
              targetShare: sourceTargetUnit.targetShare,
              notes: sourceTargetUnit.notes,
            },
          });
          copiedTargetUnitCount += 1;
        }
      }
    }

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "AssessmentPeriod",
        targetId: targetPeriodId,
        action: "COPY_KRA_KPIS",
        metadata: {
          sourcePeriodId,
          sourcePeriodName: sourcePeriod.name,
          copiedKraCount,
          copiedKpiCount,
          copiedTargetUnitCount,
        },
      },
    });
  });

  return {
    status: "success",
    message: `Copied ${copiedKraCount} KRA(s), ${copiedKpiCount} KPI(s), and ${copiedTargetUnitCount} target mapping(s) from "${sourcePeriod.name}".`,
  };
}

export async function updateKra(
  kraId: string,
  tenantId: string,
  input: UpdateKraInput,
  actorUserId: string,
  actorRole: Role
): Promise<KraKpiActionResult> {
  if (!isAdminOrOwner(actorRole)) {
    return { status: "error", message: "Insufficient permissions." };
  }

  const parsed = updateKraSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;

  const kra = await prisma.kraDefinition.findFirst({
    where: { id: kraId, tenantId },
    include: { period: { select: { state: true } } },
  });
  if (!kra) {
    return { status: "error", message: "KRA not found." };
  }

  // Can only edit non-archived KRAs while the period is editable
  if (kra.state === "ARCHIVED") {
    return { status: "error", message: "Cannot edit an archived KRA." };
  }
  if (!canModifyKraInPeriodState(kra.period.state)) {
    return {
      status: "error",
      message: `Cannot edit KRA — period is in "${kra.period.state}" state.`,
    };
  }

  // If changing weightage, verify sum doesn't exceed 100
  if (data.weightage !== undefined && data.weightage !== kra.weightage) {
    const otherSum = await prisma.kraDefinition.aggregate({
      where: {
        periodId: kra.periodId,
        tenantId,
        id: { not: kraId },
        state: { not: "ARCHIVED" },
      },
      _sum: { weightage: true },
    });
    const otherTotal = otherSum._sum.weightage ?? 0;
    if (otherTotal + data.weightage > 100) {
      return {
        status: "error",
        message: `Weightage ${data.weightage} would exceed total 100. Other KRAs sum to ${otherTotal}, remaining: ${100 - otherTotal}.`,
      };
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.kraDefinition.update({
      where: { id: kraId },
      data: {
        ...(data.categoryId !== undefined && { categoryId: data.categoryId }),
        ...(data.title !== undefined && { title: data.title }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.weightage !== undefined && { weightage: data.weightage }),
        ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
      },
    });

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "KraDefinition",
        targetId: kraId,
        action: "UPDATE",
        previousState: { title: kra.title, weightage: kra.weightage },
        newState: data as object,
      },
    });
  });

  return { status: "success", message: "KRA updated." };
}

// ── Activate KRA ─────────────────────────────────────────────────────────────

export async function changeKraState(
  kraId: string,
  tenantId: string,
  input: ChangeKraStateInput,
  actorUserId: string,
  actorRole: Role
): Promise<KraKpiActionResult> {
  if (!isAdminOrOwner(actorRole)) {
    return { status: "error", message: "Insufficient permissions." };
  }

  const parsed = changeKraStateSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const nextState = parsed.data.state as KraDefinitionState;

  const kra = await prisma.kraDefinition.findFirst({
    where: { id: kraId, tenantId },
    include: {
      period: { select: { state: true } },
      kpiDefinitions: {
        where: { state: { not: "ARCHIVED" } },
        select: {
          id: true,
          weightage: true,
          state: true,
          _count: {
            select: {
              targetAllocations: true,
              achievements: true,
            },
          },
        },
      },
    },
  });
  if (!kra) {
    return { status: "error", message: "KRA not found." };
  }

  if (kra.state === "ARCHIVED") {
    return { status: "error", message: "Cannot change the state of an archived KRA." };
  }
  if (!canModifyKraInPeriodState(kra.period.state)) {
    return {
      status: "error",
      message: `Cannot change KRA state while the period is in "${kra.period.state}" state.`,
    };
  }
  if (kra.state === nextState) {
    return { status: "error", message: `KRA is already in "${nextState}" state.` };
  }

  const kpiSum = kra.kpiDefinitions.reduce((s, k) => s + k.weightage, 0);
  if (nextState === "ACTIVE") {
    if (kra.kpiDefinitions.length === 0 && kra.weightage !== 0) {
      return {
        status: "error",
        message: `Cannot activate KRA "${kra.title}" because it has no KPIs yet. Add KPI definitions totaling ${kra.weightage} before activating.`,
      };
    }
    if (kpiSum !== kra.weightage) {
      const delta = kra.weightage - kpiSum;
      const guidance =
        delta > 0
          ? `${delta} remaining. Add or increase KPI weightage before activating.`
          : `${Math.abs(delta)} over. Reduce KPI weightage before activating.`;
      return {
        status: "error",
        message: `Cannot activate KRA "${kra.title}": KPI weightages sum to ${kpiSum}, but KRA weightage is ${kra.weightage}. ${guidance}`,
      };
    }
  }

  if (
    nextState === "DRAFT" &&
    kra.kpiDefinitions.some(
      (kpi) => kpi._count.targetAllocations > 0 || kpi._count.achievements > 0,
    )
  ) {
    return {
      status: "error",
      message: "Cannot move KRA back to DRAFT once child KPIs have targets or achievements. Remove them first.",
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.kraDefinition.update({
      where: { id: kraId },
      data: { state: nextState },
    });

    await tx.kpiDefinition.updateMany({
      where: {
        kraDefinitionId: kraId,
        state: { not: "ARCHIVED" },
      },
      data: { state: nextState },
    });

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "KraDefinition",
        targetId: kraId,
        action: "STATE_CHANGE",
        previousState: { state: kra.state },
        newState: { state: nextState },
      },
    });
  });

  return {
    status: "success",
    message:
      nextState === "ACTIVE"
        ? `KRA "${kra.title}" activated. All non-archived KPIs are now ACTIVE.`
        : `KRA "${kra.title}" moved to DRAFT. All non-archived KPIs are now DRAFT.`,
  };
}

export async function activateKra(
  kraId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role
): Promise<KraKpiActionResult> {
  return changeKraState(
    kraId,
    tenantId,
    { state: "ACTIVE" },
    actorUserId,
    actorRole,
  );
}

// ── Archive KRA ──────────────────────────────────────────────────────────────

export async function archiveKra(
  kraId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role
): Promise<KraKpiActionResult> {
  if (!isAdminOrOwner(actorRole)) {
    return { status: "error", message: "Insufficient permissions." };
  }

  const kra = await prisma.kraDefinition.findFirst({
    where: { id: kraId, tenantId },
    include: {
      kpiDefinitions: {
        include: {
          targetAllocations: { where: { state: "ACTIVE" }, select: { id: true } },
        },
      },
    },
  });
  if (!kra) {
    return { status: "error", message: "KRA not found." };
  }

  // Check for active allocations
  const hasActiveAllocations = kra.kpiDefinitions.some(
    (kpi) => kpi.targetAllocations.length > 0
  );
  if (hasActiveAllocations) {
    return {
      status: "error",
      message: "Cannot archive KRA — it has KPIs with active target allocations. Lock or remove them first.",
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.kraDefinition.update({
      where: { id: kraId },
      data: { state: "ARCHIVED" },
    });

    // Also archive all KPIs under this KRA
    await tx.kpiDefinition.updateMany({
      where: { kraDefinitionId: kraId },
      data: { state: "ARCHIVED" },
    });

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "KraDefinition",
        targetId: kraId,
        action: "ARCHIVE",
        previousState: { state: kra.state },
        newState: { state: "ARCHIVED" },
      },
    });
  });

  return { status: "success", message: `KRA "${kra.title}" archived.` };
}

// ── Delete KRA ───────────────────────────────────────────────────────────────

export async function deleteKra(
  kraId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role
): Promise<KraKpiActionResult> {
  if (!isAdminOrOwner(actorRole)) {
    return { status: "error", message: "Insufficient permissions." };
  }

  const kra = await prisma.kraDefinition.findFirst({
    where: { id: kraId, tenantId },
    include: {
      kpiDefinitions: {
        include: {
          _count: { select: { targetAllocations: true } },
        },
      },
    },
  });
  if (!kra) {
    return { status: "error", message: "KRA not found." };
  }

  // Cannot delete if any KPI has allocations
  const hasAllocations = kra.kpiDefinitions.some(
    (kpi) => kpi._count.targetAllocations > 0
  );
  if (hasAllocations) {
    return {
      status: "error",
      message: "Cannot delete KRA — it has KPIs with target allocations. Archive it instead.",
    };
  }

  await prisma.$transaction(async (tx) => {
    // Cascade will delete KPIs
    await tx.kraDefinition.delete({ where: { id: kraId } });

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "KraDefinition",
        targetId: kraId,
        action: "DELETE",
        previousState: { title: kra.title, weightage: kra.weightage },
      },
    });
  });

  return { status: "success", message: `KRA "${kra.title}" deleted.` };
}

// ── Validate Weightages ──────────────────────────────────────────────────────

export async function validateKraWeightages(
  periodId: string,
  tenantId: string
): Promise<{ valid: boolean; sum: number; remaining: number }> {
  const result = await prisma.kraDefinition.aggregate({
    where: { periodId, tenantId, state: { not: "ARCHIVED" } },
    _sum: { weightage: true },
  });
  const sum = result._sum.weightage ?? 0;
  return {
    valid: sum === 100,
    sum,
    remaining: 100 - sum,
  };
}
