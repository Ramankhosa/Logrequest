import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { parseUserRoleFile } from "@/lib/org-structure/user-role-upload";
import { prisma } from "@/lib/prisma";
import { bulkAssignRoles } from "@/lib/org-structure/roles-service";

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
      { status: "error", message: "You do not have permission to import users." },
      { status: 403 },
    );
  }

  const tenantId = session.user.tenantId;
  const actorUserId = session.user.id;
  const actorRole = session.user.role as Role;

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const action = formData.get("action") as string | null;

  if (!file) {
    return NextResponse.json(
      { status: "error", message: "No file provided." },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const parseResult = parseUserRoleFile(buffer, file.name);

  if (action === "preview") {
    // Also validate unit_codes and role_keys against existing data
    const activeVersion = await prisma.orgStructureVersion.findFirst({
      where: { tenantId, state: { in: ["DRAFT", "VALIDATED", "PUBLISHED"] } },
      orderBy: { versionNumber: "desc" },
      select: { id: true },
    });

    if (activeVersion) {
      const unitCodes = new Set(
        (
          await prisma.orgUnit.findMany({
            where: { versionId: activeVersion.id },
            select: { code: true },
          })
        ).map((u) => u.code),
      );

      const roleKeys = new Set(
        (
          await prisma.orgRoleDefinition.findMany({
            where: { tenantId, isActive: true },
            select: { roleKey: true },
          })
        ).map((r) => r.roleKey),
      );

      for (const row of parseResult.rows) {
        if (row.errors.length > 0) continue;

        if (row.unitCode && !unitCodes.has(row.unitCode)) {
          row.errors.push(`Unit code "${row.unitCode}" not found in structure`);
        }

        if (row.roleKey && !roleKeys.has(row.roleKey)) {
          row.errors.push(`Role key "${row.roleKey}" not found in definitions`);
        }
      }

      // Recount after server-side validation
      parseResult.validCount = parseResult.rows.filter(
        (r) => r.errors.length === 0,
      ).length;
      parseResult.errorCount = parseResult.rows.filter(
        (r) => r.errors.length > 0,
      ).length;
    }

    return NextResponse.json({ status: "success", data: parseResult });
  }

  if (action === "confirm") {
    const validRows = parseResult.rows.filter((r) => r.errors.length === 0);

    if (validRows.length === 0) {
      return NextResponse.json(
        { status: "error", message: "No valid rows to import." },
        { status: 400 },
      );
    }

    // Step 1: Create/find users and memberships
    const userIds = new Map<string, string>(); // email -> userId

    for (const row of validRows) {
      if (userIds.has(row.email)) continue;

      let user = await prisma.user.findUnique({
        where: { officialEmail: row.email },
        select: { id: true },
      });

      if (!user) {
        user = await prisma.user.create({
          data: {
            officialEmail: row.email,
            firstName: row.firstName,
            lastName: row.lastName,
            lifecycleState: "INVITED",
          },
          select: { id: true },
        });
      }

      userIds.set(row.email, user.id);

      // Ensure membership exists
      const existingMembership = await prisma.membership.findUnique({
        where: {
          tenantId_userId: { tenantId, userId: user.id },
        },
      });

      if (!existingMembership) {
        await prisma.membership.create({
          data: {
            tenantId,
            userId: user.id,
            role: "TENANT_USER",
            status: "INVITED",
            invitationState: "PENDING",
            employeeId: row.employeeId || null,
            createdByUserId: actorUserId,
          },
        });
      } else if (row.employeeId && !existingMembership.employeeId) {
        // Backfill employeeId if not set
        await prisma.membership.update({
          where: { id: existingMembership.id },
          data: { employeeId: row.employeeId },
        });
      }
    }

    // Step 2: Bulk assign roles
    const assignments = validRows.map((row) => ({
      userId: userIds.get(row.email)!,
      unitCode: row.unitCode,
      roleKey: row.roleKey,
    }));

    const result = await bulkAssignRoles({
      tenantId,
      actorUserId,
      actorRole,
      assignments,
    });

    // Log the import batch
    await prisma.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "UserRoleImport",
        targetId: tenantId,
        action: "user_role.bulk_import",
        newState: {
          totalRows: parseResult.rows.length,
          validRows: validRows.length,
          ...result.details,
        },
      },
    });

    return NextResponse.json(result, {
      status: result.status === "success" ? 200 : 400,
    });
  }

  return NextResponse.json(
    { status: "error", message: "Invalid action. Use 'preview' or 'confirm'." },
    { status: 400 },
  );
}
