import {
  AccreditationScoreConversionType,
  BlockEntryStatus,
  CriterionBlockType,
  CriterionBlockVisibility,
  CriterionDataType,
  CriterionYearAggregation,
  Prisma,
} from "@prisma/client";
import { createHash } from "node:crypto";
import { planBlockDependencies } from "./block-dependency-planner";
import { evaluateFormula } from "./block-formula-evaluator";
import {
  resolveBlockInputs,
  type BlockResolverDependencyValue,
  type BlockResolverResponse,
  type BlockResolverTableInstance,
} from "./block-source-resolver";

type BlockScoringSlab = {
  rangeMin: number | null;
  rangeMax: number | null;
  pointsAwarded: number;
  sortOrder: number;
};

export type BlockEngineCriterion = {
  id: string;
  parentId: string | null;
  blockCode: string;
  title: string;
  blockType: CriterionBlockType;
  visibility: CriterionBlockVisibility;
  contributesToTotal: boolean;
  isSectionRoot: boolean;
  dataType: CriterionDataType;
  yearAggregation: CriterionYearAggregation;
  yearAggregationConfig: Prisma.JsonValue | null;
  maxScore: number | null;
  depth: number;
  isLeaf: boolean;
  inputSchema: Prisma.JsonValue | null;
  outputSchema: Prisma.JsonValue | null;
  calculationRule: Prisma.JsonValue | null;
  scoringRule: Prisma.JsonValue | null;
  dependencyRules: Prisma.JsonValue | null;
  sourceLinks: Prisma.JsonValue | null;
  scoringSlabs: BlockScoringSlab[];
};

export type BlockEngineResponse = BlockResolverResponse;

export type BlockEngineEntry = {
  id: string;
  blockId: string;
  status: BlockEntryStatus;
  manualOverride: number | null;
  manualOverrideForced: boolean;
  responses: BlockEngineResponse[];
  tableInstances: BlockResolverTableInstance[];
};

export type BlockEngineVersion = {
  scoreBase: number;
  convertedScaleMax: number | null;
  conversionType?: AccreditationScoreConversionType | null;
  conversionFactor?: number | null;
  gradeBands: Array<{
    gradeLabel: string;
    scoreMin: number;
    scoreMax: number;
    outcome: string;
    sortOrder: number;
  }>;
  thresholdRules: Array<{
    thresholdType: string;
    blockId: string | null;
    minValue: number;
    outcome: string;
    description: string | null;
  }>;
};

export type BlockEngineProfile = {
  weightOverrides: Array<{
    blockId: string;
    maxScore: number;
  }>;
};

export type BlockEngineWorkspace = {
  version: BlockEngineVersion;
  profile: BlockEngineProfile;
  entries: BlockEngineEntry[];
  periodStart?: Date;
  periodEnd?: Date;
};

export type BlockEngineContext = {
  workspace: BlockEngineWorkspace;
  criteria: BlockEngineCriterion[];
  runtimeContext?: Record<string, unknown>;
};

export type BlockEngineScoreRow = {
  blockId: string;
  blockCode: string;
  title: string;
  depth: number;
  isLeaf: boolean;
  maxScore: number | null;
  aggregatedValue: number | null;
  computedScore: number | null;
  finalScore: number | null;
  percentage: number | null;
  status: BlockEntryStatus | null;
  outputs?: Record<string, unknown>;
  executionStatus?: string | null;
};

export type BlockEngineResult = {
  overallRawScore: number | null;
  overallConvertedScore: number | null;
  resolvedGrade: string | null;
  resolvedOutcome: string | null;
  thresholdResult: {
    passed: boolean;
    violations: Array<{
      thresholdType: string;
      blockId: string | null;
      blockCode: string | null;
      actualValue: number | null;
      minValue: number;
      outcome: string;
      description: string | null;
    }>;
  };
  blockScores: Record<string, BlockEngineScoreRow>;
  leafEntryUpdates: Array<{
    entryId: string;
    blockId: string;
    computedScore: number | null;
    finalScore: number | null;
    executionStatus: string | null;
    executionMeta: Prisma.JsonObject;
    lastExecutionHash: string;
  }>;
  responseUpdates: Array<{
    responseId: string;
    computedOutput: Prisma.JsonObject;
    computedScore: number | null;
  }>;
  dataSourceCounts: Record<string, number>;
};

