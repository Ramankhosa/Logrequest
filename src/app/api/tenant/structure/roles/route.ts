import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import {
  listRoleDefinitions,
  createRoleDefinition,
} from "@/lib/org-structure/roles-service";

function canManageRoleDefinitions(role: Role) {
  return role === Role.TENANT_OWNER || role === Role.TENANT_ADMIN;
}

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.tenantId) {
    return NextResponse.json(
      { status: "error", message: "You do not have tenant access." },
      { status: 403 },
    );
  }

  const definitions = await listRoleDefinitions(session.user.tenantId);
  return NextResponse.json({ status: "success", data: definitions });
}

export async function POST(request: Request) {
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

  const body = await request.json();

  const result = await createRoleDefinition({
    tenantId: session.user.tenantId,
    actorUserId: session.user.id,
    actorRole: session.user.role as Role,
    values: body,
  });

  return NextResponse.json(result, {
    status: result.status === "success" ? 201 : 400,
  });
}
