import type { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { deleteAccreditationLink } from "@/lib/accreditation/service";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.tenantId || !session.user.role) {
    return NextResponse.json({ status: "error", message: "You do not have tenant access." }, { status: 403 });
  }

  const { id } = await params;
  const result = await deleteAccreditationLink(
    session.user.tenantId,
    id,
    session.user.id,
    session.user.role as Role,
  );
  return NextResponse.json(result, { status: result.status === "success" ? 200 : 400 });
}
