import {
  DataBankCoverageStatus,
  DataBankMetricShape,
  DataBankSnapshotEntryMode,
  DataBankValueMaturity,
  MetricSourceResolutionMode,
  Prisma,
  RefreshSuggestionStatus,
  Role,
  SourceMetricValueType,
} from "@prisma/client";
import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { z } from "zod";
import { evaluateFormula, parseFormulaDependencyBlockCodes } from "./block-formula-evaluator";
import { getInstitutionalDataAdapter, listInstitutionalDataAdapters } from "./institutional-data-adapters";
import { prisma } from "@/lib/prisma";
import { hasTenantCapability } from "@/lib/tenant-permissions/service";
import { hasTenantServiceEnabled } from "@/lib/tenant-services/service";

type ErrorResult = {
  status: "error";
  message: string;
};

type SuccessResult<T extends object> = {
  status: "success";
  message?: string;
} & T;

type ServiceResult<T extends object = Record<string, never>> = SuccessResult<T> | ErrorResult;

type PrimitiveDimension = string | number | boolean;
type DimensionRecord = Record<string, PrimitiveDimension>;
type DataBankTransformConfig =
  | { mode: "DIRECT" }
  | { mode: "PICK_FIELD"; fieldKey: string }
  | { mode: "COUNT_ROWS"; filter?: Record<string, unknown> }
  | { mode: "SUM_COLUMN"; columnKey: string; filter?: Record<string, unknown> }
  | { mode: "AVG_COLUMN"; columnKey: string; filter?: Record<string, unknown> }
  | { mode: "MAX_COLUMN"; columnKey: string; filter?: Record<string, unknown> }
  | { mode: "MIN_COLUMN"; columnKey: string; filter?: Record<string, unknown> }
  | { mode: "FIRST_NON_NULL"; fieldPriority: string[] }
  | {
      mode: "CUSTOM_FORMULA";
      formula: string;
      inputs: Array<{
        alias: string;
        source: "snapshot.numberValue" | "snapshot.textValue" | "snapshot.jsonValue" | "dataset";
        fieldKey?: string;
        columnKey?: string;
        filter?: Record<string, unknown>;
      }>;
    };

const dataBankDomainInputSchema = z.object({
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(1000).nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

const dataBankSourceInputSchema = z.object({
  domainId: z.string().trim().min(1).nullable().optional(),
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(1000).nullable().optional(),
  kind: z.enum(["MANUAL", "CSV_IMPORT", "INTERNAL_ADAPTER", "DOCUMENT", "NARRATIVE"]),
  shape: z.enum(["SCALAR", "DATASET", "NARRATIVE", "DOCUMENT_REF"]),
  datasetSchema: z.any().optional(),
  adapterKey: z.string().trim().min(1).max(120).nullable().optional(),
  adapterConfig: z.any().optional(),
  supportsYearWise: z.boolean().optional(),
  supportsScopeBreakdown: z.boolean().optional(),
  isSystemDefined: z.boolean().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

const primitiveFilterValueSchema = z.union([z.string(), z.number(), z.boolean()]);
const dimensionsSchema = z.record(z.string(), primitiveFilterValueSchema).default({});
const datasetRowSchema = z.object({
  rowIndex: z.number().int().min(0).optional(),
  rowKey: z.string().trim().max(160).nullable().optional(),
  rowData: z.record(z.string(), z.any()),
  sourceRef: z.string().trim().max(255).nullable().optional(),
});

const dataBankSnapshotInputSchema = z.object({
  observedYear: z.number().int().nullable().optional(),
  scopeKey: z.string().trim().min(1).max(120).nullable().optional(),
  dimensions: dimensionsSchema.optional(),
  numberValue: z.number().nullable().optional(),
  textValue: z.string().trim().max(20000).nullable().optional(),
  jsonValue: z.any().optional(),
  maturity: z.nativeEnum(DataBankValueMaturity).optional(),
  coverageStatus: z.nativeEnum(DataBankCoverageStatus).optional(),
  coveragePercent: z.number().min(0).max(100).nullable().optional(),
  confidenceNote: z.string().trim().max(2000).nullable().optional(),
  sourceRef: z.string().trim().max(255).nullable().optional(),
  entryMode: z.nativeEnum(DataBankSnapshotEntryMode).optional(),
  evidenceMeta: z.any().optional(),
  datasetRows: z.array(datasetRowSchema).optional(),
  replaceRows: z.boolean().optional(),
}).superRefine((value, ctx) => {
  const hasScalar = value.numberValue !== undefined || value.textValue !== undefined || value.jsonValue !== undefined;
  const hasDataset = (value.datasetRows?.length ?? 0) > 0;
  if (!hasScalar && !hasDataset) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide a scalar value, jsonValue, or datasetRows.",
      path: ["datasetRows"],
    });
  }
});

const institutionalMetricBaseSchema = z.object({
  domainId: z.string().trim().min(1).nullable().optional(),
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(1000).nullable().optional(),
  valueType: z.nativeEnum(SourceMetricValueType).default(SourceMetricValueType.NUMBER),
  shape: z.nativeEnum(DataBankMetricShape).default(DataBankMetricShape.SCALAR),
  unitOfMeasure: z.string().trim().max(80).nullable().optional(),
  helpText: z.string().trim().max(2000).nullable().optional(),
  precision: z.number().int().min(0).max(6).nullable().optional(),
  allowedDimensions: z.record(z.string(), z.string()).nullable().optional(),
  datasetSchema: z.any().optional(),
  computeConfig: z.object({ formula: z.string().trim().min(1) }).nullable().optional(),
  supportsYearWise: z.boolean().optional(),
  supportsScopeBreakdown: z.boolean().optional(),
  usedByBodyCodes: z.array(z.string().trim().min(1).max(32)).optional(),
  isSystemDefined: z.boolean().optional(),
  isRequiredHint: z.boolean().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

function refineInstitutionalMetricInput(
  value: z.infer<typeof institutionalMetricBaseSchema>,
  ctx: z.RefinementCtx,
) {
  if (value.shape === DataBankMetricShape.COMPUTED) {
    if (!value.computeConfig?.formula) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Computed metrics require computeConfig.formula.",
        path: ["computeConfig"],
      });
    }
    if (value.valueType !== SourceMetricValueType.NUMBER) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Computed metrics currently support NUMBER valueType only.",
        path: ["valueType"],
      });
    }
  }
}

const institutionalMetricInputSchema = institutionalMetricBaseSchema.superRefine(refineInstitutionalMetricInput);

const transformConfigSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("DIRECT") }),
  z.object({ mode: z.literal("PICK_FIELD"), fieldKey: z.string().trim().min(1).max(120) }),
  z.object({ mode: z.literal("COUNT_ROWS"), filter: z.record(z.string(), z.any()).optional() }),
  z.object({ mode: z.literal("SUM_COLUMN"), columnKey: z.string().trim().min(1).max(120), filter: z.record(z.string(), z.any()).optional() }),
  z.object({ mode: z.literal("AVG_COLUMN"), columnKey: z.string().trim().min(1).max(120), filter: z.record(z.string(), z.any()).optional() }),
  z.object({ mode: z.literal("MAX_COLUMN"), columnKey: z.string().trim().min(1).max(120), filter: z.record(z.string(), z.any()).optional() }),
  z.object({ mode: z.literal("MIN_COLUMN"), columnKey: z.string().trim().min(1).max(120), filter: z.record(z.string(), z.any()).optional() }),
  z.object({ mode: z.literal("FIRST_NON_NULL"), fieldPriority: z.array(z.string().trim().min(1).max(120)).min(1) }),
  z.object({
    mode: z.literal("CUSTOM_FORMULA"),
    formula: z.string().trim().min(1),
    inputs: z.array(
      z.object({
        alias: z.string().trim().min(1).max(80),
        source: z.enum(["snapshot.numberValue", "snapshot.textValue", "snapshot.jsonValue", "dataset"]),
        fieldKey: z.string().trim().min(1).max(120).optional(),
        columnKey: z.string().trim().min(1).max(120).optional(),
        filter: z.record(z.string(), z.any()).optional(),
      }),
    ).min(1),
  }),
]);

const metricSourceLinkInputSchema = z.object({
  links: z.array(
    z.object({
      sourceId: z.string().trim().min(1),
      precedence: z.number().int().min(0).max(999).optional(),
      resolutionMode: z.nativeEnum(MetricSourceResolutionMode),
      transformConfig: transformConfigSchema.optional(),
      isPrimary: z.boolean().optional(),
      autoApplyWhenUnknown: z.boolean().optional(),
      createSuggestionOnConflict: z.boolean().optional(),
      isActive: z.boolean().optional(),
    }),
  ).min(1),
}).superRefine((value, ctx) => {
  for (const [index, link] of value.links.entries()) {
    if (link.transformConfig && link.transformConfig.mode !== link.resolutionMode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "transformConfig.mode must match resolutionMode.",
        path: ["links", index, "transformConfig"],
      });
    }
  }
});

const refreshSuggestionResolutionSchema = z.object({
  action: z.enum(["ACCEPT", "REJECT"]),
  note: z.string().trim().max(1000).nullable().optional(),
});

const seedCatalogInputSchema = z.object({
  includeRecommendedSources: z.boolean().optional(),
});

const dataBankSourceUpdateSchema = dataBankSourceInputSchema
  .partial()
  .extend({
    code: z.string().trim().min(1).max(80).optional(),
    name: z.string().trim().min(2).max(160).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update.",
  });

const institutionalMetricUpdateSchema = institutionalMetricBaseSchema
  .partial()
  .extend({
    code: z.string().trim().min(1).max(80).optional(),
    name: z.string().trim().min(2).max(160).optional(),
  })
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide at least one field to update.",
      });
      return;
    }
    if (value.shape === DataBankMetricShape.COMPUTED || value.computeConfig !== undefined || value.valueType !== undefined) {
      refineInstitutionalMetricInput(
        {
          ...value,
          valueType: value.valueType ?? SourceMetricValueType.NUMBER,
          shape: value.shape ?? DataBankMetricShape.SCALAR,
        } as z.infer<typeof institutionalMetricBaseSchema>,
        ctx,
      );
    }
  });

const dataBankDatasetImportSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  fileContentBase64: z.string().trim().min(1),
  observedYear: z.number().int().nullable().optional(),
  scopeKey: z.string().trim().min(1).max(120).nullable().optional(),
  dimensions: dimensionsSchema.optional(),
  replaceRows: z.boolean().optional(),
});

type ParsedDatasetImport = {
  rowCount: number;
  columns: string[];
  sampleRows: Array<Record<string, unknown>>;
  datasetRows: Array<{
    rowIndex: number;
    rowKey: string | null;
    rowData: Record<string, unknown>;
  }>;
};

type DatasetTemplateColumn = {
  key: string;
  label: string;
  required: boolean;
  sample: string | null;
};

function normalizeNullableString(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function asJsonObject(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Prisma.JsonObject;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashValue(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function normalizeDimensions(value: Record<string, PrimitiveDimension> | null | undefined): DimensionRecord {
  if (!value) {
    return {};
  }
  const normalizedEntries = Object.entries(value)
    .filter(([, item]) => item !== null && item !== undefined)
    .map(([key, item]) => [key.trim(), typeof item === "string" ? item.trim() : item] satisfies [string, PrimitiveDimension])
    .filter(([key, item]) => key.length > 0 && (typeof item !== "string" || item.length > 0))
    .sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(normalizedEntries);
}

function buildDimensionFingerprint(value: Record<string, PrimitiveDimension> | null | undefined) {
  const normalized = normalizeDimensions(value);
  return Object.keys(normalized).length === 0 ? "__NONE__" : stableStringify(normalized);
}

function hasObservationValue(observation: { numberValue: number | null; textValue: string | null; jsonValue: Prisma.JsonValue | null }) {
  return (
    (typeof observation.numberValue === "number" && Number.isFinite(observation.numberValue)) ||
    !!normalizeNullableString(observation.textValue) ||
    observation.jsonValue !== null
  );
}

async function ensureAccreditationServiceEnabled(tenantId: string) {
  const enabled = await hasTenantServiceEnabled(tenantId, "ACCREDITATION");
  return enabled ? null : "Accreditation service is not enabled for this tenant.";
}

async function hasInstitutionalDataAdminAccess(tenantId: string, actorUserId: string, actorRole: Role | null | undefined) {
  return hasTenantCapability({
    tenantId,
    userId: actorUserId,
    baseRole: actorRole,
    capability: "MANAGE_ACCREDITATION",
  });
}

async function ensureInstitutionalDataAccess(tenantId: string, actorUserId: string, actorRole: Role | null | undefined) {
  const serviceError = await ensureAccreditationServiceEnabled(tenantId);
  if (serviceError) {
    return serviceError;
  }
  const allowed = await hasInstitutionalDataAdminAccess(tenantId, actorUserId, actorRole);
  return allowed ? null : "You do not have permission to manage institutional data.";
}

function buildObservationScopeKey(observedYear: number | null | undefined, scopeKey: string | null | undefined) {
  const normalizedScopeKey = normalizeNullableString(scopeKey);
  if (normalizedScopeKey) {
    return normalizedScopeKey;
  }
  return observedYear === null || observedYear === undefined ? "DEFAULT" : `YEAR:${observedYear}`;
}

function normalizeSpreadsheetValue(value: unknown): Prisma.JsonValue {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeSpreadsheetValue(item)) as Prisma.JsonArray;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, normalizeSpreadsheetValue(item)]),
    ) as Prisma.JsonObject;
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return String(value);
}

