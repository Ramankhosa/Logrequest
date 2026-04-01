import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { listJournalImportBatches } from "@/lib/journals/service";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.tenantId || !session.user.role) {
    return NextResponse.json(
      { status: "error", message: "You do not have tenant access." },
      { status: 403 },
    );
  }

  const batches = await listJournalImportBatches({
    scope: "TENANT",
    tenantId: session.user.tenantId,
  });

  return NextResponse.json(batches);
}
