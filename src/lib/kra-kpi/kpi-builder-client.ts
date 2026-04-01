import type {
  KpiBuilderPayload,
  KpiCopySelection,
} from "./builder-shared";

type CopySectionFlags = {
  basics: boolean;
  fields: boolean;
  participantPolicy: boolean;
  externalContributorPolicy: boolean;
  duplicateCheckPolicy: boolean;
  roles: boolean;
  stages: boolean;
  tiers: boolean;
  rewardComponents: boolean;
  distributions: boolean;
};

export function createEmptyBuilderPayload(
  kraDefinitionId: string,
  startingUnitId: string,
): KpiBuilderPayload {
  return {
    definition: {
      kraDefinitionId,
      title: "",
      description: null,
      measurementType: "NUMERIC",
      unitLabel: null,
      weightage: 0,
      defaultTarget: null,
      measurementConfig: null,
      scoringMethod: "LINEAR",
      scoringDirection: "ASCENDING",
      scoringConfig: null,
      isPerCapita: false,
      allocationType: "BOTH",
      startingUnitId,
      achievementTemplateKey: null,
      achievementFormConfig: null,
      guidanceNotes: null,
      sortOrder: 0,
      keyUnitId: null,
      finalUnitId: null,
      sopDescription: null,
      evidenceRequired: true,
      evidenceTypes: [],
      evidenceInstructions: null,
      isTeamKpi: false,
      teamCreditMethod: "FULL_EACH",
      allowPartialCompletion: true,
      allowMultipleAchievementsPerAllocation: false,
      participantMode: "SINGLE_OWNER",
      rewardRecurrencePolicy: "RECURRING",
      policyDateFieldKey: null,
      contributionRoles: null,
    },
    applicableRoles: [],
    contributorConfig: {
      externalContribTemplateId: null,
      allowExternalContributors: true,
      duplicateCheckFields: [],
      creditSumMode: "MUST_EQUAL_100",
    },
    stages: [],
    rewardTiers: [],
    rewardComponents: [],
  };
}

export function applyTemplateToDraftPayload(input: {
  templatePayload: KpiBuilderPayload;
  kraDefinitionId: string;
  startingUnitId: string;
  existingId?: string;
  titleOverride?: string;
}): KpiBuilderPayload {
  const next = structuredClone(input.templatePayload);
  next.definition.id = input.existingId;
  next.definition.kraDefinitionId = input.kraDefinitionId;
  next.definition.startingUnitId = input.startingUnitId;
  if (input.titleOverride?.trim()) {
    next.definition.title = input.titleOverride.trim();
  }
  return next;
}

function cloneWithoutIds(payload: KpiBuilderPayload): KpiBuilderPayload {
  return {
    ...structuredClone(payload),
    definition: {
      ...structuredClone(payload.definition),
      id: undefined,
    },
    stages: payload.stages.map((stage) => ({ ...structuredClone(stage), id: undefined })),
    rewardTiers: payload.rewardTiers.map((tier) => ({ ...structuredClone(tier), id: undefined })),
    rewardComponents: payload.rewardComponents.map((component) => ({
      ...structuredClone(component),
      id: undefined,
      distributions: component.distributions.map((distribution) => ({
        ...structuredClone(distribution),
        id: undefined,
      })),
    })),
  };
}

