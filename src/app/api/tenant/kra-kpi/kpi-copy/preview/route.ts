import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { previewKpiCopy } from "@/lib/kra-kpi/kpi-copy-service";

function isTenantAdmin(role: string | null | undefined) {
  return role === "TENANT_OWNER" || role === "TENANT_ADMIN" || role === "SUPERADMIN";
}

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.tenantId || !isTenantAdmin(session.user.role)) {
    return NextResponse.json(
      { status: "error", message: "You do not have tenant admin access." },
      { status: 403 },
    );
  }

  const { searchParams } = new URL(request.url);
  const sourceKpiId = searchParams.get("sourceKpiId");
  if (!sourceKpiId) {
    return NextResponse.json(
      { status: "error", message: "sourceKpiId is required." },
      { status: 400 },
    );
  }

  const preview = await previewKpiCopy(sourceKpiId, session.user.tenantId);
  if (!preview) {
    return NextResponse.json(
      { status: "error", message: "Source KPI not found." },
      { status: 404 },
    );
  }

  return NextResponse.json(preview);
}