type StepExecutionEnv = {
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  deps: Record<string, BlockResolverDependencyValue>;
  context: Record<string, unknown>;
};

type ResponseExecutionResult = {
  computedOutput: Prisma.JsonObject;
  metricValue: number | null;
  unresolved: Array<{ input: string; reason: string }>;
  errors: string[];
};

type BlockExecutionState = {
  outputs: Record<string, unknown>;
  aggregatedOutputs: Record<string, unknown>;
  aggregatedValue: number | null;
  computedScore: number | null;
  finalScore: number | null;
  executionStatus: string | null;
  executionMeta: Prisma.JsonObject;
};

function asJsonObject(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Prisma.JsonObject;
}

function asJsonArray(value: Prisma.JsonValue | null | undefined) {
  return Array.isArray(value) ? value : [];
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function asNumericValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function roundScore(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  return Math.round(value * 100) / 100;
}

function clampScore(value: number, maxScore: number | null) {
  if (!Number.isFinite(value)) {
    return null;
  }
  if (maxScore === null) {
    return Math.max(0, value);
  }
  return Math.min(Math.max(0, value), maxScore);
}

function defaultWeightedRecentWeights() {
  return [0.4, 0.3, 0.2, 0.1];
}

function resolveAggregationWeights(
  block: Pick<BlockEngineCriterion, "yearAggregationConfig">,
  count: number,
) {
  const configuredWeights = asJsonArray(asJsonObject(block.yearAggregationConfig)?.weights as Prisma.JsonValue | undefined)
    .map((item) => asNumericValue(item))
    .filter((item): item is number => item !== null && item > 0);
  const baseWeights = configuredWeights.length > 0 ? configuredWeights : defaultWeightedRecentWeights();
  const weights = [...baseWeights];

  while (weights.length < count) {
    weights.push(weights[weights.length - 1] ?? 1);
  }

  const selected = weights.slice(0, count);
  const total = selected.reduce((sum, value) => sum + value, 0);
  return total > 0 ? selected.map((value) => value / total) : selected.map(() => 1 / count);
}

function aggregateNumericYearData(
  block: Pick<BlockEngineCriterion, "yearAggregation" | "yearAggregationConfig">,
  rows: Array<{ year: number; value: number | null }>,
) {
  const values = rows
    .filter((row) => row.value !== null)
    .sort((left, right) => left.year - right.year)
    .map((row) => ({ year: row.year, value: row.value! }));

  if (values.length === 0) {
    return null;
  }

  switch (block.yearAggregation) {
    case CriterionYearAggregation.SUM:
      return values.reduce((sum, row) => sum + row.value, 0);
    case CriterionYearAggregation.LATEST:
      return values[values.length - 1]?.value ?? null;
    case CriterionYearAggregation.MAX:
      return Math.max(...values.map((row) => row.value));
    case CriterionYearAggregation.WEIGHTED_RECENT: {
      const newestFirst = [...values].sort((left, right) => right.year - left.year);
      const weights = resolveAggregationWeights(block, newestFirst.length);
      return newestFirst.reduce((sum, row, index) => sum + row.value * (weights[index] ?? 0), 0);
    }
    case CriterionYearAggregation.AVERAGE:
    default:
      return values.reduce((sum, row) => sum + row.value, 0) / values.length;
  }
}

function resolveReferenceValue(reference: string | undefined, env: StepExecutionEnv) {
  if (!reference) {
    return null;
  }

  const segments = reference.split(".");
  let current: unknown;
  const root = segments[0] ?? "";
  if (root === "inputs") {
    current = env.inputs;
  } else if (root === "outputs") {
    current = env.outputs;
  } else if (root === "deps") {
    const blockCode = segments[1] ?? "";
    const dependency = env.deps[blockCode];
    if (!dependency) {
      return null;
    }
    if (segments[2] === "finalScore") {
      return dependency.finalScore;
    }
    if (segments[2] === "computedScore") {
      return dependency.computedScore;
    }
    if (segments[2] === "aggregatedValue") {
      return dependency.aggregatedValue;
    }
    current = dependency.outputs;
    segments.splice(0, 3);
  } else if (root === "context") {
    current = env.context;
  } else {
    return null;
  }

  const remaining = root === "deps" ? segments : segments.slice(1);
  for (const segment of remaining) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return null;
    }
    current = Reflect.get(current as Record<string, unknown>, segment);
  }
  return current ?? null;
}

