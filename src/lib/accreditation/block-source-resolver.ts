import { BlockEntryValueSource, Prisma } from "@prisma/client";

export type BlockResolverResponse = {
  id?: string;
  scopeKey: string;
  year: number | null;
  responseData: Prisma.JsonValue;
  responseMetadata?: Prisma.JsonValue | null;
  dataSource: BlockEntryValueSource;
  sourceRef?: string | null;
};

export type BlockResolverTableCell = {
  columnKey: string;
  numberValue: number | null;
  textValue: string | null;
  booleanValue: boolean | null;
  dateValue: Date | null;
  jsonValue: Prisma.JsonValue | null;
};

export type BlockResolverTableRow = {
  rowKey?: string | null;
  dimensions?: Prisma.JsonValue | null;
  cells: BlockResolverTableCell[];
};

export type BlockResolverTableInstance = {
  responseId?: string;
  scopeKey: string;
  fieldKey: string;
  rows: BlockResolverTableRow[];
};

export type BlockResolverDependencyValue = {
  outputs: Record<string, unknown>;
  finalScore: number | null;
  computedScore: number | null;
  aggregatedValue: number | null;
};

export type BlockResolverCandidate = {
  value: unknown;
  sourceType: BlockEntryValueSource | "CONTEXT" | "DEPENDENCY" | "DEFAULT" | "TABLE";
  sourceRef?: string | null;
};

type ResolveInputValueArgs = {
  alias: string;
  definition: Prisma.JsonValue | null | undefined;
  response: BlockResolverResponse | null;
  tableInstances: BlockResolverTableInstance[];
  outputs: Record<string, unknown>;
  deps: Record<string, BlockResolverDependencyValue>;
  context: Record<string, unknown>;
  inputSchema: Prisma.JsonValue | null | undefined;
};

export type ResolveBlockInputsResult = {
  inputs: Record<string, unknown>;
  unresolved: Array<{ input: string; reason: string }>;
  sources: Record<string, { sourceType: string; sourceRef?: string | null }>;
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

function getObjectPathValue(object: Record<string, unknown>, path: string[]) {
  let current: unknown = object;
  for (const segment of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return null;
    }
    current = Reflect.get(current as Record<string, unknown>, segment);
  }
  return current ?? null;
}

function getResponseFieldMetadata(response: BlockResolverResponse | null, fieldKey: string) {
  const metadataFields = asJsonObject(asJsonObject(response?.responseMetadata)?.fields as Prisma.JsonValue | undefined);
  return asJsonObject(metadataFields?.[fieldKey] as Prisma.JsonValue | undefined);
}

function getResponseFieldValue(response: BlockResolverResponse | null, fieldKey: string) {
  const data = asJsonObject(response?.responseData);
  return data?.[fieldKey] ?? null;
}

function normalizeSourceType(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  return value as BlockEntryValueSource;
}

function responseCandidatePriority(sourceType: BlockEntryValueSource | null) {
  switch (sourceType) {
    case BlockEntryValueSource.KPI_LINKED:
    case BlockEntryValueSource.EXTERNAL:
    case BlockEntryValueSource.PROJECTED:
      return 1;
    case BlockEntryValueSource.MANUAL:
      return 2;
    case BlockEntryValueSource.IMPORTED:
    case BlockEntryValueSource.CLONED:
      return 3;
    default:
      return 4;
  }
}

function pickBestCandidate(candidates: BlockResolverCandidate[]) {
  return [...candidates]
    .filter((candidate) => candidate.value !== null && candidate.value !== undefined)
    .sort((left, right) => {
      const leftPriority =
        left.sourceType === "CONTEXT" || left.sourceType === "DEPENDENCY" || left.sourceType === "DEFAULT" || left.sourceType === "TABLE"
          ? 5
          : responseCandidatePriority(left.sourceType);
      const rightPriority =
        right.sourceType === "CONTEXT" || right.sourceType === "DEPENDENCY" || right.sourceType === "DEFAULT" || right.sourceType === "TABLE"
          ? 5
          : responseCandidatePriority(right.sourceType);
      return leftPriority - rightPriority;
    })[0] ?? null;
}

function collectTableValues(
  tableInstances: BlockResolverTableInstance[],
  response: BlockResolverResponse | null,
  fieldKey: string,
  columnKey?: string,
) {
  const relevant = tableInstances.filter((instance) => {
    if (instance.fieldKey !== fieldKey) {
      return false;
    }
    if (response?.id && instance.responseId) {
      return instance.responseId === response.id;
    }
    return instance.scopeKey === (response?.scopeKey ?? "DEFAULT");
  });

  if (!columnKey) {
    return relevant.flatMap((instance) => instance.rows);
  }

  return relevant.flatMap((instance) =>
    instance.rows.flatMap((row) =>
      row.cells
        .filter((cell) => cell.columnKey === columnKey)
        .map((cell) => {
          if (cell.numberValue !== null && cell.numberValue !== undefined) {
            return cell.numberValue;
          }
          if (cell.textValue !== null && cell.textValue !== undefined) {
            return cell.textValue;
          }
          if (cell.booleanValue !== null && cell.booleanValue !== undefined) {
            return cell.booleanValue;
          }
          if (cell.dateValue !== null && cell.dateValue !== undefined) {
            return cell.dateValue;
          }
          return cell.jsonValue;
        }),
    ),
  );
}