function parseDatasetImport(input: z.infer<typeof dataBankDatasetImportSchema>): ParsedDatasetImport {
  const workbook = XLSX.read(Buffer.from(input.fileContentBase64, "base64"), { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("Import file does not contain any sheets.");
  }

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: true,
  });
  if (rows.length === 0) {
    throw new Error("Import file does not contain any data rows.");
  }

  const columns = [...new Set(rows.flatMap((row) => Object.keys(row).map((key) => key.trim()).filter(Boolean)))];
  if (columns.length === 0) {
    throw new Error("Import file does not contain any usable columns.");
  }

  const datasetRows = rows.map((row, index) => {
    const rowData = Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key.trim(), normalizeSpreadsheetValue(value)]),
    );
    const rowKeyCandidate = rowData.rowKey ?? rowData.id ?? rowData.code ?? rowData.employeeId ?? rowData.achievementId;
    return {
      rowIndex: index,
      rowKey: rowKeyCandidate == null ? null : String(rowKeyCandidate),
      rowData,
    };
  });

  return {
    rowCount: datasetRows.length,
    columns,
    sampleRows: datasetRows.slice(0, 5).map((row) => row.rowData),
    datasetRows,
  };
}

function normalizeTemplateKey(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseDatasetTemplateColumns(value: Prisma.JsonValue | null | undefined): DatasetTemplateColumn[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  const sourceObject = value as Record<string, unknown>;
  const rawColumns = Array.isArray(sourceObject.columns)
    ? sourceObject.columns
    : Array.isArray(value)
      ? (value as unknown[])
      : [];

  const columns: DatasetTemplateColumn[] = [];
  for (const rawColumn of rawColumns) {
    if (typeof rawColumn === "string") {
      const key = normalizeTemplateKey(rawColumn);
      if (!key) continue;
      columns.push({
        key,
        label: key,
        required: false,
        sample: null,
      });
      continue;
    }

    if (rawColumn && typeof rawColumn === "object") {
      const item = rawColumn as Record<string, unknown>;
      const key = normalizeTemplateKey(item.key ?? item.code ?? item.name ?? item.label);
      if (!key) continue;
      const label = normalizeTemplateKey(item.label) ?? key;
      const sample =
        item.sample == null
          ? null
          : typeof item.sample === "string" || typeof item.sample === "number" || typeof item.sample === "boolean"
            ? String(item.sample)
            : null;

      columns.push({
        key,
        label,
        required: item.required === true,
        sample,
      });
    }
  }

  const seen = new Set<string>();
  return columns.filter((column) => {
    const fingerprint = column.key.toLowerCase();
    if (seen.has(fingerprint)) {
      return false;
    }
    seen.add(fingerprint);
    return true;
  });
}

function deriveTemplateColumnsFromRows(
  rows: Array<{ rowData: Prisma.JsonValue }> | undefined,
): DatasetTemplateColumn[] {
  if (!rows || rows.length === 0) {
    return [];
  }

  const orderedKeys: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.rowData || typeof row.rowData !== "object" || Array.isArray(row.rowData)) {
      continue;
    }
    for (const key of Object.keys(row.rowData)) {
      const normalized = key.trim();
      if (!normalized || seen.has(normalized.toLowerCase())) continue;
      seen.add(normalized.toLowerCase());
      orderedKeys.push(normalized);
    }
  }

  return orderedKeys.map((key) => ({
    key,
    label: key,
    required: false,
    sample: null,
  }));
}

