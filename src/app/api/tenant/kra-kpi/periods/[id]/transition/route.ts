import type { Role, AssessmentPeriodState } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { transitionPeriodState } from "@/lib/kra-kpi/period-service";

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

  const { id } = await params;

  let body: { newState: AssessmentPeriodState };
  try {
    body = (await request.json()) as { newState: AssessmentPeriodState };
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid request body." },
      { status: 400 },
    );
  }

  if (!body.newState) {
    return NextResponse.json(
      { status: "error", message: "newState is required." },
      { status: 400 },
    );
  }

  const result = await transitionPeriodState(
    id,
    session.user.tenantId,
    body.newState,
    session.user.id,
    session.user.role as Role,
  );

  return NextResponse.json(result, {
    status: result.status === "success" ? 200 : 400,
  });
}
