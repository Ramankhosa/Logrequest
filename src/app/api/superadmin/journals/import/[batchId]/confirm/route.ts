import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { getJournalActionHttpStatus } from "@/lib/journals/http";
import { confirmJournalImportBatch } from "@/lib/journals/service";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.isSuperadmin) {
    return NextResponse.json(
      { status: "error", message: "Superadmin access required." },
      { status: 403 },
    );
  }

  const { batchId } = await params;
  const result = await confirmJournalImportBatch({
    batchId,
    scope: "GLOBAL",
    actorUserId: session.user.id,
    actorRole: Role.SUPERADMIN,
  });

  return NextResponse.json(result, {
    status: getJournalActionHttpStatus(result),
  });
}
