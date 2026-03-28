import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import {
  approveTransfer,
  cancelTransfer,
  configureTransferPortability,
  getTransferWithDetails,
  rejectTransfer,
} from "@/lib/personnel/transfer-service";

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
      { status: "error", message: "Permission denied." },
      { status: 403 },
    );
  }

  const { id } = await params;
  const transfer = await getTransferWithDetails(session.user.tenantId, id);
  if (!transfer) {
    return NextResponse.json(
      { status: "error", message: "Transfer not found." },
      { status: 404 },
    );
  }

  return NextResponse.json(transfer);
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
      { status: "error", message: "Permission denied." },
      { status: 403 },
    );
  }

  const { id } = await params;

  let body: Record<string, unknown> & { action?: string };
  try {
    body = (await request.json()) as Record<string, unknown> & { action?: string };
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid request body." },
      { status: 400 },
    );
  }

  let result;
  switch (body.action) {
    case "approve":
      result = await approveTransfer({
        tenantId: session.user.tenantId,
        actorUserId: session.user.id,
        actorRole: session.user.role as Role,
        transferId: id,
      });
      break;
    case "reject":
      result = await rejectTransfer({
        tenantId: session.user.tenantId,
        actorUserId: session.user.id,
        actorRole: session.user.role as Role,
        transferId: id,
        reason: typeof body.reason === "string" ? body.reason : undefined,
      });
      break;
    case "cancel":
      result = await cancelTransfer({
        tenantId: session.user.tenantId,
        actorUserId: session.user.id,
        actorRole: session.user.role as Role,
        transferId: id,
        reason: typeof body.reason === "string" ? body.reason : undefined,
      });
      break;
    case "configure":
      result = await configureTransferPortability({
        tenantId: session.user.tenantId,
        actorUserId: session.user.id,
        actorRole: session.user.role as Role,
        transferId: id,
        values: body as never,
      });
      break;
    default:
      return NextResponse.json(
        { status: "error", message: "Unsupported transfer action." },
        { status: 400 },
      );
  }

  return NextResponse.json(result, {
    status: result.status === "success" ? 200 : 400,
  });
}
