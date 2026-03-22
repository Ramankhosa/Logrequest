import type { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { markStageComplete, type MarkStageCompleteInput } from "@/lib/kra-kpi/stage-progress-service";

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

  let body: MarkStageCompleteInput = {};
  try {
    body = (await request.json()) as MarkStageCompleteInput;
  } catch {
    // body is optional for stages without evidence
  }

  const result = await markStageComplete(
    id,
    session.user.tenantId,
    body,
    session.user.id,
    session.user.role as Role,
  );

  if (!result.ok) {
    return NextResponse.json(
      { status: "error", message: result.message },
      { status: 400 },
    );
  }

  return NextResponse.json({ status: "success", message: "Stage marked as complete." });
}
