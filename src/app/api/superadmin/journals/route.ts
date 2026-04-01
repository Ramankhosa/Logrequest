import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { parseJournalListFilters } from "@/lib/journals/http";
import { listJournalCatalogRecords } from "@/lib/journals/service";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.isSuperadmin) {
    return NextResponse.json(
      { status: "error", message: "Superadmin access required." },
      { status: 403 },
    );
  }

  try {
    const url = new URL(request.url);
    const data = await listJournalCatalogRecords(
      { scope: "GLOBAL" },
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
