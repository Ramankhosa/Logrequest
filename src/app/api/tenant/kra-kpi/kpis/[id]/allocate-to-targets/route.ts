import type { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { allocateToTargetUnits } from "@/lib/kra-kpi/target-service";
import { getKraKpiActionHttpStatus } from "@/lib/kra-kpi/shared";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.tenantId || !session.user.role) {
    return NextResponse.json(
      { status: "error", message: "You do not have tenant access." },
      { status: 403 }
    );
  }

  const { id: kpiId } = await params;

  let body: {
    periodId: string;
    targetValue?: number;
    targetDate?: string;
    targetMilestone?: string;
    targetGrade?: string;
    targetBoolean?: boolean;
    targetRating?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid request body." },
      { status: 400 }
    );
  }

  if (!body.periodId) {
    return NextResponse.json(
      { status: "error", message: "periodId is required." },
      { status: 400 }
    );
  }

  const result = await allocateToTargetUnits(
    kpiId,
    body.periodId,
    session.user.tenantId,
    {
      targetValue: body.targetValue,
      targetDate: body.targetDate ? new Date(body.targetDate) : undefined,
      targetMilestone: body.targetMilestone,
      targetGrade: body.targetGrade,
      targetBoolean: body.targetBoolean,
      targetRating: body.targetRating,
    },
    session.user.id,
    session.user.role as Role
  );

  return NextResponse.json(result, {
    status: getKraKpiActionHttpStatus(result),
  });
}
