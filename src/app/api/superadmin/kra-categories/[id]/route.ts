import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import {
  updateCategory,
  deleteCategory,
  type UpdateCategoryInput,
} from "@/lib/kra-kpi/category-service";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.isSuperadmin) {
    return NextResponse.json(
      { status: "error", message: "Superadmin access required." },
      { status: 403 },
    );
  }

  const { id } = await params;

  let body: UpdateCategoryInput;
  try {
    body = (await request.json()) as UpdateCategoryInput;
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid request body." },
      { status: 400 },
    );
  }

  const result = await updateCategory(id, body, session.user.id, "SUPERADMIN");

  return NextResponse.json(result, {
    status: result.status === "success" ? 200 : 400,
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.isSuperadmin) {
    return NextResponse.json(
      { status: "error", message: "Superadmin access required." },
      { status: 403 },
    );
  }

  const { id } = await params;
  const result = await deleteCategory(id, session.user.id, "SUPERADMIN");

  return NextResponse.json(result, {
    status: result.status === "success" ? 200 : 400,
  });
}
