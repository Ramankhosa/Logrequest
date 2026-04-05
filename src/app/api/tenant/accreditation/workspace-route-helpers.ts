import { TenantFeatureCode } from "@prisma/client";
import type { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { hasTenantFeatureEnabled } from "@/lib/tenant-services/service";

export async function getTenantAccreditationApiSession() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.tenantId || !session.user.role) {
    return null;
  }

  return {
    userId: session.user.id,
    tenantId: session.user.tenantId,
    role: session.user.role as Role,
  };
}

export function tenantApiAccessDeniedResponse(message = "You do not have tenant access.") {
  return NextResponse.json({ status: "error", message }, { status: 403 });
}

export const ACCREDITATION_COPILOT_DISABLED_MESSAGE =
  "Accreditation copilot is not enabled for this tenant.";

export async function tenantHasFeatureEnabled(
  tenantId: string,
  featureCode: TenantFeatureCode,
) {
  return hasTenantFeatureEnabled(tenantId, featureCode);
}

export function tenantFeatureAccessDeniedResponse(
  message = ACCREDITATION_COPILOT_DISABLED_MESSAGE,
) {
  return NextResponse.json({ status: "error", message }, { status: 403 });
}

export async function parseJsonBody(request: Request) {
  try {
    return { ok: true as const, body: await request.json() };
  } catch {
    return { ok: false as const };
  }
}
