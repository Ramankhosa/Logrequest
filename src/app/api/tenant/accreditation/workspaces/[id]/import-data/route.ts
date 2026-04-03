import { NextResponse } from "next/server";
import { importAssessmentWorkspaceData } from "@/lib/accreditation/workspace-service";
import {
  getTenantAccreditationApiSession,
  tenantApiAccessDeniedResponse,
} from "../../../workspace-route-helpers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getTenantAccreditationApiSession();
  if (!session) {
    return tenantApiAccessDeniedResponse();
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ status: "error", message: "No file provided." }, { status: 400 });
  }

  const { id } = await params;
  const result = await importAssessmentWorkspaceData(
    id,
    session.tenantId,
    {
      fileName: file.name,
      buffer: Buffer.from(await file.arrayBuffer()),
    },
    session.userId,
    session.role,
  );
  return NextResponse.json(result, { status: result.status === "success" ? 200 : 400 });
}
