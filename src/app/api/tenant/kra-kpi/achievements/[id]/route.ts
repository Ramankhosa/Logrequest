import type { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import {
  getAchievementById,
  updateAchievement,
  type UpdateAchievementInput,
} from "@/lib/kra-kpi/achievement-service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.tenantId || !session.user.role) {
    return NextResponse.json(
      { status: "error", message: "You do not have tenant access." },
      { status: 403 },
    );
  }

  const { id } = await params;
  const achievement = await getAchievementById(id, session.user.tenantId);
  if (!achievement) {
    return NextResponse.json(
      { status: "error", message: "Achievement not found." },
      { status: 404 },
    );
  }

  const canAccess =
    achievement.reportedByUserId === session.user.id ||
    session.user.role === "TENANT_ADMIN" ||
    session.user.role === "TENANT_OWNER" ||
    session.user.role === "SUPERADMIN";
  if (!canAccess) {
    return NextResponse.json(
      { status: "error", message: "You are not allowed to view this achievement." },
      { status: 403 },
    );
  }

  return NextResponse.json(achievement);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.tenantId || !session.user.role) {
    return NextResponse.json(
      { status: "error", message: "You do not have tenant access." },
      { status: 403 },
    );
  }

  const { id } = await params;

  let body: UpdateAchievementInput;
  try {
    body = (await request.json()) as UpdateAchievementInput;
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid request body." },
      { status: 400 },
    );
  }

  const result = await updateAchievement(
    id,
    session.user.tenantId,
    body,
    session.user.id,
    session.user.role as Role,
  );

  return NextResponse.json(result, {
    status: result.status === "success" ? 200 : 400,
  });
}
