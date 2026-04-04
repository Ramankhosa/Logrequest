import {
  AccreditationTemplateLifecycleStatus,
  AssessmentWorkspaceStatus,
  ProjectionRunStatus,
  ProjectionRunType,
  ProjectionSourceKind,
  ProjectionStorageMode,
  CriterionDataType,
  BlockEntryStatus,
  CriterionYearAggregation,
  BlockEntryValueSource,
  Prisma,
  Role,
  SourceMetricValueType,
  WorkspaceCollaboratorRole,
  WorkspaceDiscussionScope,
  WorkspaceGuestInviteStatus,
  WorkspaceGuestRole,
  WorkspaceSectionAssignmentRole,
  WorkspaceSectionReviewStatus,
  WorkspaceSectionReviewerDecisionStatus,
} from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { createBulkNotifications } from "@/lib/notifications/notification-service";
import { prisma } from "@/lib/prisma";
import { hasTenantCapability } from "@/lib/tenant-permissions/service";
import { hasTenantServiceEnabled } from "@/lib/tenant-services/service";
import { parseWorkspaceImportFile } from "./workspace-import";

type DbClient = typeof prisma | Prisma.TransactionClient;

type ErrorResult = {
  status: "error";
  message: string;
};

type SuccessResult<T extends object> = {
  status: "success";
  message?: string;
} & T;

type ServiceResult<T extends object = Record<string, never>> = SuccessResult<T> | ErrorResult;

type CollaboratorContext = {
  id?: string;
  role: WorkspaceCollaboratorRole;
  assignedSections: string[];
  lastVisitedAt?: Date | null;
};

type WorkspacePermissionContext = {
  workspace: {
    id: string;
    tenantId: string;
    title: string;
    status: AssessmentWorkspaceStatus;
    periodStart: Date;
    periodEnd: Date;
    versionId: string;
    profileId: string;
    isScoreStale: boolean;
    lastFrozenSnapshotId: string | null;
  };
  isWorkspaceAdmin: boolean;
  collaborator: CollaboratorContext | null;
};

type WorkspaceScoringCriterion = {
  id: string;
  parentId: string | null;
  blockCode: string;
  title: string;
  dataType: CriterionDataType;
  yearAggregation: CriterionYearAggregation;
  yearAggregationConfig: Prisma.JsonValue | null;
  maxScore: number | null;
  depth: number;
  isLeaf: boolean;
  expectedEvidence: Prisma.JsonValue | null;
  scoringSlabs: Array<{
    rangeMin: number | null;
    rangeMax: number | null;
    pointsAwarded: number;
    sortOrder: number;
  }>;
};

type WorkspaceScoreRow = {
  blockId: string;
  blockCode: string;
  title: string;
  depth: number;
  isLeaf: boolean;
  maxScore: number | null;
  aggregatedValue: number | null;
  computedScore: number | null;
  finalScore: number | null;
  percentage: number | null;
  status: BlockEntryStatus | null;
};

type WorkspaceScoreComputation = {
  overallRawScore: number | null;
  overallConvertedScore: number | null;
  resolvedGrade: string | null;
  resolvedOutcome: string | null;
  thresholdResult: {
    passed: boolean;
    violations: Array<{
      thresholdType: string;
      blockId: string | null;
      blockCode: string | null;
      actualValue: number | null;
      minValue: number;
      outcome: string;
      description: string | null;
    }>;
  };
  blockScores: Record<string, WorkspaceScoreRow>;
  leafEntryUpdates: Array<{
    entryId: string;
    blockId: string;
    computedScore: number | null;
    finalScore: number | null;
  }>;
  dataSourceCounts: Record<string, number>;
};

type WorkspaceEntryFilter = {
  status?: BlockEntryStatus;
};

type WorkspaceSectionLeafEntry = {
  entryId: string;
  blockId: string;
  blockCode: string;
  blockTitle: string;
  status: BlockEntryStatus;
};

type WorkspaceSectionDefinition = {
  sectionBlockId: string;
  blockCode: string;
  sectionCode: string;
  title: string;
  leafEntries: WorkspaceSectionLeafEntry[];
};

const workspaceCreateSchema = z.object({
  versionId: z.string().trim().min(1),
  profileId: z.string().trim().min(1),
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  targetGrade: z.string().trim().max(80).nullable().optional(),
});

const workspaceUpdateSchema = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  periodStart: z.coerce.date().optional(),
  periodEnd: z.coerce.date().optional(),
  targetGrade: z.string().trim().max(80).nullable().optional(),
});

const workspaceStatusSchema = z.object({
  status: z.nativeEnum(AssessmentWorkspaceStatus),
});

const collaboratorInputSchema = z.object({
  userId: z.string().trim().min(1),
  role: z.nativeEnum(WorkspaceCollaboratorRole),
  assignedSections: z.array(z.string().trim().min(1)).default([]),
});

const milestoneInputSchema = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(1000).nullable().optional(),
  dueDate: z.coerce.date(),
  gatesFreeze: z.boolean().optional(),
  sortOrder: z.number().int().min(0).default(0),
});

const milestoneUpdateSchema = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  dueDate: z.coerce.date().optional(),
  gatesFreeze: z.boolean().optional(),
  isCompleted: z.boolean().optional(),
});

const responsesInputSchema = z.object({
  year: z.number().int(),
  numericValue: z.number().nullable().optional(),
  textValue: z.string().trim().max(12000).nullable().optional(),
  remarks: z.string().trim().max(2000).nullable().optional(),
  expectedUpdatedAt: z.coerce.date().nullable().optional(),
  reason: z.string().trim().max(500).nullable().optional(),
});

const entryStatusInputSchema = z.object({
  status: z.nativeEnum(BlockEntryStatus),
  reason: z.string().trim().max(500).nullable().optional(),
});

const manualOverrideInputSchema = z.object({
  manualOverride: z.number().nonnegative().nullable(),
  force: z.boolean().optional(),
  reason: z.string().trim().max(500).nullable().optional(),
});

const evidenceInputSchema = z.object({
  title: z.string().trim().min(2).max(200),
  docType: z.string().trim().max(80).nullable().optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(60)).default([]),
});

const evidenceVersionInputSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  fileUrl: z.string().trim().url(),
  fileSize: z.number().int().nonnegative().nullable().optional(),
  fileType: z.string().trim().max(80).nullable().optional(),
  remark: z.string().trim().max(1000).nullable().optional(),
  isFinal: z.boolean().optional(),
});

const evidenceLinkInputSchema = z.object({
  entryId: z.string().trim().min(1),
});

const snapshotInputSchema = z.object({
  snapshotName: z.string().trim().max(120).nullable().optional(),
});

const freezeWorkspaceInputSchema = z.object({
  acknowledgments: z
    .array(
      z.object({
        code: z.string().trim().min(1).max(80),
        reason: z.string().trim().min(3).max(500),
      }),
    )
    .default([]),
});

const unfreezeWorkspaceInputSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

const cloneWorkspaceInputSchema = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  targetGrade: z.string().trim().max(80).nullable().optional(),
});

const sectionAssignmentRoleSchema = z.nativeEnum(WorkspaceSectionAssignmentRole);

const bulkSectionAssignmentInputSchema = z.object({
  assignments: z
    .array(
      z.object({
        sectionBlockId: z.string().trim().min(1),
        userId: z.string().trim().min(1),
        role: sectionAssignmentRoleSchema,
        deadline: z.coerce.date().nullable().optional(),
      }),
    )
    .min(1),
});

const reassignSectionInputSchema = z.object({
  sectionBlockId: z.string().trim().min(1),
  fromUserId: z.string().trim().min(1),
  toUserId: z.string().trim().min(1),
  role: sectionAssignmentRoleSchema,
  deadline: z.coerce.date().nullable().optional(),
});

const sectionReviewActionSchema = z.object({
  sectionBlockId: z.string().trim().min(1),
  comment: z.string().trim().max(2000).nullable().optional(),
});

const discussionThreadInputSchema = z.object({
  scope: z.nativeEnum(WorkspaceDiscussionScope),
  sectionBlockId: z.string().trim().min(1).nullable().optional(),
  entryId: z.string().trim().min(1).nullable().optional(),
  title: z.string().trim().min(2).max(200),
  body: z.string().trim().min(1).max(4000),
  mentionedUserIds: z.array(z.string().trim().min(1)).default([]),
});

const discussionMessageInputSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  parentMessageId: z.string().trim().min(1).nullable().optional(),
  mentionedUserIds: z.array(z.string().trim().min(1)).default([]),
});

const reusePreviewInputSchema = z.object({
  sourceWorkspaceId: z.string().trim().min(1),
  sectionBlockIds: z.array(z.string().trim().min(1)).optional(),
});

const reuseApplyInputSchema = z.object({
  sourceWorkspaceId: z.string().trim().min(1),
  sectionBlockIds: z.array(z.string().trim().min(1)).optional(),
});

const deleteEvidenceVersionInputSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

const guestInviteInputSchema = z.object({
  email: z.string().trim().email(),
  firstName: z.string().trim().max(120).nullable().optional(),
  lastName: z.string().trim().max(120).nullable().optional(),
  sectionBlockId: z.string().trim().min(1).nullable().optional(),
  role: z.nativeEnum(WorkspaceGuestRole),
  expiresInDays: z.number().int().min(1).max(60).optional(),
});

const guestAcceptInputSchema = z.object({
  token: z.string().trim().min(16),
});

const sourceMetricInputSchema = z.object({
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(1000).nullable().optional(),
  valueType: z.nativeEnum(SourceMetricValueType).default(SourceMetricValueType.NUMBER),
  unitOfMeasure: z.string().trim().max(80).nullable().optional(),
  allowedDimensions: z.record(z.string(), z.string()).nullable().optional(),
});

const sourceMetricObservationInputSchema = z.object({
  observations: z
    .array(
      z.object({
        observedYear: z.number().int().nullable().optional(),
        dimensions: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
        numberValue: z.number().nullable().optional(),
        textValue: z.string().trim().max(12000).nullable().optional(),
        jsonValue: z.any().optional(),
        sourceType: z.string().trim().min(1).max(80).optional(),
        sourceRef: z.string().trim().max(255).nullable().optional(),
      }),
    )
    .min(1),
});

const projectionFilterSchema = z.object({
  years: z.array(z.number().int()).max(10).optional(),
  dimensions: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

const projectionTransformSchema = z.object({
  mode: z.enum(["DIRECT", "SUM", "AVG", "COUNT", "FIRST", "TEXT_JOIN"]).default("DIRECT"),
  sourceColumnKey: z.string().trim().min(1).max(120).optional(),
  multiplier: z.number().optional(),
  divisor: z.number().optional(),
  separator: z.string().max(16).optional(),
});

const entryProjectionInputSchema = z
  .object({
    sourceWorkspaceId: z.string().trim().min(1).optional(),
    sourceEntryId: z.string().trim().min(1).optional(),
    sourceMetricId: z.string().trim().min(1).optional(),
    sourceTableFieldKey: z.string().trim().min(1).max(120).optional(),
    sourcePath: z.enum(["actualValue", "textValue"]).optional(),
    filters: projectionFilterSchema.optional(),
    transform: projectionTransformSchema.optional(),
    targetYear: z.number().int().optional(),
    targetPath: z.enum(["actualValue", "textValue"]).default("actualValue"),
    storageMode: z.nativeEnum(ProjectionStorageMode).default(ProjectionStorageMode.COPY),
  })
  .superRefine((value, ctx) => {
    if (value.sourceMetricId) {
      return;
    }

    if (!value.sourceWorkspaceId || !value.sourceEntryId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select a source workspace/entry or a source metric.",
      });
    }
  });

function normalizeNullableString(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeSections(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashProjectionPayload(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function buildScopeKey(year: number | null | undefined) {
  return year === null || year === undefined ? "STATIC" : `YEAR:${year}`;
}

function sectionSelectionMatches(
  sectionId: string,
  sectionCode: string,
  sectionSelections: string[],
) {
  if (sectionSelections.length === 0) {
    return true;
  }

  return sectionSelections.some(
    (selection) => selection === sectionId || selection === sectionCode,
  );
}

function asJsonObject(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Prisma.JsonObject;
}

function parseNumericArray(value: Prisma.JsonValue | null | undefined) {
  if (!Array.isArray(value)) {
    return null;
  }

  const numbers = value
    .map((item) => (typeof item === "number" ? item : Number(item)))
    .filter((item) => Number.isFinite(item) && item > 0);
  return numbers.length > 0 ? numbers : null;
}

function getWorkspaceYearBounds(periodStart: Date, periodEnd: Date) {
  return {
    startYear: periodStart.getUTCFullYear(),
    endYear: periodEnd.getUTCFullYear(),
  };
}

function getWorkspaceYearSpan(periodStart: Date, periodEnd: Date) {
  const { startYear, endYear } = getWorkspaceYearBounds(periodStart, periodEnd);
  return endYear - startYear + 1;
}

function createWorkspaceGuestInviteToken() {
  const token = randomBytes(24).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  return { token, tokenHash };
}

function hashWorkspaceGuestInviteToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function mapCollaboratorRoleToSectionAssignmentRole(
  role: WorkspaceCollaboratorRole,
): WorkspaceSectionAssignmentRole | null {
  switch (role) {
    case WorkspaceCollaboratorRole.RESPONSIBLE:
      return WorkspaceSectionAssignmentRole.RESPONSIBLE;
    case WorkspaceCollaboratorRole.REVIEWER:
      return WorkspaceSectionAssignmentRole.REVIEWER;
    case WorkspaceCollaboratorRole.APPROVER:
      return WorkspaceSectionAssignmentRole.APPROVER;
    case WorkspaceCollaboratorRole.VIEWER:
      return WorkspaceSectionAssignmentRole.VIEWER;
    default:
      return null;
  }
}

function collaboratorRoleSupportsSectionAssignment(
  collaboratorRole: WorkspaceCollaboratorRole,
  assignmentRole: WorkspaceSectionAssignmentRole,
) {
  switch (assignmentRole) {
    case WorkspaceSectionAssignmentRole.SECTION_LEAD:
    case WorkspaceSectionAssignmentRole.RESPONSIBLE:
      return collaboratorRole === WorkspaceCollaboratorRole.RESPONSIBLE;
    case WorkspaceSectionAssignmentRole.REVIEWER:
      return collaboratorRole === WorkspaceCollaboratorRole.REVIEWER;
    case WorkspaceSectionAssignmentRole.APPROVER:
      return collaboratorRole === WorkspaceCollaboratorRole.APPROVER;
    case WorkspaceSectionAssignmentRole.VIEWER:
      return true;
    default:
      return false;
  }
}

function normalizeReason(value: string | null | undefined) {
  return normalizeNullableString(value);
}

function requiresReasonForReviewedEntryChange(status: BlockEntryStatus) {
  const statuses: BlockEntryStatus[] = [
    BlockEntryStatus.COMPLETE,
    BlockEntryStatus.UNDER_REVIEW,
    BlockEntryStatus.CHANGES_REQUESTED,
    BlockEntryStatus.APPROVED,
  ];
  return statuses.includes(status);
}

function roundScore(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  return Math.round(value * 100) / 100;
}

function stringifyChangeValue(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }
  return String(value);
}

function buildTextChangeLog(before: string | null | undefined, after: string | null | undefined) {
  return {
    oldValue: null,
    newValue: null,
    changeMeta: {
      changed: true,
      lengthBefore: before?.length ?? 0,
      lengthAfter: after?.length ?? 0,
    } satisfies Prisma.JsonObject,
  };
}

function collectExpectedEvidenceDocTypes(value: Prisma.JsonValue | null | undefined): string[] {
  if (!value) {
    return [];
  }

  if (typeof value === "string") {
    const normalized = value.trim().toUpperCase();
    return normalized ? [normalized] : [];
  }

  if (Array.isArray(value)) {
    return [...new Set(value.flatMap((item) => collectExpectedEvidenceDocTypes(item)))];
  }

  if (typeof value === "object") {
    const objectValue = value as Prisma.JsonObject;
    const docTypeValue =
      typeof objectValue.docType === "string"
        ? objectValue.docType
        : typeof objectValue.type === "string"
          ? objectValue.type
          : null;
    const isRequired =
      typeof objectValue.required === "boolean"
        ? objectValue.required
        : typeof objectValue.mandatory === "boolean"
          ? objectValue.mandatory
          : true;
    const nestedDocTypes = [
      ...collectExpectedEvidenceDocTypes(objectValue.items as Prisma.JsonValue | undefined),
      ...collectExpectedEvidenceDocTypes(
        objectValue.requiredDocTypes as Prisma.JsonValue | undefined,
      ),
      ...collectExpectedEvidenceDocTypes(objectValue.documents as Prisma.JsonValue | undefined),
    ];

    if (!docTypeValue || !isRequired) {
      return [...new Set(nestedDocTypes)];
    }

    return [...new Set([docTypeValue.trim().toUpperCase(), ...nestedDocTypes])];
  }

  return [];
}

function defaultWeightedRecentWeights() {
  return [0.4, 0.3, 0.2, 0.1];
}

function resolveAggregationWeights(
  block: Pick<WorkspaceScoringCriterion, "yearAggregationConfig">,
  count: number,
) {
  const configObject = asJsonObject(block.yearAggregationConfig);
  const configuredWeights = parseNumericArray(configObject?.weights as Prisma.JsonValue | undefined);
  const baseWeights = configuredWeights ?? defaultWeightedRecentWeights();
  const weights = [...baseWeights];

  while (weights.length < count) {
    weights.push(weights[weights.length - 1] ?? 1);
  }

  const selected = weights.slice(0, count);
  const total = selected.reduce((sum, value) => sum + value, 0);
  return total > 0 ? selected.map((value) => value / total) : selected.map(() => 1 / count);
}

function aggregateNumericYearData(
  block: Pick<WorkspaceScoringCriterion, "yearAggregation" | "yearAggregationConfig">,
  rows: Array<{ year: number; actualValue: number | null }>,
) {
  const values = rows
    .filter((row) => row.actualValue !== null)
    .sort((left, right) => left.year - right.year)
    .map((row) => ({ year: row.year, value: row.actualValue! }));

  if (values.length === 0) {
    return null;
  }

  switch (block.yearAggregation) {
    case CriterionYearAggregation.SUM:
      return values.reduce((sum, row) => sum + row.value, 0);
    case CriterionYearAggregation.LATEST:
      return values[values.length - 1]?.value ?? null;
    case CriterionYearAggregation.MAX:
      return Math.max(...values.map((row) => row.value));
    case CriterionYearAggregation.WEIGHTED_RECENT: {
      const newestFirst = [...values].sort((left, right) => right.year - left.year);
      const weights = resolveAggregationWeights(block, newestFirst.length);
      return newestFirst.reduce((sum, row, index) => sum + row.value * (weights[index] ?? 0), 0);
    }
    case CriterionYearAggregation.AVERAGE:
    default:
      return values.reduce((sum, row) => sum + row.value, 0) / values.length;
  }
}

function matchesScoringSlab(
  value: number,
  slab: { rangeMin: number | null; rangeMax: number | null },
) {
  const meetsMin = slab.rangeMin === null || value >= slab.rangeMin;
  const meetsMax = slab.rangeMax === null || value <= slab.rangeMax;
  return meetsMin && meetsMax;
}

function clampScore(value: number, maxScore: number | null) {
  if (!Number.isFinite(value)) {
    return null;
  }
  if (maxScore === null) {
    return Math.max(0, value);
  }
  return Math.min(Math.max(0, value), maxScore);
}

async function ensureAccreditationServiceEnabled(tenantId: string) {
  const enabled = await hasTenantServiceEnabled(tenantId, "ACCREDITATION");
  return enabled ? null : "Accreditation service is not enabled for this tenant.";
}

async function hasWorkspaceAdminAccess(
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  return hasTenantCapability({
    tenantId,
    userId: actorUserId,
    baseRole: actorRole,
    capability: "MANAGE_ACCREDITATION",
  });
}

async function getWorkspacePermissionContext(input: {
  tenantId: string;
  workspaceId: string;
  actorUserId: string;
  actorRole: Role | null | undefined;
}): Promise<WorkspacePermissionContext | ErrorResult> {
  const serviceError = await ensureAccreditationServiceEnabled(input.tenantId);
  if (serviceError) {
    return { status: "error", message: serviceError };
  }

  const workspace = await prisma.assessmentWorkspace.findFirst({
    where: {
      id: input.workspaceId,
      tenantId: input.tenantId,
    },
    select: {
      id: true,
      tenantId: true,
      title: true,
      status: true,
      periodStart: true,
      periodEnd: true,
      versionId: true,
      profileId: true,
      isScoreStale: true,
      lastFrozenSnapshotId: true,
    },
  });

  if (!workspace) {
    return { status: "error", message: "Workspace not found." };
  }

  const isWorkspaceAdmin = await hasWorkspaceAdminAccess(
    input.tenantId,
    input.actorUserId,
    input.actorRole,
  );

  if (isWorkspaceAdmin) {
    return {
      workspace,
      isWorkspaceAdmin: true,
      collaborator: null,
    };
  }

  const collaborator = await prisma.workspaceCollaborator.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId: workspace.id,
        userId: input.actorUserId,
      },
    },
    select: {
      id: true,
      role: true,
      assignedSections: true,
      lastVisitedAt: true,
    },
  });

  return {
    workspace,
    isWorkspaceAdmin: false,
    collaborator: collaborator
      ? {
          id: collaborator.id,
          role: collaborator.role,
          assignedSections: collaborator.assignedSections,
          lastVisitedAt: collaborator.lastVisitedAt,
        }
      : null,
  };
}

function canReadWorkspace(context: WorkspacePermissionContext) {
  return context.isWorkspaceAdmin || context.collaborator !== null;
}

function canPerformWorkspaceRole(
  context: WorkspacePermissionContext,
  roles: WorkspaceCollaboratorRole[],
) {
  return context.isWorkspaceAdmin || (!!context.collaborator && roles.includes(context.collaborator.role));
}

async function resolveRootSectionBlockTx(
  tx: DbClient,
  blockId: string,
): Promise<{ id: string; blockCode: string } | null> {
  let currentId: string | null = blockId;
  while (currentId) {
    const current: { id: string; parentId: string | null; blockCode: string } | null =
      await tx.criterionBlock.findUnique({
      where: { id: currentId },
      select: {
        id: true,
        parentId: true,
        blockCode: true,
      },
    });
    if (!current) {
      return null;
    }
    if (!current.parentId) {
      return { id: current.id, blockCode: current.blockCode };
    }
    currentId = current.parentId;
  }

  return null;
}

async function canPerformOnBlock(
  tx: DbClient,
  context: WorkspacePermissionContext,
  roles: WorkspaceCollaboratorRole[],
  blockId: string,
) {
  if (context.isWorkspaceAdmin) {
    return true;
  }

  if (!context.collaborator || !roles.includes(context.collaborator.role)) {
    return false;
  }

  if (context.collaborator.assignedSections.length === 0) {
    return true;
  }

  const rootSection = await resolveRootSectionBlockTx(tx, blockId);
  if (!rootSection) {
    return false;
  }

  return sectionSelectionMatches(
    rootSection.id,
    rootSection.blockCode,
    context.collaborator.assignedSections,
  );
}

function buildRootCriterionByIdMap(
  criteria: Array<{
    id: string;
    parentId: string | null;
    blockCode: string;
    title: string;
    depth: number;
    isLeaf: boolean;
  }>,
) {
  const byId = new Map(criteria.map((block) => [block.id, block]));
  const rootById = new Map<string, (typeof criteria)[number]>();

  const resolveRoot = (blockId: string) => {
    const cached = rootById.get(blockId);
    if (cached) {
      return cached;
    }

    let current = byId.get(blockId) ?? null;
    while (current?.parentId) {
      current = byId.get(current.parentId) ?? null;
    }

    if (current) {
      rootById.set(blockId, current);
    }
    return current;
  };

  for (const block of criteria) {
    resolveRoot(block.id);
  }

  return { byId, rootById };
}

async function buildWorkspaceSectionDefinitionsTx(
  tx: DbClient,
  workspaceId: string,
) {
  const workspace = await tx.assessmentWorkspace.findUnique({
    where: { id: workspaceId },
    select: {
      id: true,
      tenantId: true,
      versionId: true,
      title: true,
      status: true,
      periodStart: true,
      periodEnd: true,
      lastFrozenSnapshotId: true,
    },
  });

  if (!workspace) {
    return null;
  }

  const [criteria, entries] = await Promise.all([
    tx.criterionBlock.findMany({
      where: {
        versionId: workspace.versionId,
        isActive: true,
      },
      select: {
        id: true,
        parentId: true,
        blockCode: true,
        title: true,
        depth: true,
        isLeaf: true,
      },
      orderBy: [{ depth: "asc" }, { sortOrder: "asc" }, { blockCode: "asc" }],
    }),
    tx.blockEntry.findMany({
      where: { workspaceId },
      include: {
        block: {
          select: {
            id: true,
            blockCode: true,
            title: true,
          },
        },
      },
      orderBy: {
        block: {
          blockCode: "asc",
        },
      },
    }),
  ]);

  const { rootById } = buildRootCriterionByIdMap(criteria);
  const rootCriteria = criteria.filter((block) => block.depth === 0);
  const sectionsById = new Map<string, WorkspaceSectionDefinition>();

  for (const root of rootCriteria) {
    sectionsById.set(root.id, {
      sectionBlockId: root.id,
      blockCode: root.blockCode,
      sectionCode: root.blockCode,
      title: root.title,
      leafEntries: [],
    });
  }

  for (const entry of entries) {
    const root = rootById.get(entry.blockId);
    if (!root) {
      continue;
    }

    const section = sectionsById.get(root.id);
    if (!section) {
      continue;
    }

    section.leafEntries.push({
      entryId: entry.id,
      blockId: entry.blockId,
      blockCode: entry.block.blockCode,
      blockTitle: entry.block.title,
      status: entry.status,
    });
  }

  return {
    workspace,
    criteria,
    entries,
    rootCriteria,
    rootById,
    sections: [...sectionsById.values()],
    sectionsById,
  };
}

function isWorkspaceLockedForEntryEdits(status: AssessmentWorkspaceStatus) {
  const lockedStatuses: AssessmentWorkspaceStatus[] = [
    AssessmentWorkspaceStatus.FROZEN,
    AssessmentWorkspaceStatus.SUBMITTED,
    AssessmentWorkspaceStatus.COMPLETED,
    AssessmentWorkspaceStatus.ARCHIVED,
  ];
  return lockedStatuses.includes(status);
}

async function listWorkspaceRecipientUserIds(
  tx: DbClient,
  workspaceId: string,
  excludeUserId?: string,
) {
  const collaborators = await tx.workspaceCollaborator.findMany({
    where: {
      workspaceId,
      ...(excludeUserId ? { userId: { not: excludeUserId } } : {}),
    },
    select: {
      userId: true,
    },
  });

  return [...new Set(collaborators.map((collaborator) => collaborator.userId))];
}

async function ensureWorkspaceSectionCollaborationBackfillTx(
  tx: DbClient,
  workspaceId: string,
) {
  const sectionContext = await buildWorkspaceSectionDefinitionsTx(tx, workspaceId);
  if (!sectionContext) {
    return null;
  }

  if (sectionContext.rootCriteria.length > 0) {
    await tx.workspaceSectionReview.createMany({
      data: sectionContext.rootCriteria.map((section) => ({
        workspaceId,
        sectionBlockId: section.id,
      })),
      skipDuplicates: true,
    });
  }

  const existingAssignmentCount = await tx.workspaceSectionAssignment.count({
    where: {
      workspaceId,
    },
  });

  if (existingAssignmentCount === 0) {
    const collaborators = await tx.workspaceCollaborator.findMany({
      where: {
        workspaceId,
      },
      select: {
        userId: true,
        role: true,
        assignedSections: true,
      },
    });

    for (const collaborator of collaborators) {
      const assignmentRole = mapCollaboratorRoleToSectionAssignmentRole(collaborator.role);
      if (!assignmentRole || collaborator.assignedSections.length === 0) {
        continue;
      }

      const matchingSections = sectionContext.sections.filter((section) =>
        sectionSelectionMatches(
          section.sectionBlockId,
          section.sectionCode,
          collaborator.assignedSections,
        ),
      );
      if (matchingSections.length === 0) {
        continue;
      }

      await tx.workspaceSectionAssignment.createMany({
        data: matchingSections.map((section) => ({
          workspaceId,
          sectionBlockId: section.sectionBlockId,
          userId: collaborator.userId,
          role: assignmentRole,
          assignedByUserId: collaborator.userId,
        })),
        skipDuplicates: true,
      });
    }
  }

  for (const section of sectionContext.sections) {
    const review = await tx.workspaceSectionReview.findUnique({
      where: {
        workspaceId_sectionBlockId: {
          workspaceId,
          sectionBlockId: section.sectionBlockId,
        },
      },
      select: {
        id: true,
      },
    });
    if (!review) {
      continue;
    }

    await syncWorkspaceSectionReviewerDecisionsTx(tx, review.id, workspaceId, section.sectionBlockId);
  }

  return sectionContext;
}

async function syncWorkspaceSectionReviewerDecisionsTx(
  tx: DbClient,
  reviewId: string,
  workspaceId: string,
  sectionBlockId: string,
) {
  const reviewerAssignments = await tx.workspaceSectionAssignment.findMany({
    where: {
      workspaceId,
      sectionBlockId,
      userId: { not: null },
      role: WorkspaceSectionAssignmentRole.REVIEWER,
    },
    select: {
      userId: true,
    },
  });

  const reviewerUserIds = reviewerAssignments
    .map((assignment) => assignment.userId)
    .filter((userId): userId is string => !!userId);

  const existing = await tx.workspaceSectionReviewerDecision.findMany({
    where: { reviewId },
    select: {
      id: true,
      reviewerUserId: true,
      status: true,
    },
  });

  const existingByUserId = new Map(existing.map((row) => [row.reviewerUserId, row]));
  const desiredSet = new Set(reviewerUserIds);

  const toDelete = existing.filter((row) => !desiredSet.has(row.reviewerUserId));
  if (toDelete.length > 0) {
    await tx.workspaceSectionReviewerDecision.deleteMany({
      where: {
        id: {
          in: toDelete.map((row) => row.id),
        },
      },
    });
  }

  const toCreate = reviewerUserIds.filter((userId) => !existingByUserId.has(userId));
  if (toCreate.length > 0) {
    await tx.workspaceSectionReviewerDecision.createMany({
      data: toCreate.map((reviewerUserId) => ({
        reviewId,
        reviewerUserId,
      })),
      skipDuplicates: true,
    });
  }
}

async function syncCollaboratorAssignedSectionsFromAssignmentsTx(
  tx: DbClient,
  workspaceId: string,
  userId: string,
) {
  const collaborator = await tx.workspaceCollaborator.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId,
        userId,
      },
    },
    select: {
      role: true,
    },
  });

  if (!collaborator || collaborator.role === WorkspaceCollaboratorRole.COORDINATOR) {
    return;
  }

  const assignments = await tx.workspaceSectionAssignment.findMany({
    where: {
      workspaceId,
      userId,
    },
    select: {
      sectionBlockId: true,
      role: true,
    },
  });

  await tx.workspaceCollaborator.update({
    where: {
      workspaceId_userId: {
        workspaceId,
        userId,
      },
    },
    data: {
      assignedSections: normalizeSections(
        assignments
          .filter((assignment) =>
            collaboratorRoleSupportsSectionAssignment(collaborator.role, assignment.role),
          )
          .map((assignment) => assignment.sectionBlockId),
      ),
    },
  });
}

async function getInternalSectionAssignmentsForUserTx(
  tx: DbClient,
  workspaceId: string,
  userId: string,
) {
  return tx.workspaceSectionAssignment.findMany({
    where: {
      workspaceId,
      userId,
    },
    select: {
      sectionBlockId: true,
      role: true,
    },
  });
}

