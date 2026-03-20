import type { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { prisma } from "@/lib/prisma";
import {
  listTargetUnits,
  addTargetUnit,
  removeTargetUnit,
  updateTargetUnit,
} from "@/lib/kra-kpi/kpi-service";
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

  const { id: kpiId } = await params;
  const kpi = await prisma.kpiDefinition.findFirst({
    where: { id: kpiId, kraDefinition: { tenantId: session.user.tenantId } },
    select: { id: true },
  });
  if (!kpi) {
    return NextResponse.json(
      { status: "error", message: "KPI not found." },
      { status: 404 },
    );
  }

  const targetUnits = await listTargetUnits(kpiId, session.user.tenantId);
  return NextResponse.json({ targetUnits });
}

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

  let body: { unitId: string; targetShare?: number; notes?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid request body." },
      { status: 400 }
    );
  }

  const result = await addTargetUnit(
    kpiId,
    session.user.tenantId,
    body.unitId,
    body.targetShare ?? null,
    body.notes ?? null,
    session.user.id,
    session.user.role as Role
  );

  return NextResponse.json(result, {
    status: getKraKpiActionHttpStatus(result, 201),
  });
}

export async function DELETE(
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

  let body: { unitId: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid request body." },
      { status: 400 }
    );
  }

  const result = await removeTargetUnit(
    kpiId,
    session.user.tenantId,
    body.unitId,
    session.user.id,
    session.user.role as Role
  );

  return NextResponse.json(result, {
    status: getKraKpiActionHttpStatus(result),
  });
}

export async function PATCH(
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

  let body: { unitId: string; targetShare?: number; notes?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid request body." },
      { status: 400 }
    );
  }

  const result = await updateTargetUnit(
    kpiId,
    session.user.tenantId,
    body.unitId,
    body.targetShare ?? null,
    body.notes ?? null,
    session.user.id,
    session.user.role as Role
  );

  return NextResponse.json(result, {
    status: getKraKpiActionHttpStatus(result),
  });
}
