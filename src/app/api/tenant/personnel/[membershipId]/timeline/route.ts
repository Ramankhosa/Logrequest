import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { getPersonnelTimeline } from "@/lib/personnel/service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ membershipId: string }> },
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.tenantId || !session.user.role) {
    return NextResponse.json(
      { status: "error", message: "You do not have tenant access." },
      { status: 403 },
    );
  }

  const { membershipId } = await params;

  const timeline = await getPersonnelTimeline(
    session.user.tenantId,
    membershipId,
  );

  return NextResponse.json(timeline);
}
