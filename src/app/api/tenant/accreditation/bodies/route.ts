import type { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import {
  createTenantAccreditationBody,
  listTenantAccreditationBodies,
} from "@/lib/accreditation/service";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.tenantId) {
    return NextResponse.json({ status: "error", message: "You do not have tenant access." }, { status: 403 });
  }

  const result = await listTenantAccreditationBodies(session.user.tenantId);
  return NextResponse.json(result, { status: result.status === "success" ? 200 : 403 });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.tenantId || !session.user.role) {
    return NextResponse.json({ status: "error", message: "You do not have tenant access." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ status: "error", message: "Invalid request body." }, { status: 400 });
  }

  const result = await createTenantAccreditationBody(
    session.user.tenantId,
    body,
    session.user.id,
    session.user.role as Role,
  );
  return NextResponse.json(result, { status: result.status === "success" ? 201 : 400 });
}
