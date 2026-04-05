import { NextResponse } from "next/server";
import { getCrossWorkspaceOverlapReport } from "@/lib/accreditation/workspace-reporting-service";
import {
  getTenantAccreditationApiSession,
  tenantApiAccessDeniedResponse,
} from "@/app/api/tenant/accreditation/workspace-route-helpers";

export async function GET() {
  const session = await getTenantAccreditationApiSession();
  if (!session) {
    return tenantApiAccessDeniedResponse();
  }
  const result = await getCrossWorkspaceOverlapReport(session.tenantId, session.userId, session.role);
  return NextResponse.json(result, { status: result.status === "success" ? 200 : 400 });
}
