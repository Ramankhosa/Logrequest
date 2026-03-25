import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { listContributorRewards } from "@/lib/kra-kpi/reward-ops-service";

function canManageRewards(role: string | null | undefined): boolean {
  return role === "TENANT_OWNER" || role === "TENANT_ADMIN" || role === "SUPERADMIN";
}

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.tenantId || !canManageRewards(session.user.role)) {
    return NextResponse.json(
      { status: "error", message: "You do not have permission to view rewards." },
      { status: 403 },
    );
  }

  const { searchParams } = new URL(request.url);
  const limit = searchParams.get("limit");
  const offset = searchParams.get("offset");
  const createdFrom = searchParams.get("createdFrom");
  const createdTo = searchParams.get("createdTo");
  const releasedFrom = searchParams.get("releasedFrom");
  const releasedTo = searchParams.get("releasedTo");

  const result = await listContributorRewards(session.user.tenantId, {
    periodId: searchParams.get("periodId") ?? undefined,
    kraDefinitionId: searchParams.get("kraDefinitionId") ?? undefined,
    kpiDefinitionId: searchParams.get("kpiDefinitionId") ?? undefined,
    achievementId: searchParams.get("achievementId") ?? undefined,
    state: (searchParams.get("state") as "ALL" | "DRAFT" | "PENDING" | "RELEASED" | "REVOKED" | null) ?? undefined,
    benefitTypeCode: searchParams.get("benefitTypeCode") ?? undefined,
    contributorUserId: searchParams.get("contributorUserId") ?? undefined,
    reportedByUserId: searchParams.get("reportedByUserId") ?? undefined,
    unitId: searchParams.get("unitId") ?? undefined,
    createdFrom: createdFrom ? new Date(createdFrom) : undefined,
    createdTo: createdTo ? new Date(createdTo) : undefined,
    releasedFrom: releasedFrom ? new Date(releasedFrom) : undefined,
    releasedTo: releasedTo ? new Date(releasedTo) : undefined,
    limit: limit ? Number(limit) : undefined,
    offset: offset ? Number(offset) : undefined,
  });

  return NextResponse.json(result);
}
