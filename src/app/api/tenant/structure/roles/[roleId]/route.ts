import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import {
  updateRoleDefinition,
  deleteRoleDefinition,
} from "@/lib/org-structure/roles-service";

function canManageRoleDefinitions(role: Role) {
  return role === Role.TENANT_OWNER || role === Role.TENANT_ADMIN;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ roleId: string }> },
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.tenantId || !session.user.role) {
    return NextResponse.json(
      { status: "error", message: "You do not have tenant access." },
      { status: 403 },
    );
  }

  if (!canManageRoleDefinitions(session.user.role as Role)) {
    return NextResponse.json(
      { status: "error", message: "You do not have permission to manage role definitions." },
      { status: 403 },
    );
  }

  const { roleId } = await params;
  const body = await request.json();

  const result = await updateRoleDefinition({
    tenantId: session.user.tenantId,
    actorUserId: session.user.id,
    actorRole: session.user.role as Role,
    roleId,
    values: body,
  });

  return NextResponse.json(result, {
    status: result.status === "success" ? 200 : 400,
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ roleId: string }> },
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.tenantId || !session.user.role) {
    return NextResponse.json(
      { status: "error", message: "You do not have tenant access." },
      { status: 403 },
    );
  }

  if (!canManageRoleDefinitions(session.user.role as Role)) {
    return NextResponse.json(
      { status: "error", message: "You do not have permission to manage role definitions." },
      { status: 403 },
    );
  }

  const { roleId } = await params;

  const result = await deleteRoleDefinition({
    tenantId: session.user.tenantId,
    actorUserId: session.user.id,
    actorRole: session.user.role as Role,
    roleId,
  });

  return NextResponse.json(result, {
    status: result.status === "success" ? 200 : 400,
  });
}
