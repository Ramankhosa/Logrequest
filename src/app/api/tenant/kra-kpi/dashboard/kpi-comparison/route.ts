import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { getKpiCrossComparison } from "@/lib/kra-kpi/dashboard-service";
import { resolveUserDashboardScope } from "@/lib/org-structure/scope-resolver";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.tenantId) {
    return NextResponse.json(
      { status: "error", message: "You do not have tenant access." },
      { status: 403 },
    );
  }

  const { searchParams } = new URL(request.url);
  const periodId = searchParams.get("periodId");
  const kpiId = searchParams.get("kpiId");
  if (!periodId || !kpiId) {
    return NextResponse.json(
      { status: "error", message: "periodId and kpiId are required." },
      { status: 400 },
    );
  }

  const scope = await resolveUserDashboardScope(session.user.tenantId, session.user.id);
  const result = await getKpiCrossComparison(session.user.tenantId, periodId, kpiId, scope.visibleUnitIds);
  if (!result) {
    return NextResponse.json(
      { status: "error", message: "KPI not found." },
      { status: 404 },
    );
  }

  return NextResponse.json(result);
}
