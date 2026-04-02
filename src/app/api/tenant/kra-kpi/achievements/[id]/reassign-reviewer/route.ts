import type { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { reassignAchievementWorkflowReviewer } from "@/lib/kra-kpi/workflow-service";

export async function POST(
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

  let body: { nextReviewerUserId?: string; note?: string | null };
  try {
    body = (await request.json()) as { nextReviewerUserId?: string; note?: string | null };
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid request body." },
      { status: 400 },
    );
  }

  const { id } = await params;
  const nextReviewerUserId = body.nextReviewerUserId?.trim();
  if (!nextReviewerUserId) {
    return NextResponse.json(
      { status: "error", message: "Select the next reviewer." },
      { status: 400 },
    );
  }

  const result = await reassignAchievementWorkflowReviewer({
    achievementId: id,
    tenantId: session.user.tenantId,
    actorUserId: session.user.id,
    actorRole: session.user.role as Role,
    nextReviewerUserId,
    note: body.note ?? null,
  });

  return NextResponse.json(result, {
    status: result.status === "success" ? 200 : 400,
  });
}
