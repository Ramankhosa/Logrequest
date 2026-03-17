import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { getUnitMembers } from "@/lib/org-structure/roles-service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ unitId: string }> },
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.tenantId) {
    return NextResponse.json(
      { status: "error", message: "You do not have tenant access." },
      { status: 403 },
    );
  }

  const { unitId } = await params;
  const members = await getUnitMembers(session.user.tenantId, unitId);

  return NextResponse.json({ status: "success", data: members });
}
