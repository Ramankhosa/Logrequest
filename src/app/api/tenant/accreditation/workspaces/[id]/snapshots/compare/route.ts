import { NextResponse } from "next/server";
import { compareAssessmentWorkspaceSnapshots } from "@/lib/accreditation/workspace-service";
import {
  getTenantAccreditationApiSession,
  parseJsonBody,
  tenantApiAccessDeniedResponse,
} from "../../../../workspace-route-helpers";

export async function POST(request: Request) {
  const session = await getTenantAccreditationApiSession();
  if (!session) {
    return tenantApiAccessDeniedResponse();
  }

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) {
    return NextResponse.json({ status: "error", message: "Invalid request body." }, { status: 400 });
  }

  const body = parsed.body as { snapshotId1?: string; snapshotId2?: string };
  if (!body.snapshotId1 || !body.snapshotId2) {
    return NextResponse.json(
      { status: "error", message: "snapshotId1 and snapshotId2 are required." },
      { status: 400 },
    );
  }

  const result = await compareAssessmentWorkspaceSnapshots(
    body.snapshotId1,
    body.snapshotId2,
    session.tenantId,
    session.userId,
    session.role,
  );
  return NextResponse.json(result, { status: result.status === "success" ? 200 : 400 });
}
