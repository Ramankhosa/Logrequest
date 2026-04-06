import type { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth/options";
import { applyTemplatePackToKra } from "@/lib/kra-kpi/kpi-template-service";

const applyTemplatePackSchema = z.object({
  kraDefinitionId: z.string().trim().min(1),
  starterPackKey: z.string().trim().min(1).max(120),
  startingUnitId: z.string().trim().min(1),
  templateIds: z.array(z.string().trim().min(1)).min(1),
});

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.tenantId || !session.user.role) {
    return NextResponse.json(
      { status: "error", message: "You do not have tenant access." },
      { status: 403 },
    );
  }

  let body: z.infer<typeof applyTemplatePackSchema>;
  try {
    body = applyTemplatePackSchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid request body." },
      { status: 400 },
    );
  }

  const result = await applyTemplatePackToKra(
    session.user.tenantId,
    body,
    session.user.id,
    session.user.role as Role,
  );

  return NextResponse.json(result, {
    status: result.status === "success" ? 200 : 400,
  });
}
