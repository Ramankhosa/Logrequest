import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import {
  initiateTransfer,
  listTransfers,
} from "@/lib/personnel/transfer-service";

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
      { status: "error", message: "Permission denied." },
      { status: 403 },
    );
  }

  const { searchParams } = new URL(request.url);
  const transfers = await listTransfers(session.user.tenantId, {
    status:
      (searchParams.get("status") as
        | "PROPOSED"
        | "APPROVED"
        | "IN_PROGRESS"
        | "COMPLETED"
        | "CANCELLED"
        | "REJECTED"
        | null) ?? undefined,
    sourceUnitId: searchParams.get("sourceUnitId") ?? undefined,
    targetUnitId: searchParams.get("targetUnitId") ?? undefined,
    membershipId: searchParams.get("membershipId") ?? undefined,
  });

  return NextResponse.json(transfers);
}

export async function POST(request: Request) {
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
      { status: "error", message: "Permission denied." },
      { status: 403 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid request body." },
      { status: 400 },
    );
  }

  const result = await initiateTransfer({
    tenantId: session.user.tenantId,
    actorUserId: session.user.id,
    actorRole: session.user.role as Role,
    values: body as never,
  });

  return NextResponse.json(result, {
    status: result.status === "success" ? 200 : 400,
  });
}
