import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { parseJournalListFilters } from "@/lib/journals/http";
import { listJournalCatalogRecords } from "@/lib/journals/service";

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
      { status: "error", message: "You do not have permission to manage journals." },
      { status: 403 },
    );
  }

  try {
    const url = new URL(request.url);
    const data = await listJournalCatalogRecords(
      { scope: "TENANT", tenantId: session.user.tenantId },
      parseJournalListFilters(url.searchParams),
    );

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        message: error instanceof Error ? error.message : "Invalid journal query.",
      },
      { status: 400 },
    );
  }
}
