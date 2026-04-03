import { NextResponse } from "next/server";
import {
  createAssessmentWorkspaceEvidence,
  listAssessmentWorkspaceEvidence,
} from "@/lib/accreditation/workspace-service";
import {
  getTenantAccreditationApiSession,
  parseJsonBody,
  tenantApiAccessDeniedResponse,
} from "../../../workspace-route-helpers";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getTenantAccreditationApiSession();
  if (!session) {
    return tenantApiAccessDeniedResponse();
  }

  const { id } = await params;
  const result = await listAssessmentWorkspaceEvidence(
    id,
    session.tenantId,
    session.userId,
    session.role,
  );
  return NextResponse.json(result, { status: result.status === "success" ? 200 : 400 });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getTenantAccreditationApiSession();
  if (!session) {
    return tenantApiAccessDeniedResponse();
  }

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) {
    return NextResponse.json({ status: "error", message: "Invalid request body." }, { status: 400 });
  }

  const { id } = await params;
  const result = await createAssessmentWorkspaceEvidence(
    id,
    session.tenantId,
    parsed.body,
    session.userId,
    session.role,
  );
  return NextResponse.json(result, { status: result.status === "success" ? 201 : 400 });
}
