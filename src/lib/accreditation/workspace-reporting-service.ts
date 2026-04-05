import {
  AssessmentWorkspaceStatus,
  BlockEntryStatus,
  DvvQueryPriority,
  DvvQueryStatus,
  Prisma,
  RecommendationPriority,
  RecommendationStatus,
  Role,
  WorkspaceCollaboratorRole,
} from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  canPerformWorkspaceRole,
  canReadWorkspace,
  checkAssessmentWorkspaceReadiness,
  collectExpectedEvidenceDocTypes,
  getAssessmentWorkspaceDataGaps,
  getResponseNumericValue,
  getResponseTextValue,
  getResponseYear,
  getWorkspacePermissionContext,
  hasResponseContent,
} from "./workspace-service";

type ErrorResult = {
  status: "error";
  message: string;
};

type SuccessResult<T extends object = Record<string, never>> = {
  status: "success";
  message?: string;
} & T;

type ServiceResult<T extends object = Record<string, never>> = SuccessResult<T> | ErrorResult;

function isSuccess<T extends object>(result: ServiceResult<T>): result is SuccessResult<T> {
  return result.status === "success";
}

const ACTIVE_WORKSPACE_STATUSES: AssessmentWorkspaceStatus[] = [
  AssessmentWorkspaceStatus.DRAFT,
  AssessmentWorkspaceStatus.IN_PROGRESS,
  AssessmentWorkspaceStatus.UNDER_REVIEW,
  AssessmentWorkspaceStatus.FROZEN,
  AssessmentWorkspaceStatus.SUBMITTED,
];

const dvvCreateSchema = z
  .object({
    linkedBlockIds: z.array(z.string().trim().min(1)).default([]),
    queryNumber: z.string().trim().min(1).max(120),
    queryText: z.string().trim().min(1).max(20000),
    priority: z.nativeEnum(DvvQueryPriority).optional(),
    dueDate: z.coerce.date().nullable().optional(),
    receivedAt: z.coerce.date().optional(),
    assignedToUserId: z.string().trim().min(1).nullable().optional(),
    assignedToExternalName: z.string().trim().max(160).nullable().optional(),
    assignedToExternalEmail: z.string().trim().email().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    const hasInternal = !!value.assignedToUserId;
    const hasExternal = !!value.assignedToExternalName || !!value.assignedToExternalEmail;
    if (hasInternal && hasExternal) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assignedToUserId"],
        message: "Assign to an internal user or an external contact, not both.",
      });
    }
    if (!hasInternal && !hasExternal) {
      return;
    }
    if (!hasInternal && !value.assignedToExternalName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assignedToExternalName"],
        message: "Provide an external assignee name.",
      });
    }
  });

const dvvUpdateSchema = z
  .object({
    linkedBlockIds: z.array(z.string().trim().min(1)).optional(),
    queryNumber: z.string().trim().min(1).max(120).optional(),
    queryText: z.string().trim().min(1).max(20000).optional(),
    status: z.nativeEnum(DvvQueryStatus).optional(),
    priority: z.nativeEnum(DvvQueryPriority).optional(),
    dueDate: z.coerce.date().nullable().optional(),
    assignedToUserId: z.string().trim().min(1).nullable().optional(),
    assignedToExternalName: z.string().trim().max(160).nullable().optional(),
    assignedToExternalEmail: z.string().trim().email().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    const hasInternal = value.assignedToUserId !== undefined && !!value.assignedToUserId;
    const hasExternal =
      value.assignedToExternalName !== undefined || value.assignedToExternalEmail !== undefined
        ? !!value.assignedToExternalName || !!value.assignedToExternalEmail
        : false;
    if (hasInternal && hasExternal) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assignedToUserId"],
        message: "Assign to an internal user or an external contact, not both.",
      });
    }
  });

const dvvRespondSchema = z.object({
  responseText: z.string().trim().min(1).max(20000),
  responseAttachments: z.array(z.record(z.string(), z.unknown())).default([]),
  status: z.nativeEnum(DvvQueryStatus).optional(),
});

const recommendationCreateSchema = z
  .object({
    linkedBlockIds: z.array(z.string().trim().min(1)).default([]),
    recommendationText: z.string().trim().min(1).max(20000),
    priority: z.nativeEnum(RecommendationPriority).optional(),
    actionPlan: z.string().trim().max(20000).nullable().optional(),
    targetDate: z.coerce.date().nullable().optional(),
    assignedToUserId: z.string().trim().min(1).nullable().optional(),
    assignedToExternalName: z.string().trim().max(160).nullable().optional(),
    assignedToExternalEmail: z.string().trim().email().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    const hasInternal = !!value.assignedToUserId;
    const hasExternal = !!value.assignedToExternalName || !!value.assignedToExternalEmail;
    if (hasInternal && hasExternal) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assignedToUserId"],
        message: "Assign to an internal user or an external contact, not both.",
      });
    }
  });

const recommendationUpdateSchema = z
  .object({
    linkedBlockIds: z.array(z.string().trim().min(1)).optional(),
    recommendationText: z.string().trim().min(1).max(20000).optional(),
    priority: z.nativeEnum(RecommendationPriority).optional(),
    actionPlan: z.string().trim().max(20000).nullable().optional(),
    status: z.nativeEnum(RecommendationStatus).optional(),
    targetDate: z.coerce.date().nullable().optional(),
    assignedToUserId: z.string().trim().min(1).nullable().optional(),
    assignedToExternalName: z.string().trim().max(160).nullable().optional(),
    assignedToExternalEmail: z.string().trim().email().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    const hasInternal = value.assignedToUserId !== undefined && !!value.assignedToUserId;
    const hasExternal =
      value.assignedToExternalName !== undefined || value.assignedToExternalEmail !== undefined
        ? !!value.assignedToExternalName || !!value.assignedToExternalEmail
        : false;
    if (hasInternal && hasExternal) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assignedToUserId"],
        message: "Assign to an internal user or an external contact, not both.",
      });
    }
  });

