import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { createTenantForSuperadmin, type TenantCreationInput } from "@/lib/superadmin/service";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.isSuperadmin) {
    return NextResponse.json(
      {
        status: "error",
        message: "Only a signed-in superadmin can create a tenant.",
      },
      { status: 403 },
    );
  }

  let body: TenantCreationInput;

  try {
    body = (await request.json()) as TenantCreationInput;
  } catch {
    return NextResponse.json(
      {
        status: "error",
        message: "Invalid tenant creation request.",
      },
      { status: 400 },
    );
  }

  const result = await createTenantForSuperadmin({
    actorUserId: session.user.id,
    values: body,
  });

  return NextResponse.json(result, {
    status: result.status === "success" ? 200 : 400,
  });
}
