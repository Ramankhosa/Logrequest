import type { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { transitionContributorRewards } from "@/lib/kra-kpi/reward-ops-service";

type TransitionBody = {
  rewardIds: string[];
  nextState: "DRAFT" | "PENDING" | "RELEASED" | "REVOKED";
  note?: string;
  releaseReference?: string;
};

function canManageRewards(role: string | null | undefined): boolean {
  return role === "TENANT_OWNER" || role === "TENANT_ADMIN" || role === "SUPERADMIN";
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.tenantId || !canManageRewards(session.user.role)) {
    return NextResponse.json(
      { status: "error", message: "You do not have permission to manage rewards." },
      { status: 403 },
    );
  }

  let body: TransitionBody;
  try {
    body = (await request.json()) as TransitionBody;
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid request body." },
      { status: 400 },
    );
  }

  if (!Array.isArray(body.rewardIds) || body.rewardIds.length === 0) {
    return NextResponse.json(
      { status: "error", message: "rewardIds is required." },
      { status: 400 },
    );
  }

  const result = await transitionContributorRewards(
    session.user.tenantId,
    body.rewardIds,
    body.nextState,
    session.user.id,
    session.user.role as Role,
    {
      note: body.note ?? null,
      releaseReference: body.releaseReference ?? null,
    },
  );

  return NextResponse.json({
    status: result.failed.length === 0 ? "success" : "partial",
    ...result,
  });
}