function rowsToCsv(rows: string[][]) {
  return rows
    .map((row) =>
      row
        .map((value) => {
          const normalized = value ?? "";
          const escaped = normalized.replaceAll('"', '""');
          return /[",\n]/.test(normalized) ? `"${escaped}"` : escaped;
        })
        .join(","),
    )
    .join("\n");
}

function rowMatchesFilter(rowData: Prisma.JsonObject, filter: Record<string, unknown> | undefined) {
  if (!filter || Object.keys(filter).length === 0) {
    return true;
  }
  return Object.entries(filter).every(([key, expected]) => rowData[key] === expected);
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function aggregateDatasetColumn(
  rows: Array<{ rowData: Prisma.JsonObject }>,
  columnKey: string,
  filter: Record<string, unknown> | undefined,
  mode: "SUM" | "AVG" | "MAX" | "MIN",
) {
  const values = rows
    .filter((row) => rowMatchesFilter(row.rowData, filter))
    .map((row) => asNumber(row.rowData[columnKey]))
    .filter((value): value is number => value !== null);
  if (values.length === 0) {
    return null;
  }
  if (mode === "SUM") {
    return values.reduce((sum, value) => sum + value, 0);
  }
  if (mode === "AVG") {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }
  if (mode === "MAX") {
    return Math.max(...values);
  }
  return Math.min(...values);
}

function resolveSourceCandidate(input: {
  metric: { valueType: SourceMetricValueType; code: string };
  link: { resolutionMode: MetricSourceResolutionMode; transformConfig: Prisma.JsonValue | null; sourceId: string };
  snapshot: {
    id: string;
    sourceId: string;
    observedYear: number | null;
    scopeKey: string;
    dimensions: Prisma.JsonValue | null;
    numberValue: number | null;
    textValue: string | null;
    jsonValue: Prisma.JsonValue | null;
    maturity: DataBankValueMaturity;
    coverageStatus: DataBankCoverageStatus;
    coveragePercent: number | null;
    confidenceNote: string | null;
    sourceRevisionHash: string | null;
    sourceRef: string | null;
  };
  rows: Array<{ rowData: Prisma.JsonObject }>;
}) {
  const transformConfig = (input.link.transformConfig ?? { mode: input.link.resolutionMode }) as DataBankTransformConfig;
  let numberValue: number | null = null;
  let textValue: string | null = null;
  let jsonValue: Prisma.JsonValue | null = null;

  switch (transformConfig.mode) {
    case "DIRECT":
      numberValue = input.snapshot.numberValue;
      textValue = input.snapshot.textValue;
      jsonValue = input.snapshot.jsonValue;
      break;
    case "PICK_FIELD": {
      const sourceObject = asJsonObject(input.snapshot.jsonValue);
      const picked = sourceObject?.[transformConfig.fieldKey] ?? null;
      numberValue = asNumber(picked);
      textValue = typeof picked === "string" ? picked : null;
      jsonValue = picked === null ? null : (picked as Prisma.JsonValue);
      break;
    }
    case "COUNT_ROWS":
      numberValue = input.rows.filter((row) => rowMatchesFilter(row.rowData, transformConfig.filter)).length;
      break;
    case "SUM_COLUMN":
      numberValue = aggregateDatasetColumn(input.rows, transformConfig.columnKey, transformConfig.filter, "SUM");
      break;
    case "AVG_COLUMN":
      numberValue = aggregateDatasetColumn(input.rows, transformConfig.columnKey, transformConfig.filter, "AVG");
      break;
    case "MAX_COLUMN":
      numberValue = aggregateDatasetColumn(input.rows, transformConfig.columnKey, transformConfig.filter, "MAX");
      break;
    case "MIN_COLUMN":
      numberValue = aggregateDatasetColumn(input.rows, transformConfig.columnKey, transformConfig.filter, "MIN");
      break;
    case "FIRST_NON_NULL": {
      const sourceObject = asJsonObject(input.snapshot.jsonValue) ?? {};
      const firstKey = transformConfig.fieldPriority.find((fieldKey) => sourceObject[fieldKey] !== undefined && sourceObject[fieldKey] !== null);
      const picked = firstKey ? sourceObject[firstKey] : null;
      numberValue = asNumber(picked);
      textValue = typeof picked === "string" ? picked : null;
      jsonValue = picked === null ? null : (picked as Prisma.JsonValue);
      break;
    }
    case "CUSTOM_FORMULA": {
      const formulaInputs: Record<string, unknown> = {};
      for (const sourceInput of transformConfig.inputs) {
        if (sourceInput.source === "snapshot.numberValue") {
          formulaInputs[sourceInput.alias] = input.snapshot.numberValue;
          continue;
        }
        if (sourceInput.source === "snapshot.textValue") {
          formulaInputs[sourceInput.alias] = input.snapshot.textValue;
          continue;
        }
        if (sourceInput.source === "snapshot.jsonValue") {
          const sourceObject = asJsonObject(input.snapshot.jsonValue) ?? {};
          formulaInputs[sourceInput.alias] = sourceInput.fieldKey ? sourceObject[sourceInput.fieldKey] ?? null : sourceObject;
          continue;
        }

        const datasetValues = input.rows
          .filter((row) => rowMatchesFilter(row.rowData, sourceInput.filter))
          .map((row) => (sourceInput.columnKey ? row.rowData[sourceInput.columnKey] ?? null : row.rowData));
        formulaInputs[sourceInput.alias] = datasetValues.length === 1 ? datasetValues[0] : datasetValues;
      }

      const evaluated = evaluateFormula(transformConfig.formula, { inputs: formulaInputs });
      numberValue = asNumber(evaluated);
      textValue = typeof evaluated === "string" ? evaluated : null;
      jsonValue =
        evaluated === null || typeof evaluated === "string" || typeof evaluated === "number" || typeof evaluated === "boolean"
          ? null
          : (evaluated as Prisma.JsonValue);
      break;
    }
  }

  if (input.metric.valueType === SourceMetricValueType.NUMBER) {
    textValue = null;
    jsonValue = null;
  } else if (input.metric.valueType === SourceMetricValueType.TEXT) {
    textValue = textValue ?? (typeof numberValue === "number" ? String(numberValue) : null);
    numberValue = null;
    jsonValue = null;
  } else {
    numberValue = null;
    textValue = null;
  }

  return {
    numberValue,
    textValue: normalizeNullableString(textValue),
    jsonValue,
    maturity: input.snapshot.maturity,
    coverageStatus: input.snapshot.coverageStatus,
    coveragePercent: input.snapshot.coveragePercent,
    confidenceNote: input.snapshot.confidenceNote,
    sourceRef: input.snapshot.sourceRef ?? input.snapshot.id,
    sourceRevisionHash:
      input.snapshot.sourceRevisionHash ??
      hashValue({
        snapshotId: input.snapshot.id,
        numberValue,
        textValue,
        jsonValue,
      }),
  };
}

async function upsertRefreshSuggestion(input: {
  observationId: string;
  metricSourceLinkId: string;
  candidate: ReturnType<typeof resolveSourceCandidate>;
  note: string;
}) {
  const existing = await prisma.metricRefreshSuggestion.findFirst({
    where: {
      metricObservationId: input.observationId,
      metricSourceLinkId: input.metricSourceLinkId,
      status: RefreshSuggestionStatus.PENDING,
    },
  });

  if (existing) {
    return prisma.metricRefreshSuggestion.update({
      where: { id: existing.id },
      data: {
        candidateNumberValue: input.candidate.numberValue,
        candidateTextValue: input.candidate.textValue,
        candidateJsonValue: input.candidate.jsonValue ?? Prisma.DbNull,
        candidateMaturity: input.candidate.maturity,
        candidateCoverageStatus: input.candidate.coverageStatus,
        candidateCoveragePercent: input.candidate.coveragePercent,
        sourceRevisionHash: input.candidate.sourceRevisionHash,
        sourceRef: input.candidate.sourceRef,
        note: input.note,
        detectedAt: new Date(),
      },
    });
  }

  return prisma.metricRefreshSuggestion.create({
    data: {
      metricObservationId: input.observationId,
      metricSourceLinkId: input.metricSourceLinkId,
      candidateNumberValue: input.candidate.numberValue,
      candidateTextValue: input.candidate.textValue,
      candidateJsonValue: input.candidate.jsonValue ?? Prisma.DbNull,
      candidateMaturity: input.candidate.maturity,
      candidateCoverageStatus: input.candidate.coverageStatus,
      candidateCoveragePercent: input.candidate.coveragePercent,
      sourceRevisionHash: input.candidate.sourceRevisionHash,
      sourceRef: input.candidate.sourceRef,
      note: input.note,
    },
  });
}

async function applyCandidateToMetricObservation(input: {
  metricId: string;
  observedYear: number | null;
  scopeKey: string;
  dimensions: DimensionRecord;
  candidate: ReturnType<typeof resolveSourceCandidate>;
  actorUserId: string;
  metricSourceLinkId: string;
}) {
  const dimensionFingerprint = buildDimensionFingerprint(input.dimensions);
  const existingObservation = await prisma.sourceMetricObservation.findUnique({
    where: {
      metricId_scopeKey_dimensionFingerprint: {
        metricId: input.metricId,
        scopeKey: input.scopeKey,
        dimensionFingerprint,
      },
    },
  });

  if (!existingObservation) {
    return {
      action: "applied" as const,
      observation: await prisma.sourceMetricObservation.create({
        data: {
          metricId: input.metricId,
          observedYear: input.observedYear,
          scopeKey: input.scopeKey,
          dimensions: Object.keys(input.dimensions).length > 0 ? (input.dimensions as Prisma.InputJsonObject) : Prisma.DbNull,
          dimensionFingerprint,
          numberValue: input.candidate.numberValue,
          textValue: input.candidate.textValue,
          jsonValue: input.candidate.jsonValue ?? Prisma.DbNull,
          sourceType: "DATA_BANK",
          sourceRef: input.candidate.sourceRef,
          sourceRevisionHash: input.candidate.sourceRevisionHash,
          maturity: input.candidate.maturity,
          coverageStatus: input.candidate.coverageStatus,
          coveragePercent: input.candidate.coveragePercent,
          confidenceNote: input.candidate.confidenceNote,
          recordedByUserId: input.actorUserId,
          recordedAt: new Date(),
          lastRefreshedAt: new Date(),
          isStale: false,
        },
      }),
    };
  }

  const currentDiffers =
    existingObservation.numberValue !== input.candidate.numberValue ||
    normalizeNullableString(existingObservation.textValue) !== normalizeNullableString(input.candidate.textValue) ||
    stableStringify(existingObservation.jsonValue) !== stableStringify(input.candidate.jsonValue) ||
    existingObservation.sourceRevisionHash !== input.candidate.sourceRevisionHash;

  const isProtected =
    existingObservation.sourceType === "MANUAL" ||
    existingObservation.verifiedAt !== null ||
    existingObservation.maturity === DataBankValueMaturity.VERIFIED ||
    existingObservation.maturity === DataBankValueMaturity.EVIDENCE_BACKED;

  const isUnknown = !hasObservationValue(existingObservation) && existingObservation.maturity === DataBankValueMaturity.UNKNOWN;

  if (!currentDiffers) {
    return { action: "noop" as const, observation: existingObservation };
  }

  if (isProtected && !isUnknown) {
    const suggestion = await upsertRefreshSuggestion({
      observationId: existingObservation.id,
      metricSourceLinkId: input.metricSourceLinkId,
      candidate: input.candidate,
      note: "Source refresh differs from manual or verified metric value.",
    });

    await prisma.sourceMetricObservation.update({
      where: { id: existingObservation.id },
      data: {
        isStale: true,
        refreshBlockedReason: "PENDING_SUGGESTION",
      },
    });

    return { action: "suggested" as const, observation: existingObservation, suggestion };
  }

  const observation = await prisma.sourceMetricObservation.update({
    where: { id: existingObservation.id },
    data: {
      observedYear: input.observedYear,
      scopeKey: input.scopeKey,
      dimensions: Object.keys(input.dimensions).length > 0 ? (input.dimensions as Prisma.InputJsonObject) : Prisma.DbNull,
      dimensionFingerprint,
      numberValue: input.candidate.numberValue,
      textValue: input.candidate.textValue,
      jsonValue: input.candidate.jsonValue ?? Prisma.DbNull,
      sourceType: "DATA_BANK",
      sourceRef: input.candidate.sourceRef,
      sourceRevisionHash: input.candidate.sourceRevisionHash,
      maturity: input.candidate.maturity,
      coverageStatus: input.candidate.coverageStatus,
      coveragePercent: input.candidate.coveragePercent,
      confidenceNote: input.candidate.confidenceNote,
      recordedByUserId: input.actorUserId,
      recordedAt: new Date(),
      lastRefreshedAt: new Date(),
      isStale: false,
      refreshBlockedReason: null,
    },
  });

  await prisma.metricRefreshSuggestion.updateMany({
    where: {
      metricObservationId: existingObservation.id,
      metricSourceLinkId: input.metricSourceLinkId,
      status: RefreshSuggestionStatus.PENDING,
    },
    data: {
      status: RefreshSuggestionStatus.AUTO_APPLIED,
      resolvedAt: new Date(),
      resolvedByUserId: input.actorUserId,
    },
  });

  return { action: "applied" as const, observation };
}

async function recomputeComputedMetricsForContext(input: {
  tenantId: string;
  observedYear: number | null;
  scopeKey: string;
  dimensions: DimensionRecord;
  actorUserId: string;
}) {
  const metrics = await prisma.sourceMetricDefinition.findMany({
    where: { tenantId: input.tenantId, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
  });

  const metricByCode = new Map(metrics.map((metric) => [metric.code, metric]));
  const computedMetrics = metrics.filter((metric) => metric.shape === DataBankMetricShape.COMPUTED);
  if (computedMetrics.length === 0) {
    return { recomputedCount: 0 };
  }

  const graph = new Map<string, string[]>();
  for (const metric of computedMetrics) {
    const computeConfig = asJsonObject(metric.computeConfig);
    const formula = typeof computeConfig?.formula === "string" ? computeConfig.formula : null;
    if (!formula) {
      continue;
    }
    graph.set(metric.code, parseFormulaDependencyBlockCodes(formula));
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const orderedCodes: string[] = [];
  const visit = (code: string) => {
    if (visited.has(code)) {
      return;
    }
    if (visiting.has(code)) {
      throw new Error(`Computed metric cycle detected at ${code}.`);
    }
    visiting.add(code);
    for (const dependency of graph.get(code) ?? []) {
      if (graph.has(dependency)) {
        visit(dependency);
      }
    }
    visiting.delete(code);
    visited.add(code);
    orderedCodes.push(code);
  };
  for (const code of graph.keys()) {
    visit(code);
  }

  const dimensionFingerprint = buildDimensionFingerprint(input.dimensions);
  const observations = await prisma.sourceMetricObservation.findMany({
    where: {
      metric: { tenantId: input.tenantId },
      scopeKey: input.scopeKey,
      dimensionFingerprint,
    },
    include: {
      metric: true,
    },
  });

  const currentValues = new Map<string, { observationId: string | null; value: number | null }>(
    observations.map((observation) => [
      observation.metric.code,
      { observationId: observation.id, value: observation.numberValue },
    ]),
  );

  let recomputedCount = 0;

  for (const code of orderedCodes) {
    const metric = metricByCode.get(code);
    const metricConfig = asJsonObject(metric?.computeConfig);
    const formula = typeof metricConfig?.formula === "string" ? metricConfig.formula : null;
    if (!metric || !formula) {
      continue;
    }

    const deps: Record<string, { value: number | null }> = {};
    for (const dependency of parseFormulaDependencyBlockCodes(formula)) {
      deps[dependency] = { value: currentValues.get(dependency)?.value ?? null };
    }

    const evaluated = evaluateFormula(formula, { deps });
    const numericValue = asNumber(evaluated);
    const sourceRevisionHash = hashValue({ formula, deps });
    const existingObservation = observations.find((observation) => observation.metricId === metric.id);

    if (existingObservation) {
      await prisma.sourceMetricObservation.update({
        where: { id: existingObservation.id },
        data: {
          observedYear: input.observedYear,
          scopeKey: input.scopeKey,
          dimensions: Object.keys(input.dimensions).length > 0 ? (input.dimensions as Prisma.InputJsonObject) : Prisma.DbNull,
          dimensionFingerprint,
          numberValue: numericValue,
          textValue: null,
          jsonValue: Prisma.DbNull,
          sourceType: "COMPUTED",
          sourceRef: metric.code,
          sourceRevisionHash,
          maturity: numericValue === null ? DataBankValueMaturity.UNKNOWN : DataBankValueMaturity.REPORTED,
          coverageStatus: numericValue === null ? DataBankCoverageStatus.NONE : DataBankCoverageStatus.COMPLETE,
          coveragePercent: numericValue === null ? null : 100,
          confidenceNote: null,
          recordedByUserId: input.actorUserId,
          recordedAt: new Date(),
          lastRefreshedAt: new Date(),
          isStale: false,
          refreshBlockedReason: null,
        },
      });
    } else {
      await prisma.sourceMetricObservation.create({
        data: {
          metricId: metric.id,
          observedYear: input.observedYear,
          scopeKey: input.scopeKey,
          dimensions: Object.keys(input.dimensions).length > 0 ? (input.dimensions as Prisma.InputJsonObject) : Prisma.DbNull,
          dimensionFingerprint,
          numberValue: numericValue,
          textValue: null,
          jsonValue: Prisma.DbNull,
          sourceType: "COMPUTED",
          sourceRef: metric.code,
          sourceRevisionHash,
          maturity: numericValue === null ? DataBankValueMaturity.UNKNOWN : DataBankValueMaturity.REPORTED,
          coverageStatus: numericValue === null ? DataBankCoverageStatus.NONE : DataBankCoverageStatus.COMPLETE,
          coveragePercent: numericValue === null ? null : 100,
          recordedByUserId: input.actorUserId,
          recordedAt: new Date(),
          lastRefreshedAt: new Date(),
          isStale: false,
        },
      });
    }

    currentValues.set(code, { observationId: existingObservation?.id ?? null, value: numericValue });
    recomputedCount += 1;
  }

  return { recomputedCount };
}

async function syncSnapshotToMetricLinks(input: { snapshotId: string; actorUserId: string }) {
  const snapshot = await prisma.dataBankSourceSnapshot.findUnique({
    where: { id: input.snapshotId },
    include: {
      source: {
        include: {
          metricLinks: {
            where: { isActive: true },
            include: { metric: true },
            orderBy: [{ precedence: "asc" }, { createdAt: "asc" }],
          },
        },
      },
      datasetRows: true,
    },
  });

  if (!snapshot) {
    return { appliedCount: 0, suggestionCount: 0, recomputedCount: 0 };
  }

  let appliedCount = 0;
  let suggestionCount = 0;
  const dimensions = normalizeDimensions(snapshot.dimensions as DimensionRecord | undefined);
  const rows = snapshot.datasetRows.map((row) => ({ rowData: asJsonObject(row.rowData)! }));

  for (const link of snapshot.source.metricLinks) {
    const candidate = resolveSourceCandidate({
      metric: { valueType: link.metric.valueType, code: link.metric.code },
      link: { resolutionMode: link.resolutionMode, transformConfig: link.transformConfig, sourceId: link.sourceId },
      snapshot: {
        id: snapshot.id,
        sourceId: snapshot.sourceId,
        observedYear: snapshot.observedYear,
        scopeKey: snapshot.scopeKey,
        dimensions: snapshot.dimensions,
        numberValue: snapshot.numberValue,
        textValue: snapshot.textValue,
        jsonValue: snapshot.jsonValue,
        maturity: snapshot.maturity,
        coverageStatus: snapshot.coverageStatus,
        coveragePercent: snapshot.coveragePercent,
        confidenceNote: snapshot.confidenceNote,
        sourceRevisionHash: snapshot.sourceRevisionHash,
        sourceRef: snapshot.sourceRef,
      },
      rows,
    });

    const outcome = await applyCandidateToMetricObservation({
      metricId: link.metricId,
      observedYear: snapshot.observedYear,
      scopeKey: buildObservationScopeKey(snapshot.observedYear, snapshot.scopeKey),
      dimensions,
      candidate,
      actorUserId: input.actorUserId,
      metricSourceLinkId: link.id,
    });

    if (outcome.action === "applied") {
      appliedCount += 1;
    } else if (outcome.action === "suggested") {
      suggestionCount += 1;
    }
  }

  const { recomputedCount } = await recomputeComputedMetricsForContext({
    tenantId: snapshot.source.tenantId,
    observedYear: snapshot.observedYear,
    scopeKey: buildObservationScopeKey(snapshot.observedYear, snapshot.scopeKey),
    dimensions,
    actorUserId: input.actorUserId,
  });

  return { appliedCount, suggestionCount, recomputedCount };
}

async function validateComputedMetricGraph(
  tenantId: string,
  candidate: { code: string; shape: DataBankMetricShape; computeConfig: { formula: string } | null | undefined },
) {
  if (candidate.shape !== DataBankMetricShape.COMPUTED || !candidate.computeConfig?.formula) {
    return null;
  }

  const metrics = await prisma.sourceMetricDefinition.findMany({
    where: { tenantId, isActive: true },
    select: { code: true, shape: true, computeConfig: true },
  });

  const allCodes = new Set(metrics.map((metric) => metric.code));
  allCodes.add(candidate.code);
  for (const dependency of parseFormulaDependencyBlockCodes(candidate.computeConfig.formula)) {
    if (!allCodes.has(dependency)) {
      return `Unknown metric dependency "${dependency}" in computed formula.`;
    }
  }

  const graph = new Map<string, string[]>();
  for (const metric of metrics) {
    if (metric.shape !== DataBankMetricShape.COMPUTED) {
      continue;
    }
    const formula = typeof asJsonObject(metric.computeConfig)?.formula === "string"
      ? (asJsonObject(metric.computeConfig)?.formula as string)
      : null;
    if (!formula) {
      continue;
    }
    graph.set(metric.code, parseFormulaDependencyBlockCodes(formula));
  }
  graph.set(candidate.code, parseFormulaDependencyBlockCodes(candidate.computeConfig.formula));

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (code: string): string | null => {
    if (visited.has(code)) {
      return null;
    }
    if (visiting.has(code)) {
      return `Computed metric cycle detected at ${code}.`;
    }
    visiting.add(code);
    for (const dependency of graph.get(code) ?? []) {
      if (!graph.has(dependency)) {
        continue;
      }
      const error = visit(dependency);
      if (error) {
        return error;
      }
    }
    visiting.delete(code);
    visited.add(code);
    return null;
  };

  for (const code of graph.keys()) {
    const error = visit(code);
    if (error) {
      return error;
    }
  }
  return null;
}

export async function listDataBankDomains(tenantId: string, actorUserId: string, actorRole: Role | null | undefined) {
  const accessError = await ensureInstitutionalDataAccess(tenantId, actorUserId, actorRole);
  if (accessError) {
    return { status: "error", message: accessError } satisfies ErrorResult;
  }

  const domains = await prisma.dataBankDomain.findMany({
    where: { tenantId, isActive: true },
    include: {
      _count: {
        select: {
          sources: true,
          metrics: true,
        },
      },
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return { status: "success", domains } satisfies SuccessResult<{ domains: typeof domains }>;
}

export async function createDataBankDomain(
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const parsed = dataBankDomainInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid domain." } satisfies ErrorResult;
  }

  const accessError = await ensureInstitutionalDataAccess(tenantId, actorUserId, actorRole);
  if (accessError) {
    return { status: "error", message: accessError } satisfies ErrorResult;
  }

  const domain = await prisma.dataBankDomain.create({
    data: {
      tenantId,
      code: parsed.data.code,
      name: parsed.data.name,
      description: normalizeNullableString(parsed.data.description),
      sortOrder: parsed.data.sortOrder ?? 0,
    },
  });

  return { status: "success", message: "Institutional data domain created.", domain } satisfies SuccessResult<{ domain: typeof domain }>;
}

export async function listInstitutionalDataSources(
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const accessError = await ensureInstitutionalDataAccess(tenantId, actorUserId, actorRole);
  if (accessError) {
    return { status: "error", message: accessError } satisfies ErrorResult;
  }

    const sources = await prisma.dataBankSourceDefinition.findMany({
      where: { tenantId, isActive: true },
      include: {
        domain: true,
        snapshots: {
          orderBy: [{ updatedAt: "desc" }],
          take: 1,
        },
        _count: {
          select: {
            snapshots: true,
            metricLinks: true,
          },
      },
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return { status: "success", sources } satisfies SuccessResult<{ sources: typeof sources }>;
}

export async function createInstitutionalDataSource(
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const parsed = dataBankSourceInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid source." } satisfies ErrorResult;
  }

  const accessError = await ensureInstitutionalDataAccess(tenantId, actorUserId, actorRole);
  if (accessError) {
    return { status: "error", message: accessError } satisfies ErrorResult;
  }

  if (parsed.data.domainId) {
    const domain = await prisma.dataBankDomain.findFirst({
      where: { id: parsed.data.domainId, tenantId },
      select: { id: true },
    });
    if (!domain) {
      return { status: "error", message: "Institutional data domain not found." } satisfies ErrorResult;
    }
  }

  const source = await prisma.dataBankSourceDefinition.create({
    data: {
      tenantId,
      domainId: normalizeNullableString(parsed.data.domainId),
      code: parsed.data.code,
      name: parsed.data.name,
      description: normalizeNullableString(parsed.data.description),
      kind: parsed.data.kind,
      shape: parsed.data.shape,
      datasetSchema: parsed.data.datasetSchema === undefined ? undefined : (parsed.data.datasetSchema as Prisma.InputJsonValue),
      adapterKey: normalizeNullableString(parsed.data.adapterKey),
      adapterConfig: parsed.data.adapterConfig === undefined ? undefined : (parsed.data.adapterConfig as Prisma.InputJsonValue),
      supportsYearWise: parsed.data.supportsYearWise ?? true,
      supportsScopeBreakdown: parsed.data.supportsScopeBreakdown ?? false,
      isSystemDefined: parsed.data.isSystemDefined ?? false,
      isActive: parsed.data.isActive ?? true,
      sortOrder: parsed.data.sortOrder ?? 0,
      createdByUserId: actorUserId,
    },
    include: {
      domain: true,
    },
  });

  return { status: "success", message: "Institutional data source created.", source } satisfies SuccessResult<{ source: typeof source }>;
}

export async function getInstitutionalDataSource(
  sourceId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const accessError = await ensureInstitutionalDataAccess(tenantId, actorUserId, actorRole);
  if (accessError) {
    return { status: "error", message: accessError } satisfies ErrorResult;
  }

  const source = await prisma.dataBankSourceDefinition.findFirst({
    where: { id: sourceId, tenantId },
    include: {
      domain: true,
      snapshots: {
        orderBy: [{ observedYear: "desc" }, { updatedAt: "desc" }],
        include: {
          datasetRows: {
            orderBy: { rowIndex: "asc" },
            take: 25,
          },
        },
        take: 20,
      },
      metricLinks: {
        where: { isActive: true },
        orderBy: [{ precedence: "asc" }, { createdAt: "asc" }],
        include: {
          metric: {
            select: {
              id: true,
              code: true,
              name: true,
              shape: true,
              valueType: true,
            },
          },
        },
      },
    },
  });
  if (!source) {
    return { status: "error", message: "Institutional data source not found." } satisfies ErrorResult;
  }

  return {
    status: "success",
    source,
    adapters: listInstitutionalDataAdapters(),
  } satisfies SuccessResult<{ source: typeof source; adapters: ReturnType<typeof listInstitutionalDataAdapters> }>;
}

export async function getInstitutionalDataSourceDatasetTemplate(
  sourceId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
  format: "csv" | "xlsx" = "xlsx",
) {
  const accessError = await ensureInstitutionalDataAccess(tenantId, actorUserId, actorRole);
  if (accessError) {
    return { status: "error", message: accessError } satisfies ErrorResult;
  }

  const source = await prisma.dataBankSourceDefinition.findFirst({
    where: { id: sourceId, tenantId, isActive: true },
    select: {
      id: true,
      code: true,
      name: true,
      shape: true,
      datasetSchema: true,
      snapshots: {
        orderBy: [{ updatedAt: "desc" }],
        take: 1,
        include: {
          datasetRows: {
            orderBy: { rowIndex: "asc" },
            take: 25,
          },
        },
      },
    },
  });
  if (!source) {
    return { status: "error", message: "Institutional data source not found." } satisfies ErrorResult;
  }
  if (source.shape !== "DATASET") {
    return { status: "error", message: "Only dataset sources can generate spreadsheet templates." } satisfies ErrorResult;
  }

  const columns =
    parseDatasetTemplateColumns(source.datasetSchema) ||
    deriveTemplateColumnsFromRows(source.snapshots[0]?.datasetRows);
  let resolvedColumns =
    columns.length > 0 ? columns : deriveTemplateColumnsFromRows(source.snapshots[0]?.datasetRows);

  if (resolvedColumns.length === 0) {
    // Provide a generic fallback template if no schema or data exists
    resolvedColumns = [
      { key: "id", label: "id", required: false, sample: "ID-1001" },
      { key: "name", label: "name", required: false, sample: "Sample Name" },
      { key: "value", label: "value", required: false, sample: "100" },
    ];
  }

  const headerRow = resolvedColumns.map((column) => column.key);
  
  // Generate 3 lines of dummy data
  const rows = [headerRow];
  for (let i = 0; i < 3; i++) {
    const sampleRow = resolvedColumns.map((column) => {
      if (column.sample) {
        // If it looks like a number, increment it for variety
        const num = Number(column.sample);
        if (!isNaN(num)) return String(num + i);
        
        // If it looks like an ID, increment the number part
        const match = String(column.sample).match(/^(.*?)(\d+)$/);
        if (match) return `${match[1]}${Number(match[2]) + i}`;
        
        return `${column.sample} ${i + 1}`;
      }
      
      const key = column.key.toLowerCase();
      if (key.includes("id") || key.includes("code")) return `ID-${1000 + i}`;
      if (key.includes("name")) return `Sample Name ${i + 1}`;
      if (key.includes("email")) return `user${i + 1}@example.com`;
      if (key.includes("date") || key.includes("year")) return `2025-01-0${i + 1}`;
      if (key.includes("department") || key.includes("dept")) return `Department ${String.fromCharCode(65 + i)}`;
      if (key.includes("status")) return i % 2 === 0 ? "Active" : "Inactive";
      return `Sample Data ${i + 1}`;
    });
    rows.push(sampleRow);
  }

  if (format === "csv") {
    const csv = rowsToCsv(rows);
    return {
      status: "success",
      filename: `${source.code.toLowerCase()}-template.csv`,
      contentType: "text/csv; charset=utf-8",
      content: Buffer.from(csv, "utf8"),
      columns: resolvedColumns,
    } satisfies SuccessResult<{
      filename: string;
      contentType: string;
      content: Buffer;
      columns: DatasetTemplateColumn[];
    }>;
  }

  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = resolvedColumns.map((column) => ({
    wch: Math.max(column.key.length + 2, column.sample?.length ?? 0, 14),
  }));
  XLSX.utils.book_append_sheet(workbook, sheet, "Template");

  return {
    status: "success",
    filename: `${source.code.toLowerCase()}-template.xlsx`,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    content: Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer),
    columns: resolvedColumns,
  } satisfies SuccessResult<{
    filename: string;
    contentType: string;
    content: Buffer;
    columns: DatasetTemplateColumn[];
  }>;
}

export async function updateInstitutionalDataSource(
  sourceId: string,
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const parsed = dataBankSourceUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid source update." } satisfies ErrorResult;
  }

  const accessError = await ensureInstitutionalDataAccess(tenantId, actorUserId, actorRole);
  if (accessError) {
    return { status: "error", message: accessError } satisfies ErrorResult;
  }

  const existing = await prisma.dataBankSourceDefinition.findFirst({
    where: { id: sourceId, tenantId },
    select: { id: true },
  });
  if (!existing) {
    return { status: "error", message: "Institutional data source not found." } satisfies ErrorResult;
  }

  if (parsed.data.domainId) {
    const domain = await prisma.dataBankDomain.findFirst({
      where: { id: parsed.data.domainId, tenantId },
      select: { id: true },
    });
    if (!domain) {
      return { status: "error", message: "Institutional data domain not found." } satisfies ErrorResult;
    }
  }

  const source = await prisma.dataBankSourceDefinition.update({
    where: { id: sourceId },
    data: {
      ...(parsed.data.domainId !== undefined ? { domainId: normalizeNullableString(parsed.data.domainId) } : {}),
      ...(parsed.data.code !== undefined ? { code: parsed.data.code } : {}),
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.description !== undefined ? { description: normalizeNullableString(parsed.data.description) } : {}),
      ...(parsed.data.kind !== undefined ? { kind: parsed.data.kind } : {}),
      ...(parsed.data.shape !== undefined ? { shape: parsed.data.shape } : {}),
      ...(parsed.data.datasetSchema !== undefined
        ? { datasetSchema: parsed.data.datasetSchema as Prisma.InputJsonValue }
        : {}),
      ...(parsed.data.adapterKey !== undefined ? { adapterKey: normalizeNullableString(parsed.data.adapterKey) } : {}),
      ...(parsed.data.adapterConfig !== undefined
        ? { adapterConfig: parsed.data.adapterConfig as Prisma.InputJsonValue }
        : {}),
      ...(parsed.data.supportsYearWise !== undefined ? { supportsYearWise: parsed.data.supportsYearWise } : {}),
      ...(parsed.data.supportsScopeBreakdown !== undefined
        ? { supportsScopeBreakdown: parsed.data.supportsScopeBreakdown }
        : {}),
      ...(parsed.data.isSystemDefined !== undefined ? { isSystemDefined: parsed.data.isSystemDefined } : {}),
      ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
      ...(parsed.data.sortOrder !== undefined ? { sortOrder: parsed.data.sortOrder } : {}),
    },
    include: {
      domain: true,
    },
  });

  return {
    status: "success",
    message: "Institutional data source updated.",
    source,
  } satisfies SuccessResult<{ source: typeof source }>;
}

export async function listInstitutionalDataSourceSnapshots(
  sourceId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const accessError = await ensureInstitutionalDataAccess(tenantId, actorUserId, actorRole);
  if (accessError) {
    return { status: "error", message: accessError } satisfies ErrorResult;
  }

  const source = await prisma.dataBankSourceDefinition.findFirst({
    where: { id: sourceId, tenantId },
    select: { id: true },
  });
  if (!source) {
    return { status: "error", message: "Institutional data source not found." } satisfies ErrorResult;
  }

  const snapshots = await prisma.dataBankSourceSnapshot.findMany({
    where: { sourceId },
    include: {
      datasetRows: {
        orderBy: { rowIndex: "asc" },
        take: 25,
      },
    },
    orderBy: [{ observedYear: "desc" }, { updatedAt: "desc" }],
  });
  return { status: "success", snapshots } satisfies SuccessResult<{ snapshots: typeof snapshots }>;
}

export async function upsertInstitutionalDataSourceSnapshot(
  sourceId: string,
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const parsed = dataBankSnapshotInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid source snapshot." } satisfies ErrorResult;
  }

  const accessError = await ensureInstitutionalDataAccess(tenantId, actorUserId, actorRole);
  if (accessError) {
    return { status: "error", message: accessError } satisfies ErrorResult;
  }

  const source = await prisma.dataBankSourceDefinition.findFirst({
    where: { id: sourceId, tenantId, isActive: true },
    select: { id: true },
  });
  if (!source) {
    return { status: "error", message: "Institutional data source not found." } satisfies ErrorResult;
  }

  const dimensions = normalizeDimensions(parsed.data.dimensions as DimensionRecord | undefined);
  const scopeKey = buildObservationScopeKey(parsed.data.observedYear ?? null, parsed.data.scopeKey);
  const dimensionFingerprint = buildDimensionFingerprint(dimensions);
  const revisionHash = hashValue({
    observedYear: parsed.data.observedYear ?? null,
    scopeKey,
    dimensions,
    numberValue: parsed.data.numberValue ?? null,
    textValue: normalizeNullableString(parsed.data.textValue),
    jsonValue: parsed.data.jsonValue ?? null,
    datasetRows: (parsed.data.datasetRows ?? []).map((row, index) => ({
      rowIndex: row.rowIndex ?? index,
      rowKey: normalizeNullableString(row.rowKey),
      rowData: row.rowData,
    })),
  });

  const snapshot = await prisma.$transaction(async (tx) => {
    const savedSnapshot = await tx.dataBankSourceSnapshot.upsert({
      where: {
        sourceId_scopeKey_dimensionFingerprint: {
          sourceId,
          scopeKey,
          dimensionFingerprint,
        },
      },
      update: {
        observedYear: parsed.data.observedYear ?? null,
        scopeKey,
        dimensions: Object.keys(dimensions).length > 0 ? (dimensions as Prisma.InputJsonObject) : Prisma.DbNull,
        dimensionFingerprint,
        numberValue: parsed.data.numberValue ?? null,
        textValue: normalizeNullableString(parsed.data.textValue),
        jsonValue: parsed.data.jsonValue === undefined ? Prisma.DbNull : (parsed.data.jsonValue as Prisma.InputJsonValue),
        maturity: parsed.data.maturity ?? DataBankValueMaturity.REPORTED,
        coverageStatus: parsed.data.coverageStatus ?? DataBankCoverageStatus.COMPLETE,
        coveragePercent: parsed.data.coveragePercent ?? null,
        confidenceNote: normalizeNullableString(parsed.data.confidenceNote),
        sourceRevisionHash: revisionHash,
        sourceRef: normalizeNullableString(parsed.data.sourceRef),
        entryMode: parsed.data.entryMode ?? DataBankSnapshotEntryMode.MANUAL_ENTRY,
        enteredByUserId: actorUserId,
        enteredAt: new Date(),
        evidenceMeta: parsed.data.evidenceMeta === undefined ? Prisma.DbNull : (parsed.data.evidenceMeta as Prisma.InputJsonValue),
        lastRefreshedAt: new Date(),
        isStale: false,
      },
      create: {
        sourceId,
        observedYear: parsed.data.observedYear ?? null,
        scopeKey,
        dimensions: Object.keys(dimensions).length > 0 ? (dimensions as Prisma.InputJsonObject) : Prisma.DbNull,
        dimensionFingerprint,
        numberValue: parsed.data.numberValue ?? null,
        textValue: normalizeNullableString(parsed.data.textValue),
        jsonValue: parsed.data.jsonValue === undefined ? Prisma.DbNull : (parsed.data.jsonValue as Prisma.InputJsonValue),
        maturity: parsed.data.maturity ?? DataBankValueMaturity.REPORTED,
        coverageStatus: parsed.data.coverageStatus ?? DataBankCoverageStatus.COMPLETE,
        coveragePercent: parsed.data.coveragePercent ?? null,
        confidenceNote: normalizeNullableString(parsed.data.confidenceNote),
        sourceRevisionHash: revisionHash,
        sourceRef: normalizeNullableString(parsed.data.sourceRef),
        entryMode: parsed.data.entryMode ?? DataBankSnapshotEntryMode.MANUAL_ENTRY,
        enteredByUserId: actorUserId,
        enteredAt: new Date(),
        evidenceMeta: parsed.data.evidenceMeta === undefined ? Prisma.DbNull : (parsed.data.evidenceMeta as Prisma.InputJsonValue),
        lastRefreshedAt: new Date(),
      },
    });

    if (parsed.data.datasetRows && parsed.data.replaceRows !== false) {
      await tx.dataBankSourceDatasetRow.deleteMany({
        where: { snapshotId: savedSnapshot.id },
      });
    }

    if (parsed.data.datasetRows && parsed.data.datasetRows.length > 0) {
      await tx.dataBankSourceDatasetRow.createMany({
        data: parsed.data.datasetRows.map((row, index) => ({
          snapshotId: savedSnapshot.id,
          rowIndex: row.rowIndex ?? index,
          rowKey: normalizeNullableString(row.rowKey),
          rowData: row.rowData as Prisma.InputJsonObject,
          sourceRef: normalizeNullableString(row.sourceRef),
        })),
      });
    }
    return savedSnapshot;
  });

  const syncResult = await syncSnapshotToMetricLinks({ snapshotId: snapshot.id, actorUserId });
  return { status: "success", message: "Source snapshot saved.", snapshot, syncResult } satisfies SuccessResult<{ snapshot: typeof snapshot; syncResult: typeof syncResult }>;
}

export async function deleteInstitutionalDataSourceSnapshot(
  sourceId: string,
  snapshotId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const accessError = await ensureInstitutionalDataAccess(tenantId, actorUserId, actorRole);
  if (accessError) {
    return { status: "error", message: accessError } satisfies ErrorResult;
  }

  const snapshot = await prisma.dataBankSourceSnapshot.findFirst({
    where: { id: snapshotId, sourceId, source: { tenantId } },
  });

  if (!snapshot) {
    return { status: "error", message: "Snapshot not found." } satisfies ErrorResult;
  }

  await prisma.dataBankSourceSnapshot.delete({
    where: { id: snapshotId },
  });

  return { status: "success", message: "Snapshot deleted successfully." } satisfies SuccessResult<{}>;
}

export async function listInstitutionalMetrics(
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const accessError = await ensureInstitutionalDataAccess(tenantId, actorUserId, actorRole);
  if (accessError) {
    return { status: "error", message: accessError } satisfies ErrorResult;
  }

  const metrics = await prisma.sourceMetricDefinition.findMany({
    where: { tenantId, isActive: true },
    include: {
      domain: true,
      observations: {
        orderBy: [{ observedYear: "desc" }, { updatedAt: "desc" }],
        take: 1,
      },
      _count: {
        select: {
          observations: true,
          sourceLinks: true,
        },
      },
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return { status: "success", metrics } satisfies SuccessResult<{ metrics: typeof metrics }>;
}

export async function createInstitutionalMetric(
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const parsed = institutionalMetricInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid institutional metric." } satisfies ErrorResult;
  }

  const accessError = await ensureInstitutionalDataAccess(tenantId, actorUserId, actorRole);
  if (accessError) {
    return { status: "error", message: accessError } satisfies ErrorResult;
  }

  if (parsed.data.domainId) {
    const domain = await prisma.dataBankDomain.findFirst({
      where: { id: parsed.data.domainId, tenantId },
      select: { id: true },
    });
    if (!domain) {
      return { status: "error", message: "Institutional data domain not found." } satisfies ErrorResult;
    }
  }

  const graphError = await validateComputedMetricGraph(tenantId, {
    code: parsed.data.code,
    shape: parsed.data.shape,
    computeConfig: parsed.data.computeConfig ?? null,
  });
  if (graphError) {
    return { status: "error", message: graphError } satisfies ErrorResult;
  }

  const metric = await prisma.sourceMetricDefinition.create({
    data: {
      tenantId,
      domainId: normalizeNullableString(parsed.data.domainId),
      code: parsed.data.code,
      name: parsed.data.name,
      description: normalizeNullableString(parsed.data.description),
      valueType: parsed.data.valueType,
      shape: parsed.data.shape,
      unitOfMeasure: normalizeNullableString(parsed.data.unitOfMeasure),
      helpText: normalizeNullableString(parsed.data.helpText),
      precision: parsed.data.precision ?? null,
      allowedDimensions:
        parsed.data.allowedDimensions && Object.keys(parsed.data.allowedDimensions).length > 0
          ? (parsed.data.allowedDimensions as Prisma.InputJsonObject)
          : undefined,
      datasetSchema: parsed.data.datasetSchema === undefined ? undefined : (parsed.data.datasetSchema as Prisma.InputJsonValue),
      computeConfig: parsed.data.computeConfig === undefined ? undefined : (parsed.data.computeConfig as Prisma.InputJsonValue),
      supportsYearWise: parsed.data.supportsYearWise ?? true,
      supportsScopeBreakdown: parsed.data.supportsScopeBreakdown ?? false,
      usedByBodyCodes: parsed.data.usedByBodyCodes ?? [],
      isSystemDefined: parsed.data.isSystemDefined ?? false,
      isRequiredHint: parsed.data.isRequiredHint ?? false,
      isActive: parsed.data.isActive ?? true,
      sortOrder: parsed.data.sortOrder ?? 0,
      createdByUserId: actorUserId,
    },
    include: {
      domain: true,
    },
  });

  return { status: "success", message: "Institutional metric created.", metric } satisfies SuccessResult<{ metric: typeof metric }>;
}

export async function getInstitutionalMetric(
  metricId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const accessError = await ensureInstitutionalDataAccess(tenantId, actorUserId, actorRole);
  if (accessError) {
    return { status: "error", message: accessError } satisfies ErrorResult;
  }

  const metric = await prisma.sourceMetricDefinition.findFirst({
    where: { id: metricId, tenantId },
    include: {
      domain: true,
      observations: {
        orderBy: [{ observedYear: "desc" }, { updatedAt: "desc" }],
        take: 20,
      },
      sourceLinks: {
        where: { isActive: true },
        orderBy: [{ precedence: "asc" }, { createdAt: "asc" }],
        include: {
          source: {
            select: {
              id: true,
              code: true,
              name: true,
              kind: true,
              shape: true,
              adapterKey: true,
            },
          },
        },
      },
    },
  });
  if (!metric) {
    return { status: "error", message: "Institutional metric not found." } satisfies ErrorResult;
  }

  return { status: "success", metric } satisfies SuccessResult<{ metric: typeof metric }>;
}

export async function updateInstitutionalMetric(
  metricId: string,
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const parsed = institutionalMetricUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid institutional metric update." } satisfies ErrorResult;
  }

  const accessError = await ensureInstitutionalDataAccess(tenantId, actorUserId, actorRole);
  if (accessError) {
    return { status: "error", message: accessError } satisfies ErrorResult;
  }

  const existing = await prisma.sourceMetricDefinition.findFirst({
    where: { id: metricId, tenantId },
    select: { code: true, shape: true, computeConfig: true },
  });
  if (!existing) {
    return { status: "error", message: "Institutional metric not found." } satisfies ErrorResult;
  }

  if (parsed.data.domainId) {
    const domain = await prisma.dataBankDomain.findFirst({
      where: { id: parsed.data.domainId, tenantId },
      select: { id: true },
    });
    if (!domain) {
      return { status: "error", message: "Institutional data domain not found." } satisfies ErrorResult;
    }
  }

  const nextShape = parsed.data.shape ?? existing.shape;
  const nextCode = parsed.data.code ?? existing.code;
  const nextComputeConfig =
    parsed.data.computeConfig === undefined
      ? ((asJsonObject(existing.computeConfig)?.formula
          ? { formula: asJsonObject(existing.computeConfig)?.formula as string }
          : null))
      : (parsed.data.computeConfig ?? null);

  const graphError = await validateComputedMetricGraph(tenantId, {
    code: nextCode,
    shape: nextShape,
    computeConfig: nextComputeConfig,
  });
  if (graphError) {
    return { status: "error", message: graphError } satisfies ErrorResult;
  }

  const metric = await prisma.sourceMetricDefinition.update({
    where: { id: metricId },
    data: {
      ...(parsed.data.domainId !== undefined ? { domainId: normalizeNullableString(parsed.data.domainId) } : {}),
      ...(parsed.data.code !== undefined ? { code: parsed.data.code } : {}),
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.description !== undefined ? { description: normalizeNullableString(parsed.data.description) } : {}),
      ...(parsed.data.valueType !== undefined ? { valueType: parsed.data.valueType } : {}),
      ...(parsed.data.shape !== undefined ? { shape: parsed.data.shape } : {}),
      ...(parsed.data.unitOfMeasure !== undefined ? { unitOfMeasure: normalizeNullableString(parsed.data.unitOfMeasure) } : {}),
      ...(parsed.data.helpText !== undefined ? { helpText: normalizeNullableString(parsed.data.helpText) } : {}),
      ...(parsed.data.precision !== undefined ? { precision: parsed.data.precision ?? null } : {}),
      ...(parsed.data.allowedDimensions !== undefined
        ? {
            allowedDimensions:
              parsed.data.allowedDimensions && Object.keys(parsed.data.allowedDimensions).length > 0
                ? (parsed.data.allowedDimensions as Prisma.InputJsonObject)
                : Prisma.DbNull,
          }
        : {}),
      ...(parsed.data.datasetSchema !== undefined
        ? { datasetSchema: parsed.data.datasetSchema as Prisma.InputJsonValue }
        : {}),
      ...(parsed.data.computeConfig !== undefined
        ? { computeConfig: parsed.data.computeConfig ? (parsed.data.computeConfig as Prisma.InputJsonValue) : Prisma.DbNull }
        : {}),
      ...(parsed.data.supportsYearWise !== undefined ? { supportsYearWise: parsed.data.supportsYearWise } : {}),
      ...(parsed.data.supportsScopeBreakdown !== undefined
        ? { supportsScopeBreakdown: parsed.data.supportsScopeBreakdown }
        : {}),
      ...(parsed.data.usedByBodyCodes !== undefined ? { usedByBodyCodes: parsed.data.usedByBodyCodes } : {}),
      ...(parsed.data.isSystemDefined !== undefined ? { isSystemDefined: parsed.data.isSystemDefined } : {}),
      ...(parsed.data.isRequiredHint !== undefined ? { isRequiredHint: parsed.data.isRequiredHint } : {}),
      ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
      ...(parsed.data.sortOrder !== undefined ? { sortOrder: parsed.data.sortOrder } : {}),
    },
    include: {
      domain: true,
    },
  });

  if (metric.shape === DataBankMetricShape.COMPUTED) {
    await recomputeComputedMetricsForContext({
      tenantId,
      observedYear: null,
      scopeKey: "DEFAULT",
      dimensions: {},
      actorUserId,
    });
  }

  return {
    status: "success",
    message: "Institutional metric updated.",
    metric,
  } satisfies SuccessResult<{ metric: typeof metric }>;
}

export async function previewInstitutionalDataSourceImport(
  sourceId: string,
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const parsed = dataBankDatasetImportSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid dataset import preview.",
    } satisfies ErrorResult;
  }

  const accessError = await ensureInstitutionalDataAccess(tenantId, actorUserId, actorRole);
  if (accessError) {
    return { status: "error", message: accessError } satisfies ErrorResult;
  }

  const source = await prisma.dataBankSourceDefinition.findFirst({
    where: {
      id: sourceId,
      tenantId,
      isActive: true,
    },
    select: {
      id: true,
      code: true,
      name: true,
      shape: true,
    },
  });
  if (!source) {
    return { status: "error", message: "Institutional data source not found." } satisfies ErrorResult;
  }
  if (source.shape !== "DATASET") {
    return { status: "error", message: "Only dataset sources can accept spreadsheet imports." } satisfies ErrorResult;
  }

  let parsedImport: ParsedDatasetImport;
  try {
    parsedImport = parseDatasetImport(parsed.data);
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Failed to parse import file.",
    } satisfies ErrorResult;
  }

  const dimensions = normalizeDimensions(parsed.data.dimensions as DimensionRecord | undefined);
  const scopeKey = buildObservationScopeKey(parsed.data.observedYear ?? null, parsed.data.scopeKey);
  const dimensionFingerprint = buildDimensionFingerprint(dimensions);
  const existingSnapshot = await prisma.dataBankSourceSnapshot.findUnique({
    where: {
      sourceId_scopeKey_dimensionFingerprint: {
        sourceId,
        scopeKey,
        dimensionFingerprint,
      },
    },
    include: {
      _count: {
        select: {
          datasetRows: true,
        },
      },
    },
  });

  return {
    status: "success",
    preview: {
      source: {
        id: source.id,
        code: source.code,
        name: source.name,
      },
      rowCount: parsedImport.rowCount,
      columns: parsedImport.columns,
      sampleRows: parsedImport.sampleRows,
      observedYear: parsed.data.observedYear ?? null,
      scopeKey,
      dimensions,
      replaceRows: parsed.data.replaceRows ?? true,
      existingSnapshot: existingSnapshot
        ? {
            id: existingSnapshot.id,
            rowCount: existingSnapshot._count.datasetRows,
            lastRefreshedAt: existingSnapshot.lastRefreshedAt,
            sourceRevisionHash: existingSnapshot.sourceRevisionHash,
          }
        : null,
    },
  } satisfies SuccessResult<{
    preview: {
      source: {
        id: string;
        code: string;
        name: string;
      };
      rowCount: number;
      columns: string[];
      sampleRows: Array<Record<string, unknown>>;
      observedYear: number | null;
      scopeKey: string;
      dimensions: DimensionRecord;
      replaceRows: boolean;
      existingSnapshot: {
        id: string;
        rowCount: number;
        lastRefreshedAt: Date | null;
        sourceRevisionHash: string | null;
      } | null;
    };
  }>;
}

export async function importInstitutionalDataSourceDataset(
  sourceId: string,
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const parsed = dataBankDatasetImportSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid dataset import.",
    } satisfies ErrorResult;
  }

  const accessError = await ensureInstitutionalDataAccess(tenantId, actorUserId, actorRole);
  if (accessError) {
    return { status: "error", message: accessError } satisfies ErrorResult;
  }

  const source = await prisma.dataBankSourceDefinition.findFirst({
    where: {
      id: sourceId,
      tenantId,
      isActive: true,
    },
    select: {
      id: true,
      shape: true,
    },
  });
  if (!source) {
    return { status: "error", message: "Institutional data source not found." } satisfies ErrorResult;
  }
  if (source.shape !== "DATASET") {
    return { status: "error", message: "Only dataset sources can accept spreadsheet imports." } satisfies ErrorResult;
  }

  let parsedImport: ParsedDatasetImport;
  try {
    parsedImport = parseDatasetImport(parsed.data);
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Failed to parse import file.",
    } satisfies ErrorResult;
  }

  const result = await upsertInstitutionalDataSourceSnapshot(
    sourceId,
    tenantId,
    {
      observedYear: parsed.data.observedYear ?? null,
      scopeKey: parsed.data.scopeKey ?? null,
      dimensions: parsed.data.dimensions ?? {},
      jsonValue: {
        importedFrom: parsed.data.fileName,
        columns: parsedImport.columns,
      },
      entryMode: DataBankSnapshotEntryMode.BULK_IMPORT,
      datasetRows: parsedImport.datasetRows,
      replaceRows: parsed.data.replaceRows ?? true,
    },
    actorUserId,
    actorRole,
  );

  if (result.status === "error") {
    return result;
  }

  return {
    status: "success",
    message: "Dataset imported.",
    snapshot: result.snapshot,
    syncResult: result.syncResult,
    importSummary: {
      rowCount: parsedImport.rowCount,
      columns: parsedImport.columns,
    },
  } satisfies SuccessResult<{
    snapshot: typeof result.snapshot;
    syncResult: typeof result.syncResult;
    importSummary: {
      rowCount: number;
      columns: string[];
    };
  }>;
}

