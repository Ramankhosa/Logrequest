import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { listJournalImportBatches } from "@/lib/journals/service";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.isSuperadmin) {
    return NextResponse.json(
      { status: "error", message: "Superadmin access required." },
      { status: 403 },
    );
  }

  const batches = await listJournalImportBatches({ scope: "GLOBAL" });
  return NextResponse.json(batches);
}
