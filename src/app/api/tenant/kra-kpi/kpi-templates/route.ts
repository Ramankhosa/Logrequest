import type { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import type { KpiTemplateWriteInput } from "@/lib/kra-kpi/builder-shared";
import {
  createKpiTemplate,
  listKpiTemplates,
} from "@/lib/kra-kpi/kpi-template-service";
import { getKraKpiActionHttpStatus } from "@/lib/kra-kpi/shared";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.tenantId) {
    return NextResponse.json(
      { status: "error", message: "You do not have tenant access." },
      { status: 403 },
    );
  }

  const templates = await listKpiTemplates(session.user.tenantId);
  return NextResponse.json(templates);
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.tenantId || !session.user.role) {
    return NextResponse.json(
      { status: "error", message: "You do not have tenant access." },
      { status: 403 },
    );
  }

  let body: KpiTemplateWriteInput;
  try {
    body = (await request.json()) as KpiTemplateWriteInput;
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid request body." },
      { status: 400 },
    );
  }

  const result = await createKpiTemplate(
    session.user.tenantId,
    body,
    session.user.id,
    session.user.role as Role,
  );

  return NextResponse.json(result, {
    status: getKraKpiActionHttpStatus(result, 201),
  });
}
