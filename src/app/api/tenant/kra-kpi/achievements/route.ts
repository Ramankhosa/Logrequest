import type { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import {
  listAchievements,
  recordAchievement,
  type CreateAchievementInput,
} from "@/lib/kra-kpi/achievement-service";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.tenantId) {
    return NextResponse.json(
      { status: "error", message: "You do not have tenant access." },
      { status: 403 },
    );
  }

  const { searchParams } = new URL(request.url);
  const filters: Record<string, string> = {};

  const periodId = searchParams.get("periodId");
  const kpiDefinitionId = searchParams.get("kpiDefinitionId");
  const targetAllocationId = searchParams.get("targetAllocationId");
  const reportedByUserId = searchParams.get("reportedByUserId");
  const state = searchParams.get("state");

  if (periodId) filters.periodId = periodId;
  if (kpiDefinitionId) filters.kpiDefinitionId = kpiDefinitionId;
  if (targetAllocationId) filters.targetAllocationId = targetAllocationId;
  if (reportedByUserId) filters.reportedByUserId = reportedByUserId;
  if (state) filters.state = state;

  const achievements = await listAchievements(session.user.tenantId, filters);
  return NextResponse.json(achievements);
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.tenantId || !session.user.role) {
    return NextResponse.json(
      { status: "error", message: "You do not have tenant access." },
      { status: 403 },
    );
  }

  let body: CreateAchievementInput;
  try {
    body = (await request.json()) as CreateAchievementInput;
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid request body." },
      { status: 400 },
    );
  }

  const result = await recordAchievement(
    session.user.tenantId,
    body,
    session.user.id,
    session.user.role as Role,
  );

  return NextResponse.json(result, {
    status: result.status === "success" ? 201 : 400,
  });
}
