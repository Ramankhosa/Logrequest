import { NextResponse } from "next/server";
import { getInstitutionalDataGaps } from "@/lib/accreditation/institutional-data-service";
import {
  getTenantAccreditationApiSession,
  tenantApiAccessDeniedResponse,
} from "../../workspace-route-helpers";

export async function GET(request: Request) {
  const session = await getTenantAccreditationApiSession();
  if (!session) {
    return tenantApiAccessDeniedResponse();
  }

  const url = new URL(request.url);
  const bodyCode = url.searchParams.get("bodyCode");
  const result = await getInstitutionalDataGaps(session.tenantId, session.userId, session.role, { bodyCode });
  return NextResponse.json(result, { status: result.status === "success" ? 200 : 400 });
}
