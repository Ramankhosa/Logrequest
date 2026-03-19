import type { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import {
  changeKraState,
  type ChangeKraStateInput,
} from "@/lib/kra-kpi/kra-service";

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

  let body: ChangeKraStateInput;
  try {
    body = (await request.json()) as ChangeKraStateInput;
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid request body." },
      { status: 400 },
    );
  }

  const { id } = await params;
  const result = await changeKraState(
    id,
    session.user.tenantId,
    body,
    session.user.id,
    session.user.role as Role,
  );

  return NextResponse.json(result, {
    status: result.status === "success" ? 200 : 400,
  });
}
