import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { llmProviderRouter } from "@/lib/llm/provider-router";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.isSuperadmin) {
    return NextResponse.json({ status: "error", message: "Superadmin access required." }, { status: 403 });
  }

  const providers = await llmProviderRouter.getHealth();
  return NextResponse.json({ status: "success", providers });
}
