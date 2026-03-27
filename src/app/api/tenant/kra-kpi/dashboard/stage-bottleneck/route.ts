import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import {
  getDrillDownNode,
  getStageBottleneckAnalysis,
  getUnitSummary,
} from "@/lib/kra-kpi/dashboard-service";
import {
  DashboardOrgSelectionError,
  DashboardUnitSelectionError,
  resolveDashboardOrgNodeSelection,
  resolveDashboardUnitSelection,
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
  const periodId = searchParams.get("periodId");
  const kpiId = searchParams.get("kpiId");
  const unitId = searchParams.get("unitId") ?? undefined;
  const orgUnitId = searchParams.get("orgUnitId") ?? undefined;
  if (!periodId || !kpiId) {
    return NextResponse.json(
      { status: "error", message: "periodId and kpiId are required." },
      { status: 400 },
    );
  }
  if (unitId && orgUnitId) {
    return NextResponse.json(
      { status: "error", message: "unitId and orgUnitId cannot be combined." },
      { status: 400 },
    );
  }

  let scopeUnitIds: string[] | "ALL";
  if (unitId) {
    try {
      const selection = await resolveDashboardUnitSelection(
        session.user.tenantId,
        session.user.id,
        unitId,
      );
      const summary = await getUnitSummary(
        session.user.tenantId,
        periodId,
        selection.rootUnit.unitId,
        selection.scopeMode,
        selection.effectiveUnitIds,
      );
      if (!summary || !summary.stageKpiOptions.some((option) => option.kpiId === kpiId)) {
        return NextResponse.json(
          { status: "error", message: "KPI not found." },
          { status: 404 },
        );
      }
      scopeUnitIds = selection.effectiveUnitIds;
    } catch (error) {
      if (error instanceof DashboardUnitSelectionError) {
        return NextResponse.json(
          { status: "error", message: error.message },
          { status: error.status },
        );
      }
      throw error;
    }
  } else if (orgUnitId) {
    try {
      const selection = await resolveDashboardOrgNodeSelection(
        session.user.tenantId,
        session.user.id,
        orgUnitId,
      );
      const drillDown = await getDrillDownNode(
        session.user.tenantId,
        periodId,
        {
          unitId: selection.currentNode?.unitId ?? null,
          effectiveUnitIds: selection.effectiveUnitIds,
          visibleChildUnitIds: selection.visibleChildren.map((unit) => unit.unitId),
        },
      );
      if (!drillDown || !drillDown.stageKpiOptions.some((option) => option.kpiId === kpiId)) {
        return NextResponse.json(
          { status: "error", message: "KPI not found." },
          { status: 404 },
        );
      }
      scopeUnitIds = selection.effectiveUnitIds;
    } catch (error) {
      if (error instanceof DashboardOrgSelectionError) {
        return NextResponse.json(
          { status: "error", message: error.message },
          { status: error.status },
        );
      }
      throw error;
    }
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
      const scope = await resolveUserDashboardScope(session.user.tenantId, session.user.id);
      scopeUnitIds = scope.visibleUnitIds;
    }
  }

  const result = await getStageBottleneckAnalysis(
    session.user.tenantId,
    periodId,
    kpiId,
    scopeUnitIds,
  );
  if (!result) {
    return NextResponse.json(
      { status: "error", message: "KPI not found." },
      { status: 404 },
    );
  }

  return NextResponse.json(result);
}
