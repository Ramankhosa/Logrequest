import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { publishOrgStructure } from "@/lib/org-structure/service";

export async function POST() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.tenantId || !session.user.role) {
    return NextResponse.json(
      {
        status: "error",
        message: "You do not have tenant access.",
      },
      { status: 403 },
    );
  }

  const result = await publishOrgStructure({
    tenantId: session.user.tenantId,
    actorUserId: session.user.id,
    actorRole: session.user.role as Role,
  });

  return NextResponse.json(result, {
    status: result.status === "success" ? 200 : 400,
  });
}
