import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { getMyDashboardSummary } from "@/lib/kra-kpi/my-kpi-service";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.tenantId) {
    return NextResponse.json(
      { status: "error", message: "Not authenticated." },
      { status: 403 },
    );
  }

  const { searchParams } = new URL(request.url);
  const periodId = searchParams.get("periodId");
  if (!periodId) {
    return NextResponse.json(
      { status: "error", message: "periodId is required." },
      { status: 400 },
    );
  }

  const summary = await getMyDashboardSummary(
    session.user.tenantId,
    session.user.id,
    periodId,
  );
  if (!summary) {
    return NextResponse.json(
      { status: "error", message: "Period not found." },
      { status: 404 },
    );
  }
  return NextResponse.json(summary);
}
