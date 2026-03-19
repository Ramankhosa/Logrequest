import type { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { cascadeTargets, type CascadeDistributionInput } from "@/lib/kra-kpi/target-service";
import { getMyKpiContext } from "@/lib/kra-kpi/my-kpi-service";
import { prisma } from "@/lib/prisma";

type CascadeBody = {
  parentAllocationId: string;
  distributions: CascadeDistributionInput["distributions"];
};

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.tenantId) {
    return NextResponse.json(
      { status: "error", message: "Not authenticated." },
      { status: 403 },
    );
  }

  let body: CascadeBody;
  try {
    body = (await request.json()) as CascadeBody;
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid request body." },
      { status: 400 },
    );
  }

  if (!body.parentAllocationId) {
    return NextResponse.json(
      { status: "error", message: "parentAllocationId is required." },
      { status: 400 },
    );
  }

  // Verify user is head of the allocation's unit
  const ctx = await getMyKpiContext(session.user.tenantId, session.user.id);
  const allocation = await prisma.targetAllocation.findFirst({
    where: { id: body.parentAllocationId, tenantId: session.user.tenantId },
    select: { assignedToUnitId: true },
  });

  if (!allocation?.assignedToUnitId) {
    return NextResponse.json(
      { status: "error", message: "Allocation not found or not unit-level." },
      { status: 400 },
    );
  }

  const isHead = ctx.headOfUnits.some((u) => u.unitId === allocation.assignedToUnitId);
  if (!isHead) {
    return NextResponse.json(
      { status: "error", message: "You are not the head of this unit." },
      { status: 403 },
    );
  }

  const result = await cascadeTargets(
    body.parentAllocationId,
    session.user.tenantId,
    { distributions: body.distributions },
    session.user.id,
    (session.user.role ?? "TENANT_USER") as Role,
    { allowHeadOfUnit: true },
  );

  return NextResponse.json(result, {
    status: result.status === "success" ? 200 : 400,
  });
}