function sumNumericValues(values: unknown[]) {
  const numbers = values.map(asNumericValue).filter((value): value is number => value !== null);
  return numbers.length > 0 ? numbers.reduce((sum, value) => sum + value, 0) : null;
}

function executeCalculationStep(
  step: Prisma.JsonObject,
  env: StepExecutionEnv,
): unknown {
  const stepType = typeof step.type === "string" ? step.type.toUpperCase() : "DIRECT";
  const outputKey = typeof step.outputKey === "string" ? step.outputKey : null;

  switch (stepType) {
    case "DIRECT": {
      const source =
        typeof step.source === "string"
          ? step.source
          : typeof step.path === "string"
            ? step.path
            : typeof step.inputKey === "string"
              ? `inputs.${step.inputKey}`
              : outputKey
                ? `inputs.${outputKey}`
                : "inputs.value";
      return resolveReferenceValue(source, env);
    }
    case "FORMULA":
      return typeof step.formula === "string"
        ? evaluateFormula(step.formula, env)
        : null;
    case "SUM_FIELDS": {
      const refs = asJsonArray(step.fields as Prisma.JsonValue | undefined)
        .map((item) => (typeof item === "string" ? resolveReferenceValue(item, env) : null));
      return sumNumericValues(refs);
    }
    case "PERCENTAGE": {
      const numerator = asNumericValue(
        resolveReferenceValue(typeof step.numerator === "string" ? step.numerator : "inputs.numerator", env),
      );
      const denominator = asNumericValue(
        resolveReferenceValue(typeof step.denominator === "string" ? step.denominator : "inputs.denominator", env),
      );
      if (numerator === null || denominator === null || denominator === 0) {
        return null;
      }
      return (numerator / denominator) * 100;
    }
    case "RATIO": {
      const numerator = asNumericValue(
        resolveReferenceValue(typeof step.numerator === "string" ? step.numerator : "inputs.numerator", env),
      );
      const denominator = asNumericValue(
        resolveReferenceValue(typeof step.denominator === "string" ? step.denominator : "inputs.denominator", env),
      );
      if (numerator === null || denominator === null || denominator === 0) {
        return null;
      }
      return numerator / denominator;
    }
    case "CLAMP": {
      const value = asNumericValue(
        resolveReferenceValue(typeof step.source === "string" ? step.source : `outputs.${outputKey ?? "value"}`, env),
      );
      const min = asNumericValue(step.min) ?? 0;
      const max = asNumericValue(step.max);
      if (value === null) {
        return null;
      }
      return max === null ? Math.max(min, value) : Math.min(Math.max(min, value), max);
    }
    case "NORMALIZE": {
      const value = asNumericValue(
        resolveReferenceValue(typeof step.source === "string" ? step.source : `outputs.${outputKey ?? "value"}`, env),
      );
      const min = asNumericValue(step.min);
      const max = asNumericValue(step.max);
      const scale = asNumericValue(step.scale) ?? 100;
      if (value === null || min === null || max === null || max === min) {
        return null;
      }
      return ((value - min) / (max - min)) * scale;
    }
    case "ROLLUP_SUM": {
      const items = asJsonArray(step.items as Prisma.JsonValue | undefined);
      if (items.length === 0) {
        return sumNumericValues(Object.values(env.deps).map((dependency) => dependency.finalScore));
      }
      return sumNumericValues(
        items.map((item) => {
          const itemObject = asJsonObject(item as Prisma.JsonValue);
          const ref =
            typeof itemObject?.source === "string"
              ? itemObject.source
              : typeof itemObject?.blockCode === "string"
                ? `deps.${itemObject.blockCode}.${typeof itemObject.key === "string" ? itemObject.key : "finalScore"}`
                : null;
          return ref ? resolveReferenceValue(ref, env) : null;
        }),
      );
    }
    case "ROLLUP_WEIGHTED": {
      const items = asJsonArray(step.items as Prisma.JsonValue | undefined);
      if (items.length === 0) {
        return null;
      }
      let total = 0;
      let hasAny = false;
      for (const item of items) {
        const itemObject = asJsonObject(item as Prisma.JsonValue);
        const weight = asNumericValue(itemObject?.weight) ?? 0;
        const ref =
          typeof itemObject?.source === "string"
            ? itemObject.source
            : typeof itemObject?.blockCode === "string"
              ? `deps.${itemObject.blockCode}.${typeof itemObject.key === "string" ? itemObject.key : "finalScore"}`
              : null;
        const value = ref ? asNumericValue(resolveReferenceValue(ref, env)) : null;
        if (value === null) {
          continue;
        }
        total += value * weight;
        hasAny = true;
      }
      return hasAny ? total : null;
    }
    case "PICK_FIRST_NON_NULL":
      return (
        asJsonArray(step.fields as Prisma.JsonValue | undefined)
          .map((item) => (typeof item === "string" ? resolveReferenceValue(item, env) : null))
          .find((value) => value !== null && value !== undefined) ?? null
      );
    default:
      return null;
  }
}

