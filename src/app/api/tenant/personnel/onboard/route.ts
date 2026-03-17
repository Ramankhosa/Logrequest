import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { onboardMember } from "@/lib/personnel/service";

export async function POST(request: Request) {
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

  let body: {
    firstName: string;
    lastName: string;
    officialEmail: string;
    primaryUnitCode: string;
    employeeId?: string;
    designation?: string;
    dateOfJoining?: string;
    role?: "TENANT_ADMIN" | "TENANT_USER";
    secondaryUnitCodes?: string[];
    roleKeys?: string[];
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid request body." },
      { status: 400 },
    );
  }

  const result = await onboardMember({
    tenantId: session.user.tenantId,
    actorUserId: session.user.id,
    actorRole: session.user.role as Role,
    values: body,
  });

  return NextResponse.json(result, {
    status: result.status === "success" ? 200 : 400,
  });
}
