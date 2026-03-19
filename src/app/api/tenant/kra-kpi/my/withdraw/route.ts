import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { withdrawAchievement } from "@/lib/kra-kpi/achievement-service";

type WithdrawBody = {
  achievementId: string;
};

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.tenantId) {
    return NextResponse.json(
      { status: "error", message: "Not authenticated." },
      { status: 403 },
    );
  }

  let body: WithdrawBody;
  try {
    body = (await request.json()) as WithdrawBody;
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

  const result = await withdrawAchievement(
    body.achievementId,
    session.user.tenantId,
    session.user.id,
  );

  return NextResponse.json(result, {
    status: result.status === "success" ? 200 : 400,
  });
}