function hasInternalSectionAssignment(
  assignments: Array<{ sectionBlockId: string; role: WorkspaceSectionAssignmentRole }>,
  sectionBlockId: string,
  roles: WorkspaceSectionAssignmentRole[],
) {
  return assignments.some(
    (assignment) =>
      assignment.sectionBlockId === sectionBlockId && roles.includes(assignment.role),
  );
}

function canPerformSectionAssignmentAction(
  context: WorkspacePermissionContext,
  assignments: Array<{ sectionBlockId: string; role: WorkspaceSectionAssignmentRole }>,
  sectionBlockId: string,
  roles: WorkspaceSectionAssignmentRole[],
) {
  if (context.isWorkspaceAdmin) {
    return true;
  }

  if (!context.collaborator) {
    return false;
  }

  return assignments.some(
    (assignment) =>
      assignment.sectionBlockId === sectionBlockId &&
      roles.includes(assignment.role) &&
      collaboratorRoleSupportsSectionAssignment(context.collaborator!.role, assignment.role),
  );
}

async function notifyWorkspaceStatusChanged(input: {
  workspaceId: string;
  tenantId: string;
  title: string;
  status: AssessmentWorkspaceStatus;
  actorUserId: string;
}) {
  const recipientUserIds = await listWorkspaceRecipientUserIds(prisma, input.workspaceId, input.actorUserId);
  if (recipientUserIds.length === 0) {
    return;
  }

  await createBulkNotifications(
    input.tenantId,
    recipientUserIds,
    "accreditation.workspace.status",
    `accreditation.workspace.status:${input.workspaceId}:${input.status}:${Date.now()}`,
    `Workspace updated: ${input.title}`,
    `The workspace is now ${input.status.replace(/_/g, " ").toLowerCase()}.`,
    "AssessmentWorkspace",
    input.workspaceId,
    "/workspace/accreditation",
  );
}

async function notifyChangesRequested(input: {
  workspaceId: string;
  tenantId: string;
  entryId: string;
  sectionBlockId: string | null;
  blockCode: string;
  title: string;
  actorUserId: string;
}) {
  const collaborators = await prisma.workspaceCollaborator.findMany({
    where: {
      workspaceId: input.workspaceId,
      role: WorkspaceCollaboratorRole.RESPONSIBLE,
    },
    select: {
      userId: true,
      assignedSections: true,
    },
  });

  const recipientUserIds = collaborators
    .filter((collaborator) =>
      input.sectionBlockId
        ? sectionSelectionMatches(
            input.sectionBlockId,
            input.blockCode,
            collaborator.assignedSections,
          )
        : collaborator.assignedSections.length === 0,
    )
    .map((collaborator) => collaborator.userId)
    .filter((userId) => userId !== input.actorUserId);

  if (recipientUserIds.length === 0) {
    return;
  }

  await createBulkNotifications(
    input.tenantId,
    [...new Set(recipientUserIds)],
    "accreditation.entry.changes-requested",
    `accreditation.entry.changes-requested:${input.entryId}:${Date.now()}`,
    `Changes requested for ${input.blockCode}`,
    `A reviewer requested updates on ${input.blockCode} ${input.title}.`,
    "CriterionEntry",
    input.entryId,
    "/workspace/accreditation",
  );
}

async function notifySectionReviewInvalidated(input: {
  tenantId: string;
  workspaceId: string;
  sectionBlockId: string;
  sectionCode: string;
  triggerMessage: string;
  actorUserId: string;
}) {
  const assignments = await prisma.workspaceSectionAssignment.findMany({
    where: {
      workspaceId: input.workspaceId,
      sectionBlockId: input.sectionBlockId,
      userId: { not: null },
    },
    select: {
      userId: true,
    },
  });

  const recipientUserIds = [...new Set(
    assignments
      .map((assignment) => assignment.userId)
      .filter((userId): userId is string => !!userId && userId !== input.actorUserId),
  )];
  if (recipientUserIds.length === 0) {
    return;
  }

  await createBulkNotifications(
    input.tenantId,
    recipientUserIds,
    "accreditation.section.review-invalidated",
    `accreditation.section.review-invalidated:${input.sectionBlockId}:${Date.now()}`,
    `Section ${input.sectionCode} reopened`,
    input.triggerMessage,
    "WorkspaceSectionReview",
    input.sectionBlockId,
    "/workspace/accreditation",
  );
}

async function notifySectionAssignmentChanged(input: {
  tenantId: string;
  workspaceId: string;
  userId: string;
  sectionCode: string;
  message: string;
}) {
  await createBulkNotifications(
    input.tenantId,
    [input.userId],
    "accreditation.section.assignment",
    `accreditation.section.assignment:${input.workspaceId}:${input.sectionCode}:${input.userId}:${Date.now()}`,
    `Section ${input.sectionCode} assignment updated`,
    input.message,
    "AssessmentWorkspace",
    input.workspaceId,
    "/workspace/accreditation",
  );
}

async function invalidateSectionReviewForCriterionTx(
  tx: DbClient,
  input: {
    workspaceId: string;
    versionId: string;
    blockId: string;
    actorUserId: string;
    triggerMessage: string;
    metadata?: Prisma.JsonValue | null;
  },
) {
  const criteria = await tx.criterionBlock.findMany({
    where: {
      versionId: input.versionId,
      isActive: true,
    },
    select: {
      id: true,
      parentId: true,
      blockCode: true,
      title: true,
      depth: true,
      isLeaf: true,
    },
  });
  const { rootById } = buildRootCriterionByIdMap(criteria);
  const root = rootById.get(input.blockId);
  if (!root) {
    return null;
  }

  const review = await tx.workspaceSectionReview.findUnique({
    where: {
      workspaceId_sectionBlockId: {
        workspaceId: input.workspaceId,
        sectionBlockId: root.id,
      },
    },
    select: {
      id: true,
      status: true,
    },
  });
  if (!review) {
    return {
      sectionBlockId: root.id,
      sectionCode: root.blockCode,
      invalidated: false,
    };
  }

  if (
    review.status === WorkspaceSectionReviewStatus.NOT_STARTED ||
    review.status === WorkspaceSectionReviewStatus.IN_PROGRESS
  ) {
    return {
      sectionBlockId: root.id,
      sectionCode: root.blockCode,
      invalidated: false,
    };
  }

  await tx.workspaceSectionReview.update({
    where: { id: review.id },
    data: {
      status: WorkspaceSectionReviewStatus.IN_PROGRESS,
      approvedAt: null,
      approvedByUserId: null,
      submittedAt: null,
      submittedByUserId: null,
      lastChangedAt: new Date(),
      lastChangedByUserId: input.actorUserId,
    },
  });

  await tx.workspaceSectionReviewerDecision.updateMany({
    where: {
      reviewId: review.id,
    },
    data: {
      status: WorkspaceSectionReviewerDecisionStatus.PENDING,
      confirmedAt: null,
    },
  });

  await tx.workspaceSectionReviewEvent.create({
    data: {
      reviewId: review.id,
      fromStatus: review.status,
      toStatus: WorkspaceSectionReviewStatus.IN_PROGRESS,
      actorUserId: input.actorUserId,
      comment: input.triggerMessage,
      metadata: input.metadata ?? undefined,
    },
  });

  return {
    sectionBlockId: root.id,
    sectionCode: root.blockCode,
    invalidated: true,
  };
}

async function recordCriterionEntryChange(
  tx: DbClient,
  input: {
    entryId: string;
    year?: number | null;
    fieldChanged: string;
    oldValue?: string | null;
    newValue?: string | null;
    changeMeta?: Prisma.JsonValue | null;
    reason?: string | null;
    changedByUserId: string;
  },
) {
  await tx.blockEntryChange.create({
    data: {
      entryId: input.entryId,
      year: input.year ?? null,
      fieldChanged: input.fieldChanged,
      oldValue: input.oldValue ?? null,
      newValue: input.newValue ?? null,
      changeMeta: input.changeMeta ?? undefined,
      reason: input.reason ?? null,
      changedByUserId: input.changedByUserId,
    },
  });
}

async function buildWorkspaceScoringContext(tx: DbClient, workspaceId: string) {
  const workspace = await tx.assessmentWorkspace.findUnique({
    where: { id: workspaceId },
    include: {
      version: {
        include: {
          body: {
            select: {
              code: true,
              name: true,
            },
          },
          gradeBands: {
            orderBy: [{ sortOrder: "asc" }, { scoreMin: "asc" }],
          },
          thresholdRules: {
            orderBy: [{ thresholdType: "asc" }, { minValue: "asc" }],
          },
        },
      },
      profile: {
        include: {
          weightOverrides: true,
        },
      },
      entries: {
        include: {
          responses: {
            orderBy: { year: "asc" },
          },
        },
      },
    },
  });

  if (!workspace) {
    return null;
  }

  const criteria = await tx.criterionBlock.findMany({
    where: {
      versionId: workspace.versionId,
      isActive: true,
    },
    include: {
      scoringSlabs: {
        orderBy: [{ sortOrder: "asc" }, { rangeMin: "asc" }],
      },
    },
    orderBy: [{ depth: "asc" }, { sortOrder: "asc" }, { blockCode: "asc" }],
  });

  return {
    workspace,
    criteria,
  };
}