const recommendationProgressSchema = z.object({
  status: z.nativeEnum(RecommendationStatus),
  progressNote: z.string().trim().min(1).max(4000),
});

function getWorkspaceYearBounds(periodStart: Date, periodEnd: Date) {
  return {
    startYear: periodStart.getUTCFullYear(),
    endYear: periodEnd.getUTCFullYear(),
  };
}

function toCsvCell(value: unknown) {
  const normalized =
    value === null || value === undefined
      ? ""
      : typeof value === "string"
        ? value
        : JSON.stringify(value);
  const escaped = normalized.replace(/"/g, "\"\"");
  return `"${escaped}"`;
}

function rowsToCsv(rows: unknown[]) {
  if (rows.length === 0) {
    return "";
  }
  const normalizedRows = rows as Array<Record<string, unknown>>;
  const headers = [...new Set(normalizedRows.flatMap((row) => Object.keys(row)))];
  const lines = [
    headers.map(toCsvCell).join(","),
    ...normalizedRows.map((row) => headers.map((header) => toCsvCell(row[header])).join(",")),
  ];
  return lines.join("\n");
}

function normalizeComparableValue(value: unknown): string | number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number" || typeof value === "string") {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return JSON.stringify(value);
}

async function requireWorkspaceReadAccess(
  workspaceId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const permission = await getWorkspacePermissionContext({
    workspaceId,
    tenantId,
    actorUserId,
    actorRole,
  });
  if ("status" in permission) {
    return permission;
  }
  if (!canReadWorkspace(permission)) {
    return { status: "error", message: "You do not have access to this workspace." } satisfies ErrorResult;
  }
  return permission;
}

async function requireWorkspaceCoordinatorAccess(
  workspaceId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const permission = await requireWorkspaceReadAccess(workspaceId, tenantId, actorUserId, actorRole);
  if ("status" in permission) {
    return permission;
  }
  if (!canPerformWorkspaceRole(permission, [WorkspaceCollaboratorRole.COORDINATOR])) {
    return { status: "error", message: "Only workspace coordinators can perform this action." } satisfies ErrorResult;
  }
  return permission;
}

async function getWorkspaceReportBase(workspaceId: string, tenantId: string) {
  const workspace = await prisma.assessmentWorkspace.findFirst({
    where: {
      id: workspaceId,
      tenantId,
    },
    include: {
      version: {
        include: {
          body: {
            select: {
              code: true,
              name: true,
            },
          },
        },
      },
      profile: {
        select: {
          profileCode: true,
          profileName: true,
        },
      },
      entries: {
        include: {
          block: {
            select: {
              id: true,
              blockCode: true,
              title: true,
              depth: true,
              blockType: true,
              dataType: true,
              maxScore: true,
              expectedEvidence: true,
            },
          },
          responses: {
            orderBy: [{ year: "asc" }, { scopeKey: "asc" }],
          },
          evidenceLinks: {
            include: {
              evidence: {
                include: {
                  versions: {
                    orderBy: [{ versionNumber: "desc" }],
                  },
                },
              },
            },
          },
        },
        orderBy: {
          block: {
            blockCode: "asc",
          },
        },
      },
      evidence: {
        include: {
          versions: {
            orderBy: [{ versionNumber: "desc" }],
          },
          entryLinks: true,
        },
        orderBy: [{ updatedAt: "desc" }],
      },
      dvvQueries: {
        orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }],
      },
      peerRecommendations: {
        orderBy: [{ createdAt: "desc" }],
      },
    },
  });

  if (!workspace) {
    return null;
  }

  const blockMap = new Map(
    (
      await prisma.criterionBlock.findMany({
        where: { versionId: workspace.versionId },
        select: {
          id: true,
          blockCode: true,
          title: true,
        },
      })
    ).map((block) => [block.id, block]),
  );

  return { workspace, blockMap };
}

function summarizeBlockRefs(
  blockMap: Map<string, { id: string; blockCode: string; title: string }>,
  blockIds: string[],
) {
  return blockIds.map((blockId) => {
    const block = blockMap.get(blockId);
    return {
      blockId,
      blockCode: block?.blockCode ?? null,
      blockTitle: block?.title ?? null,
    };
  });
}

function computeProgressStats(
  workspace: NonNullable<Awaited<ReturnType<typeof getWorkspaceReportBase>>>["workspace"],
) {
  const totalEntries = workspace.entries.length;
  const { startYear, endYear } = getWorkspaceYearBounds(workspace.periodStart, workspace.periodEnd);
  const yearSpan = Math.max(1, endYear - startYear + 1);
  const progressStatuses: BlockEntryStatus[] = [
    BlockEntryStatus.COMPLETE,
    BlockEntryStatus.UNDER_REVIEW,
    BlockEntryStatus.APPROVED,
  ];
  const progressCount = workspace.entries.filter((entry) => progressStatuses.includes(entry.status)).length;
  const approvalCount = workspace.entries.filter((entry) => entry.status === BlockEntryStatus.APPROVED).length;
  const populatedYearCells = workspace.entries.reduce(
    (sum, entry) => sum + entry.responses.filter((row) => hasResponseContent(row)).length,
    0,
  );
  const expectedYearCells = totalEntries * yearSpan;
  return {
    totalEntries,
    progressPercent: totalEntries > 0 ? Math.round((progressCount / totalEntries) * 100) : 0,
    approvalPercent: totalEntries > 0 ? Math.round((approvalCount / totalEntries) * 100) : 0,
    dataCompleteness:
      expectedYearCells > 0 ? Math.round((populatedYearCells / expectedYearCells) * 100) : 0,
  };
}

