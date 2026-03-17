import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import {
  revokeTenantMember,
  updateTenantMemberRole,
} from "@/lib/tenant-admin/service";

type RouteParams = {
  membershipId: string;
};

export async function PATCH(
  request: Request,
  { params }: { params: Promise<RouteParams> },
) {
  const { membershipId } = await params;
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.tenantId || !session.user.role) {
    return NextResponse.json(
      {
        status: "error",
        message: "You do not have tenant access.",
      },
      { status: 403 },
    );
  }

  let payload: { role?: string };

  try {
    payload = (await request.json()) as { role?: string };
  } catch {
    return NextResponse.json(
      {
        status: "error",
        message: "Invalid request body.",
      },
      { status: 400 },
    );
  }

  const nextRole =
    payload.role === "TENANT_ADMIN"
      ? Role.TENANT_ADMIN
      : payload.role === "TENANT_USER"
        ? Role.TENANT_USER
        : null;

  if (!nextRole) {
    return NextResponse.json(
      {
        status: "error",
        message: "Role update is invalid.",
      },
      { status: 400 },
    );
  }

  const result = await updateTenantMemberRole({
    actorUserId: session.user.id,
    actorRole: session.user.role as Role,
    tenantId: session.user.tenantId,
    membershipId,
    role: nextRole,
  });

  return NextResponse.json(result, {
    status: result.status === "success" ? 200 : 400,
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<RouteParams> },
) {
  const { membershipId } = await params;
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.tenantId || !session.user.role) {
    return NextResponse.json(
      {
        status: "error",
        message: "You do not have tenant access.",
      },
      { status: 403 },
    );
  }

  const result = await revokeTenantMember({
    actorUserId: session.user.id,
    actorRole: session.user.role as Role,
    tenantId: session.user.tenantId,
    membershipId,
  });

  return NextResponse.json(result, {
    status: result.status === "success" ? 200 : 400,
  });
}
