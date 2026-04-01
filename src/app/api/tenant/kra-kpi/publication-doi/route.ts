import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth/options";
import {
  isPublicationLookupError,
  lookupPublicationByDoi,
} from "@/lib/kra-kpi/publication-doi-service";
import { PUBLICATION_LOOKUP_HIDDEN_KEY } from "@/lib/kra-kpi/publication-doi-shared";
import { lookupPublicationJournalByFormData } from "@/lib/kra-kpi/publication-journal-service";

const requestSchema = z.object({
  doi: z.string().trim().min(1),
});

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !session.user.tenantId) {
    return NextResponse.json(
      { status: "error", message: "You do not have tenant access." },
      { status: 403 },
    );
  }

  let body: z.infer<typeof requestSchema>;
  try {
    body = requestSchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid request body." },
      { status: 400 },
    );
  }

  try {
    const result = await lookupPublicationByDoi({
      doi: body.doi,
      tenantName: session.user.tenantName ?? null,
    });
    const journalLookup = await lookupPublicationJournalByFormData({
      tenantId: session.user.tenantId,
      formData: {
        ...result.fields,
        [PUBLICATION_LOOKUP_HIDDEN_KEY]: {
          ...result.meta,
          authors: result.authors,
        },
      },
    });

    const message =
      result.missingFieldKeys.length > 0
        ? `Auto-filled ${result.filledFieldKeys.length} fields; ${result.missingFieldKeys.length} still need manual entry.`
        : `Auto-filled ${result.filledFieldKeys.length} fields from DOI metadata.`;

    return NextResponse.json({
      status: "success",
      message,
      ...result,
      journalLookup,
    });
  } catch (error) {
    if (isPublicationLookupError(error)) {
      return NextResponse.json(
        { status: "error", message: error.message },
        { status: error.status },
      );
    }

    return NextResponse.json(
      {
        status: "error",
        message:
          error instanceof Error && error.message
            ? error.message
            : "DOI metadata lookup failed.",
      },
      { status: 500 },
    );
  }
}
