import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { getDrillDownNode } from "@/lib/kra-kpi/dashboard-service";
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
  const unitId = searchParams.get("unitId") ?? undefined;
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
      unitId,
    );
    const node = await getDrillDownNode(session.user.tenantId, periodId, {
      unitId: selection.currentNode?.unitId ?? null,
      effectiveUnitIds: selection.effectiveUnitIds,
      visibleChildUnitIds: selection.visibleChildren.map((unit) => unit.unitId),
    });
    if (!node) {
      return NextResponse.json(
        { status: "error", message: "Unit not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({
      selection: {
        entryRoots: selection.entryRoots,
        currentNode: selection.currentNode,
        breadcrumb: selection.breadcrumb,
        visibleChildren: selection.visibleChildren,
      },
      node,
    });
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