export async function getWorkspaceReadinessReport(
  workspaceId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const permission = await requireWorkspaceReadAccess(workspaceId, tenantId, actorUserId, actorRole);
  if ("status" in permission) {
    return permission;
  }

  const [base, readinessResult] = await Promise.all([
    getWorkspaceReportBase(workspaceId, tenantId),
    checkAssessmentWorkspaceReadiness(workspaceId, tenantId, actorUserId, actorRole),
  ]);

  if (!base) {
    return { status: "error", message: "Workspace not found." } satisfies ErrorResult;
  }
  if (readinessResult.status === "error") {
    return readinessResult;
  }

  const stats = computeProgressStats(base.workspace);

  return {
    status: "success",
    report: {
      workspace: {
        id: base.workspace.id,
        title: base.workspace.title,
        bodyCode: base.workspace.version.body.code,
        bodyName: base.workspace.version.body.name,
        versionCode: base.workspace.version.versionCode,
        profileCode: base.workspace.profile.profileCode,
        profileName: base.workspace.profile.profileName,
        status: base.workspace.status,
        targetGrade: base.workspace.targetGrade,
        overallRawScore: base.workspace.overallRawScore,
        overallConvertedScore: base.workspace.overallConvertedScore,
        resolvedGrade: base.workspace.resolvedGrade,
        resolvedOutcome: base.workspace.resolvedOutcome,
        isScoreStale: base.workspace.isScoreStale,
        lastSuccessfulScoreAt: base.workspace.lastSuccessfulScoreAt,
      },
      readiness: readinessResult.readiness,
      blockersCount: readinessResult.readiness.blockers.length,
      warningsCount: readinessResult.readiness.warnings.length,
      freezeEligible: readinessResult.readiness.canFreeze,
      ...stats,
    },
  } satisfies SuccessResult<{
    report: {
      workspace: Record<string, unknown>;
      readiness: typeof readinessResult.readiness;
      blockersCount: number;
      warningsCount: number;
      freezeEligible: boolean;
      totalEntries: number;
      progressPercent: number;
      approvalPercent: number;
      dataCompleteness: number;
    };
  }>;
}

export async function getWorkspaceCompletenessReport(
  workspaceId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const permission = await requireWorkspaceReadAccess(workspaceId, tenantId, actorUserId, actorRole);
  if ("status" in permission) {
    return permission;
  }

  const [base, gapsResult] = await Promise.all([
    getWorkspaceReportBase(workspaceId, tenantId),
    getAssessmentWorkspaceDataGaps(workspaceId, tenantId, actorUserId, actorRole),
  ]);
  if (!base) {
    return { status: "error", message: "Workspace not found." } satisfies ErrorResult;
  }
  if (gapsResult.status === "error") {
    return gapsResult;
  }

  const gapMap = new Map(gapsResult.gaps.map((gap) => [gap.entryId, gap]));
  const blocks = base.workspace.entries.map((entry) => {
    const requiredDocTypes = collectExpectedEvidenceDocTypes(entry.block.expectedEvidence);
    const linkedDocTypes = new Set(
      entry.evidenceLinks
        .map((link) => link.evidence.docType?.trim().toUpperCase() ?? null)
        .filter((docType): docType is string => !!docType),
    );
    const missingRequiredEvidenceTypes = requiredDocTypes.filter((docType) => !linkedDocTypes.has(docType));
    const hasResponse = entry.responses.some((response) => hasResponseContent(response));
    const gap = gapMap.get(entry.id);
    const hasFinalEvidence = entry.evidenceLinks.some((link) =>
      link.evidence.versions.some((version) => version.isFinal),
    );
    const completionStatus =
      !hasResponse
        ? "NO_RESPONSE"
        : gap && gap.missingYears.length > 0
          ? "MISSING_YEARS"
          : missingRequiredEvidenceTypes.length > 0
            ? "MISSING_REQUIRED_EVIDENCE"
            : entry.status === BlockEntryStatus.APPROVED
              ? "APPROVED"
              : "READY";

    return {
      entryId: entry.id,
      blockId: entry.blockId,
      blockCode: entry.block.blockCode,
      blockTitle: entry.block.title,
      status: entry.status,
      completionStatus,
      hasResponse,
      hasEvidence: entry.evidenceLinks.length > 0,
      hasFinalEvidence,
      missingYears: gap?.missingYears ?? [],
      requiredEvidenceTypes: requiredDocTypes,
      missingRequiredEvidenceTypes,
      computedScore: entry.computedScore,
      finalScore: entry.finalScore,
    };
  });

  return {
    status: "success",
    report: {
      workspaceId: base.workspace.id,
      blocks,
      summary: {
        totalBlocks: blocks.length,
        noResponseCount: blocks.filter((block) => !block.hasResponse).length,
        missingYearCount: blocks.filter((block) => block.missingYears.length > 0).length,
        missingEvidenceCount: blocks.filter((block) => block.missingRequiredEvidenceTypes.length > 0).length,
        approvedCount: blocks.filter((block) => block.status === BlockEntryStatus.APPROVED).length,
      },
    },
  } satisfies SuccessResult<{
    report: {
      workspaceId: string;
      blocks: typeof blocks;
      summary: Record<string, number>;
    };
  }>;
}