export async function refreshInstitutionalDataSource(
  sourceId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const accessError = await ensureInstitutionalDataAccess(tenantId, actorUserId, actorRole);
  if (accessError) {
    return { status: "error", message: accessError } satisfies ErrorResult;
  }

  const source = await prisma.dataBankSourceDefinition.findFirst({
    where: {
      id: sourceId,
      tenantId,
      isActive: true,
    },
    select: {
      id: true,
      code: true,
      name: true,
      kind: true,
      adapterKey: true,
      adapterConfig: true,
    },
  });
  if (!source) {
    return { status: "error", message: "Institutional data source not found." } satisfies ErrorResult;
  }
  if (source.kind !== "INTERNAL_ADAPTER") {
    return { status: "error", message: "Only adapter-backed sources can be refreshed." } satisfies ErrorResult;
  }

  const adapter = getInstitutionalDataAdapter(source.adapterKey);
  if (!adapter) {
    return { status: "error", message: "No adapter is registered for this source." } satisfies ErrorResult;
  }

  const adapterResult = await adapter.refresh({
    tenantId,
    source: {
      id: source.id,
      code: source.code,
      name: source.name,
      adapterKey: source.adapterKey ?? adapter.key,
      adapterConfig: source.adapterConfig,
    },
  });

  const savedSnapshots: Array<{
    snapshot: Awaited<ReturnType<typeof prisma.dataBankSourceSnapshot.findFirst>>;
    syncResult: {
      appliedCount: number;
      suggestionCount: number;
      recomputedCount: number;
    };
  }> = [];

  let appliedCount = 0;
  let suggestionCount = 0;
  let recomputedCount = 0;

  for (const snapshot of adapterResult.snapshots) {
    const saved = await upsertInstitutionalDataSourceSnapshot(
      source.id,
      tenantId,
      {
        observedYear: snapshot.observedYear,
        scopeKey: snapshot.scopeKey,
        numberValue: snapshot.numberValue,
        textValue: snapshot.textValue,
        jsonValue: snapshot.jsonValue,
        maturity: snapshot.maturity,
        coverageStatus: snapshot.coverageStatus,
        coveragePercent: snapshot.coveragePercent,
        confidenceNote: snapshot.confidenceNote,
        sourceRef: snapshot.sourceRef,
        entryMode: snapshot.entryMode ?? DataBankSnapshotEntryMode.ADAPTER_REFRESH,
        evidenceMeta: snapshot.evidenceMeta,
        datasetRows: snapshot.datasetRows?.map((row, index) => ({
          rowIndex: row.rowIndex ?? index,
          rowKey: row.rowKey ?? null,
          rowData: row.rowData,
          sourceRef: row.sourceRef ?? null,
        })),
        replaceRows: snapshot.replaceRows ?? true,
      },
      actorUserId,
      actorRole,
    );

    if (saved.status === "error") {
      return saved;
    }

    savedSnapshots.push({ snapshot: saved.snapshot, syncResult: saved.syncResult });
    appliedCount += saved.syncResult.appliedCount;
    suggestionCount += saved.syncResult.suggestionCount;
    recomputedCount += saved.syncResult.recomputedCount;
  }

  return {
    status: "success",
    message: `Refreshed ${savedSnapshots.length} snapshot${savedSnapshots.length === 1 ? "" : "s"}.`,
    source: {
      id: source.id,
      code: source.code,
      name: source.name,
      adapterKey: source.adapterKey,
    },
    refreshedSnapshotCount: savedSnapshots.length,
    appliedCount,
    suggestionCount,
    recomputedCount,
  } satisfies SuccessResult<{
    source: {
      id: string;
      code: string;
      name: string;
      adapterKey: string | null;
    };
    refreshedSnapshotCount: number;
    appliedCount: number;
    suggestionCount: number;
    recomputedCount: number;
  }>;
}

