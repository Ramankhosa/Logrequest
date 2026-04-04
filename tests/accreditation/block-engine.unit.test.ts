import { describe, expect, test } from "vitest";
import { Prisma } from "@prisma/client";
import {
  AccreditationScoreConversionType,
  BlockEntryStatus,
  BlockEntryValueSource,
  CriterionBlockType,
  CriterionBlockVisibility,
  CriterionDataType,
  CriterionYearAggregation,
} from "@prisma/client";
import {
  executeBlockScoringEngine,
  type BlockEngineContext,
  type BlockEngineCriterion,
  type BlockEngineEntry,
  type BlockEngineResponse,
  type BlockEngineVersion,
} from "@/lib/accreditation/block-execution-engine";
import { planBlockDependencies } from "@/lib/accreditation/block-dependency-planner";
import {
  evaluateFormula,
  parseFormulaDependencyBlockCodes,
} from "@/lib/accreditation/block-formula-evaluator";
import {
  resolveBlockInputs,
  type BlockResolverTableInstance,
} from "@/lib/accreditation/block-source-resolver";

function makeVersion(overrides: Partial<BlockEngineVersion> = {}): BlockEngineVersion {
  return {
    scoreBase: 100,
    convertedScaleMax: null,
    conversionType: AccreditationScoreConversionType.NONE,
    conversionFactor: null,
    gradeBands: [],
    thresholdRules: [],
    ...overrides,
  };
}

function makeCriterion(
  blockCode: string,
  overrides: Partial<BlockEngineCriterion> = {},
): BlockEngineCriterion {
  return {
    id: overrides.id ?? blockCode,
    parentId: overrides.parentId ?? null,
    blockCode,
    title: overrides.title ?? blockCode,
    blockType: overrides.blockType ?? CriterionBlockType.METRIC,
    visibility: overrides.visibility ?? CriterionBlockVisibility.VISIBLE_INPUT,
    contributesToTotal: overrides.contributesToTotal ?? true,
    isSectionRoot: overrides.isSectionRoot ?? false,
    dataType: overrides.dataType ?? CriterionDataType.QUANTITATIVE,
    yearAggregation: overrides.yearAggregation ?? CriterionYearAggregation.AVERAGE,
    yearAggregationConfig: overrides.yearAggregationConfig ?? null,
    maxScore: overrides.maxScore ?? 100,
    depth: overrides.depth ?? 0,
    isLeaf: overrides.isLeaf ?? true,
    inputSchema: overrides.inputSchema ?? null,
    outputSchema: overrides.outputSchema ?? null,
    calculationRule: overrides.calculationRule ?? null,
    scoringRule: overrides.scoringRule ?? null,
    dependencyRules: overrides.dependencyRules ?? null,
    sourceLinks: overrides.sourceLinks ?? null,
    scoringSlabs: overrides.scoringSlabs ?? [],
  };
}

function makeResponse(
  responseData: Prisma.JsonValue,
  overrides: Partial<BlockEngineResponse> = {},
): BlockEngineResponse {
  return {
    id: overrides.id ?? "resp-1",
    scopeKey: overrides.scopeKey ?? "YEAR:2026",
    year: overrides.year ?? 2026,
    responseData,
    responseMetadata: overrides.responseMetadata ?? null,
    dataSource: overrides.dataSource ?? BlockEntryValueSource.MANUAL,
    sourceRef: overrides.sourceRef ?? null,
  };
}

function makeEntry(
  blockId: string,
  responses: BlockEngineResponse[],
  overrides: Partial<BlockEngineEntry> = {},
): BlockEngineEntry {
  return {
    id: overrides.id ?? `entry-${blockId}`,
    blockId,
    status: overrides.status ?? BlockEntryStatus.IN_PROGRESS,
    manualOverride: overrides.manualOverride ?? null,
    manualOverrideForced: overrides.manualOverrideForced ?? false,
    responses,
    tableInstances: overrides.tableInstances ?? [],
  };
}

