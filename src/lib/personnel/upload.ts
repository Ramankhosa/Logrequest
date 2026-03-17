import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";

export type ParsedOnboardRow = {
  rowIndex: number;
  firstName: string;
  lastName: string;
  officialEmail: string;
  employeeId: string | null;
  designation: string | null;
  primaryUnitCode: string;
  secondaryUnitCodes: string[];
  roleKeys: string[];
  errors: string[];
  warnings: string[];
};

export type OnboardParseResult = {
  rows: ParsedOnboardRow[];
  validCount: number;
  errorCount: number;
  warningCount: number;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Generate an XLSX template for bulk personnel onboarding.
 *
 * Sheet 1 ("Users") contains header columns and two example rows.
 * Sheet 2 ("Reference") lists available unit codes and role keys.
 */
export function generateOnboardingTemplate(
  units: Array<{
    code: string;
    name: string;
    level: number;
    parentCode: string | null;
  }>,
  roles: Array<{
    roleKey: string;
    displayLabel: string;
    isUnitHead: boolean;
    maxPerUnit: number;
  }>,
): Buffer {
  const workbook = XLSX.utils.book_new();

  // ── Sheet 1: Users ──────────────────────────────────────────────────────────
  const usersHeader = [
    "first_name",
    "last_name",
    "official_email",
    "employee_id",
    "designation",
    "primary_unit_code",
    "secondary_unit_codes",
    "role_keys",
  ];

  const exampleUnit = units[0];
  const exampleRole = roles[0];

  const exampleRows: string[][] = [];
  if (exampleUnit) {
    exampleRows.push([
      "Jane",
      "Doe",
      "jane.doe@example.com",
      "EMP-001",
      "Senior Analyst",
      exampleUnit.code,
      units.length > 1 ? units[1].code : "",
      exampleRole?.roleKey ?? "",
    ]);
    exampleRows.push([
      "John",
      "Smith",
      "john.smith@example.com",
      "EMP-002",
      "Junior Analyst",
      exampleUnit.code,
      "",
      exampleRole?.roleKey ?? "",
    ]);
  }

  const usersData = [usersHeader, ...exampleRows];
  const usersSheet = XLSX.utils.aoa_to_sheet(usersData);

  if (!usersSheet["!ref"]) {
    usersSheet["!ref"] = XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: usersData.length - 1, c: usersHeader.length - 1 },
    });
  }

  // Add a note on the primary_unit_code header cell (F1)
  const f1Ref = "F1";
  if (!usersSheet[f1Ref]) {
    usersSheet[f1Ref] = { t: "s", v: "primary_unit_code" };
  }
  usersSheet[f1Ref].c = [{ a: "System", t: "Use codes from the Reference sheet" }];

  // Set reasonable column widths
  usersSheet["!cols"] = usersHeader.map((h) => ({
    wch: Math.max(h.length + 4, 18),
  }));

  XLSX.utils.book_append_sheet(workbook, usersSheet, "Users");

  // ── Sheet 2: Reference ──────────────────────────────────────────────────────
  const refData: (string | number | boolean | null)[][] = [];

  // Units table
  refData.push(["unit_code", "unit_name", "level", "parent_code"]);
  for (const u of units) {
    refData.push([u.code, u.name, u.level, u.parentCode]);
  }

  // 2 blank rows between tables
  refData.push([]);
  refData.push([]);

  // Roles table
  refData.push(["role_key", "role_label", "is_unit_head", "max_per_unit"]);
  for (const r of roles) {
    refData.push([r.roleKey, r.displayLabel, r.isUnitHead, r.maxPerUnit]);
  }

  const refSheet = XLSX.utils.aoa_to_sheet(refData);
  refSheet["!cols"] = [
    { wch: 20 },
    { wch: 30 },
    { wch: 14 },
    { wch: 14 },
  ];

  XLSX.utils.book_append_sheet(workbook, refSheet, "Reference");

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/**
 * Parse an uploaded Excel/CSV buffer into typed onboarding rows.
 *
 * Expected columns (case-insensitive, flexible separators):
 *   first_name | last_name | official_email | employee_id | designation
 *   primary_unit_code | secondary_unit_codes | role_keys
 */