export function applyCopySelectionToDraft(input: {
  source: KpiBuilderPayload;
  target: KpiBuilderPayload | null;
  selection: KpiCopySelection;
  targetKraDefinitionId: string;
  startingUnitId: string;
  titleOverride?: string;
}): KpiBuilderPayload {
  const source = cloneWithoutIds(input.source);
  const base = input.target ? structuredClone(input.target) : source;
  const next: KpiBuilderPayload = structuredClone(base);
  const selection = input.selection;

  if (selection.basics || !input.target) {
    next.definition = {
      ...next.definition,
      ...source.definition,
      id: input.target?.definition.id,
      kraDefinitionId: input.targetKraDefinitionId,
      startingUnitId: input.startingUnitId,
    };
  }

  if (selection.fields || !input.target) {
    next.definition.achievementTemplateKey = source.definition.achievementTemplateKey;
    next.definition.achievementFormConfig = source.definition.achievementFormConfig;
    next.definition.policyDateFieldKey = source.definition.policyDateFieldKey;
  }

  if (selection.participantPolicy || !input.target) {
    next.definition.participantMode = source.definition.participantMode;
    next.definition.rewardRecurrencePolicy = source.definition.rewardRecurrencePolicy;
    next.definition.isTeamKpi = source.definition.isTeamKpi;
    next.definition.teamCreditMethod = source.definition.teamCreditMethod;
    next.definition.allowPartialCompletion = source.definition.allowPartialCompletion;
    next.definition.allowMultipleAchievementsPerAllocation =
      source.definition.allowMultipleAchievementsPerAllocation;
  }

  if (selection.externalContributorPolicy || !input.target) {
    next.contributorConfig.externalContribTemplateId =
      source.contributorConfig.externalContribTemplateId;
    next.contributorConfig.allowExternalContributors =
      source.contributorConfig.allowExternalContributors;
  }

  if (selection.duplicateCheckPolicy || !input.target) {
    next.contributorConfig.duplicateCheckFields =
      structuredClone(source.contributorConfig.duplicateCheckFields);
    next.contributorConfig.creditSumMode = source.contributorConfig.creditSumMode;
  }

  if (selection.roles || !input.target) {
    next.applicableRoles = structuredClone(source.applicableRoles);
    next.definition.contributionRoles = structuredClone(source.definition.contributionRoles);
  }

  if (selection.stages || !input.target) {
    next.stages = source.stages.map((stage) => ({ ...structuredClone(stage), id: undefined }));
  }

  if (selection.tiers || !input.target) {
    next.rewardTiers = source.rewardTiers.map((tier) => ({ ...structuredClone(tier), id: undefined }));
  }

  if (selection.rewardComponents || !input.target) {
    next.rewardComponents = source.rewardComponents.map((component) => ({
      ...structuredClone(component),
      id: undefined,
      stageDefinitionId: selection.stages || !input.target ? undefined : component.stageDefinitionId,
      distributions:
        selection.distributions || !input.target
          ? component.distributions.map((distribution) => ({
              ...structuredClone(distribution),
              id: undefined,
            }))
          : [],
    }));
  } else if (selection.distributions || !input.target) {
    const sourceByCode = new Map(source.rewardComponents.map((component) => [component.code, component]));
    next.rewardComponents = next.rewardComponents.map((component) => ({
      ...component,
      distributions:
        sourceByCode.get(component.code)?.distributions.map((distribution) => ({
          ...structuredClone(distribution),
          id: undefined,
        })) ?? component.distributions,
    }));
  }

  next.definition.kraDefinitionId = input.targetKraDefinitionId;
  next.definition.startingUnitId = input.startingUnitId;
  if (input.titleOverride?.trim()) {
    next.definition.title = input.titleOverride.trim();
  }

  return next;
}

export function applyCopyDependencies(
  selection: KpiCopySelection,
  sourceHints?: Partial<CopySectionFlags> | null,
): KpiCopySelection {
  const resolved: KpiCopySelection = { ...selection };

  if (resolved.distributions && (sourceHints?.distributions ?? true)) {
    resolved.rewardComponents = true;
  }
  if (resolved.rewardComponents && (sourceHints?.rewardComponents ?? true)) {
    resolved.tiers = true;
  }
  if (
    (resolved.tiers || resolved.rewardComponents || resolved.duplicateCheckPolicy) &&
    (sourceHints?.fields ?? true)
  ) {
    resolved.fields = true;
  }
  if ((resolved.tiers || resolved.rewardComponents || resolved.distributions) && (sourceHints?.roles ?? true)) {
    resolved.roles = true;
  }
  if (resolved.rewardComponents && (sourceHints?.stages ?? false)) {
    resolved.stages = true;
  }
  if (resolved.participantPolicy && (sourceHints?.duplicateCheckPolicy ?? false)) {
    resolved.duplicateCheckPolicy = true;
    resolved.fields = true;
  }

  return resolved;
}
