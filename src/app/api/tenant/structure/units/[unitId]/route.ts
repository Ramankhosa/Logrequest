import { Role } from "@prisma/client";
import type { Session } from "next-auth";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { deleteOrgUnit, updateOrgUnit } from "@/lib/org-structure/service";

type StructureActor = {
  id: string;
  tenantId: string;
  role: Role;
};

function requireStructureAccess(session: Session | null) {
  const user = session?.user;

  if (!user?.id || !user.tenantId || !user.role) {
    return null;
  }
  if (user.role !== Role.TENANT_OWNER && user.role !== Role.TENANT_ADMIN) {
    return null;
  }

  return {
    id: user.id,
    tenantId: user.tenantId,
    role: user.role,
  } satisfies StructureActor;
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
