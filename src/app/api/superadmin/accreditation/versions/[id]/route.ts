import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { updateSuperadminBodyVersion } from "@/lib/accreditation/service";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.isSuperadmin) {
    return NextResponse.json({ status: "error", message: "Superadmin access required." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ status: "error", message: "Invalid request body." }, { status: 400 });
  }

  const { id } = await params;
  const result = await updateSuperadminBodyVersion(id, body);
  return NextResponse.json(result, { status: result.status === "success" ? 200 : 400 });
}
