import * as XLSX from "xlsx";
import {
  JOURNAL_TEMPLATE_HEADERS,
  SCIMAGO_RAW_HEADER_PREFIX,
  type JournalImportSourceSystem,
} from "./shared";

const SCIMAGO_HEADERS = [
  "Rank",
  "Sourceid",
  "Title",
  "Type",
  "Issn",
  "Publisher",
  "Open Access",
  "Open Access Diamond",
  "SJR",
  "SJR Best Quartile",
  "H index",
  "Total Docs. (2024)",
  "Total Docs. (3years)",
  "Total Refs.",
  "Total Citations (3years)",
  "Citable Docs. (3years)",
  "Citations / Doc. (2years)",
  "Ref. / Doc.",
  "%Female",
  "Overton",
  "SDG",
  "Country",
  "Region",
  "Publisher Duplicate",
  "Coverage",
  "Categories",
  "Areas",
] as const;

export type NormalizedJournalImportData = {
  sourceYear: number;
  sourceId: string | null;
  title: string;
  normalizedTitle: string;
  type: string;
  issnRaw: string | null;
  issnPrimary: string | null;
  issnList: string[];
  issnNormalizedList: string[];
  publisher: string | null;
  duplicatePublisher: string | null;
  openAccessLabel: string | null;
  isOpenAccess: boolean | null;
  openAccessDiamondLabel: string | null;
  isOpenAccessDiamond: boolean | null;
  sjr: number | null;
  sjrBestQuartile: string | null;
  hIndex: number | null;
  totalDocsCurrent: number | null;
  totalDocs3Years: number | null;
  totalRefs: number | null;
  totalCitations3Years: number | null;
  citableDocs3Years: number | null;
  citationsPerDoc2Years: number | null;
  refsPerDoc: number | null;
  femalePercent: number | null;
  overton: number | null;
  sdg: number | null;
  country: string | null;
  region: string | null;
  coverage: string | null;
  categories: string | null;
  areas: string | null;
  isJournalEligible: boolean;
  identityKey: string;
};

export type ParsedJournalImportRow = {
  rowIndex: number;
  rawText: string | null;
  rawData: Record<string, unknown>;
  normalizedData: NormalizedJournalImportData | null;
  errors: string[];
  warnings: string[];
};

export type ParsedJournalImportResult = {
  detectedFormat: JournalImportSourceSystem;
  sourceYear: number;
  rows: ParsedJournalImportRow[];
};

function stripBom(value: string) {
  return value.replace(/^\uFEFF/, "");
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeNullableText(value: unknown): string | null {
  if (value == null) return null;
  const normalized = normalizeWhitespace(String(value));
  return normalized.length > 0 ? normalized : null;
}

function parseBooleanLabel(value: string | null): boolean | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "yes" || normalized === "y" || normalized === "true") return true;
  if (normalized === "no" || normalized === "n" || normalized === "false") return false;
  return null;
}

