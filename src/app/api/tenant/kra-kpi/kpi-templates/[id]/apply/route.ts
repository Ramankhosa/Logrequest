import type { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { z } from "zod";
import { applyTemplateToKpi } from "@/lib/kra-kpi/kpi-template-service";
import { getKraKpiActionHttpStatus } from "@/lib/kra-kpi/shared";

const applyTemplateSchema = z.object({
  kraDefinitionId: z.string().trim().min(1),
  kpiId: z.string().trim().min(1).optional(),
  titleOverride: z.string().trim().max(200).nullable().optional(),
  startingUnitId: z.string().trim().min(1).nullable().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.tenantId || !session.user.role) {
    return NextResponse.json(
      { status: "error", message: "You do not have tenant access." },
      { status: 403 },
    );
  }

  const { id } = await params;

  let body: z.infer<typeof applyTemplateSchema>;
  try {
    body = applyTemplateSchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid request body." },
      { status: 400 },
    );
  }

  const result = await applyTemplateToKpi(
    session.user.tenantId,
    id,
    body,
    session.user.id,
    session.user.role as Role,
  );

  return NextResponse.json(result, {
    status: getKraKpiActionHttpStatus(result, 200),
  });
}
