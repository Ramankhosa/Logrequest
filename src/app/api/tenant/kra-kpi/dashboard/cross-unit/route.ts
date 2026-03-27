import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { getCrossUnitComparison } from "@/lib/kra-kpi/dashboard-service";
import {
  DashboardOrgSelectionError,
  resolveDashboardOrgNodeSelection,
} from "@/lib/org-structure/scope-resolver";

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
  const parentUnitId = searchParams.get("parentUnitId") ?? undefined;
  if (!periodId) {
    return NextResponse.json(
      { status: "error", message: "periodId is required." },
      { status: 400 },
    );
  }

  try {
    const selection = await resolveDashboardOrgNodeSelection(
      session.user.tenantId,
      session.user.id,
      parentUnitId,
    );
    const comparison = await getCrossUnitComparison(
      session.user.tenantId,
      periodId,
      selection.visibleChildren.map((unit) => unit.unitId),
      selection.effectiveUnitIds,
    );
    return NextResponse.json(comparison);
  } catch (error) {
    if (error instanceof DashboardOrgSelectionError) {
      return NextResponse.json(
        { status: "error", message: error.message },
        { status: error.status },
      );
    }
    throw error;
  }
}
