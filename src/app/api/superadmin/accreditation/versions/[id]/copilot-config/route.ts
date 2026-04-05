import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import {
  getSuperadminVersionCopilotConfig,
  updateSuperadminVersionCopilotConfig,
} from "@/lib/accreditation/copilot-version-service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.isSuperadmin) {
    return NextResponse.json({ status: "error", message: "Superadmin access required." }, { status: 403 });
  }

  const { id } = await params;
  const result = await getSuperadminVersionCopilotConfig(id);
  return NextResponse.json(result, { status: result.status === "success" ? 200 : 404 });
}

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
  const result = await updateSuperadminVersionCopilotConfig(id, body);
  return NextResponse.json(result, { status: result.status === "success" ? 200 : 400 });
}
