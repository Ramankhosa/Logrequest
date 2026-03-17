import * as XLSX from "xlsx";
import {
  generateCsvTemplate,
  parseStructureFile,
} from "@/lib/org-structure/upload";

function csvBuffer(lines: string[]) {
  return Buffer.from(lines.join("\n"), "utf8");
}

function xlsxBuffer(rows: Array<Record<string, string>>) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
  return Buffer.from(
    XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer,
  );
}

describe("parseStructureFile", () => {
  test("parses valid CSV rows", () => {
    const buffer = csvBuffer([
      "type_key,unit_code,unit_name,parent_code",
      "ORG_ROOT,UNIV,University,",
      "DEPT,CSE,Computer Science,UNIV",
    ]);

    const result = parseStructureFile(buffer, "structure.csv");

    expect(result.validCount).toBe(2);
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(0);
    expect(result.rows[1]?.parentCode).toBe("UNIV");
  });

  test("returns row validation errors when required columns are missing", () => {
    const buffer = csvBuffer([
      "type_key,unit_code,parent_code",
      "ORG_ROOT,UNIV,",
    ]);

    const result = parseStructureFile(buffer, "missing-columns.csv");

    expect(result.errorCount).toBe(1);
    expect(result.rows[0]?.errors).toContain(
      "Name must be at least 2 characters",
    );
  });

  test("flags duplicate unit codes", () => {
    const buffer = csvBuffer([
      "type_key,unit_code,unit_name,parent_code",
      "ORG_ROOT,UNIV,University,",
      "DEPT,UNIV,Duplicate University,",
    ]);

    const result = parseStructureFile(buffer, "duplicate.csv");

    expect(result.errorCount).toBe(1);
    expect(result.rows[1]?.errors.join(" ")).toContain('Duplicate code "UNIV"');
  });

  test("flags invalid unit code format", () => {
    const buffer = csvBuffer([
      "type_key,unit_code,unit_name,parent_code",
      "ORG_ROOT,A,University,",
      "DEPT,B@D,Computer Science,A",
    ]);

    const result = parseStructureFile(buffer, "invalid-code.csv");

    expect(result.rows[0]?.errors.join(" ")).toContain("Invalid code format");
    expect(result.rows[1]?.errors.join(" ")).toContain("Invalid code format");
  });

  test("marks second root as an error", () => {
    const buffer = csvBuffer([
      "type_key,unit_code,unit_name,parent_code",
      "ORG_ROOT,UNIV,University,",
      "SCHOOL,SCH,School,",
    ]);

    const result = parseStructureFile(buffer, "multiple-root.csv");

    expect(result.rows[1]?.errors).toContain(
      "Multiple root units (empty parent_code) found",
    );
  });

  test("warns when parent code is not found in file", () => {
    const buffer = csvBuffer([
      "type_key,unit_code,unit_name,parent_code",
      "DEPT,CSE,Computer Science,UNKNOWN",
    ]);

    const result = parseStructureFile(buffer, "missing-parent.csv");

    expect(result.warningCount).toBe(1);
    expect(result.rows[0]?.warnings[0]).toContain('Parent "UNKNOWN" not found');
  });

  test("parses XLSX format", () => {
    const buffer = xlsxBuffer([
      {
        type_key: "ORG_ROOT",
        unit_code: "UNIV",
        unit_name: "University",
        parent_code: "",
      },
    ]);

    const result = parseStructureFile(buffer, "structure.xlsx");

    expect(result.validCount).toBe(1);
    expect(result.errorCount).toBe(0);
  });

  test("matches mixed-case headers", () => {
    const buffer = csvBuffer([
      "Type_Key,UNIT_CODE,Unit_Name,Parent_Code",
      "ORG_ROOT,UNIV,University,",
    ]);

    const result = parseStructureFile(buffer, "mixed-header.csv");

    expect(result.validCount).toBe(1);
    expect(result.errorCount).toBe(0);
    expect(result.rows[0]?.typeKey).toBe("ORG_ROOT");
  });
});

describe("generateCsvTemplate", () => {
  test("includes header and available type keys", () => {
    const template = generateCsvTemplate(["ORG_ROOT", "DEPT"]);

    expect(template).toContain("type_key,unit_code,unit_name,parent_code");
    expect(template).toContain("ORG_ROOT");
    expect(template).toContain("DEPT");
  });
});

