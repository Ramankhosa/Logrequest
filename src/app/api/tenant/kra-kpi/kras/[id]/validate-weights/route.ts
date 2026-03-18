import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { getKra } from "@/lib/kra-kpi/kra-service";
import { validateKraWeightages } from "@/lib/kra-kpi/kra-service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.tenantId) {
    return NextResponse.json(
      { status: "error", message: "You do not have tenant access." },
      { status: 403 },
    );
  }

  const { id } = await params;

  const kra = await getKra(id, session.user.tenantId);
  if (!kra) {
    return NextResponse.json(
      { status: "error", message: "KRA not found." },
      { status: 404 },
    );
  }

  const result = await validateKraWeightages(kra.periodId, session.user.tenantId);
  return NextResponse.json(result);
}
