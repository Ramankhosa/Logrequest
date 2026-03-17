import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { validateOrgStructureDraft } from "@/lib/org-structure/service";

export async function POST() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.tenantId) {
    return NextResponse.json(
      {
        status: "error",
        message: "You do not have tenant access.",
      },
      { status: 403 },
    );
  }

  const validation = await validateOrgStructureDraft(session.user.tenantId);

  return NextResponse.json({
    status: validation.errors.length ? "error" : "success",
    message: validation.errors[0] ?? "Draft validated.",
    ...validation,
  });
}
