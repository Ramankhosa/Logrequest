import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { prisma } from "@/lib/prisma";
import { generateUserRoleTemplate } from "@/lib/org-structure/user-role-upload";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.tenantId) {
    return NextResponse.json(
      { status: "error", message: "You do not have tenant access." },
      { status: 403 },
    );
  }

  const tenantId = session.user.tenantId;

  const [roleDefs, activeVersion] = await Promise.all([
    prisma.orgRoleDefinition.findMany({
      where: { tenantId, isActive: true },
      select: { roleKey: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.orgStructureVersion.findFirst({
      where: { tenantId, state: { in: ["DRAFT", "VALIDATED", "PUBLISHED"] } },
      orderBy: { versionNumber: "desc" },
      select: { id: true },
    }),
  ]);

  let unitCodes: string[] = [];
  if (activeVersion) {
    const units = await prisma.orgUnit.findMany({
      where: { versionId: activeVersion.id, state: { not: "INACTIVE" } },
      select: { code: true },
      orderBy: [{ level: "asc" }, { name: "asc" }],
    });
    unitCodes = units.map((u) => u.code);
  }

  const csv = generateUserRoleTemplate(
    roleDefs.map((r) => r.roleKey),
    unitCodes,
  );

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": "attachment; filename=user-role-import-template.csv",
    },
  });
}