function parseNullableFloat(value: string | null): number | null {
  if (!value) return null;
  const normalized = value
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseNullableInt(value: string | null): number | null {
  const parsed = parseNullableFloat(value);
  return parsed == null ? null : Math.round(parsed);
}

function formatIssn(value: string): string {
  const cleaned = value.replace(/[^0-9Xx]/g, "").toUpperCase();
  if (cleaned.length !== 8) return cleaned;
  return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
}

export function normalizeIssnList(value: string | null): {
  issnPrimary: string | null;
  issnList: string[];
  issnNormalizedList: string[];
} {
  if (!value) {
    return { issnPrimary: null, issnList: [], issnNormalizedList: [] };
  }

  const matches = value.match(/[0-9Xx]{4}\s*-?\s*[0-9Xx]{4}/g) ?? [];
  const normalized = [...new Set(matches.map((match) => formatIssn(match)).filter(Boolean))];

  return {
    issnPrimary: normalized[0] ?? null,
    issnList: normalized,
    issnNormalizedList: normalized.map((issn) => issn.replace("-", "")),
  };
}

export function normalizeJournalTitle(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function buildIdentityKey(input: {
  sourceId: string | null;
  issnPrimary: string | null;
  normalizedTitle: string;
}): string {
  if (input.sourceId) {
    return `SRC:${input.sourceId.trim().toUpperCase()}`;
  }
  if (input.issnPrimary) {
    return `ISSN:${input.issnPrimary.replace("-", "")}`;
  }
  return `TITLE:${input.normalizedTitle}`;
}

export function inferYearFromFileName(fileName: string): number | null {
  const match = fileName.match(/(20\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isFinite(year) ? year : null;
}

export function detectJournalImportFormat(
  buffer: Buffer,
  fileName: string,
): JournalImportSourceSystem {
  const text = stripBom(buffer.toString("utf8"));
  const firstLine = text.split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (firstLine.startsWith(SCIMAGO_RAW_HEADER_PREFIX)) {
    return "SCIMAGO_RAW";
  }

  if (fileName.toLowerCase().endsWith(".csv")) {
    const normalizedHeader = firstLine
      .split(/[;,]/)
      .map((part) => part.trim().toLowerCase());
    if (normalizedHeader.includes("source_year") && normalizedHeader.includes("title")) {
      return "TENANT_TEMPLATE";
    }
  }

  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : null;
  const rows = sheet
    ? XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" })
    : [];
  const firstRow = rows[0] ?? {};
  const keys = Object.keys(firstRow).map((key) => key.trim().toLowerCase());
  if (keys.includes("source_year") && keys.includes("title")) {
    return "TENANT_TEMPLATE";
  }

  return "SCIMAGO_RAW";
}

function repairScimagoLine(input: string): string {
  let value = input.trim();
  value = value.replace(/^"(?=\d+;)/, "");

  while (value.includes('""')) {
    value = value.replace(/""/g, '"');
  }

  value = value.replace(/(\d)"\,(\d+)/g, "$1,$2");
  value = value.replace(/(\d),"(\d+)(?=;)/g, "$1,$2");
  value = value.replace(/"(?=,+$)/g, "");

  return value;
}

function parseSemicolonLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"') {
      if (next === '"') {
        current += '"';
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ";" && !inQuotes) {
      out.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  out.push(current.trim());
  while (out.length > SCIMAGO_HEADERS.length && out[out.length - 1] === "") {
    out.pop();
  }

  return out;
}

function mapScimagoColumns(columns: string[]): Record<string, string> {
  const values = [...columns];
  if (values.length > SCIMAGO_HEADERS.length) {
    values.length = SCIMAGO_HEADERS.length;
  }

  while (values.length < SCIMAGO_HEADERS.length) {
    values.push("");
  }

  return Object.fromEntries(
    SCIMAGO_HEADERS.map((header, index) => [header, values[index] ?? ""]),
  );
}

function normalizeRowData(
  raw: Record<string, unknown>,
  sourceYear: number,
): {
  normalized: NormalizedJournalImportData | null;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  const title = normalizeNullableText(raw.Title);
  const type = normalizeNullableText(raw.Type);
  const sourceId = normalizeNullableText(raw.Sourceid);
  const issnRaw = normalizeNullableText(raw.Issn);
  const normalizedTitle = title ? normalizeJournalTitle(title) : "";
  const { issnPrimary, issnList, issnNormalizedList } = normalizeIssnList(issnRaw);

  if (!title) {
    errors.push("Title is required.");
  }
  if (!type) {
    errors.push("Type is required.");
  }
  if (!sourceId && !issnPrimary && !normalizedTitle) {
    errors.push("Row could not be given an identity key.");
  }
  if (!sourceId && !issnPrimary) {
    warnings.push("Row has no source id or ISSN; title fallback identity will be used.");
  }

  if (issnRaw && issnList.length === 0) {
    warnings.push("ISSN field was present but no valid ISSN pattern could be extracted.");
  }

  if (errors.length > 0 || !title || !type) {
    return { normalized: null, errors, warnings };
  }

  const normalized: NormalizedJournalImportData = {
    sourceYear,
    sourceId,
    title,
    normalizedTitle,
    type,
    issnRaw,
    issnPrimary,
    issnList,
    issnNormalizedList,
    publisher: normalizeNullableText(raw.Publisher),
    duplicatePublisher: normalizeNullableText(raw["Publisher Duplicate"]),
    openAccessLabel: normalizeNullableText(raw["Open Access"]),
    isOpenAccess: parseBooleanLabel(normalizeNullableText(raw["Open Access"])),
    openAccessDiamondLabel: normalizeNullableText(raw["Open Access Diamond"]),
    isOpenAccessDiamond: parseBooleanLabel(
      normalizeNullableText(raw["Open Access Diamond"]),
    ),
    sjr: parseNullableFloat(normalizeNullableText(raw.SJR)),
    sjrBestQuartile: normalizeNullableText(raw["SJR Best Quartile"]),
    hIndex: parseNullableInt(normalizeNullableText(raw["H index"])),
    totalDocsCurrent: parseNullableInt(normalizeNullableText(raw["Total Docs. (2024)"])),
    totalDocs3Years: parseNullableInt(normalizeNullableText(raw["Total Docs. (3years)"])),
    totalRefs: parseNullableInt(normalizeNullableText(raw["Total Refs."])),
    totalCitations3Years: parseNullableInt(
      normalizeNullableText(raw["Total Citations (3years)"]),
    ),
    citableDocs3Years: parseNullableInt(
      normalizeNullableText(raw["Citable Docs. (3years)"]),
    ),
    citationsPerDoc2Years: parseNullableFloat(
      normalizeNullableText(raw["Citations / Doc. (2years)"]),
    ),
    refsPerDoc: parseNullableFloat(normalizeNullableText(raw["Ref. / Doc."])),
    femalePercent: parseNullableFloat(normalizeNullableText(raw["%Female"])),
    overton: parseNullableInt(normalizeNullableText(raw.Overton)),
    sdg: parseNullableInt(normalizeNullableText(raw.SDG)),
    country: normalizeNullableText(raw.Country),
    region: normalizeNullableText(raw.Region),
    coverage: normalizeNullableText(raw.Coverage),
    categories: normalizeNullableText(raw.Categories),
    areas: normalizeNullableText(raw.Areas),
    isJournalEligible: type.trim().toLowerCase() === "journal",
    identityKey: buildIdentityKey({
      sourceId,
      issnPrimary,
      normalizedTitle,
    }),
  };

  if (!normalized.isJournalEligible) {
    warnings.push("Source type is not journal; it will be stored but excluded from KPI journal matching.");
  }

  return {
    normalized,
    errors,
    warnings,
  };
}

function parseScimagoRaw(
  buffer: Buffer,
  fileName: string,
  sourceYear?: number,
): ParsedJournalImportResult {
  const text = stripBom(buffer.toString("utf8"));
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);

  const headerLine = lines[0]?.trim() ?? "";
  if (!headerLine.startsWith(SCIMAGO_RAW_HEADER_PREFIX)) {
    throw new Error("The uploaded file does not match the expected SCImago raw export header.");
  }

  const resolvedYear = sourceYear ?? inferYearFromFileName(fileName);
  if (!resolvedYear) {
    throw new Error("Source year is required for SCImago imports.");
  }

  const rows: ParsedJournalImportRow[] = [];

  for (const [index, rawLine] of lines.slice(1).entries()) {
    const repaired = repairScimagoLine(rawLine);
    const parsedColumns = parseSemicolonLine(repaired);
    const rawData = mapScimagoColumns(parsedColumns);
    const { normalized, errors, warnings } = normalizeRowData(rawData, resolvedYear);

    if (parsedColumns.length !== SCIMAGO_HEADERS.length) {
      warnings.push(
        `Expected ${SCIMAGO_HEADERS.length} columns after repair, received ${parsedColumns.length}.`,
      );
    }

    rows.push({
      rowIndex: index + 1,
      rawText: rawLine,
      rawData,
      normalizedData: normalized,
      errors,
      warnings,
    });
  }

  return {
    detectedFormat: "SCIMAGO_RAW",
    sourceYear: resolvedYear,
    rows,
  };
}

function parseTenantTemplate(
  buffer: Buffer,
  fileName: string,
  sourceYear?: number,
): ParsedJournalImportResult {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("The uploaded template is empty.");
  }

  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
  });

  const normalizeHeader = (value: string) =>
    value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_");

  const rows: ParsedJournalImportRow[] = rawRows.map((row, index) => {
    const normalizedMap: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      normalizedMap[normalizeHeader(key)] = value;
    }

    const resolvedYear =
      parseNullableInt(normalizeNullableText(normalizedMap.source_year)) ??
      sourceYear ??
      inferYearFromFileName(fileName);

    const errors: string[] = [];
    if (!resolvedYear) {
      errors.push("source_year is required.");
    }

    const rawData = {
      Rank: "",
      Sourceid: normalizedMap.source_id ?? "",
      Title: normalizedMap.title ?? "",
      Type: normalizedMap.type ?? "",
      Issn: normalizedMap.issn ?? "",
      Publisher: normalizedMap.publisher ?? "",
      "Open Access": normalizedMap.open_access ?? "",
      "Open Access Diamond": normalizedMap.open_access_diamond ?? "",
      SJR: normalizedMap.sjr ?? "",
      "SJR Best Quartile": normalizedMap.sjr_best_quartile ?? "",
      "H index": normalizedMap.h_index ?? "",
      "Total Docs. (2024)": normalizedMap.total_docs_current ?? "",
      "Total Docs. (3years)": normalizedMap.total_docs_3years ?? "",
      "Total Refs.": normalizedMap.total_refs ?? "",
      "Total Citations (3years)": normalizedMap.total_citations_3years ?? "",
      "Citable Docs. (3years)": normalizedMap.citable_docs_3years ?? "",
      "Citations / Doc. (2years)": normalizedMap.citations_per_doc_2years ?? "",
      "Ref. / Doc.": normalizedMap.refs_per_doc ?? "",
      "%Female": normalizedMap.female_percent ?? "",
      Overton: normalizedMap.overton ?? "",
      SDG: normalizedMap.sdg ?? "",
      Country: normalizedMap.country ?? "",
      Region: normalizedMap.region ?? "",
      "Publisher Duplicate": normalizedMap.publisher ?? "",
      Coverage: normalizedMap.coverage ?? "",
      Categories: normalizedMap.categories ?? "",
      Areas: normalizedMap.areas ?? "",
    };

    const normalized =
      resolvedYear != null ? normalizeRowData(rawData, resolvedYear) : {
        normalized: null,
        errors,
        warnings: [] as string[],
      };

    return {
      rowIndex: index + 1,
      rawText: null,
      rawData: normalizedMap,
      normalizedData: normalized.normalized,
      errors: [...errors, ...normalized.errors],
      warnings: normalized.warnings,
    };
  });

  const resolvedYear =
    sourceYear ??
    parseNullableInt(normalizeNullableText(rawRows[0]?.source_year as string | undefined)) ??
    inferYearFromFileName(fileName) ??
    new Date().getUTCFullYear();

  return {
    detectedFormat: "TENANT_TEMPLATE",
    sourceYear: resolvedYear,
    rows,
  };
}

export function parseJournalImportBuffer(input: {
  buffer: Buffer;
  fileName: string;
  sourceYear?: number;
}): ParsedJournalImportResult {
  const detectedFormat = detectJournalImportFormat(input.buffer, input.fileName);

  if (detectedFormat === "TENANT_TEMPLATE") {
    return parseTenantTemplate(input.buffer, input.fileName, input.sourceYear);
  }

  return parseScimagoRaw(input.buffer, input.fileName, input.sourceYear);
}

export function generateJournalTemplateWorkbook(year: number): Buffer {
  const workbook = XLSX.utils.book_new();
  const rows: string[][] = [
    [...JOURNAL_TEMPLATE_HEADERS],
    [
      String(year),
      "28773",
      "Example Journal",
      "journal",
      "1234-5678, 8765-4321",
      "Example Publisher",
      "Yes",
      "No",
      "12.345",
      "Q1",
      "100",
      "20",
      "55",
      "1000",
      "500",
      "50",
      "10.5",
      "20.0",
      "45.2",
      "3",
      "8",
      "India",
      "Southern Asia",
      "2015-2025",
      "Engineering (Q1); Computer Science Applications (Q1)",
      "Computer Science; Engineering",
    ],
  ];

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = JOURNAL_TEMPLATE_HEADERS.map((header) => ({
    wch: Math.max(header.length + 4, 18),
  }));
  XLSX.utils.book_append_sheet(workbook, sheet, "Journals");

  const notes = XLSX.utils.aoa_to_sheet([
    ["Notes"],
    ["Keep the same columns and order as this template."],
    ["source_year, title, and type are required."],
    ["Use ISSN values exactly as available; multiple ISSNs may be comma-separated."],
    ["All other fields are optional for tenant additions or overrides."],
  ]);
  notes["!cols"] = [{ wch: 80 }];
  XLSX.utils.book_append_sheet(workbook, notes, "Instructions");

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
