import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { markRead, markAllRead } from "@/lib/notifications/notification-service";

type MarkReadBody =
  | { notificationId: string; all?: never }
  | { all: true; notificationId?: never };

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.tenantId) {
    return NextResponse.json({ status: "error", message: "Not authenticated." }, { status: 403 });
  }

  let body: MarkReadBody;
  try {
    body = (await request.json()) as MarkReadBody;
  } catch {
    return NextResponse.json({ status: "error", message: "Invalid request body." }, { status: 400 });
  }

  if (body.all === true) {
    await markAllRead(session.user.tenantId, session.user.id);
    return NextResponse.json({ status: "success", message: "All notifications marked as read." });
  }

  if (!body.notificationId) {
    return NextResponse.json(
      { status: "error", message: "notificationId is required." },
      { status: 400 },
    );
  }

  await markRead(body.notificationId, session.user.tenantId, session.user.id);
  return NextResponse.json({ status: "success", message: "Notification marked as read." });
}
