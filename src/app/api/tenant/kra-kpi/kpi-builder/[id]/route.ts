import type { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import {
  getKpiBuilder,
  saveKpiBuilder,
} from "@/lib/kra-kpi/kpi-builder-service";
import type { KpiBuilderPayload } from "@/lib/kra-kpi/builder-shared";
import { getKraKpiActionHttpStatus } from "@/lib/kra-kpi/shared";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.tenantId) {
    return NextResponse.json(
      { status: "error", message: "You do not have tenant access." },
      { status: 403 },
    );
  }

  const { id } = await params;
  const payload = await getKpiBuilder(id, session.user.tenantId);
  if (!payload) {
    return NextResponse.json(
      { status: "error", message: "KPI builder not found." },
      { status: 404 },
    );
  }

  return NextResponse.json(payload);
}

export async function PUT(
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

  let body: KpiBuilderPayload;
  try {
    body = (await request.json()) as KpiBuilderPayload;
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid request body." },
      { status: 400 },
    );
  }

  const result = await saveKpiBuilder(
    session.user.tenantId,
    {
      ...body,
      definition: {
        ...body.definition,
        id,
      },
    },
    session.user.id,
    session.user.role as Role,
  );

  return NextResponse.json(result, {
    status: getKraKpiActionHttpStatus(result, 200),
  });
}