function computeWorkspaceScoresFromContext(
  context: NonNullable<Awaited<ReturnType<typeof buildWorkspaceScoringContext>>>,
): WorkspaceScoreComputation {
  const criterionById = new Map<string, WorkspaceScoringCriterion>(
    context.criteria.map((block) => [
      block.id,
      {
        id: block.id,
        parentId: block.parentId,
        blockCode: block.blockCode,
        title: block.title,
        dataType: block.dataType,
        yearAggregation: block.yearAggregation,
        yearAggregationConfig: block.yearAggregationConfig,
        maxScore: block.maxScore,
        depth: block.depth,
        isLeaf: block.isLeaf,
        expectedEvidence: block.expectedEvidence,
        scoringSlabs: block.scoringSlabs.map((slab) => ({
          rangeMin: slab.rangeMin,
          rangeMax: slab.rangeMax,
          pointsAwarded: slab.pointsAwarded,
          sortOrder: slab.sortOrder,
        })),
      },
    ]),
  );
  const childrenByParent = new Map<string | null, string[]>();
  for (const block of context.criteria) {
    const existing = childrenByParent.get(block.parentId) ?? [];
    existing.push(block.id);
    childrenByParent.set(block.parentId, existing);
  }

  const profileWeightMap = new Map(
    context.workspace.profile.weightOverrides.map((weight) => [weight.blockId, weight.maxScore]),
  );
  const entryByBlockId = new Map(context.workspace.entries.map((entry) => [entry.blockId, entry]));
  const maxCache = new Map<string, number | null>();

  const resolveEffectiveMaxScore = (blockId: string): number | null => {
    const cached = maxCache.get(blockId);
    if (cached !== undefined) {
      return cached;
    }

    const block = criterionById.get(blockId);
    if (!block) {
      maxCache.set(blockId, null);
      return null;
    }

    const weightedMax = profileWeightMap.get(blockId);
    if (weightedMax !== undefined) {
      maxCache.set(blockId, weightedMax);
      return weightedMax;
    }

    if (block.maxScore !== null) {
      maxCache.set(blockId, block.maxScore);
      return block.maxScore;
    }

    const childIds = childrenByParent.get(blockId) ?? [];
    if (childIds.length === 0) {
      maxCache.set(blockId, null);
      return null;
    }

    const total = childIds.reduce((sum, childId) => sum + (resolveEffectiveMaxScore(childId) ?? 0), 0);
    const resolved = total > 0 ? total : null;
    maxCache.set(blockId, resolved);
    return resolved;
  };

  const blockScores = new Map<string, WorkspaceScoreRow>();
  const leafEntryUpdates: WorkspaceScoreComputation["leafEntryUpdates"] = [];
  const dataSourceCounts = new Map<string, number>();

  for (const entry of context.workspace.entries) {
    for (const responses of entry.responses) {
      dataSourceCounts.set(
        responses.dataSource,
        (dataSourceCounts.get(responses.dataSource) ?? 0) + 1,
      );
    }
  }

  for (const block of context.criteria.filter((item) => item.isLeaf)) {
    const entry = entryByBlockId.get(block.id);
    const effectiveMax = resolveEffectiveMaxScore(block.id);
    const aggregatedValue =
      block.dataType === CriterionDataType.QUALITATIVE || !entry
        ? null
        : aggregateNumericYearData(
            block,
            entry.responses.map((row) => ({
              year: row.year,
              actualValue: row.actualValue,
            })),
          );

    let computedScore: number | null = null;
    if (entry) {
      if (block.dataType === CriterionDataType.QUALITATIVE) {
        computedScore = null;
      } else if (aggregatedValue !== null) {
        if (block.scoringSlabs.length > 0) {
          const matchingSlab = block.scoringSlabs.find((slab) =>
            matchesScoringSlab(aggregatedValue, slab),
          );
          computedScore = matchingSlab ? matchingSlab.pointsAwarded : null;
        } else {
          computedScore = aggregatedValue;
        }
      }
    }

    const normalizedComputedScore = roundScore(
      computedScore === null ? null : clampScore(computedScore, effectiveMax),
    );
    const finalScore = roundScore(
      entry?.manualOverride !== null && entry?.manualOverride !== undefined
        ? entry.manualOverride
        : normalizedComputedScore,
    );

    const row: WorkspaceScoreRow = {
      blockId: block.id,
      blockCode: block.blockCode,
      title: block.title,
      depth: block.depth,
      isLeaf: true,
      maxScore: effectiveMax,
      aggregatedValue: roundScore(aggregatedValue),
      computedScore: normalizedComputedScore,
      finalScore,
      percentage:
        effectiveMax && finalScore !== null && effectiveMax > 0
          ? roundScore((finalScore / effectiveMax) * 100)
          : null,
      status: entry?.status ?? null,
    };
    blockScores.set(block.id, row);

    if (entry) {
      leafEntryUpdates.push({
        entryId: entry.id,
        blockId: block.id,
        computedScore: normalizedComputedScore,
        finalScore,
      });
    }
  }

  const criteriaByDescendingDepth = [...context.criteria].sort((left, right) => right.depth - left.depth);
  for (const block of criteriaByDescendingDepth.filter((item) => !item.isLeaf)) {
    const childIds = childrenByParent.get(block.id) ?? [];
    const childScores = childIds
      .map((childId) => blockScores.get(childId)?.finalScore ?? null)
      .filter((value): value is number => value !== null);
    const summedScore = childScores.length > 0 ? childScores.reduce((sum, value) => sum + value, 0) : null;
    const effectiveMax = resolveEffectiveMaxScore(block.id);
    const finalScore = roundScore(summedScore === null ? null : clampScore(summedScore, effectiveMax));

    blockScores.set(block.id, {
      blockId: block.id,
      blockCode: block.blockCode,
      title: block.title,
      depth: block.depth,
      isLeaf: false,
      maxScore: effectiveMax,
      aggregatedValue: null,
      computedScore: finalScore,
      finalScore,
      percentage:
        effectiveMax && finalScore !== null && effectiveMax > 0
          ? roundScore((finalScore / effectiveMax) * 100)
          : null,
      status: null,
    });
  }

  const rootBlockIds = context.criteria
    .filter((block) => block.parentId === null)
    .map((block) => block.id);
  const overallRawScore = roundScore(
    rootBlockIds.reduce((sum, blockId) => sum + (blockScores.get(blockId)?.finalScore ?? 0), 0),
  );
  const overallConvertedScore =
    overallRawScore !== null
      ? roundScore(
          context.workspace.version.convertedScaleMax && context.workspace.version.scoreBase > 0
            ? (overallRawScore / context.workspace.version.scoreBase) *
                context.workspace.version.convertedScaleMax
            : overallRawScore,
        )
      : null;
  const gradeBasis = overallConvertedScore ?? overallRawScore;
  const matchingBand =
    gradeBasis === null
      ? null
      : context.workspace.version.gradeBands.find(
          (band) => gradeBasis >= band.scoreMin && gradeBasis <= band.scoreMax,
        ) ?? null;

  const thresholdViolations = context.workspace.version.thresholdRules
    .map((rule) => {
      const criterionScore = rule.blockId
        ? blockScores.get(rule.blockId)?.finalScore ?? null
        : overallConvertedScore ?? overallRawScore;
      const blockCode = rule.blockId
        ? blockScores.get(rule.blockId)?.blockCode ?? null
        : null;
      if (criterionScore === null || criterionScore >= rule.minValue) {
        return null;
      }
      return {
        thresholdType: rule.thresholdType,
        blockId: rule.blockId,
        blockCode,
        actualValue: roundScore(criterionScore),
        minValue: rule.minValue,
        outcome: rule.outcome,
        description: rule.description ?? null,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const criterionScoreRecord = Object.fromEntries(
    [...blockScores.entries()].map(([blockId, row]) => [blockId, row]),
  );

  return {
    overallRawScore,
    overallConvertedScore,
    resolvedGrade: matchingBand?.gradeLabel ?? null,
    resolvedOutcome:
      thresholdViolations[0]?.outcome ?? matchingBand?.outcome ?? null,
    thresholdResult: {
      passed: thresholdViolations.length === 0,
      violations: thresholdViolations,
    },
    blockScores: criterionScoreRecord,
    leafEntryUpdates,
    dataSourceCounts: Object.fromEntries(dataSourceCounts.entries()),
  };
}

async function applyWorkspaceScores(
  tx: DbClient,
  workspaceId: string,
  scoring: WorkspaceScoreComputation,
  markFresh: boolean,
) {
  for (const update of scoring.leafEntryUpdates) {
    await tx.blockEntry.update({
      where: { id: update.entryId },
      data: {
        computedScore: update.computedScore,
        finalScore: update.finalScore,
      },
    });
  }

  await tx.assessmentWorkspace.update({
    where: { id: workspaceId },
    data: {
      overallRawScore: scoring.overallRawScore,
      overallConvertedScore: scoring.overallConvertedScore,
      resolvedGrade: scoring.resolvedGrade,
      resolvedOutcome: scoring.resolvedOutcome,
      isScoreStale: markFresh ? false : true,
      lastSuccessfulScoreAt: markFresh ? new Date() : undefined,
    },
  });
}

async function recomputeAndPersistWorkspaceScores(
  tx: DbClient,
  workspaceId: string,
  markFresh: boolean,
) {
  const scoringContext = await buildWorkspaceScoringContext(tx, workspaceId);
  if (!scoringContext) {
    return null;
  }

  const scoring = computeWorkspaceScoresFromContext(scoringContext);
  await applyWorkspaceScores(tx, workspaceId, scoring, markFresh);
  return scoring;
}

async function ensureWorkspaceInProgress(tx: DbClient, workspaceId: string) {
  const workspace = await tx.assessmentWorkspace.findUnique({
    where: { id: workspaceId },
    select: { status: true },
  });

  if (workspace?.status === AssessmentWorkspaceStatus.DRAFT) {
    await tx.assessmentWorkspace.update({
      where: { id: workspaceId },
      data: { status: AssessmentWorkspaceStatus.IN_PROGRESS },
    });
  }
}

async function initializeWorkspaceEntriesTx(
  tx: DbClient,
  workspaceId: string,
  versionId: string,
) {
  const criteria = await tx.criterionBlock.findMany({
    where: {
      versionId,
      isLeaf: true,
      isActive: true,
    },
    select: {
      id: true,
    },
  });

  const existingEntries = await tx.blockEntry.findMany({
    where: { workspaceId },
    select: { blockId: true },
  });
  const existingCriterionIds = new Set(existingEntries.map((entry) => entry.blockId));
  const missingCriterionIds = criteria
    .map((block) => block.id)
    .filter((blockId) => !existingCriterionIds.has(blockId));

  if (missingCriterionIds.length > 0) {
    await tx.blockEntry.createMany({
      data: missingCriterionIds.map((blockId) => ({
        workspaceId,
        blockId,
      })),
      skipDuplicates: true,
    });
  }

  return {
    created: missingCriterionIds.length,
    alreadyExisted: existingEntries.length,
  };
}

async function checkWorkspaceReadinessInternal(
  tx: DbClient,
  workspaceId: string,
) {
  const sectionContext = await ensureWorkspaceSectionCollaborationBackfillTx(tx, workspaceId);
  const workspace = await tx.assessmentWorkspace.findUnique({
    where: { id: workspaceId },
    include: {
      milestones: {
        orderBy: [{ sortOrder: "asc" }, { dueDate: "asc" }],
      },
      entries: {
        include: {
          block: {
            select: {
              blockCode: true,
              title: true,
              expectedEvidence: true,
            },
          },
          evidenceLinks: {
            include: {
              evidence: {
                include: {
                  versions: {
                    orderBy: { versionNumber: "desc" },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!workspace) {
    return null;
  }

  const blockers: Array<{ code: string; message: string }> = [];
  const warnings: Array<{ code: string; message: string }> = [];

  if (workspace.isScoreStale) {
    blockers.push({
      code: "SCORES_STALE",
      message: "Scores are stale. Run a full score computation before freezing.",
    });
  }

  for (const entry of workspace.entries) {
    if (entry.status !== BlockEntryStatus.APPROVED) {
      blockers.push({
        code: "ENTRY_NOT_APPROVED",
        message: `${entry.block.blockCode} is ${entry.status.replace(/_/g, " ").toLowerCase()}.`,
      });
    }

    const requiredDocTypes = collectExpectedEvidenceDocTypes(entry.block.expectedEvidence);
    if (requiredDocTypes.length > 0) {
      const linkedDocTypes = new Set(
        entry.evidenceLinks
          .map((link) => link.evidence.docType?.trim().toUpperCase() ?? null)
          .filter((docType): docType is string => !!docType),
      );
      for (const docType of requiredDocTypes) {
        if (!linkedDocTypes.has(docType)) {
          blockers.push({
            code: "MISSING_REQUIRED_EVIDENCE",
            message: `${entry.block.blockCode} is missing required evidence type ${docType}.`,
          });
        }
      }
    }

    for (const link of entry.evidenceLinks) {
      if (!link.evidence.versions.some((version) => version.isFinal)) {
        warnings.push({
          code: "EVIDENCE_NOT_FINAL",
          message: `${entry.block.blockCode} links evidence "${link.evidence.title}" with no final version marked.`,
        });
      }

      const latestVersion = link.evidence.versions[0] ?? null;
      const ageDays = latestVersion
        ? Math.floor((Date.now() - latestVersion.uploadedAt.getTime()) / (24 * 60 * 60 * 1000))
        : 0;
      if (latestVersion && !link.evidence.versions.some((version) => version.isFinal) && ageDays >= 30) {
        warnings.push({
          code: "EVIDENCE_AGING",
          message: `${link.evidence.title} has been pending finalization for ${ageDays} day(s).`,
        });
      }
    }
  }

  if (sectionContext) {
    const activeAssignmentCount = await tx.workspaceSectionAssignment.count({
      where: { workspaceId },
    });
    if (activeAssignmentCount > 0) {
      const reviews = await tx.workspaceSectionReview.findMany({
        where: { workspaceId },
        select: {
          sectionBlockId: true,
          status: true,
        },
      });
      const reviewBySectionId = new Map(
        reviews.map((review) => [review.sectionBlockId, review.status]),
      );
      for (const section of sectionContext.sections) {
        if (!sectionReviewIsActionable(section)) {
          continue;
        }
        if (reviewBySectionId.get(section.sectionBlockId) !== WorkspaceSectionReviewStatus.APPROVED) {
          blockers.push({
            code: "SECTION_NOT_APPROVED",
            message: `Section ${section.sectionCode} is not approved.`,
          });
        }
      }
    }
  }

  for (const milestone of workspace.milestones) {
    if (milestone.isCompleted) {
      continue;
    }

    if (milestone.gatesFreeze) {
      blockers.push({
        code: "MILESTONE_BLOCKING",
        message: `Blocking milestone "${milestone.title}" is incomplete.`,
      });
      continue;
    }

    const daysUntilDue = Math.ceil((milestone.dueDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
    if (daysUntilDue <= 7) {
      warnings.push({
        code: "MILESTONE_DUE_SOON",
        message:
          daysUntilDue < 0
            ? `Milestone "${milestone.title}" is overdue.`
            : `Milestone "${milestone.title}" is due in ${daysUntilDue} day(s).`,
      });
    }
  }

  return {
    blockers,
    warnings,
    canFreeze: blockers.length === 0,
  };
}

function validateWorkspacePeriod(periodStart: Date, periodEnd: Date) {
  return periodStart.getTime() <= periodEnd.getTime()
    ? null
    : "Period start must be on or before period end.";
}

function validateWorkspaceStatusTransition(
  currentStatus: AssessmentWorkspaceStatus,
  nextStatus: AssessmentWorkspaceStatus,
) {
  if (currentStatus === nextStatus) {
    return null;
  }

  const allowed = new Map<AssessmentWorkspaceStatus, AssessmentWorkspaceStatus[]>([
    [AssessmentWorkspaceStatus.DRAFT, [AssessmentWorkspaceStatus.IN_PROGRESS, AssessmentWorkspaceStatus.ARCHIVED]],
    [
      AssessmentWorkspaceStatus.IN_PROGRESS,
      [AssessmentWorkspaceStatus.UNDER_REVIEW, AssessmentWorkspaceStatus.ARCHIVED],
    ],
    [
      AssessmentWorkspaceStatus.UNDER_REVIEW,
      [AssessmentWorkspaceStatus.IN_PROGRESS, AssessmentWorkspaceStatus.ARCHIVED],
    ],
    [AssessmentWorkspaceStatus.FROZEN, [AssessmentWorkspaceStatus.IN_PROGRESS, AssessmentWorkspaceStatus.SUBMITTED]],
    [AssessmentWorkspaceStatus.SUBMITTED, [AssessmentWorkspaceStatus.COMPLETED, AssessmentWorkspaceStatus.ARCHIVED]],
    [AssessmentWorkspaceStatus.COMPLETED, [AssessmentWorkspaceStatus.ARCHIVED]],
    [AssessmentWorkspaceStatus.ARCHIVED, []],
  ]);

  return allowed.get(currentStatus)?.includes(nextStatus)
    ? null
    : `Workspace cannot transition from ${currentStatus} to ${nextStatus}.`;
}

function validateEntryStatusTransition(
  currentStatus: BlockEntryStatus,
  nextStatus: BlockEntryStatus,
) {
  if (currentStatus === nextStatus) {
    return null;
  }

  const allowed = new Map<BlockEntryStatus, BlockEntryStatus[]>([
    [BlockEntryStatus.BLANK, [BlockEntryStatus.IN_PROGRESS]],
    [BlockEntryStatus.IN_PROGRESS, [BlockEntryStatus.COMPLETE]],
    [BlockEntryStatus.COMPLETE, [BlockEntryStatus.UNDER_REVIEW]],
    [BlockEntryStatus.UNDER_REVIEW, [BlockEntryStatus.CHANGES_REQUESTED, BlockEntryStatus.APPROVED]],
    [BlockEntryStatus.CHANGES_REQUESTED, [BlockEntryStatus.IN_PROGRESS, BlockEntryStatus.COMPLETE]],
    [BlockEntryStatus.APPROVED, [BlockEntryStatus.IN_PROGRESS]],
  ]);

  return allowed.get(currentStatus)?.includes(nextStatus)
    ? null
    : `Entry cannot transition from ${currentStatus} to ${nextStatus}.`;
}

function validateYearDataByCriterion(input: {
  block: {
    dataType: CriterionDataType;
    validationRules: Prisma.JsonValue | null;
    title: string;
  };
  numericValue: number | null;
  textValue: string | null;
}) {
  const { block, numericValue, textValue } = input;

  if (block.dataType === CriterionDataType.QUANTITATIVE) {
    if (numericValue === null) {
      return `${block.title} requires a numeric value.`;
    }
  }

  if (block.dataType === CriterionDataType.QUALITATIVE) {
    if (!textValue) {
      return `${block.title} requires narrative text.`;
    }
  }

  if (block.dataType === CriterionDataType.HYBRID) {
    if (numericValue === null && !textValue) {
      return `${block.title} requires a numeric value, text narrative, or both.`;
    }
  }

  const validationRules = asJsonObject(block.validationRules);
  const minValue =
    typeof validationRules?.min === "number"
      ? validationRules.min
      : typeof validationRules?.minValue === "number"
        ? validationRules.minValue
        : null;
  const maxValue =
    typeof validationRules?.max === "number"
      ? validationRules.max
      : typeof validationRules?.maxValue === "number"
        ? validationRules.maxValue
        : null;
  const maxLength =
    typeof validationRules?.maxLength === "number" ? validationRules.maxLength : null;

  if (numericValue !== null && minValue !== null && numericValue < minValue) {
    return `${block.title} must be at least ${minValue}.`;
  }

  if (numericValue !== null && maxValue !== null && numericValue > maxValue) {
    return `${block.title} must be at most ${maxValue}.`;
  }

  if (textValue && maxLength !== null && textValue.length > maxLength) {
    return `${block.title} must not exceed ${maxLength} characters.`;
  }

  return null;
}

export async function createAssessmentWorkspace(
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
): Promise<ServiceResult<{ workspace: unknown; initialized: { created: number; alreadyExisted: number } }>> {
  const serviceError = await ensureAccreditationServiceEnabled(tenantId);
  if (serviceError) {
    return { status: "error", message: serviceError };
  }

  const allowed = await hasWorkspaceAdminAccess(tenantId, actorUserId, actorRole);
  if (!allowed) {
    return { status: "error", message: "Insufficient permissions to create accreditation workspaces." };
  }

  const parsed = workspaceCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid workspace input." };
  }

  const values = parsed.data;
  const periodError = validateWorkspacePeriod(values.periodStart, values.periodEnd);
  if (periodError) {
    return { status: "error", message: periodError };
  }

  const version = await prisma.accreditationBodyVersion.findFirst({
    where: {
      id: values.versionId,
      isActive: true,
      body: {
        OR: [{ scope: "GLOBAL" }, { tenantId }],
      },
    },
    select: {
      id: true,
      lifecycleStatus: true,
    },
  });

  if (!version) {
    return { status: "error", message: "Accreditation version not found or inactive." };
  }

  if (version.lifecycleStatus !== AccreditationTemplateLifecycleStatus.PUBLISHED) {
    return { status: "error", message: "Only published accreditation templates can be used to create workspaces." };
  }

  const profile = await prisma.accreditationProfile.findFirst({
    where: {
      id: values.profileId,
      versionId: version.id,
    },
    select: {
      id: true,
    },
  });

  if (!profile) {
    return { status: "error", message: "Accreditation profile not found for this version." };
  }

  const leafCriterionCount = await prisma.criterionBlock.count({
    where: {
      versionId: version.id,
      isLeaf: true,
      isActive: true,
    },
  });

  if (leafCriterionCount === 0) {
    return { status: "error", message: "The selected accreditation version has no active leaf criteria." };
  }

  const created = await prisma.$transaction(async (tx) => {
    await tx.accreditationBodyVersion.update({
      where: { id: version.id },
      data: { isLocked: true },
    });

    const workspace = await tx.assessmentWorkspace.create({
      data: {
        tenantId,
        versionId: version.id,
        profileId: profile.id,
        title: values.title,
        description: normalizeNullableString(values.description),
        periodStart: values.periodStart,
        periodEnd: values.periodEnd,
        targetGrade: normalizeNullableString(values.targetGrade),
        createdByUserId: actorUserId,
        collaborators: {
          create: {
            userId: actorUserId,
            role: WorkspaceCollaboratorRole.COORDINATOR,
            assignedSections: [],
            addedByUserId: actorUserId,
          },
        },
      },
    });

    const initialized = await initializeWorkspaceEntriesTx(tx, workspace.id, version.id);
    return { workspaceId: workspace.id, initialized };
  });

  const workspace = await getAssessmentWorkspace(created.workspaceId, tenantId, actorUserId, actorRole);
  if (workspace.status !== "success") {
    return workspace;
  }

  return {
    status: "success",
    message: "Assessment workspace created.",
    workspace: workspace.workspace,
    initialized: created.initialized,
  };
}

export async function listAssessmentWorkspaces(
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const serviceError = await ensureAccreditationServiceEnabled(tenantId);
  if (serviceError) {
    return { status: "error", message: serviceError } satisfies ErrorResult;
  }

  const isWorkspaceAdmin = await hasWorkspaceAdminAccess(tenantId, actorUserId, actorRole);
  const visibleWorkspaceIds = isWorkspaceAdmin
    ? null
    : (
        await prisma.workspaceCollaborator.findMany({
          where: {
            userId: actorUserId,
            workspace: { tenantId },
          },
          select: { workspaceId: true },
        })
      ).map((row) => row.workspaceId);

  const workspaces = await prisma.assessmentWorkspace.findMany({
    where: {
      tenantId,
      ...(visibleWorkspaceIds ? { id: { in: visibleWorkspaceIds } } : {}),
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
      collaborators: {
        orderBy: [{ role: "asc" }, { addedAt: "asc" }],
      },
      milestones: {
        orderBy: [{ sortOrder: "asc" }, { dueDate: "asc" }],
      },
      entries: {
        include: {
          responses: {
            select: {
              id: true,
              actualValue: true,
              textValue: true,
            },
          },
        },
      },
      snapshots: {
        orderBy: { takenAt: "desc" },
        take: 1,
      },
    },
    orderBy: [{ updatedAt: "desc" }],
  });

  const items = workspaces.map((workspace) => {
    const yearSpan = Math.max(1, getWorkspaceYearSpan(workspace.periodStart, workspace.periodEnd));
    const totalEntries = workspace.entries.length;
    const progressStatuses: BlockEntryStatus[] = [
      BlockEntryStatus.COMPLETE,
      BlockEntryStatus.UNDER_REVIEW,
      BlockEntryStatus.APPROVED,
    ];
    const progressCount = workspace.entries.filter((entry) =>
      progressStatuses.includes(entry.status),
    ).length;
    const approvalCount = workspace.entries.filter(
      (entry) => entry.status === BlockEntryStatus.APPROVED,
    ).length;
    const populatedYearCells = workspace.entries.reduce(
      (sum, entry) =>
        sum +
        entry.responses.filter((row) => row.actualValue !== null || row.textValue !== null).length,
      0,
    );
    const expectedYearCells = totalEntries * yearSpan;

    return {
      id: workspace.id,
      title: workspace.title,
      description: workspace.description,
      status: workspace.status,
      targetGrade: workspace.targetGrade,
      periodStart: workspace.periodStart,
      periodEnd: workspace.periodEnd,
      bodyCode: workspace.version.body.code,
      bodyName: workspace.version.body.name,
      versionCode: workspace.version.versionCode,
      versionName: workspace.version.versionName,
      profileCode: workspace.profile.profileCode,
      profileName: workspace.profile.profileName,
      overallRawScore: workspace.overallRawScore,
      overallConvertedScore: workspace.overallConvertedScore,
      resolvedGrade: workspace.resolvedGrade,
      resolvedOutcome: workspace.resolvedOutcome,
      isScoreStale: workspace.isScoreStale,
      lastSuccessfulScoreAt: workspace.lastSuccessfulScoreAt,
      frozenAt: workspace.frozenAt,
      updatedAt: workspace.updatedAt,
      lastSnapshotTakenAt: workspace.snapshots[0]?.takenAt ?? null,
      collaboratorCount: workspace.collaborators.length,
      progressPercent: totalEntries > 0 ? Math.round((progressCount / totalEntries) * 100) : 0,
      approvalPercent: totalEntries > 0 ? Math.round((approvalCount / totalEntries) * 100) : 0,
      dataCompleteness:
        expectedYearCells > 0 ? Math.round((populatedYearCells / expectedYearCells) * 100) : 0,
    };
  });

  return {
    status: "success",
    workspaces: items,
  } satisfies SuccessResult<{ workspaces: typeof items }>;
}

export async function getAssessmentWorkspace(
  workspaceId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId,
    actorUserId,
    actorRole,
  });

  if ("status" in permissionContext) {
    return permissionContext;
  }

  if (!canReadWorkspace(permissionContext)) {
    return { status: "error", message: "You do not have access to this workspace." } satisfies ErrorResult;
  }

  await ensureWorkspaceSectionCollaborationBackfillTx(prisma, workspaceId);

  const workspace = await prisma.assessmentWorkspace.findUnique({
    where: { id: workspaceId },
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
      collaborators: {
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              officialEmail: true,
            },
          },
        },
        orderBy: [{ role: "asc" }, { addedAt: "asc" }],
      },
      milestones: {
        orderBy: [{ sortOrder: "asc" }, { dueDate: "asc" }],
      },
      entries: {
        include: {
          block: {
            select: {
              id: true,
              blockCode: true,
              title: true,
              dataType: true,
              maxScore: true,
              expectedEvidence: true,
            },
          },
          responses: {
            orderBy: { year: "asc" },
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
      snapshots: {
        orderBy: { takenAt: "desc" },
        take: 8,
      },
      freezeLogs: {
        orderBy: { frozenAt: "desc" },
        take: 8,
      },
    },
  });

  if (!workspace) {
    return { status: "error", message: "Workspace not found." } satisfies ErrorResult;
  }

  const readiness = await checkWorkspaceReadinessInternal(prisma, workspaceId);
  const [sectionsResult, dataGapsResult, activityResult] = await Promise.all([
    listAssessmentWorkspaceSections(workspaceId, tenantId, actorUserId, actorRole),
    getAssessmentWorkspaceDataGaps(workspaceId, tenantId, actorUserId, actorRole),
    getAssessmentWorkspaceActivitySinceLastVisit(workspaceId, tenantId, actorUserId, actorRole),
  ]);
  const yearSpan = Math.max(1, getWorkspaceYearSpan(workspace.periodStart, workspace.periodEnd));
  const totalEntries = workspace.entries.length;
  const progressStatuses: BlockEntryStatus[] = [
    BlockEntryStatus.COMPLETE,
    BlockEntryStatus.UNDER_REVIEW,
    BlockEntryStatus.APPROVED,
  ];
  const progressCount = workspace.entries.filter((entry) =>
    progressStatuses.includes(entry.status),
  ).length;
  const approvalCount = workspace.entries.filter(
    (entry) => entry.status === BlockEntryStatus.APPROVED,
  ).length;
  const populatedYearCells = workspace.entries.reduce(
    (sum, entry) =>
      sum +
      entry.responses.filter((row) => row.actualValue !== null || row.textValue !== null).length,
    0,
  );
  const expectedYearCells = totalEntries * yearSpan;

  return {
    status: "success",
    workspace: {
      id: workspace.id,
      title: workspace.title,
      description: workspace.description,
      status: workspace.status,
      targetGrade: workspace.targetGrade,
      periodStart: workspace.periodStart,
      periodEnd: workspace.periodEnd,
      overallRawScore: workspace.overallRawScore,
      overallConvertedScore: workspace.overallConvertedScore,
      resolvedGrade: workspace.resolvedGrade,
      resolvedOutcome: workspace.resolvedOutcome,
      isScoreStale: workspace.isScoreStale,
      lastSuccessfulScoreAt: workspace.lastSuccessfulScoreAt,
      lastFrozenSnapshotId: workspace.lastFrozenSnapshotId,
      frozenAt: workspace.frozenAt,
      frozenByUserId: workspace.frozenByUserId,
      bodyCode: workspace.version.body.code,
      bodyName: workspace.version.body.name,
      versionCode: workspace.version.versionCode,
      versionName: workspace.version.versionName,
      profileCode: workspace.profile.profileCode,
      profileName: workspace.profile.profileName,
      currentUserRole: permissionContext.isWorkspaceAdmin
        ? WorkspaceCollaboratorRole.COORDINATOR
        : permissionContext.collaborator?.role ?? null,
      currentUserAssignedSections: permissionContext.collaborator?.assignedSections ?? [],
      progressPercent: totalEntries > 0 ? Math.round((progressCount / totalEntries) * 100) : 0,
      approvalPercent: totalEntries > 0 ? Math.round((approvalCount / totalEntries) * 100) : 0,
      dataCompleteness:
        expectedYearCells > 0 ? Math.round((populatedYearCells / expectedYearCells) * 100) : 0,
      readiness,
      sections: sectionsResult.status === "success" ? sectionsResult.sections : [],
      dataGaps: dataGapsResult.status === "success" ? dataGapsResult.gaps : [],
      activity: activityResult.status === "success" ? activityResult.activity : null,
      collaborators: workspace.collaborators.map((collaborator) => ({
        id: collaborator.id,
        userId: collaborator.userId,
        role: collaborator.role,
        assignedSections: collaborator.assignedSections,
        lastVisitedAt: collaborator.lastVisitedAt,
        addedAt: collaborator.addedAt,
        name: `${collaborator.user.firstName} ${collaborator.user.lastName}`.trim(),
        email: collaborator.user.officialEmail,
      })),
      milestones: workspace.milestones,
      entries: workspace.entries.map((entry) => ({
        id: entry.id,
        blockId: entry.blockId,
        blockCode: entry.block.blockCode,
        blockTitle: entry.block.title,
        dataType: entry.block.dataType,
        maxScore: entry.block.maxScore,
        status: entry.status,
        computedScore: entry.computedScore,
        manualOverride: entry.manualOverride,
        manualOverrideForced: entry.manualOverrideForced,
        finalScore: entry.finalScore,
        remarks: entry.remarks,
        lastUpdatedAt: entry.lastUpdatedAt,
        responses: entry.responses,
        evidence: entry.evidenceLinks.map((link) => ({
          linkId: link.id,
          evidenceId: link.evidenceId,
          title: link.evidence.title,
          docType: link.evidence.docType,
          isFinalMarked: link.evidence.isFinalMarked,
          latestVersion: link.evidence.versions[0] ?? null,
          versionCount: link.evidence.versions.length,
        })),
      })),
      snapshots: workspace.snapshots,
      freezeLogs: workspace.freezeLogs,
    },
  } satisfies SuccessResult<{ workspace: unknown }>;
}

export async function updateAssessmentWorkspace(
  workspaceId: string,
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }

  if (!canPerformWorkspaceRole(permissionContext, [WorkspaceCollaboratorRole.COORDINATOR])) {
    return { status: "error", message: "Only workspace coordinators can update workspace settings." } satisfies ErrorResult;
  }

  if (
    isWorkspaceLockedForEntryEdits(permissionContext.workspace.status)
  ) {
    return { status: "error", message: "This workspace can no longer be edited." } satisfies ErrorResult;
  }

  const parsed = workspaceUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid workspace input." } satisfies ErrorResult;
  }

  const nextPeriodStart = parsed.data.periodStart ?? permissionContext.workspace.periodStart;
  const nextPeriodEnd = parsed.data.periodEnd ?? permissionContext.workspace.periodEnd;
  const periodError = validateWorkspacePeriod(nextPeriodStart, nextPeriodEnd);
  if (periodError) {
    return { status: "error", message: periodError } satisfies ErrorResult;
  }

  await prisma.assessmentWorkspace.update({
    where: { id: workspaceId },
    data: {
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.description !== undefined
        ? { description: normalizeNullableString(parsed.data.description) }
        : {}),
      ...(parsed.data.targetGrade !== undefined
        ? { targetGrade: normalizeNullableString(parsed.data.targetGrade) }
        : {}),
      ...(parsed.data.periodStart !== undefined ? { periodStart: parsed.data.periodStart } : {}),
      ...(parsed.data.periodEnd !== undefined ? { periodEnd: parsed.data.periodEnd } : {}),
    },
  });

  return getAssessmentWorkspace(workspaceId, tenantId, actorUserId, actorRole);
}

export async function updateAssessmentWorkspaceStatus(
  workspaceId: string,
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }

  if (!canPerformWorkspaceRole(permissionContext, [WorkspaceCollaboratorRole.COORDINATOR])) {
    return { status: "error", message: "Only workspace coordinators can change workspace status." } satisfies ErrorResult;
  }

  const parsed = workspaceStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid workspace status." } satisfies ErrorResult;
  }

  const transitionError = validateWorkspaceStatusTransition(
    permissionContext.workspace.status,
    parsed.data.status,
  );
  if (transitionError) {
    return { status: "error", message: transitionError } satisfies ErrorResult;
  }

  if (parsed.data.status === AssessmentWorkspaceStatus.FROZEN) {
    return { status: "error", message: "Use the freeze action to move a workspace to FROZEN." } satisfies ErrorResult;
  }

  if (
    parsed.data.status === AssessmentWorkspaceStatus.IN_PROGRESS &&
    permissionContext.workspace.status === AssessmentWorkspaceStatus.FROZEN
  ) {
    return {
      status: "error",
      message: "Use the unfreeze action and provide a reason to move a workspace back to IN_PROGRESS.",
    } satisfies ErrorResult;
  }

  await prisma.assessmentWorkspace.update({
    where: { id: workspaceId },
    data: {
      status: parsed.data.status,
    },
  });

  await notifyWorkspaceStatusChanged({
    workspaceId,
    tenantId,
    title: permissionContext.workspace.title,
    status: parsed.data.status,
    actorUserId,
  });

  return getAssessmentWorkspace(workspaceId, tenantId, actorUserId, actorRole);
}

export async function archiveAssessmentWorkspace(
  workspaceId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  return updateAssessmentWorkspaceStatus(
    workspaceId,
    tenantId,
    { status: AssessmentWorkspaceStatus.ARCHIVED },
    actorUserId,
    actorRole,
  );
}

export async function initializeAssessmentWorkspaceEntries(
  workspaceId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }

  if (!canPerformWorkspaceRole(permissionContext, [WorkspaceCollaboratorRole.COORDINATOR])) {
    return { status: "error", message: "Only workspace coordinators can initialize entries." } satisfies ErrorResult;
  }

  const initialized = await prisma.$transaction((tx) =>
    initializeWorkspaceEntriesTx(tx, workspaceId, permissionContext.workspace.versionId),
  );

  return {
    status: "success",
    message: "Workspace entries initialized.",
    initialized,
  } satisfies SuccessResult<{ initialized: typeof initialized }>;
}

export async function listAssessmentWorkspaceEntries(
  workspaceId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
  filters: WorkspaceEntryFilter = {},
) {
  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }

  if (!canReadWorkspace(permissionContext)) {
    return { status: "error", message: "You do not have access to this workspace." } satisfies ErrorResult;
  }

  const entries = await prisma.blockEntry.findMany({
    where: {
      workspaceId,
      ...(filters.status ? { status: filters.status } : {}),
    },
    include: {
      block: {
        select: {
          id: true,
          blockCode: true,
          title: true,
          dataType: true,
          maxScore: true,
          expectedEvidence: true,
        },
      },
      responses: {
        orderBy: { year: "asc" },
      },
      evidenceLinks: {
        include: {
          evidence: {
            include: {
              versions: {
                orderBy: [{ versionNumber: "desc" }],
                take: 1,
              },
            },
          },
        },
      },
    },
    orderBy: {
      block: { blockCode: "asc" },
    },
  });

  return {
    status: "success",
    entries: entries.map((entry) => ({
      id: entry.id,
      blockId: entry.blockId,
      blockCode: entry.block.blockCode,
      blockTitle: entry.block.title,
      dataType: entry.block.dataType,
      maxScore: entry.block.maxScore,
      status: entry.status,
      computedScore: entry.computedScore,
      manualOverride: entry.manualOverride,
      manualOverrideForced: entry.manualOverrideForced,
      finalScore: entry.finalScore,
      remarks: entry.remarks,
      responses: entry.responses,
      evidenceCount: entry.evidenceLinks.length,
      latestEvidence: entry.evidenceLinks.map((link) => ({
        linkId: link.id,
        evidenceId: link.evidenceId,
        title: link.evidence.title,
        docType: link.evidence.docType,
        latestVersion: link.evidence.versions[0] ?? null,
      })),
    })),
  } satisfies SuccessResult<{ entries: unknown[] }>;
}

export async function setBlockEntryResponse(
  entryId: string,
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const parsed = responsesInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid year data." } satisfies ErrorResult;
  }

  const entry = await prisma.blockEntry.findUnique({
    where: { id: entryId },
    include: {
      workspace: {
        select: {
          id: true,
          tenantId: true,
          status: true,
          periodStart: true,
          periodEnd: true,
        },
      },
      block: {
        select: {
          id: true,
          blockCode: true,
          title: true,
          dataType: true,
          validationRules: true,
          isLeaf: true,
        },
      },
    },
  });

  if (!entry || entry.workspace.tenantId !== tenantId) {
    return { status: "error", message: "Entry not found." } satisfies ErrorResult;
  }

  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId: entry.workspace.id,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }

  if (
    !(await canPerformOnBlock(
      prisma,
      permissionContext,
      [WorkspaceCollaboratorRole.RESPONSIBLE, WorkspaceCollaboratorRole.COORDINATOR],
      entry.block.id,
    ))
  ) {
    return { status: "error", message: "You do not have permission to edit this block." } satisfies ErrorResult;
  }

  if (isWorkspaceLockedForEntryEdits(entry.workspace.status)) {
    return { status: "error", message: "This workspace is read-only in its current status." } satisfies ErrorResult;
  }

  if (!entry.block.isLeaf) {
    return { status: "error", message: "Only leaf criteria can capture year data." } satisfies ErrorResult;
  }

  const { startYear, endYear } = getWorkspaceYearBounds(entry.workspace.periodStart, entry.workspace.periodEnd);
  if (parsed.data.year < startYear || parsed.data.year > endYear) {
    return {
      status: "error",
      message: `Year ${parsed.data.year} is outside the workspace period (${startYear}-${endYear}).`,
    } satisfies ErrorResult;
  }

  const liveProjectionLocks = await findActiveLiveProjectionTargetPaths(entryId, parsed.data.year);
  if (
    (parsed.data.numericValue !== undefined && liveProjectionLocks.has("actualValue")) ||
    (parsed.data.textValue !== undefined && liveProjectionLocks.has("textValue"))
  ) {
    return {
      status: "error",
      message: "This data is linked to a live projection. Detach the projection before editing it manually.",
    } satisfies ErrorResult;
  }

  const numericValue = parsed.data.numericValue ?? null;
  const textValue = normalizeNullableString(parsed.data.textValue);
  const validationError = validateYearDataByCriterion({
    block: entry.block,
    numericValue,
    textValue,
  });
  if (validationError) {
    return { status: "error", message: validationError } satisfies ErrorResult;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const existing = await tx.blockEntryYearValue.findUnique({
      where: {
        entryId_year: {
          entryId,
          year: parsed.data.year,
        },
      },
    });

    if (existing && parsed.data.expectedUpdatedAt) {
      const expectedUpdatedAt = parsed.data.expectedUpdatedAt.toISOString();
      const actualUpdatedAt = existing.updatedAt.toISOString();
      if (expectedUpdatedAt !== actualUpdatedAt) {
        return {
          status: "error" as const,
          message: `Data was modified at ${existing.updatedAt.toISOString()}. Refresh to see the latest values.`,
        };
      }
    }

    const nextRemarks = normalizeNullableString(parsed.data.remarks);
    const numericChanged = (existing?.actualValue ?? null) !== numericValue;
    const textChanged = (existing?.textValue ?? null) !== textValue;
    const remarksChanged = (existing?.remarks ?? null) !== nextRemarks;
    const hasMeaningfulChange = !existing || numericChanged || textChanged || remarksChanged;
    const reason = normalizeReason(parsed.data.reason);

    if (hasMeaningfulChange && requiresReasonForReviewedEntryChange(entry.status) && !reason) {
      return {
        status: "error" as const,
        message: "A reason is required when changing data for an entry that has already been reviewed.",
      };
    }

    const saved = existing
      ? await tx.blockEntryYearValue.update({
          where: { id: existing.id },
          data: {
            actualValue: numericValue,
            textValue,
            remarks: nextRemarks,
            dataSource: BlockEntryValueSource.MANUAL,
            sourceRef: null,
            updatedByUserId: actorUserId,
          },
        })
      : await tx.blockEntryYearValue.create({
          data: {
            entryId,
            year: parsed.data.year,
            actualValue: numericValue,
            textValue,
            remarks: nextRemarks,
            dataSource: BlockEntryValueSource.MANUAL,
            updatedByUserId: actorUserId,
          },
        });

    if (numericChanged) {
      await recordCriterionEntryChange(tx, {
        entryId,
        year: parsed.data.year,
        fieldChanged: "actualValue",
        oldValue: stringifyChangeValue(existing?.actualValue ?? null),
        newValue: stringifyChangeValue(numericValue),
        reason,
        changedByUserId: actorUserId,
      });
    }
    if (textChanged) {
      const textLog = buildTextChangeLog(existing?.textValue, textValue);
      await recordCriterionEntryChange(tx, {
        entryId,
        year: parsed.data.year,
        fieldChanged: "textValue",
        oldValue: textLog.oldValue,
        newValue: textLog.newValue,
        changeMeta: textLog.changeMeta,
        reason,
        changedByUserId: actorUserId,
      });
    }
    if (remarksChanged) {
      await recordCriterionEntryChange(tx, {
        entryId,
        year: parsed.data.year,
        fieldChanged: "remarks",
        oldValue: existing?.remarks ?? null,
        newValue: nextRemarks,
        reason,
        changedByUserId: actorUserId,
      });
    }

    if (entry.status === BlockEntryStatus.BLANK) {
      await tx.blockEntry.update({
        where: { id: entryId },
        data: {
          status: BlockEntryStatus.IN_PROGRESS,
          lastUpdatedAt: new Date(),
          lastUpdatedByUserId: actorUserId,
        },
      });
      await recordCriterionEntryChange(tx, {
        entryId,
        fieldChanged: "status",
        oldValue: BlockEntryStatus.BLANK,
        newValue: BlockEntryStatus.IN_PROGRESS,
        reason: "Initial data entry",
        changedByUserId: actorUserId,
      });
    } else {
      await tx.blockEntry.update({
        where: { id: entryId },
        data: {
          lastUpdatedAt: new Date(),
          lastUpdatedByUserId: actorUserId,
        },
      });
    }

    await ensureWorkspaceInProgress(tx, entry.workspace.id);
    await recomputeAndPersistWorkspaceScores(tx, entry.workspace.id, false);

    const invalidation =
      hasMeaningfulChange
        ? await invalidateSectionReviewForCriterionTx(tx, {
            workspaceId: entry.workspace.id,
            versionId: permissionContext.workspace.versionId,
            blockId: entry.block.id,
            actorUserId,
            triggerMessage: `${entry.block.blockCode} ${parsed.data.year} data was updated.`,
            metadata: {
              blockCode: entry.block.blockCode,
              year: parsed.data.year,
              numericChanged,
              textChanged,
              remarksChanged,
            } satisfies Prisma.JsonObject,
          })
        : null;

    return {
      status: "success" as const,
      responses: saved,
      invalidation,
    };
  });

  if (updated.status === "error") {
    return updated;
  }

  if (updated.invalidation?.invalidated) {
    await notifySectionReviewInvalidated({
      tenantId,
      workspaceId: entry.workspace.id,
      sectionBlockId: updated.invalidation.sectionBlockId,
      sectionCode: updated.invalidation.sectionCode,
      triggerMessage: `${entry.block.blockCode} data changed and reopened the section review.`,
      actorUserId,
    });
  }

  return {
    status: "success",
    message: "Year data saved.",
    responses: updated.responses,
  } satisfies SuccessResult<{ responses: typeof updated.responses }>;
}

export async function updateBlockEntryStatus(
  entryId: string,
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const parsed = entryStatusInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid entry status." } satisfies ErrorResult;
  }

  const entry = await prisma.blockEntry.findUnique({
    where: { id: entryId },
    include: {
      workspace: {
        select: {
          id: true,
          tenantId: true,
          status: true,
        },
      },
      block: {
        select: {
          blockCode: true,
          title: true,
        },
      },
    },
  });

  if (!entry || entry.workspace.tenantId !== tenantId) {
    return { status: "error", message: "Entry not found." } satisfies ErrorResult;
  }

  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId: entry.workspace.id,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }

  const transitionError = validateEntryStatusTransition(entry.status, parsed.data.status);
  if (transitionError) {
    return { status: "error", message: transitionError } satisfies ErrorResult;
  }

  const nextStatus = parsed.data.status;
  const blockCode = entry.block.blockCode;
  const reason = normalizeNullableString(parsed.data.reason);

  let allowed = false;
  if (nextStatus === BlockEntryStatus.COMPLETE) {
    allowed = await canPerformOnBlock(
      prisma,
      permissionContext,
      [WorkspaceCollaboratorRole.RESPONSIBLE, WorkspaceCollaboratorRole.COORDINATOR],
      entry.blockId,
    );
  } else if (nextStatus === BlockEntryStatus.UNDER_REVIEW) {
    allowed = await canPerformOnBlock(
      prisma,
      permissionContext,
      [WorkspaceCollaboratorRole.REVIEWER, WorkspaceCollaboratorRole.COORDINATOR],
      entry.blockId,
    );
  } else if (nextStatus === BlockEntryStatus.APPROVED) {
    allowed = await canPerformOnBlock(
      prisma,
      permissionContext,
      [WorkspaceCollaboratorRole.APPROVER, WorkspaceCollaboratorRole.COORDINATOR],
      entry.blockId,
    );
  } else if (nextStatus === BlockEntryStatus.CHANGES_REQUESTED) {
    allowed = await canPerformOnBlock(
      prisma,
      permissionContext,
      [
        WorkspaceCollaboratorRole.REVIEWER,
        WorkspaceCollaboratorRole.APPROVER,
        WorkspaceCollaboratorRole.COORDINATOR,
      ],
      entry.blockId,
    );
  } else if (nextStatus === BlockEntryStatus.IN_PROGRESS) {
    allowed =
      (await canPerformOnBlock(
        prisma,
        permissionContext,
        [WorkspaceCollaboratorRole.RESPONSIBLE, WorkspaceCollaboratorRole.COORDINATOR],
        entry.blockId,
      )) ||
      (entry.status === BlockEntryStatus.APPROVED &&
        canPerformWorkspaceRole(permissionContext, [WorkspaceCollaboratorRole.COORDINATOR]) &&
        !isWorkspaceLockedForEntryEdits(entry.workspace.status));
  }

  if (!allowed) {
    return { status: "error", message: "You do not have permission to apply this status transition." } satisfies ErrorResult;
  }

  if (entry.status === BlockEntryStatus.APPROVED && nextStatus === BlockEntryStatus.IN_PROGRESS) {
    if (
      isWorkspaceLockedForEntryEdits(entry.workspace.status)
    ) {
      return { status: "error", message: "Approved entries cannot be reopened after workspace freeze." } satisfies ErrorResult;
    }
  }

  const statusUpdate = await prisma.$transaction(async (tx) => {
    await tx.blockEntry.update({
      where: { id: entryId },
      data: {
        status: nextStatus,
        lastUpdatedAt: new Date(),
        lastUpdatedByUserId: actorUserId,
      },
    });

    await recordCriterionEntryChange(tx, {
      entryId,
      fieldChanged: "status",
      oldValue: entry.status,
      newValue: nextStatus,
      reason,
      changedByUserId: actorUserId,
    });

    await ensureWorkspaceInProgress(tx, entry.workspace.id);
    const invalidation = await invalidateSectionReviewForCriterionTx(tx, {
      workspaceId: entry.workspace.id,
      versionId: permissionContext.workspace.versionId,
      blockId: entry.blockId,
      actorUserId,
      triggerMessage: `${blockCode} status changed from ${entry.status} to ${nextStatus}.`,
      metadata: {
        blockCode,
        previousStatus: entry.status,
        nextStatus,
      } satisfies Prisma.JsonObject,
    });

    return { invalidation };
  });

  if (nextStatus === BlockEntryStatus.CHANGES_REQUESTED) {
    await notifyChangesRequested({
      workspaceId: entry.workspace.id,
      tenantId,
      entryId,
      sectionBlockId: statusUpdate.invalidation?.sectionBlockId ?? null,
      blockCode,
      title: entry.block.title,
      actorUserId,
    });
  }

  if (statusUpdate.invalidation?.invalidated) {
    await notifySectionReviewInvalidated({
      tenantId,
      workspaceId: entry.workspace.id,
      sectionBlockId: statusUpdate.invalidation.sectionBlockId,
      sectionCode: statusUpdate.invalidation.sectionCode,
      triggerMessage: `${blockCode} status changed and reopened the section review.`,
      actorUserId,
    });
  }

  return {
    status: "success",
    message: "Entry status updated.",
  };
}

export async function setBlockEntryManualOverride(
  entryId: string,
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const parsed = manualOverrideInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid override input." } satisfies ErrorResult;
  }

  const entry = await prisma.blockEntry.findUnique({
    where: { id: entryId },
    include: {
      workspace: {
        select: {
          id: true,
          tenantId: true,
          status: true,
        },
      },
      block: {
        select: {
          id: true,
          blockCode: true,
        },
      },
    },
  });

  if (!entry || entry.workspace.tenantId !== tenantId) {
    return { status: "error", message: "Entry not found." } satisfies ErrorResult;
  }

  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId: entry.workspace.id,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }

  if (
    !(await canPerformOnBlock(
      prisma,
      permissionContext,
      [WorkspaceCollaboratorRole.APPROVER, WorkspaceCollaboratorRole.COORDINATOR],
      entry.block.id,
    ))
  ) {
    return { status: "error", message: "You do not have permission to apply manual score overrides." } satisfies ErrorResult;
  }

  if (isWorkspaceLockedForEntryEdits(entry.workspace.status)) {
    return { status: "error", message: "This workspace is read-only in its current status." } satisfies ErrorResult;
  }

  const scoringContext = await buildWorkspaceScoringContext(prisma, entry.workspace.id);
  if (!scoringContext) {
    return { status: "error", message: "Unable to compute the effective maximum score." } satisfies ErrorResult;
  }

  const block = scoringContext.criteria.find((item) => item.id === entry.block.id);
  if (!block) {
    return { status: "error", message: "Criterion not found." } satisfies ErrorResult;
  }

  const weightOverride =
    scoringContext.workspace.profile.weightOverrides.find((weight) => weight.blockId === block.id)
      ?.maxScore ?? null;
  const effectiveMax = weightOverride ?? block.maxScore;
  const manualOverride = parsed.data.manualOverride;
  const force = parsed.data.force ?? false;
  const reason = normalizeReason(parsed.data.reason);

  if (manualOverride !== null && effectiveMax !== null && manualOverride > effectiveMax) {
    const isCoordinator =
      permissionContext.isWorkspaceAdmin ||
      permissionContext.collaborator?.role === WorkspaceCollaboratorRole.COORDINATOR;
    if (!force || !isCoordinator) {
      return {
        status: "error",
        message: `Manual override cannot exceed the effective maximum score of ${effectiveMax}.`,
      } satisfies ErrorResult;
    }
    if (!reason) {
      return {
        status: "error",
        message: "Forced manual overrides require a reason.",
      } satisfies ErrorResult;
    }
  }

  if ((manualOverride ?? null) !== (entry.manualOverride ?? null) && !reason) {
    return {
      status: "error",
      message: "A reason is required for manual score overrides.",
    } satisfies ErrorResult;
  }

  const overrideUpdate = await prisma.$transaction(async (tx) => {
    await tx.blockEntry.update({
      where: { id: entryId },
      data: {
        manualOverride,
        manualOverrideForced: !!manualOverride && !!force,
        lastUpdatedAt: new Date(),
        lastUpdatedByUserId: actorUserId,
      },
    });

    await recordCriterionEntryChange(tx, {
      entryId,
      fieldChanged: "manualOverride",
      oldValue: stringifyChangeValue(entry.manualOverride),
      newValue: stringifyChangeValue(manualOverride),
      reason,
      changedByUserId: actorUserId,
    });

    await ensureWorkspaceInProgress(tx, entry.workspace.id);
    await recomputeAndPersistWorkspaceScores(tx, entry.workspace.id, false);
    const invalidation = await invalidateSectionReviewForCriterionTx(tx, {
      workspaceId: entry.workspace.id,
      versionId: permissionContext.workspace.versionId,
      blockId: entry.block.id,
      actorUserId,
      triggerMessage: `${entry.block.blockCode} manual override changed.`,
      metadata: {
        blockCode: entry.block.blockCode,
        previousManualOverride: entry.manualOverride,
        nextManualOverride: manualOverride,
      } satisfies Prisma.JsonObject,
    });

    return { invalidation };
  });

  if (overrideUpdate.invalidation?.invalidated) {
    await notifySectionReviewInvalidated({
      tenantId,
      workspaceId: entry.workspace.id,
      sectionBlockId: overrideUpdate.invalidation.sectionBlockId,
      sectionCode: overrideUpdate.invalidation.sectionCode,
      triggerMessage: `${entry.block.blockCode} manual override changed and reopened the section review.`,
      actorUserId,
    });
  }

  return {
    status: "success",
    message: "Manual override saved.",
  };
}

