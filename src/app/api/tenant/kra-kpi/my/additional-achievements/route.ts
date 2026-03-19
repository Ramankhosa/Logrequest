import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { listAdditionalAchievements } from "@/lib/kra-kpi/my-kpi-service";
import { recordAdditionalAchievement } from "@/lib/kra-kpi/achievement-service";
import type { Role } from "@prisma/client";
import type { CreateAchievementInput } from "@/lib/kra-kpi/achievement-service";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.tenantId) {
    return NextResponse.json({ status: "error", message: "Not authenticated." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const periodId = searchParams.get("periodId");
  if (!periodId) {
    return NextResponse.json({ status: "error", message: "periodId is required." }, { status: 400 });
  }

  const achievements = await listAdditionalAchievements(
    session.user.tenantId,
    session.user.id,
    periodId,
  );

  return NextResponse.json(achievements);
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.tenantId) {
    return NextResponse.json({ status: "error", message: "Not authenticated." }, { status: 403 });
  }

  let body: CreateAchievementInput;
  try {
    body = (await request.json()) as CreateAchievementInput;
  } catch {
    return NextResponse.json({ status: "error", message: "Invalid request body." }, { status: 400 });
  }

  const result = await recordAdditionalAchievement(
    session.user.tenantId,
    body,
    session.user.id,
    (session.user.role ?? "TENANT_USER") as Role,
  );

  return NextResponse.json(result, {
    status: result.status === "success" ? 200 : 400,
  });
}