export async function getWorkspaceEvidenceInventory(
  workspaceId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const permission = await requireWorkspaceReadAccess(workspaceId, tenantId, actorUserId, actorRole);
  if ("status" in permission) {
    return permission;
  }

  const base = await getWorkspaceReportBase(workspaceId, tenantId);
  if (!base) {
    return { status: "error", message: "Workspace not found." } satisfies ErrorResult;
  }

  const blocks = base.workspace.entries.map((entry) => {
    const requiredDocTypes = collectExpectedEvidenceDocTypes(entry.block.expectedEvidence);
    const linkedEvidence = entry.evidenceLinks.map((link) => ({
      evidenceId: link.evidenceId,
      title: link.evidence.title,
      docType: link.evidence.docType,
      isFinalMarked: link.evidence.isFinalMarked,
      latestVersion: link.evidence.versions[0]
        ? {
            id: link.evidence.versions[0].id,
            fileName: link.evidence.versions[0].fileName,
            fileType: link.evidence.versions[0].fileType,
            uploadedAt: link.evidence.versions[0].uploadedAt,
            isFinal: link.evidence.versions[0].isFinal,
          }
        : null,
    }));
    const linkedDocTypes = new Set(
      linkedEvidence.map((item) => item.docType?.trim().toUpperCase() ?? null).filter((item): item is string => !!item),
    );
    const missingRequiredEvidenceTypes = requiredDocTypes.filter((docType) => !linkedDocTypes.has(docType));

    return {
      entryId: entry.id,
      blockId: entry.blockId,
      blockCode: entry.block.blockCode,
      blockTitle: entry.block.title,
      requiredEvidenceTypes: requiredDocTypes,
      missingRequiredEvidenceTypes,
      evidenceCount: linkedEvidence.length,
      hasFinalEvidence: linkedEvidence.some((item) => item.isFinalMarked || item.latestVersion?.isFinal),
      linkedEvidence,
    };
  });

  const unlinkedEvidence = base.workspace.evidence
    .filter((evidence) => evidence.entryLinks.length === 0)
    .map((evidence) => ({
      evidenceId: evidence.id,
      title: evidence.title,
      docType: evidence.docType,
      isFinalMarked: evidence.isFinalMarked,
      latestVersion: evidence.versions[0]
        ? {
            id: evidence.versions[0].id,
            fileName: evidence.versions[0].fileName,
            fileType: evidence.versions[0].fileType,
            uploadedAt: evidence.versions[0].uploadedAt,
            isFinal: evidence.versions[0].isFinal,
          }
        : null,
    }));

  return {
    status: "success",
    report: {
      workspaceId: base.workspace.id,
      blocks,
      unlinkedEvidence,
      summary: {
        blockCount: blocks.length,
        evidenceCount: base.workspace.evidence.length,
        unlinkedEvidenceCount: unlinkedEvidence.length,
        blocksMissingRequiredEvidence: blocks.filter((block) => block.missingRequiredEvidenceTypes.length > 0).length,
      },
    },
  } satisfies SuccessResult<{
    report: {
      workspaceId: string;
      blocks: typeof blocks;
      unlinkedEvidence: typeof unlinkedEvidence;
      summary: Record<string, number>;
    };
  }>;
}

export async function listWorkspaceDvvQueries(
  workspaceId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const permission = await requireWorkspaceReadAccess(workspaceId, tenantId, actorUserId, actorRole);
  if ("status" in permission) {
    return permission;
  }
  const base = await getWorkspaceReportBase(workspaceId, tenantId);
  if (!base) {
    return { status: "error", message: "Workspace not found." } satisfies ErrorResult;
  }
  return {
    status: "success",
    queries: base.workspace.dvvQueries.map((query) => ({
      ...query,
      linkedBlocks: summarizeBlockRefs(base.blockMap, query.linkedBlockIds),
    })),
  } satisfies SuccessResult<{
    queries: Array<
      Prisma.DvvQueryGetPayload<Record<string, never>> & {
        linkedBlocks: ReturnType<typeof summarizeBlockRefs>;
      }
    >;
  }>;
}

export async function createWorkspaceDvvQuery(
  workspaceId: string,
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const permission = await requireWorkspaceCoordinatorAccess(workspaceId, tenantId, actorUserId, actorRole);
  if ("status" in permission) {
    return permission;
  }
  const parsed = dvvCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid DVV query input." } satisfies ErrorResult;
  }
  const blocks = await prisma.criterionBlock.findMany({
    where: {
      versionId: permission.workspace.versionId,
      id: { in: parsed.data.linkedBlockIds },
    },
    select: { id: true },
  });
  if (blocks.length !== parsed.data.linkedBlockIds.length) {
    return { status: "error", message: "One or more linked blocks were not found in this workspace version." } satisfies ErrorResult;
  }
  const query = await prisma.dvvQuery.create({
    data: {
      workspaceId,
      linkedBlockIds: parsed.data.linkedBlockIds,
      queryNumber: parsed.data.queryNumber,
      queryText: parsed.data.queryText,
      status:
        parsed.data.assignedToUserId || parsed.data.assignedToExternalName || parsed.data.assignedToExternalEmail
          ? DvvQueryStatus.ASSIGNED
          : DvvQueryStatus.RECEIVED,
      priority: parsed.data.priority ?? DvvQueryPriority.MEDIUM,
      dueDate: parsed.data.dueDate ?? null,
      receivedAt: parsed.data.receivedAt ?? new Date(),
      assignedToUserId: parsed.data.assignedToUserId ?? null,
      assignedToExternalName: parsed.data.assignedToExternalName ?? null,
      assignedToExternalEmail: parsed.data.assignedToExternalEmail ?? null,
      createdByUserId: actorUserId,
    },
  });
  return {
    status: "success",
    message: "DVV query created.",
    query,
  } satisfies SuccessResult<{ query: typeof query }>;
}

