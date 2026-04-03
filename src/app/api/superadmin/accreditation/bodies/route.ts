import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import {
  createSuperadminAccreditationBody,
  listSuperadminAccreditationBodies,
} from "@/lib/accreditation/service";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.isSuperadmin) {
    return NextResponse.json({ status: "error", message: "Superadmin access required." }, { status: 403 });
  }

  const bodies = await listSuperadminAccreditationBodies();
  return NextResponse.json({ status: "success", bodies });
}

export async function POST(request: Request) {
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

  const result = await createSuperadminAccreditationBody(body, session.user.id);
  return NextResponse.json(result, { status: result.status === "success" ? 201 : 400 });
}
