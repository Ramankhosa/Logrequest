import * as XLSX from "xlsx";

export type ParsedRow = {
  rowIndex: number;
  typeKey: string;
  code: string;
  name: string;
  parentCode: string | null;
  errors: string[];
  warnings: string[];
};

export type ParseResult = {
  rows: ParsedRow[];
  validCount: number;
  errorCount: number;
  warningCount: number;
};

const CODE_RE = /^[A-Z0-9_-]{2,}$/;

/**
 * Parse a CSV or Excel buffer into structured org-unit rows.
 *
 * Expected columns (case-insensitive, underscores/spaces flexible):
 *   type_key | unit_code | unit_name | parent_code
 */
export function parseStructureFile(
  buffer: Buffer,
  fileName: string,
): ParseResult {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { rows: [], validCount: 0, errorCount: 1, warningCount: 0 };
  }

  const sheet = workbook.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
  });

  if (raw.length === 0) {
    return { rows: [], validCount: 0, errorCount: 0, warningCount: 0 };
  }

  // Normalize column names: lowercase, remove spaces/underscores
  const normalize = (s: string) => s.toLowerCase().replace(/[\s_-]/g, "");

  const columnMap: Record<string, string> = {};
  const firstRow = raw[0]!;
  for (const key of Object.keys(firstRow)) {
    const norm = normalize(key);
    if (norm.includes("typekey") || norm === "type") columnMap[key] = "typeKey";
    else if (norm.includes("unitcode") || norm === "code")
      columnMap[key] = "code";
    else if (norm.includes("unitname") || norm === "name")
      columnMap[key] = "name";
    else if (norm.includes("parentcode") || norm === "parent")
      columnMap[key] = "parentCode";
  }

  const rows: ParsedRow[] = [];
  const codes = new Set<string>();

  for (let i = 0; i < raw.length; i++) {
    const rawRow = raw[i]!;
    const errors: string[] = [];
    const warnings: string[] = [];

    // Map columns
    const mapped: Record<string, string> = {};
    for (const [rawKey, field] of Object.entries(columnMap)) {
      mapped[field] = String(rawRow[rawKey] ?? "").trim();
    }

    const typeKey = (mapped.typeKey ?? "").toUpperCase();
    const code = (mapped.code ?? "").toUpperCase();
    const name = mapped.name ?? "";
    const parentCode = mapped.parentCode
      ? mapped.parentCode.toUpperCase()
      : null;

    // Validate
    if (!typeKey) errors.push("Missing type_key");
    if (!code) errors.push("Missing unit_code");
    else if (!CODE_RE.test(code)) errors.push("Invalid code format (A-Z, 0-9, _, -)");
    if (!name || name.length < 2) errors.push("Name must be at least 2 characters");

    if (code && codes.has(code)) {
      errors.push(`Duplicate code "${code}"`);
    }
    codes.add(code);

    rows.push({
      rowIndex: i + 1,
      typeKey,
      code,
      name,
      parentCode,
      errors,
      warnings,
    });
  }

  // Validate parent references
  for (const row of rows) {
    if (row.parentCode && !codes.has(row.parentCode)) {
      row.warnings.push(
        `Parent "${row.parentCode}" not found in file — will try to match existing units`,
      );
    }
  }

  // Check exactly one root
  const roots = rows.filter((r) => !r.parentCode);
  if (roots.length === 0) {
    // Not necessarily an error - may be appending to existing structure
  } else if (roots.length > 1) {
    for (const root of roots.slice(1)) {
      root.errors.push("Multiple root units (empty parent_code) found");
    }
  }

  return {
    rows,
    validCount: rows.filter((r) => r.errors.length === 0).length,
    errorCount: rows.filter((r) => r.errors.length > 0).length,
    warningCount: rows.filter((r) => r.warnings.length > 0).length,
  };
}

/**
 * Generate a CSV template string for org structure upload.
 */
export function generateCsvTemplate(
  typeKeys: string[],
): string {
  const header = "type_key,unit_code,unit_name,parent_code";
  const comment = `# Valid type_key values: ${typeKeys.length ? typeKeys.join(", ") : "(create unit types first)"}`;
  const example = typeKeys.length
    ? `${typeKeys[0]},EXAMPLE_ROOT,Example Organization,\n${typeKeys[typeKeys.length > 1 ? 1 : 0]},EXAMPLE_CHILD,Example Child Unit,EXAMPLE_ROOT`
    : "ORG_ROOT,UNIV,University of Example,\nFACULTY,FAC_ENG,Faculty of Engineering,UNIV";

  return `${comment}\n${header}\n${example}\n`;
}
