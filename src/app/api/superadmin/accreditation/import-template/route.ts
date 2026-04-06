import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { importSuperadminAccreditationTemplateBundle } from "@/lib/accreditation/template-bundle-import-service";

function resolveErrorStatus(message: string) {
  return /already exists|conflict/i.test(message) ? 409 : 400;
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.isSuperadmin) {
    return NextResponse.json(
      { status: "error", message: "Superadmin access required." },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid request body." },
      { status: 400 },
    );
  }

  const bundle =
    body && typeof body === "object" && "bundle" in body
      ? Reflect.get(body, "bundle")
      : body;

  const result = await importSuperadminAccreditationTemplateBundle(bundle, session.user.id);
  return NextResponse.json(result, {
    status: result.status === "success" ? 201 : resolveErrorStatus(result.message),
  });
}
