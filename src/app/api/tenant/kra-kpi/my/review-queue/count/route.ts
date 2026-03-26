import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { getMyPendingCount } from "@/lib/kra-kpi/my-kpi-service";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.tenantId) {
    return NextResponse.json(
      { status: "error", message: "Not authenticated." },
      { status: 403 },
    );
  }

  const count = await getMyPendingCount(
    session.user.tenantId,
    session.user.id,
  );
  return NextResponse.json({ count });
}
