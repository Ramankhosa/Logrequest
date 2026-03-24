import type { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import type { KpiTemplateWriteInput } from "@/lib/kra-kpi/builder-shared";
import {
  getKpiTemplate,
  updateKpiTemplate,
} from "@/lib/kra-kpi/kpi-template-service";
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
  const template = await getKpiTemplate(id, session.user.tenantId);
  if (!template) {
    return NextResponse.json(
      { status: "error", message: "KPI template not found." },
      { status: 404 },
    );
  }

  return NextResponse.json(template);
}

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

  let body: Partial<KpiTemplateWriteInput>;
  try {
    body = (await request.json()) as Partial<KpiTemplateWriteInput>;
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid request body." },
      { status: 400 },
    );
  }

  const result = await updateKpiTemplate(
    id,
    session.user.tenantId,
    body,
    session.user.id,
    session.user.role as Role,
  );

  return NextResponse.json(result, {
    status: getKraKpiActionHttpStatus(result, 200),
  });
}
