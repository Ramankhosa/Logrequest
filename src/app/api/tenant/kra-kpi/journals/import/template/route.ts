import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { generateJournalTemplateWorkbook } from "@/lib/journals/parser";

export async function GET(request: Request) {
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
      { status: "error", message: "You do not have permission to download journal templates." },
      { status: 403 },
    );
  }

  const url = new URL(request.url);
  const yearParam = url.searchParams.get("sourceYear");
  const year =
    yearParam && Number.isFinite(Number(yearParam))
      ? Number(yearParam)
      : new Date().getUTCFullYear();
  const buffer = generateJournalTemplateWorkbook(year);

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="journal-template-${year}.xlsx"`,
    },
  });
}
