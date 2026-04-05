import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import {
  createPlatformLlmModel,
  listPlatformLlmModels,
  updatePlatformLlmModel,
} from "@/lib/llm/model-registry";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.isSuperadmin) {
    return NextResponse.json({ status: "error", message: "Superadmin access required." }, { status: 403 });
  }

  const models = await listPlatformLlmModels();
  return NextResponse.json({ status: "success", models });
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

  const result = await createPlatformLlmModel(body);
  return NextResponse.json(result, { status: result.status === "success" ? 201 : 400 });
}

export async function PATCH(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.isSuperadmin) {
    return NextResponse.json({ status: "error", message: "Superadmin access required." }, { status: 403 });
  }

  let body: { id?: string } & Record<string, unknown>;
  try {
    body = (await request.json()) as { id?: string } & Record<string, unknown>;
  } catch {
    return NextResponse.json({ status: "error", message: "Invalid request body." }, { status: 400 });
  }

  if (!body.id) {
    return NextResponse.json({ status: "error", message: "Model id is required." }, { status: 400 });
  }

  const { id, ...patch } = body;
  const result = await updatePlatformLlmModel(id, patch);
  return NextResponse.json(result, { status: result.status === "success" ? 200 : 400 });
}
