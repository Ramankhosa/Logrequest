import type { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import {
  updateStage,
  deleteStage,
  type UpdateStageInput,
} from "@/lib/kra-kpi/stage-service";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; stageId: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.tenantId || !session.user.role) {
    return NextResponse.json(
      { status: "error", message: "You do not have tenant access." },
      { status: 403 },
    );
  }

  const { id, stageId } = await params;

  let body: UpdateStageInput;
  try {
    body = (await request.json()) as UpdateStageInput;
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid request body." },
      { status: 400 },
    );
  }

  const result = await updateStage(
    stageId,
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

  return NextResponse.json({ status: "success", message: result.message });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; stageId: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.tenantId || !session.user.role) {
    return NextResponse.json(
      { status: "error", message: "You do not have tenant access." },
      { status: 403 },
    );
  }

  const { id, stageId } = await params;

  const result = await deleteStage(
    stageId,
    id,
    session.user.tenantId,
    session.user.id,
    session.user.role as Role,
  );

  if (!result.ok) {
    const status = result.code === "FORBIDDEN" ? 403 : result.code === "CONFLICT" ? 409 : 400;
    return NextResponse.json(
      { status: "error", message: result.message },
      { status },
    );
  }

  return NextResponse.json({ status: "success", message: result.message });
}
