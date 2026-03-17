import { type PersonnelStatus, Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import {
  getUserPlacementSummary,
  updatePersonnelStatus,
} from "@/lib/personnel/service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ membershipId: string }> },
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.tenantId || !session.user.role) {
    return NextResponse.json(
      { status: "error", message: "You do not have tenant access." },
      { status: 403 },
    );
  }

  const { membershipId } = await params;

  const summary = await getUserPlacementSummary(
    session.user.tenantId,
    membershipId,
  );

  if (!summary) {
    return NextResponse.json(
      { status: "error", message: "Personnel record not found." },
      { status: 404 },
    );
  }

  return NextResponse.json(summary);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ membershipId: string }> },
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

  const { membershipId } = await params;

  let body: { personnelStatus: string; reason?: string };

  try {
    body = (await request.json()) as {
      personnelStatus: string;
      reason?: string;
    };
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid request body." },
      { status: 400 },
    );
  }

  const result = await updatePersonnelStatus({
    tenantId: session.user.tenantId,
    actorUserId: session.user.id,
    actorRole: session.user.role as Role,
    membershipId,
    newStatus: body.personnelStatus as PersonnelStatus,
    reason: body.reason,
  });

  return NextResponse.json(result, {
    status: result.status === "success" ? 200 : 400,
  });
}
