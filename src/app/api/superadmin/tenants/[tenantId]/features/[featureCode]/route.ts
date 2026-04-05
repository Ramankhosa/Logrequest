import { Role, TenantFeatureCode } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { setTenantFeatureEntitlement } from "@/lib/tenant-services/service";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ tenantId: string; featureCode: string }> },
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.isSuperadmin) {
    return NextResponse.json(
      { status: "error", message: "Only a signed-in superadmin can update tenant features." },
      { status: 403 },
    );
  }

  let body: { enabled?: boolean; notes?: string | null };
  try {
    body = (await request.json()) as { enabled?: boolean; notes?: string | null };
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid request body." },
      { status: 400 },
    );
  }

  if (typeof body.enabled !== "boolean") {
    return NextResponse.json(
      { status: "error", message: "Enabled flag is required." },
      { status: 400 },
    );
  }

  const { tenantId, featureCode } = await params;
  if (featureCode !== TenantFeatureCode.ACCREDITATION_COPILOT) {
    return NextResponse.json(
      { status: "error", message: "Unsupported tenant feature code." },
      { status: 400 },
    );
  }

  const result = await setTenantFeatureEntitlement({
    tenantId,
    featureCode,
    enabled: body.enabled,
    actorUserId: session.user.id,
    actorRole: Role.SUPERADMIN,
    notes: body.notes ?? null,
  });

  return NextResponse.json(result, {
    status: result.status === "success" ? 200 : 400,
  });
}
