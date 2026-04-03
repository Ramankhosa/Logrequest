import { NextResponse } from "next/server";
import {
  listAssessmentWorkspaceSnapshots,
  takeAssessmentWorkspaceSnapshot,
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
  const result = await listAssessmentWorkspaceSnapshots(
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
  const body = parsed.ok ? parsed.body : {};
  const { id } = await params;
  const result = await takeAssessmentWorkspaceSnapshot(
    id,
    session.tenantId,
    body,
    session.userId,
    session.role,
  );
  return NextResponse.json(result, { status: result.status === "success" ? 201 : 400 });
}