export async function upsertMetricSourceLinks(
  metricId: string,
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const parsed = metricSourceLinkInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid metric-source links." } satisfies ErrorResult;
  }

  const accessError = await ensureInstitutionalDataAccess(tenantId, actorUserId, actorRole);
  if (accessError) {
    return { status: "error", message: accessError } satisfies ErrorResult;
  }

  const metric = await prisma.sourceMetricDefinition.findFirst({
    where: { id: metricId, tenantId, isActive: true },
    select: { id: true },
  });
  if (!metric) {
    return { status: "error", message: "Institutional metric not found." } satisfies ErrorResult;
  }

  const sourceIds = [...new Set(parsed.data.links.map((link) => link.sourceId))];
  const sources = await prisma.dataBankSourceDefinition.findMany({
    where: { tenantId, id: { in: sourceIds }, isActive: true },
    select: { id: true },
  });
  if (sources.length !== sourceIds.length) {
    return { status: "error", message: "One or more institutional data sources were not found." } satisfies ErrorResult;
  }

  const links = await prisma.$transaction(async (tx) => {
    const saved: Array<Awaited<ReturnType<typeof tx.metricSourceLink.upsert>>> = [];
    for (const link of parsed.data.links) {
      const savedLink = await tx.metricSourceLink.upsert({
        where: {
          metricId_sourceId: { metricId, sourceId: link.sourceId },
        },
        update: {
          precedence: link.precedence ?? 100,
          resolutionMode: link.resolutionMode,
          transformConfig: link.transformConfig === undefined ? Prisma.DbNull : (link.transformConfig as Prisma.InputJsonValue),
          isPrimary: link.isPrimary ?? false,
          autoApplyWhenUnknown: link.autoApplyWhenUnknown ?? true,
          createSuggestionOnConflict: link.createSuggestionOnConflict ?? true,
          isActive: link.isActive ?? true,
        },
        create: {
          tenantId,
          metricId,
          sourceId: link.sourceId,
          precedence: link.precedence ?? 100,
          resolutionMode: link.resolutionMode,
          transformConfig: link.transformConfig === undefined ? Prisma.DbNull : (link.transformConfig as Prisma.InputJsonValue),
          isPrimary: link.isPrimary ?? false,
          autoApplyWhenUnknown: link.autoApplyWhenUnknown ?? true,
          createSuggestionOnConflict: link.createSuggestionOnConflict ?? true,
          isActive: link.isActive ?? true,
        },
      });
      saved.push(savedLink);
    }
    return saved;
  });

  return { status: "success", message: "Metric-source links saved.", links } satisfies SuccessResult<{ links: typeof links }>;
}

