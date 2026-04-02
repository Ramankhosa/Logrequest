import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth/options";
import { rewardPreviewContributorSchema } from "@/lib/kra-kpi/builder-shared";
import { previewSubmissionRewards } from "@/lib/kra-kpi/reward-service";
import { prisma } from "@/lib/prisma";
import type { AchievementFormConfig } from "@/lib/kra-kpi/shared";
import { runDuplicateDetection } from "@/lib/kra-kpi/duplicate-detection-service";

const previewRequestSchema = z.object({
  periodId: z.string().trim().min(1),
  kpiDefinitionId: z.string().trim().min(1),
  achievementId: z.string().trim().min(1).optional(),
  actualValue: z.number().nullable().optional(),
  actualDate: z.coerce.date().nullable().optional(),
  computedScore: z.number().nullable().optional(),
  effectiveScore: z.number().nullable().optional(),
  reportingDate: z.coerce.date().optional(),
  achievementFormData: z.record(z.string(), z.unknown()).default({}),
  contributors: z.array(rewardPreviewContributorSchema).default([]),
  manualTierCode: z.string().trim().min(1).nullable().optional(),
  systemMetrics: z.record(z.string(), z.unknown()).default({}),
});

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.tenantId) {
    return NextResponse.json(
      { status: "error", message: "Not authenticated." },
      { status: 403 },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid request body." },
      { status: 400 },
    );
  }

  const parsed = previewRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid request body." },
      { status: 400 },
    );
  }

  const body = parsed.data;
  const kpi = await prisma.kpiDefinition.findFirst({
    where: {
      id: body.kpiDefinitionId,
      kraDefinition: {
        tenantId: session.user.tenantId,
        periodId: body.periodId,
      },
    },
    select: {
      title: true,
      achievementFormConfig: true,
    },
  });
  if (!kpi) {
    return NextResponse.json(
      { status: "error", message: "KPI not found." },
      { status: 404 },
    );
  }

  const rewardPreview = await previewSubmissionRewards(
    body.kpiDefinitionId,
    session.user.tenantId,
    {
      achievementId: body.achievementId,
      actualValue: body.actualValue,
      actualDate: body.actualDate,
      computedScore: body.computedScore,
      effectiveScore: body.effectiveScore,
      reportingDate: body.reportingDate,
      achievementFormData: body.achievementFormData,
      contributors: body.contributors,
      manualTierCode: body.manualTierCode,
      systemMetrics: body.systemMetrics,
    },
  );
  if (!rewardPreview) {
    return NextResponse.json(
      { status: "error", message: "Reward configuration not found." },
      { status: 404 },
    );
  }

  const duplicateCheckResult = await runDuplicateDetection({
    tenantId: session.user.tenantId,
    periodId: body.periodId,
    kpiDefinitionId: body.kpiDefinitionId,
    achievementId: body.achievementId,
    achievementFormData: rewardPreview.normalizedFormData,
    formConfig: (kpi.achievementFormConfig as AchievementFormConfig | null) ?? null,
    contributorUserIds: rewardPreview.normalizedContributors
      .filter(
        (contributor): contributor is typeof contributor & { userId: string } =>
          contributor.type === "INTERNAL" && typeof contributor.userId === "string",
      )
      .map((contributor) => contributor.userId),
  });

  return NextResponse.json({
    status: "success",
    kpiTitle: kpi.title,
    rewardPreview,
    duplicateCheckResult,
  });
}
