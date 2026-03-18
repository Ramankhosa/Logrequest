import type { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import {
  listAllocations,
  createAllocation,
  type CreateAllocationInput,
} from "@/lib/kra-kpi/target-service";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.tenantId) {
    return NextResponse.json(
      { status: "error", message: "You do not have tenant access." },
      { status: 403 },
    );
  }

  const { searchParams } = new URL(request.url);
  const filters: Record<string, string | null> = {};

  const periodId = searchParams.get("periodId");
  const kpiDefinitionId = searchParams.get("kpiDefinitionId");
  const assignedToUnitId = searchParams.get("assignedToUnitId");
  const assignedToUserId = searchParams.get("assignedToUserId");
  const parentAllocationId = searchParams.get("parentAllocationId");

  if (periodId) filters.periodId = periodId;
  if (kpiDefinitionId) filters.kpiDefinitionId = kpiDefinitionId;
  if (assignedToUnitId) filters.assignedToUnitId = assignedToUnitId;
  if (assignedToUserId) filters.assignedToUserId = assignedToUserId;
  if (parentAllocationId !== null && searchParams.has("parentAllocationId")) {
    filters.parentAllocationId = parentAllocationId;
  }

  const allocations = await listAllocations(session.user.tenantId, filters);
  return NextResponse.json(allocations);
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.tenantId || !session.user.role) {
    return NextResponse.json(
      { status: "error", message: "You do not have tenant access." },
      { status: 403 },
    );
  }

  let body: CreateAllocationInput;
  try {
    body = (await request.json()) as CreateAllocationInput;
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid request body." },
      { status: 400 },
    );
  }

  const result = await createAllocation(
    session.user.tenantId,
    body,
    session.user.id,
    session.user.role as Role,
  );

  return NextResponse.json(result, {
    status: result.status === "success" ? 201 : 400,
  });
}