function aggregateTableValue(values: unknown[], aggregation: string) {
  switch (aggregation) {
    case "COUNT":
      return values.length;
    case "SUM": {
      const numbers = values.map(asNumericValue).filter((value): value is number => value !== null);
      return numbers.length > 0 ? numbers.reduce((sum, value) => sum + value, 0) : null;
    }
    case "AVG": {
      const numbers = values.map(asNumericValue).filter((value): value is number => value !== null);
      return numbers.length > 0 ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
    }
    case "MAX": {
      const numbers = values.map(asNumericValue).filter((value): value is number => value !== null);
      return numbers.length > 0 ? Math.max(...numbers) : null;
    }
    case "MIN": {
      const numbers = values.map(asNumericValue).filter((value): value is number => value !== null);
      return numbers.length > 0 ? Math.min(...numbers) : null;
    }
    default:
      return null;
  }
}

function resolveSourceFromString(
  source: string,
  args: Omit<ResolveInputValueArgs, "definition" | "alias" | "inputSchema">,
): BlockResolverCandidate | null {
  if (source.startsWith("response.")) {
    const fieldKey = source.slice("response.".length);
    const metadata = getResponseFieldMetadata(args.response, fieldKey);
    return {
      value: getResponseFieldValue(args.response, fieldKey),
      sourceType: normalizeSourceType(metadata?.sourceType) ?? args.response?.dataSource ?? BlockEntryValueSource.MANUAL,
      sourceRef:
        (typeof metadata?.sourceRef === "string" ? metadata.sourceRef : null) ??
        args.response?.sourceRef ??
        null,
    };
  }

  if (source.startsWith("outputs.")) {
    const key = source.slice("outputs.".length);
    return {
      value: args.outputs[key] ?? null,
      sourceType: "DEFAULT",
    };
  }

  if (source.startsWith("deps.")) {
    const [, blockCode, ...path] = source.split(".");
    const blockValue = args.deps[blockCode ?? ""];
    if (!blockValue) {
      return null;
    }
    if (path.length === 0) {
      return {
        value: blockValue,
        sourceType: "DEPENDENCY",
        sourceRef: blockCode ?? null,
      };
    }
    if (path[0] === "finalScore") {
      return {
        value: blockValue.finalScore,
        sourceType: "DEPENDENCY",
        sourceRef: blockCode ?? null,
      };
    }
    if (path[0] === "computedScore") {
      return {
        value: blockValue.computedScore,
        sourceType: "DEPENDENCY",
        sourceRef: blockCode ?? null,
      };
    }
    if (path[0] === "aggregatedValue") {
      return {
        value: blockValue.aggregatedValue,
        sourceType: "DEPENDENCY",
        sourceRef: blockCode ?? null,
      };
    }
    if (path[0] === "outputs") {
      return {
        value: getObjectPathValue(blockValue.outputs, path.slice(1)),
        sourceType: "DEPENDENCY",
        sourceRef: blockCode ?? null,
      };
    }
    return {
      value: getObjectPathValue(blockValue.outputs, path),
      sourceType: "DEPENDENCY",
      sourceRef: blockCode ?? null,
    };
  }

  if (source.startsWith("context.")) {
    return {
      value: getObjectPathValue(args.context, source.slice("context.".length).split(".")),
      sourceType: "CONTEXT",
    };
  }

  const tableCount = source.match(/^table\.([A-Za-z0-9_]+)\.count$/);
  if (tableCount) {
    const fieldKey = tableCount[1] ?? "";
    return {
      value: collectTableValues(args.tableInstances, args.response, fieldKey).length,
      sourceType: "TABLE",
      sourceRef: fieldKey,
    };
  }

  const tableAggregate = source.match(/^table\.([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\.(sum|avg|max|min)$/i);
  if (tableAggregate) {
    const fieldKey = tableAggregate[1] ?? "";
    const columnKey = tableAggregate[2] ?? "";
    const aggregation = (tableAggregate[3] ?? "").toUpperCase();
    return {
      value: aggregateTableValue(collectTableValues(args.tableInstances, args.response, fieldKey, columnKey), aggregation),
      sourceType: "TABLE",
      sourceRef: `${fieldKey}.${columnKey}`,
    };
  }

  return null;
}

function resolveInputValue(args: ResolveInputValueArgs): { candidate: BlockResolverCandidate | null; required: boolean } {
  const definitionObject = asJsonObject(args.definition);
  const fieldSchema =
    asJsonObject(asJsonObject(args.inputSchema)?.fields as Prisma.JsonValue | undefined)?.[args.alias] as Prisma.JsonValue | undefined;
  const fieldSchemaObject = asJsonObject(fieldSchema);
  const required =
    Boolean(definitionObject?.required) ||
    Boolean(fieldSchemaObject?.required);
  const defaultValue =
    definitionObject?.defaultValue ??
    fieldSchemaObject?.defaultValue ??
    null;

  if (typeof args.definition === "string") {
    return {
      candidate: resolveSourceFromString(args.definition, args),
      required,
    };
  }

  if (!definitionObject) {
    const metadata = getResponseFieldMetadata(args.response, args.alias);
    return {
      candidate: {
        value: getResponseFieldValue(args.response, args.alias),
        sourceType: normalizeSourceType(metadata?.sourceType) ?? args.response?.dataSource ?? BlockEntryValueSource.MANUAL,
        sourceRef:
          (typeof metadata?.sourceRef === "string" ? metadata.sourceRef : null) ??
          args.response?.sourceRef ??
          null,
      },
      required,
    };
  }

  const explicitValue = definitionObject.value;
  if (explicitValue !== undefined) {
    return {
      candidate: {
        value: explicitValue,
        sourceType: "DEFAULT",
      },
      required,
    };
  }

  const source = typeof definitionObject.source === "string" ? definitionObject.source : null;
  if (source) {
    return {
      candidate: resolveSourceFromString(source, args),
      required,
    };
  }

  const path = typeof definitionObject.path === "string" ? definitionObject.path : null;
  if (path) {
    return {
      candidate: resolveSourceFromString(path, args),
      required,
    };
  }

  const sources = asJsonArray(definitionObject.sources as Prisma.JsonValue | undefined)
    .map((item) => (typeof item === "string" ? resolveSourceFromString(item, args) : null))
    .filter((item): item is BlockResolverCandidate => item !== null);
  if (sources.length > 0) {
    const merged = pickBestCandidate(sources);
    return { candidate: merged, required };
  }

  if (defaultValue !== null) {
    return {
      candidate: {
        value: defaultValue,
        sourceType: "DEFAULT",
      },
      required,
    };
  }

  const metadata = getResponseFieldMetadata(args.response, args.alias);
  return {
    candidate: {
      value: getResponseFieldValue(args.response, args.alias),
      sourceType: normalizeSourceType(metadata?.sourceType) ?? args.response?.dataSource ?? BlockEntryValueSource.MANUAL,
      sourceRef:
        (typeof metadata?.sourceRef === "string" ? metadata.sourceRef : null) ??
        args.response?.sourceRef ??
        null,
    },
    required,
  };
}

function normalizeInputDefinitions(inputDefinitions: Prisma.JsonValue | null | undefined, response: BlockResolverResponse | null) {
  if (Array.isArray(inputDefinitions)) {
    return Object.fromEntries(
      inputDefinitions
        .map((item) => asJsonObject(item as Prisma.JsonValue))
        .filter((item): item is Prisma.JsonObject => item !== null)
        .map((item) => [String(item.fieldKey ?? ""), item]),
    );
  }

  const objectValue = asJsonObject(inputDefinitions);
  if (objectValue) {
    return objectValue;
  }

  const responseData = asJsonObject(response?.responseData);
  return responseData ?? {};
}

export function resolveBlockInputs(args: {
  inputDefinitions: Prisma.JsonValue | null | undefined;
  inputSchema: Prisma.JsonValue | null | undefined;
  response: BlockResolverResponse | null;
  tableInstances: BlockResolverTableInstance[];
  outputs: Record<string, unknown>;
  deps: Record<string, BlockResolverDependencyValue>;
  context: Record<string, unknown>;
}): ResolveBlockInputsResult {
  const definitions = normalizeInputDefinitions(args.inputDefinitions, args.response);
  const inputs: Record<string, unknown> = {};
  const unresolved: Array<{ input: string; reason: string }> = [];
  const sources: Record<string, { sourceType: string; sourceRef?: string | null }> = {};

  for (const [alias, definition] of Object.entries(definitions)) {
    if (!alias) {
      continue;
    }
    const { candidate, required } = resolveInputValue({
      alias,
      definition: definition as Prisma.JsonValue,
      response: args.response,
      tableInstances: args.tableInstances,
      outputs: args.outputs,
      deps: args.deps,
      context: args.context,
      inputSchema: args.inputSchema,
    });

    if (!candidate || candidate.value === null || candidate.value === undefined) {
      inputs[alias] = null;
      if (required) {
        unresolved.push({
          input: alias,
          reason: "Required input could not be resolved.",
        });
      }
      continue;
    }

    inputs[alias] = candidate.value;
    sources[alias] = {
      sourceType: candidate.sourceType,
      sourceRef: candidate.sourceRef ?? null,
    };
  }

  return { inputs, unresolved, sources };
}
