import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { getTransferableTargets } from "@/lib/personnel/transfer-service";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.tenantId || !session.user.role) {
    return NextResponse.json(
      { status: "error", message: "You do not have tenant access." },
      { status: 403 },
    );
  }

  if (
    session.user.role !== Role.TENANT_OWNER &&
    session.user.role !== Role.TENANT_ADMIN
  ) {
    return NextResponse.json(
      { status: "error", message: "Permission denied." },
      { status: 403 },
    );
  }

  const { searchParams } = new URL(request.url);
  const effectiveDate = searchParams.get("effectiveDate");
  const result = await getTransferableTargets({
    tenantId: session.user.tenantId,
    membershipId: searchParams.get("membershipId") ?? "",
    sourceUnitId: searchParams.get("sourceUnitId") ?? undefined,
    effectiveDate: effectiveDate ? new Date(effectiveDate) : undefined,
  });

  return NextResponse.json(result, {
    status: result.status === "success" ? 200 : 400,
  });
}