function makeContext(input: {
  version?: Partial<BlockEngineVersion>;
  criteria: BlockEngineCriterion[];
  entries?: BlockEngineEntry[];
  runtimeContext?: Record<string, unknown>;
}): BlockEngineContext {
  return {
    workspace: {
      version: makeVersion(input.version),
      profile: {
        weightOverrides: [],
      },
      entries: input.entries ?? [],
      periodStart: new Date("2026-01-01T00:00:00.000Z"),
      periodEnd: new Date("2026-12-31T00:00:00.000Z"),
    },
    criteria: input.criteria,
    runtimeContext: input.runtimeContext,
  };
}

function makeTableInstance(
  responseId: string,
  fieldKey: string,
  numbers: number[],
): BlockResolverTableInstance {
  return {
    responseId,
    scopeKey: "YEAR:2026",
    fieldKey,
    rows: numbers.map((value, index) => ({
      rowKey: `row-${index + 1}`,
      cells: [
        {
          columnKey: "amount",
          numberValue: value,
          textValue: null,
          booleanValue: null,
          dateValue: null,
          jsonValue: null,
        },
      ],
    })),
  };
}

describe("block formula evaluator", () => {
  test("returns null on divide by zero instead of throwing", () => {
    expect(
      evaluateFormula("inputs.publication_count / inputs.faculty_count", {
        inputs: {
          publication_count: 40,
          faculty_count: 0,
        },
      }),
    ).toBeNull();
  });

  test("extracts dependency block codes from formula refs", () => {
    expect(
      parseFormulaDependencyBlockCodes(
        "deps.CR1.finalScore + deps.CR2.outputs.helper_ratio + inputs.local_value",
      ),
    ).toEqual(["CR1", "CR2"]);
  });

  test("rejects unsupported formula roots", () => {
    expect(() =>
      evaluateFormula("response.value + 1", {
        inputs: {},
      }),
    ).toThrow(/Unsupported reference root "response"/);
  });
});

describe("block dependency planner", () => {
  test("rejects dependency cycles", () => {
    expect(() =>
      planBlockDependencies([
        {
          blockCode: "A",
          dependencyRules: [{ targetBlockCode: "B" }],
          calculationRule: null,
          scoringRule: null,
        },
        {
          blockCode: "B",
          dependencyRules: [{ targetBlockCode: "A" }],
          calculationRule: null,
          scoringRule: null,
        },
      ]),
    ).toThrow(/cycle/i);
  });

  test("rejects unknown dependency blocks referenced from formulas", () => {
    expect(() =>
      planBlockDependencies([
        {
          blockCode: "A",
          dependencyRules: null,
          calculationRule: {
            steps: [
              {
                type: "FORMULA",
                outputKey: "value",
                formula: "deps.MISSING.finalScore + 1",
              },
            ],
          },
          scoringRule: null,
        },
      ]),
    ).toThrow(/unknown dependency block MISSING/i);
  });
});

describe("block source resolver", () => {
  test("prefers linked/projected response values over manual values when multiple sources are provided", () => {
    const response = makeResponse(
      {
        manual_value: 10,
        linked_value: 25,
      },
      {
        responseMetadata: {
          fields: {
            manual_value: { sourceType: BlockEntryValueSource.MANUAL },
            linked_value: { sourceType: BlockEntryValueSource.PROJECTED },
          },
        },
      },
    );

    const resolved = resolveBlockInputs({
      inputDefinitions: {
        selected_value: {
          sources: ["response.manual_value", "response.linked_value"],
          required: true,
        },
      },
      inputSchema: null,
      response,
      tableInstances: [],
      outputs: {},
      deps: {},
      context: {},
    });

    expect(resolved.inputs.selected_value).toBe(25);
    expect(resolved.sources.selected_value).toMatchObject({
      sourceType: BlockEntryValueSource.PROJECTED,
    });
  });

  test("aggregates table counts and numeric columns", () => {
    const response = makeResponse({});
    const tableInstance = makeTableInstance(response.id ?? "resp-1", "publication_list", [5, 10, 15]);

    const resolved = resolveBlockInputs({
      inputDefinitions: {
        row_count: { source: "table.publication_list.count" },
        amount_sum: { source: "table.publication_list.amount.sum" },
        amount_avg: { source: "table.publication_list.amount.avg" },
        amount_max: { source: "table.publication_list.amount.max" },
        amount_min: { source: "table.publication_list.amount.min" },
      },
      inputSchema: null,
      response,
      tableInstances: [tableInstance],
      outputs: {},
      deps: {},
      context: {},
    });

    expect(resolved.inputs).toMatchObject({
      row_count: 3,
      amount_sum: 30,
      amount_avg: 10,
      amount_max: 15,
      amount_min: 5,
    });
  });

  test("marks required missing values as unresolved", () => {
    const resolved = resolveBlockInputs({
      inputDefinitions: {
        required_value: {
          source: "context.missing_value",
          required: true,
        },
      },
      inputSchema: null,
      response: null,
      tableInstances: [],
      outputs: {},
      deps: {},
      context: {},
    });

    expect(resolved.inputs.required_value).toBeNull();
    expect(resolved.unresolved).toEqual([
      {
        input: "required_value",
        reason: "Required input could not be resolved.",
      },
    ]);
  });
});

