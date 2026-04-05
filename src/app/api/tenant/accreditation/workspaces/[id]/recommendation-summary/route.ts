import { NextResponse } from "next/server";
import { getWorkspaceRecommendationSummary } from "@/lib/accreditation/workspace-reporting-service";
import {
  getTenantAccreditationApiSession,
  tenantApiAccessDeniedResponse,
} from "@/app/api/tenant/accreditation/workspace-route-helpers";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getTenantAccreditationApiSession();
  if (!session) {
    return tenantApiAccessDeniedResponse();
  }
  const { id } = await params;
  const result = await getWorkspaceRecommendationSummary(id, session.tenantId, session.userId, session.role);
  return NextResponse.json(result, { status: result.status === "success" ? 200 : 400 });
}
