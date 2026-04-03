import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { listEnabledTenantServiceCodes } from "@/lib/tenant-services/service";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.tenantId) {
    return NextResponse.json(
      { status: "error", message: "You do not have tenant access." },
      { status: 403 },
    );
  }

  const enabledServices = await listEnabledTenantServiceCodes(session.user.tenantId);
  return NextResponse.json({ status: "success", enabledServices });
}