function normalizeScoringSlabs(block: BlockEngineCriterion) {
  const scoringRule = asJsonObject(block.scoringRule);
  const ruleSlabs = asJsonArray(scoringRule?.slabs as Prisma.JsonValue | undefined)
    .map((slab, index) => {
      const slabObject = asJsonObject(slab as Prisma.JsonValue);
      const points =
        asNumericValue(slabObject?.pointsAwarded) ??
        asNumericValue(slabObject?.points) ??
        null;
      if (points === null) {
        return null;
      }
      return {
        rangeMin: asNumericValue(slabObject?.rangeMin) ?? asNumericValue(slabObject?.min),
        rangeMax: asNumericValue(slabObject?.rangeMax) ?? asNumericValue(slabObject?.max),
        pointsAwarded: points,
        sortOrder: asNumericValue(slabObject?.sortOrder) ?? index,
      };
    })
    .filter((item): item is BlockScoringSlab => item !== null);

  return (ruleSlabs.length > 0 ? ruleSlabs : block.scoringSlabs).sort(
    (left, right) => left.sortOrder - right.sortOrder,
  );
}

function matchesScoringSlab(value: number, slab: BlockScoringSlab) {
  const meetsMin = slab.rangeMin === null || value >= slab.rangeMin;
  const meetsMax = slab.rangeMax === null || value <= slab.rangeMax;
  return meetsMin && meetsMax;
}

function computeEffectiveMaxScores(
  criteria: BlockEngineCriterion[],
  profile: BlockEngineProfile,
) {
  const byId = new Map(criteria.map((block) => [block.id, block]));
  const childrenByParent = new Map<string | null, string[]>();
  for (const block of criteria) {
    const existing = childrenByParent.get(block.parentId) ?? [];
    existing.push(block.id);
    childrenByParent.set(block.parentId, existing);
  }
  const weights = new Map(profile.weightOverrides.map((weight) => [weight.blockId, weight.maxScore]));
  const cache = new Map<string, number | null>();

  const resolve = (blockId: string): number | null => {
    if (cache.has(blockId)) {
      return cache.get(blockId) ?? null;
    }
    const weighted = weights.get(blockId);
    if (weighted !== undefined) {
      cache.set(blockId, weighted);
      return weighted;
    }
    const block = byId.get(blockId);
    if (!block) {
      cache.set(blockId, null);
      return null;
    }
    if (block.maxScore !== null) {
      cache.set(blockId, block.maxScore);
      return block.maxScore;
    }
    const childIds = childrenByParent.get(blockId) ?? [];
    if (childIds.length === 0) {
      cache.set(blockId, null);
      return null;
    }
    const sum = childIds.reduce((total, childId) => total + (resolve(childId) ?? 0), 0);
    const resolved = sum > 0 ? sum : null;
    cache.set(blockId, resolved);
    return resolved;
  };

  return { resolve, childrenByParent };
}

function deriveDefaultContext(workspace: BlockEngineWorkspace) {
  return {
    workspace: {
      scoreBase: workspace.version.scoreBase,
      convertedScaleMax: workspace.version.convertedScaleMax,
      startYear: workspace.periodStart?.getUTCFullYear() ?? null,
      endYear: workspace.periodEnd?.getUTCFullYear() ?? null,
    },
  } satisfies Record<string, unknown>;
}

