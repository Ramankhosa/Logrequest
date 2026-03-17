import * as XLSX from "xlsx";
import {
  generateUserRoleTemplate,
  parseUserRoleFile,
} from "@/lib/org-structure/user-role-upload";

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

describe("parseUserRoleFile", () => {
  test("parses valid CSV rows", () => {
    const buffer = csvBuffer([
      "email,first_name,last_name,employee_id,unit_code,role_key",
      "alice@example.com,Alice,Walker,EMP001,CSE,DEPT_HEAD",
    ]);

    const result = parseUserRoleFile(buffer, "users.csv");

    expect(result.validCount).toBe(1);
    expect(result.errorCount).toBe(0);
    expect(result.rows[0]?.email).toBe("alice@example.com");
    expect(result.rows[0]?.roleKey).toBe("DEPT_HEAD");
  });

  test("fails when required columns are missing", () => {
    const buffer = csvBuffer([
      "first_name,last_name,employee_id,unit_code,role_key",
      "Alice,Walker,EMP001,CSE,DEPT_HEAD",
    ]);

    const result = parseUserRoleFile(buffer, "missing-email.csv");

    expect(result.errorCount).toBe(1);
    expect(result.rows[0]?.errors[0]).toContain("Missing required column(s)");
  });

  test("flags invalid email format", () => {
    const buffer = csvBuffer([
      "email,first_name,last_name,employee_id,unit_code,role_key",
      "invalid-email,Alice,Walker,EMP001,CSE,DEPT_HEAD",
    ]);

    const result = parseUserRoleFile(buffer, "invalid-email.csv");

    expect(result.errorCount).toBe(1);
    expect(result.rows[0]?.errors).toContain("Invalid email format");
  });

  test("flags missing first and last name", () => {
    const buffer = csvBuffer([
      "email,first_name,last_name,employee_id,unit_code,role_key",
      "alice@example.com,,,EMP001,CSE,DEPT_HEAD",
    ]);

    const result = parseUserRoleFile(buffer, "missing-name.csv");

    expect(result.rows[0]?.errors).toContain("Missing first_name");
    expect(result.rows[0]?.errors).toContain("Missing last_name");
  });

  test("warns on duplicate email+unit+role rows", () => {
    const buffer = csvBuffer([
      "email,first_name,last_name,employee_id,unit_code,role_key",
      "alice@example.com,Alice,Walker,EMP001,CSE,DEPT_HEAD",
      "alice@example.com,Alice,Walker,EMP001,CSE,DEPT_HEAD",
    ]);

    const result = parseUserRoleFile(buffer, "duplicates.csv");

    expect(result.rows[1]?.warnings.join(" ")).toContain("Duplicate");
  });

  test("skips fully empty rows", () => {
    const buffer = csvBuffer([
      "email,first_name,last_name,employee_id,unit_code,role_key",
      ",,,,,",
      "alice@example.com,Alice,Walker,EMP001,CSE,DEPT_HEAD",
    ]);

    const result = parseUserRoleFile(buffer, "empty-rows.csv");

    expect(result.rows).toHaveLength(1);
    expect(result.validCount).toBe(1);
  });

  test("matches flexible column names", () => {
    const buffer = csvBuffer([
      "Email Address,First Name,Last Name,Employee Code,Org Unit,Role",
      "alice@example.com,Alice,Walker,EMP001,CSE,DEPT_HEAD",
    ]);

    const result = parseUserRoleFile(buffer, "flex-columns.csv");

    expect(result.validCount).toBe(1);
    expect(result.errorCount).toBe(0);
    expect(result.rows[0]?.unitCode).toBe("CSE");
  });

  test("parses XLSX format", () => {
    const buffer = xlsxBuffer([
      {
        email: "alice@example.com",
        first_name: "Alice",
        last_name: "Walker",
        employee_id: "EMP001",
        unit_code: "CSE",
        role_key: "DEPT_HEAD",
      },
    ]);

    const result = parseUserRoleFile(buffer, "users.xlsx");

    expect(result.validCount).toBe(1);
    expect(result.errorCount).toBe(0);
  });
});

describe("generateUserRoleTemplate", () => {
  test("includes required header and available keys", () => {
    const template = generateUserRoleTemplate(
      ["DEPT_HEAD", "DEAN"],
      ["UNIV", "CSE"],
    );

    expect(template).toContain(
      "email,first_name,last_name,employee_id,unit_code,role_key",
    );
    expect(template).toContain("DEPT_HEAD");
    expect(template).toContain("UNIV");
  });
});

