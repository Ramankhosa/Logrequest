import { Prisma, type Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { KraKpiActionResult } from "./shared";
import {
  kpiBuilderPayloadSchema,
  type BuilderApplicableRole,
  type BuilderContributorConfig,
  type BuilderRewardComponent,
  type BuilderRewardTier,
  type BuilderStage,
  type BuilderKpiDefinition,
  type KpiBuilderPayload,
  type KpiBuilderPayloadInput,
} from "./builder-shared";
import { ensureApplicableRolesBaseline } from "./contributor-role-service";
import { hasTenantCapability } from "@/lib/tenant-permissions/service";
import { validateWorkflowReviewerSelection } from "./workflow-service";

const tenantOwnerRole = "TENANT_OWNER" satisfies Role;
const tenantAdminRole = "TENANT_ADMIN" satisfies Role;

type Tx = Prisma.TransactionClient;

function isTenantAdmin(role: Role): boolean {
  return (
    role === tenantOwnerRole ||
    role === tenantAdminRole ||
    role === "SUPERADMIN"
  );
}

async function canManageKpiBuilder(
  tenantId: string,
  actorUserId: string,
  actorRole: Role,
) {
  return hasTenantCapability({
    tenantId,
    userId: actorUserId,
    baseRole: actorRole,
    capability: "MANAGE_KPI",
  });
}

function canModifyKpiInPeriodState(state: string): boolean {
  return state === "DRAFT" || state === "OPEN" || state === "UNDER_REVIEW";
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  return value == null ? undefined : (value as Prisma.InputJsonValue);
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeBuilderRefKey(value: string | null | undefined, fallback: string): string {
  return normalizeNullableString(value) ?? fallback;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function buildTierMetadata(
  metadata: Record<string, unknown> | undefined,
  refKey: string,
): Prisma.InputJsonValue {
  return {
    ...(metadata ?? {}),
    builderRefKey: refKey,
  } as Prisma.InputJsonValue;
}

function readTierRefKey(metadata: unknown, fallback: string): string {
  if (isPlainObject(metadata) && typeof metadata.builderRefKey === "string") {
    const trimmed = metadata.builderRefKey.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return fallback;
}

async function resolveRoleId(
  tenantId: string,
  role: BuilderApplicableRole | { contributorRoleId?: string | null; contributorRoleCode?: string | null },
  tx: Tx,
): Promise<string | null> {
  if ("roleId" in role && role.roleId) {
    const found = await tx.contributorRole.findFirst({
      where: { id: role.roleId, tenantId, isActive: true },
      select: { id: true },
    });
    return found?.id ?? null;
  }

  const code =
    "roleCode" in role
      ? role.roleCode
      : "contributorRoleCode" in role
        ? role.contributorRoleCode
        : null;
  if (!code) return null;
  const found = await tx.contributorRole.findFirst({
    where: { tenantId, code, isActive: true },
    select: { id: true },
  });
  return found?.id ?? null;
}

async function resolveBenefitTypeId(
  tenantId: string,
  component: BuilderRewardComponent,
  tx: Tx,
): Promise<string | null> {
  if (component.benefitTypeId) {
    const found = await tx.benefitType.findFirst({
      where: { id: component.benefitTypeId, tenantId, isActive: true },
      select: { id: true },
    });
    return found?.id ?? null;
  }

  if (!component.benefitTypeCode) return null;
  const found = await tx.benefitType.findFirst({
    where: { tenantId, code: component.benefitTypeCode, isActive: true },
    select: { id: true },
  });
  return found?.id ?? null;
}

function getFieldKeys(payload: KpiBuilderPayload): Set<string> {
  return new Set(payload.definition.achievementFormConfig?.fields.map((field) => field.key) ?? []);
}

function validateBuilderFieldReferences(payload: KpiBuilderPayload): string | null {
  const fieldKeys = getFieldKeys(payload);
  const duplicateCheckFields = payload.contributorConfig.duplicateCheckFields ?? [];

  for (const fieldKey of duplicateCheckFields) {
    if (!fieldKeys.has(fieldKey)) {
      return `Duplicate-check field "${fieldKey}" is not present on the KPI form.`;
    }
  }

  if (
    payload.definition.rewardRecurrencePolicy === "ONCE_PER_UNIQUE_KEY" &&
    duplicateCheckFields.length === 0
  ) {
    return "Once-per-unique-key KPIs require at least one duplicate-check field.";
  }

  if (
    payload.definition.policyDateFieldKey &&
    !fieldKeys.has(payload.definition.policyDateFieldKey)
  ) {
    return `Policy date field "${payload.definition.policyDateFieldKey}" is not present on the KPI form.`;
  }

  const tierRefSet = new Set<string>();
  const tierCodeSet = new Set<string>();
  for (const tier of payload.rewardTiers) {
    if (tier.effectiveFrom && tier.effectiveTo && tier.effectiveTo < tier.effectiveFrom) {
      return `Reward tier "${tier.name}" has an effective-to date before its effective-from date.`;
    }
    const tierRef = normalizeBuilderRefKey(tier.refKey, tier.code);
    if (tierRefSet.has(tierRef)) {
      return `Duplicate reward tier reference "${tierRef}" is not allowed.`;
    }
    tierRefSet.add(tierRef);
    tierCodeSet.add(tier.code);
    for (const rule of tier.rules) {
      if (rule.source === "FORM_FIELD" && !rule.fieldKey) {
        return `Reward tier "${tier.name}" has a form-field rule without a field key.`;
      }
      if (rule.fieldKey && !fieldKeys.has(rule.fieldKey)) {
        return `Reward tier "${tier.name}" references unknown field "${rule.fieldKey}".`;
      }
      if (rule.source === "SYSTEM_METRIC" && !rule.systemMetricKey) {
        return `Reward tier "${tier.name}" has a system-metric rule without a metric key.`;
      }
    }
  }

  const componentCodes = new Set<string>();
  for (const component of payload.rewardComponents) {
    if (component.amountFieldKey && !fieldKeys.has(component.amountFieldKey)) {
      return `Reward component "${component.name}" references unknown field "${component.amountFieldKey}".`;
    }
    const rewardTierRef = normalizeNullableString(component.rewardTierRef ?? null);
    if (rewardTierRef && !tierRefSet.has(rewardTierRef)) {
      return `Reward component "${component.name}" references unknown tier "${rewardTierRef}".`;
    }
    if (!rewardTierRef && component.rewardTierCode && !tierCodeSet.has(component.rewardTierCode)) {
      return `Reward component "${component.name}" references unknown tier "${component.rewardTierCode}".`;
    }
    if (componentCodes.has(component.code)) {
      return `Duplicate reward component code "${component.code}" is not allowed.`;
    }
    componentCodes.add(component.code);
  }

  for (const component of payload.rewardComponents) {
    if (
      component.parentComponentCode &&
      !componentCodes.has(component.parentComponentCode)
    ) {
      return `Reward component "${component.name}" references unknown parent component "${component.parentComponentCode}".`;
    }
  }

  return null;
}

function validateMultiAchievementModeCompatibility(input: {
  measurementType: BuilderKpiDefinition["measurementType"];
  stageCount: number;
  allowMultipleAchievementsPerAllocation: boolean;
}): string | null {
  void input;
  return null;
}

async function hasAllocationWithMultipleAchievements(
  tenantId: string,
  kpiDefinitionId: string,
  tx: Tx,
): Promise<boolean> {
  const rows = await tx.achievement.findMany({
    where: {
      tenantId,
      kpiDefinitionId,
      targetAllocationId: { not: null },
    },
    select: {
      targetAllocationId: true,
    },
  });

  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.targetAllocationId) continue;
    const nextCount = (counts.get(row.targetAllocationId) ?? 0) + 1;
    if (nextCount > 1) {
      return true;
    }
    counts.set(row.targetAllocationId, nextCount);
  }

  return false;
}

async function syncApplicableRoles(
  kpiId: string,
  tenantId: string,
  applicableRoles: BuilderApplicableRole[],
  contributionRoles: unknown,
  tx: Tx,
): Promise<KraKpiActionResult | null> {
  if (applicableRoles.length === 0) {
    await tx.kpiApplicableRole.deleteMany({ where: { kpiDefinitionId: kpiId } });
    await ensureApplicableRolesBaseline(kpiId, tenantId, contributionRoles, tx);
    return null;
  }

  const resolved = [];
  for (const role of applicableRoles) {
    const roleId = await resolveRoleId(tenantId, role, tx);
    if (!roleId) {
      return {
        status: "error",
        message: "One or more applicable roles are invalid or archived.",
        code: "ROLE_WRONG_TENANT",
      };
    }
    resolved.push({
      contributorRoleId: roleId,
      isDefault: role.isDefault,
      sortOrder: role.sortOrder,
    });
  }

  const defaultCount = resolved.filter((role) => role.isDefault).length;
  if (defaultCount !== 1) {
    return {
      status: "error",
      message: "Exactly one applicable role must be marked as default.",
      code: "APPLICABLE_ROLES_DEFAULT",
    };
  }

  if (new Set(resolved.map((role) => role.contributorRoleId)).size !== resolved.length) {
    return {
      status: "error",
      message: "Duplicate applicable roles are not allowed.",
      code: "APPLICABLE_ROLES_DUPLICATE",
    };
  }

  await tx.kpiApplicableRole.deleteMany({ where: { kpiDefinitionId: kpiId } });
  await tx.kpiApplicableRole.createMany({
    data: resolved.map((role) => ({
      kpiDefinitionId: kpiId,
      contributorRoleId: role.contributorRoleId,
      isDefault: role.isDefault,
      sortOrder: role.sortOrder,
    })),
  });
  return null;
}

async function syncContributorConfig(
  kpiId: string,
  config: BuilderContributorConfig,
  tx: Tx,
): Promise<void> {
  await tx.kpiContributorConfig.upsert({
    where: { kpiDefinitionId: kpiId },
    create: {
      kpiDefinitionId: kpiId,
      externalContribTemplateId: config.externalContribTemplateId ?? undefined,
      allowExternalContributors: config.allowExternalContributors,
      duplicateCheckFields:
        config.duplicateCheckFields.length > 0 ? config.duplicateCheckFields : undefined,
      creditSumMode: config.creditSumMode,
    },
    update: {
      externalContribTemplateId: config.externalContribTemplateId ?? null,
      allowExternalContributors: config.allowExternalContributors,
      duplicateCheckFields:
        config.duplicateCheckFields.length > 0
          ? config.duplicateCheckFields
          : Prisma.JsonNull,
      creditSumMode: config.creditSumMode,
    },
  });
}

async function syncStages(
  kpiId: string,
  stages: BuilderStage[],
  tx: Tx,
): Promise<KraKpiActionResult | null> {
  const existing = await tx.kpiStageDefinition.findMany({
    where: { kpiDefinitionId: kpiId },
    select: {
      id: true,
      _count: { select: { stageProgress: true } },
    },
  });

  const touchedIds = new Set<string>();
  for (const stage of stages) {
    if (stage.id) {
      touchedIds.add(stage.id);
      await tx.kpiStageDefinition.update({
        where: { id: stage.id },
        data: {
          stageOrder: stage.stageOrder,
          title: stage.title,
          description: normalizeNullableString(stage.description ?? null),
          weight: stage.weight,
          isMandatory: stage.isMandatory,
          evidenceRequired: stage.evidenceRequired,
          evidenceTypes: stage.evidenceTypes,
          evidenceInstructions: normalizeNullableString(stage.evidenceInstructions ?? null),
          deadline: stage.deadline ?? null,
        },
      });
    } else {
      const created = await tx.kpiStageDefinition.create({
        data: {
          kpiDefinitionId: kpiId,
          stageOrder: stage.stageOrder,
          title: stage.title,
          description: normalizeNullableString(stage.description ?? null),
          weight: stage.weight,
          isMandatory: stage.isMandatory,
          evidenceRequired: stage.evidenceRequired,
          evidenceTypes: stage.evidenceTypes,
          evidenceInstructions: normalizeNullableString(stage.evidenceInstructions ?? null),
          deadline: stage.deadline ?? null,
        },
        select: { id: true },
      });
      touchedIds.add(created.id);
    }
  }

  for (const stage of existing) {
    if (touchedIds.has(stage.id)) continue;
    if (stage._count.stageProgress > 0) {
      return {
        status: "error",
        message: "Cannot delete a stage that already has progress records.",
      };
    }
    await tx.kpiStageDefinition.delete({ where: { id: stage.id } });
  }

  return null;
}

async function syncRewardConfig(
  tenantId: string,
  kpiId: string,
  rewardTiers: BuilderRewardTier[],
  rewardComponents: BuilderRewardComponent[],
  tx: Tx,
): Promise<KraKpiActionResult | null> {
  const existingTiers = await tx.kpiRewardTier.findMany({
    where: { kpiDefinitionId: kpiId },
    select: { id: true, code: true, tierSetKey: true, effectiveFrom: true, metadata: true },
  });
  const existingComponents = await tx.kpiRewardComponent.findMany({
    where: { kpiDefinitionId: kpiId },
    select: { id: true, code: true },
  });

  const usedComponentIds = new Set(
    (
      await tx.contributorReward.findMany({
        where: { kpiDefinitionId: kpiId },
        select: { rewardComponentId: true },
      })
    ).map((row) => row.rewardComponentId),
  );
  const usedTierIds = new Set(
    (
      await tx.contributorReward.findMany({
        where: { kpiDefinitionId: kpiId, rewardTierId: { not: null } },
        select: { rewardTierId: true },
      })
    )
      .map((row) => row.rewardTierId)
      .filter((value): value is string => value != null),
  );

  const tierIdByRef = new Map<string, string>();
  const touchedTierIds = new Set<string>();

  for (const tier of rewardTiers) {
    const tierRefKey = normalizeBuilderRefKey(tier.refKey, tier.code);
    const existing =
      (tier.id
        ? existingTiers.find((row) => row.id === tier.id)
        : existingTiers.find(
            (row) =>
              readTierRefKey(row.metadata, row.code) === tierRefKey,
          )) ?? null;

    const saved = existing
      ? await tx.kpiRewardTier.update({
          where: { id: existing.id },
          data: {
            tierSetKey: tier.tierSetKey,
            code: tier.code,
            name: tier.name,
            description: normalizeNullableString(tier.description ?? null),
            priority: tier.priority,
            matchMode: tier.matchMode,
            effectiveFrom: tier.effectiveFrom ?? null,
            effectiveTo: tier.effectiveTo ?? null,
            isActive: tier.isActive,
            metadata: buildTierMetadata(tier.metadata, tierRefKey),
          },
          select: { id: true },
        })
      : await tx.kpiRewardTier.create({
          data: {
            kpiDefinitionId: kpiId,
            tierSetKey: tier.tierSetKey,
            code: tier.code,
            name: tier.name,
            description: normalizeNullableString(tier.description ?? null),
            priority: tier.priority,
            matchMode: tier.matchMode,
            effectiveFrom: tier.effectiveFrom ?? null,
            effectiveTo: tier.effectiveTo ?? null,
            isActive: tier.isActive,
            metadata: buildTierMetadata(tier.metadata, tierRefKey),
          },
          select: { id: true },
        });

    touchedTierIds.add(saved.id);
    tierIdByRef.set(tierRefKey, saved.id);

    await tx.kpiRewardRule.deleteMany({ where: { rewardTierId: saved.id } });
    if (tier.rules.length > 0) {
      await tx.kpiRewardRule.createMany({
        data: tier.rules.map((rule) => ({
          rewardTierId: saved.id,
          source: rule.source,
          operator: rule.operator,
          fieldKey: rule.fieldKey ?? null,
          systemMetricKey: rule.systemMetricKey ?? null,
          value: toJson(rule.value),
          sortOrder: rule.sortOrder,
          metadata: toJson(rule.metadata),
        })),
      });
    }
  }

  for (const tier of existingTiers) {
    if (touchedTierIds.has(tier.id)) continue;
    if (usedTierIds.has(tier.id)) {
      return {
        status: "error",
        message: `Cannot delete reward tier "${tier.code}" because historical rewards reference it.`,
      };
    }
    await tx.kpiRewardRule.deleteMany({ where: { rewardTierId: tier.id } });
    await tx.kpiRewardTier.delete({ where: { id: tier.id } });
  }

  const componentIdByCode = new Map<string, string>();
  const touchedComponentIds = new Set<string>();

  for (const component of rewardComponents) {
    const benefitTypeId = await resolveBenefitTypeId(tenantId, component, tx);
    if (!benefitTypeId) {
      return {
        status: "error",
        message: `Reward component "${component.name}" references an unknown benefit type.`,
      };
    }

    const existing =
      (component.id
        ? existingComponents.find((row) => row.id === component.id)
        : existingComponents.find((row) => row.code === component.code)) ?? null;

    const saved = existing
      ? await tx.kpiRewardComponent.update({
          where: { id: existing.id },
          data: {
            rewardTierId:
              normalizeNullableString(component.rewardTierRef ?? null) != null
                ? (tierIdByRef.get(normalizeNullableString(component.rewardTierRef ?? null)!) ?? null)
                : component.rewardTierCode
                  ? (tierIdByRef.get(component.rewardTierCode) ?? null)
                  : null,
            stageDefinitionId: component.stageDefinitionId ?? null,
            benefitTypeId,
            code: component.code,
            name: component.name,
            description: normalizeNullableString(component.description ?? null),
            trigger: component.trigger,
            amountMode: component.amountMode,
            amountValue: component.amountValue ?? null,
            amountFieldKey: normalizeNullableString(component.amountFieldKey ?? null),
            distributionMode: component.distributionMode,
            singleEligibleHandling: component.singleEligibleHandling,
            emptyShareHandling: component.emptyShareHandling,
            isActive: component.isActive,
            sortOrder: component.sortOrder,
            metadata: toJson(component.metadata),
          },
          select: { id: true },
        })
        : await tx.kpiRewardComponent.create({
          data: {
            kpiDefinitionId: kpiId,
            rewardTierId:
              normalizeNullableString(component.rewardTierRef ?? null) != null
                ? (tierIdByRef.get(normalizeNullableString(component.rewardTierRef ?? null)!) ?? null)
                : component.rewardTierCode
                  ? (tierIdByRef.get(component.rewardTierCode) ?? null)
                  : null,
            stageDefinitionId: component.stageDefinitionId ?? null,
            benefitTypeId,
            code: component.code,
            name: component.name,
            description: normalizeNullableString(component.description ?? null),
            trigger: component.trigger,
            amountMode: component.amountMode,
            amountValue: component.amountValue ?? null,
            amountFieldKey: normalizeNullableString(component.amountFieldKey ?? null),
            distributionMode: component.distributionMode,
            singleEligibleHandling: component.singleEligibleHandling,
            emptyShareHandling: component.emptyShareHandling,
            isActive: component.isActive,
            sortOrder: component.sortOrder,
            metadata: toJson(component.metadata),
          },
          select: { id: true },
        });

    touchedComponentIds.add(saved.id);
    componentIdByCode.set(component.code, saved.id);
  }

  for (const component of rewardComponents) {
    const componentId = componentIdByCode.get(component.code);
    if (!componentId) continue;

    await tx.kpiRewardComponent.update({
      where: { id: componentId },
      data: {
        parentComponentId: component.parentComponentCode
          ? (componentIdByCode.get(component.parentComponentCode) ?? null)
          : null,
      },
    });

    await tx.kpiRewardDistribution.deleteMany({ where: { rewardComponentId: componentId } });
    if (component.distributions.length === 0) continue;

    const distributionRows = [];
    for (const distribution of component.distributions) {
      const contributorRoleId =
        distribution.selectorType === "ROLE"
          ? await resolveRoleId(tenantId, distribution, tx)
          : null;
      if (distribution.selectorType === "ROLE" && !contributorRoleId) {
        return {
          status: "error",
          message: `Reward component "${component.name}" references an unknown contributor role.`,
        };
      }

      distributionRows.push({
        rewardComponentId: componentId,
        contributorRoleId,
        selectorType: distribution.selectorType,
        selectorTag: normalizeNullableString(distribution.selectorTag ?? null),
        sharePercent: distribution.sharePercent ?? null,
        fixedAmount: distribution.fixedAmount ?? null,
        splitMode: distribution.splitMode ?? null,
        sortOrder: distribution.sortOrder,
        metadata: toJson(distribution.metadata),
      });
    }

    await tx.kpiRewardDistribution.createMany({ data: distributionRows });
  }

  for (const component of existingComponents) {
    if (touchedComponentIds.has(component.id)) continue;
    if (usedComponentIds.has(component.id)) {
      return {
        status: "error",
        message: `Cannot delete reward component "${component.code}" because historical rewards reference it.`,
      };
    }
    await tx.kpiRewardDistribution.deleteMany({ where: { rewardComponentId: component.id } });
    await tx.kpiRewardComponent.delete({ where: { id: component.id } });
  }

  return null;
}

function mapPayloadFromKpi(kpi: {
  id: string;
  kraDefinitionId: string;
  title: string;
  description: string | null;
  measurementType: BuilderKpiDefinition["measurementType"];
  unitLabel: string | null;
  weightage: number;
  defaultTarget: number | null;
  measurementConfig: unknown;
  scoringMethod: BuilderKpiDefinition["scoringMethod"];
  scoringDirection: BuilderKpiDefinition["scoringDirection"];
  scoringConfig: unknown;
  isPerCapita: boolean;
  allocationType: BuilderKpiDefinition["allocationType"];
  startingUnitId: string;
  achievementTemplateKey: string | null;
  achievementFormConfig: unknown;
  guidanceNotes: string | null;
  sortOrder: number;
  keyUnitId: string | null;
  finalUnitId: string | null;
  keyReviewerUserId: string | null;
  finalReviewerUserId: string | null;
  sopDescription: string | null;
  evidenceRequired: boolean;
  evidenceTypes: BuilderKpiDefinition["evidenceTypes"];
  evidenceInstructions: string | null;
  isTeamKpi: boolean;
  teamCreditMethod: BuilderKpiDefinition["teamCreditMethod"];
  allowPartialCompletion: boolean;
  participantMode: BuilderKpiDefinition["participantMode"];
  rewardRecurrencePolicy: BuilderKpiDefinition["rewardRecurrencePolicy"];
  policyDateFieldKey: string | null;
  allowMultipleAchievementsPerAllocation: boolean;
  contributionRoles: unknown;
  applicableRoles: Array<{
    contributorRoleId: string;
    isDefault: boolean;
    sortOrder: number;
    contributorRole: { code: string };
  }>;
  contributorConfig: {
    externalContribTemplateId: string | null;
    allowExternalContributors: boolean;
    duplicateCheckFields: unknown;
    creditSumMode: string;
  } | null;
  stages: Array<{
    id: string;
    title: string;
    description: string | null;
    stageOrder: number;
    weight: number;
    isMandatory: boolean;
    evidenceRequired: boolean;
    evidenceTypes: BuilderStage["evidenceTypes"];
    evidenceInstructions: string | null;
    deadline: Date | null;
  }>;
  rewardTiers: Array<{
    id: string;
    tierSetKey: string;
    code: string;
    name: string;
    description: string | null;
    priority: number;
    matchMode: BuilderRewardTier["matchMode"];
    effectiveFrom: Date | null;
    effectiveTo: Date | null;
    isActive: boolean;
    metadata: unknown;
    rules: Array<{
      id: string;
      source: string;
      operator: string;
      fieldKey: string | null;
      systemMetricKey: string | null;
      value: unknown;
      sortOrder: number;
      metadata: unknown;
    }>;
  }>;
  rewardComponents: Array<{
    id: string;
    rewardTierId: string | null;
    stageDefinitionId: string | null;
    parentComponentId: string | null;
    benefitTypeId: string;
    benefitType: { code: string };
    code: string;
    name: string;
    description: string | null;
    trigger: BuilderRewardComponent["trigger"];
    amountMode: BuilderRewardComponent["amountMode"];
    amountValue: number | null;
    amountFieldKey: string | null;
    distributionMode: BuilderRewardComponent["distributionMode"];
    singleEligibleHandling: BuilderRewardComponent["singleEligibleHandling"];
    emptyShareHandling: BuilderRewardComponent["emptyShareHandling"];
    isActive: boolean;
    sortOrder: number;
    metadata: unknown;
    distributions: Array<{
      id: string;
      contributorRoleId: string | null;
      contributorRole: { code: string } | null;
      selectorType: string;
      selectorTag: string | null;
      sharePercent: number | null;
      fixedAmount: number | null;
      splitMode: string | null;
      sortOrder: number;
      metadata: unknown;
    }>;
  }>;
}): KpiBuilderPayload {
  const tierCodeById = new Map(kpi.rewardTiers.map((tier) => [tier.id, tier.code]));
  const tierRefById = new Map(
    kpi.rewardTiers.map((tier) => [tier.id, readTierRefKey(tier.metadata, tier.code)]),
  );
  const componentCodeById = new Map(kpi.rewardComponents.map((component) => [component.id, component.code]));

  return {
    definition: {
      id: kpi.id,
      kraDefinitionId: kpi.kraDefinitionId,
      title: kpi.title,
      description: kpi.description,
      measurementType: kpi.measurementType,
      unitLabel: kpi.unitLabel,
      weightage: kpi.weightage,
      defaultTarget: kpi.defaultTarget,
      measurementConfig: (kpi.measurementConfig as BuilderKpiDefinition["measurementConfig"]) ?? null,
      scoringMethod: kpi.scoringMethod,
      scoringDirection: kpi.scoringDirection,
      scoringConfig: (kpi.scoringConfig as BuilderKpiDefinition["scoringConfig"]) ?? null,
      isPerCapita: kpi.isPerCapita,
      allocationType: kpi.allocationType,
      startingUnitId: kpi.startingUnitId,
      achievementTemplateKey: kpi.achievementTemplateKey,
      achievementFormConfig:
        (kpi.achievementFormConfig as BuilderKpiDefinition["achievementFormConfig"]) ?? null,
      guidanceNotes: kpi.guidanceNotes,
      sortOrder: kpi.sortOrder,
      keyUnitId: kpi.keyUnitId,
      finalUnitId: kpi.finalUnitId,
      keyReviewerUserId: kpi.keyReviewerUserId,
      finalReviewerUserId: kpi.finalReviewerUserId,
      sopDescription: kpi.sopDescription,
      evidenceRequired: kpi.evidenceRequired,
      evidenceTypes: kpi.evidenceTypes,
      evidenceInstructions: kpi.evidenceInstructions,
      isTeamKpi: kpi.isTeamKpi,
      teamCreditMethod: kpi.teamCreditMethod,
      allowPartialCompletion: kpi.allowPartialCompletion,
      allowMultipleAchievementsPerAllocation:
        kpi.allowMultipleAchievementsPerAllocation,
      participantMode: kpi.participantMode,
      rewardRecurrencePolicy: kpi.rewardRecurrencePolicy,
      policyDateFieldKey: kpi.policyDateFieldKey,
      contributionRoles: (kpi.contributionRoles as BuilderKpiDefinition["contributionRoles"]) ?? null,
    },
    applicableRoles: kpi.applicableRoles.map((role) => ({
      roleId: role.contributorRoleId,
      roleCode: role.contributorRole.code,
      isDefault: role.isDefault,
      sortOrder: role.sortOrder,
    })),
    contributorConfig: {
      externalContribTemplateId: kpi.contributorConfig?.externalContribTemplateId ?? null,
      allowExternalContributors: kpi.contributorConfig?.allowExternalContributors ?? true,
      duplicateCheckFields:
        (kpi.contributorConfig?.duplicateCheckFields as string[] | null) ?? [],
      creditSumMode:
        (kpi.contributorConfig?.creditSumMode as BuilderContributorConfig["creditSumMode"]) ??
        "MUST_EQUAL_100",
    },
    stages: kpi.stages.map((stage) => ({
      id: stage.id,
      title: stage.title,
      description: stage.description,
      stageOrder: stage.stageOrder,
      weight: stage.weight,
      isMandatory: stage.isMandatory,
      evidenceRequired: stage.evidenceRequired,
      evidenceTypes: stage.evidenceTypes,
      evidenceInstructions: stage.evidenceInstructions,
      deadline: stage.deadline,
    })),
    rewardTiers: kpi.rewardTiers.map((tier) => ({
      id: tier.id,
      refKey: readTierRefKey(tier.metadata, tier.code),
      tierSetKey: tier.tierSetKey,
      code: tier.code,
      name: tier.name,
      description: tier.description,
      priority: tier.priority,
      matchMode: tier.matchMode,
      effectiveFrom: tier.effectiveFrom,
      effectiveTo: tier.effectiveTo,
      isActive: tier.isActive,
      metadata:
        isPlainObject(tier.metadata)
          ? Object.fromEntries(
              Object.entries(tier.metadata).filter(([key]) => key !== "builderRefKey"),
            )
          : undefined,
      rules: tier.rules.map((rule) => ({
        id: rule.id,
        source: rule.source as BuilderRewardTier["rules"][number]["source"],
        operator: rule.operator as BuilderRewardTier["rules"][number]["operator"],
        fieldKey: rule.fieldKey ?? undefined,
        systemMetricKey: rule.systemMetricKey ?? undefined,
        value: rule.value,
        sortOrder: rule.sortOrder,
        metadata: (rule.metadata as Record<string, unknown> | null) ?? undefined,
      })),
    })),
    rewardComponents: kpi.rewardComponents.map((component) => ({
      id: component.id,
      rewardTierRef: component.rewardTierId ? (tierRefById.get(component.rewardTierId) ?? null) : null,
      rewardTierCode: component.rewardTierId ? (tierCodeById.get(component.rewardTierId) ?? null) : null,
      stageDefinitionId: component.stageDefinitionId,
      parentComponentCode: component.parentComponentId ? (componentCodeById.get(component.parentComponentId) ?? null) : null,
      benefitTypeId: component.benefitTypeId,
      benefitTypeCode: component.benefitType.code,
      code: component.code,
      name: component.name,
      description: component.description,
      trigger: component.trigger,
      amountMode: component.amountMode,
      amountValue: component.amountValue,
      amountFieldKey: component.amountFieldKey,
      distributionMode: component.distributionMode,
      singleEligibleHandling: component.singleEligibleHandling,
      emptyShareHandling: component.emptyShareHandling,
      isActive: component.isActive,
      sortOrder: component.sortOrder,
      metadata: (component.metadata as Record<string, unknown> | null) ?? undefined,
      distributions: component.distributions.map((distribution) => ({
        id: distribution.id,
        contributorRoleId: distribution.contributorRoleId,
        contributorRoleCode: distribution.contributorRole?.code ?? null,
        selectorType: distribution.selectorType as BuilderRewardComponent["distributions"][number]["selectorType"],
        selectorTag: distribution.selectorTag,
        sharePercent: distribution.sharePercent,
        fixedAmount: distribution.fixedAmount,
        splitMode: distribution.splitMode as BuilderRewardComponent["distributions"][number]["splitMode"],
        sortOrder: distribution.sortOrder,
        metadata: (distribution.metadata as Record<string, unknown> | null) ?? undefined,
      })),
    })),
  };
}

export async function getKpiBuilder(
  kpiId: string,
  tenantId: string,
): Promise<KpiBuilderPayload | null> {
  const kpi = await prisma.kpiDefinition.findFirst({
    where: { id: kpiId, kraDefinition: { tenantId } },
    include: {
      applicableRoles: {
        include: {
          contributorRole: {
            select: { code: true },
          },
        },
        orderBy: [{ sortOrder: "asc" }, { contributorRoleId: "asc" }],
      },
      contributorConfig: true,
      stages: {
        orderBy: [{ stageOrder: "asc" }, { title: "asc" }],
      },
      rewardTiers: {
        include: { rules: { orderBy: { sortOrder: "asc" } } },
        orderBy: [{ priority: "asc" }, { code: "asc" }],
      },
      rewardComponents: {
        include: {
          benefitType: { select: { code: true } },
          distributions: {
            include: { contributorRole: { select: { code: true } } },
            orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          },
        },
        orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      },
    },
  });

  if (!kpi) return null;
  return mapPayloadFromKpi(kpi);
}

export async function saveKpiBuilder(
  tenantId: string,
  input: KpiBuilderPayloadInput,
  actorUserId: string,
  actorRole: Role,
): Promise<KraKpiActionResult> {
  if (!(await canManageKpiBuilder(tenantId, actorUserId, actorRole))) {
    return {
      status: "error",
      message: "Insufficient permissions.",
      code: "PERMISSION_DENIED",
    };
  }

  const parsed = kpiBuilderPayloadSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid builder payload.",
    };
  }

  const payload = parsed.data;
  const fieldReferenceError = validateBuilderFieldReferences(payload);
  if (fieldReferenceError) {
    return { status: "error", message: fieldReferenceError, code: "REWARD_CONFIG_INVALID" };
  }

  return prisma.$transaction(async (tx) => {
    const kra = await tx.kraDefinition.findFirst({
      where: { id: payload.definition.kraDefinitionId, tenantId },
      include: {
        period: { select: { state: true } },
        kpiDefinitions: {
          where: payload.definition.id
            ? { state: { not: "ARCHIVED" }, id: { not: payload.definition.id } }
            : { state: { not: "ARCHIVED" } },
          select: { weightage: true },
        },
      },
    });
    if (!kra) {
      return { status: "error", message: "KRA not found." } satisfies KraKpiActionResult;
    }
    if (!canModifyKpiInPeriodState(kra.period.state)) {
      return {
        status: "error",
        message: `Cannot modify KPI builder while the period is in "${kra.period.state}" state.`,
      } satisfies KraKpiActionResult;
    }

    const currentKpiSum = kra.kpiDefinitions.reduce((sum, kpi) => sum + kpi.weightage, 0);
    if (currentKpiSum + payload.definition.weightage > kra.weightage) {
      return {
        status: "error",
        message: `KPI weightage would exceed the parent KRA weightage (${kra.weightage}).`,
      } satisfies KraKpiActionResult;
    }

    const unitIds = [
      payload.definition.startingUnitId,
      payload.definition.keyUnitId ?? null,
      payload.definition.finalUnitId ?? null,
    ].filter((value): value is string => value != null);
    if (unitIds.length > 0) {
      const unitCount = await tx.orgUnit.count({
        where: { tenantId, id: { in: unitIds } },
      });
      if (unitCount !== unitIds.length) {
        return {
          status: "error",
          message: "One or more selected units are invalid.",
        } satisfies KraKpiActionResult;
      }
    }

    const workflowReviewerError = await validateWorkflowReviewerSelection({
      tenantId,
      keyUnitId: payload.definition.keyUnitId ?? null,
      finalUnitId: payload.definition.finalUnitId ?? null,
      keyReviewerUserId: payload.definition.keyReviewerUserId ?? null,
      finalReviewerUserId: payload.definition.finalReviewerUserId ?? null,
      tx,
    });
    if (workflowReviewerError) {
      return {
        status: "error",
        message: workflowReviewerError,
      } satisfies KraKpiActionResult;
    }

    const existing = payload.definition.id
      ? await tx.kpiDefinition.findFirst({
          where: { id: payload.definition.id, kraDefinition: { tenantId } },
          select: {
            id: true,
            allowMultipleAchievementsPerAllocation: true,
          },
        })
      : null;
    if (payload.definition.id) {
      if (!existing) {
        return { status: "error", message: "KPI not found." } satisfies KraKpiActionResult;
      }
    }

    const stageOrderSet = new Set<number>();
    for (const stage of payload.stages) {
      if (stageOrderSet.has(stage.stageOrder)) {
        return {
          status: "error",
          message: `Duplicate stage order ${stage.stageOrder} is not allowed.`,
        } satisfies KraKpiActionResult;
      }
      stageOrderSet.add(stage.stageOrder);
    }

    const multiAchievementModeError = validateMultiAchievementModeCompatibility({
      measurementType: payload.definition.measurementType,
      stageCount: payload.stages.length,
      allowMultipleAchievementsPerAllocation:
        payload.definition.allowMultipleAchievementsPerAllocation,
    });
    if (multiAchievementModeError) {
      return {
        status: "error",
        message: multiAchievementModeError,
      } satisfies KraKpiActionResult;
    }

    if (
      payload.definition.id
      && existing
      && existing.allowMultipleAchievementsPerAllocation
      && !payload.definition.allowMultipleAchievementsPerAllocation
    ) {
      const hasMultipleAchievements = await hasAllocationWithMultipleAchievements(
        tenantId,
        payload.definition.id,
        tx,
      );
      if (hasMultipleAchievements) {
        return {
          status: "error",
          message:
            "Cannot disable parallel achievement requests because one or more allocations already have multiple linked achievements.",
        } satisfies KraKpiActionResult;
      }
    }

    const contributionRolesJson =
      payload.definition.contributionRoles && payload.definition.contributionRoles.length > 0
        ? payload.definition.contributionRoles
        : null;

    const definitionData = {
      kraDefinitionId: payload.definition.kraDefinitionId,
      title: payload.definition.title,
      description: normalizeNullableString(payload.definition.description ?? null),
      measurementType: payload.definition.measurementType,
      unitLabel: normalizeNullableString(payload.definition.unitLabel ?? null),
      weightage: payload.definition.weightage,
      defaultTarget: payload.definition.defaultTarget ?? null,
      measurementConfig: toJson(payload.definition.measurementConfig),
      scoringMethod: payload.definition.scoringMethod,
      scoringDirection: payload.definition.scoringDirection,
      scoringConfig: toJson(payload.definition.scoringConfig),
      isPerCapita: payload.definition.isPerCapita,
      allocationType: payload.definition.allocationType,
      startingUnitId: payload.definition.startingUnitId,
      achievementTemplateKey: normalizeNullableString(payload.definition.achievementTemplateKey ?? null),
      achievementFormConfig: toJson(payload.definition.achievementFormConfig),
      guidanceNotes: normalizeNullableString(payload.definition.guidanceNotes ?? null),
      sortOrder: payload.definition.sortOrder,
      keyUnitId: normalizeNullableString(payload.definition.keyUnitId ?? null),
      finalUnitId: normalizeNullableString(payload.definition.finalUnitId ?? null),
      keyReviewerUserId: normalizeNullableString(payload.definition.keyReviewerUserId ?? null),
      finalReviewerUserId: normalizeNullableString(payload.definition.finalReviewerUserId ?? null),
      sopDescription: normalizeNullableString(payload.definition.sopDescription ?? null),
      evidenceRequired: payload.definition.evidenceRequired,
      evidenceTypes: payload.definition.evidenceTypes,
      evidenceInstructions: normalizeNullableString(payload.definition.evidenceInstructions ?? null),
      isTeamKpi: payload.definition.isTeamKpi,
      teamCreditMethod: payload.definition.isTeamKpi
        ? payload.definition.teamCreditMethod
        : "FULL_EACH",
      allowPartialCompletion: payload.definition.allowPartialCompletion,
      allowMultipleAchievementsPerAllocation:
        payload.definition.allowMultipleAchievementsPerAllocation,
      participantMode: payload.definition.participantMode,
      rewardRecurrencePolicy: payload.definition.rewardRecurrencePolicy,
      policyDateFieldKey: normalizeNullableString(payload.definition.policyDateFieldKey ?? null),
      contributionRoles: contributionRolesJson
        ? (contributionRolesJson as Prisma.InputJsonValue)
        : Prisma.JsonNull,
    };

    const kpi = payload.definition.id
      ? await tx.kpiDefinition.update({
          where: { id: payload.definition.id },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: definitionData as any,
          select: { id: true },
        })
      : await tx.kpiDefinition.create({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: definitionData as any,
          select: { id: true },
        });

    const rolesResult = await syncApplicableRoles(
      kpi.id,
      tenantId,
      payload.applicableRoles,
      contributionRolesJson,
      tx,
    );
    if (rolesResult) return rolesResult;

    await syncContributorConfig(kpi.id, payload.contributorConfig, tx);

    const stagesResult = await syncStages(kpi.id, payload.stages, tx);
    if (stagesResult) return stagesResult;

    const rewardResult = await syncRewardConfig(
      tenantId,
      kpi.id,
      payload.rewardTiers,
      payload.rewardComponents,
      tx,
    );
    if (rewardResult) return rewardResult;

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "KpiBuilder",
        targetId: kpi.id,
        action: payload.definition.id ? "UPDATE" : "CREATE",
        newState: {
          title: payload.definition.title,
          participantMode: payload.definition.participantMode,
          rewardRecurrencePolicy: payload.definition.rewardRecurrencePolicy,
          stageCount: payload.stages.length,
          rewardTierCount: payload.rewardTiers.length,
          rewardComponentCount: payload.rewardComponents.length,
        } as object,
      },
    });

    return {
      status: "success",
      message: payload.definition.id ? "KPI builder updated." : "KPI builder created.",
      id: kpi.id,
    } satisfies KraKpiActionResult;
  });
}
