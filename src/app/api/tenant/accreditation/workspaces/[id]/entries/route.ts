import { NextResponse } from "next/server";
import { BlockEntryStatus } from "@prisma/client";
import { listAssessmentWorkspaceEntries } from "@/lib/accreditation/workspace-service";
import {
  getTenantAccreditationApiSession,
  tenantApiAccessDeniedResponse,
} from "../../../workspace-route-helpers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getTenantAccreditationApiSession();
  if (!session) {
    return tenantApiAccessDeniedResponse();
  }

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const status = statusParam && statusParam in BlockEntryStatus
    ? (statusParam as BlockEntryStatus)
    : undefined;
  const { id } = await params;
  const result = await listAssessmentWorkspaceEntries(
    id,
    session.tenantId,
    session.userId,
    session.role,
    { status },
  );
  return NextResponse.json(result, { status: result.status === "success" ? 200 : 400 });
}
