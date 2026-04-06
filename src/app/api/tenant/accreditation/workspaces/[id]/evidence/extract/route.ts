import { TenantFeatureCode } from "@prisma/client";
import { NextResponse } from "next/server";
import { extractWorkspaceEvidenceForCopilot } from "@/lib/accreditation/accreditation-copilot-service";
import {
  getTenantAccreditationApiSession,
  parseJsonBody,
  tenantApiAccessDeniedResponse,
  tenantFeatureAccessDeniedResponse,
  tenantHasFeatureEnabled,
} from "@/app/api/tenant/accreditation/workspace-route-helpers";

export async function POST(
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

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) {
    return NextResponse.json({ status: "error", message: "Invalid request body." }, { status: 400 });
  }

  const { id } = await params;
  const result = await extractWorkspaceEvidenceForCopilot(
    id,
    session.tenantId,
    parsed.body,
    session.userId,
    session.role,
  );
  return NextResponse.json(result, { status: result.status === "success" ? 200 : 400 });
}
