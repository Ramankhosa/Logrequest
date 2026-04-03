import { NextResponse } from "next/server";
import {
  addAssessmentWorkspaceCollaborator,
  listAssessmentWorkspaceCollaborators,
  removeAssessmentWorkspaceCollaborator,
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
  const result = await listAssessmentWorkspaceCollaborators(
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
  const result = await addAssessmentWorkspaceCollaborator(
    id,
    session.tenantId,
    parsed.body,
    session.userId,
    session.role,
  );
  return NextResponse.json(result, { status: result.status === "success" ? 201 : 400 });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getTenantAccreditationApiSession();
  if (!session) {
    return tenantApiAccessDeniedResponse();
  }

  const { id } = await params;
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ status: "error", message: "userId is required." }, { status: 400 });
  }

  const result = await removeAssessmentWorkspaceCollaborator(
    id,
    userId,
    session.tenantId,
    session.userId,
    session.role,
  );
  return NextResponse.json(result, { status: result.status === "success" ? 200 : 400 });
}
