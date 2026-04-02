import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { listWorkflowReviewerOptions } from "@/lib/kra-kpi/workflow-service";
import { hasAnyTenantCapability } from "@/lib/tenant-permissions/service";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.tenantId || !session.user.role) {
    return NextResponse.json(
      { status: "error", message: "You do not have tenant access." },
      { status: 403 },
    );
  }

  const allowed = await hasAnyTenantCapability({
    tenantId: session.user.tenantId,
    userId: session.user.id,
    baseRole: session.user.role,
    capabilities: ["MANAGE_KPI", "MANAGE_WORKFLOW"],
  });

  if (!allowed) {
    return NextResponse.json(
      { status: "error", message: "You do not have permission to manage KPI workflow." },
      { status: 403 },
    );
  }

  const options = await listWorkflowReviewerOptions(session.user.tenantId);
  return NextResponse.json(options);
}
