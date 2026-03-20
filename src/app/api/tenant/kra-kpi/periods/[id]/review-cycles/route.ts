import type { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { prisma } from "@/lib/prisma";
import {
  listReviewCycles,
  generateReviewCycles,
} from "@/lib/kra-kpi/period-service";
import { getKraKpiActionHttpStatus } from "@/lib/kra-kpi/shared";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.tenantId) {
    return NextResponse.json(
      { status: "error", message: "You do not have tenant access." },
      { status: 403 }
    );
  }

  const { id: periodId } = await params;
  const period = await prisma.assessmentPeriod.findFirst({
    where: { id: periodId, tenantId: session.user.tenantId },
    select: { id: true },
  });
  if (!period) {
    return NextResponse.json(
      { status: "error", message: "Assessment period not found." },
      { status: 404 },
    );
  }

  const cycles = await listReviewCycles(periodId, session.user.tenantId);
  return NextResponse.json({ cycles });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.tenantId || !session.user.role) {
    return NextResponse.json(
      { status: "error", message: "You do not have tenant access." },
      { status: 403 }
    );
  }

  const { id: periodId } = await params;
  const result = await generateReviewCycles(
    periodId,
    session.user.tenantId,
    session.user.id,
    session.user.role as Role
  );

  return NextResponse.json(result, {
    status: getKraKpiActionHttpStatus(result),
  });
}
