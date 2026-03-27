import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { getPersonDetail } from "@/lib/kra-kpi/dashboard-service";
import { listScopedPersonRewards } from "@/lib/kra-kpi/reward-ops-service";
import { getPublishedVersionId } from "@/lib/org-structure/hierarchy-utils";
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
  const tenantId = session.user.tenantId;
  const requesterId = session.user.id;

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

  try {
    const effectiveUnitIds = unitId
      ? (await resolveDashboardUnitSelection(
          tenantId,
          requesterId,
          unitId,
        )).effectiveUnitIds
      : orgUnitId
        ? (await resolveDashboardOrgNodeSelection(
            tenantId,
            requesterId,
            orgUnitId,
          )).effectiveUnitIds
        : await (async () => {
            try {
              return (
                await resolveDashboardOrgNodeSelection(
                  tenantId,
                  requesterId,
                )
              ).effectiveUnitIds;
            } catch (error) {
              if (!(error instanceof DashboardOrgSelectionError) || error.status !== 403) {
                throw error;
              }
            }

            const scope = await resolveUserDashboardScope(
              tenantId,
              requesterId,
            );
            if (scope.visibleUnitIds !== "ALL") {
              return scope.visibleUnitIds;
            }

            const versionId = await getPublishedVersionId(tenantId);
            if (!versionId) {
              return [];
            }

            const units = await prisma.orgUnit.findMany({
              where: { tenantId, versionId },
              select: { id: true },
            });
            return units.map((unit) => unit.id);
          })();
    const person = await getPersonDetail(
      tenantId,
      periodId,
      userId,
      effectiveUnitIds,
    );
    if (!person) {
      const userExists = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true },
      });
      return NextResponse.json(
        { status: "error", message: userExists ? "You do not have access to the requested user." : "User not found." },
        { status: userExists ? 403 : 404 },
      );
    }

    const rewards = await listScopedPersonRewards(
      tenantId,
      periodId,
      userId,
      effectiveUnitIds,
    );
    return NextResponse.json(rewards);
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
}