export async function listBlockEntryChangeLog(
  entryId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const entry = await prisma.blockEntry.findUnique({
    where: { id: entryId },
    select: {
      workspaceId: true,
      workspace: {
        select: {
          tenantId: true,
        },
      },
    },
  });

  if (!entry || entry.workspace.tenantId !== tenantId) {
    return { status: "error", message: "Entry not found." } satisfies ErrorResult;
  }

  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId: entry.workspaceId,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }

  if (!canReadWorkspace(permissionContext)) {
    return { status: "error", message: "You do not have access to this workspace." } satisfies ErrorResult;
  }

  const changes = await prisma.blockEntryChange.findMany({
    where: { entryId },
    orderBy: { changedAt: "desc" },
  });

  return {
    status: "success",
    changes,
  } satisfies SuccessResult<{ changes: typeof changes }>;
}

export async function listAssessmentWorkspaceCollaborators(
  workspaceId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }

  if (!canReadWorkspace(permissionContext)) {
    return { status: "error", message: "You do not have access to this workspace." } satisfies ErrorResult;
  }

  const collaborators = await prisma.workspaceCollaborator.findMany({
    where: { workspaceId },
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          officialEmail: true,
        },
      },
    },
    orderBy: [{ role: "asc" }, { addedAt: "asc" }],
  });

  return {
    status: "success",
    collaborators: collaborators.map((collaborator) => ({
      id: collaborator.id,
      userId: collaborator.userId,
      role: collaborator.role,
      assignedSections: collaborator.assignedSections,
      lastVisitedAt: collaborator.lastVisitedAt,
      addedAt: collaborator.addedAt,
      name: `${collaborator.user.firstName} ${collaborator.user.lastName}`.trim(),
      email: collaborator.user.officialEmail,
    })),
  } satisfies SuccessResult<{ collaborators: unknown[] }>;
}

export async function addAssessmentWorkspaceCollaborator(
  workspaceId: string,
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }

  if (!canPerformWorkspaceRole(permissionContext, [WorkspaceCollaboratorRole.COORDINATOR])) {
    return { status: "error", message: "Only workspace coordinators can manage collaborators." } satisfies ErrorResult;
  }

  const parsed = collaboratorInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid collaborator input." } satisfies ErrorResult;
  }

  const membership = await prisma.membership.findFirst({
    where: {
      tenantId,
      userId: parsed.data.userId,
      status: {
        in: ["ACTIVE", "INVITED", "PENDING_ACTIVATION", "LOCKED", "SUSPENDED"],
      },
    },
    select: {
      id: true,
    },
  });

  if (!membership) {
    return { status: "error", message: "Selected user is not an accessible tenant member." } satisfies ErrorResult;
  }

  const collaborator = await prisma.workspaceCollaborator.upsert({
    where: {
      workspaceId_userId: {
        workspaceId,
        userId: parsed.data.userId,
      },
    },
    create: {
      workspaceId,
      userId: parsed.data.userId,
      role: parsed.data.role,
      assignedSections: normalizeSections(parsed.data.assignedSections),
      addedByUserId: actorUserId,
    },
    update: {
      role: parsed.data.role,
      assignedSections: normalizeSections(parsed.data.assignedSections),
      addedByUserId: actorUserId,
    },
    include: {
      user: {
        select: {
          firstName: true,
          lastName: true,
          officialEmail: true,
        },
      },
    },
  });

  return {
    status: "success",
    message: "Collaborator saved.",
    collaborator: {
      id: collaborator.id,
      userId: collaborator.userId,
      role: collaborator.role,
      assignedSections: collaborator.assignedSections,
      addedAt: collaborator.addedAt,
      name: `${collaborator.user.firstName} ${collaborator.user.lastName}`.trim(),
      email: collaborator.user.officialEmail,
    },
  } satisfies SuccessResult<{ collaborator: unknown }>;
}

export async function removeAssessmentWorkspaceCollaborator(
  workspaceId: string,
  userId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }

  if (!canPerformWorkspaceRole(permissionContext, [WorkspaceCollaboratorRole.COORDINATOR])) {
    return { status: "error", message: "Only workspace coordinators can manage collaborators." } satisfies ErrorResult;
  }

  if (userId === actorUserId) {
    const coordinatorCount = await prisma.workspaceCollaborator.count({
      where: {
        workspaceId,
        role: WorkspaceCollaboratorRole.COORDINATOR,
      },
    });
    if (coordinatorCount <= 1) {
      return { status: "error", message: "A workspace must keep at least one coordinator." } satisfies ErrorResult;
    }
  }

  await ensureWorkspaceSectionCollaborationBackfillTx(prisma, workspaceId);
  const activeAssignments = await prisma.workspaceSectionAssignment.findMany({
    where: {
      workspaceId,
      userId,
    },
    include: {
      sectionBlock: {
        select: {
          blockCode: true,
        },
      },
    },
  });
  if (activeAssignments.length > 0) {
    return {
      status: "error",
      message: `This collaborator still has section assignments (${activeAssignments
        .map((assignment) => assignment.sectionBlock.blockCode)
        .join(", ")}). Reassign or remove those first.`,
    } satisfies ErrorResult;
  }

  await prisma.workspaceCollaborator.deleteMany({
    where: {
      workspaceId,
      userId,
    },
  });

  return {
    status: "success",
    message: "Collaborator removed.",
  };
}

export async function listAssessmentWorkspaceMilestones(
  workspaceId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }

  if (!canReadWorkspace(permissionContext)) {
    return { status: "error", message: "You do not have access to this workspace." } satisfies ErrorResult;
  }

  const milestones = await prisma.workspaceMilestone.findMany({
    where: { workspaceId },
    orderBy: [{ sortOrder: "asc" }, { dueDate: "asc" }],
  });

  return {
    status: "success",
    milestones,
  } satisfies SuccessResult<{ milestones: typeof milestones }>;
}

export async function addAssessmentWorkspaceMilestone(
  workspaceId: string,
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }

  if (!canPerformWorkspaceRole(permissionContext, [WorkspaceCollaboratorRole.COORDINATOR])) {
    return { status: "error", message: "Only workspace coordinators can manage milestones." } satisfies ErrorResult;
  }

  const parsed = milestoneInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid milestone input." } satisfies ErrorResult;
  }

  const milestone = await prisma.workspaceMilestone.create({
    data: {
      workspaceId,
      title: parsed.data.title,
      description: normalizeNullableString(parsed.data.description),
      dueDate: parsed.data.dueDate,
      gatesFreeze: parsed.data.gatesFreeze ?? false,
      sortOrder: parsed.data.sortOrder,
    },
  });

  return {
    status: "success",
    message: "Milestone added.",
    milestone,
  } satisfies SuccessResult<{ milestone: typeof milestone }>;
}

export async function updateAssessmentWorkspaceMilestone(
  milestoneId: string,
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const milestone = await prisma.workspaceMilestone.findUnique({
    where: { id: milestoneId },
    include: {
      workspace: {
        select: {
          id: true,
          tenantId: true,
        },
      },
    },
  });

  if (!milestone || milestone.workspace.tenantId !== tenantId) {
    return { status: "error", message: "Milestone not found." } satisfies ErrorResult;
  }

  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId: milestone.workspace.id,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }

  if (!canPerformWorkspaceRole(permissionContext, [WorkspaceCollaboratorRole.COORDINATOR])) {
    return { status: "error", message: "Only workspace coordinators can manage milestones." } satisfies ErrorResult;
  }

  const parsed = milestoneUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid milestone input." } satisfies ErrorResult;
  }

  const updated = await prisma.workspaceMilestone.update({
    where: { id: milestoneId },
    data: {
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.description !== undefined
        ? { description: normalizeNullableString(parsed.data.description) }
        : {}),
      ...(parsed.data.dueDate !== undefined ? { dueDate: parsed.data.dueDate } : {}),
      ...(parsed.data.gatesFreeze !== undefined ? { gatesFreeze: parsed.data.gatesFreeze } : {}),
      ...(parsed.data.isCompleted !== undefined
        ? {
            isCompleted: parsed.data.isCompleted,
            completedAt: parsed.data.isCompleted ? new Date() : null,
            completedByUserId: parsed.data.isCompleted ? actorUserId : null,
          }
        : {}),
    },
  });

  return {
    status: "success",
    message: "Milestone updated.",
    milestone: updated,
  } satisfies SuccessResult<{ milestone: typeof updated }>;
}

export async function deleteAssessmentWorkspaceMilestone(
  milestoneId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const milestone = await prisma.workspaceMilestone.findUnique({
    where: { id: milestoneId },
    include: {
      workspace: {
        select: {
          id: true,
          tenantId: true,
        },
      },
    },
  });

  if (!milestone || milestone.workspace.tenantId !== tenantId) {
    return { status: "error", message: "Milestone not found." } satisfies ErrorResult;
  }

  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId: milestone.workspace.id,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }

  if (!canPerformWorkspaceRole(permissionContext, [WorkspaceCollaboratorRole.COORDINATOR])) {
    return { status: "error", message: "Only workspace coordinators can manage milestones." } satisfies ErrorResult;
  }

  await prisma.workspaceMilestone.delete({
    where: { id: milestoneId },
  });

  return {
    status: "success",
    message: "Milestone deleted.",
  };
}

export async function createAssessmentWorkspaceEvidence(
  workspaceId: string,
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }

  if (
    !canPerformWorkspaceRole(permissionContext, [
      WorkspaceCollaboratorRole.RESPONSIBLE,
      WorkspaceCollaboratorRole.COORDINATOR,
    ])
  ) {
    return { status: "error", message: "You do not have permission to add evidence." } satisfies ErrorResult;
  }

  if (isWorkspaceLockedForEntryEdits(permissionContext.workspace.status)) {
    return { status: "error", message: "This workspace is read-only in its current status." } satisfies ErrorResult;
  }

  const parsed = evidenceInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid evidence input." } satisfies ErrorResult;
  }

  const evidence = await prisma.blockEvidence.create({
    data: {
      workspaceId,
      title: parsed.data.title,
      docType: normalizeNullableString(parsed.data.docType)?.toUpperCase() ?? null,
      description: normalizeNullableString(parsed.data.description),
      tags: normalizeSections(parsed.data.tags),
      createdByUserId: actorUserId,
    },
  });

  await ensureWorkspaceInProgress(prisma, workspaceId);

  return {
    status: "success",
    message: "Evidence created.",
    evidence,
  } satisfies SuccessResult<{ evidence: typeof evidence }>;
}

export async function listAssessmentWorkspaceEvidence(
  workspaceId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }

  if (!canReadWorkspace(permissionContext)) {
    return { status: "error", message: "You do not have access to this workspace." } satisfies ErrorResult;
  }

  const evidence = await prisma.blockEvidence.findMany({
    where: { workspaceId },
    include: {
      versions: {
        orderBy: [{ versionNumber: "desc" }],
      },
      entryLinks: {
        include: {
          entry: {
            include: {
              block: {
                select: {
                  blockCode: true,
                  title: true,
                },
              },
            },
          },
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }],
  });

  return {
    status: "success",
    evidence: evidence.map((item) => ({
      id: item.id,
      title: item.title,
      docType: item.docType,
      description: item.description,
      tags: item.tags,
      isFinalMarked: item.isFinalMarked,
      latestVersionNumber: item.latestVersionNumber,
      versions: item.versions,
      links: item.entryLinks.map((link) => ({
        linkId: link.id,
        entryId: link.entryId,
        blockCode: link.entry.block.blockCode,
        blockTitle: link.entry.block.title,
      })),
    })),
  } satisfies SuccessResult<{ evidence: unknown[] }>;
}

export async function addAssessmentWorkspaceEvidenceVersion(
  evidenceId: string,
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const evidence = await prisma.blockEvidence.findUnique({
    where: { id: evidenceId },
    include: {
      workspace: {
        select: {
          id: true,
          tenantId: true,
          status: true,
        },
      },
    },
  });

  if (!evidence || evidence.workspace.tenantId !== tenantId) {
    return { status: "error", message: "Evidence not found." } satisfies ErrorResult;
  }

  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId: evidence.workspace.id,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }

  if (
    !canPerformWorkspaceRole(permissionContext, [
      WorkspaceCollaboratorRole.RESPONSIBLE,
      WorkspaceCollaboratorRole.COORDINATOR,
    ])
  ) {
    return { status: "error", message: "You do not have permission to add evidence versions." } satisfies ErrorResult;
  }

  if (isWorkspaceLockedForEntryEdits(evidence.workspace.status)) {
    return { status: "error", message: "This workspace is read-only in its current status." } satisfies ErrorResult;
  }

  const parsed = evidenceVersionInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid evidence version input." } satisfies ErrorResult;
  }

  let lastConflictError: unknown = null;
  let versionResult:
    | {
        version: Awaited<ReturnType<typeof prisma.evidenceVersion.create>>;
        invalidations: Array<{ sectionBlockId: string; sectionCode: string }>;
      }
    | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      versionResult = await prisma.$transaction(async (tx) => {
        const refreshedEvidence = await tx.blockEvidence.findUniqueOrThrow({
          where: { id: evidenceId },
          select: {
            latestVersionNumber: true,
            isFinalMarked: true,
          },
        });

        if (parsed.data.isFinal) {
          await tx.evidenceVersion.updateMany({
            where: {
              evidenceId,
              isFinal: true,
            },
            data: {
              isFinal: false,
            },
          });
        }

        const createdVersion = await tx.evidenceVersion.create({
          data: {
            evidenceId,
            versionNumber: refreshedEvidence.latestVersionNumber + 1,
            fileName: parsed.data.fileName,
            fileUrl: parsed.data.fileUrl,
            fileSize: parsed.data.fileSize ?? null,
            fileType: normalizeNullableString(parsed.data.fileType),
            remark: normalizeNullableString(parsed.data.remark),
            isFinal: parsed.data.isFinal ?? false,
            uploadedByUserId: actorUserId,
          },
        });

        await tx.blockEvidence.update({
          where: { id: evidenceId },
          data: {
            latestVersionNumber: createdVersion.versionNumber,
            isFinalMarked: parsed.data.isFinal ?? refreshedEvidence.isFinalMarked,
          },
        });

        const linkedEntries = await tx.evidenceEntryLink.findMany({
          where: { evidenceId },
          include: {
            entry: {
              select: {
                blockId: true,
              },
            },
          },
        });

        const invalidations: Array<{ sectionBlockId: string; sectionCode: string }> = [];
        for (const link of linkedEntries) {
          const invalidation = await invalidateSectionReviewForCriterionTx(tx, {
            workspaceId: evidence.workspace.id,
            versionId: permissionContext.workspace.versionId,
            blockId: link.entry.blockId,
            actorUserId,
            triggerMessage: `Evidence "${evidence.title}" received a new version.`,
            metadata: {
              evidenceId,
              evidenceTitle: evidence.title,
              versionNumber: createdVersion.versionNumber,
            } satisfies Prisma.JsonObject,
          });
          if (invalidation?.invalidated) {
            invalidations.push({
              sectionBlockId: invalidation.sectionBlockId,
              sectionCode: invalidation.sectionCode,
            });
          }
        }

        return {
          version: createdVersion,
          invalidations,
        };
      });
      lastConflictError = null;
      break;
    } catch (error) {
      lastConflictError = error;
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
        throw error;
      }
    }
  }

  if (!versionResult) {
    throw lastConflictError instanceof Error
      ? lastConflictError
      : new Error("Unable to persist evidence version.");
  }

  for (const invalidation of versionResult.invalidations) {
    await notifySectionReviewInvalidated({
      tenantId,
      workspaceId: evidence.workspace.id,
      sectionBlockId: invalidation.sectionBlockId,
      sectionCode: invalidation.sectionCode,
      triggerMessage: `Evidence "${evidence.title}" changed and reopened the section review.`,
      actorUserId,
    });
  }

  return {
    status: "success",
    message: "Evidence version uploaded.",
    version: versionResult.version,
  } satisfies SuccessResult<{ version: typeof versionResult.version }>;
}

export async function linkAssessmentWorkspaceEvidence(
  evidenceId: string,
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const parsed = evidenceLinkInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid evidence link input." } satisfies ErrorResult;
  }

  const [evidence, entry] = await Promise.all([
    prisma.blockEvidence.findUnique({
      where: { id: evidenceId },
      include: {
        workspace: {
          select: {
            id: true,
            tenantId: true,
            status: true,
          },
        },
      },
    }),
    prisma.blockEntry.findUnique({
      where: { id: parsed.data.entryId },
      include: {
        workspace: {
          select: {
            id: true,
            tenantId: true,
          },
        },
        block: {
          select: {
            blockCode: true,
          },
        },
      },
    }),
  ]);

  if (!evidence || evidence.workspace.tenantId !== tenantId || !entry || entry.workspace.tenantId !== tenantId) {
    return { status: "error", message: "Evidence or entry not found." } satisfies ErrorResult;
  }

  if (evidence.workspace.id !== entry.workspace.id) {
    return { status: "error", message: "Evidence and entry must belong to the same workspace." } satisfies ErrorResult;
  }

  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId: evidence.workspace.id,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }

  if (
    !(await canPerformOnBlock(
      prisma,
      permissionContext,
      [WorkspaceCollaboratorRole.RESPONSIBLE, WorkspaceCollaboratorRole.COORDINATOR],
      entry.blockId,
    ))
  ) {
    return { status: "error", message: "You do not have permission to link evidence to this block." } satisfies ErrorResult;
  }

  if (isWorkspaceLockedForEntryEdits(evidence.workspace.status)) {
    return { status: "error", message: "This workspace is read-only in its current status." } satisfies ErrorResult;
  }

  const linkResult = await prisma.$transaction(async (tx) => {
    const created = await tx.evidenceEntryLink.create({
      data: {
        evidenceId,
        entryId: entry.id,
        linkedByUserId: actorUserId,
      },
    });

    const currentEntry = await tx.blockEntry.findUnique({
      where: { id: entry.id },
      select: { status: true },
    });
    if (currentEntry?.status === BlockEntryStatus.BLANK) {
      await tx.blockEntry.update({
        where: { id: entry.id },
        data: {
          status: BlockEntryStatus.IN_PROGRESS,
          lastUpdatedAt: new Date(),
          lastUpdatedByUserId: actorUserId,
        },
      });
    }

    await ensureWorkspaceInProgress(tx, evidence.workspace.id);
    const invalidation = await invalidateSectionReviewForCriterionTx(tx, {
      workspaceId: evidence.workspace.id,
      versionId: permissionContext.workspace.versionId,
      blockId: entry.blockId,
      actorUserId,
      triggerMessage: `Evidence "${evidence.title}" was linked to ${entry.block.blockCode}.`,
      metadata: {
        evidenceId,
        entryId: entry.id,
        blockCode: entry.block.blockCode,
      } satisfies Prisma.JsonObject,
    });

    return { link: created, invalidation };
  });

  if (linkResult.invalidation?.invalidated) {
    await notifySectionReviewInvalidated({
      tenantId,
      workspaceId: evidence.workspace.id,
      sectionBlockId: linkResult.invalidation.sectionBlockId,
      sectionCode: linkResult.invalidation.sectionCode,
      triggerMessage: `${entry.block.blockCode} evidence links changed and reopened the section review.`,
      actorUserId,
    });
  }

  return {
    status: "success",
    message: "Evidence linked to criterion entry.",
    link: linkResult.link,
  } satisfies SuccessResult<{ link: typeof linkResult.link }>;
}

export async function unlinkAssessmentWorkspaceEvidence(
  linkId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const link = await prisma.evidenceEntryLink.findUnique({
    where: { id: linkId },
    include: {
      evidence: {
        include: {
          workspace: {
            select: {
              id: true,
              tenantId: true,
              status: true,
            },
          },
        },
      },
      entry: {
        include: {
          block: {
            select: {
              blockCode: true,
            },
          },
        },
      },
    },
  });

  if (!link || link.evidence.workspace.tenantId !== tenantId) {
    return { status: "error", message: "Evidence link not found." } satisfies ErrorResult;
  }

  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId: link.evidence.workspace.id,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }

  if (
    !(await canPerformOnBlock(
      prisma,
      permissionContext,
      [WorkspaceCollaboratorRole.RESPONSIBLE, WorkspaceCollaboratorRole.COORDINATOR],
      link.entry.blockId,
    ))
  ) {
    return { status: "error", message: "You do not have permission to unlink evidence from this block." } satisfies ErrorResult;
  }

  if (isWorkspaceLockedForEntryEdits(link.evidence.workspace.status)) {
    return { status: "error", message: "This workspace is read-only in its current status." } satisfies ErrorResult;
  }

  const unlinkResult = await prisma.$transaction(async (tx) => {
    await tx.evidenceEntryLink.delete({
      where: { id: linkId },
    });

    const invalidation = await invalidateSectionReviewForCriterionTx(tx, {
      workspaceId: link.evidence.workspace.id,
      versionId: permissionContext.workspace.versionId,
      blockId: link.entry.blockId,
      actorUserId,
      triggerMessage: `Evidence "${link.evidence.title}" was unlinked from ${link.entry.block.blockCode}.`,
      metadata: {
        evidenceId: link.evidenceId,
        entryId: link.entryId,
        blockCode: link.entry.block.blockCode,
      } satisfies Prisma.JsonObject,
    });

    return { invalidation };
  });

  if (unlinkResult.invalidation?.invalidated) {
    await notifySectionReviewInvalidated({
      tenantId,
      workspaceId: link.evidence.workspace.id,
      sectionBlockId: unlinkResult.invalidation.sectionBlockId,
      sectionCode: unlinkResult.invalidation.sectionCode,
      triggerMessage: `${link.entry.block.blockCode} evidence links changed and reopened the section review.`,
      actorUserId,
    });
  }

  return {
    status: "success",
    message: "Evidence link removed.",
  };
}

export async function deleteAssessmentWorkspaceEvidence(
  evidenceId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const evidence = await prisma.blockEvidence.findUnique({
    where: { id: evidenceId },
    include: {
      workspace: {
        select: {
          id: true,
          tenantId: true,
          status: true,
        },
      },
      entryLinks: {
        include: {
          entry: {
            include: {
              block: {
                select: {
                  blockCode: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!evidence || evidence.workspace.tenantId !== tenantId) {
    return { status: "error", message: "Evidence not found." } satisfies ErrorResult;
  }

  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId: evidence.workspace.id,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }

  if (!canPerformWorkspaceRole(permissionContext, [WorkspaceCollaboratorRole.COORDINATOR])) {
    return { status: "error", message: "Only workspace coordinators can delete evidence." } satisfies ErrorResult;
  }

  if (isWorkspaceLockedForEntryEdits(evidence.workspace.status)) {
    return { status: "error", message: "This workspace is read-only in its current status." } satisfies ErrorResult;
  }

  if (evidence.entryLinks.length > 0) {
    return {
      status: "error",
      message: `This evidence is linked to ${evidence.entryLinks
        .map((link) => link.entry.block.blockCode)
        .join(", ")}. Unlink it first before deleting.`,
    } satisfies ErrorResult;
  }

  await prisma.blockEvidence.delete({
    where: { id: evidenceId },
  });

  return {
    status: "success",
    message: "Evidence deleted.",
  };
}

export async function computeAssessmentWorkspaceScores(
  workspaceId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }

  if (!canPerformWorkspaceRole(permissionContext, [WorkspaceCollaboratorRole.COORDINATOR])) {
    return { status: "error", message: "Only workspace coordinators can run full score computation." } satisfies ErrorResult;
  }

  const scoring = await prisma.$transaction((tx) =>
    recomputeAndPersistWorkspaceScores(tx, workspaceId, true),
  );

  if (!scoring) {
    return { status: "error", message: "Workspace not found." } satisfies ErrorResult;
  }

  return {
    status: "success",
    message: "Workspace scores recomputed.",
    scoring,
  } satisfies SuccessResult<{ scoring: WorkspaceScoreComputation }>;
}

export async function checkAssessmentWorkspaceReadiness(
  workspaceId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }

  if (!canReadWorkspace(permissionContext)) {
    return { status: "error", message: "You do not have access to this workspace." } satisfies ErrorResult;
  }

  const readiness = await checkWorkspaceReadinessInternal(prisma, workspaceId);
  if (!readiness) {
    return { status: "error", message: "Workspace not found." } satisfies ErrorResult;
  }

  return {
    status: "success",
    readiness,
  } satisfies SuccessResult<{ readiness: typeof readiness }>;
}

async function takeSnapshotTx(
  tx: DbClient,
  workspaceId: string,
  actorUserId: string,
  snapshotName?: string | null,
) {
  const scoringContext = await buildWorkspaceScoringContext(tx, workspaceId);
  if (!scoringContext) {
    return null;
  }

  const scoring = computeWorkspaceScoresFromContext(scoringContext);
  const snapshot = await tx.scoreSnapshot.create({
    data: {
      workspaceId,
      snapshotName: normalizeNullableString(snapshotName) ??
        `Snapshot ${new Date().toISOString().slice(0, 19).replace("T", " ")}`,
      overallRawScore: scoring.overallRawScore ?? 0,
      overallConvertedScore: scoring.overallConvertedScore,
      resolvedGrade: scoring.resolvedGrade,
      resolvedOutcome: scoring.resolvedOutcome,
      blockScores: scoring.blockScores as Prisma.JsonObject,
      thresholdResult: scoring.thresholdResult as Prisma.JsonObject,
      dataSourceSnapshot: scoring.dataSourceCounts as Prisma.JsonObject,
      takenByUserId: actorUserId,
    },
  });

  return { snapshot, scoring };
}

export async function takeAssessmentWorkspaceSnapshot(
  workspaceId: string,
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }

  if (!canPerformWorkspaceRole(permissionContext, [WorkspaceCollaboratorRole.COORDINATOR])) {
    return { status: "error", message: "Only workspace coordinators can take snapshots." } satisfies ErrorResult;
  }

  const parsed = snapshotInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid snapshot input." } satisfies ErrorResult;
  }

  const taken = await prisma.$transaction((tx) =>
    takeSnapshotTx(tx, workspaceId, actorUserId, parsed.data.snapshotName),
  );

  if (!taken) {
    return { status: "error", message: "Workspace not found." } satisfies ErrorResult;
  }

  return {
    status: "success",
    message: "Snapshot captured.",
    snapshot: taken.snapshot,
  } satisfies SuccessResult<{ snapshot: typeof taken.snapshot }>;
}

export async function listAssessmentWorkspaceSnapshots(
  workspaceId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }

  if (!canReadWorkspace(permissionContext)) {
    return { status: "error", message: "You do not have access to this workspace." } satisfies ErrorResult;
  }

  const snapshots = await prisma.scoreSnapshot.findMany({
    where: { workspaceId },
    orderBy: { takenAt: "desc" },
  });

  return {
    status: "success",
    snapshots,
  } satisfies SuccessResult<{ snapshots: typeof snapshots }>;
}

function parseSnapshotCriterionScores(value: Prisma.JsonValue) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, WorkspaceScoreRow>;
  }
  return value as unknown as Record<string, WorkspaceScoreRow>;
}

