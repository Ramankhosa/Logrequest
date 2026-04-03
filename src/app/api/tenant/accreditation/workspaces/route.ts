import { NextResponse } from "next/server";
import {
  createAssessmentWorkspace,
  listAssessmentWorkspaces,
} from "@/lib/accreditation/workspace-service";
import {
  getTenantAccreditationApiSession,
  parseJsonBody,
  tenantApiAccessDeniedResponse,
} from "../workspace-route-helpers";

export async function GET() {
  const session = await getTenantAccreditationApiSession();
  if (!session) {
    return tenantApiAccessDeniedResponse();
  }

  const result = await listAssessmentWorkspaces(
    session.tenantId,
    session.userId,
    session.role,
  );

  return NextResponse.json(result, { status: result.status === "success" ? 200 : 403 });
}

export async function POST(request: Request) {
  const session = await getTenantAccreditationApiSession();
  if (!session) {
    return tenantApiAccessDeniedResponse();
  }

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) {
    return NextResponse.json({ status: "error", message: "Invalid request body." }, { status: 400 });
  }

  const result = await createAssessmentWorkspace(
    session.tenantId,
    parsed.body,
    session.userId,
    session.role,
  );

  return NextResponse.json(result, { status: result.status === "success" ? 201 : 400 });
}
