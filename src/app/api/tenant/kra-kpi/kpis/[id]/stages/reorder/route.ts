import type { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { reorderStages } from "@/lib/kra-kpi/stage-service";

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

  let body: { orderedIds: string[] };
  try {
    body = (await request.json()) as { orderedIds: string[] };
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid request body." },
      { status: 400 },
    );
  }

  if (!Array.isArray(body.orderedIds)) {
    return NextResponse.json(
      { status: "error", message: "orderedIds must be an array." },
      { status: 400 },
    );
  }

  const result = await reorderStages(
    id,
    session.user.tenantId,
    body.orderedIds,
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