export async function compareAssessmentWorkspaceSnapshots(
  snapshotIdOne: string,
  snapshotIdTwo: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const snapshots = await prisma.scoreSnapshot.findMany({
    where: {
      id: { in: [snapshotIdOne, snapshotIdTwo] },
      workspace: {
        tenantId,
      },
    },
    include: {
      workspace: {
        select: {
          id: true,
        },
      },
    },
  });

  if (snapshots.length !== 2) {
    return { status: "error", message: "One or both snapshots were not found." } satisfies ErrorResult;
  }

  if (snapshots[0]!.workspace.id !== snapshots[1]!.workspace.id) {
    return { status: "error", message: "Snapshots must belong to the same workspace." } satisfies ErrorResult;
  }

  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId: snapshots[0]!.workspace.id,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }

  if (!canReadWorkspace(permissionContext)) {
    return { status: "error", message: "You do not have access to this workspace." } satisfies ErrorResult;
  }

  const [left, right] = snapshots.sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime());
  const leftScores = parseSnapshotCriterionScores(left.blockScores);
  const rightScores = parseSnapshotCriterionScores(right.blockScores);
  const blockIds = [...new Set([...Object.keys(leftScores), ...Object.keys(rightScores)])];
  const deltas = blockIds
    .map((blockId) => {
      const before = leftScores[blockId] ?? null;
      const after = rightScores[blockId] ?? null;
      const beforeScore = before?.finalScore ?? null;
      const afterScore = after?.finalScore ?? null;
      if (beforeScore === afterScore) {
        return null;
      }
      return {
        blockId,
        blockCode: after?.blockCode ?? before?.blockCode ?? blockId,
        title: after?.title ?? before?.title ?? blockId,
        beforeScore,
        afterScore,
        delta:
          beforeScore !== null && afterScore !== null ? roundScore(afterScore - beforeScore) : null,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return {
    status: "success",
    comparison: {
      leftSnapshot: left,
      rightSnapshot: right,
      overallRawDelta:
        left.overallRawScore !== null && right.overallRawScore !== null
          ? roundScore(right.overallRawScore - left.overallRawScore)
          : null,
      overallConvertedDelta:
        left.overallConvertedScore !== null && right.overallConvertedScore !== null
          ? roundScore(right.overallConvertedScore - left.overallConvertedScore)
          : null,
      deltas,
    },
  } satisfies SuccessResult<{ comparison: unknown }>;
}

export async function checkAssessmentWorkspaceDrift(
  workspaceId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }

  if (!canReadWorkspace(permissionContext)) {
    return { status: "error", message: "You do not have access to this workspace." } satisfies ErrorResult;
  }

  const workspace = await prisma.assessmentWorkspace.findUnique({
    where: { id: workspaceId },
    select: {
      lastFrozenSnapshotId: true,
    },
  });

  if (!workspace?.lastFrozenSnapshotId) {
    return {
      status: "success",
      drift: {
        hasDrift: false,
        baselineSnapshot: null,
        deltas: [],
      },
    } satisfies SuccessResult<{ drift: unknown }>;
  }

  const [baseline, currentScoringContext] = await Promise.all([
    prisma.scoreSnapshot.findUnique({
      where: { id: workspace.lastFrozenSnapshotId },
    }),
    buildWorkspaceScoringContext(prisma, workspaceId),
  ]);

  if (!baseline || !currentScoringContext) {
    return { status: "error", message: "Unable to compute workspace drift." } satisfies ErrorResult;
  }

  const currentScoring = computeWorkspaceScoresFromContext(currentScoringContext);
  const baselineScores = parseSnapshotCriterionScores(baseline.blockScores);
  const currentScores = currentScoring.blockScores;
  const blockIds = [...new Set([...Object.keys(baselineScores), ...Object.keys(currentScores)])];
  const deltas = blockIds
    .map((blockId) => {
      const before = baselineScores[blockId]?.finalScore ?? null;
      const after = currentScores[blockId]?.finalScore ?? null;
      if (before === after) {
        return null;
      }
      return {
        blockId,
        blockCode:
          currentScores[blockId]?.blockCode ??
          baselineScores[blockId]?.blockCode ??
          blockId,
        before,
        after,
        delta:
          before !== null && after !== null ? roundScore(after - before) : null,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return {
    status: "success",
    drift: {
      hasDrift: deltas.length > 0,
      baselineSnapshot: baseline,
      overallRawDelta:
        currentScoring.overallRawScore !== null
        && baseline.overallRawScore !== null
          ? roundScore(currentScoring.overallRawScore - baseline.overallRawScore)
          : null,
      overallConvertedDelta:
        currentScoring.overallConvertedScore !== null
        && baseline.overallConvertedScore !== null
          ? roundScore(currentScoring.overallConvertedScore - baseline.overallConvertedScore)
          : null,
      deltas,
    },
  } satisfies SuccessResult<{ drift: unknown }>;
}

export async function freezeAssessmentWorkspace(
  workspaceId: string,
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }

  if (!canPerformWorkspaceRole(permissionContext, [WorkspaceCollaboratorRole.COORDINATOR])) {
    return { status: "error", message: "Only workspace coordinators can freeze workspaces." } satisfies ErrorResult;
  }

  if (permissionContext.workspace.status === AssessmentWorkspaceStatus.SUBMITTED
    || permissionContext.workspace.status === AssessmentWorkspaceStatus.COMPLETED
    || permissionContext.workspace.status === AssessmentWorkspaceStatus.ARCHIVED) {
    return { status: "error", message: "This workspace can no longer be frozen." } satisfies ErrorResult;
  }

  const parsed = freezeWorkspaceInputSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid freeze input." } satisfies ErrorResult;
  }

  const frozen = await prisma.$transaction(async (tx) => {
    const scoring = await recomputeAndPersistWorkspaceScores(tx, workspaceId, true);
    if (!scoring) {
      return { status: "error" as const, message: "Workspace not found." };
    }

    const readiness = await checkWorkspaceReadinessInternal(tx, workspaceId);
    if (!readiness) {
      return { status: "error" as const, message: "Workspace not found." };
    }
    if (!readiness.canFreeze) {
      return {
        status: "error" as const,
        message: readiness.blockers[0]?.message ?? "Workspace is not ready to freeze.",
      };
    }

    const warningCodes = readiness.warnings.map((warning) => warning.code);
    const acknowledgedCodes = new Set(parsed.data.acknowledgments.map((item) => item.code));
    const missingWarningAcks = warningCodes.filter((code) => !acknowledgedCodes.has(code));
    if (missingWarningAcks.length > 0) {
      return {
        status: "error" as const,
        message: `Warnings must be acknowledged before freeze: ${missingWarningAcks.join(", ")}.`,
      };
    }

    const taken = await takeSnapshotTx(tx, workspaceId, actorUserId, "Freeze snapshot");
    if (!taken) {
      return { status: "error" as const, message: "Unable to capture a freeze snapshot." };
    }

    let changesSummary: Prisma.JsonObject | undefined;
    if (permissionContext.workspace.lastFrozenSnapshotId) {
      const previousSnapshot = await tx.scoreSnapshot.findUnique({
        where: { id: permissionContext.workspace.lastFrozenSnapshotId },
        select: {
          overallRawScore: true,
          overallConvertedScore: true,
          blockScores: true,
        },
      });
      if (previousSnapshot) {
        const currentScores = taken.scoring.blockScores;
        const previousScores = asJsonObject(previousSnapshot.blockScores);
        const changedCriterionCount = Object.entries(currentScores).filter(([blockId, row]) => {
          const previous = asJsonObject(previousScores?.[blockId] as Prisma.JsonValue | undefined);
          return previous?.finalScore !== row.finalScore;
        }).length;
        changesSummary = {
          changedCriterionCount,
          rawScoreDelta:
            previousSnapshot.overallRawScore !== null && taken.scoring.overallRawScore !== null
              ? roundScore(taken.scoring.overallRawScore - previousSnapshot.overallRawScore)
              : null,
          convertedScoreDelta:
            previousSnapshot.overallConvertedScore !== null &&
            taken.scoring.overallConvertedScore !== null
              ? roundScore(
                  taken.scoring.overallConvertedScore - previousSnapshot.overallConvertedScore,
                )
              : null,
        };
      }
    }

    await tx.assessmentWorkspace.update({
      where: { id: workspaceId },
      data: {
        status: AssessmentWorkspaceStatus.FROZEN,
        frozenAt: new Date(),
        frozenByUserId: actorUserId,
        lastFrozenSnapshotId: taken.snapshot.id,
      },
    });

    await tx.workspaceFreezeLog.create({
      data: {
        workspaceId,
        snapshotId: taken.snapshot.id,
        frozenAt: new Date(),
        frozenByUserId: actorUserId,
        warningAcknowledgments:
          parsed.data.acknowledgments.length > 0
            ? ({
                acknowledgments: parsed.data.acknowledgments,
                warnings: readiness.warnings,
              } satisfies Prisma.JsonObject)
            : undefined,
        changesSummary,
      },
    });

    return {
      status: "success" as const,
      snapshotId: taken.snapshot.id,
    };
  });

  if (frozen.status === "error") {
    return frozen;
  }

  await notifyWorkspaceStatusChanged({
    workspaceId,
    tenantId,
    title: permissionContext.workspace.title,
    status: AssessmentWorkspaceStatus.FROZEN,
    actorUserId,
  });

  return {
    status: "success",
    message: "Workspace frozen and snapshot captured.",
    snapshotId: frozen.snapshotId,
  } satisfies SuccessResult<{ snapshotId: string }>;
}

export async function unfreezeAssessmentWorkspace(
  workspaceId: string,
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }

  if (!canPerformWorkspaceRole(permissionContext, [WorkspaceCollaboratorRole.COORDINATOR])) {
    return { status: "error", message: "Only workspace coordinators can unfreeze workspaces." } satisfies ErrorResult;
  }

  if (permissionContext.workspace.status !== AssessmentWorkspaceStatus.FROZEN) {
    return { status: "error", message: "Only frozen workspaces can be unfrozen." } satisfies ErrorResult;
  }

  const parsed = unfreezeWorkspaceInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid unfreeze input." } satisfies ErrorResult;
  }

  const importResult = await prisma.$transaction(async (tx) => {
    await tx.assessmentWorkspace.update({
      where: { id: workspaceId },
      data: {
        status: AssessmentWorkspaceStatus.IN_PROGRESS,
        frozenAt: null,
        frozenByUserId: null,
        isScoreStale: true,
      },
    });

    const latestLog = await tx.workspaceFreezeLog.findFirst({
      where: {
        workspaceId,
        unfrozenAt: null,
      },
      orderBy: { frozenAt: "desc" },
    });
    if (latestLog) {
      await tx.workspaceFreezeLog.update({
        where: { id: latestLog.id },
        data: {
          unfrozenAt: new Date(),
          unfrozenByUserId: actorUserId,
          unfreezeReason: parsed.data.reason,
        },
      });
    }
  });

  await notifyWorkspaceStatusChanged({
    workspaceId,
    tenantId,
    title: permissionContext.workspace.title,
    status: AssessmentWorkspaceStatus.IN_PROGRESS,
    actorUserId,
  });

  return {
    status: "success",
    message: "Workspace unfrozen.",
  };
}

export async function importAssessmentWorkspaceData(
  workspaceId: string,
  tenantId: string,
  input: {
    fileName: string;
    buffer: Buffer;
  },
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }

  if (!canPerformWorkspaceRole(permissionContext, [WorkspaceCollaboratorRole.COORDINATOR])) {
    return { status: "error", message: "Only workspace coordinators can import workspace data." } satisfies ErrorResult;
  }

  if (isWorkspaceLockedForEntryEdits(permissionContext.workspace.status)) {
    return { status: "error", message: "This workspace is read-only in its current status." } satisfies ErrorResult;
  }

  const parsed = parseWorkspaceImportFile(input.buffer, input.fileName);
  const entryMap = new Map(
    (
      await prisma.blockEntry.findMany({
        where: { workspaceId },
        include: {
          block: {
            select: {
              blockCode: true,
              dataType: true,
              title: true,
              validationRules: true,
            },
          },
        },
      })
    ).map((entry) => [entry.block.blockCode, entry]),
  );

  const { startYear, endYear } = getWorkspaceYearBounds(
    permissionContext.workspace.periodStart,
    permissionContext.workspace.periodEnd,
  );

  const errors: string[] = [];
  let imported = 0;
  let skipped = 0;

  const importResult = await prisma.$transaction(async (tx) => {
    const invalidations: Array<{ sectionBlockId: string; sectionCode: string }> = [];
    for (const row of parsed.rows) {
      if (row.errors.length > 0) {
        errors.push(`Row ${row.rowIndex}: ${row.errors.join(" ")}`);
        skipped += 1;
        continue;
      }

      if (row.year === null || row.year < startYear || row.year > endYear) {
        errors.push(`Row ${row.rowIndex}: year ${row.year ?? ""} is outside ${startYear}-${endYear}.`);
        skipped += 1;
        continue;
      }

      const entry = entryMap.get(row.blockCode);
      if (!entry) {
        errors.push(`Row ${row.rowIndex}: criterion ${row.blockCode} was not found in this workspace.`);
        skipped += 1;
        continue;
      }

      const numericValue = row.numericValue ?? null;
      const textValue = normalizeNullableString(row.textValue);
      const validationError = validateYearDataByCriterion({
        block: entry.block,
        numericValue,
        textValue,
      });
      if (validationError) {
        errors.push(`Row ${row.rowIndex}: ${validationError}`);
        skipped += 1;
        continue;
      }

      const existing = await tx.blockEntryYearValue.findUnique({
        where: {
          entryId_year: {
            entryId: entry.id,
            year: row.year,
          },
        },
      });

      await tx.blockEntryYearValue.upsert({
        where: {
          entryId_year: {
            entryId: entry.id,
            year: row.year,
          },
        },
        create: {
          entryId: entry.id,
          year: row.year,
          actualValue: numericValue,
          textValue,
          remarks: normalizeNullableString(row.remarks),
          dataSource: BlockEntryValueSource.IMPORTED,
          sourceRef: input.fileName,
          updatedByUserId: actorUserId,
        },
        update: {
          actualValue: numericValue,
          textValue,
          remarks: normalizeNullableString(row.remarks),
          dataSource: BlockEntryValueSource.IMPORTED,
          sourceRef: input.fileName,
          updatedByUserId: actorUserId,
        },
      });

      await recordCriterionEntryChange(tx, {
        entryId: entry.id,
        year: row.year,
        fieldChanged: "import",
        oldValue: existing ? "updated" : "created",
        newValue: input.fileName,
        reason: "Bulk import",
        changedByUserId: actorUserId,
      });

      if (entry.status === BlockEntryStatus.BLANK) {
        await tx.blockEntry.update({
          where: { id: entry.id },
          data: {
            status: BlockEntryStatus.IN_PROGRESS,
            lastUpdatedAt: new Date(),
            lastUpdatedByUserId: actorUserId,
          },
        });
      }

      const invalidation = await invalidateSectionReviewForCriterionTx(tx, {
        workspaceId,
        versionId: permissionContext.workspace.versionId,
        blockId: entry.blockId,
        actorUserId,
        triggerMessage: `${entry.block.blockCode} was updated by bulk import.`,
        metadata: {
          blockCode: entry.block.blockCode,
          sourceFile: input.fileName,
          year: row.year,
        } satisfies Prisma.JsonObject,
      });
      if (invalidation?.invalidated) {
        invalidations.push({
          sectionBlockId: invalidation.sectionBlockId,
          sectionCode: invalidation.sectionCode,
        });
      }

      imported += 1;
    }

    if (imported > 0) {
      await ensureWorkspaceInProgress(tx, workspaceId);
      await recomputeAndPersistWorkspaceScores(tx, workspaceId, false);
    }

    return {
      invalidations: dedupeSectionInvalidations(invalidations),
    };
  });

  for (const invalidation of importResult.invalidations) {
    await notifySectionReviewInvalidated({
      tenantId,
      workspaceId,
      sectionBlockId: invalidation.sectionBlockId,
      sectionCode: invalidation.sectionCode,
      triggerMessage: `Bulk import updated ${invalidation.sectionCode} and reopened the section review.`,
      actorUserId,
    });
  }

  return {
    status: "success",
    message: imported > 0 ? "Workspace data imported." : "No workspace data was imported.",
    imported,
    skipped,
    errors,
  } satisfies SuccessResult<{ imported: number; skipped: number; errors: string[] }>;
}

export async function cloneAssessmentWorkspace(
  sourceWorkspaceId: string,
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const parsed = cloneWorkspaceInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid clone input." } satisfies ErrorResult;
  }

  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId: sourceWorkspaceId,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }

  if (!canPerformWorkspaceRole(permissionContext, [WorkspaceCollaboratorRole.COORDINATOR])) {
    return { status: "error", message: "Only workspace coordinators can clone workspaces." } satisfies ErrorResult;
  }

  const periodError = validateWorkspacePeriod(parsed.data.periodStart, parsed.data.periodEnd);
  if (periodError) {
    return { status: "error", message: periodError } satisfies ErrorResult;
  }

  const source = await prisma.assessmentWorkspace.findUnique({
    where: { id: sourceWorkspaceId },
    include: {
      collaborators: true,
      milestones: {
        orderBy: [{ sortOrder: "asc" }, { dueDate: "asc" }],
      },
      entries: {
        include: {
          block: {
            select: {
              blockCode: true,
            },
          },
          responses: {
            orderBy: { year: "asc" },
          },
        },
      },
    },
  });

  if (!source || source.tenantId !== tenantId) {
    return { status: "error", message: "Source workspace not found." } satisfies ErrorResult;
  }

  const cloned = await prisma.$transaction(async (tx) => {
    await tx.accreditationBodyVersion.update({
      where: { id: source.versionId },
      data: { isLocked: true },
    });

    const workspace = await tx.assessmentWorkspace.create({
      data: {
        tenantId,
        versionId: source.versionId,
        profileId: source.profileId,
        title: parsed.data.title,
        description: normalizeNullableString(parsed.data.description),
        periodStart: parsed.data.periodStart,
        periodEnd: parsed.data.periodEnd,
        targetGrade: normalizeNullableString(parsed.data.targetGrade),
        createdByUserId: actorUserId,
      },
    });

    await tx.workspaceCollaborator.createMany({
      data: source.collaborators.map((collaborator) => ({
        workspaceId: workspace.id,
        userId: collaborator.userId,
        role: collaborator.role,
        assignedSections: collaborator.assignedSections,
        addedByUserId: actorUserId,
      })),
      skipDuplicates: true,
    });

    await tx.workspaceMilestone.createMany({
      data: source.milestones.map((milestone) => ({
        workspaceId: workspace.id,
        title: milestone.title,
        description: milestone.description,
        dueDate: milestone.dueDate,
        gatesFreeze: milestone.gatesFreeze,
        sortOrder: milestone.sortOrder,
      })),
    });

    const initialized = await initializeWorkspaceEntriesTx(tx, workspace.id, source.versionId);
    const createdEntries = await tx.blockEntry.findMany({
      where: { workspaceId: workspace.id },
      include: {
        block: {
          select: {
            blockCode: true,
          },
        },
      },
    });
    const createdEntryByCode = new Map(
      createdEntries.map((entry) => [entry.block.blockCode, entry]),
    );
    const { startYear, endYear } = getWorkspaceYearBounds(parsed.data.periodStart, parsed.data.periodEnd);

    for (const sourceEntry of source.entries) {
      const targetEntry = createdEntryByCode.get(sourceEntry.block.blockCode);
      if (!targetEntry) {
        continue;
      }

      const overlappingRows = sourceEntry.responses.filter(
        (row) => row.year >= startYear && row.year <= endYear,
      );
      if (overlappingRows.length === 0) {
        continue;
      }

      await tx.blockEntryYearValue.createMany({
        data: overlappingRows.map((row) => ({
          entryId: targetEntry.id,
          year: row.year,
          actualValue: row.actualValue,
          textValue: row.textValue,
          remarks: row.remarks,
          dataSource: BlockEntryValueSource.CLONED,
          sourceRef: sourceWorkspaceId,
          updatedByUserId: actorUserId,
        })),
      });

      await tx.blockEntry.update({
        where: { id: targetEntry.id },
        data: {
          status: BlockEntryStatus.IN_PROGRESS,
          lastUpdatedAt: new Date(),
          lastUpdatedByUserId: actorUserId,
        },
      });
    }

    await recomputeAndPersistWorkspaceScores(tx, workspace.id, false);

    return {
      workspaceId: workspace.id,
      initialized,
    };
  });

  const workspace = await getAssessmentWorkspace(cloned.workspaceId, tenantId, actorUserId, actorRole);
  if (workspace.status !== "success") {
    return workspace;
  }

  return {
    status: "success",
    message: "Workspace cloned.",
    workspace: workspace.workspace,
    initialized: cloned.initialized,
  } satisfies SuccessResult<{ workspace: unknown; initialized: typeof cloned.initialized }>;
}

async function getWorkspaceSectionBundleTx(
  tx: DbClient,
  workspaceId: string,
  sectionBlockId: string,
) {
  const sectionContext = await ensureWorkspaceSectionCollaborationBackfillTx(tx, workspaceId);
  if (!sectionContext) {
    return null;
  }

  const section = sectionContext.sectionsById.get(sectionBlockId);
  if (!section) {
    return null;
  }

  const [review, assignments] = await Promise.all([
    tx.workspaceSectionReview.findUnique({
      where: {
        workspaceId_sectionBlockId: {
          workspaceId,
          sectionBlockId,
        },
      },
      include: {
        reviewerDecisions: true,
      },
    }),
    tx.workspaceSectionAssignment.findMany({
      where: {
        workspaceId,
        sectionBlockId,
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            officialEmail: true,
          },
        },
        guestParticipant: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  return {
    sectionContext,
    section,
    review,
    assignments,
  };
}

function sectionReviewIsActionable(section: WorkspaceSectionDefinition) {
  return section.leafEntries.length > 0;
}

async function buildSectionHandoffSummaryTx(
  tx: DbClient,
  workspaceId: string,
  sectionBlockId: string,
) {
  const bundle = await getWorkspaceSectionBundleTx(tx, workspaceId, sectionBlockId);
  if (!bundle) {
    return null;
  }

  const entryIds = bundle.section.leafEntries.map((entry) => entry.entryId);
  const [recentChanges, openThreads, evidenceCounts] = await Promise.all([
    tx.blockEntryChange.findMany({
      where: {
        entryId: {
          in: entryIds,
        },
      },
      orderBy: { changedAt: "desc" },
      take: 8,
    }),
    tx.workspaceDiscussionThread.findMany({
      where: {
        workspaceId,
        OR: [
          { sectionBlockId },
          { entryId: { in: entryIds } },
        ],
        isResolved: false,
      },
      include: {
        _count: {
          select: {
            messages: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 8,
    }),
    tx.blockEntry.findMany({
      where: {
        id: {
          in: entryIds,
        },
      },
      include: {
        evidenceLinks: true,
      },
    }),
  ]);

  return {
    entries: bundle.section.leafEntries.map((entry) => ({
      blockCode: entry.blockCode,
      blockTitle: entry.blockTitle,
      status: entry.status,
      evidenceCount:
        evidenceCounts.find((candidate) => candidate.id === entry.entryId)?.evidenceLinks.length ?? 0,
    })),
    recentChanges: recentChanges.map((change) => ({
      fieldChanged: change.fieldChanged,
      year: change.year,
      changedAt: change.changedAt,
      reason: change.reason,
    })),
    openThreads: openThreads.map((thread) => ({
      id: thread.id,
      title: thread.title,
      scope: thread.scope,
      messageCount: thread._count.messages,
      updatedAt: thread.updatedAt,
    })),
    reviewStatus: bundle.review?.status ?? WorkspaceSectionReviewStatus.NOT_STARTED,
  };
}

export async function listAssessmentWorkspaceSections(
  workspaceId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }

  if (!canReadWorkspace(permissionContext)) {
    return { status: "error", message: "You do not have access to this workspace." } satisfies ErrorResult;
  }

  const sectionContext = await ensureWorkspaceSectionCollaborationBackfillTx(prisma, workspaceId);
  if (!sectionContext) {
    return { status: "error", message: "Workspace not found." } satisfies ErrorResult;
  }

  const [reviews, assignments] = await Promise.all([
    prisma.workspaceSectionReview.findMany({
      where: { workspaceId },
      include: {
        reviewerDecisions: true,
      },
    }),
    prisma.workspaceSectionAssignment.findMany({
      where: { workspaceId },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            officialEmail: true,
          },
        },
      },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  const reviewBySectionId = new Map(reviews.map((review) => [review.sectionBlockId, review]));
  const assignmentsBySectionId = new Map<string, typeof assignments>();
  for (const assignment of assignments) {
    const existing = assignmentsBySectionId.get(assignment.sectionBlockId) ?? [];
    existing.push(assignment);
    assignmentsBySectionId.set(assignment.sectionBlockId, existing);
  }

  const now = Date.now();
  const currentAssignments = permissionContext.isWorkspaceAdmin
    ? []
    : await getInternalSectionAssignmentsForUserTx(prisma, workspaceId, actorUserId);

  return {
    status: "success",
    sections: sectionContext.sections.map((section) => {
      const review = reviewBySectionId.get(section.sectionBlockId);
      const sectionAssignments = assignmentsBySectionId.get(section.sectionBlockId) ?? [];
      const approvedLeafCount = section.leafEntries.filter(
        (entry) => entry.status === BlockEntryStatus.APPROVED,
      ).length;
      const overdueAssignments = sectionAssignments.filter(
        (assignment) => assignment.deadline && assignment.deadline.getTime() < now,
      ).length;

      return {
        sectionBlockId: section.sectionBlockId,
        blockCode: section.sectionCode,
        sectionCode: section.sectionCode,
        title: section.title,
        leafEntryCount: section.leafEntries.length,
        approvedLeafCount,
        status: review?.status ?? WorkspaceSectionReviewStatus.NOT_STARTED,
        actionable: sectionReviewIsActionable(section),
        overdueAssignments,
        currentUserRoles: permissionContext.isWorkspaceAdmin
          ? [WorkspaceSectionAssignmentRole.APPROVER]
          : currentAssignments
              .filter((assignment) => assignment.sectionBlockId === section.sectionBlockId)
              .map((assignment) => assignment.role),
        reviewerDecisionSummary: {
          total: review?.reviewerDecisions.length ?? 0,
          confirmed:
            review?.reviewerDecisions.filter(
              (decision) => decision.status === WorkspaceSectionReviewerDecisionStatus.CONFIRMED,
            ).length ?? 0,
        },
        assignments: sectionAssignments.map((assignment) => ({
          id: assignment.id,
          role: assignment.role,
          deadline: assignment.deadline,
          userId: assignment.userId,
          guestParticipantId: assignment.guestParticipantId,
          name: assignment.user
            ? `${assignment.user.firstName} ${assignment.user.lastName}`.trim()
            : null,
          email: assignment.user?.officialEmail ?? null,
        })),
      };
    }),
  } satisfies SuccessResult<{ sections: unknown[] }>;
}

export async function bulkAssignAssessmentWorkspaceSections(
  workspaceId: string,
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }
  if (!canPerformWorkspaceRole(permissionContext, [WorkspaceCollaboratorRole.COORDINATOR])) {
    return { status: "error", message: "Only workspace coordinators can assign sections." } satisfies ErrorResult;
  }

  const parsed = bulkSectionAssignmentInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid section assignment input." } satisfies ErrorResult;
  }

  const sectionContext = await ensureWorkspaceSectionCollaborationBackfillTx(prisma, workspaceId);
  if (!sectionContext) {
    return { status: "error", message: "Workspace not found." } satisfies ErrorResult;
  }

  const targetUserIds = [...new Set(parsed.data.assignments.map((assignment) => assignment.userId))];
  const [memberships, collaborators] = await Promise.all([
    prisma.membership.findMany({
      where: {
        tenantId,
        userId: {
          in: targetUserIds,
        },
        status: {
          in: ["ACTIVE", "INVITED", "PENDING_ACTIVATION", "LOCKED", "SUSPENDED"],
        },
      },
      select: {
        userId: true,
      },
    }),
    prisma.workspaceCollaborator.findMany({
      where: {
        workspaceId,
        userId: {
          in: targetUserIds,
        },
      },
      select: {
        userId: true,
        role: true,
      },
    }),
  ]);
  const memberIds = new Set(memberships.map((membership) => membership.userId));
  const collaboratorByUserId = new Map(collaborators.map((collaborator) => [collaborator.userId, collaborator]));

  for (const assignment of parsed.data.assignments) {
    if (!memberIds.has(assignment.userId)) {
      return {
        status: "error",
        message: "All section assignees must be active tenant members.",
      } satisfies ErrorResult;
    }
    const collaborator = collaboratorByUserId.get(assignment.userId);
    if (!collaborator) {
      return {
        status: "error",
        message: "Section assignees must already be workspace collaborators.",
      } satisfies ErrorResult;
    }
    if (!collaboratorRoleSupportsSectionAssignment(collaborator.role, assignment.role)) {
      return {
        status: "error",
        message: "The collaborator role is not compatible with the requested section assignment.",
      } satisfies ErrorResult;
    }
    const section = sectionContext.sectionsById.get(assignment.sectionBlockId);
    if (!section) {
      return { status: "error", message: "Section assignments must target a root block." } satisfies ErrorResult;
    }
  }

  const saved = await prisma.$transaction(async (tx) => {
    const results: Array<{ sectionCode: string; userId: string }> = [];
    const touchedSections = new Set<string>();
    for (const assignment of parsed.data.assignments) {
      await tx.workspaceSectionAssignment.upsert({
        where: {
          workspaceId_sectionBlockId_userId_role: {
            workspaceId,
            sectionBlockId: assignment.sectionBlockId,
            userId: assignment.userId,
            role: assignment.role,
          },
        },
        create: {
          workspaceId,
          sectionBlockId: assignment.sectionBlockId,
          userId: assignment.userId,
          role: assignment.role,
          deadline: assignment.deadline ?? null,
          assignedByUserId: actorUserId,
        },
        update: {
          deadline: assignment.deadline ?? null,
          assignedByUserId: actorUserId,
        },
      });

      touchedSections.add(assignment.sectionBlockId);
      const section = sectionContext.sectionsById.get(assignment.sectionBlockId)!;
      results.push({
        sectionCode: section.sectionCode,
        userId: assignment.userId,
      });
      await syncCollaboratorAssignedSectionsFromAssignmentsTx(tx, workspaceId, assignment.userId);
    }

    for (const sectionBlockId of touchedSections) {
      const review = await tx.workspaceSectionReview.findUnique({
        where: {
          workspaceId_sectionBlockId: {
            workspaceId,
            sectionBlockId,
          },
        },
        select: {
          id: true,
          status: true,
        },
      });
      if (review) {
        await syncWorkspaceSectionReviewerDecisionsTx(tx, review.id, workspaceId, sectionBlockId);
        if (
          review.status !== WorkspaceSectionReviewStatus.NOT_STARTED &&
          review.status !== WorkspaceSectionReviewStatus.IN_PROGRESS
        ) {
          await tx.workspaceSectionReview.update({
            where: { id: review.id },
            data: {
              status: WorkspaceSectionReviewStatus.IN_PROGRESS,
              approvedAt: null,
              approvedByUserId: null,
              submittedAt: null,
              submittedByUserId: null,
              lastChangedAt: new Date(),
              lastChangedByUserId: actorUserId,
            },
          });
          await tx.workspaceSectionReviewerDecision.updateMany({
            where: { reviewId: review.id },
            data: {
              status: WorkspaceSectionReviewerDecisionStatus.PENDING,
              confirmedAt: null,
            },
          });
          await tx.workspaceSectionReviewEvent.create({
            data: {
              reviewId: review.id,
              fromStatus: review.status,
              toStatus: WorkspaceSectionReviewStatus.IN_PROGRESS,
              actorUserId,
              comment: "Section assignments changed.",
            },
          });
        }
      }
    }

    return { results };
  });

  for (const result of saved.results) {
    await notifySectionAssignmentChanged({
      tenantId,
      workspaceId,
      userId: result.userId,
      sectionCode: result.sectionCode,
      message: `You have been assigned to section ${result.sectionCode}.`,
    });
  }

  return {
    status: "success",
    message: "Section assignments saved.",
    assignmentCount: saved.results.length,
  } satisfies SuccessResult<{ assignmentCount: number }>;
}

export async function reassignAssessmentWorkspaceSection(
  workspaceId: string,
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }
  if (!canPerformWorkspaceRole(permissionContext, [WorkspaceCollaboratorRole.COORDINATOR])) {
    return { status: "error", message: "Only workspace coordinators can reassign sections." } satisfies ErrorResult;
  }

  const parsed = reassignSectionInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid section reassignment input." } satisfies ErrorResult;
  }

  const sectionContext = await ensureWorkspaceSectionCollaborationBackfillTx(prisma, workspaceId);
  if (!sectionContext) {
    return { status: "error", message: "Workspace not found." } satisfies ErrorResult;
  }
  const section = sectionContext.sectionsById.get(parsed.data.sectionBlockId);
  if (!section) {
    return { status: "error", message: "Section assignments must target a root block." } satisfies ErrorResult;
  }

  const targetCollaborator = await prisma.workspaceCollaborator.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId,
        userId: parsed.data.toUserId,
      },
    },
    select: {
      role: true,
    },
  });
  if (!targetCollaborator) {
    return {
      status: "error",
      message: "The target user must already be a workspace collaborator.",
    } satisfies ErrorResult;
  }
  if (!collaboratorRoleSupportsSectionAssignment(targetCollaborator.role, parsed.data.role)) {
    return {
      status: "error",
      message: "The target collaborator role is not compatible with the requested section assignment.",
    } satisfies ErrorResult;
  }

  const reassigned = await prisma.$transaction(async (tx) => {
    const existing = await tx.workspaceSectionAssignment.findFirst({
      where: {
        workspaceId,
        sectionBlockId: parsed.data.sectionBlockId,
        userId: parsed.data.fromUserId,
        role: parsed.data.role,
      },
    });
    if (!existing) {
      return { status: "error" as const, message: "The source section assignment was not found." };
    }

    await tx.workspaceSectionAssignment.upsert({
      where: {
        workspaceId_sectionBlockId_userId_role: {
          workspaceId,
          sectionBlockId: parsed.data.sectionBlockId,
          userId: parsed.data.toUserId,
          role: parsed.data.role,
        },
      },
      create: {
        workspaceId,
        sectionBlockId: parsed.data.sectionBlockId,
        userId: parsed.data.toUserId,
        role: parsed.data.role,
        deadline: parsed.data.deadline ?? existing.deadline,
        assignedByUserId: actorUserId,
      },
      update: {
        deadline: parsed.data.deadline ?? existing.deadline,
        assignedByUserId: actorUserId,
      },
    });

    await tx.workspaceSectionAssignment.delete({
      where: { id: existing.id },
    });

    await syncCollaboratorAssignedSectionsFromAssignmentsTx(tx, workspaceId, parsed.data.fromUserId);
    await syncCollaboratorAssignedSectionsFromAssignmentsTx(tx, workspaceId, parsed.data.toUserId);

    const review = await tx.workspaceSectionReview.findUnique({
      where: {
        workspaceId_sectionBlockId: {
          workspaceId,
          sectionBlockId: parsed.data.sectionBlockId,
        },
      },
      select: {
        id: true,
      },
    });
    if (review) {
      await syncWorkspaceSectionReviewerDecisionsTx(
        tx,
        review.id,
        workspaceId,
        parsed.data.sectionBlockId,
      );
      await tx.workspaceSectionReviewEvent.create({
        data: {
          reviewId: review.id,
          toStatus: WorkspaceSectionReviewStatus.IN_PROGRESS,
          actorUserId,
          comment: `Assignment moved from ${parsed.data.fromUserId} to ${parsed.data.toUserId}.`,
          metadata: {
            fromUserId: parsed.data.fromUserId,
            toUserId: parsed.data.toUserId,
            role: parsed.data.role,
          } satisfies Prisma.JsonObject,
        },
      });
    }

    const handoffSummary = await buildSectionHandoffSummaryTx(
      tx,
      workspaceId,
      parsed.data.sectionBlockId,
    );

    return {
      status: "success" as const,
      handoffSummary,
    };
  });

  if (reassigned.status === "error") {
    return reassigned;
  }

  await notifySectionAssignmentChanged({
    tenantId,
    workspaceId,
    userId: parsed.data.fromUserId,
    sectionCode: section.sectionCode,
    message: `Your assignment for section ${section.sectionCode} has been withdrawn.`,
  });
  await notifySectionAssignmentChanged({
    tenantId,
    workspaceId,
    userId: parsed.data.toUserId,
    sectionCode: section.sectionCode,
    message: `You are now assigned to section ${section.sectionCode}.`,
  });

  return {
    status: "success",
    message: "Section reassigned.",
    handoffSummary: reassigned.handoffSummary,
  } satisfies SuccessResult<{ handoffSummary: unknown }>;
}

