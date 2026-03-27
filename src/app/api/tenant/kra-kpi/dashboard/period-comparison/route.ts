import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { getKpiPeriodComparison } from "@/lib/kra-kpi/dashboard-service";
import {
  DashboardOrgSelectionError,
  resolveDashboardOrgNodeSelection,
  resolveUserDashboardScope,
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
  const sourceKpiId = searchParams.get("sourceKpiId");
  const periodIds = (searchParams.get("periodIds") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const orgUnitId = searchParams.get("orgUnitId") ?? undefined;
  if (!sourceKpiId || periodIds.length === 0) {
    return NextResponse.json(
      { status: "error", message: "sourceKpiId and periodIds are required." },
      { status: 400 },
    );
  }
  if (periodIds.length > 5) {
    return NextResponse.json(
      { status: "error", message: "You can compare up to 5 periods at a time." },
      { status: 400 },
    );
  }

  try {
    let scopeUnitIds: string[] | "ALL";
    if (orgUnitId) {
      scopeUnitIds = (
        await resolveDashboardOrgNodeSelection(
          session.user.tenantId,
          session.user.id,
          orgUnitId,
        )
      ).effectiveUnitIds;
    } else {
      try {
        scopeUnitIds = (
          await resolveDashboardOrgNodeSelection(
            session.user.tenantId,
            session.user.id,
          )
        ).effectiveUnitIds;
      } catch (error) {
        if (!(error instanceof DashboardOrgSelectionError) || error.status !== 403) {
          throw error;
        }
        scopeUnitIds = (
          await resolveUserDashboardScope(session.user.tenantId, session.user.id)
        ).visibleUnitIds;
      }
    }
    const result = await getKpiPeriodComparison(
      session.user.tenantId,
      sourceKpiId,
      periodIds,
      scopeUnitIds,
    );
    if (!result) {
      return NextResponse.json(
        { status: "error", message: "KPI not found." },
        { status: 404 },
      );
    }
    return NextResponse.json(result);
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