export async function updateDvvQuery(
  queryId: string,
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const query = await prisma.dvvQuery.findFirst({
    where: {
      id: queryId,
      workspace: { tenantId },
    },
    include: {
      workspace: {
        select: {
          id: true,
          versionId: true,
        },
      },
    },
  });
  if (!query) {
    return { status: "error", message: "DVV query not found." } satisfies ErrorResult;
  }
  const permission = await requireWorkspaceCoordinatorAccess(query.workspace.id, tenantId, actorUserId, actorRole);
  if ("status" in permission) {
    return permission;
  }
  const parsed = dvvUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid DVV query update." } satisfies ErrorResult;
  }
  if (parsed.data.linkedBlockIds) {
    const blocks = await prisma.criterionBlock.findMany({
      where: {
        versionId: query.workspace.versionId,
        id: { in: parsed.data.linkedBlockIds },
      },
      select: { id: true },
    });
    if (blocks.length !== parsed.data.linkedBlockIds.length) {
      return { status: "error", message: "One or more linked blocks were not found in this workspace version." } satisfies ErrorResult;
    }
  }
  const updated = await prisma.dvvQuery.update({
    where: { id: queryId },
    data: {
      ...(parsed.data.linkedBlockIds ? { linkedBlockIds: parsed.data.linkedBlockIds } : {}),
      ...(parsed.data.queryNumber !== undefined ? { queryNumber: parsed.data.queryNumber } : {}),
      ...(parsed.data.queryText !== undefined ? { queryText: parsed.data.queryText } : {}),
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      ...(parsed.data.priority !== undefined ? { priority: parsed.data.priority } : {}),
      ...(parsed.data.dueDate !== undefined ? { dueDate: parsed.data.dueDate } : {}),
      ...(parsed.data.assignedToUserId !== undefined ? { assignedToUserId: parsed.data.assignedToUserId || null } : {}),
      ...(parsed.data.assignedToExternalName !== undefined
        ? { assignedToExternalName: parsed.data.assignedToExternalName || null }
        : {}),
      ...(parsed.data.assignedToExternalEmail !== undefined
        ? { assignedToExternalEmail: parsed.data.assignedToExternalEmail || null }
        : {}),
    },
  });
  return {
    status: "success",
    message: "DVV query updated.",
    query: updated,
  } satisfies SuccessResult<{ query: typeof updated }>;
}

export async function respondToDvvQuery(
  queryId: string,
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const query = await prisma.dvvQuery.findFirst({
    where: {
      id: queryId,
      workspace: { tenantId },
    },
    select: {
      id: true,
      workspaceId: true,
    },
  });
  if (!query) {
    return { status: "error", message: "DVV query not found." } satisfies ErrorResult;
  }
  const permission = await requireWorkspaceCoordinatorAccess(query.workspaceId, tenantId, actorUserId, actorRole);
  if ("status" in permission) {
    return permission;
  }
  const parsed = dvvRespondSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid DVV response." } satisfies ErrorResult;
  }
  const updated = await prisma.dvvQuery.update({
    where: { id: query.id },
    data: {
      responseText: parsed.data.responseText,
      responseAttachments: parsed.data.responseAttachments as Prisma.InputJsonValue,
      respondedAt: new Date(),
      status: parsed.data.status ?? DvvQueryStatus.SUBMITTED,
    },
  });
  return {
    status: "success",
    message: "DVV query response saved.",
    query: updated,
  } satisfies SuccessResult<{ query: typeof updated }>;
}

export async function getWorkspaceDvvSummary(
  workspaceId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const listResult = await listWorkspaceDvvQueries(workspaceId, tenantId, actorUserId, actorRole);
  if (listResult.status === "error") {
    return listResult;
  }
  const summary = {
    total: listResult.queries.length,
    open: listResult.queries.filter((item) => item.status !== DvvQueryStatus.CLOSED).length,
    closed: listResult.queries.filter((item) => item.status === DvvQueryStatus.CLOSED).length,
    highPriority: listResult.queries.filter((item) => item.priority === DvvQueryPriority.HIGH).length,
  };
  return { status: "success", summary } satisfies SuccessResult<{ summary: typeof summary }>;
}

export async function listWorkspaceRecommendations(
  workspaceId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const permission = await requireWorkspaceReadAccess(workspaceId, tenantId, actorUserId, actorRole);
  if ("status" in permission) {
    return permission;
  }
  const base = await getWorkspaceReportBase(workspaceId, tenantId);
  if (!base) {
    return { status: "error", message: "Workspace not found." } satisfies ErrorResult;
  }
  return {
    status: "success",
    recommendations: base.workspace.peerRecommendations.map((recommendation) => ({
      ...recommendation,
      linkedBlocks: summarizeBlockRefs(base.blockMap, recommendation.linkedBlockIds),
    })),
  } satisfies SuccessResult<{
    recommendations: Array<
      Prisma.PeerRecommendationGetPayload<Record<string, never>> & {
        linkedBlocks: ReturnType<typeof summarizeBlockRefs>;
      }
    >;
  }>;
}

