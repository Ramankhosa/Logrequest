import type { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import type { RewardReconciliationGroupBy } from "@/lib/kra-kpi/shared";
import {
  getRewardConsoleAccessScope,
  getRewardReconciliation,
  RewardAccessDeniedError,
} from "@/lib/kra-kpi/reward-ops-service";

const VALID_GROUPS = new Set<RewardReconciliationGroupBy>(["benefitType", "unit", "kra"]);

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.tenantId) {
    return NextResponse.json(
      { status: "error", message: "You do not have permission to view rewards." },
      { status: 403 },
    );
  }

  const { searchParams } = new URL(request.url);
  const periodId = searchParams.get("periodId") ?? undefined;
  const groupBy = (searchParams.get("groupBy") ?? "benefitType") as RewardReconciliationGroupBy;

  if (!periodId) {
    return NextResponse.json(
      { status: "error", message: "periodId is required." },
      { status: 400 },
    );
  }
  if (!VALID_GROUPS.has(groupBy)) {
    return NextResponse.json(
      { status: "error", message: "groupBy must be one of benefitType, unit, or kra." },
      { status: 400 },
    );
  }

  try {
    const accessScope = await getRewardConsoleAccessScope(
      session.user.tenantId,
      session.user.id,
      (session.user.role ?? "TENANT_USER") as Role,
    );
    const result = await getRewardReconciliation(
      session.user.tenantId,
      periodId,
      groupBy,
      accessScope,
      {
        kraDefinitionId: searchParams.get("kraDefinitionId") ?? undefined,
        kpiDefinitionId: searchParams.get("kpiDefinitionId") ?? undefined,
        achievementId: searchParams.get("achievementId") ?? undefined,
        state: (searchParams.get("state") as "ALL" | "DRAFT" | "PENDING" | "RELEASED" | "REVOKED" | null) ?? undefined,
        benefitTypeCode: searchParams.get("benefitTypeCode") ?? undefined,
        contributorUserId: searchParams.get("contributorUserId") ?? undefined,
        reportedByUserId: searchParams.get("reportedByUserId") ?? undefined,
        unitId: searchParams.get("unitId") ?? undefined,
        createdFrom: searchParams.get("createdFrom") ? new Date(searchParams.get("createdFrom")!) : undefined,
        createdTo: searchParams.get("createdTo") ? new Date(searchParams.get("createdTo")!) : undefined,
        releasedFrom: searchParams.get("releasedFrom") ? new Date(searchParams.get("releasedFrom")!) : undefined,
        releasedTo: searchParams.get("releasedTo") ? new Date(searchParams.get("releasedTo")!) : undefined,
      },
    );

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof RewardAccessDeniedError) {
      return NextResponse.json(
        { status: "error", message: error.message },
        { status: 403 },
      );
    }
    throw error;
  }
}