async function transitionAssessmentWorkspaceSectionReview(
  workspaceId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
  input: unknown,
  action: "submit" | "changesRequested" | "confirm" | "approve",
) {
  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }
  if (!canReadWorkspace(permissionContext)) {
    return { status: "error", message: "You do not have access to this workspace." } satisfies ErrorResult;
  }

  const parsed = sectionReviewActionSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid section review input." } satisfies ErrorResult;
  }

  const bundle = await getWorkspaceSectionBundleTx(prisma, workspaceId, parsed.data.sectionBlockId);
  if (!bundle) {
    return { status: "error", message: "Section not found." } satisfies ErrorResult;
  }
  if (!sectionReviewIsActionable(bundle.section)) {
    return { status: "error", message: "Empty root sections do not participate in section review." } satisfies ErrorResult;
  }

  const currentAssignments = permissionContext.isWorkspaceAdmin
    ? []
    : await getInternalSectionAssignmentsForUserTx(prisma, workspaceId, actorUserId);

  const comment = normalizeReason(parsed.data.comment);
  const actorCan = (roles: WorkspaceSectionAssignmentRole[]) =>
    canPerformSectionAssignmentAction(
      permissionContext,
      currentAssignments,
      parsed.data.sectionBlockId,
      roles,
    );

  if (action === "submit") {
    if (!actorCan([WorkspaceSectionAssignmentRole.SECTION_LEAD, WorkspaceSectionAssignmentRole.RESPONSIBLE])) {
      return { status: "error", message: "Only section leads or responsibles can submit a section." } satisfies ErrorResult;
    }
    if (!bundle.section.leafEntries.every((entry) => entry.status === BlockEntryStatus.APPROVED)) {
      return { status: "error", message: "All leaf entries in the section must be approved before section submission." } satisfies ErrorResult;
    }
  }

  if (action === "changesRequested") {
    if (!actorCan([WorkspaceSectionAssignmentRole.REVIEWER, WorkspaceSectionAssignmentRole.APPROVER])) {
      return { status: "error", message: "Only section reviewers or approvers can request changes." } satisfies ErrorResult;
    }
    if (!comment) {
      return { status: "error", message: "A comment is required when requesting section changes." } satisfies ErrorResult;
    }
  }

  if (action === "confirm") {
    if (!actorCan([WorkspaceSectionAssignmentRole.REVIEWER])) {
      return { status: "error", message: "Only section reviewers can confirm a section review." } satisfies ErrorResult;
    }
  }

  if (action === "approve") {
    if (!actorCan([WorkspaceSectionAssignmentRole.APPROVER])) {
      return { status: "error", message: "Only section approvers can approve a section." } satisfies ErrorResult;
    }
    const reviewerAssignments = bundle.assignments.filter(
      (assignment) => assignment.role === WorkspaceSectionAssignmentRole.REVIEWER && assignment.userId,
    );
    if (
      reviewerAssignments.length > 0 &&
      reviewerAssignments.some(
        (assignment) =>
          !bundle.review?.reviewerDecisions.some(
            (decision) =>
              decision.reviewerUserId === assignment.userId &&
              decision.status === WorkspaceSectionReviewerDecisionStatus.CONFIRMED,
          ),
      )
    ) {
      return {
        status: "error",
        message: "All assigned reviewers must confirm the section before approval.",
      } satisfies ErrorResult;
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const review = await tx.workspaceSectionReview.findUniqueOrThrow({
      where: {
        workspaceId_sectionBlockId: {
          workspaceId,
          sectionBlockId: parsed.data.sectionBlockId,
        },
      },
      include: {
        reviewerDecisions: true,
      },
    });

    let nextStatus = review.status;
    if (action === "submit") {
      nextStatus = WorkspaceSectionReviewStatus.OWNER_SUBMITTED;
      await tx.workspaceSectionReviewerDecision.updateMany({
        where: { reviewId: review.id },
        data: {
          status: WorkspaceSectionReviewerDecisionStatus.PENDING,
          confirmedAt: null,
        },
      });
      await tx.workspaceSectionReview.update({
        where: { id: review.id },
        data: {
          status: nextStatus,
          submittedAt: new Date(),
          submittedByUserId: actorUserId,
          approvedAt: null,
          approvedByUserId: null,
          lastChangedAt: new Date(),
          lastChangedByUserId: actorUserId,
        },
      });
    }

    if (action === "changesRequested") {
      nextStatus = WorkspaceSectionReviewStatus.CHANGES_REQUESTED;
      await tx.workspaceSectionReviewerDecision.updateMany({
        where: { reviewId: review.id },
        data: {
          status: WorkspaceSectionReviewerDecisionStatus.PENDING,
          confirmedAt: null,
        },
      });
      await tx.workspaceSectionReview.update({
        where: { id: review.id },
        data: {
          status: nextStatus,
          lastChangedAt: new Date(),
          lastChangedByUserId: actorUserId,
        },
      });
    }

    if (action === "confirm") {
      const decision = await tx.workspaceSectionReviewerDecision.findFirst({
        where: {
          reviewId: review.id,
          reviewerUserId: actorUserId,
        },
      });
      if (!decision) {
        return {
          status: "error" as const,
          message: "You are not assigned as a reviewer for this section.",
        };
      }
      await tx.workspaceSectionReviewerDecision.update({
        where: { id: decision.id },
        data: {
          status: WorkspaceSectionReviewerDecisionStatus.CONFIRMED,
          confirmedAt: new Date(),
        },
      });

      const refreshed = await tx.workspaceSectionReviewerDecision.findMany({
        where: { reviewId: review.id },
      });
      const allConfirmed =
        refreshed.length === 0 ||
        refreshed.every(
          (row) => row.status === WorkspaceSectionReviewerDecisionStatus.CONFIRMED,
        );
      nextStatus = allConfirmed
        ? WorkspaceSectionReviewStatus.REVIEW_CONFIRMED
        : WorkspaceSectionReviewStatus.OWNER_SUBMITTED;
      await tx.workspaceSectionReview.update({
        where: { id: review.id },
        data: {
          status: nextStatus,
          lastChangedAt: new Date(),
          lastChangedByUserId: actorUserId,
        },
      });
    }

    if (action === "approve") {
      nextStatus = WorkspaceSectionReviewStatus.APPROVED;
      await tx.workspaceSectionReview.update({
        where: { id: review.id },
        data: {
          status: nextStatus,
          approvedAt: new Date(),
          approvedByUserId: actorUserId,
          lastChangedAt: new Date(),
          lastChangedByUserId: actorUserId,
        },
      });
    }

    await tx.workspaceSectionReviewEvent.create({
      data: {
        reviewId: review.id,
        fromStatus: review.status,
        toStatus: nextStatus,
        actorUserId,
        comment,
      },
    });

    return {
      status: "success" as const,
      nextStatus,
    };
  });

  return result;
}

export async function submitAssessmentWorkspaceSectionReview(
  workspaceId: string,
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  return transitionAssessmentWorkspaceSectionReview(
    workspaceId,
    tenantId,
    actorUserId,
    actorRole,
    input,
    "submit",
  );
}

export async function requestChangesAssessmentWorkspaceSectionReview(
  workspaceId: string,
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  return transitionAssessmentWorkspaceSectionReview(
    workspaceId,
    tenantId,
    actorUserId,
    actorRole,
    input,
    "changesRequested",
  );
}

export async function confirmAssessmentWorkspaceSectionReview(
  workspaceId: string,
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  return transitionAssessmentWorkspaceSectionReview(
    workspaceId,
    tenantId,
    actorUserId,
    actorRole,
    input,
    "confirm",
  );
}

export async function approveAssessmentWorkspaceSectionReview(
  workspaceId: string,
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  return transitionAssessmentWorkspaceSectionReview(
    workspaceId,
    tenantId,
    actorUserId,
    actorRole,
    input,
    "approve",
  );
}

export async function getAssessmentWorkspaceDataGaps(
  workspaceId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }
  if (!canReadWorkspace(permissionContext)) {
    return { status: "error", message: "You do not have access to this workspace." } satisfies ErrorResult;
  }

  const workspace = await prisma.assessmentWorkspace.findUnique({
    where: { id: workspaceId },
    include: {
      entries: {
        include: {
          block: {
            select: {
              blockCode: true,
              title: true,
              dataType: true,
            },
          },
          responses: {
            orderBy: { year: "asc" },
          },
        },
        orderBy: {
          block: {
            blockCode: "asc",
          },
        },
      },
    },
  });
  if (!workspace || workspace.tenantId !== tenantId) {
    return { status: "error", message: "Workspace not found." } satisfies ErrorResult;
  }

  const { startYear, endYear } = getWorkspaceYearBounds(workspace.periodStart, workspace.periodEnd);
  const gaps = workspace.entries.flatMap((entry) => {
    const yearMap = new Map(entry.responses.map((row) => [row.year, row]));
    const missingYears: number[] = [];
    for (let year = startYear; year <= endYear; year += 1) {
      const row = yearMap.get(year);
      const hasValue =
        entry.block.dataType === CriterionDataType.QUANTITATIVE
          ? row?.actualValue !== null && row?.actualValue !== undefined
          : entry.block.dataType === CriterionDataType.QUALITATIVE
            ? !!normalizeNullableString(row?.textValue ?? null)
            : (row?.actualValue !== null && row?.actualValue !== undefined) ||
              !!normalizeNullableString(row?.textValue ?? null);
      if (!hasValue) {
        missingYears.push(year);
      }
    }

    return missingYears.length > 0
        ? [
          {
            entryId: entry.id,
            blockCode: entry.block.blockCode,
            blockTitle: entry.block.title,
            missingYears,
          },
        ]
      : [];
  });

  return {
    status: "success",
    gaps,
  } satisfies SuccessResult<{ gaps: typeof gaps }>;
}

