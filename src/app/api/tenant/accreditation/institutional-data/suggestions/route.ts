import { NextResponse } from "next/server";
import {
  listMetricRefreshSuggestions,
} from "@/lib/accreditation/institutional-data-service";
import { RefreshSuggestionStatus } from "@prisma/client";
import {
  getTenantAccreditationApiSession,
  tenantApiAccessDeniedResponse,
} from "../../workspace-route-helpers";

export async function GET(request: Request) {
  const session = await getTenantAccreditationApiSession();
  if (!session) {
    return tenantApiAccessDeniedResponse();
  }

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const status = statusParam && statusParam in RefreshSuggestionStatus
    ? RefreshSuggestionStatus[statusParam as keyof typeof RefreshSuggestionStatus]
    : undefined;

  const result = await listMetricRefreshSuggestions(session.tenantId, session.userId, session.role, { status });
  return NextResponse.json(result, { status: result.status === "success" ? 200 : 400 });
}
