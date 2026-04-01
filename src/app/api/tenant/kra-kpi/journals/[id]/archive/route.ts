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
    scope: "TENANT",
    tenantId: session.user.tenantId,
    actorUserId: session.user.id,
    actorRole: session.user.role as Role,
    reason,
  });

  return NextResponse.json(result, {
    status: getJournalActionHttpStatus(result),
  });
}