export async function listMetricRefreshSuggestions(
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
  filters?: { status?: RefreshSuggestionStatus },
) {
  const accessError = await ensureInstitutionalDataAccess(tenantId, actorUserId, actorRole);
  if (accessError) {
    return { status: "error", message: accessError } satisfies ErrorResult;
  }

  const suggestions = await prisma.metricRefreshSuggestion.findMany({
    where: {
      metricObservation: {
        metric: { tenantId },
      },
      ...(filters?.status ? { status: filters.status } : {}),
    },
    include: {
      metricObservation: {
        include: {
          metric: true,
        },
      },
      metricSourceLink: {
        include: {
          source: true,
        },
      },
    },
    orderBy: [{ detectedAt: "desc" }],
  });
  return { status: "success", suggestions } satisfies SuccessResult<{ suggestions: typeof suggestions }>;
}

export async function resolveMetricRefreshSuggestion(
  suggestionId: string,
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const parsed = refreshSuggestionResolutionSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid suggestion resolution." } satisfies ErrorResult;
  }

  const accessError = await ensureInstitutionalDataAccess(tenantId, actorUserId, actorRole);
  if (accessError) {
    return { status: "error", message: accessError } satisfies ErrorResult;
  }

  const suggestion = await prisma.metricRefreshSuggestion.findFirst({
    where: {
      id: suggestionId,
      metricObservation: {
        metric: { tenantId },
      },
    },
    include: {
      metricObservation: true,
    },
  });
  if (!suggestion) {
    return { status: "error", message: "Refresh suggestion not found." } satisfies ErrorResult;
  }
  if (suggestion.status !== RefreshSuggestionStatus.PENDING) {
    return { status: "error", message: "Refresh suggestion is already resolved." } satisfies ErrorResult;
  }

  if (parsed.data.action === "REJECT") {
    const rejected = await prisma.metricRefreshSuggestion.update({
      where: { id: suggestion.id },
      data: {
        status: RefreshSuggestionStatus.REJECTED,
        note: normalizeNullableString(parsed.data.note) ?? suggestion.note,
        resolvedAt: new Date(),
        resolvedByUserId: actorUserId,
      },
    });

    await prisma.sourceMetricObservation.update({
      where: { id: suggestion.metricObservationId },
      data: {
        isStale: true,
        refreshBlockedReason: "SUGGESTION_REJECTED",
      },
    });

    return { status: "success", message: "Refresh suggestion rejected.", suggestion: rejected } satisfies SuccessResult<{ suggestion: typeof rejected }>;
  }

  const observation = await prisma.sourceMetricObservation.update({
    where: { id: suggestion.metricObservationId },
    data: {
      numberValue: suggestion.candidateNumberValue,
      textValue: suggestion.candidateTextValue,
      jsonValue: suggestion.candidateJsonValue ?? Prisma.DbNull,
      sourceType: "DATA_BANK",
      sourceRef: suggestion.sourceRef,
      sourceRevisionHash: suggestion.sourceRevisionHash,
      maturity: suggestion.candidateMaturity,
      coverageStatus: suggestion.candidateCoverageStatus ?? DataBankCoverageStatus.COMPLETE,
      coveragePercent: suggestion.candidateCoveragePercent ?? null,
      lastRefreshedAt: new Date(),
      isStale: false,
      refreshBlockedReason: null,
      recordedByUserId: actorUserId,
      recordedAt: new Date(),
    },
  });

  const accepted = await prisma.metricRefreshSuggestion.update({
    where: { id: suggestion.id },
    data: {
      status: RefreshSuggestionStatus.ACCEPTED,
      note: normalizeNullableString(parsed.data.note) ?? suggestion.note,
      resolvedAt: new Date(),
      resolvedByUserId: actorUserId,
    },
  });

  return {
    status: "success",
    message: "Refresh suggestion accepted.",
    suggestion: accepted,
    observation,
  } satisfies SuccessResult<{ suggestion: typeof accepted; observation: typeof observation }>;
}