export function parseOnboardingFile(
  buffer: Buffer,
  fileName: string,
): OnboardParseResult {
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
    if (norm.includes("firstname") || norm === "firstname")
      columnMap[key] = "firstName";
    else if (norm.includes("lastname") || norm === "lastname")
      columnMap[key] = "lastName";
    else if (norm.includes("officialemail") || norm === "email")
      columnMap[key] = "officialEmail";
    else if (norm.includes("employeeid") || norm === "employeeid")
      columnMap[key] = "employeeId";
    else if (norm.includes("designation") || norm === "designation")
      columnMap[key] = "designation";
    else if (norm.includes("primaryunitcode") || norm === "primaryunitcode")
      columnMap[key] = "primaryUnitCode";
    else if (
      norm.includes("secondaryunitcodes") ||
      norm === "secondaryunitcodes"
    )
      columnMap[key] = "secondaryUnitCodes";
    else if (norm.includes("rolekeys") || norm === "rolekeys")
      columnMap[key] = "roleKeys";
  }

  const rows: ParsedOnboardRow[] = [];
  const emailsSeen = new Set<string>();

  for (let i = 0; i < raw.length; i++) {
    const rawRow = raw[i]!;
    const errors: string[] = [];
    const warnings: string[] = [];

    const mapped: Record<string, string> = {};
    for (const [rawKey, field] of Object.entries(columnMap)) {
      mapped[field] = String(rawRow[rawKey] ?? "").trim();
    }

    const firstName = mapped.firstName ?? "";
    const lastName = mapped.lastName ?? "";
    const officialEmail = (mapped.officialEmail ?? "").toLowerCase();
    const employeeId = mapped.employeeId || null;
    const designation = mapped.designation || null;
    const primaryUnitCode = (mapped.primaryUnitCode ?? "").toUpperCase();

    const secondaryUnitCodes = (mapped.secondaryUnitCodes ?? "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    const roleKeys = (mapped.roleKeys ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    // Validation
    if (!firstName || firstName.length < 2)
      errors.push("First name is required (min 2 characters)");
    if (!lastName || lastName.length < 2)
      errors.push("Last name is required (min 2 characters)");

    if (!officialEmail) {
      errors.push("Official email is required");
    } else if (!EMAIL_RE.test(officialEmail)) {
      errors.push("Invalid email format");
    }

    if (!primaryUnitCode) errors.push("Primary unit code is required");

    if (officialEmail && emailsSeen.has(officialEmail)) {
      errors.push(`Duplicate email "${officialEmail}" in file`);
    }
    if (officialEmail) emailsSeen.add(officialEmail);

    rows.push({
      rowIndex: i + 1,
      firstName,
      lastName,
      officialEmail,
      employeeId,
      designation,
      primaryUnitCode,
      secondaryUnitCodes,
      roleKeys,
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
 * Validate parsed onboarding rows against the database for a given tenant.
 *
 * Checks unit codes against the published structure version, role keys against
 * active OrgRoleDefinitions, and email/employeeId uniqueness against existing
 * memberships. Mutates the errors/warnings arrays on each row in-place.
 */
export async function validateOnboardingRows(
  rows: ParsedOnboardRow[],
  tenantId: string,
): Promise<ParsedOnboardRow[]> {
  if (rows.length === 0) return rows;

  // Find the published (active) structure version for this tenant
  const activeVersion = await prisma.orgStructureVersion.findFirst({
    where: { tenantId, state: "PUBLISHED" },
    orderBy: { versionNumber: "desc" },
    select: { id: true },
  });

  // Build lookup sets from the active structure
  const validUnitCodes = new Set<string>();
  if (activeVersion) {
    const units = await prisma.orgUnit.findMany({
      where: { versionId: activeVersion.id, state: { in: ["ACTIVE", "DRAFT"] } },
      select: { code: true },
    });
    for (const u of units) validUnitCodes.add(u.code.toUpperCase());
  }

  // Active role definitions for this tenant
  const roleDefinitions = await prisma.orgRoleDefinition.findMany({
    where: { tenantId, isActive: true },
    select: { roleKey: true },
  });
  const validRoleKeys = new Set(roleDefinitions.map((r) => r.roleKey));

  // Existing active memberships in this tenant (email + employeeId)
  const existingMemberships = await prisma.membership.findMany({
    where: {
      tenantId,
      status: { in: ["INVITED", "PENDING_ACTIVATION", "ACTIVE"] },
    },
    select: {
      user: { select: { officialEmail: true } },
      employeeId: true,
    },
  });

  const existingEmails = new Set(
    existingMemberships.map((m) => m.user.officialEmail.toLowerCase()),
  );
  const existingEmployeeIds = new Set(
    existingMemberships
      .map((m) => m.employeeId)
      .filter((id): id is string => id != null),
  );

  for (const row of rows) {
    // Skip rows that already have parse-level errors on required fields
    if (!activeVersion) {
      row.errors.push("No published org structure found for this tenant");
      continue;
    }

    // Primary unit code
    if (row.primaryUnitCode && !validUnitCodes.has(row.primaryUnitCode)) {
      row.errors.push(
        `Primary unit code "${row.primaryUnitCode}" not found in published structure`,
      );
    }

    // Secondary unit codes
    for (const code of row.secondaryUnitCodes) {
      if (!validUnitCodes.has(code)) {
        row.errors.push(
          `Secondary unit code "${code}" not found in published structure`,
        );
      }
    }

    // Role keys
    for (const key of row.roleKeys) {
      if (!validRoleKeys.has(key)) {
        row.errors.push(
          `Role key "${key}" is not an active role definition for this tenant`,
        );
      }
    }

    // Email uniqueness against existing memberships
    if (row.officialEmail && existingEmails.has(row.officialEmail)) {
      row.errors.push(
        `Email "${row.officialEmail}" already has an active membership in this tenant`,
      );
    }

    // Employee ID uniqueness
    if (row.employeeId && existingEmployeeIds.has(row.employeeId)) {
      row.errors.push(
        `Employee ID "${row.employeeId}" is already in use in this tenant`,
      );
    }
  }

  return rows;
}
