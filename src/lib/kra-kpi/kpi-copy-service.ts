import type { Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { kpiCopySelectionSchema, type KpiBuilderPayload, type KpiCopySelection } from "./builder-shared";
import type { KraKpiActionResult } from "./shared";
import { getKpiBuilder, saveKpiBuilder } from "./kpi-builder-service";

const tenantOwnerRole = "TENANT_OWNER" satisfies Role;
const tenantAdminRole = "TENANT_ADMIN" satisfies Role;

function isTenantAdmin(role: Role): boolean {
  return (
    role === tenantOwnerRole ||
    role === tenantAdminRole ||
    role === "SUPERADMIN"
  );
}

const copyInputSchema = z.object({
  sourceKpiId: z.string().trim().min(1),
  targetKraDefinitionId: z.string().trim().min(1),
  targetKpiId: z.string().trim().min(1).optional(),
  titleOverride: z.string().trim().max(200).optional(),
  startingUnitId: z.string().trim().min(1).optional(),
  selection: kpiCopySelectionSchema.default(() => ({
    basics: true,
    fields: true,
    participantPolicy: true,
    externalContributorPolicy: true,
    duplicateCheckPolicy: true,
    roles: true,
    stages: true,
    tiers: true,
    rewardComponents: true,
    distributions: true,
  })),
});

export type CopyKpiBuilderConfigInput = z.input<typeof copyInputSchema>;

function getSectionPresence(payload: KpiBuilderPayload) {
  return {
    basics: true,
    fields: (payload.definition.achievementFormConfig?.fields.length ?? 0) > 0,
    participantPolicy: true,
    externalContributorPolicy:
      payload.contributorConfig.externalContribTemplateId != null ||
      payload.contributorConfig.allowExternalContributors !== true,
    duplicateCheckPolicy: payload.contributorConfig.duplicateCheckFields.length > 0,
    roles: payload.applicableRoles.length > 0,
    stages: payload.stages.length > 0,
    tiers: payload.rewardTiers.length > 0,
    rewardComponents: payload.rewardComponents.length > 0,
    distributions: payload.rewardComponents.some((component) => component.distributions.length > 0),
  };
}

function hasRoleBoundRewardConfig(payload: KpiBuilderPayload): boolean {
  return payload.rewardComponents.some((component) =>
    component.distributions.some((distribution) => distribution.selectorType === "ROLE"),
  );
}

function hasStageBoundRewardConfig(payload: KpiBuilderPayload): boolean {
  return payload.rewardComponents.some((component) => component.stageDefinitionId != null);
}

function hasTierBoundRewardConfig(payload: KpiBuilderPayload): boolean {
  return payload.rewardComponents.some((component) => component.rewardTierCode != null);
}

function rewardConfigReferencesFields(payload: KpiBuilderPayload): boolean {
  return (
    payload.rewardTiers.some((tier) =>
      tier.rules.some((rule) => rule.source === "FORM_FIELD" && rule.fieldKey != null),
    ) ||
    payload.rewardComponents.some((component) => component.amountFieldKey != null) ||
    payload.contributorConfig.duplicateCheckFields.length > 0 ||
    payload.definition.policyDateFieldKey != null
  );
}

function resolveCopySelection(
  source: KpiBuilderPayload,
  selection: KpiCopySelection,
): KpiCopySelection {
  const resolved = { ...selection };

  if (resolved.distributions && source.rewardComponents.some((component) => component.distributions.length > 0)) {
    resolved.rewardComponents = true;
  }
  if (resolved.rewardComponents && hasTierBoundRewardConfig(source)) {
    resolved.tiers = true;
  }
  if (resolved.rewardComponents && hasStageBoundRewardConfig(source)) {
    resolved.stages = true;
  }
  if ((resolved.tiers || resolved.rewardComponents || resolved.distributions) && hasRoleBoundRewardConfig(source)) {
    resolved.roles = true;
  }
  if (
    (resolved.tiers || resolved.rewardComponents || resolved.duplicateCheckPolicy) &&
    rewardConfigReferencesFields(source)
  ) {
    resolved.fields = true;
  }
  if (resolved.participantPolicy && source.definition.rewardRecurrencePolicy === "ONCE_PER_UNIQUE_KEY") {
    resolved.duplicateCheckPolicy = true;
    resolved.fields = true;
  }

  return resolved;
}

function summarizePayload(payload: KpiBuilderPayload) {
  return {
    fields:
      payload.definition.achievementFormConfig?.fields.map((field) => ({
        key: field.key,
        label: field.label,
        type: field.type,
      })) ?? [],
    roles: payload.applicableRoles.map((role) => ({
      roleId: role.roleId ?? null,
      roleCode: role.roleCode ?? null,
      isDefault: role.isDefault,
    })),
    stages: payload.stages.map((stage) => ({
      id: stage.id ?? null,
      title: stage.title,
      stageOrder: stage.stageOrder,
    })),
    tiers: payload.rewardTiers.map((tier) => ({
      code: tier.code,
      name: tier.name,
      tierSetKey: tier.tierSetKey,
    })),
    rewardComponents: payload.rewardComponents.map((component) => ({
      code: component.code,
      name: component.name,
      rewardTierCode: component.rewardTierCode ?? null,
      distributionCount: component.distributions.length,
    })),
  };
}

function applyCopySelection(
  source: KpiBuilderPayload,
  target: KpiBuilderPayload | null,
  selection: KpiCopySelection,
  targetKraDefinitionId: string,
  titleOverride?: string,
  startingUnitId?: string,
): KpiBuilderPayload {
  const base = target ?? source;
  const next: KpiBuilderPayload = structuredClone(base);

  if (selection.basics || !target) {
    next.definition = {
      ...next.definition,
      ...source.definition,
      kraDefinitionId: targetKraDefinitionId,
      id: target?.definition.id,
    };
  }

  if (selection.fields || !target) {
    next.definition.achievementTemplateKey = source.definition.achievementTemplateKey;
    next.definition.achievementFormConfig = source.definition.achievementFormConfig;
    next.definition.policyDateFieldKey = source.definition.policyDateFieldKey;
  }

  if (selection.participantPolicy || !target) {
    next.definition.participantMode = source.definition.participantMode;
    next.definition.rewardRecurrencePolicy = source.definition.rewardRecurrencePolicy;
    next.definition.isTeamKpi = source.definition.isTeamKpi;
    next.definition.teamCreditMethod = source.definition.teamCreditMethod;
    next.definition.allowPartialCompletion = source.definition.allowPartialCompletion;
  }

  if (selection.externalContributorPolicy || !target) {
    next.contributorConfig.externalContribTemplateId =
      source.contributorConfig.externalContribTemplateId;
    next.contributorConfig.allowExternalContributors =
      source.contributorConfig.allowExternalContributors;
  }

  if (selection.duplicateCheckPolicy || !target) {
    next.contributorConfig.duplicateCheckFields = source.contributorConfig.duplicateCheckFields;
    next.contributorConfig.creditSumMode = source.contributorConfig.creditSumMode;
  }

  if (selection.roles || !target) {
    next.applicableRoles = source.applicableRoles;
    next.definition.contributionRoles = source.definition.contributionRoles;
  }

  if (selection.stages || !target) {
    next.stages = source.stages.map((stage) => ({ ...stage, id: undefined }));
  }

  if (selection.tiers || !target) {
    next.rewardTiers = source.rewardTiers.map((tier) => ({ ...tier, id: undefined }));
  }

  if (selection.rewardComponents || !target) {
    next.rewardComponents = source.rewardComponents.map((component) => ({
      ...component,
      id: undefined,
      stageDefinitionId: selection.stages || !target ? undefined : component.stageDefinitionId,
      distributions:
        selection.distributions || !target
          ? component.distributions.map((distribution) => ({ ...distribution, id: undefined }))
          : [],
    }));
  } else if (selection.distributions || !target) {
    const sourceByCode = new Map(source.rewardComponents.map((component) => [component.code, component]));
    next.rewardComponents = next.rewardComponents.map((component) => ({
      ...component,
      distributions:
        sourceByCode.get(component.code)?.distributions.map((distribution) => ({
          ...distribution,
          id: undefined,
        })) ?? component.distributions,
    }));
  }

  next.definition.kraDefinitionId = targetKraDefinitionId;
  if (titleOverride?.trim()) {
    next.definition.title = titleOverride.trim();
  }
  if (startingUnitId?.trim()) {
    next.definition.startingUnitId = startingUnitId.trim();
  }

  return next;
}

export async function previewKpiCopy(sourceKpiId: string, tenantId: string) {
  const source = await prisma.kpiDefinition.findFirst({
    where: {
      id: sourceKpiId,
      state: { not: "ARCHIVED" },
      kraDefinition: { tenantId },
    },
    select: {
      id: true,
      title: true,
      state: true,
      kraDefinition: {
        select: {
          id: true,
          title: true,
          period: { select: { id: true, name: true, code: true } },
        },
      },
    },
  });
  if (!source) return null;

  const payload = await getKpiBuilder(sourceKpiId, tenantId);
  if (!payload) return null;

  return {
    sourceKpiId: source.id,
    title: source.title,
    sourceKraId: source.kraDefinition.id,
    sourceKraTitle: source.kraDefinition.title,
    sourcePeriodId: source.kraDefinition.period.id,
    sourcePeriodName: source.kraDefinition.period.name,
    sourcePeriodCode: source.kraDefinition.period.code,
    sourceState: source.state,
    sections: getSectionPresence(payload),
    counts: {
      fieldCount: payload.definition.achievementFormConfig?.fields.length ?? 0,
      roleCount: payload.applicableRoles.length,
      stageCount: payload.stages.length,
      tierCount: payload.rewardTiers.length,
      rewardComponentCount: payload.rewardComponents.length,
    },
    dependencyHints: {
      distributionsRequireRewardComponents: payload.rewardComponents.some(
        (component) => component.distributions.length > 0,
      ),
      rewardComponentsRequireTiers: hasTierBoundRewardConfig(payload),
      rewardComponentsRequireStages: hasStageBoundRewardConfig(payload),
      rewardConfigUsesRoleSelectors: hasRoleBoundRewardConfig(payload),
    },
    summary: summarizePayload(payload),
  };
}

export async function copyKpiBuilderConfig(
  tenantId: string,
  input: CopyKpiBuilderConfigInput,
  actorUserId: string,
  actorRole: Role,
): Promise<KraKpiActionResult> {
  if (!isTenantAdmin(actorRole)) {
    return { status: "error", message: "Insufficient permissions.", code: "PERMISSION_DENIED" };
  }

  const parsed = copyInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const data = parsed.data;
  const source = await getKpiBuilder(data.sourceKpiId, tenantId);
  if (!source) {
    return { status: "error", message: "Source KPI not found.", code: "KPI_COPY_SOURCE_NOT_FOUND" };
  }

  const target = data.targetKpiId ? await getKpiBuilder(data.targetKpiId, tenantId) : null;
  const resolvedSelection = resolveCopySelection(source, data.selection);
  const payload = applyCopySelection(
    source,
    target,
    resolvedSelection,
    data.targetKraDefinitionId,
    data.titleOverride,
    data.startingUnitId,
  );

  return saveKpiBuilder(tenantId, payload, actorUserId, actorRole);
}
