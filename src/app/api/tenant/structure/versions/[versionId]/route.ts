import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { getVersionDetail } from "@/lib/org-structure/service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ versionId: string }> },
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.tenantId) {
    return NextResponse.json(
      { status: "error", message: "You do not have tenant access." },
      { status: 403 },
    );
  }

  const { versionId } = await params;
  const detail = await getVersionDetail(session.user.tenantId, versionId);

  if (!detail) {
    return NextResponse.json(
      { status: "error", message: "Version not found." },
      { status: 404 },
    );
  }

  return NextResponse.json({ status: "success", data: detail });
}
