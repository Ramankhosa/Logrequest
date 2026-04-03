import { NextResponse } from "next/server";
import {
  deleteAssessmentWorkspaceMilestone,
  updateAssessmentWorkspaceMilestone,
} from "@/lib/accreditation/workspace-service";
import {
  getTenantAccreditationApiSession,
  parseJsonBody,
  tenantApiAccessDeniedResponse,
} from "../../../../workspace-route-helpers";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; milestoneId: string }> },
) {
  const session = await getTenantAccreditationApiSession();
  if (!session) {
    return tenantApiAccessDeniedResponse();
  }

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) {
    return NextResponse.json({ status: "error", message: "Invalid request body." }, { status: 400 });
  }

  const { milestoneId } = await params;
  const result = await updateAssessmentWorkspaceMilestone(
    milestoneId,
    session.tenantId,
    parsed.body,
    session.userId,
    session.role,
  );
  return NextResponse.json(result, { status: result.status === "success" ? 200 : 400 });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; milestoneId: string }> },
) {
  const session = await getTenantAccreditationApiSession();
  if (!session) {
    return tenantApiAccessDeniedResponse();
  }

  const { milestoneId } = await params;
  const result = await deleteAssessmentWorkspaceMilestone(
    milestoneId,
    session.tenantId,
    session.userId,
    session.role,
  );
  return NextResponse.json(result, { status: result.status === "success" ? 200 : 400 });
}
