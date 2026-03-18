import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { getPersonnelDirectory } from "@/lib/personnel/service";
import {
  createTenantMember,
  type MemberCreationInput,
} from "@/lib/tenant-admin/service";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.tenantId) {
    return NextResponse.json(
      {
        status: "error",
        message: "You do not have tenant access.",
      },
      { status: 403 },
    );
  }

  const directory = await getPersonnelDirectory(session.user.tenantId);
  const users = directory
    .filter((row) => row.membershipStatus !== "REVOKED" && row.membershipStatus !== "ARCHIVED")
    .map((row) => ({
      id: row.userId,
      name: row.name,
      email: row.email,
      employeeId: row.employeeId,
      designation: row.designation,
      role: row.appRole,
      status: row.membershipStatus,
      primaryUnit: row.primaryUnit,
      primaryUnitCode: row.primaryUnitCode,
    }));

  return NextResponse.json(users);
}

export async function POST(request: Request) {
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

  if (
    session.user.role !== Role.TENANT_OWNER &&
    session.user.role !== Role.TENANT_ADMIN
  ) {
    return NextResponse.json(
      {
        status: "error",
        message: "You do not have permission to create tenant users.",
      },
      { status: 403 },
    );
  }

  let values: MemberCreationInput;

  try {
    values = (await request.json()) as MemberCreationInput;
  } catch {
    return NextResponse.json(
      {
        status: "error",
        message: "Invalid request body.",
      },
      { status: 400 },
    );
  }

  const result = await createTenantMember({
    actorUserId: session.user.id,
    actorRole: session.user.role as Role,
    tenantId: session.user.tenantId,
    values,
  });

  return NextResponse.json(result, {
    status: result.status === "success" ? 200 : 400,
  });
}
