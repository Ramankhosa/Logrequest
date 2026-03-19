import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { getUnreadCount } from "@/lib/notifications/notification-service";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.tenantId) {
    return NextResponse.json({ status: "error", message: "Not authenticated." }, { status: 403 });
  }

  const count = await getUnreadCount(session.user.tenantId, session.user.id);
  return NextResponse.json({ count });
}
