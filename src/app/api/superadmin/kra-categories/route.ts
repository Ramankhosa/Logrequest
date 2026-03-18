import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import {
  listAllCategories,
  createCategory,
  type CreateCategoryInput,
} from "@/lib/kra-kpi/category-service";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.isSuperadmin) {
    return NextResponse.json(
      { status: "error", message: "Superadmin access required." },
      { status: 403 },
    );
  }

  const categories = await listAllCategories(null);
  return NextResponse.json(categories);
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.isSuperadmin) {
    return NextResponse.json(
      { status: "error", message: "Superadmin access required." },
      { status: 403 },
    );
  }

  let body: CreateCategoryInput;
  try {
    body = (await request.json()) as CreateCategoryInput;
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid request body." },
      { status: 400 },
    );
  }

  const result = await createCategory(null, body, session.user.id, "SUPERADMIN");

  return NextResponse.json(result, {
    status: result.status === "success" ? 201 : 400,
  });
}
