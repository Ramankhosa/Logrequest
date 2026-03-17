import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { prisma } from "@/lib/prisma";
import { generateCsvTemplate } from "@/lib/org-structure/upload";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.tenantId) {
    return NextResponse.json(
      { status: "error", message: "You do not have tenant access." },
      { status: 403 },
    );
  }

  // Get current draft unit types to include in template
  const draft = await prisma.orgStructureVersion.findFirst({
    where: {
      tenantId: session.user.tenantId,
      state: { in: ["DRAFT", "VALIDATED"] },
    },
    orderBy: { versionNumber: "desc" },
    include: { unitTypes: { select: { typeKey: true } } },
  });

  const typeKeys = draft?.unitTypes.map((t) => t.typeKey) ?? [];
  const csv = generateCsvTemplate(typeKeys);

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": 'attachment; filename="org-structure-template.csv"',
    },
  });
}
