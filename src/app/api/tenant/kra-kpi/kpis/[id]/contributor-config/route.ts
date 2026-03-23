import type { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import {
  getConfig,
  getEffectiveConfig,
  setConfig,
  type SetKpiContributorConfigInput,
} from "@/lib/kra-kpi/kpi-contributor-config-service";
import { getKraKpiActionHttpStatus } from "@/lib/kra-kpi/shared";

export async function GET(
  request: Request,
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
  const { searchParams } = new URL(request.url);
  const includeRaw = searchParams.get("includeRaw") === "true";

  const effectiveConfig = await getEffectiveConfig(id, session.user.tenantId);
  if (!effectiveConfig) {
    return NextResponse.json(
      { status: "error", message: "KPI not found." },
      { status: 404 },
    );
  }

  if (!includeRaw) {
    return NextResponse.json(effectiveConfig);
  }

  const config = await getConfig(id, session.user.tenantId);
  return NextResponse.json({
    config,
    effectiveConfig,
  });
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

  let body: SetKpiContributorConfigInput;
  try {
    body = (await request.json()) as SetKpiContributorConfigInput;
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid request body." },
      { status: 400 },
    );
  }

  const result = await setConfig(
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
