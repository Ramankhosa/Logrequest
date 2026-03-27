import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { getPersonDetail } from "@/lib/kra-kpi/dashboard-service";
import { prisma } from "@/lib/prisma";
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
  const userId = searchParams.get("userId");
  const unitId = searchParams.get("unitId") ?? undefined;
  const orgUnitId = searchParams.get("orgUnitId") ?? undefined;
  if (!periodId || !userId) {
    return NextResponse.json(
      { status: "error", message: "periodId and userId are required." },
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
  try {
    if (unitId) {
      const selection = await resolveDashboardUnitSelection(
        session.user.tenantId,
        session.user.id,
        unitId,
      );
      scopeUnitIds = selection.effectiveUnitIds;
    } else if (orgUnitId) {
      const selection = await resolveDashboardOrgNodeSelection(
        session.user.tenantId,
        session.user.id,
        orgUnitId,
      );
      scopeUnitIds = selection.effectiveUnitIds;
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
  } catch (error) {
    if (
      error instanceof DashboardUnitSelectionError ||
      error instanceof DashboardOrgSelectionError
    ) {
      return NextResponse.json(
        { status: "error", message: error.message },
        { status: error.status },
      );
    }
    throw error;
  }

  const result = await getPersonDetail(session.user.tenantId, periodId, userId, scopeUnitIds);
  if (!result) {
    const userExists = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    return NextResponse.json(
      { status: "error", message: userExists ? "You do not have access to the requested user." : "User not found." },
      { status: userExists ? 403 : 404 },
    );
  }

  return NextResponse.json(result);
}
