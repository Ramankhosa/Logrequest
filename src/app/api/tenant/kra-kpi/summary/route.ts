import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { getPeriodSummary } from "@/lib/kra-kpi/achievement-service";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.tenantId) {
    return NextResponse.json(
      { status: "error", message: "You do not have tenant access." },
      { status: 403 },
    );
  }

  const { searchParams } = new URL(request.url);
  const periodId = searchParams.get("periodId");

  if (!periodId) {
    return NextResponse.json(
      { status: "error", message: "periodId query parameter is required." },
      { status: 400 },
    );
  }

  const summary = await getPeriodSummary(periodId, session.user.tenantId);

  if (!summary) {
    return NextResponse.json(
      { status: "error", message: "Period not found." },
      { status: 404 },
    );
  }

  return NextResponse.json(summary);
}
