import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { deleteOrgUnit, updateOrgUnit } from "@/lib/org-structure/service";

function requireStructureAccess(session: Awaited<ReturnType<typeof getServerSession>>) {
  if (!session?.user?.id || !session.user.tenantId || !session.user.role) {
    return null;
  }
  if (
    session.user.role !== Role.TENANT_OWNER &&
    session.user.role !== Role.TENANT_ADMIN
  ) {
    return null;
  }
  return session.user as { id: string; tenantId: string; role: string };
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ unitId: string }> },
) {
  const session = await getServerSession(authOptions);
  const user = requireStructureAccess(session);
  if (!user) {
    return NextResponse.json(
      { status: "error", message: "You do not have permission to manage structure." },
      { status: 403 },
    );
  }

  const { unitId } = await params;

  const result = await deleteOrgUnit({
    tenantId: user.tenantId,
    actorUserId: user.id,
    actorRole: user.role as Role,
    unitId,
  });

  return NextResponse.json(result, {
    status: result.status === "success" ? 200 : 400,
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ unitId: string }> },
) {
  const session = await getServerSession(authOptions);
  const user = requireStructureAccess(session);
  if (!user) {
    return NextResponse.json(
      { status: "error", message: "You do not have permission to manage structure." },
      { status: 403 },
    );
  }

  const { unitId } = await params;
  const body = (await request.json()) as Record<string, unknown>;

  const result = await updateOrgUnit({
    tenantId: user.tenantId,
    actorUserId: user.id,
    actorRole: user.role as Role,
    unitId,
    values: body,
  });

  return NextResponse.json(result, {
    status: result.status === "success" ? 200 : 400,
  });
}
