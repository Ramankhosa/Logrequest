import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { getOnboardingOptions } from "@/lib/personnel/service";
import { generateOnboardingTemplate } from "@/lib/personnel/upload";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.tenantId || !session.user.role) {
    return NextResponse.json(
      { status: "error", message: "You do not have tenant access." },
      { status: 403 },
    );
  }

  if (
    session.user.role !== Role.TENANT_OWNER &&
    session.user.role !== Role.TENANT_ADMIN
  ) {
    return NextResponse.json(
      { status: "error", message: "You do not have permission to download templates." },
      { status: 403 },
    );
  }

  const tenantId = session.user.tenantId;
  const options = await getOnboardingOptions(tenantId);

  const mappedUnits = options.units.map((u) => ({
    code: u.code,
    name: u.name,
    level: u.level,
    parentCode: null,
  }));

  const mappedRoles = options.roles.map((r) => ({
    roleKey: r.roleKey,
    displayLabel: r.displayLabel,
    isUnitHead: r.isUnitHead,
    maxPerUnit: r.maxPerUnit,
  }));

  const buffer = generateOnboardingTemplate(mappedUnits, mappedRoles);

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="onboarding-template.xlsx"',
    },
  });
}
