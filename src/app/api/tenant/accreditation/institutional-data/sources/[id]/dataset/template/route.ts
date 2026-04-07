import { NextResponse } from "next/server";
import { getInstitutionalDataSourceDatasetTemplate } from "@/lib/accreditation/institutional-data-service";
import {
  getTenantAccreditationApiSession,
  tenantApiAccessDeniedResponse,
} from "@/app/api/tenant/accreditation/workspace-route-helpers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getTenantAccreditationApiSession();
  if (!session) {
    return tenantApiAccessDeniedResponse();
  }

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") === "csv" ? "csv" : "xlsx";

  const result = await getInstitutionalDataSourceDatasetTemplate(
    id,
    session.tenantId,
    session.userId,
    session.role,
    format,
  );

  if (result.status === "error") {
    return NextResponse.json(result, { status: 400 });
  }

  return new Response(result.content, {
    status: 200,
    headers: {
      "content-type": result.contentType,
      "content-disposition": `attachment; filename="${result.filename}"`,
    },
  });
}
