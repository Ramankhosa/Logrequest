import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { getOrgHierarchyStats } from "@/lib/kra-kpi/dashboard-service";
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
  if (!periodId) {
    return NextResponse.json(
      { status: "error", message: "periodId is required." },
      { status: 400 },
    );
  }

  const scope = await resolveUserDashboardScope(session.user.tenantId, session.user.id);
  const parentUnitId = searchParams.get("parentUnitId") ?? undefined;
  const stats = await getOrgHierarchyStats(session.user.tenantId, periodId, parentUnitId, scope.visibleUnitIds);
  return NextResponse.json(stats);
}
