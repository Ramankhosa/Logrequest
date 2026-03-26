import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { getPersonDetail } from "@/lib/kra-kpi/dashboard-service";
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
  const userId = searchParams.get("userId");
  if (!periodId || !userId) {
    return NextResponse.json(
      { status: "error", message: "periodId and userId are required." },
      { status: 400 },
    );
  }

  const scope = await resolveUserDashboardScope(session.user.tenantId, session.user.id);
  const result = await getPersonDetail(session.user.tenantId, periodId, userId, scope.visibleUnitIds);
  if (!result) {
    return NextResponse.json(
      { status: "error", message: "User not found." },
      { status: 404 },
    );
  }

  return NextResponse.json(result);
}
