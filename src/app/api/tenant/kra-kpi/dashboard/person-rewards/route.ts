import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { getPersonDetail } from "@/lib/kra-kpi/dashboard-service";
import { listScopedPersonRewards } from "@/lib/kra-kpi/reward-ops-service";
import { prisma } from "@/lib/prisma";
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
  const userId = searchParams.get("userId");
  const unitId = searchParams.get("unitId") ?? undefined;
  if (!periodId || !userId) {
    return NextResponse.json(
      { status: "error", message: "periodId and userId are required." },
      { status: 400 },
    );
  }

  try {
    const selection = await resolveDashboardUnitSelection(
      session.user.tenantId,
      session.user.id,
      unitId,
    );
    const person = await getPersonDetail(
      session.user.tenantId,
      periodId,
      userId,
      selection.effectiveUnitIds,
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
      session.user.tenantId,
      periodId,
      userId,
      selection.effectiveUnitIds,
    );
    return NextResponse.json(rewards);
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
