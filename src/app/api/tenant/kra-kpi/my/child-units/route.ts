import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { getMyChildUnits } from "@/lib/kra-kpi/my-kpi-service";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.tenantId) {
    return NextResponse.json(
      { status: "error", message: "Not authenticated." },
      { status: 403 },
    );
  }

  const { searchParams } = new URL(request.url);
  const unitId = searchParams.get("unitId");
  if (!unitId) {
    return NextResponse.json(
      { status: "error", message: "unitId is required." },
      { status: 400 },
    );
  }

  const childUnits = await getMyChildUnits(session.user.tenantId, unitId);
  return NextResponse.json(childUnits);
}