export async function createWorkspaceRecommendation(
  workspaceId: string,
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const permission = await requireWorkspaceCoordinatorAccess(workspaceId, tenantId, actorUserId, actorRole);
  if ("status" in permission) {
    return permission;
  }
  const parsed = recommendationCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid recommendation input." } satisfies ErrorResult;
  }
  if (parsed.data.linkedBlockIds.length > 0) {
    const blocks = await prisma.criterionBlock.findMany({
      where: {
        versionId: permission.workspace.versionId,
        id: { in: parsed.data.linkedBlockIds },
      },
      select: { id: true },
    });
    if (blocks.length !== parsed.data.linkedBlockIds.length) {
      return { status: "error", message: "One or more linked blocks were not found in this workspace version." } satisfies ErrorResult;
    }
  }
  const recommendation = await prisma.peerRecommendation.create({
    data: {
      workspaceId,
      linkedBlockIds: parsed.data.linkedBlockIds,
      recommendationText: parsed.data.recommendationText,
      priority: parsed.data.priority ?? RecommendationPriority.MEDIUM,
      actionPlan: parsed.data.actionPlan ?? null,
      status: RecommendationStatus.RECEIVED,
      assignedToUserId: parsed.data.assignedToUserId ?? null,
      assignedToExternalName: parsed.data.assignedToExternalName ?? null,
      assignedToExternalEmail: parsed.data.assignedToExternalEmail ?? null,
      targetDate: parsed.data.targetDate ?? null,
      createdByUserId: actorUserId,
    },
  });
  return {
    status: "success",
    message: "Recommendation created.",
    recommendation,
  } satisfies SuccessResult<{ recommendation: typeof recommendation }>;
}

export async function updatePeerRecommendation(
  recommendationId: string,
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const recommendation = await prisma.peerRecommendation.findFirst({
    where: {
      id: recommendationId,
      workspace: { tenantId },
    },
    include: {
      workspace: {
        select: {
          id: true,
          versionId: true,
        },
      },
    },
  });
  if (!recommendation) {
    return { status: "error", message: "Recommendation not found." } satisfies ErrorResult;
  }
  const permission = await requireWorkspaceCoordinatorAccess(
    recommendation.workspace.id,
    tenantId,
    actorUserId,
    actorRole,
  );
  if ("status" in permission) {
    return permission;
  }
  const parsed = recommendationUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid recommendation update." } satisfies ErrorResult;
  }
  if (parsed.data.linkedBlockIds) {
    const blocks = await prisma.criterionBlock.findMany({
      where: {
        versionId: recommendation.workspace.versionId,
        id: { in: parsed.data.linkedBlockIds },
      },
      select: { id: true },
    });
    if (blocks.length !== parsed.data.linkedBlockIds.length) {
      return { status: "error", message: "One or more linked blocks were not found in this workspace version." } satisfies ErrorResult;
    }
  }
  const updated = await prisma.peerRecommendation.update({
    where: { id: recommendation.id },
    data: {
      ...(parsed.data.linkedBlockIds ? { linkedBlockIds: parsed.data.linkedBlockIds } : {}),
      ...(parsed.data.recommendationText !== undefined
        ? { recommendationText: parsed.data.recommendationText }
        : {}),
      ...(parsed.data.priority !== undefined ? { priority: parsed.data.priority } : {}),
      ...(parsed.data.actionPlan !== undefined ? { actionPlan: parsed.data.actionPlan } : {}),
      ...(parsed.data.status !== undefined
        ? {
            status: parsed.data.status,
            ...(parsed.data.status === RecommendationStatus.COMPLETED ? { completedAt: new Date() } : {}),
          }
        : {}),
      ...(parsed.data.targetDate !== undefined ? { targetDate: parsed.data.targetDate } : {}),
      ...(parsed.data.assignedToUserId !== undefined ? { assignedToUserId: parsed.data.assignedToUserId || null } : {}),
      ...(parsed.data.assignedToExternalName !== undefined
        ? { assignedToExternalName: parsed.data.assignedToExternalName || null }
        : {}),
      ...(parsed.data.assignedToExternalEmail !== undefined
        ? { assignedToExternalEmail: parsed.data.assignedToExternalEmail || null }
        : {}),
    },
  });
  return {
    status: "success",
    message: "Recommendation updated.",
    recommendation: updated,
  } satisfies SuccessResult<{ recommendation: typeof updated }>;
}

export async function updatePeerRecommendationProgress(
  recommendationId: string,
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const recommendation = await prisma.peerRecommendation.findFirst({
    where: {
      id: recommendationId,
      workspace: { tenantId },
    },
    select: {
      id: true,
      workspaceId: true,
      progressNotes: true,
    },
  });
  if (!recommendation) {
    return { status: "error", message: "Recommendation not found." } satisfies ErrorResult;
  }
  const permission = await requireWorkspaceCoordinatorAccess(
    recommendation.workspaceId,
    tenantId,
    actorUserId,
    actorRole,
  );
  if ("status" in permission) {
    return permission;
  }
  const parsed = recommendationProgressSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid recommendation progress input." } satisfies ErrorResult;
  }
  const existingNotes = Array.isArray(recommendation.progressNotes)
    ? (recommendation.progressNotes as Prisma.JsonArray)
    : [];
  const updated = await prisma.peerRecommendation.update({
    where: { id: recommendation.id },
    data: {
      status: parsed.data.status,
      completedAt: parsed.data.status === RecommendationStatus.COMPLETED ? new Date() : null,
      progressNotes: [
        ...existingNotes,
        {
          note: parsed.data.progressNote,
          status: parsed.data.status,
          userId: actorUserId,
          timestamp: new Date().toISOString(),
        },
      ] as Prisma.InputJsonValue,
    },
  });
  return {
    status: "success",
    message: "Recommendation progress updated.",
    recommendation: updated,
  } satisfies SuccessResult<{ recommendation: typeof updated }>;
}

