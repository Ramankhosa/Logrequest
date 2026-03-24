import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { previewKpiRewards } from "@/lib/kra-kpi/reward-service";
import type { RewardPreviewInput } from "@/lib/kra-kpi/builder-shared";

function isTenantAdmin(role: string | null | undefined) {
  return role === "TENANT_OWNER" || role === "TENANT_ADMIN" || role === "SUPERADMIN";
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.tenantId || !isTenantAdmin(session.user.role)) {
    return NextResponse.json(
      { status: "error", message: "You do not have tenant admin access." },
      { status: 403 },
    );
  }

  let body: RewardPreviewInput;
  try {
    body = (await request.json()) as RewardPreviewInput;
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid request body." },
      { status: 400 },
    );
  }

  const { id } = await params;
  try {
    const preview = await previewKpiRewards(id, session.user.tenantId, body);
    if (!preview) {
      return NextResponse.json(
        { status: "error", message: "KPI builder not found." },
        { status: 404 },
      );
    }

    return NextResponse.json(preview);
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        message:
          error instanceof Error ? error.message : "Failed to preview KPI rewards.",
      },
      { status: 400 },
    );
  }
}
