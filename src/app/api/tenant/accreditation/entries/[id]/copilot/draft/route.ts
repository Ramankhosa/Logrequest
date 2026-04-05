import { TenantFeatureCode } from "@prisma/client";
import { NextResponse } from "next/server";
import { generateEntryDraftSuggestion } from "@/lib/accreditation/accreditation-copilot-service";
import {
  tenantFeatureAccessDeniedResponse,
  tenantHasFeatureEnabled,
  getTenantAccreditationApiSession,
  tenantApiAccessDeniedResponse,
} from "@/app/api/tenant/accreditation/workspace-route-helpers";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getTenantAccreditationApiSession();
  if (!session) {
    return tenantApiAccessDeniedResponse();
  }
  if (!(await tenantHasFeatureEnabled(session.tenantId, TenantFeatureCode.ACCREDITATION_COPILOT))) {
    return tenantFeatureAccessDeniedResponse();
  }
  const { id } = await params;
  const result = await generateEntryDraftSuggestion(id, session.tenantId, session.userId, session.role);
  return NextResponse.json(result, { status: result.status === "success" ? 200 : 400 });
}
