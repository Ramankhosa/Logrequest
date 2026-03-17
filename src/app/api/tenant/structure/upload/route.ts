import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { parseStructureFile } from "@/lib/org-structure/upload";
import { bulkCreateUnits } from "@/lib/org-structure/service";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/tenant/structure/upload
 *
 * Accepts multipart form data with a file field "file".
 * Two modes:
 *   - action=preview (default): Parse and return validation results
 *   - action=confirm: Parse and immediately import valid rows
 */
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
      { status: "error", message: "You do not have permission to manage structure." },
      { status: 403 },
    );
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const action = (formData.get("action") as string) ?? "preview";

  if (!file) {
    return NextResponse.json(
      { status: "error", message: "No file provided." },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const parseResult = parseStructureFile(buffer, file.name);

  const activeDraft = await prisma.orgStructureVersion.findFirst({
    where: {
      tenantId: session.user.tenantId,
      state: {
        in: ["DRAFT", "VALIDATED"],
      },
    },
    orderBy: {
      versionNumber: "desc",
    },
    select: { id: true },
  });

  if (activeDraft) {
    const typeKeys = new Set(
      (
        await prisma.orgUnitType.findMany({
          where: { versionId: activeDraft.id },
          select: { typeKey: true },
        })
      ).map((type) => type.typeKey),
    );

    for (const row of parseResult.rows) {
      if (row.errors.length > 0) continue;
      if (row.typeKey && !typeKeys.has(row.typeKey)) {
        row.errors.push(`Unit type "${row.typeKey}" not found in draft`);
      }
    }

    parseResult.validCount = parseResult.rows.filter((r) => r.errors.length === 0).length;
    parseResult.errorCount = parseResult.rows.filter((r) => r.errors.length > 0).length;
  }

  if (action === "preview") {
    return NextResponse.json({
      status: "success",
      message: `Parsed ${parseResult.rows.length} row(s): ${parseResult.validCount} valid, ${parseResult.errorCount} errors, ${parseResult.warningCount} warnings.`,
      data: parseResult,
    });
  }

  // action === "confirm" — import valid rows
  const validRows = parseResult.rows.filter((r) => r.errors.length === 0);

  if (validRows.length === 0) {
    return NextResponse.json(
      {
        status: "error",
        message: "No valid rows to import. Fix errors and try again.",
        data: parseResult,
      },
      { status: 400 },
    );
  }

  const result = await bulkCreateUnits({
    tenantId: session.user.tenantId,
    actorUserId: session.user.id,
    actorRole: session.user.role as Role,
    rows: validRows.map((r) => ({
      typeKey: r.typeKey,
      code: r.code,
      name: r.name,
      parentCode: r.parentCode,
    })),
  });

  return NextResponse.json(result, {
    status: result.status === "success" ? 200 : 400,
  });
}
