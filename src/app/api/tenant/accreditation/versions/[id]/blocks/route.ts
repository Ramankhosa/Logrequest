import type { Role } from "@prisma/client";
import { TenantFeatureCode } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import {
  createTenantVersionBlock,
  listTenantVersionBlocks,
} from "@/lib/accreditation/block-template-service";
import { hasTenantFeatureEnabled } from "@/lib/tenant-services/service";
import { ACCREDITATION_COPILOT_DISABLED_MESSAGE } from "@/app/api/tenant/accreditation/workspace-route-helpers";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.tenantId) {
    return NextResponse.json({ status: "error", message: "You do not have tenant access." }, { status: 403 });
  }

  const { id } = await params;
  const result = await listTenantVersionBlocks(session.user.tenantId, id);
  return NextResponse.json(result, { status: result.status === "success" ? 200 : 403 });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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
  if (
    body &&
    typeof body === "object" &&
    "assistantConfig" in body &&
    !(await hasTenantFeatureEnabled(session.user.tenantId, TenantFeatureCode.ACCREDITATION_COPILOT))
  ) {
    return NextResponse.json({ status: "error", message: ACCREDITATION_COPILOT_DISABLED_MESSAGE }, { status: 403 });
  }

  const { id } = await params;
  const result = await createTenantVersionBlock(
    session.user.tenantId,
    id,
    body,
    session.user.id,
    session.user.role as Role,
  );
  return NextResponse.json(result, { status: result.status === "success" ? 201 : 400 });
}
