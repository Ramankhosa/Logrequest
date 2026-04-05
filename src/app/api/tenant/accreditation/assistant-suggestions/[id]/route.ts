import { TenantFeatureCode } from "@prisma/client";
import { NextResponse } from "next/server";
import { updateAssistantSuggestionStatus } from "@/lib/accreditation/accreditation-copilot-service";
import {
  getTenantAccreditationApiSession,
  parseJsonBody,
  tenantFeatureAccessDeniedResponse,
  tenantHasFeatureEnabled,
  tenantApiAccessDeniedResponse,
} from "@/app/api/tenant/accreditation/workspace-route-helpers";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getTenantAccreditationApiSession();
  if (!session) {
    return tenantApiAccessDeniedResponse();
  }
  if (!(await tenantHasFeatureEnabled(session.tenantId, TenantFeatureCode.ACCREDITATION_COPILOT))) {
    return tenantFeatureAccessDeniedResponse();
  }
  const parsedBody = await parseJsonBody(request);
  if (!parsedBody.ok) {
    return NextResponse.json({ status: "error", message: "Invalid JSON body." }, { status: 400 });
  }
  const { id } = await params;
  const result = await updateAssistantSuggestionStatus(
    id,
    session.tenantId,
    parsedBody.body,
    session.userId,
    session.role,
  );
  return NextResponse.json(result, { status: result.status === "success" ? 200 : 400 });
}
