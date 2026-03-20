import type { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import {
  copyKrasFromPeriod,
  type CopyKrasFromPeriodInput,
} from "@/lib/kra-kpi/kra-service";
import { getKraKpiActionHttpStatus } from "@/lib/kra-kpi/shared";

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

  let body: CopyKrasFromPeriodInput;
  try {
    body = (await request.json()) as CopyKrasFromPeriodInput;
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid request body." },
      { status: 400 },
    );
  }

  const { id } = await params;
  const result = await copyKrasFromPeriod(
    id,
    session.user.tenantId,
    body,
    session.user.id,
    session.user.role as Role,
  );

  return NextResponse.json(result, {
    status: getKraKpiActionHttpStatus(result),
  });
}
