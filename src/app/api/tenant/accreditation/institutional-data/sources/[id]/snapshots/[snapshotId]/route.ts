import { NextResponse } from "next/server";
import { deleteInstitutionalDataSourceSnapshot } from "@/lib/accreditation/institutional-data-service";
import {
  getTenantAccreditationApiSession,
  tenantApiAccessDeniedResponse,
} from "../../../../../workspace-route-helpers";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; snapshotId: string }> },
) {
  const session = await getTenantAccreditationApiSession();
  if (!session) {
    return tenantApiAccessDeniedResponse();
  }

  const { id, snapshotId } = await params;
  const result = await deleteInstitutionalDataSourceSnapshot(
    id,
    snapshotId,
    session.tenantId,
    session.userId,
    session.role,
  );

  return NextResponse.json(result, { status: result.status === "success" ? 200 : 400 });
}
