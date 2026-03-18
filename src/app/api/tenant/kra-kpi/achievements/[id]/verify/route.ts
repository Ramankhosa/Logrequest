import type { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { verifyAchievement } from "@/lib/kra-kpi/achievement-service";

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

  let body: { approved: boolean; note?: string };
  try {
    body = (await request.json()) as { approved: boolean; note?: string };
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid request body." },
      { status: 400 },
    );
  }

  if (typeof body.approved !== "boolean") {
    return NextResponse.json(
      { status: "error", message: "approved (boolean) is required." },
      { status: 400 },
    );
  }

  const result = await verifyAchievement(
    id,
    session.user.tenantId,
    body.approved,
    body.note ?? null,
    session.user.id,
    session.user.role as Role,
  );

  return NextResponse.json(result, {
    status: result.status === "success" ? 200 : 400,
  });
}
