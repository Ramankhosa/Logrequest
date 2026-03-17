import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import {
  parseOnboardingFile,
  validateOnboardingRows,
} from "@/lib/personnel/upload";
import { onboardMember } from "@/lib/personnel/service";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.tenantId || !session.user.role) {
    return NextResponse.json(
      { status: "error", message: "You do not have tenant access." },
      { status: 403 },
    );
  }

  if (
    session.user.role !== Role.TENANT_OWNER &&
    session.user.role !== Role.TENANT_ADMIN
  ) {
    return NextResponse.json(
      { status: "error", message: "You do not have permission to bulk onboard." },
      { status: 403 },
    );
  }

  const tenantId = session.user.tenantId;
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("mode") ?? "validate";

  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json(
      { status: "error", message: "No file provided." },
      { status: 400 },
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const parsed = parseOnboardingFile(buffer, file.name);
  await validateOnboardingRows(parsed.rows, tenantId);

  parsed.validCount = parsed.rows.filter((r) => r.errors.length === 0).length;
  parsed.errorCount = parsed.rows.filter((r) => r.errors.length > 0).length;
  parsed.warningCount = parsed.rows.filter((r) => r.warnings.length > 0).length;

  if (mode === "validate") {
    return NextResponse.json({
      status: "success",
      message: `Parsed ${parsed.rows.length} row(s): ${parsed.validCount} valid, ${parsed.errorCount} errors, ${parsed.warningCount} warnings.`,
      data: parsed,
    });
  }

  // mode === "provision"
  const validRows = parsed.rows.filter((r) => r.errors.length === 0);

  if (validRows.length === 0) {
    return NextResponse.json(
      {
        status: "error",
        message: "No valid rows to provision. Fix errors and try again.",
        data: parsed,
      },
      { status: 400 },
    );
  }

  let provisioned = 0;
  let failed = 0;
  const errors: Array<{ rowIndex: number; email: string; message: string }> = [];

  for (const row of validRows) {
    const result = await onboardMember({
      tenantId,
      actorUserId: session.user.id,
      actorRole: session.user.role as Role,
      values: {
        firstName: row.firstName,
        lastName: row.lastName,
        officialEmail: row.officialEmail,
        employeeId: row.employeeId ?? undefined,
        designation: row.designation ?? undefined,
        primaryUnitCode: row.primaryUnitCode,
        secondaryUnitCodes: row.secondaryUnitCodes,
        roleKeys: row.roleKeys,
      },
    });

    if (result.status === "success") {
      provisioned++;
    } else {
      failed++;
      errors.push({
        rowIndex: row.rowIndex,
        email: row.officialEmail,
        message: result.message,
      });
    }
  }

  return NextResponse.json({
    status: failed === 0 ? "success" : "partial",
    message: `Provisioned ${provisioned} of ${validRows.length} member(s).${failed > 0 ? ` ${failed} failed.` : ""}`,
    totalRows: parsed.rows.length,
    provisioned,
    failed,
    errors,
  });
}