function executeResponseCalculation(
  block: BlockEngineCriterion,
  entry: BlockEngineEntry,
  response: BlockEngineResponse,
  deps: Record<string, BlockResolverDependencyValue>,
  runtimeContext: Record<string, unknown>,
) {
  const calculationRule = asJsonObject(block.calculationRule);
  const outputs: Record<string, unknown> = {};
  const errors: string[] = [];
  const tableInstances = entry.tableInstances.filter((instance) => {
    if (response.id && instance.responseId) {
      return instance.responseId === response.id;
    }
    return instance.scopeKey === response.scopeKey;
  });

  const inputsResult = resolveBlockInputs({
    inputDefinitions: calculationRule?.inputs as Prisma.JsonValue | undefined,
    inputSchema: block.inputSchema,
    response,
    tableInstances,
    outputs,
    deps,
    context: runtimeContext,
  });

  const env: StepExecutionEnv = {
    inputs: inputsResult.inputs,
    outputs,
    deps,
    context: runtimeContext,
  };

  const responseData = asJsonObject(response.responseData) ?? {};
  const defaultMetricValue =
    block.dataType === CriterionDataType.QUALITATIVE
      ? null
      : asNumericValue(responseData.value ?? null);

  if (calculationRule) {
    const steps = asJsonArray(calculationRule.steps as Prisma.JsonValue | undefined);
    for (const stepValue of steps) {
      const step = asJsonObject(stepValue as Prisma.JsonValue);
      if (!step) {
        continue;
      }
      const outputKey = typeof step.outputKey === "string" ? step.outputKey : null;
      try {
        const result = executeCalculationStep(step, env);
        if (outputKey) {
          outputs[outputKey] = result;
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "Failed to execute calculation step.");
      }
    }
  }

  const resultKey =
    typeof calculationRule?.resultKey === "string"
      ? calculationRule.resultKey
      : typeof calculationRule?.primaryOutputKey === "string"
        ? calculationRule.primaryOutputKey
        : outputs.value !== undefined
          ? "value"
          : null;
  const metricValue = resultKey ? asNumericValue(outputs[resultKey]) : defaultMetricValue;
  const computedOutput = {
    ...responseData,
    ...outputs,
    ...(resultKey && metricValue !== null ? { value: metricValue } : {}),
  } satisfies Prisma.JsonObject;

  return {
    computedOutput,
    metricValue,
    unresolved: inputsResult.unresolved,
    errors,
  } satisfies ResponseExecutionResult;
}

function aggregateOutputKey(
  block: BlockEngineCriterion,
  values: Array<{ year: number; value: unknown }>,
) {
  const numericRows = values
    .map((item) => ({ year: item.year, value: asNumericValue(item.value) }))
    .filter((item) => item.value !== null);
  if (numericRows.length === 0) {
    const ordered = [...values].sort((left, right) => left.year - right.year);
    for (let index = ordered.length - 1; index >= 0; index -= 1) {
      const value = ordered[index]?.value;
      if (value !== null && value !== undefined) {
        return value;
      }
    }
    return null;
  }
  return aggregateNumericYearData(block, numericRows);
}

function determineScoringMode(block: BlockEngineCriterion) {
  const scoringRule = asJsonObject(block.scoringRule);
  if (typeof scoringRule?.type === "string") {
    return scoringRule.type.toUpperCase();
  }
  if (block.dataType === CriterionDataType.QUALITATIVE) {
    return "NONE";
  }
  return block.scoringSlabs.length > 0 ? "SLAB" : "DIRECT";
}

