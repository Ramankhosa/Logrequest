import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { previewJournalImport } from "@/lib/journals/service";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.isSuperadmin) {
    return NextResponse.json(
      { status: "error", message: "Superadmin access required." },
      { status: 403 },
    );
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const sourceYearValue = formData.get("sourceYear");

  if (!(file instanceof File)) {
    return NextResponse.json(
      { status: "error", message: "No file provided." },
      { status: 400 },
    );
  }

  const sourceYear =
    typeof sourceYearValue === "string" && sourceYearValue.trim().length > 0
      ? Number(sourceYearValue)
      : undefined;

  try {
    const preview = await previewJournalImport({
      scope: "GLOBAL",
      fileName: file.name,
      fileType: file.type || "text/csv",
      buffer: Buffer.from(await file.arrayBuffer()),
      sourceYear: Number.isFinite(sourceYear) ? sourceYear : undefined,
      actorUserId: session.user.id,
    });

    return NextResponse.json(preview, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        message:
          error instanceof Error ? error.message : "Unable to preview journal import.",
      },
      { status: 400 },
    );
  }
}
