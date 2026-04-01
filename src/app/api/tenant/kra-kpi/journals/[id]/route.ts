import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { getJournalActionHttpStatus } from "@/lib/journals/http";
import {
  getJournalCatalogRecord,
  updateJournalCatalogRecord,
} from "@/lib/journals/service";
import type { JournalUpdateInput } from "@/lib/journals/shared";

export async function GET(
  _request: Request,
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

  const { id } = await params;
  const record = await getJournalCatalogRecord(id, {
    scope: "TENANT",
    tenantId: session.user.tenantId,
  });

  if (!record) {
    return NextResponse.json(
      { status: "error", message: "Journal record not found." },
      { status: 404 },
    );
  }

  return NextResponse.json(record);
}

export async function PATCH(
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

  let body: JournalUpdateInput;
  try {
    body = (await request.json()) as JournalUpdateInput;
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid request body." },
      { status: 400 },
    );
  }

  const { id } = await params;
  const result = await updateJournalCatalogRecord({
    recordId: id,
    scope: "TENANT",
    tenantId: session.user.tenantId,
    values: body,
    actorUserId: session.user.id,
    actorRole: session.user.role as Role,
  });

  return NextResponse.json(result, {
    status: getJournalActionHttpStatus(result),
  });
}