function dedupeSectionInvalidations(
  invalidations: Array<{ sectionBlockId: string; sectionCode: string }>,
) {
  const seen = new Set<string>();
  return invalidations.filter((invalidation) => {
    const key = `${invalidation.sectionBlockId}:${invalidation.sectionCode}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export async function previewAssessmentWorkspaceReuse(
  targetWorkspaceId: string,
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId: targetWorkspaceId,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }
  if (!canReadWorkspace(permissionContext)) {
    return { status: "error", message: "You do not have access to this workspace." } satisfies ErrorResult;
  }

  const parsed = reusePreviewInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid reuse preview input." } satisfies ErrorResult;
  }

  const [target, source] = await Promise.all([
    prisma.assessmentWorkspace.findUnique({
      where: { id: targetWorkspaceId },
      include: {
        entries: {
          include: {
            block: {
              select: {
                blockCode: true,
              },
            },
            responses: true,
          },
        },
      },
    }),
    prisma.assessmentWorkspace.findUnique({
      where: { id: parsed.data.sourceWorkspaceId },
      include: {
        entries: {
          include: {
            block: {
              select: {
                blockCode: true,
              },
            },
            responses: true,
          },
        },
      },
    }),
  ]);

  if (!target || target.tenantId !== tenantId || !source || source.tenantId !== tenantId) {
    return { status: "error", message: "Source or target workspace not found." } satisfies ErrorResult;
  }
  if (target.versionId !== source.versionId) {
    return { status: "error", message: "Reuse is only supported between workspaces using the same accreditation version." } satisfies ErrorResult;
  }

  const sectionContext = await buildWorkspaceSectionDefinitionsTx(prisma, targetWorkspaceId);
  if (!sectionContext) {
    return { status: "error", message: "Target workspace not found." } satisfies ErrorResult;
  }

  const allowedCriterionCodes =
    parsed.data.sectionBlockIds && parsed.data.sectionBlockIds.length > 0
      ? new Set(
          sectionContext.sections
            .filter((section) => parsed.data.sectionBlockIds?.includes(section.sectionBlockId))
            .flatMap((section) => section.leafEntries.map((entry) => entry.blockCode)),
        )
      : null;

  const targetEntryByCode = new Map(target.entries.map((entry) => [entry.block.blockCode, entry]));
  const { startYear, endYear } = getWorkspaceYearBounds(target.periodStart, target.periodEnd);

  const willCopy: Array<{
    blockCode: string;
    years: number[];
    hasExistingData: boolean;
  }> = [];
  const willSkip: Array<{ blockCode: string; reason: string }> = [];
  const conflicts: Array<{ blockCode: string; year: number }> = [];

  for (const sourceEntry of source.entries) {
    const blockCode = sourceEntry.block.blockCode;
    if (allowedCriterionCodes && !allowedCriterionCodes.has(blockCode)) {
      continue;
    }

    const targetEntry = targetEntryByCode.get(blockCode);
    if (!targetEntry) {
      willSkip.push({ blockCode, reason: "Criterion not present in target workspace." });
      continue;
    }

    const overlappingRows = sourceEntry.responses.filter(
      (row) => row.year >= startYear && row.year <= endYear && (row.actualValue !== null || row.textValue !== null),
    );
    if (overlappingRows.length === 0) {
      willSkip.push({ blockCode, reason: "No overlapping data for the target period." });
      continue;
    }

    const targetYearMap = new Map(targetEntry.responses.map((row) => [row.year, row]));
    const hasExistingData = overlappingRows.some((row) => {
      const targetRow = targetYearMap.get(row.year);
      return !!targetRow && (targetRow.actualValue !== null || targetRow.textValue !== null);
    });
    for (const row of overlappingRows) {
      const targetRow = targetYearMap.get(row.year);
      if (
        targetRow &&
        ((targetRow.actualValue ?? null) !== (row.actualValue ?? null) ||
          (normalizeNullableString(targetRow.textValue) ?? null) !==
            (normalizeNullableString(row.textValue) ?? null))
      ) {
        conflicts.push({ blockCode, year: row.year });
      }
    }
    willCopy.push({
      blockCode,
      years: overlappingRows.map((row) => row.year),
      hasExistingData,
    });
  }

  return {
    status: "success",
    preview: {
      willCopy,
      willSkip,
      conflicts,
    },
  } satisfies SuccessResult<{ preview: { willCopy: typeof willCopy; willSkip: typeof willSkip; conflicts: typeof conflicts } }>;
}

export async function applyAssessmentWorkspaceReuse(
  targetWorkspaceId: string,
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId: targetWorkspaceId,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }
  if (!canPerformWorkspaceRole(permissionContext, [WorkspaceCollaboratorRole.COORDINATOR])) {
    return { status: "error", message: "Only workspace coordinators can apply workspace reuse." } satisfies ErrorResult;
  }
  if (isWorkspaceLockedForEntryEdits(permissionContext.workspace.status)) {
    return { status: "error", message: "This workspace is read-only in its current status." } satisfies ErrorResult;
  }

  const parsed = reuseApplyInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid reuse input." } satisfies ErrorResult;
  }

  const preview = await previewAssessmentWorkspaceReuse(
    targetWorkspaceId,
    tenantId,
    parsed.data,
    actorUserId,
    actorRole,
  );
  if (preview.status === "error") {
    return preview;
  }

  const [target, source] = await Promise.all([
    prisma.assessmentWorkspace.findUnique({
      where: { id: targetWorkspaceId },
      include: {
        entries: {
          include: {
            block: {
              select: {
                blockCode: true,
              },
            },
            responses: true,
          },
        },
      },
    }),
    prisma.assessmentWorkspace.findUnique({
      where: { id: parsed.data.sourceWorkspaceId },
      include: {
        entries: {
          include: {
            block: {
              select: {
                blockCode: true,
              },
            },
            responses: true,
          },
        },
      },
    }),
  ]);
  if (!target || !source) {
    return { status: "error", message: "Source or target workspace not found." } satisfies ErrorResult;
  }

  const sectionContext = await buildWorkspaceSectionDefinitionsTx(prisma, targetWorkspaceId);
  if (!sectionContext) {
    return { status: "error", message: "Workspace not found." } satisfies ErrorResult;
  }
  const allowedCriterionCodes =
    parsed.data.sectionBlockIds && parsed.data.sectionBlockIds.length > 0
      ? new Set(
          sectionContext.sections
            .filter((section) => parsed.data.sectionBlockIds?.includes(section.sectionBlockId))
            .flatMap((section) => section.leafEntries.map((entry) => entry.blockCode)),
        )
      : null;

  const { startYear, endYear } = getWorkspaceYearBounds(target.periodStart, target.periodEnd);
  const targetEntryByCode = new Map(target.entries.map((entry) => [entry.block.blockCode, entry]));

  const applied = await prisma.$transaction(async (tx) => {
    let copiedRows = 0;
    const invalidations: Array<{ sectionBlockId: string; sectionCode: string }> = [];
    for (const sourceEntry of source.entries) {
      const blockCode = sourceEntry.block.blockCode;
      if (allowedCriterionCodes && !allowedCriterionCodes.has(blockCode)) {
        continue;
      }
      const targetEntry = targetEntryByCode.get(blockCode);
      if (!targetEntry) {
        continue;
      }

      for (const row of sourceEntry.responses) {
        if (row.year < startYear || row.year > endYear) {
          continue;
        }
        if (row.actualValue === null && !normalizeNullableString(row.textValue)) {
          continue;
        }

        await tx.blockEntryYearValue.upsert({
          where: {
            entryId_year: {
              entryId: targetEntry.id,
              year: row.year,
            },
          },
          create: {
            entryId: targetEntry.id,
            year: row.year,
            actualValue: row.actualValue,
            textValue: normalizeNullableString(row.textValue),
            remarks: row.remarks,
            dataSource: BlockEntryValueSource.CLONED,
            sourceRef: source.id,
            updatedByUserId: actorUserId,
          },
          update: {
            actualValue: row.actualValue,
            textValue: normalizeNullableString(row.textValue),
            remarks: row.remarks,
            dataSource: BlockEntryValueSource.CLONED,
            sourceRef: source.id,
            updatedByUserId: actorUserId,
          },
        });
        copiedRows += 1;
      }

      await tx.blockEntry.update({
        where: { id: targetEntry.id },
        data: {
          status:
            targetEntry.status === BlockEntryStatus.BLANK
              ? BlockEntryStatus.IN_PROGRESS
              : targetEntry.status,
          lastUpdatedAt: new Date(),
          lastUpdatedByUserId: actorUserId,
        },
      });
      await recordCriterionEntryChange(tx, {
        entryId: targetEntry.id,
        fieldChanged: "reuse",
        oldValue: targetEntry.block.blockCode,
        newValue: source.id,
        reason: "Cross-workspace reuse",
        changedByUserId: actorUserId,
        changeMeta: {
          sourceWorkspaceId: source.id,
          sourceWorkspaceTitle: source.title,
        } satisfies Prisma.JsonObject,
      });

      const invalidation = await invalidateSectionReviewForCriterionTx(tx, {
        workspaceId: targetWorkspaceId,
        versionId: permissionContext.workspace.versionId,
        blockId: targetEntry.blockId,
        actorUserId,
        triggerMessage: `${blockCode} was refreshed from workspace ${source.title}.`,
        metadata: {
          sourceWorkspaceId: source.id,
          blockCode,
        } satisfies Prisma.JsonObject,
      });
      if (invalidation?.invalidated) {
        invalidations.push({
          sectionBlockId: invalidation.sectionBlockId,
          sectionCode: invalidation.sectionCode,
        });
      }
    }

    await ensureWorkspaceInProgress(tx, targetWorkspaceId);
    await recomputeAndPersistWorkspaceScores(tx, targetWorkspaceId, false);
    return {
      copiedRows,
      invalidations: dedupeSectionInvalidations(invalidations),
    };
  });

  for (const invalidation of applied.invalidations) {
    await notifySectionReviewInvalidated({
      tenantId,
      workspaceId: targetWorkspaceId,
      sectionBlockId: invalidation.sectionBlockId,
      sectionCode: invalidation.sectionCode,
      triggerMessage: `Workspace reuse updated ${invalidation.sectionCode} and reopened the section review.`,
      actorUserId,
    });
  }

  return {
    status: "success",
    message: "Workspace reuse applied.",
    copiedRows: applied.copiedRows,
    preview: preview.preview,
  } satisfies SuccessResult<{ copiedRows: number; preview: typeof preview.preview }>;
}

export async function getAssessmentWorkspaceActivitySinceLastVisit(
  workspaceId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }
  if (!canReadWorkspace(permissionContext)) {
    return { status: "error", message: "You do not have access to this workspace." } satisfies ErrorResult;
  }

  const since = permissionContext.collaborator?.lastVisitedAt ?? new Date(0);
  const [entryChanges, sectionEvents, unreadThreads] = await Promise.all([
    prisma.blockEntryChange.count({
      where: {
        entry: {
          workspaceId,
        },
        changedAt: {
          gt: since,
        },
      },
    }),
    prisma.workspaceSectionReviewEvent.count({
      where: {
        review: {
          workspaceId,
        },
        createdAt: {
          gt: since,
        },
      },
    }),
    prisma.workspaceDiscussionThread.count({
      where: {
        workspaceId,
        updatedAt: {
          gt: since,
        },
        isResolved: false,
      },
    }),
  ]);

  if (permissionContext.collaborator?.id) {
    await prisma.workspaceCollaborator.update({
      where: { id: permissionContext.collaborator.id },
      data: { lastVisitedAt: new Date() },
    });
  }

  return {
    status: "success",
    activity: {
      since,
      entryChanges,
      sectionEvents,
      unreadThreads,
    },
  } satisfies SuccessResult<{ activity: { since: Date; entryChanges: number; sectionEvents: number; unreadThreads: number } }>;
}

export async function getAssessmentWorkspaceSubmissionManifest(
  workspaceId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }
  if (!canReadWorkspace(permissionContext)) {
    return { status: "error", message: "You do not have access to this workspace." } satisfies ErrorResult;
  }

  const workspace = await prisma.assessmentWorkspace.findUnique({
    where: { id: workspaceId },
    include: {
      entries: {
        include: {
          block: {
            select: {
              blockCode: true,
              title: true,
            },
          },
          evidenceLinks: {
            include: {
              evidence: {
                include: {
                  versions: {
                    where: { isFinal: true },
                    orderBy: { versionNumber: "desc" },
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
      freezeLogs: {
        orderBy: { frozenAt: "desc" },
        take: 1,
      },
    },
  });
  if (!workspace || workspace.tenantId !== tenantId) {
    return { status: "error", message: "Workspace not found." } satisfies ErrorResult;
  }

  const sections = await listAssessmentWorkspaceSections(workspaceId, tenantId, actorUserId, actorRole);
  if (sections.status === "error") {
    return sections;
  }

  return {
    status: "success",
    manifest: {
      workspaceId: workspace.id,
      title: workspace.title,
      status: workspace.status,
      resolvedGrade: workspace.resolvedGrade,
      resolvedOutcome: workspace.resolvedOutcome,
      lastFreezeLog: workspace.freezeLogs[0] ?? null,
      sections: sections.sections,
      entries: workspace.entries.map((entry) => ({
        blockCode: entry.block.blockCode,
        blockTitle: entry.block.title,
        finalScore: entry.finalScore,
        approvedAt: entry.updatedAt,
        evidence: entry.evidenceLinks.map((link) => ({
          evidenceId: link.evidenceId,
          title: link.evidence.title,
          finalVersions: link.evidence.versions,
        })),
      })),
    },
  } satisfies SuccessResult<{ manifest: unknown }>;
}

export async function listAssessmentWorkspaceFreezeLogs(
  workspaceId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }
  if (!canReadWorkspace(permissionContext)) {
    return { status: "error", message: "You do not have access to this workspace." } satisfies ErrorResult;
  }

  const logs = await prisma.workspaceFreezeLog.findMany({
    where: { workspaceId },
    orderBy: { frozenAt: "desc" },
  });

  return {
    status: "success",
    logs,
  } satisfies SuccessResult<{ logs: typeof logs }>;
}

export async function deleteAssessmentWorkspaceEvidenceVersion(
  versionId: string,
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const parsed = deleteEvidenceVersionInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid evidence version deletion input." } satisfies ErrorResult;
  }

  const version = await prisma.evidenceVersion.findUnique({
    where: { id: versionId },
    include: {
      evidence: {
        include: {
          workspace: {
            select: {
              id: true,
              tenantId: true,
              status: true,
            },
          },
          entryLinks: {
            include: {
              entry: {
                select: {
                  blockId: true,
                  block: {
                    select: {
                      blockCode: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!version || version.evidence.workspace.tenantId !== tenantId) {
    return { status: "error", message: "Evidence version not found." } satisfies ErrorResult;
  }
  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId: version.evidence.workspace.id,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }
  if (!canPerformWorkspaceRole(permissionContext, [WorkspaceCollaboratorRole.COORDINATOR])) {
    return { status: "error", message: "Only workspace coordinators can delete evidence versions." } satisfies ErrorResult;
  }
  if (version.isFinal) {
    return { status: "error", message: "Final evidence versions cannot be deleted." } satisfies ErrorResult;
  }
  if (isWorkspaceLockedForEntryEdits(version.evidence.workspace.status)) {
    return { status: "error", message: "This workspace is read-only in its current status." } satisfies ErrorResult;
  }

  const deleted = await prisma.$transaction(async (tx) => {
    await tx.evidenceVersion.delete({
      where: { id: versionId },
    });
    await tx.blockEvidence.update({
      where: { id: version.evidenceId },
      data: {
        latestVersionNumber: Math.max(0, version.evidence.latestVersionNumber - 1),
      },
    });
    const invalidations: Array<{ sectionBlockId: string; sectionCode: string }> = [];
    for (const link of version.evidence.entryLinks) {
      const invalidation = await invalidateSectionReviewForCriterionTx(tx, {
        workspaceId: version.evidence.workspace.id,
        versionId: permissionContext.workspace.versionId,
        blockId: link.entry.blockId,
        actorUserId,
        triggerMessage: `Evidence version ${version.versionNumber} for "${version.evidence.title}" was deleted.`,
        metadata: {
          evidenceId: version.evidenceId,
          evidenceVersionId: version.id,
          evidenceVersionNumber: version.versionNumber,
          reason: parsed.data.reason,
        } satisfies Prisma.JsonObject,
      });
      if (invalidation?.invalidated) {
        invalidations.push({
          sectionBlockId: invalidation.sectionBlockId,
          sectionCode: invalidation.sectionCode,
        });
      }
    }
    return {
      invalidations: dedupeSectionInvalidations(invalidations),
    };
  });

  for (const invalidation of deleted.invalidations) {
    await notifySectionReviewInvalidated({
      tenantId,
      workspaceId: version.evidence.workspace.id,
      sectionBlockId: invalidation.sectionBlockId,
      sectionCode: invalidation.sectionCode,
      triggerMessage: `Evidence history changed and reopened the ${invalidation.sectionCode} section review.`,
      actorUserId,
    });
  }

  return {
    status: "success",
    message: "Evidence version deleted.",
  };
}

async function validateDiscussionScopeTarget(
  workspaceId: string,
  scope: WorkspaceDiscussionScope,
  sectionBlockId: string | null,
  entryId: string | null,
) {
  if (scope === WorkspaceDiscussionScope.WORKSPACE) {
    return { sectionBlockId: null, entryId: null };
  }
  if (scope === WorkspaceDiscussionScope.SECTION) {
    if (!sectionBlockId) {
      return { error: "Section discussions require a sectionBlockId." };
    }
    const bundle = await getWorkspaceSectionBundleTx(prisma, workspaceId, sectionBlockId);
    return bundle ? { sectionBlockId, entryId: null } : { error: "Section not found." };
  }
  if (!entryId) {
    return { error: "Entry discussions require an entryId." };
  }
  const entry = await prisma.blockEntry.findFirst({
    where: {
      id: entryId,
      workspaceId,
    },
    select: { id: true },
  });
  return entry ? { sectionBlockId: null, entryId } : { error: "Entry not found." };
}

async function notifyDiscussionParticipants(input: {
  tenantId: string;
  workspaceId: string;
  threadId: string;
  title: string;
  actorUserId: string;
  mentionedUserIds: string[];
}) {
  const [thread, assignments] = await Promise.all([
    prisma.workspaceDiscussionThread.findUnique({
      where: { id: input.threadId },
      include: {
        messages: {
          select: {
            authorUserId: true,
          },
        },
      },
    }),
    prisma.workspaceSectionAssignment.findMany({
      where: {
        workspaceId: input.workspaceId,
      },
      select: {
        sectionBlockId: true,
        userId: true,
      },
    }),
  ]);
  if (!thread) {
    return;
  }

  const participantIds = new Set<string>();
  for (const message of thread.messages) {
    if (message.authorUserId && message.authorUserId !== input.actorUserId) {
      participantIds.add(message.authorUserId);
    }
  }
  if (thread.sectionBlockId) {
    for (const assignment of assignments) {
      if (
        assignment.sectionBlockId === thread.sectionBlockId &&
        assignment.userId &&
        assignment.userId !== input.actorUserId
      ) {
        participantIds.add(assignment.userId);
      }
    }
  }
  for (const mentionedUserId of input.mentionedUserIds) {
    if (mentionedUserId !== input.actorUserId) {
      participantIds.add(mentionedUserId);
    }
  }
  if (participantIds.size === 0) {
    return;
  }

  await createBulkNotifications(
    input.tenantId,
    [...participantIds],
    "accreditation.discussion.message",
    `accreditation.discussion.message:${input.threadId}:${Date.now()}`,
    `Discussion updated: ${input.title}`,
    "There is new discussion activity that may need your attention.",
    "WorkspaceDiscussionThread",
    input.threadId,
    "/workspace/accreditation",
  );
}

export async function listAssessmentWorkspaceDiscussionThreads(
  workspaceId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }
  if (!canReadWorkspace(permissionContext)) {
    return { status: "error", message: "You do not have access to this workspace." } satisfies ErrorResult;
  }

  const threads = await prisma.workspaceDiscussionThread.findMany({
    where: { workspaceId },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: [{ updatedAt: "desc" }],
  });

  return {
    status: "success",
    threads,
  } satisfies SuccessResult<{ threads: typeof threads }>;
}

export async function createAssessmentWorkspaceDiscussionThread(
  workspaceId: string,
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }
  if (!canReadWorkspace(permissionContext)) {
    return { status: "error", message: "You do not have access to this workspace." } satisfies ErrorResult;
  }

  const parsed = discussionThreadInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid discussion input." } satisfies ErrorResult;
  }
  const target = await validateDiscussionScopeTarget(
    workspaceId,
    parsed.data.scope,
    normalizeNullableString(parsed.data.sectionBlockId),
    normalizeNullableString(parsed.data.entryId),
  );
  if ("error" in target) {
    return {
      status: "error",
      message: target.error ?? "Invalid discussion target.",
    } satisfies ErrorResult;
  }

  const postApproval =
    target.sectionBlockId
      ? (
          await prisma.workspaceSectionReview.findUnique({
            where: {
              workspaceId_sectionBlockId: {
                workspaceId,
                sectionBlockId: target.sectionBlockId,
              },
            },
            select: { status: true },
          })
        )?.status === WorkspaceSectionReviewStatus.APPROVED
      : false;

  const thread = await prisma.workspaceDiscussionThread.create({
    data: {
      workspaceId,
      scope: parsed.data.scope,
      sectionBlockId: target.sectionBlockId,
      entryId: target.entryId,
      title: parsed.data.title,
      createdByUserId: actorUserId,
      messages: {
        create: {
          body: parsed.data.body,
          authorUserId: actorUserId,
          mentionedUserIds: normalizeSections(parsed.data.mentionedUserIds),
          isPostApproval: postApproval,
        },
      },
    },
    include: {
      messages: true,
    },
  });

  await notifyDiscussionParticipants({
    tenantId,
    workspaceId,
    threadId: thread.id,
    title: thread.title,
    actorUserId,
    mentionedUserIds: normalizeSections(parsed.data.mentionedUserIds),
  });

  return {
    status: "success",
    message: "Discussion created.",
    thread,
  } satisfies SuccessResult<{ thread: typeof thread }>;
}

export async function addAssessmentWorkspaceDiscussionMessage(
  threadId: string,
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const parsed = discussionMessageInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid discussion message input." } satisfies ErrorResult;
  }

  const thread = await prisma.workspaceDiscussionThread.findUnique({
    where: { id: threadId },
    include: {
      workspace: {
        select: {
          id: true,
          tenantId: true,
        },
      },
    },
  });
  if (!thread || thread.workspace.tenantId !== tenantId) {
    return { status: "error", message: "Discussion thread not found." } satisfies ErrorResult;
  }

  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId: thread.workspaceId,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }
  if (!canReadWorkspace(permissionContext)) {
    return { status: "error", message: "You do not have access to this workspace." } satisfies ErrorResult;
  }

  const postApproval =
    thread.sectionBlockId
      ? (
          await prisma.workspaceSectionReview.findUnique({
            where: {
              workspaceId_sectionBlockId: {
                workspaceId: thread.workspaceId,
                sectionBlockId: thread.sectionBlockId,
              },
            },
            select: { status: true },
          })
        )?.status === WorkspaceSectionReviewStatus.APPROVED
      : false;

  const message = await prisma.workspaceDiscussionMessage.create({
    data: {
      threadId,
      authorUserId: actorUserId,
      parentMessageId: normalizeNullableString(parsed.data.parentMessageId),
      body: parsed.data.body,
      mentionedUserIds: normalizeSections(parsed.data.mentionedUserIds),
      isPostApproval: postApproval,
    },
  });

  await prisma.workspaceDiscussionThread.update({
    where: { id: threadId },
    data: { updatedAt: new Date() },
  });

  await notifyDiscussionParticipants({
    tenantId,
    workspaceId: thread.workspaceId,
    threadId,
    title: thread.title,
    actorUserId,
    mentionedUserIds: normalizeSections(parsed.data.mentionedUserIds),
  });

  return {
    status: "success",
    message: "Discussion message posted.",
    discussionMessage: message,
  } satisfies SuccessResult<{ discussionMessage: typeof message }>;
}

type ProjectionPrimitiveValue = string | number | boolean;
type ProjectionDimensions = Record<string, ProjectionPrimitiveValue>;

type ProjectionPreviewMatch = {
  targetYear: number;
  targetScopeKey: string;
  sourceYear: number | null;
  sourceScopeKey: string | null;
  materializedNumberValue: number | null;
  materializedTextValue: string | null;
  rowCount: number;
  dimensions: ProjectionDimensions;
};

type ProjectionSourceGroup = {
  sourceYear: number | null;
  sourceScopeKey: string | null;
  values: Array<{
    numberValue: number | null;
    textValue: string | null;
    dimensions: ProjectionDimensions;
  }>;
  rowCount: number;
};

type ProjectionTargetEntryContext = {
  entry: {
    id: string;
    status: BlockEntryStatus;
    workspace: {
      id: string;
      tenantId: string;
      status: AssessmentWorkspaceStatus;
      periodStart: Date;
      periodEnd: Date;
      versionId: string;
      profileId: string;
    };
    block: {
      id: string;
      blockCode: string;
      title: string;
      dataType: CriterionDataType;
      validationRules: Prisma.JsonValue | null;
      isLeaf: boolean;
    };
  };
  permissionContext: WorkspacePermissionContext;
};

type PreparedProjectionPreview = {
  sourceKind: ProjectionSourceKind;
  targetPath: "actualValue" | "textValue";
  storageMode: ProjectionStorageMode;
  sourceSummary: Prisma.JsonObject;
  filters: Prisma.JsonObject | null;
  transform: Prisma.JsonObject;
  sourceRevisionHash: string;
  matches: ProjectionPreviewMatch[];
  conflicts: Array<{
    targetYear: number;
    message: string;
  }>;
  overwriteWarnings: Array<{
    targetYear: number;
    targetPath: string;
    currentValue: string | null;
  }>;
};

function normalizeProjectionDimensions(
  value: Record<string, ProjectionPrimitiveValue> | null | undefined,
): ProjectionDimensions {
  if (!value) {
    return {};
  }

  const normalizedEntries = Object.entries(value)
    .filter(([, item]) => item !== null && item !== undefined)
    .map(([key, item]) => [
      key.trim(),
      typeof item === "string" ? item.trim() : item,
    ] satisfies [string, ProjectionPrimitiveValue])
    .filter(([key, item]) => key.length > 0 && (typeof item !== "string" || item.length > 0))
    .sort(([left], [right]) => left.localeCompare(right));

  return Object.fromEntries(normalizedEntries);
}

function asProjectionDimensions(value: Prisma.JsonValue | null | undefined): ProjectionDimensions {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const output: ProjectionDimensions = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      output[key] = item;
    }
  }
  return normalizeProjectionDimensions(output);
}

function matchesProjectionDimensions(
  candidate: Prisma.JsonValue | null | undefined,
  filter: ProjectionDimensions | undefined,
) {
  if (!filter || Object.keys(filter).length === 0) {
    return true;
  }

  const normalizedCandidate = asProjectionDimensions(candidate);
  return Object.entries(filter).every(([key, value]) => normalizedCandidate[key] === value);
}

function buildProjectionDimensionFingerprint(
  dimensions: Record<string, ProjectionPrimitiveValue> | null | undefined,
) {
  const normalized = normalizeProjectionDimensions(dimensions);
  return Object.keys(normalized).length === 0 ? "__NONE__" : stableStringify(normalized);
}

function serializeProjectionFilter(
  filter: z.infer<typeof projectionFilterSchema> | undefined,
): Prisma.JsonObject | null {
  if (!filter) {
    return null;
  }

  const value: Prisma.JsonObject = {};
  if (filter.years && filter.years.length > 0) {
    value.years = [...new Set(filter.years)].sort((left, right) => left - right);
  }
  const dimensions = normalizeProjectionDimensions(filter.dimensions as ProjectionDimensions | undefined);
  if (Object.keys(dimensions).length > 0) {
    value.dimensions = dimensions as Prisma.JsonObject;
  }
  return Object.keys(value).length > 0 ? value : null;
}

function serializeProjectionTransform(
  transform: z.infer<typeof projectionTransformSchema> | undefined,
): Prisma.JsonObject {
  return {
    mode: transform?.mode ?? "DIRECT",
    ...(transform?.sourceColumnKey ? { sourceColumnKey: transform.sourceColumnKey } : {}),
    ...(transform?.multiplier !== undefined ? { multiplier: transform.multiplier } : {}),
    ...(transform?.divisor !== undefined ? { divisor: transform.divisor } : {}),
    ...(transform?.separator ? { separator: transform.separator } : {}),
  };
}

function getProjectionTransformMode(
  transform: Prisma.JsonValue | null | undefined,
): z.infer<typeof projectionTransformSchema>["mode"] {
  const asObject = asJsonObject(transform);
  const mode = asObject?.mode;
  return mode === "SUM" || mode === "AVG" || mode === "COUNT" || mode === "FIRST" || mode === "TEXT_JOIN"
    ? mode
    : "DIRECT";
}

function getProjectionTransformSourceColumnKey(transform: Prisma.JsonValue | null | undefined) {
  const asObject = asJsonObject(transform);
  return typeof asObject?.sourceColumnKey === "string" && asObject.sourceColumnKey.trim().length > 0
    ? asObject.sourceColumnKey.trim()
    : null;
}

function getProjectionTransformMultiplier(transform: Prisma.JsonValue | null | undefined) {
  const asObject = asJsonObject(transform);
  return typeof asObject?.multiplier === "number" ? asObject.multiplier : null;
}

function getProjectionTransformDivisor(transform: Prisma.JsonValue | null | undefined) {
  const asObject = asJsonObject(transform);
  return typeof asObject?.divisor === "number" ? asObject.divisor : null;
}

function getProjectionTransformSeparator(transform: Prisma.JsonValue | null | undefined) {
  const asObject = asJsonObject(transform);
  return typeof asObject?.separator === "string" && asObject.separator.length > 0
    ? asObject.separator
    : ", ";
}

function stringifyProjectionCurrentValue(value: number | string | null | undefined) {
  return value === null || value === undefined ? null : String(value);
}

function applyProjectionNumericScale(
  value: number,
  transform: Prisma.JsonValue | null | undefined,
) {
  const multiplied = value * (getProjectionTransformMultiplier(transform) ?? 1);
  const divisor = getProjectionTransformDivisor(transform);
  if (divisor === null || divisor === undefined) {
    return multiplied;
  }
  if (divisor === 0) {
    return null;
  }
  return multiplied / divisor;
}

function resolveProjectionGroupValue(input: {
  group: ProjectionSourceGroup;
  transform: Prisma.JsonValue | null | undefined;
  targetPath: "actualValue" | "textValue";
}): ErrorResult | SuccessResult<{ numberValue: number | null; textValue: string | null }> {
  const mode = getProjectionTransformMode(input.transform);
  const separator = getProjectionTransformSeparator(input.transform);

  if (mode === "COUNT") {
    const countValue = applyProjectionNumericScale(input.group.values.length, input.transform);
    if (countValue === null) {
      return { status: "error", message: "Projection divisor cannot be zero." };
    }
    return {
      status: "success",
      numberValue: countValue,
      textValue: input.targetPath === "textValue" ? String(countValue) : null,
    };
  }

  const numberValues = input.group.values
    .map((value) => value.numberValue)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const textValues = input.group.values
    .map((value) => value.textValue)
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  switch (mode) {
    case "SUM": {
      if (numberValues.length === 0) {
        return { status: "error", message: "Projection source does not contain numeric values for SUM." };
      }
      const sum = applyProjectionNumericScale(numberValues.reduce((total, value) => total + value, 0), input.transform);
      if (sum === null) {
        return { status: "error", message: "Projection divisor cannot be zero." };
      }
      return {
        status: "success",
        numberValue: sum,
        textValue: input.targetPath === "textValue" ? String(sum) : null,
      };
    }
    case "AVG": {
      if (numberValues.length === 0) {
        return { status: "error", message: "Projection source does not contain numeric values for AVG." };
      }
      const avg = applyProjectionNumericScale(
        numberValues.reduce((total, value) => total + value, 0) / numberValues.length,
        input.transform,
      );
      if (avg === null) {
        return { status: "error", message: "Projection divisor cannot be zero." };
      }
      return {
        status: "success",
        numberValue: avg,
        textValue: input.targetPath === "textValue" ? String(avg) : null,
      };
    }
    case "TEXT_JOIN": {
      const joined = [...textValues, ...numberValues.map((value) => String(value))].join(separator).trim();
      return {
        status: "success",
        numberValue: null,
        textValue: joined.length > 0 ? joined : null,
      };
    }
    case "FIRST":
    case "DIRECT":
    default: {
      if (mode === "DIRECT" && input.group.values.length !== 1) {
        return {
          status: "error",
          message: "DIRECT projection requires exactly one matching source value. Apply a filter or use an aggregate transform.",
        };
      }

      const first = input.group.values[0] ?? null;
      if (!first) {
        return { status: "error", message: "Projection source did not return any values." };
      }

      if (input.targetPath === "actualValue") {
        if (typeof first.numberValue !== "number" || !Number.isFinite(first.numberValue)) {
          return { status: "error", message: "Projection result is not numeric enough for actualValue." };
        }
        const scaled = applyProjectionNumericScale(first.numberValue, input.transform);
        if (scaled === null) {
          return { status: "error", message: "Projection divisor cannot be zero." };
        }
        return {
          status: "success",
          numberValue: scaled,
          textValue: null,
        };
      }

      const textValue =
        first.textValue ??
        (typeof first.numberValue === "number" && Number.isFinite(first.numberValue)
          ? String(applyProjectionNumericScale(first.numberValue, input.transform) ?? first.numberValue)
          : null);
      return {
        status: "success",
        numberValue: null,
        textValue,
      };
    }
  }
}

async function getProjectionTargetEntryContext(
  entryId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
  requireEditAccess: boolean,
): Promise<ProjectionTargetEntryContext | ErrorResult> {
  const entry = await prisma.blockEntry.findUnique({
    where: { id: entryId },
    include: {
      workspace: {
        select: {
          id: true,
          tenantId: true,
          status: true,
          periodStart: true,
          periodEnd: true,
          versionId: true,
          profileId: true,
        },
      },
      block: {
        select: {
          id: true,
          blockCode: true,
          title: true,
          dataType: true,
          validationRules: true,
          isLeaf: true,
        },
      },
    },
  });

  if (!entry || entry.workspace.tenantId !== tenantId) {
    return { status: "error", message: "Entry not found." };
  }
  if (!entry.block.isLeaf) {
    return { status: "error", message: "Only leaf criteria can use projections." };
  }

  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId: entry.workspace.id,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }
  if (!canReadWorkspace(permissionContext)) {
    return { status: "error", message: "You do not have access to this workspace." };
  }
  if (
    requireEditAccess &&
    !(await canPerformOnBlock(
      prisma,
      permissionContext,
      [WorkspaceCollaboratorRole.RESPONSIBLE, WorkspaceCollaboratorRole.COORDINATOR],
      entry.block.id,
    ))
  ) {
    return { status: "error", message: "You do not have permission to import data into this block." };
  }
  if (requireEditAccess && isWorkspaceLockedForEntryEdits(entry.workspace.status)) {
    return { status: "error", message: "This workspace is read-only in its current status." };
  }

  return {
    entry,
    permissionContext,
  };
}

async function findActiveLiveProjectionTargetPaths(entryId: string, year: number) {
  const targets = await prisma.blockProjectionTarget.findMany({
    where: {
      targetEntryId: entryId,
      targetScopeKey: buildScopeKey(year),
      recipe: {
        isActive: true,
        storageMode: ProjectionStorageMode.LIVE_REFERENCE,
      },
    },
    select: {
      targetPath: true,
    },
  });

  return new Set(targets.map((target) => target.targetPath));
}

async function findProjectionTargetConflicts(input: {
  targetEntryId: string;
  matches: ProjectionPreviewMatch[];
  excludeRecipeId?: string;
}) {
  const scopeKeys = [...new Set(input.matches.map((match) => match.targetScopeKey))];
  if (scopeKeys.length === 0) {
    return [];
  }

  const conflicts = await prisma.blockProjectionTarget.findMany({
    where: {
      targetEntryId: input.targetEntryId,
      targetScopeKey: {
        in: scopeKeys,
      },
      recipe: {
        isActive: true,
        ...(input.excludeRecipeId ? { id: { not: input.excludeRecipeId } } : {}),
      },
    },
    include: {
      recipe: {
        select: {
          id: true,
          storageMode: true,
        },
      },
    },
  });

  return conflicts;
}

async function wouldCreateLiveProjectionCycle(
  sourceEntryId: string,
  targetEntryId: string,
  excludeRecipeId?: string,
) {
  if (sourceEntryId === targetEntryId) {
    return true;
  }

  const recipes = await prisma.blockProjectionRecipe.findMany({
    where: {
      isActive: true,
      storageMode: ProjectionStorageMode.LIVE_REFERENCE,
      sourceEntryId: {
        not: null,
      },
      ...(excludeRecipeId ? { id: { not: excludeRecipeId } } : {}),
    },
    select: {
      sourceEntryId: true,
      targetEntryId: true,
    },
  });

  const adjacency = new Map<string, string[]>();
  for (const recipe of recipes) {
    if (!recipe.sourceEntryId) {
      continue;
    }
    const list = adjacency.get(recipe.sourceEntryId) ?? [];
    list.push(recipe.targetEntryId);
    adjacency.set(recipe.sourceEntryId, list);
  }

  const queue = [targetEntryId];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === sourceEntryId) {
      return true;
    }
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);
    for (const next of adjacency.get(current) ?? []) {
      queue.push(next);
    }
  }

  return false;
}

function buildProjectionSourceSummary(value: Record<string, unknown>): Prisma.JsonObject {
  return value as Prisma.JsonObject;
}

function extractTableCellValue(cell: {
  numberValue: number | null;
  textValue: string | null;
  booleanValue: boolean | null;
  dateValue: Date | null;
  jsonValue: Prisma.JsonValue | null;
}) {
  if (typeof cell.numberValue === "number" && Number.isFinite(cell.numberValue)) {
    return {
      numberValue: cell.numberValue,
      textValue: String(cell.numberValue),
    };
  }
  if (cell.textValue && cell.textValue.trim().length > 0) {
    return {
      numberValue: null,
      textValue: cell.textValue.trim(),
    };
  }
  if (typeof cell.booleanValue === "boolean") {
    return {
      numberValue: null,
      textValue: cell.booleanValue ? "true" : "false",
    };
  }
  if (cell.dateValue) {
    return {
      numberValue: null,
      textValue: cell.dateValue.toISOString(),
    };
  }
  if (cell.jsonValue !== null && cell.jsonValue !== undefined) {
    return {
      numberValue: null,
      textValue: stableStringify(cell.jsonValue),
    };
  }
  return {
    numberValue: null,
    textValue: null,
  };
}

async function collectProjectionSourceGroups(input: {
  tenantId: string;
  parsed: z.infer<typeof entryProjectionInputSchema>;
  targetPath: "actualValue" | "textValue";
  actorUserId: string;
  actorRole: Role | null | undefined;
}): Promise<
  | ErrorResult
  | SuccessResult<{
      sourceKind: ProjectionSourceKind;
      sourceSummary: Prisma.JsonObject;
      groups: ProjectionSourceGroup[];
    }>
> {
  const normalizedFilter = serializeProjectionFilter(input.parsed.filters);
  const yearsFilter = Array.isArray(normalizedFilter?.years)
    ? (normalizedFilter.years as number[])
    : [];
  const dimensionsFilter = normalizedFilter?.dimensions
    ? normalizeProjectionDimensions(normalizedFilter.dimensions as ProjectionDimensions)
    : undefined;

  if (input.parsed.sourceMetricId) {
    const metric = await prisma.sourceMetricDefinition.findFirst({
      where: {
        id: input.parsed.sourceMetricId,
        tenantId: input.tenantId,
        isActive: true,
      },
      include: {
        observations: {
          orderBy: [{ observedYear: "asc" }, { createdAt: "asc" }],
        },
      },
    });
    if (!metric) {
      return { status: "error", message: "Source metric not found." };
    }

    const groupsByScope = new Map<string, ProjectionSourceGroup>();
    for (const observation of metric.observations) {
      if (yearsFilter.length > 0 && !yearsFilter.includes(observation.observedYear ?? Number.NaN)) {
        continue;
      }
      if (!matchesProjectionDimensions(observation.dimensions, dimensionsFilter)) {
        continue;
      }

      const key = observation.scopeKey;
      const group = groupsByScope.get(key) ?? {
        sourceYear: observation.observedYear ?? null,
        sourceScopeKey: observation.scopeKey,
        values: [],
        rowCount: 0,
      };
      group.values.push({
        numberValue: observation.numberValue ?? null,
        textValue: normalizeNullableString(observation.textValue),
        dimensions: asProjectionDimensions(observation.dimensions),
      });
      group.rowCount += 1;
      groupsByScope.set(key, group);
    }

    const groups = [...groupsByScope.values()].sort(
      (left, right) => (left.sourceYear ?? 0) - (right.sourceYear ?? 0),
    );
    if (groups.length === 0) {
      return { status: "error", message: "No source metric observations matched the selected filters." };
    }

    return {
      status: "success",
      sourceKind: ProjectionSourceKind.SOURCE_METRIC,
      sourceSummary: buildProjectionSourceSummary({
        metricId: metric.id,
        code: metric.code,
        name: metric.name,
        valueType: metric.valueType,
        unitOfMeasure: metric.unitOfMeasure,
      }),
      groups,
    };
  }

  if (!input.parsed.sourceWorkspaceId || !input.parsed.sourceEntryId) {
    return { status: "error", message: "Select a source workspace/entry or a source metric." };
  }

  const sourceEntry = await prisma.blockEntry.findUnique({
    where: { id: input.parsed.sourceEntryId },
    include: {
      workspace: {
        select: {
          id: true,
          tenantId: true,
          title: true,
          status: true,
          versionId: true,
          periodStart: true,
          periodEnd: true,
        },
      },
      block: {
        select: {
          id: true,
          blockCode: true,
          title: true,
        },
      },
      responses: {
        orderBy: { year: "asc" },
      },
      tableInstances: {
        orderBy: [{ year: "asc" }, { createdAt: "asc" }],
        include: {
          rows: {
            orderBy: { rowIndex: "asc" },
            include: {
              cells: true,
            },
          },
        },
      },
    },
  });

  if (
    !sourceEntry ||
    sourceEntry.workspace.tenantId !== input.tenantId ||
    sourceEntry.workspace.id !== input.parsed.sourceWorkspaceId
  ) {
    return { status: "error", message: "Source entry not found." };
  }

  const sourcePermissionContext = await getWorkspacePermissionContext({
    tenantId: input.tenantId,
    workspaceId: sourceEntry.workspace.id,
    actorUserId: input.actorUserId,
    actorRole: input.actorRole,
  });
  if ("status" in sourcePermissionContext) {
    return sourcePermissionContext;
  }
  if (!canReadWorkspace(sourcePermissionContext)) {
    return { status: "error", message: "You do not have access to the selected source workspace." };
  }

  if (input.parsed.sourceTableFieldKey) {
    const groups: ProjectionSourceGroup[] = [];
    const instances = sourceEntry.tableInstances.filter((instance) => {
      if (instance.fieldKey !== input.parsed.sourceTableFieldKey) {
        return false;
      }
      if (yearsFilter.length > 0) {
        return yearsFilter.includes(instance.year ?? Number.NaN);
      }
      return true;
    });

    if (instances.length === 0) {
      return { status: "error", message: "No source table data matched the selected field and filters." };
    }

    const sourceColumnKey = getProjectionTransformSourceColumnKey(serializeProjectionTransform(input.parsed.transform));
    const mode = getProjectionTransformMode(serializeProjectionTransform(input.parsed.transform));
    if (mode !== "COUNT" && !sourceColumnKey) {
      return {
        status: "error",
        message: "Table projections require transform.sourceColumnKey for non-count transforms.",
      };
    }

    for (const instance of instances) {
      const matchingRows = instance.rows.filter((row) => matchesProjectionDimensions(row.dimensions, dimensionsFilter));
      if (matchingRows.length === 0) {
        continue;
      }

      const values =
        mode === "COUNT"
          ? matchingRows.map((row) => ({
              numberValue: 1,
              textValue: row.rowKey ?? null,
              dimensions: asProjectionDimensions(row.dimensions),
            }))
          : matchingRows
              .map((row) => {
                const cell = row.cells.find((item) => item.columnKey === sourceColumnKey);
                if (!cell) {
                  return null;
                }
                const extracted = extractTableCellValue(cell);
                return {
                  numberValue: extracted.numberValue,
                  textValue: extracted.textValue,
                  dimensions: asProjectionDimensions(row.dimensions),
                };
              })
              .filter((value): value is ProjectionSourceGroup["values"][number] => value !== null);

      if (values.length === 0) {
        continue;
      }

      groups.push({
        sourceYear: instance.year ?? null,
        sourceScopeKey: instance.scopeKey,
        values,
        rowCount: matchingRows.length,
      });
    }

    if (groups.length === 0) {
      return { status: "error", message: "No source table rows matched the selected filters." };
    }

    return {
      status: "success",
      sourceKind: ProjectionSourceKind.ENTRY_TABLE,
      sourceSummary: buildProjectionSourceSummary({
        workspaceId: sourceEntry.workspace.id,
        workspaceTitle: sourceEntry.workspace.title,
        blockCode: sourceEntry.block.blockCode,
        blockTitle: sourceEntry.block.title,
        tableFieldKey: input.parsed.sourceTableFieldKey,
      }),
      groups,
    };
  }

  if (dimensionsFilter && Object.keys(dimensionsFilter).length > 0) {
    return {
      status: "error",
      message: "Dimension filters are only supported for source metrics and relational table sources.",
    };
  }

  const sourcePath = input.parsed.sourcePath ?? input.targetPath;
  const responsesGroups = sourceEntry.responses
    .filter((row) => (yearsFilter.length > 0 ? yearsFilter.includes(row.year) : true))
    .map<ProjectionSourceGroup>((row) => ({
      sourceYear: row.year,
      sourceScopeKey: buildScopeKey(row.year),
      values: [
        {
          numberValue: sourcePath === "actualValue" ? row.actualValue ?? null : null,
          textValue: sourcePath === "textValue" ? normalizeNullableString(row.textValue) : null,
          dimensions: {},
        },
      ],
      rowCount: 1,
    }));

  if (responsesGroups.length === 0) {
    return { status: "error", message: "No source criterion values matched the selected filters." };
  }

  return {
    status: "success",
    sourceKind: ProjectionSourceKind.WORKSPACE_ENTRY,
    sourceSummary: buildProjectionSourceSummary({
      workspaceId: sourceEntry.workspace.id,
      workspaceTitle: sourceEntry.workspace.title,
      blockCode: sourceEntry.block.blockCode,
      blockTitle: sourceEntry.block.title,
      sourcePath,
    }),
    groups: responsesGroups,
  };
}

async function prepareCriterionEntryProjectionPreview(input: {
  entryId: string;
  tenantId: string;
  parsed: z.infer<typeof entryProjectionInputSchema>;
  actorUserId: string;
  actorRole: Role | null | undefined;
  existingRecipeId?: string;
  requireEditAccess: boolean;
}): Promise<ErrorResult | SuccessResult<{ targetContext: ProjectionTargetEntryContext; preview: PreparedProjectionPreview }>> {
  const targetContext = await getProjectionTargetEntryContext(
    input.entryId,
    input.tenantId,
    input.actorUserId,
    input.actorRole,
    input.requireEditAccess,
  );
  if ("status" in targetContext) {
    return targetContext;
  }

  const sourceGroupsResult = await collectProjectionSourceGroups({
    tenantId: input.tenantId,
    parsed: input.parsed,
    targetPath: input.parsed.targetPath,
    actorUserId: input.actorUserId,
    actorRole: input.actorRole,
  });
  if (sourceGroupsResult.status === "error") {
    return sourceGroupsResult;
  }

  if (
    input.parsed.storageMode === ProjectionStorageMode.LIVE_REFERENCE &&
    sourceGroupsResult.sourceKind !== ProjectionSourceKind.SOURCE_METRIC &&
    input.parsed.sourceEntryId &&
    (await wouldCreateLiveProjectionCycle(input.parsed.sourceEntryId, input.entryId, input.existingRecipeId))
  ) {
    return { status: "error", message: "This live projection would create a dependency cycle." };
  }

  const transform = serializeProjectionTransform(input.parsed.transform);
  const matches: ProjectionPreviewMatch[] = [];
  const { startYear, endYear } = getWorkspaceYearBounds(
    targetContext.entry.workspace.periodStart,
    targetContext.entry.workspace.periodEnd,
  );

  if (input.parsed.targetYear !== undefined && sourceGroupsResult.groups.length !== 1) {
    return {
      status: "error",
      message: "A specific target year can only be used when the projection resolves to one source group.",
    };
  }

  for (const group of sourceGroupsResult.groups) {
    const resolved = resolveProjectionGroupValue({
      group,
      transform,
      targetPath: input.parsed.targetPath,
    });
    if (resolved.status === "error") {
      return resolved;
    }

    const targetYear = input.parsed.targetYear ?? group.sourceYear;
    if (targetYear === null || targetYear === undefined) {
      return {
        status: "error",
        message: "A target year is required when projecting from source data without a year dimension.",
      };
    }
    if (targetYear < startYear || targetYear > endYear) {
      return {
        status: "error",
        message: `Target year ${targetYear} is outside the workspace period (${startYear}-${endYear}).`,
      };
    }

    matches.push({
      targetYear,
      targetScopeKey: buildScopeKey(targetYear),
      sourceYear: group.sourceYear,
      sourceScopeKey: group.sourceScopeKey,
      materializedNumberValue: input.parsed.targetPath === "actualValue" ? resolved.numberValue : null,
      materializedTextValue: input.parsed.targetPath === "textValue" ? resolved.textValue : null,
      rowCount: group.rowCount,
      dimensions:
        group.values.length === 1
          ? group.values[0]?.dimensions ?? {}
          : normalizeProjectionDimensions(input.parsed.filters?.dimensions as ProjectionDimensions | undefined),
    });
  }

  if (matches.length === 0) {
    return { status: "error", message: "No projection results were produced for the selected source." };
  }

  const existingYearData = await prisma.blockEntryYearValue.findMany({
    where: {
      entryId: input.entryId,
      year: {
        in: matches.map((match) => match.targetYear),
      },
    },
  });
  const existingByYear = new Map(existingYearData.map((row) => [row.year, row]));

  const overwriteWarningCandidates = matches
    .map((match) => {
      const existing = existingByYear.get(match.targetYear);
      const currentValue =
        input.parsed.targetPath === "actualValue"
          ? stringifyProjectionCurrentValue(existing?.actualValue ?? null)
          : stringifyProjectionCurrentValue(existing?.textValue ?? null);
      const projectedValue =
        input.parsed.targetPath === "actualValue"
          ? stringifyProjectionCurrentValue(match.materializedNumberValue)
          : stringifyProjectionCurrentValue(match.materializedTextValue);
      if (currentValue === null || currentValue === projectedValue) {
        return null;
      }
      return {
        targetYear: match.targetYear,
        targetPath: input.parsed.targetPath,
        currentValue,
      };
    })
    .filter((value) => value !== null);
  const overwriteWarnings: PreparedProjectionPreview["overwriteWarnings"] = overwriteWarningCandidates;

  const conflicts = (
    await findProjectionTargetConflicts({
      targetEntryId: input.entryId,
      matches,
      excludeRecipeId: input.existingRecipeId,
    })
  ).map((conflict) => ({
    targetYear: conflict.targetYear ?? Number.parseInt(conflict.targetScopeKey.replace("YEAR:", ""), 10),
    message:
      conflict.recipe.storageMode === ProjectionStorageMode.LIVE_REFERENCE
        ? "Target year is already managed by another live projection."
        : "Target year is already managed by another projection.",
  }));

  const sourceRevisionHash = hashProjectionPayload({
    sourceKind: sourceGroupsResult.sourceKind,
    sourceSummary: sourceGroupsResult.sourceSummary,
    transform,
    matches: matches.map((match) => ({
      sourceYear: match.sourceYear,
      sourceScopeKey: match.sourceScopeKey,
      materializedNumberValue: match.materializedNumberValue,
      materializedTextValue: match.materializedTextValue,
      rowCount: match.rowCount,
      dimensions: match.dimensions,
    })),
  });

  return {
    status: "success",
    targetContext,
    preview: {
      sourceKind: sourceGroupsResult.sourceKind,
      targetPath: input.parsed.targetPath,
      storageMode: input.parsed.storageMode,
      sourceSummary: sourceGroupsResult.sourceSummary,
      filters: serializeProjectionFilter(input.parsed.filters),
      transform,
      sourceRevisionHash,
      matches,
      conflicts,
      overwriteWarnings,
    },
  };
}

async function upsertProjectedYearDataTx(input: {
  tx: DbClient;
  recipeId: string;
  targetEntry: ProjectionTargetEntryContext["entry"];
  targetPath: "actualValue" | "textValue";
  match: ProjectionPreviewMatch;
  actorUserId: string;
  reason: string;
}) {
  const existing = await input.tx.blockEntryYearValue.findUnique({
    where: {
      entryId_year: {
        entryId: input.targetEntry.id,
        year: input.match.targetYear,
      },
    },
  });

  const nextActualValue =
    input.targetPath === "actualValue"
      ? input.match.materializedNumberValue
      : existing?.actualValue ?? null;
  const nextTextValue =
    input.targetPath === "textValue"
      ? normalizeNullableString(input.match.materializedTextValue)
      : existing?.textValue ?? null;

  const validationError = validateYearDataByCriterion({
    block: input.targetEntry.block,
    numericValue: nextActualValue,
    textValue: nextTextValue,
  });
  if (validationError) {
    return { status: "error", message: validationError } satisfies ErrorResult;
  }

  const numericChanged = (existing?.actualValue ?? null) !== nextActualValue;
  const textChanged = (existing?.textValue ?? null) !== nextTextValue;
  const hasMeaningfulChange =
    !existing ||
    numericChanged ||
    textChanged ||
    existing.dataSource !== BlockEntryValueSource.PROJECTED ||
    existing.sourceRef !== input.recipeId;

  const saved = existing
    ? await input.tx.blockEntryYearValue.update({
        where: { id: existing.id },
        data: {
          actualValue: nextActualValue,
          textValue: nextTextValue,
          dataSource: BlockEntryValueSource.PROJECTED,
          sourceRef: input.recipeId,
          updatedByUserId: input.actorUserId,
        },
      })
    : await input.tx.blockEntryYearValue.create({
        data: {
          entryId: input.targetEntry.id,
          year: input.match.targetYear,
          actualValue: nextActualValue,
          textValue: nextTextValue,
          dataSource: BlockEntryValueSource.PROJECTED,
          sourceRef: input.recipeId,
          updatedByUserId: input.actorUserId,
        },
      });

  if (numericChanged) {
    await recordCriterionEntryChange(input.tx, {
      entryId: input.targetEntry.id,
      year: input.match.targetYear,
      fieldChanged: "actualValue",
      oldValue: stringifyChangeValue(existing?.actualValue ?? null),
      newValue: stringifyChangeValue(nextActualValue),
      reason: input.reason,
      changedByUserId: input.actorUserId,
    });
  }
  if (textChanged) {
    const textLog = buildTextChangeLog(existing?.textValue, nextTextValue);
    await recordCriterionEntryChange(input.tx, {
      entryId: input.targetEntry.id,
      year: input.match.targetYear,
      fieldChanged: "textValue",
      oldValue: textLog.oldValue,
      newValue: textLog.newValue,
      changeMeta: textLog.changeMeta,
      reason: input.reason,
      changedByUserId: input.actorUserId,
    });
  }

  if (input.targetEntry.status === BlockEntryStatus.BLANK) {
    await input.tx.blockEntry.update({
      where: { id: input.targetEntry.id },
      data: {
        status: BlockEntryStatus.IN_PROGRESS,
        lastUpdatedAt: new Date(),
        lastUpdatedByUserId: input.actorUserId,
      },
    });
    await recordCriterionEntryChange(input.tx, {
      entryId: input.targetEntry.id,
      fieldChanged: "status",
      oldValue: BlockEntryStatus.BLANK,
      newValue: BlockEntryStatus.IN_PROGRESS,
      reason: input.reason,
      changedByUserId: input.actorUserId,
    });
  } else if (hasMeaningfulChange) {
    await input.tx.blockEntry.update({
      where: { id: input.targetEntry.id },
      data: {
        lastUpdatedAt: new Date(),
        lastUpdatedByUserId: input.actorUserId,
      },
    });
  }

  await input.tx.blockProjectionTarget.upsert({
    where: {
      recipeId_targetEntryId_targetScopeKey_targetPath: {
        recipeId: input.recipeId,
        targetEntryId: input.targetEntry.id,
        targetScopeKey: input.match.targetScopeKey,
        targetPath: input.targetPath,
      },
    },
    update: {
      targetYear: input.match.targetYear,
      sourceYear: input.match.sourceYear,
      sourceScopeKey: input.match.sourceScopeKey,
      sourceRevisionHash: input.match.sourceScopeKey
        ? hashProjectionPayload({
            sourceScopeKey: input.match.sourceScopeKey,
            sourceYear: input.match.sourceYear,
            materializedNumberValue: input.match.materializedNumberValue,
            materializedTextValue: input.match.materializedTextValue,
          })
        : null,
      materializedNumberValue: input.match.materializedNumberValue,
      materializedTextValue: normalizeNullableString(input.match.materializedTextValue),
      importedByUserId: input.actorUserId,
      importedAt: new Date(),
    },
    create: {
      recipeId: input.recipeId,
      targetEntryId: input.targetEntry.id,
      targetYear: input.match.targetYear,
      targetScopeKey: input.match.targetScopeKey,
      targetPath: input.targetPath,
      sourceYear: input.match.sourceYear,
      sourceScopeKey: input.match.sourceScopeKey,
      sourceRevisionHash: input.match.sourceScopeKey
        ? hashProjectionPayload({
            sourceScopeKey: input.match.sourceScopeKey,
            sourceYear: input.match.sourceYear,
            materializedNumberValue: input.match.materializedNumberValue,
            materializedTextValue: input.match.materializedTextValue,
          })
        : null,
      materializedNumberValue: input.match.materializedNumberValue,
      materializedTextValue: normalizeNullableString(input.match.materializedTextValue),
      importedByUserId: input.actorUserId,
    },
  });

  return {
    status: "success",
    responses: saved,
    changed: hasMeaningfulChange,
  } satisfies SuccessResult<{ responses: typeof saved; changed: boolean }>;
}

async function clearProjectedYearDataTargetTx(input: {
  tx: DbClient;
  targetEntry: ProjectionTargetEntryContext["entry"];
  targetPath: "actualValue" | "textValue";
  targetYear: number;
  actorUserId: string;
  reason: string;
}) {
  const existing = await input.tx.blockEntryYearValue.findUnique({
    where: {
      entryId_year: {
        entryId: input.targetEntry.id,
        year: input.targetYear,
      },
    },
  });
  if (!existing) {
    return { status: "success", changed: false } satisfies SuccessResult<{ changed: boolean }>;
  }

  const nextActualValue = input.targetPath === "actualValue" ? null : existing.actualValue ?? null;
  const nextTextValue = input.targetPath === "textValue" ? null : existing.textValue ?? null;
  const numericChanged = (existing.actualValue ?? null) !== nextActualValue;
  const textChanged = (existing.textValue ?? null) !== nextTextValue;

  if (!numericChanged && !textChanged && existing.sourceRef === null && existing.dataSource === BlockEntryValueSource.MANUAL) {
    return { status: "success", changed: false } satisfies SuccessResult<{ changed: boolean }>;
  }

  if (nextActualValue === null && nextTextValue === null && !existing.remarks) {
    await input.tx.blockEntryYearValue.delete({
      where: { id: existing.id },
    });
  } else {
    await input.tx.blockEntryYearValue.update({
      where: { id: existing.id },
      data: {
        actualValue: nextActualValue,
        textValue: nextTextValue,
        dataSource: BlockEntryValueSource.MANUAL,
        sourceRef: null,
        updatedByUserId: input.actorUserId,
      },
    });
  }

  if (numericChanged) {
    await recordCriterionEntryChange(input.tx, {
      entryId: input.targetEntry.id,
      year: input.targetYear,
      fieldChanged: "actualValue",
      oldValue: stringifyChangeValue(existing.actualValue ?? null),
      newValue: stringifyChangeValue(nextActualValue),
      reason: input.reason,
      changedByUserId: input.actorUserId,
    });
  }
  if (textChanged) {
    const textLog = buildTextChangeLog(existing.textValue, nextTextValue);
    await recordCriterionEntryChange(input.tx, {
      entryId: input.targetEntry.id,
      year: input.targetYear,
      fieldChanged: "textValue",
      oldValue: textLog.oldValue,
      newValue: textLog.newValue,
      changeMeta: textLog.changeMeta,
      reason: input.reason,
      changedByUserId: input.actorUserId,
    });
  }

  await input.tx.blockEntry.update({
    where: { id: input.targetEntry.id },
    data: {
      lastUpdatedAt: new Date(),
      lastUpdatedByUserId: input.actorUserId,
    },
  });

  return { status: "success", changed: true } satisfies SuccessResult<{ changed: boolean }>;
}

async function persistProjectionRecipeRunTx(input: {
  tx: DbClient;
  recipeId: string;
  runType: ProjectionRunType;
  status: ProjectionRunStatus;
  previewSummary?: Prisma.JsonValue | null;
  appliedCount?: number;
  errorMessage?: string | null;
  sourceRevisionHash?: string | null;
  createdByUserId: string;
}) {
  return input.tx.blockProjectionRun.create({
    data: {
      recipeId: input.recipeId,
      runType: input.runType,
      status: input.status,
      previewSummary: input.previewSummary ?? undefined,
      appliedCount: input.appliedCount ?? 0,
      errorMessage: input.errorMessage ?? null,
      sourceRevisionHash: input.sourceRevisionHash ?? null,
      createdByUserId: input.createdByUserId,
    },
  });
}

async function applyProjectionRecipeTx(input: {
  tx: DbClient;
  recipeId: string;
  targetContext: ProjectionTargetEntryContext;
  preview: PreparedProjectionPreview;
  actorUserId: string;
  runType: ProjectionRunType;
}): Promise<ErrorResult | SuccessResult<{ appliedCount: number; removedCount: number; changed: boolean }>> {
  const existingTargets = await input.tx.blockProjectionTarget.findMany({
    where: {
      recipeId: input.recipeId,
    },
  });
  const nextKeys = new Set(input.preview.matches.map((match) => `${match.targetScopeKey}:${input.preview.targetPath}`));
  let appliedCount = 0;
  let removedCount = 0;
  let changed = false;

  for (const match of input.preview.matches) {
    const saved = await upsertProjectedYearDataTx({
      tx: input.tx,
      recipeId: input.recipeId,
      targetEntry: input.targetContext.entry,
      targetPath: input.preview.targetPath,
      match,
      actorUserId: input.actorUserId,
      reason:
        input.runType === ProjectionRunType.APPLY
          ? "Projection import"
          : "Projection refresh",
    });
    if (saved.status === "error") {
      return saved;
    }
    appliedCount += 1;
    changed = changed || saved.changed;
  }

  for (const existingTarget of existingTargets) {
    const key = `${existingTarget.targetScopeKey}:${existingTarget.targetPath}`;
    if (nextKeys.has(key)) {
      continue;
    }

    const cleared = await clearProjectedYearDataTargetTx({
      tx: input.tx,
      targetEntry: input.targetContext.entry,
      targetPath: existingTarget.targetPath as "actualValue" | "textValue",
      targetYear: existingTarget.targetYear ?? Number.parseInt(existingTarget.targetScopeKey.replace("YEAR:", ""), 10),
      actorUserId: input.actorUserId,
      reason: "Projection refresh removed source data",
    });
    changed = changed || cleared.changed;
    removedCount += 1;
    await input.tx.blockProjectionTarget.delete({
      where: { id: existingTarget.id },
    });
  }

  if (changed) {
    await ensureWorkspaceInProgress(input.tx, input.targetContext.entry.workspace.id);
    await recomputeAndPersistWorkspaceScores(input.tx, input.targetContext.entry.workspace.id, false);
    await invalidateSectionReviewForCriterionTx(input.tx, {
      workspaceId: input.targetContext.entry.workspace.id,
      versionId: input.targetContext.permissionContext.workspace.versionId,
      blockId: input.targetContext.entry.block.id,
      actorUserId: input.actorUserId,
      triggerMessage:
        input.runType === ProjectionRunType.APPLY
          ? `${input.targetContext.entry.block.blockCode} was updated from a projection.`
          : `${input.targetContext.entry.block.blockCode} was refreshed from a live projection.`,
      metadata: {
        targetEntryId: input.targetContext.entry.id,
        recipeId: input.recipeId,
        appliedCount,
        removedCount,
      } satisfies Prisma.JsonObject,
    });
  }

  await input.tx.blockProjectionRecipe.update({
    where: { id: input.recipeId },
    data: {
      lastSourceRevisionHash: input.preview.sourceRevisionHash,
      updatedByUserId: input.actorUserId,
      updatedAt: new Date(),
    },
  });

  await persistProjectionRecipeRunTx({
    tx: input.tx,
    recipeId: input.recipeId,
    runType: input.runType,
    status: ProjectionRunStatus.SUCCESS,
    previewSummary: {
      matches: input.preview.matches.map((match) => ({
        targetYear: match.targetYear,
        sourceYear: match.sourceYear,
        rowCount: match.rowCount,
      })),
    } satisfies Prisma.JsonObject,
    appliedCount,
    sourceRevisionHash: input.preview.sourceRevisionHash,
    createdByUserId: input.actorUserId,
  });

  return {
    status: "success",
    appliedCount,
    removedCount,
    changed,
  } satisfies SuccessResult<{ appliedCount: number; removedCount: number; changed: boolean }>;
}

export async function listTenantSourceMetrics(
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const serviceError = await ensureAccreditationServiceEnabled(tenantId);
  if (serviceError) {
    return { status: "error", message: serviceError } satisfies ErrorResult;
  }

  const allowed = await hasWorkspaceAdminAccess(tenantId, actorUserId, actorRole);
  if (!allowed) {
    return { status: "error", message: "You do not have permission to view source metrics." } satisfies ErrorResult;
  }

  const metrics = await prisma.sourceMetricDefinition.findMany({
    where: {
      tenantId,
      isActive: true,
    },
    include: {
      _count: {
        select: {
          observations: true,
          projectionRecipes: true,
        },
      },
    },
    orderBy: [{ name: "asc" }],
  });

  return {
    status: "success",
    sourceMetrics: metrics,
  } satisfies SuccessResult<{ sourceMetrics: typeof metrics }>;
}

export async function createTenantSourceMetric(
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const parsed = sourceMetricInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid source metric." } satisfies ErrorResult;
  }

  const serviceError = await ensureAccreditationServiceEnabled(tenantId);
  if (serviceError) {
    return { status: "error", message: serviceError } satisfies ErrorResult;
  }

  const allowed = await hasWorkspaceAdminAccess(tenantId, actorUserId, actorRole);
  if (!allowed) {
    return { status: "error", message: "You do not have permission to manage source metrics." } satisfies ErrorResult;
  }

  const metric = await prisma.sourceMetricDefinition.create({
    data: {
      tenantId,
      code: parsed.data.code,
      name: parsed.data.name,
      description: normalizeNullableString(parsed.data.description),
      valueType: parsed.data.valueType,
      unitOfMeasure: normalizeNullableString(parsed.data.unitOfMeasure),
      allowedDimensions:
        parsed.data.allowedDimensions && Object.keys(parsed.data.allowedDimensions).length > 0
          ? (parsed.data.allowedDimensions as Prisma.InputJsonObject)
          : undefined,
      createdByUserId: actorUserId,
    },
  });

  return {
    status: "success",
    message: "Source metric created.",
    sourceMetric: metric,
  } satisfies SuccessResult<{ sourceMetric: typeof metric }>;
}

export async function upsertTenantSourceMetricObservations(
  metricId: string,
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const parsed = sourceMetricObservationInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid source metric observations." } satisfies ErrorResult;
  }

  const serviceError = await ensureAccreditationServiceEnabled(tenantId);
  if (serviceError) {
    return { status: "error", message: serviceError } satisfies ErrorResult;
  }

  const allowed = await hasWorkspaceAdminAccess(tenantId, actorUserId, actorRole);
  if (!allowed) {
    return { status: "error", message: "You do not have permission to manage source metrics." } satisfies ErrorResult;
  }

  const metric = await prisma.sourceMetricDefinition.findFirst({
    where: {
      id: metricId,
      tenantId,
      isActive: true,
    },
  });
  if (!metric) {
    return { status: "error", message: "Source metric not found." } satisfies ErrorResult;
  }

  const observations = await prisma.$transaction(async (tx) => {
    const saved: Awaited<ReturnType<typeof tx.sourceMetricObservation.upsert>>[] = [];
    for (const observation of parsed.data.observations) {
      const dimensions = normalizeProjectionDimensions(observation.dimensions as ProjectionDimensions);
      const scopeKey = buildScopeKey(observation.observedYear ?? null);
      const dimensionFingerprint = buildProjectionDimensionFingerprint(dimensions);
      const textValue = normalizeNullableString(observation.textValue);
      const revisionHash = hashProjectionPayload({
        observedYear: observation.observedYear ?? null,
        dimensions,
        numberValue: observation.numberValue ?? null,
        textValue,
        jsonValue: observation.jsonValue ?? null,
      });

      if (
        metric.valueType === SourceMetricValueType.NUMBER &&
        (typeof observation.numberValue !== "number" || !Number.isFinite(observation.numberValue))
      ) {
        return { status: "error" as const, message: "Numeric source metrics require numberValue." };
      }
      if (metric.valueType === SourceMetricValueType.TEXT && !textValue) {
        return { status: "error" as const, message: "Text source metrics require textValue." };
      }

      const savedObservation = await tx.sourceMetricObservation.upsert({
        where: {
          metricId_scopeKey_dimensionFingerprint: {
            metricId,
            scopeKey,
            dimensionFingerprint,
          },
        },
        update: {
          observedYear: observation.observedYear ?? null,
          dimensions: Object.keys(dimensions).length > 0 ? (dimensions as Prisma.InputJsonObject) : Prisma.DbNull,
          numberValue: observation.numberValue ?? null,
          textValue,
          jsonValue: observation.jsonValue !== undefined ? (observation.jsonValue as Prisma.InputJsonValue) : Prisma.DbNull,
          sourceType: observation.sourceType?.trim() || "MANUAL",
          sourceRef: normalizeNullableString(observation.sourceRef),
          sourceRevisionHash: revisionHash,
          recordedByUserId: actorUserId,
          recordedAt: new Date(),
        },
        create: {
          metricId,
          observedYear: observation.observedYear ?? null,
          scopeKey,
          dimensions: Object.keys(dimensions).length > 0 ? (dimensions as Prisma.InputJsonObject) : Prisma.DbNull,
          dimensionFingerprint,
          numberValue: observation.numberValue ?? null,
          textValue,
          jsonValue: observation.jsonValue !== undefined ? (observation.jsonValue as Prisma.InputJsonValue) : Prisma.DbNull,
          sourceType: observation.sourceType?.trim() || "MANUAL",
          sourceRef: normalizeNullableString(observation.sourceRef),
          sourceRevisionHash: revisionHash,
          recordedByUserId: actorUserId,
          recordedAt: new Date(),
        },
      });
      saved.push(savedObservation);
    }

    return { status: "success" as const, observations: saved };
  });

  if (observations.status === "error") {
    return observations;
  }

  return {
    status: "success",
    message: "Source metric observations saved.",
    observations: observations.observations,
  } satisfies SuccessResult<{ observations: typeof observations.observations }>;
}

export async function listBlockEntryProjectionSources(
  entryId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const targetContext = await getProjectionTargetEntryContext(
    entryId,
    tenantId,
    actorUserId,
    actorRole,
    false,
  );
  if ("status" in targetContext) {
    return targetContext;
  }

  const [sourceMetrics, sourceEntries, activeRecipes] = await Promise.all([
    prisma.sourceMetricDefinition.findMany({
      where: {
        tenantId,
        isActive: true,
      },
      include: {
        _count: {
          select: {
            observations: true,
          },
        },
      },
      orderBy: [{ name: "asc" }],
    }),
    prisma.blockEntry.findMany({
      where: {
        workspace: {
          tenantId,
        },
        id: {
          not: entryId,
        },
        OR: [
          {
            responses: {
              some: {},
            },
          },
          {
            tableInstances: {
              some: {},
            },
          },
        ],
      },
      include: {
        workspace: {
          select: {
            id: true,
            title: true,
            status: true,
          },
        },
        block: {
          select: {
            blockCode: true,
            title: true,
          },
        },
        responses: {
          select: {
            year: true,
          },
          orderBy: { year: "asc" },
        },
        tableInstances: {
          select: {
            fieldKey: true,
            year: true,
            rowCount: true,
          },
          orderBy: [{ fieldKey: "asc" }, { year: "asc" }],
        },
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 100,
    }),
    prisma.blockProjectionRecipe.findMany({
      where: {
        tenantId,
        targetEntryId: entryId,
        isActive: true,
      },
      include: {
        sourceMetric: {
          select: {
            code: true,
            name: true,
          },
        },
        sourceEntry: {
          include: {
            block: {
              select: {
                blockCode: true,
                title: true,
              },
            },
            workspace: {
              select: {
                title: true,
              },
            },
          },
        },
      },
      orderBy: [{ createdAt: "desc" }],
    }),
  ]);

  return {
    status: "success",
    sources: {
      sourceMetrics,
      sourceEntries: sourceEntries.map((entry) => ({
        entryId: entry.id,
        workspaceId: entry.workspace.id,
        workspaceTitle: entry.workspace.title,
        workspaceStatus: entry.workspace.status,
        blockCode: entry.block.blockCode,
        blockTitle: entry.block.title,
        availableYears: [...new Set(entry.responses.map((row) => row.year))],
        tableFields: entry.tableInstances.map((instance) => ({
          fieldKey: instance.fieldKey,
          year: instance.year,
          rowCount: instance.rowCount,
        })),
      })),
      activeProjections: activeRecipes.map((recipe) => ({
        recipeId: recipe.id,
        sourceKind: recipe.sourceKind,
        storageMode: recipe.storageMode,
        targetPath: recipe.targetPath,
        sourceMetric: recipe.sourceMetric,
        sourceEntry:
          recipe.sourceEntry
            ? {
                workspaceTitle: recipe.sourceEntry.workspace.title,
                blockCode: recipe.sourceEntry.block.blockCode,
                blockTitle: recipe.sourceEntry.block.title,
              }
            : null,
      })),
    },
  } satisfies SuccessResult<{
    sources: {
      sourceMetrics: typeof sourceMetrics;
      sourceEntries: Array<{
        entryId: string;
        workspaceId: string;
        workspaceTitle: string;
        workspaceStatus: AssessmentWorkspaceStatus;
        blockCode: string;
        blockTitle: string;
        availableYears: number[];
        tableFields: Array<{
          fieldKey: string;
          year: number | null;
          rowCount: number;
        }>;
      }>;
      activeProjections: Array<{
        recipeId: string;
        sourceKind: ProjectionSourceKind;
        storageMode: ProjectionStorageMode;
        targetPath: string;
        sourceMetric: {
          code: string;
          name: string;
        } | null;
        sourceEntry: {
          workspaceTitle: string;
          blockCode: string;
          blockTitle: string;
        } | null;
      }>;
    };
  }>;
}

export async function previewBlockEntryProjection(
  entryId: string,
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const parsed = entryProjectionInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid projection input." } satisfies ErrorResult;
  }

  const prepared = await prepareCriterionEntryProjectionPreview({
    entryId,
    tenantId,
    parsed: parsed.data,
    actorUserId,
    actorRole,
    requireEditAccess: false,
  });
  if (prepared.status === "error") {
    return prepared;
  }

  return {
    status: "success",
    preview: prepared.preview,
  } satisfies SuccessResult<{ preview: PreparedProjectionPreview }>;
}

export async function applyBlockEntryProjection(
  entryId: string,
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const parsed = entryProjectionInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid projection input." } satisfies ErrorResult;
  }

  const prepared = await prepareCriterionEntryProjectionPreview({
    entryId,
    tenantId,
    parsed: parsed.data,
    actorUserId,
    actorRole,
    requireEditAccess: true,
  });
  if (prepared.status === "error") {
    return prepared;
  }
  if (prepared.preview.conflicts.length > 0) {
    return {
      status: "error",
      message: prepared.preview.conflicts[0]?.message ?? "Projection conflicts with an existing active projection.",
    } satisfies ErrorResult;
  }

  const recipe = await prisma.$transaction(async (tx) => {
    const createdRecipe = await tx.blockProjectionRecipe.create({
      data: {
        tenantId,
        targetWorkspaceId: prepared.targetContext.entry.workspace.id,
        targetEntryId: entryId,
        sourceKind: prepared.preview.sourceKind,
        sourceWorkspaceId: parsed.data.sourceWorkspaceId ?? null,
        sourceEntryId: parsed.data.sourceEntryId ?? null,
        sourceMetricId: parsed.data.sourceMetricId ?? null,
        sourceTableFieldKey: normalizeNullableString(parsed.data.sourceTableFieldKey),
        sourcePath: normalizeNullableString(parsed.data.sourcePath),
        filters: prepared.preview.filters ?? Prisma.DbNull,
        transform: prepared.preview.transform,
        storageMode: parsed.data.storageMode,
        targetPath: parsed.data.targetPath,
        lastSourceRevisionHash: prepared.preview.sourceRevisionHash,
        createdByUserId: actorUserId,
      },
    });

    const applied = await applyProjectionRecipeTx({
      tx,
      recipeId: createdRecipe.id,
      targetContext: prepared.targetContext,
      preview: prepared.preview,
      actorUserId,
      runType: ProjectionRunType.APPLY,
    });
    if (applied.status === "error") {
      throw new Error(applied.message);
    }

    return {
      recipe: createdRecipe,
      applied,
    };
  }).catch((error: Error) => ({ error }));

  if ("error" in recipe) {
    return { status: "error", message: recipe.error.message } satisfies ErrorResult;
  }

  return {
    status: "success",
    message: "Projection applied.",
    recipe: recipe.recipe,
    appliedCount: recipe.applied.appliedCount,
    removedCount: recipe.applied.removedCount,
    preview: prepared.preview,
  } satisfies SuccessResult<{
    recipe: typeof recipe.recipe;
    appliedCount: number;
    removedCount: number;
    preview: PreparedProjectionPreview;
  }>;
}

export async function refreshBlockEntryProjection(
  recipeId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const recipe = await prisma.blockProjectionRecipe.findFirst({
    where: {
      id: recipeId,
      tenantId,
      isActive: true,
    },
  });
  if (!recipe) {
    return { status: "error", message: "Projection recipe not found." } satisfies ErrorResult;
  }

  const prepared = await prepareCriterionEntryProjectionPreview({
    entryId: recipe.targetEntryId,
    tenantId,
    parsed: {
      sourceWorkspaceId: recipe.sourceWorkspaceId ?? undefined,
      sourceEntryId: recipe.sourceEntryId ?? undefined,
      sourceMetricId: recipe.sourceMetricId ?? undefined,
      sourceTableFieldKey: recipe.sourceTableFieldKey ?? undefined,
      sourcePath:
        recipe.sourcePath === "actualValue" || recipe.sourcePath === "textValue"
          ? (recipe.sourcePath as "actualValue" | "textValue")
          : undefined,
      filters: (asJsonObject(recipe.filters) as z.infer<typeof projectionFilterSchema> | null) ?? undefined,
      transform: (asJsonObject(recipe.transform) as z.infer<typeof projectionTransformSchema> | null) ?? undefined,
      targetPath: recipe.targetPath as "actualValue" | "textValue",
      storageMode: recipe.storageMode,
    },
    actorUserId,
    actorRole,
    existingRecipeId: recipe.id,
    requireEditAccess: true,
  });
  if (prepared.status === "error") {
    await prisma.$transaction(async (tx) => {
      await persistProjectionRecipeRunTx({
        tx,
        recipeId: recipe.id,
        runType: ProjectionRunType.REFRESH,
        status: ProjectionRunStatus.ERROR,
        errorMessage: prepared.message,
        createdByUserId: actorUserId,
      });
    });
    return prepared;
  }
  if (prepared.preview.conflicts.length > 0) {
    return {
      status: "error",
      message: prepared.preview.conflicts[0]?.message ?? "Projection conflicts with an existing active projection.",
    } satisfies ErrorResult;
  }

  const refreshed = await prisma.$transaction(async (tx) => {
    const applied = await applyProjectionRecipeTx({
      tx,
      recipeId: recipe.id,
      targetContext: prepared.targetContext,
      preview: prepared.preview,
      actorUserId,
      runType: ProjectionRunType.REFRESH,
    });
    if (applied.status === "error") {
      throw new Error(applied.message);
    }
    return applied;
  }).catch((error: Error) => ({ error }));

  if ("error" in refreshed) {
    return { status: "error", message: refreshed.error.message } satisfies ErrorResult;
  }

  return {
    status: "success",
    message: "Projection refreshed.",
    appliedCount: refreshed.appliedCount,
    removedCount: refreshed.removedCount,
    preview: prepared.preview,
  } satisfies SuccessResult<{
    appliedCount: number;
    removedCount: number;
    preview: PreparedProjectionPreview;
  }>;
}

export async function detachBlockEntryProjection(
  recipeId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role | null | undefined,
) {
  const recipe = await prisma.blockProjectionRecipe.findFirst({
    where: {
      id: recipeId,
      tenantId,
      isActive: true,
    },
    include: {
      targetEntry: {
        include: {
          workspace: {
            select: {
              id: true,
              tenantId: true,
              status: true,
              periodStart: true,
              periodEnd: true,
              versionId: true,
              profileId: true,
            },
          },
          block: {
            select: {
              id: true,
              blockCode: true,
              title: true,
              dataType: true,
              validationRules: true,
              isLeaf: true,
            },
          },
        },
      },
      targets: true,
    },
  });
  if (!recipe || recipe.targetEntry.workspace.tenantId !== tenantId) {
    return { status: "error", message: "Projection recipe not found." } satisfies ErrorResult;
  }

  const permissionContext = await getWorkspacePermissionContext({
    tenantId,
    workspaceId: recipe.targetEntry.workspace.id,
    actorUserId,
    actorRole,
  });
  if ("status" in permissionContext) {
    return permissionContext;
  }
  if (
    !(await canPerformOnBlock(
      prisma,
      permissionContext,
      [WorkspaceCollaboratorRole.RESPONSIBLE, WorkspaceCollaboratorRole.COORDINATOR],
      recipe.targetEntry.block.id,
    ))
  ) {
    return { status: "error", message: "You do not have permission to detach this projection." } satisfies ErrorResult;
  }
  if (isWorkspaceLockedForEntryEdits(recipe.targetEntry.workspace.status)) {
    return { status: "error", message: "This workspace is read-only in its current status." } satisfies ErrorResult;
  }

  const detached = await prisma.$transaction(async (tx) => {
    const touchedYears = new Set<number>();
    for (const target of recipe.targets) {
      if (target.targetYear !== null) {
        touchedYears.add(target.targetYear);
      }

      const responses = target.targetYear === null
        ? null
        : await tx.blockEntryYearValue.findUnique({
            where: {
              entryId_year: {
                entryId: recipe.targetEntryId,
                year: target.targetYear,
              },
            },
          });
      if (responses && responses.sourceRef === recipe.id) {
        await tx.blockEntryYearValue.update({
          where: { id: responses.id },
          data: {
            dataSource: BlockEntryValueSource.MANUAL,
            sourceRef: null,
            updatedByUserId: actorUserId,
          },
        });
      }
    }

    await tx.blockProjectionRecipe.update({
      where: { id: recipe.id },
      data: {
        isActive: false,
        updatedByUserId: actorUserId,
      },
    });

    await persistProjectionRecipeRunTx({
      tx,
      recipeId: recipe.id,
      runType: ProjectionRunType.DETACH,
      status: ProjectionRunStatus.SUCCESS,
      appliedCount: recipe.targets.length,
      createdByUserId: actorUserId,
    });

    await tx.blockEntry.update({
      where: { id: recipe.targetEntryId },
      data: {
        lastUpdatedAt: new Date(),
        lastUpdatedByUserId: actorUserId,
      },
    });

    await ensureWorkspaceInProgress(tx, recipe.targetEntry.workspace.id);
    await recomputeAndPersistWorkspaceScores(tx, recipe.targetEntry.workspace.id, false);

    return {
      detachedCount: recipe.targets.length,
      touchedYears: [...touchedYears].sort((left, right) => left - right),
    };
  });

  return {
    status: "success",
    message: "Projection detached. Imported values are now editable.",
    detachedCount: detached.detachedCount,
    touchedYears: detached.touchedYears,
  } satisfies SuccessResult<{ detachedCount: number; touchedYears: number[] }>;
}