describe("block execution engine edge cases", () => {
  test("propagates unresolved required inputs to execution status", () => {
    const block = makeCriterion("CR1", {
      inputSchema: {
        fields: {
          publication_count: { required: true },
          faculty_count: { required: true },
        },
      },
      calculationRule: {
        inputs: {
          publication_count: { source: "response.publication_count", required: true },
          faculty_count: { source: "response.faculty_count", required: true },
        },
        steps: [
          {
            type: "FORMULA",
            outputKey: "ratio",
            formula: "inputs.publication_count / inputs.faculty_count",
          },
        ],
        resultKey: "ratio",
      },
      scoringRule: { type: "DIRECT" },
    });

    const response = makeResponse({ publication_count: 50 });
    const entry = makeEntry(block.id, [response]);
    const result = executeBlockScoringEngine(
      makeContext({
        criteria: [block],
        entries: [entry],
      }),
    );

    expect(result.blockScores[block.id]).toMatchObject({
      computedScore: null,
      finalScore: null,
      executionStatus: "UNRESOLVED",
    });
    expect(result.leafEntryUpdates[0]).toMatchObject({
      executionStatus: "UNRESOLVED",
    });
  });

  test("handles formula divide-by-zero without crashing or coercing to zero", () => {
    const block = makeCriterion("CR1", {
      calculationRule: {
        inputs: {
          numerator: { source: "response.numerator", required: true },
          denominator: { source: "response.denominator", required: true },
        },
        steps: [
          {
            type: "FORMULA",
            outputKey: "ratio",
            formula: "inputs.numerator / inputs.denominator",
          },
        ],
        resultKey: "ratio",
      },
      scoringRule: { type: "DIRECT" },
    });

    const response = makeResponse({ numerator: 10, denominator: 0 });
    const entry = makeEntry(block.id, [response]);
    const result = executeBlockScoringEngine(
      makeContext({
        criteria: [block],
        entries: [entry],
      }),
    );

    expect(result.blockScores[block.id]).toMatchObject({
      computedScore: null,
      finalScore: null,
      executionStatus: "SUCCESS",
    });
    expect(result.responseUpdates[0]?.computedOutput).toMatchObject({
      numerator: 10,
      denominator: 0,
      ratio: null,
    });
  });

  test("supports WEIGHTED scoring mode", () => {
    const block = makeCriterion("CR1", {
      maxScore: 100,
      calculationRule: {
        inputs: {
          impact: { source: "response.impact" },
          quality: { source: "response.quality" },
        },
        steps: [
          { type: "DIRECT", outputKey: "impact", source: "inputs.impact" },
          { type: "DIRECT", outputKey: "quality", source: "inputs.quality" },
        ],
        resultKey: "impact",
      },
      scoringRule: {
        type: "WEIGHTED",
        components: [
          { key: "impact", weight: 0.6 },
          { key: "quality", weight: 0.4 },
        ],
      },
    });

    const entry = makeEntry(block.id, [makeResponse({ impact: 60, quality: 80 })]);
    const result = executeBlockScoringEngine(makeContext({ criteria: [block], entries: [entry] }));

    expect(result.blockScores[block.id]?.computedScore).toBe(68);
    expect(result.blockScores[block.id]?.finalScore).toBe(68);
  });

  test("supports RUBRIC scoring mode", () => {
    const block = makeCriterion("CR1", {
      maxScore: 20,
      calculationRule: {
        inputs: {
          score: { source: "response.score" },
        },
        steps: [
          { type: "DIRECT", outputKey: "score", source: "inputs.score" },
        ],
        resultKey: "score",
      },
      scoringRule: {
        type: "RUBRIC",
        levels: [
          { when: "outputs.score >= 90", points: 20 },
          { when: "outputs.score >= 75", points: 10 },
        ],
      },
    });

    const entry = makeEntry(block.id, [makeResponse({ score: 80 })]);
    const result = executeBlockScoringEngine(makeContext({ criteria: [block], entries: [entry] }));

    expect(result.blockScores[block.id]?.computedScore).toBe(10);
  });

  test("supports MANUAL_ONLY and NONE scoring modes", () => {
    const manualOnly = makeCriterion("CR1", {
      maxScore: 100,
      scoringRule: { type: "MANUAL_ONLY" },
    });
    const none = makeCriterion("CR2", {
      maxScore: 100,
      scoringRule: { type: "NONE" },
    });

    const manualEntry = makeEntry(manualOnly.id, [makeResponse({ value: 5 }, { id: "resp-manual" })], {
      manualOverride: 77,
    });
    const noneEntry = makeEntry(none.id, [makeResponse({ value: 12 }, { id: "resp-none" })]);

    const result = executeBlockScoringEngine(
      makeContext({
        criteria: [manualOnly, none],
        entries: [manualEntry, noneEntry],
      }),
    );

    expect(result.blockScores[manualOnly.id]).toMatchObject({
      computedScore: null,
      finalScore: 77,
    });
    expect(result.blockScores[none.id]).toMatchObject({
      computedScore: null,
      finalScore: null,
    });
  });

  test("supports table aggregation inputs inside the engine", () => {
    const block = makeCriterion("CR1", {
      maxScore: 100,
      calculationRule: {
        inputs: {
          total_amount: { source: "table.publication_list.amount.sum", required: true },
        },
        steps: [
          { type: "DIRECT", outputKey: "total_amount", source: "inputs.total_amount" },
        ],
        resultKey: "total_amount",
      },
      scoringRule: { type: "DIRECT" },
    });

    const response = makeResponse({}, { id: "resp-table" });
    const entry = makeEntry(block.id, [response], {
      tableInstances: [makeTableInstance("resp-table", "publication_list", [4, 6, 10])],
    });
    const result = executeBlockScoringEngine(makeContext({ criteria: [block], entries: [entry] }));

    expect(result.blockScores[block.id]).toMatchObject({
      aggregatedValue: 20,
      computedScore: 20,
      finalScore: 20,
    });
  });

  test("applies LINEAR_FACTOR conversion", () => {
    const block = makeCriterion("CR1", {
      maxScore: 100,
    });
    const entry = makeEntry(block.id, [makeResponse({ value: 40 })]);
    const result = executeBlockScoringEngine(
      makeContext({
        version: {
          conversionType: AccreditationScoreConversionType.LINEAR_FACTOR,
          conversionFactor: 2.5,
        },
        criteria: [block],
        entries: [entry],
      }),
    );

    expect(result.overallRawScore).toBe(40);
    expect(result.overallConvertedScore).toBe(100);
  });

  test("applies LINEAR_RATIO conversion", () => {
    const block = makeCriterion("CR1", {
      maxScore: 20,
    });
    const entry = makeEntry(block.id, [makeResponse({ value: 10 })]);
    const result = executeBlockScoringEngine(
      makeContext({
        version: {
          scoreBase: 20,
          convertedScaleMax: 4,
          conversionType: AccreditationScoreConversionType.LINEAR_RATIO,
        },
        criteria: [block],
        entries: [entry],
      }),
    );

    expect(result.overallRawScore).toBe(10);
    expect(result.overallConvertedScore).toBe(2);
  });
});
