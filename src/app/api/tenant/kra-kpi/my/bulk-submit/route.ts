import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { submitForVerification } from "@/lib/kra-kpi/achievement-service";
import { prisma } from "@/lib/prisma";
import type { Role } from "@prisma/client";

type BulkSubmitBody = {
  achievementIds: string[];
};

type FailedItem = {
  id: string;
  reason: string;
};

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.tenantId) {
    return NextResponse.json({ status: "error", message: "Not authenticated." }, { status: 403 });
  }

  let body: BulkSubmitBody;
  try {
    body = (await request.json()) as BulkSubmitBody;
  } catch {
    return NextResponse.json({ status: "error", message: "Invalid request body." }, { status: 400 });
  }

  const { achievementIds } = body;
  if (!achievementIds || achievementIds.length === 0) {
    return NextResponse.json({ submitted: 0, failed: [] });
  }

  const tenantId = session.user.tenantId;
  const userId = session.user.id;
  const role = (session.user.role ?? "TENANT_USER") as Role;

  let submitted = 0;
  const failed: FailedItem[] = [];

  for (const id of achievementIds) {
    // Only process DRAFT achievements belonging to this user
    const achievement = await prisma.achievement.findFirst({
      where: { id, tenantId, reportedByUserId: userId, state: "DRAFT" },
      select: { id: true },
    });

    if (!achievement) {
      // Skip silently — not DRAFT or not owned by user
      continue;
    }

    const result = await submitForVerification(id, tenantId, userId, role);
    if (result.status === "success") {
      submitted++;
    } else {
      failed.push({ id, reason: result.message });
    }
  }

  return NextResponse.json({ submitted, failed });
}
