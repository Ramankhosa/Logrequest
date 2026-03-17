import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import {
  assignRoleToUser,
  removeRoleAssignment,
} from "@/lib/org-structure/roles-service";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.tenantId || !session.user.role) {
    return NextResponse.json(
      { status: "error", message: "You do not have tenant access." },
      { status: 403 },
    );
  }

  const body = await request.json();

  const result = await assignRoleToUser({
    tenantId: session.user.tenantId,
    actorUserId: session.user.id,
    actorRole: session.user.role as Role,
    values: body,
  });

  return NextResponse.json(result, {
    status: result.status === "success" ? 201 : 400,
  });
}

export async function DELETE(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.tenantId || !session.user.role) {
    return NextResponse.json(
      { status: "error", message: "You do not have tenant access." },
      { status: 403 },
    );
  }

  const body = (await request.json()) as { assignmentId?: string };

  if (!body.assignmentId) {
    return NextResponse.json(
      { status: "error", message: "assignmentId is required." },
      { status: 400 },
    );
  }

  const result = await removeRoleAssignment({
    tenantId: session.user.tenantId,
    actorUserId: session.user.id,
    actorRole: session.user.role as Role,
    assignmentId: body.assignmentId,
  });

  return NextResponse.json(result, {
    status: result.status === "success" ? 200 : 400,
  });
}
