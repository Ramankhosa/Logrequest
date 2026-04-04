import { NextResponse } from "next/server";
import { upsertMetricSourceLinks } from "@/lib/accreditation/institutional-data-service";
import {
  getTenantAccreditationApiSession,
  parseJsonBody,
  tenantApiAccessDeniedResponse,
} from "../../../../workspace-route-helpers";

export async function PUT(
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
  const result = await upsertMetricSourceLinks(id, session.tenantId, parsed.body, session.userId, session.role);
  return NextResponse.json(result, { status: result.status === "success" ? 200 : 400 });
}