export async function getInstitutionalDataSummary(tenantId: string, actorUserId: string, actorRole: Role | null | undefined) {
  const accessError = await ensureInstitutionalDataAccess(tenantId, actorUserId, actorRole);
  if (accessError) {
    return { status: "error", message: accessError } satisfies ErrorResult;
  }

  const [domainCount, sourceCount, snapshotCount, metricCount, computedMetricCount, linkCount, pendingSuggestionCount, staleMetricCount, maturityBuckets] =
    await Promise.all([
      prisma.dataBankDomain.count({ where: { tenantId, isActive: true } }),
      prisma.dataBankSourceDefinition.count({ where: { tenantId, isActive: true } }),
      prisma.dataBankSourceSnapshot.count({ where: { source: { tenantId } } }),
      prisma.sourceMetricDefinition.count({ where: { tenantId, isActive: true } }),
      prisma.sourceMetricDefinition.count({ where: { tenantId, isActive: true, shape: DataBankMetricShape.COMPUTED } }),
      prisma.metricSourceLink.count({ where: { tenantId, isActive: true } }),
      prisma.metricRefreshSuggestion.count({
        where: {
          metricObservation: { metric: { tenantId } },
          status: RefreshSuggestionStatus.PENDING,
        },
      }),
      prisma.sourceMetricObservation.count({
        where: {
          metric: { tenantId },
          isStale: true,
        },
      }),
      prisma.sourceMetricObservation.groupBy({
        by: ["maturity"],
        where: { metric: { tenantId } },
        _count: { maturity: true },
      }),
    ]);

  return {
    status: "success",
    summary: {
      domainCount,
      sourceCount,
      snapshotCount,
      metricCount,
      computedMetricCount,
      linkCount,
      pendingSuggestionCount,
      staleMetricCount,
      maturityBuckets: Object.fromEntries(maturityBuckets.map((bucket) => [bucket.maturity, bucket._count.maturity])),
    },
  } satisfies SuccessResult<{
    summary: {
      domainCount: number;
      sourceCount: number;
      snapshotCount: number;
      metricCount: number;
      computedMetricCount: number;
      linkCount: number;
      pendingSuggestionCount: number;
      staleMetricCount: number;
      maturityBuckets: Record<string, number>;
    };
  }>;
}