function computeScoreFromRule(
  block: BlockEngineCriterion,
  aggregatedValue: number | null,
  aggregatedOutputs: Record<string, unknown>,
  deps: Record<string, BlockResolverDependencyValue>,
  runtimeContext: Record<string, unknown>,
) {
  const scoringRule = asJsonObject(block.scoringRule);
  const mode = determineScoringMode(block);
  const env: StepExecutionEnv = {
    inputs: { value: aggregatedValue, ...aggregatedOutputs },
    outputs: aggregatedOutputs,
    deps,
    context: runtimeContext,
  };

  switch (mode) {
    case "SLAB": {
      const value =
        typeof scoringRule?.source === "string"
          ? asNumericValue(resolveReferenceValue(scoringRule.source, env))
          : aggregatedValue;
      if (value === null) {
        return null;
      }
      const slab = normalizeScoringSlabs(block).find((item) => matchesScoringSlab(value, item));
      return slab ? slab.pointsAwarded : null;
    }
    case "DIRECT":
      if (typeof scoringRule?.formula === "string") {
        return asNumericValue(evaluateFormula(scoringRule.formula, env));
      }
      if (typeof scoringRule?.source === "string") {
        return asNumericValue(resolveReferenceValue(scoringRule.source, env));
      }
      return aggregatedValue;
    case "WEIGHTED": {
      if (typeof scoringRule?.formula === "string") {
        return asNumericValue(evaluateFormula(scoringRule.formula, env));
      }
      const components = asJsonArray(scoringRule?.components as Prisma.JsonValue | undefined);
      let total = 0;
      let hasAny = false;
      for (const componentValue of components) {
        const component = asJsonObject(componentValue as Prisma.JsonValue);
        const weight = asNumericValue(component?.weight) ?? 0;
        const value =
          typeof component?.formula === "string"
            ? asNumericValue(evaluateFormula(component.formula, env))
            : typeof component?.source === "string"
              ? asNumericValue(resolveReferenceValue(component.source, env))
              : typeof component?.key === "string"
                ? asNumericValue(aggregatedOutputs[component.key])
                : null;
        if (value === null) {
          continue;
        }
        total += value * weight;
        hasAny = true;
      }
      return hasAny ? total : null;
    }
    case "RUBRIC": {
      const levels = asJsonArray(scoringRule?.levels as Prisma.JsonValue | undefined);
      for (const levelValue of levels) {
        const level = asJsonObject(levelValue as Prisma.JsonValue);
        const matches =
          typeof level?.when === "string"
            ? Boolean(evaluateFormula(level.when, env))
            : typeof level?.condition === "string"
              ? Boolean(evaluateFormula(level.condition, env))
              : false;
        if (!matches) {
          continue;
        }
        return asNumericValue(level?.points) ?? asNumericValue(level?.score);
      }
      return null;
    }
    case "MANUAL_ONLY":
    case "NONE":
      return null;
    default:
      return aggregatedValue;
  }
}

function applyConversion(
  version: BlockEngineVersion,
  overallRawScore: number | null,
) {
  if (overallRawScore === null) {
    return null;
  }

  const conversionType = version.conversionType ?? AccreditationScoreConversionType.NONE;
  if (conversionType === AccreditationScoreConversionType.LINEAR_FACTOR) {
    return roundScore(overallRawScore * (version.conversionFactor ?? 1));
  }
  if (conversionType === AccreditationScoreConversionType.LINEAR_RATIO) {
    if (version.convertedScaleMax !== null && version.scoreBase > 0) {
      return roundScore((overallRawScore / version.scoreBase) * version.convertedScaleMax);
    }
    return roundScore(overallRawScore);
  }
  if (version.convertedScaleMax !== null && version.scoreBase > 0) {
    return roundScore((overallRawScore / version.scoreBase) * version.convertedScaleMax);
  }
  return roundScore(overallRawScore);
}

function matchesGradeBand(
  gradeBasis: number,
  band: BlockEngineVersion["gradeBands"][number],
  isLast: boolean,
) {
  const meetsMin = gradeBasis >= band.scoreMin;
  const meetsMax = isLast ? gradeBasis <= band.scoreMax : gradeBasis < band.scoreMax;
  return meetsMin && meetsMax;
}

