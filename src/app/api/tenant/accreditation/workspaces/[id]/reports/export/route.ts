import { NextResponse } from "next/server";
import { exportWorkspaceReport } from "@/lib/accreditation/workspace-reporting-service";
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

  const url = new URL(request.url);
  const format = url.searchParams.get("format");
  if (format !== "json" && format !== "csv") {
    return NextResponse.json(
      { status: "error", message: "format must be json or csv." },
      { status: 400 },
    );
  }

  const { id } = await params;
  const result = await exportWorkspaceReport(id, session.tenantId, format, session.userId, session.role);
  if (result.status === "error") {
    return NextResponse.json(result, { status: 400 });
  }
  if (format === "csv" && "csv" in result) {
    return new Response(result.csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename=\"${result.filename}\"`,
      },
    });
  }
  return NextResponse.json(result, { status: 200 });
}
