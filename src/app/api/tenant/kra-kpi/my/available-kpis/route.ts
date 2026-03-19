import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { getAvailableKpis } from "@/lib/kra-kpi/my-kpi-service";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.tenantId) {
    return NextResponse.json({ status: "error", message: "Not authenticated." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const periodId = searchParams.get("periodId");
  if (!periodId) {
    return NextResponse.json({ status: "error", message: "periodId is required." }, { status: 400 });
  }

  const search = searchParams.get("search") ?? undefined;
  const category = searchParams.get("category") ?? undefined;

  const kpis = await getAvailableKpis(
    session.user.tenantId,
    session.user.id,
    periodId,
    search,
    category,
  );

  return NextResponse.json(kpis);
}
