import type { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import {
  exportRewardsCsv,
  getRewardConsoleAccessScope,
  RewardAccessDeniedError,
} from "@/lib/kra-kpi/reward-ops-service";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.tenantId) {
    return NextResponse.json(
      { status: "error", message: "You do not have permission to export rewards." },
      { status: 403 },
    );
  }

  const { searchParams } = new URL(request.url);
  const periodId = searchParams.get("periodId") ?? undefined;
  if (!periodId) {
    return NextResponse.json(
      { status: "error", message: "periodId is required." },
      { status: 400 },
    );
  }

  try {
    const accessScope = await getRewardConsoleAccessScope(
      session.user.tenantId,
      session.user.id,
      (session.user.role ?? "TENANT_USER") as Role,
    );
    const { filename, content } = await exportRewardsCsv(
      session.user.tenantId,
      {
        periodId,
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
      accessScope,
    );

    return new Response(content, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename=\"${filename}\"`,
        "Cache-Control": "no-store",
      },
    });
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
