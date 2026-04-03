import { NextResponse } from "next/server";
import { unlinkAssessmentWorkspaceEvidence } from "@/lib/accreditation/workspace-service";
import {
  getTenantAccreditationApiSession,
  tenantApiAccessDeniedResponse,
} from "../../workspace-route-helpers";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getTenantAccreditationApiSession();
  if (!session) {
    return tenantApiAccessDeniedResponse();
  }

  const { id } = await params;
  const result = await unlinkAssessmentWorkspaceEvidence(
    id,
    session.tenantId,
    session.userId,
    session.role,
  );
  return NextResponse.json(result, { status: result.status === "success" ? 200 : 400 });
}
