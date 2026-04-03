import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { listTenantAccreditationKpiOptions } from "@/lib/accreditation/service";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.tenantId) {
    return NextResponse.json({ status: "error", message: "You do not have tenant access." }, { status: 403 });
  }

  const result = await listTenantAccreditationKpiOptions(session.user.tenantId);
  return NextResponse.json(result, { status: result.status === "success" ? 200 : 403 });
}
