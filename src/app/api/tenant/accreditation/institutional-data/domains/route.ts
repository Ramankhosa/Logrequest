import { NextResponse } from "next/server";
import {
  createDataBankDomain,
  listDataBankDomains,
} from "@/lib/accreditation/institutional-data-service";
import {
  getTenantAccreditationApiSession,
  parseJsonBody,
  tenantApiAccessDeniedResponse,
} from "../../workspace-route-helpers";

export async function GET() {
  const session = await getTenantAccreditationApiSession();
  if (!session) {
    return tenantApiAccessDeniedResponse();
  }

  const result = await listDataBankDomains(session.tenantId, session.userId, session.role);
  return NextResponse.json(result, { status: result.status === "success" ? 200 : 400 });
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

  const result = await createDataBankDomain(session.tenantId, parsed.body, session.userId, session.role);
  return NextResponse.json(result, { status: result.status === "success" ? 200 : 400 });
}
