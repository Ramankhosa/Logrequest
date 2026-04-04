import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { publishSuperadminVersionBlocks } from "@/lib/accreditation/block-template-service";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.isSuperadmin) {
    return NextResponse.json({ status: "error", message: "Superadmin access required." }, { status: 403 });
  }

  const { id } = await params;
  const result = await publishSuperadminVersionBlocks(id, session.user.id);
  return NextResponse.json(result, { status: result.status === "success" ? 200 : 400 });
}
