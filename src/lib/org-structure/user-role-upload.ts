import * as XLSX from "xlsx";

export type ParsedUserRoleRow = {
  rowIndex: number;
  email: string;
  firstName: string;
  lastName: string;
  employeeId: string;
  unitCode: string;
  roleKey: string;
  errors: string[];
  warnings: string[];
};

export type UserRoleParseResult = {
  rows: ParsedUserRoleRow[];
  validCount: number;
  errorCount: number;
  warningCount: number;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMPLOYEE_ID_RE = /^[A-Z0-9_-]{1,50}$/i;

/**
 * Parse a CSV or Excel file for user+role import.
 *
 * Expected columns (case-insensitive, underscores/spaces flexible):
 *   email | first_name | last_name | employee_id | unit_code | role_key
 *
 * Edge cases handled:
 *   - Missing or malformed emails
 *   - Duplicate email+unitCode+roleKey within the file (warns, doesn't error)
 *   - Empty rows (skipped)
 *   - Leading/trailing whitespace (trimmed)
 *   - Case normalization (email lowercase, employee_id/unit_code/role_key uppercase)
 */
export function parseUserRoleFile(
  buffer: Buffer,
  fileName: string,
): UserRoleParseResult {
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

  const normalize = (s: string) => s.toLowerCase().replace(/[\s_-]/g, "");

  const columnMap: Record<string, string> = {};
  const firstRow = raw[0]!;
  for (const key of Object.keys(firstRow)) {
    const norm = normalize(key);
    if (norm === "email" || norm === "emailaddress" || norm === "officialemail")
      columnMap[key] = "email";
    else if (norm === "firstname" || norm === "first")
      columnMap[key] = "firstName";
    else if (norm === "lastname" || norm === "last" || norm === "surname")
      columnMap[key] = "lastName";
    else if (
      norm === "employeeid" ||
      norm === "empid" ||
      norm === "employeecode"
    )
      columnMap[key] = "employeeId";
    else if (norm === "unitcode" || norm === "unit" || norm === "orgunit")
      columnMap[key] = "unitCode";
    else if (norm === "rolekey" || norm === "role" || norm === "rolename")
      columnMap[key] = "roleKey";
  }

  // Check all required columns are mapped
  const required = ["email", "firstName", "lastName", "unitCode", "roleKey"];
  const missingColumns = required.filter(
    (col) => !Object.values(columnMap).includes(col),
  );

  if (missingColumns.length > 0) {
    return {
      rows: [
        {
          rowIndex: 0,
          email: "",
          firstName: "",
          lastName: "",
          employeeId: "",
          unitCode: "",
          roleKey: "",
          errors: [
            `Missing required column(s): ${missingColumns.join(", ")}. Expected: email, first_name, last_name, unit_code, role_key`,
          ],
          warnings: [],
        },
      ],
      validCount: 0,
      errorCount: 1,
      warningCount: 0,
    };
  }

  const rows: ParsedUserRoleRow[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < raw.length; i++) {
    const rawRow = raw[i]!;
    const errors: string[] = [];
    const warnings: string[] = [];

    const mapped: Record<string, string> = {};
    for (const [rawKey, field] of Object.entries(columnMap)) {
      mapped[field] = String(rawRow[rawKey] ?? "").trim();
    }

    const email = (mapped.email ?? "").toLowerCase();
    const firstName = mapped.firstName ?? "";
    const lastName = mapped.lastName ?? "";
    const employeeId = (mapped.employeeId ?? "").toUpperCase();
    const unitCode = (mapped.unitCode ?? "").toUpperCase();
    const roleKey = (mapped.roleKey ?? "").toUpperCase();

    // Skip completely empty rows
    if (!email && !firstName && !lastName && !unitCode && !roleKey) continue;

    // Validate
    if (!email) {
      errors.push("Missing email");
    } else if (!EMAIL_RE.test(email)) {
      errors.push("Invalid email format");
    }

    if (!firstName || firstName.length < 1) {
      errors.push("Missing first_name");
    }

    if (!lastName || lastName.length < 1) {
      errors.push("Missing last_name");
    }

    if (!unitCode) {
      errors.push("Missing unit_code");
    }

    if (!roleKey) {
      errors.push("Missing role_key");
    }

    if (employeeId && !EMPLOYEE_ID_RE.test(employeeId)) {
      warnings.push("Employee ID has unusual characters");
    }

    // Duplicate within file
    const dedupeKey = `${email}|${unitCode}|${roleKey}`;
    if (seen.has(dedupeKey)) {
      warnings.push(
        `Duplicate: same email+unit+role already appears in an earlier row`,
      );
    }
    seen.add(dedupeKey);

    rows.push({
      rowIndex: i + 1,
      email,
      firstName,
      lastName,
      employeeId,
      unitCode,
      roleKey,
      errors,
      warnings,
    });
  }

  return {
    rows,
    validCount: rows.filter((r) => r.errors.length === 0).length,
    errorCount: rows.filter((r) => r.errors.length > 0).length,
    warningCount: rows.filter((r) => r.warnings.length > 0).length,
  };
}

/**
 * Generate a CSV template for user+role import.
 */
export function generateUserRoleTemplate(
  roleKeys: string[],
  unitCodes: string[],
): string {
  const header = "email,first_name,last_name,employee_id,unit_code,role_key";
  const comments = [
    `# Available role_key values: ${roleKeys.length ? roleKeys.join(", ") : "(define roles first)"}`,
    `# Available unit_code values: ${unitCodes.length ? unitCodes.slice(0, 10).join(", ") : "(create structure first)"}${unitCodes.length > 10 ? ` ... and ${unitCodes.length - 10} more` : ""}`,
  ].join("\n");

  const example =
    roleKeys.length && unitCodes.length
      ? `user@example.com,John,Smith,EMP001,${unitCodes[0]},${roleKeys[0]}`
      : "vc@university.edu,James,Wilson,EMP001,UNIV,VICE_CHANCELLOR";

  return `${comments}\n${header}\n${example}\n`;
}