export async function getInstitutionalDataGaps(
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
  input?: { bodyCode?: string | null },
) {
  const accessError = await ensureInstitutionalDataAccess(tenantId, actorUserId, actorRole);
  if (accessError) {
    return { status: "error", message: accessError } satisfies ErrorResult;
  }

  const bodyCode = normalizeNullableString(input?.bodyCode);
  const metrics = await prisma.sourceMetricDefinition.findMany({
    where: {
      tenantId,
      isActive: true,
      ...(bodyCode ? { usedByBodyCodes: { has: bodyCode } } : {}),
    },
    include: {
      observations: {
        orderBy: [{ observedYear: "desc" }, { updatedAt: "desc" }],
        take: 1,
      },
      sourceLinks: {
        where: { isActive: true },
      },
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  const items = metrics.map((metric) => {
    const latestObservation = metric.observations[0] ?? null;
    const hasValue = latestObservation
      ? hasObservationValue({
          numberValue: latestObservation.numberValue,
          textValue: latestObservation.textValue,
          jsonValue: latestObservation.jsonValue,
        })
      : false;

    const gapStatus =
      latestObservation?.coverageStatus === DataBankCoverageStatus.NOT_APPLICABLE
        ? "NOT_APPLICABLE"
        : !latestObservation || !hasValue || latestObservation.maturity === DataBankValueMaturity.UNKNOWN
          ? "MISSING"
          : latestObservation.coverageStatus === DataBankCoverageStatus.PARTIAL
            ? "PARTIAL"
            : latestObservation.isStale
              ? "STALE"
              : "READY";

    return {
      metricId: metric.id,
      code: metric.code,
      name: metric.name,
      shape: metric.shape,
      usedByBodyCodes: metric.usedByBodyCodes,
      linkCount: metric.sourceLinks.length,
      latestObservation: latestObservation
        ? {
            observedYear: latestObservation.observedYear,
            scopeKey: latestObservation.scopeKey,
            maturity: latestObservation.maturity,
            coverageStatus: latestObservation.coverageStatus,
            coveragePercent: latestObservation.coveragePercent,
            isStale: latestObservation.isStale,
          }
        : null,
      gapStatus,
    };
  });

  return {
    status: "success",
    gaps: {
      bodyCode,
      totalMetrics: items.length,
      missingMetrics: items.filter((item) => item.gapStatus === "MISSING").length,
      partialMetrics: items.filter((item) => item.gapStatus === "PARTIAL").length,
      staleMetrics: items.filter((item) => item.gapStatus === "STALE").length,
      items,
    },
  } satisfies SuccessResult<{
    gaps: {
      bodyCode: string | null;
      totalMetrics: number;
      missingMetrics: number;
      partialMetrics: number;
      staleMetrics: number;
      items: typeof items;
    };
  }>;
}

const seededDomainCatalog = [
  { code: "HUMAN_RESOURCES", name: "Human Resources", sortOrder: 0 },
  { code: "STUDENT_AFFAIRS", name: "Student Affairs", sortOrder: 10 },
  { code: "RESEARCH_INNOVATION", name: "Research & Innovation", sortOrder: 20 },
  { code: "ACADEMIC_PROGRAMS", name: "Academic Programs", sortOrder: 30 },
  { code: "INFRASTRUCTURE", name: "Infrastructure", sortOrder: 40 },
  { code: "FINANCE", name: "Finance", sortOrder: 50 },
] as const;

const seededSourceCatalog = [
  {
    domainCode: "HUMAN_RESOURCES",
    code: "HR_FACULTY_ROSTER",
    name: "HR Faculty Roster",
    kind: "INTERNAL_ADAPTER" as const,
    shape: "DATASET" as const,
    adapterKey: "personnel.membership_roster",
    supportsScopeBreakdown: true,
  },
  { domainCode: "STUDENT_AFFAIRS", code: "PLACEMENT_LIST", name: "Placement List", kind: "CSV_IMPORT" as const, shape: "DATASET" as const, supportsScopeBreakdown: true },
  { domainCode: "RESEARCH_INNOVATION", code: "PUBLICATION_REGISTER", name: "Publication Register", kind: "CSV_IMPORT" as const, shape: "DATASET" as const, supportsScopeBreakdown: true },
  {
    domainCode: "RESEARCH_INNOVATION",
    code: "VERIFIED_ACHIEVEMENT_REGISTRY",
    name: "Verified Achievement Registry",
    kind: "INTERNAL_ADAPTER" as const,
    shape: "DATASET" as const,
    adapterKey: "achievements.verified_registry",
    supportsScopeBreakdown: true,
  },
  { domainCode: "FINANCE", code: "ANNUAL_FINANCE_SHEET", name: "Annual Finance Sheet", kind: "MANUAL" as const, shape: "SCALAR" as const, supportsScopeBreakdown: false },
] as const;

const seededMetricCatalog: Array<{
  domainCode: string;
  code: string;
  name: string;
  valueType: SourceMetricValueType;
  usedByBodyCodes: string[];
  shape?: DataBankMetricShape;
  computeConfig?: { formula: string };
}> = [
  { domainCode: "HUMAN_RESOURCES", code: "FACULTY_TOTAL", name: "Faculty Total", valueType: SourceMetricValueType.NUMBER, usedByBodyCodes: ["NAAC", "NIRF", "NBA"] },
  { domainCode: "HUMAN_RESOURCES", code: "FACULTY_PHD", name: "Faculty With PhD", valueType: SourceMetricValueType.NUMBER, usedByBodyCodes: ["NAAC", "NIRF", "NBA"] },
  { domainCode: "HUMAN_RESOURCES", code: "FACULTY_PHD_RATIO", name: "Faculty PhD Ratio", shape: DataBankMetricShape.COMPUTED, valueType: SourceMetricValueType.NUMBER, usedByBodyCodes: ["NAAC", "NIRF"], computeConfig: { formula: "deps.FACULTY_PHD.value / deps.FACULTY_TOTAL.value" } },
  { domainCode: "STUDENT_AFFAIRS", code: "GRADUATING_STUDENTS_TOTAL", name: "Graduating Students Total", valueType: SourceMetricValueType.NUMBER, usedByBodyCodes: ["NAAC", "NIRF"] },
  { domainCode: "STUDENT_AFFAIRS", code: "STUDENT_PLACED_TOTAL", name: "Students Placed Total", valueType: SourceMetricValueType.NUMBER, usedByBodyCodes: ["NAAC", "NIRF"] },
  { domainCode: "STUDENT_AFFAIRS", code: "PLACEMENT_RATE", name: "Placement Rate", shape: DataBankMetricShape.COMPUTED, valueType: SourceMetricValueType.NUMBER, usedByBodyCodes: ["NAAC", "NIRF"], computeConfig: { formula: "(deps.STUDENT_PLACED_TOTAL.value / deps.GRADUATING_STUDENTS_TOTAL.value) * 100" } },
  { domainCode: "RESEARCH_INNOVATION", code: "PUBLICATIONS_TOTAL", name: "Publications Total", valueType: SourceMetricValueType.NUMBER, usedByBodyCodes: ["NAAC", "NIRF", "NBA"] },
  { domainCode: "RESEARCH_INNOVATION", code: "PUBLICATIONS_PER_FACULTY", name: "Publications Per Faculty", shape: DataBankMetricShape.COMPUTED, valueType: SourceMetricValueType.NUMBER, usedByBodyCodes: ["NIRF"], computeConfig: { formula: "deps.PUBLICATIONS_TOTAL.value / deps.FACULTY_TOTAL.value" } },
  { domainCode: "FINANCE", code: "ANNUAL_BUDGET_TOTAL", name: "Annual Budget Total", valueType: SourceMetricValueType.NUMBER, usedByBodyCodes: ["NAAC"] },
] as const;

export async function seedInstitutionalDataCatalog(
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const parsed = seedCatalogInputSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid seed request." } satisfies ErrorResult;
  }

  const accessError = await ensureInstitutionalDataAccess(tenantId, actorUserId, actorRole);
  if (accessError) {
    return { status: "error", message: accessError } satisfies ErrorResult;
  }

  const domains = new Map<string, { id: string }>();
  for (const seededDomain of seededDomainCatalog) {
    const domain = await prisma.dataBankDomain.upsert({
      where: {
        tenantId_code: {
          tenantId,
          code: seededDomain.code,
        },
      },
      update: {
        name: seededDomain.name,
        sortOrder: seededDomain.sortOrder,
        isSystemDefined: true,
        isActive: true,
      },
      create: {
        tenantId,
        code: seededDomain.code,
        name: seededDomain.name,
        sortOrder: seededDomain.sortOrder,
        isSystemDefined: true,
      },
    });
    domains.set(seededDomain.code, { id: domain.id });
  }

  if (parsed.data.includeRecommendedSources !== false) {
    for (const seededSource of seededSourceCatalog) {
      const domainId = domains.get(seededSource.domainCode)?.id;
      await prisma.dataBankSourceDefinition.upsert({
        where: {
          tenantId_code: {
            tenantId,
            code: seededSource.code,
          },
        },
        update: {
          domainId,
          name: seededSource.name,
          kind: seededSource.kind,
          shape: seededSource.shape,
          adapterKey: "adapterKey" in seededSource ? seededSource.adapterKey : null,
          supportsScopeBreakdown: seededSource.supportsScopeBreakdown,
          isSystemDefined: true,
          isActive: true,
        },
        create: {
          tenantId,
          domainId,
          code: seededSource.code,
          name: seededSource.name,
          kind: seededSource.kind,
          shape: seededSource.shape,
          adapterKey: "adapterKey" in seededSource ? seededSource.adapterKey : null,
          supportsScopeBreakdown: seededSource.supportsScopeBreakdown,
          isSystemDefined: true,
        },
      });
    }
  }

  for (const seededMetric of seededMetricCatalog) {
    const graphError = await validateComputedMetricGraph(tenantId, {
      code: seededMetric.code,
      shape: seededMetric.shape ?? DataBankMetricShape.SCALAR,
      computeConfig: seededMetric.computeConfig ?? null,
    });
    if (graphError) {
      return { status: "error", message: graphError } satisfies ErrorResult;
    }

    await prisma.sourceMetricDefinition.upsert({
      where: {
        tenantId_code: {
          tenantId,
          code: seededMetric.code,
        },
      },
      update: {
        domainId: domains.get(seededMetric.domainCode)?.id,
        name: seededMetric.name,
        shape: seededMetric.shape ?? DataBankMetricShape.SCALAR,
        valueType: seededMetric.valueType,
        usedByBodyCodes: [...seededMetric.usedByBodyCodes],
        computeConfig: seededMetric.computeConfig ? (seededMetric.computeConfig as Prisma.InputJsonValue) : Prisma.DbNull,
        isSystemDefined: true,
        isActive: true,
      },
      create: {
        tenantId,
        domainId: domains.get(seededMetric.domainCode)?.id,
        code: seededMetric.code,
        name: seededMetric.name,
        shape: seededMetric.shape ?? DataBankMetricShape.SCALAR,
        valueType: seededMetric.valueType,
        usedByBodyCodes: [...seededMetric.usedByBodyCodes],
        computeConfig: seededMetric.computeConfig ? (seededMetric.computeConfig as Prisma.InputJsonValue) : Prisma.DbNull,
        isSystemDefined: true,
        createdByUserId: actorUserId,
      },
    });
  }

  const sourceMetricMap = new Map(
    (await prisma.sourceMetricDefinition.findMany({
      where: {
        tenantId,
        code: { in: ["FACULTY_TOTAL", "FACULTY_PHD", "STUDENT_PLACED_TOTAL", "PUBLICATIONS_TOTAL"] },
      },
      select: { id: true, code: true },
    })).map((metric) => [metric.code, metric.id]),
  );
  const sourceMap = new Map(
    (await prisma.dataBankSourceDefinition.findMany({
      where: {
        tenantId,
        code: { in: ["HR_FACULTY_ROSTER", "PLACEMENT_LIST", "PUBLICATION_REGISTER"] },
      },
      select: { id: true, code: true },
    })).map((source) => [source.code, source.id]),
  );

  const recommendedLinks: Array<{ metricCode: string; sourceCode: string; resolutionMode: MetricSourceResolutionMode; transformConfig: Prisma.InputJsonValue; precedence: number }> = [
    { metricCode: "FACULTY_TOTAL", sourceCode: "HR_FACULTY_ROSTER", resolutionMode: MetricSourceResolutionMode.COUNT_ROWS, transformConfig: { mode: "COUNT_ROWS" }, precedence: 10 },
    { metricCode: "FACULTY_PHD", sourceCode: "HR_FACULTY_ROSTER", resolutionMode: MetricSourceResolutionMode.COUNT_ROWS, transformConfig: { mode: "COUNT_ROWS", filter: { qualification: "PhD" } }, precedence: 20 },
    { metricCode: "STUDENT_PLACED_TOTAL", sourceCode: "PLACEMENT_LIST", resolutionMode: MetricSourceResolutionMode.COUNT_ROWS, transformConfig: { mode: "COUNT_ROWS", filter: { placed: true } }, precedence: 10 },
    { metricCode: "PUBLICATIONS_TOTAL", sourceCode: "PUBLICATION_REGISTER", resolutionMode: MetricSourceResolutionMode.COUNT_ROWS, transformConfig: { mode: "COUNT_ROWS" }, precedence: 10 },
  ];

  for (const link of recommendedLinks) {
    const metricId = sourceMetricMap.get(link.metricCode);
    const sourceId = sourceMap.get(link.sourceCode);
    if (!metricId || !sourceId) {
      continue;
    }
    await prisma.metricSourceLink.upsert({
      where: {
        metricId_sourceId: {
          metricId,
          sourceId,
        },
      },
      update: {
        precedence: link.precedence,
        resolutionMode: link.resolutionMode,
        transformConfig: link.transformConfig,
        isActive: true,
      },
      create: {
        tenantId,
        metricId,
        sourceId,
        precedence: link.precedence,
        resolutionMode: link.resolutionMode,
        transformConfig: link.transformConfig,
        isActive: true,
      },
    });
  }

  return { status: "success", message: "Institutional data catalog seeded." };
}