export async function getWorkspaceRecommendationSummary(
  workspaceId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const listResult = await listWorkspaceRecommendations(workspaceId, tenantId, actorUserId, actorRole);
  if (listResult.status === "error") {
    return listResult;
  }
  const summary = {
    total: listResult.recommendations.length,
    open: listResult.recommendations.filter((item) => item.status !== RecommendationStatus.COMPLETED).length,
    completed: listResult.recommendations.filter((item) => item.status === RecommendationStatus.COMPLETED).length,
    highPriority: listResult.recommendations.filter((item) => item.priority === RecommendationPriority.HIGH).length,
  };
  return { status: "success", summary } satisfies SuccessResult<{ summary: typeof summary }>;
}

export async function getCrossWorkspaceOverlapReport(
  tenantId: string,
  _actorUserId: string,
  _actorRole: Role | null | undefined,
) {
  const activeWorkspaces = await prisma.assessmentWorkspace.findMany({
    where: {
      tenantId,
      status: {
        in: ACTIVE_WORKSPACE_STATUSES,
      },
    },
    include: {
      version: {
        include: {
          body: {
            select: { code: true, name: true },
          },
        },
      },
      projectionRecipes: {
        where: {
          isActive: true,
          sourceKind: {
            in: ["INSTITUTIONAL_DATA_BANK", "SOURCE_METRIC"],
          },
          sourceMetricId: { not: null },
        },
        include: {
          sourceMetric: {
            include: {
              observations: {
                orderBy: [{ observedYear: "desc" }, { updatedAt: "desc" }],
                take: 1,
              },
            },
          },
          targetEntry: {
            include: {
              block: {
                select: {
                  blockCode: true,
                  title: true,
                },
              },
              responses: {
                orderBy: [{ updatedAt: "desc" }],
                take: 1,
              },
            },
          },
        },
      },
    },
    orderBy: [{ title: "asc" }],
  });

  const metricUsage = new Map<
    string,
    Array<{
      workspaceId: string;
      workspaceTitle: string;
      workspaceStatus: AssessmentWorkspaceStatus;
      bodyCode: string;
      versionCode: string;
      blockCode: string;
      blockTitle: string;
      metricCode: string;
      metricName: string;
      latestMetricValue: number | string | null;
      metricIsStale: boolean;
      targetValue: number | string | null;
    }>
  >();

  for (const workspace of activeWorkspaces) {
    for (const recipe of workspace.projectionRecipes) {
      if (!recipe.sourceMetric) {
        continue;
      }
      const latestObservation = recipe.sourceMetric.observations[0] ?? null;
      const targetResponse = recipe.targetEntry.responses[0] ?? null;
      const targetValue = getResponseNumericValue(targetResponse) ?? getResponseTextValue(targetResponse);
      const latestMetricValue =
        latestObservation?.numberValue ?? latestObservation?.textValue ?? latestObservation?.jsonValue ?? null;
      const rows = metricUsage.get(recipe.sourceMetric.id) ?? [];
      rows.push({
        workspaceId: workspace.id,
        workspaceTitle: workspace.title,
        workspaceStatus: workspace.status,
        bodyCode: workspace.version.body.code,
        versionCode: workspace.version.versionCode,
        blockCode: recipe.targetEntry.block.blockCode,
        blockTitle: recipe.targetEntry.block.title,
        metricCode: recipe.sourceMetric.code,
        metricName: recipe.sourceMetric.name,
        latestMetricValue: normalizeComparableValue(latestMetricValue),
        metricIsStale: latestObservation?.isStale ?? false,
        targetValue: normalizeComparableValue(targetValue),
      });
      metricUsage.set(recipe.sourceMetric.id, rows);
    }
  }

  const overlaps = [...metricUsage.values()]
    .filter((rows) => rows.length > 1)
    .map((rows) => {
      const targetValues = [...new Set(rows.map((row) => String(row.targetValue ?? "")))];
      return {
        metricCode: rows[0]?.metricCode ?? null,
        metricName: rows[0]?.metricName ?? null,
        conflictType:
          targetValues.length > 1
            ? "CONFLICTING_VALUES"
            : rows.some((row) => row.metricIsStale) && rows.some((row) => !row.metricIsStale)
              ? "STALE_MISMATCH"
              : "SHARED_USAGE",
        usages: rows,
      };
    });

  return {
    status: "success",
    report: {
      overlaps,
      summary: {
        overlapCount: overlaps.length,
        conflictingValueCount: overlaps.filter((item) => item.conflictType === "CONFLICTING_VALUES").length,
        staleMismatchCount: overlaps.filter((item) => item.conflictType === "STALE_MISMATCH").length,
      },
    },
  } satisfies SuccessResult<{ report: { overlaps: typeof overlaps; summary: Record<string, number> } }>;
}