export function executeBlockScoringEngine(context: BlockEngineContext): BlockEngineResult {
  const criterionById = new Map(context.criteria.map((block) => [block.id, block]));
  const criterionByCode = new Map(context.criteria.map((block) => [block.blockCode, block]));
  const entryByBlockId = new Map(context.workspace.entries.map((entry) => [entry.blockId, entry]));
  const { resolve: resolveEffectiveMaxScore, childrenByParent } = computeEffectiveMaxScores(
    context.criteria,
    context.workspace.profile,
  );
  const dependencyPlan = planBlockDependencies(
    context.criteria.map((block) => ({
      blockCode: block.blockCode,
      dependencyRules: block.dependencyRules,
      calculationRule: block.calculationRule,
      scoringRule: block.scoringRule,
    })),
  );
  const dataSourceCounts = new Map<string, number>();
  for (const entry of context.workspace.entries) {
    for (const response of entry.responses) {
      dataSourceCounts.set(response.dataSource, (dataSourceCounts.get(response.dataSource) ?? 0) + 1);
    }
  }

  const runtimeContext = {
    ...deriveDefaultContext(context.workspace),
    ...(context.runtimeContext ?? {}),
  };

  const blockScores = new Map<string, BlockEngineScoreRow>();
  const blockStates = new Map<string, BlockExecutionState>();
  const responseUpdates: BlockEngineResult["responseUpdates"] = [];
  const leafEntryUpdates: BlockEngineResult["leafEntryUpdates"] = [];

  for (const blockCode of dependencyPlan.orderedBlockCodes) {
    const block = criterionByCode.get(blockCode);
    if (!block) {
      continue;
    }

    const entry = entryByBlockId.get(block.id);
    const effectiveMax = resolveEffectiveMaxScore(block.id);
    const childIds = childrenByParent.get(block.id) ?? [];
    const dependencyValues = Object.fromEntries(
      (dependencyPlan.dependencyMap[blockCode] ?? []).map((dependencyCode) => {
        const dependencyBlock = criterionByCode.get(dependencyCode);
        const state = dependencyBlock ? blockStates.get(dependencyBlock.id) : null;
        return [
          dependencyCode,
          {
            outputs: state?.aggregatedOutputs ?? {},
            finalScore: state?.finalScore ?? null,
            computedScore: state?.computedScore ?? null,
            aggregatedValue: state?.aggregatedValue ?? null,
          } satisfies BlockResolverDependencyValue,
        ];
      }),
    );

    if (block.isLeaf) {
      const fallbackEntry: BlockEngineEntry = {
        id: "",
        blockId: block.id,
        status: BlockEntryStatus.BLANK,
        manualOverride: null,
        manualOverrideForced: false,
        responses: [],
        tableInstances: [],
      };
      const responses = entry?.responses ?? [];
      const responseResults = responses.map((response) => {
        const result = executeResponseCalculation(
          block,
          entry ?? fallbackEntry,
          response,
          dependencyValues,
          runtimeContext,
        );
        if (response.id) {
          responseUpdates.push({
            responseId: response.id,
            computedOutput: result.computedOutput,
            computedScore: null,
          });
        }
        return { response, result };
      });

      const aggregatedValue =
        block.dataType === CriterionDataType.QUALITATIVE
          ? null
          : roundScore(
              aggregateNumericYearData(
                block,
                responseResults.map(({ response, result }) => ({
                  year: response.year ?? 0,
                  value: result.metricValue,
                })),
              ),
            );

      const aggregatedOutputKeys = [...new Set(responseResults.flatMap(({ result }) => Object.keys(result.computedOutput)))];
      const aggregatedOutputs = Object.fromEntries(
        aggregatedOutputKeys.map((key) => [
          key,
          aggregateOutputKey(
            block,
            responseResults.map(({ response, result }) => ({
              year: response.year ?? 0,
              value: (result.computedOutput as Record<string, unknown>)[key] ?? null,
            })),
          ),
        ]),
      );

      const computedScore = roundScore(
        (() => {
          const raw = computeScoreFromRule(block, aggregatedValue, aggregatedOutputs, dependencyValues, runtimeContext);
          return raw === null ? null : clampScore(raw, effectiveMax);
        })(),
      );
      const finalScore = roundScore(
        entry?.manualOverride !== null && entry?.manualOverride !== undefined
          ? entry.manualOverride
          : computedScore,
      );
      const unresolved = responseResults.flatMap(({ result }) => result.unresolved);
      const errors = responseResults.flatMap(({ result }) => result.errors);
      const executionStatus =
        errors.length > 0
          ? "ERROR"
          : unresolved.length > 0
            ? "UNRESOLVED"
            : responses.length === 0
              ? "PARTIAL"
              : "SUCCESS";
      const executionMeta = {
        unresolvedInputs: unresolved,
        errors,
        responseScopes: responseResults.map(({ response }) => response.scopeKey),
        dataSources: [...new Set(responses.map((response) => response.dataSource))],
      } satisfies Prisma.JsonObject;
      const lastExecutionHash = createHash("sha256")
        .update(
          stableStringify({
            blockCode: block.blockCode,
            responses: responseResults.map(({ response, result }) => ({
              scopeKey: response.scopeKey,
              year: response.year,
              responseData: response.responseData,
              computedOutput: result.computedOutput,
            })),
            aggregatedOutputs,
            finalScore,
          }),
        )
        .digest("hex");

      blockScores.set(block.id, {
        blockId: block.id,
        blockCode: block.blockCode,
        title: block.title,
        depth: block.depth,
        isLeaf: true,
        maxScore: effectiveMax,
        aggregatedValue,
        computedScore,
        finalScore,
        percentage:
          effectiveMax && finalScore !== null && effectiveMax > 0
            ? roundScore((finalScore / effectiveMax) * 100)
            : null,
        status: entry?.status ?? null,
        outputs: aggregatedOutputs,
        executionStatus,
      });
      blockStates.set(block.id, {
        outputs: aggregatedOutputs,
        aggregatedOutputs,
        aggregatedValue,
        computedScore,
        finalScore,
        executionStatus,
        executionMeta,
      });

      if (entry) {
        leafEntryUpdates.push({
          entryId: entry.id,
          blockId: block.id,
          computedScore,
          finalScore,
          executionStatus,
          executionMeta,
          lastExecutionHash,
        });
      }
      continue;
    }

    const childScores = childIds
      .map((childId) => blockStates.get(childId))
      .filter((state): state is BlockExecutionState => state !== undefined);
    const summedChildScores =
      childScores.length > 0 ? childScores.reduce((sum, child) => sum + (child.finalScore ?? 0), 0) : null;
    const computedScore = roundScore(
      summedChildScores === null
        ? null
        : clampScore(summedChildScores, effectiveMax),
    );
    const finalScore = computedScore;
    const aggregatedOutputs = {
      childCount: childIds.length,
      childScoreSum: summedChildScores,
    } satisfies Record<string, unknown>;
    const executionStatus =
      childScores.some((state) => state.executionStatus === "ERROR")
        ? "ERROR"
        : childScores.some((state) => state.executionStatus === "UNRESOLVED")
          ? "UNRESOLVED"
          : "SUCCESS";
    const executionMeta = {
      rollupType: "SUM",
      childBlockCodes: childIds
        .map((childId) => criterionById.get(childId)?.blockCode ?? null)
        .filter((value): value is string => !!value),
    } satisfies Prisma.JsonObject;

    blockScores.set(block.id, {
      blockId: block.id,
      blockCode: block.blockCode,
      title: block.title,
      depth: block.depth,
      isLeaf: false,
      maxScore: effectiveMax,
      aggregatedValue: null,
      computedScore,
      finalScore,
      percentage:
        effectiveMax && finalScore !== null && effectiveMax > 0
          ? roundScore((finalScore / effectiveMax) * 100)
          : null,
      status: null,
      outputs: aggregatedOutputs,
      executionStatus,
    });
    blockStates.set(block.id, {
      outputs: aggregatedOutputs,
      aggregatedOutputs,
      aggregatedValue: null,
      computedScore,
      finalScore,
      executionStatus,
      executionMeta,
    });
  }

  const rootBlockIds = context.criteria
    .filter((block) => block.parentId === null && block.contributesToTotal)
    .map((block) => block.id);
  const overallRawScore = roundScore(
    rootBlockIds.reduce((sum, blockId) => sum + (blockScores.get(blockId)?.finalScore ?? 0), 0),
  );
  const overallConvertedScore = applyConversion(context.workspace.version, overallRawScore);
  const gradeBasis = overallConvertedScore ?? overallRawScore;
  const matchingBand =
    gradeBasis === null
      ? null
      : context.workspace.version.gradeBands.find((band, index, bands) =>
          matchesGradeBand(gradeBasis, band, index === bands.length - 1),
        ) ?? null;

  const thresholdViolations = context.workspace.version.thresholdRules
    .map((rule) => {
      const criterionScore = rule.blockId
        ? blockScores.get(rule.blockId)?.finalScore ?? null
        : overallConvertedScore ?? overallRawScore;
      const blockCode = rule.blockId
        ? blockScores.get(rule.blockId)?.blockCode ?? null
        : null;
      if (criterionScore === null || criterionScore >= rule.minValue) {
        return null;
      }
      return {
        thresholdType: rule.thresholdType,
        blockId: rule.blockId,
        blockCode,
        actualValue: roundScore(criterionScore),
        minValue: rule.minValue,
        outcome: rule.outcome,
        description: rule.description ?? null,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return {
    overallRawScore,
    overallConvertedScore,
    resolvedGrade: matchingBand?.gradeLabel ?? null,
    resolvedOutcome: thresholdViolations[0]?.outcome ?? matchingBand?.outcome ?? null,
    thresholdResult: {
      passed: thresholdViolations.length === 0,
      violations: thresholdViolations,
    },
    blockScores: Object.fromEntries(blockScores.entries()),
    leafEntryUpdates,
    responseUpdates,
    dataSourceCounts: Object.fromEntries(dataSourceCounts.entries()),
  };
}
