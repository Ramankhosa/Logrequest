import type { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import {
  listStages,
  createStage,
  type CreateStageInput,
} from "@/lib/kra-kpi/stage-service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.tenantId) {
    return NextResponse.json(
      { status: "error", message: "You do not have tenant access." },
      { status: 403 },
    );
  }

  const { id } = await params;
  const stages = await listStages(id, session.user.tenantId);
  return NextResponse.json(stages);
}

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

  let body: CreateStageInput;
  try {
    body = (await request.json()) as CreateStageInput;
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid request body." },
      { status: 400 },
    );
  }

  const result = await createStage(
    id,
    session.user.tenantId,
    body,
    session.user.id,
    session.user.role as Role,
  );

  if (!result.ok) {
    return NextResponse.json(
      { status: "error", message: result.message },
      { status: result.code === "FORBIDDEN" ? 403 : 400 },
    );
  }

  return NextResponse.json(
    { status: "success", message: result.message, data: result.data },
    { status: 201 },
  );
}
