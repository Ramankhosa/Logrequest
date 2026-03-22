import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { resubmitAchievement } from "@/lib/kra-kpi/achievement-service";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.tenantId) {
    return NextResponse.json(
      { status: "error", message: "You do not have tenant access." },
      { status: 403 },
    );
  }

  const { id } = await params;

  // Resubmit uses the existing withdraw flow: REJECTED/SUBMITTED → DRAFT
  // The employee can then edit and re-submit
  const result = await resubmitAchievement(
    id,
    session.user.tenantId,
    session.user.id,
  );

  return NextResponse.json(result, {
    status: result.status === "success" ? 200 : 400,
  });
}
