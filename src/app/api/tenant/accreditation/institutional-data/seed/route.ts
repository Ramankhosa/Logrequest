import { NextResponse } from "next/server";
import { seedInstitutionalDataCatalog } from "@/lib/accreditation/institutional-data-service";
import {
  getTenantAccreditationApiSession,
  parseJsonBody,
  tenantApiAccessDeniedResponse,
} from "../../workspace-route-helpers";

export async function POST(request: Request) {
  const session = await getTenantAccreditationApiSession();
  if (!session) {
    return tenantApiAccessDeniedResponse();
  }

  const parsed = await parseJsonBody(request);
  const body = parsed.ok ? parsed.body : {};
  const result = await seedInstitutionalDataCatalog(session.tenantId, body, session.userId, session.role);
  return NextResponse.json(result, { status: result.status === "success" ? 200 : 400 });
}
