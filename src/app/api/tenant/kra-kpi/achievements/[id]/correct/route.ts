import type { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import {
  correctVerifiedAchievement,
  type UpdateAchievementInput,
} from "@/lib/kra-kpi/achievement-service";

type CorrectAchievementBody = UpdateAchievementInput & {
  note?: string;
};

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

  let body: CorrectAchievementBody;
  try {
    body = (await request.json()) as CorrectAchievementBody;
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid request body." },
      { status: 400 },
    );
  }

  const { note, ...input } = body;
  const result = await correctVerifiedAchievement(
    id,
    session.user.tenantId,
    input,
    note ?? null,
    session.user.id,
    session.user.role as Role,
  );

  return NextResponse.json(result, {
    status: result.status === "success" ? 200 : 400,
  });
}
