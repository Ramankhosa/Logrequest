import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { getJournalActionHttpStatus } from "@/lib/journals/http";
import { archiveJournalCatalogRecord } from "@/lib/journals/service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.isSuperadmin) {
    return NextResponse.json(
      { status: "error", message: "Superadmin access required." },
      { status: 403 },
    );
  }

  let reason: string | null = null;
  try {
    const body = (await request.json()) as { reason?: string | null };
    reason = body.reason ?? null;
  } catch {
    reason = null;
  }

  const { id } = await params;
  const result = await archiveJournalCatalogRecord({
    recordId: id,
    scope: "GLOBAL",
    actorUserId: session.user.id,
    actorRole: Role.SUPERADMIN,
    reason,
  });

  return NextResponse.json(result, {
    status: getJournalActionHttpStatus(result),
  });
}