export async function exportWorkspaceReport(
  workspaceId: string,
  tenantId: string,
  format: "json" | "csv",
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const permission = await requireWorkspaceReadAccess(workspaceId, tenantId, actorUserId, actorRole);
  if ("status" in permission) {
    return permission;
  }
  const [base, readiness, completeness, inventory, dvv, recommendations] = await Promise.all([
    getWorkspaceReportBase(workspaceId, tenantId),
    getWorkspaceReadinessReport(workspaceId, tenantId, actorUserId, actorRole),
    getWorkspaceCompletenessReport(workspaceId, tenantId, actorUserId, actorRole),
    getWorkspaceEvidenceInventory(workspaceId, tenantId, actorUserId, actorRole),
    listWorkspaceDvvQueries(workspaceId, tenantId, actorUserId, actorRole),
    listWorkspaceRecommendations(workspaceId, tenantId, actorUserId, actorRole),
  ]);
  if (!base) {
    return { status: "error", message: "Workspace not found." } satisfies ErrorResult;
  }
  if (!isSuccess(readiness)) {
    return readiness;
  }
  if (!isSuccess(completeness)) {
    return completeness;
  }
  if (!isSuccess(inventory)) {
    return inventory;
  }
  if (!isSuccess(dvv)) {
    return dvv;
  }
  if (!isSuccess(recommendations)) {
    return recommendations;
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    exportFormat: format,
    workspace: {
      id: base.workspace.id,
      title: base.workspace.title,
      bodyCode: base.workspace.version.body.code,
      bodyName: base.workspace.version.body.name,
      versionCode: base.workspace.version.versionCode,
      profileCode: base.workspace.profile.profileCode,
      profileName: base.workspace.profile.profileName,
      periodStart: base.workspace.periodStart.toISOString(),
      periodEnd: base.workspace.periodEnd.toISOString(),
      status: base.workspace.status,
      overallRawScore: base.workspace.overallRawScore,
      overallConvertedScore: base.workspace.overallConvertedScore,
      resolvedGrade: base.workspace.resolvedGrade,
      resolvedOutcome: base.workspace.resolvedOutcome,
    },
    blocks: base.workspace.entries.map((entry) => ({
      blockCode: entry.block.blockCode,
      title: entry.block.title,
      depth: entry.block.depth,
      blockType: entry.block.blockType,
      response: {
        status: entry.status,
        responseData: entry.responses[0]?.responseData ?? null,
        computedScore: entry.computedScore,
        finalScore: entry.finalScore,
        manualOverride: entry.manualOverride,
      },
      evidence: entry.evidenceLinks.map((link) => ({
        title: link.evidence.title,
        docType: link.evidence.docType,
        isFinalMarked: link.evidence.isFinalMarked,
        latestFileName: link.evidence.versions[0]?.fileName ?? null,
      })),
      responses: entry.responses.map((response) => ({
        scopeKey: response.scopeKey,
        year: getResponseYear(response),
        numberValue: getResponseNumericValue(response),
        textValue: getResponseTextValue(response),
        dataSource: response.dataSource,
      })),
    })),
    readiness: readiness.report,
    completeness: completeness.report,
    evidenceInventory: inventory.report,
    dvvQueries: dvv.queries,
    recommendations: recommendations.recommendations,
    summary: {
      totalBlocks: base.workspace.entries.length,
      completedBlocks: base.workspace.entries.filter((entry) => entry.status !== BlockEntryStatus.BLANK).length,
      approvedBlocks: base.workspace.entries.filter((entry) => entry.status === BlockEntryStatus.APPROVED).length,
      evidenceCount: base.workspace.evidence.length,
      evidenceWithFinal: base.workspace.evidence.filter((item) => item.isFinalMarked).length,
      dvvQueriesOpen: dvv.queries.filter((item) => item.status !== DvvQueryStatus.CLOSED).length,
      dvvQueriesClosed: dvv.queries.filter((item) => item.status === DvvQueryStatus.CLOSED).length,
      recommendationsOpen: recommendations.recommendations.filter((item) => item.status !== RecommendationStatus.COMPLETED).length,
      recommendationsCompleted: recommendations.recommendations.filter((item) => item.status === RecommendationStatus.COMPLETED).length,
      dataGapCount: completeness.report.summary.noResponseCount + completeness.report.summary.missingYearCount,
      staleScoreCount: base.workspace.isScoreStale ? 1 : 0,
    },
  };

  if (format === "json") {
    return {
      status: "success",
      format,
      filename: `workspace-${workspaceId}-report.json`,
      payload,
    } satisfies SuccessResult<{ format: "json"; filename: string; payload: typeof payload }>;
  }

  const rows: Array<{
    blockCode: string;
    blockTitle: string;
    status: BlockEntryStatus;
    finalScore: number | null;
    year: number | null;
    scopeKey: string | null;
    numberValue: number | null;
    textValue: string | null;
    dataSource: string | null;
    evidenceCount: number;
  }> = [];

  for (const block of payload.blocks) {
    if (block.responses.length === 0) {
      rows.push({
        blockCode: block.blockCode,
        blockTitle: block.title,
        status: block.response.status,
        finalScore: block.response.finalScore,
        year: null,
        scopeKey: null,
        numberValue: null,
        textValue: null,
        dataSource: null,
        evidenceCount: block.evidence.length,
      });
      continue;
    }

    for (const response of block.responses) {
      rows.push({
        blockCode: block.blockCode,
        blockTitle: block.title,
        status: block.response.status,
        finalScore: block.response.finalScore,
        year: response.year,
        scopeKey: response.scopeKey,
        numberValue: response.numberValue,
        textValue: response.textValue,
        dataSource: response.dataSource,
        evidenceCount: block.evidence.length,
      });
    }
  }

  return {
    status: "success",
    format,
    filename: `workspace-${workspaceId}-report.csv`,
    csv: rowsToCsv(rows),
    payload,
  } satisfies SuccessResult<{ format: "csv"; filename: string; csv: string; payload: typeof payload }>;
}
