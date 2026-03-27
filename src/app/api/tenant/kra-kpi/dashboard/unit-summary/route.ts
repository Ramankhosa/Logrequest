import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { getUnitSummary } from "@/lib/kra-kpi/dashboard-service";
import {
  DashboardUnitSelectionError,
  resolveDashboardUnitSelection,
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
    if (!summary) {
      return NextResponse.json(
        { status: "error", message: "Unit not found." },
        { status: 404 },
      );
    }

    return NextResponse.json(summary);
  } catch (error) {
    if (error instanceof DashboardUnitSelectionError) {
      return NextResponse.json(
        { status: "error", message: error.message },
        { status: error.status },
      );
    }
    throw error;
  }
}
