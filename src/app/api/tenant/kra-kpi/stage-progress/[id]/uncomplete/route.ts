import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { unmarkStageComplete } from "@/lib/kra-kpi/stage-progress-service";

export async function POST(
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

  const result = await unmarkStageComplete(
    id,
    session.user.tenantId,
    session.user.id,
  );

  if (!result.ok) {
    return NextResponse.json(
      { status: "error", message: result.message },
      { status: 400 },
    );
  }

  return NextResponse.json({ status: "success", message: "Stage completion removed." });
}
