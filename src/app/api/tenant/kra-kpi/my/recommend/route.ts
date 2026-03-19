import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import {
  recommendAchievement,
  verifyAchievement,
} from "@/lib/kra-kpi/achievement-service";
import type { Role } from "@prisma/client";

type RecommendBody = {
  achievementId: string;
  approved: boolean;
  note?: string;
  level: "RECOMMEND" | "VERIFY";
};

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.tenantId) {
    return NextResponse.json(
      { status: "error", message: "Not authenticated." },
      { status: 403 },
    );
  }

  let body: RecommendBody;
  try {
    body = (await request.json()) as RecommendBody;
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid request body." },
      { status: 400 },
    );
  }

  if (!body.achievementId) {
    return NextResponse.json(
      { status: "error", message: "achievementId is required." },
      { status: 400 },
    );
  }

  let result;
  if (body.level === "VERIFY") {
    result = await verifyAchievement(
      body.achievementId,
      session.user.tenantId,
      body.approved,
      body.note ?? null,
      session.user.id,
      (session.user.role ?? "TENANT_USER") as Role,
    );
  } else {
    result = await recommendAchievement(
      body.achievementId,
      session.user.tenantId,
      body.approved,
      body.note ?? null,
      session.user.id,
      (session.user.role ?? "TENANT_USER") as Role,
    );
  }

  return NextResponse.json(result, {
    status: result.status === "success" ? 200 : 400,
  });
}
