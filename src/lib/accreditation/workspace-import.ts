import * as XLSX from "xlsx";

export type ParsedWorkspaceImportRow = {
  rowIndex: number;
  blockCode: string;
  year: number | null;
  numericValue: number | null;
  textValue: string | null;
  remarks: string | null;
  errors: string[];
};

export type ParsedWorkspaceImportResult = {
  rows: ParsedWorkspaceImportRow[];
  validCount: number;
  errorCount: number;
};

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function normalizeNullableText(value: unknown) {
  if (value == null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function parseNullableNumber(value: unknown) {
  if (value == null) {
    return null;
  }

  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveMappedRow(rawRow: Record<string, unknown>) {
  const mapped: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(rawRow)) {
    const normalized = normalizeHeader(key);
    if (normalized === "blockcode" || normalized === "block" || normalized === "criterioncode" || normalized === "criterion") {
      mapped.blockCode = value;
      continue;
    }
    if (normalized === "year") {
      mapped.year = value;
      continue;
    }
    if (normalized === "numericvalue" || normalized === "actualvalue" || normalized === "value") {
      mapped.numericValue = value;
      continue;
    }
    if (normalized === "textvalue" || normalized === "narrative" || normalized === "text") {
      mapped.textValue = value;
      continue;
    }
    if (normalized === "remarks" || normalized === "remark" || normalized === "notes") {
      mapped.remarks = value;
    }
  }

  return mapped;
}

export function parseWorkspaceImportFile(
  buffer: Buffer,
  fileName: string,
): ParsedWorkspaceImportResult {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    return {
      rows: [],
      validCount: 0,
      errorCount: 1,
    };
  }

  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: false,
  });

  if (rawRows.length === 0) {
    return {
      rows: [],
      validCount: 0,
      errorCount: 0,
    };
  }

  const rows: ParsedWorkspaceImportRow[] = [];

  for (let index = 0; index < rawRows.length; index += 1) {
    const rawRow = rawRows[index]!;
    const mapped = resolveMappedRow(rawRow);
    const blockCode = (normalizeNullableText(mapped.blockCode) ?? "").toUpperCase();
    const year = parseNullableNumber(mapped.year);
    const numericValue = parseNullableNumber(mapped.numericValue);
    const textValue = normalizeNullableText(mapped.textValue);
    const remarks = normalizeNullableText(mapped.remarks);
    const errors: string[] = [];

    const rowHasValues = !!blockCode || year !== null || numericValue !== null || !!textValue || !!remarks;
    if (!rowHasValues) {
      continue;
    }

    if (!blockCode) {
      errors.push("Missing block code.");
    }

    if (year === null || !Number.isInteger(year)) {
      errors.push("Year must be a whole number.");
    }

    if (numericValue === null && !textValue) {
      errors.push("Provide either a numeric value or a text value.");
    }

    rows.push({
      rowIndex: index + 1,
      blockCode,
      year,
      numericValue,
      textValue,
      remarks,
      errors,
    });
  }

  return {
    rows,
    validCount: rows.filter((row) => row.errors.length === 0).length,
    errorCount: rows.filter((row) => row.errors.length > 0).length,
  };
}
