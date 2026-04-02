import type { Role, TenantPermissionRole } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import {
  listTenantPermissionAssignments,
  listTenantPermissionRoleDefinitions,
  replaceTenantPermissionAssignments,
} from "@/lib/tenant-permissions/service";
import { hasTenantCapability } from "@/lib/tenant-permissions/service";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.tenantId || !session.user.role) {
    return NextResponse.json(
      { status: "error", message: "You do not have tenant access." },
      { status: 403 },
    );
  }

  const allowed = await hasTenantCapability({
    tenantId: session.user.tenantId,
    userId: session.user.id,
    baseRole: session.user.role,
    capability: "MANAGE_ACCESS",
  });
  if (!allowed) {
    return NextResponse.json(
      { status: "error", message: "You do not have permission to manage tenant access roles." },
      { status: 403 },
    );
  }

  const [definitions, assignments] = await Promise.all([
    Promise.resolve(listTenantPermissionRoleDefinitions()),
    listTenantPermissionAssignments(session.user.tenantId),
  ]);

  return NextResponse.json({
    roleDefinitions: definitions,
    assignments,
  });
}

export async function PATCH(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.tenantId || !session.user.role) {
    return NextResponse.json(
      { status: "error", message: "You do not have tenant access." },
      { status: 403 },
    );
  }

  const allowed = await hasTenantCapability({
    tenantId: session.user.tenantId,
    userId: session.user.id,
    baseRole: session.user.role,
    capability: "MANAGE_ACCESS",
  });
  if (!allowed) {
    return NextResponse.json(
      { status: "error", message: "You do not have permission to manage tenant access roles." },
      { status: 403 },
    );
  }

  let body: { targetUserId?: string; roleCodes?: TenantPermissionRole[] };
  try {
    body = (await request.json()) as { targetUserId?: string; roleCodes?: TenantPermissionRole[] };
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid request body." },
      { status: 400 },
    );
  }

  const targetUserId = body.targetUserId?.trim();
  if (!targetUserId) {
    return NextResponse.json(
      { status: "error", message: "Target user is required." },
      { status: 400 },
    );
  }

  const result = await replaceTenantPermissionAssignments({
    tenantId: session.user.tenantId,
    actorUserId: session.user.id,
    actorRole: session.user.role as Role,
    targetUserId,
    roleCodes: Array.isArray(body.roleCodes) ? body.roleCodes : [],
  });

  return NextResponse.json(result, {
    status: result.status === "success" ? 200 : 400,
  });
}
