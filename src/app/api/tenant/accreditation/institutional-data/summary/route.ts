import { NextResponse } from "next/server";
import { getInstitutionalDataSummary } from "@/lib/accreditation/institutional-data-service";
import {
  getTenantAccreditationApiSession,
  tenantApiAccessDeniedResponse,
} from "../../workspace-route-helpers";

export async function GET() {
  const session = await getTenantAccreditationApiSession();
  if (!session) {
    return tenantApiAccessDeniedResponse();
  }

  const result = await getInstitutionalDataSummary(session.tenantId, session.userId, session.role);
  return NextResponse.json(result, { status: result.status === "success" ? 200 : 400 });
}
