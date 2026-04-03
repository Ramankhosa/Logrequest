import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { listKpisForCriterion } from "@/lib/accreditation/service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.tenantId) {
    return NextResponse.json({ status: "error", message: "You do not have tenant access." }, { status: 403 });
  }

  const { id } = await params;
  const result = await listKpisForCriterion(session.user.tenantId, id);
  return NextResponse.json(result, { status: result.status === "success" ? 200 : 403 });
}
