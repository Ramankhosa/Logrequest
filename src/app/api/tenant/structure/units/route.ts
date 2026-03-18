import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import {
  createOrgUnit,
  listActiveStructureUnits,
  type CreateOrgUnitInput,
} from "@/lib/org-structure/service";

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

  const units = await listActiveStructureUnits(session.user.tenantId);
  return NextResponse.json(units);
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
        message: "You do not have permission to manage structure.",
      },
      { status: 403 },
    );
  }

  let values: CreateOrgUnitInput;

  try {
    values = (await request.json()) as CreateOrgUnitInput;
  } catch {
    return NextResponse.json(
      {
        status: "error",
        message: "Invalid request body.",
      },
      { status: 400 },
    );
  }

  const result = await createOrgUnit({
    tenantId: session.user.tenantId,
    actorUserId: session.user.id,
    actorRole: session.user.role as Role,
    values,
  });

  return NextResponse.json(result, {
    status: result.status === "success" ? 200 : 400,
  });
}
