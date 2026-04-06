import {
  AccreditationScope,
  AccreditationTemplateLifecycleStatus,
  CriterionBlockType,
  CriterionBlockVisibility,
  CriterionDataType,
  CriterionYearAggregation,
  Prisma,
  Role,
} from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hasTenantCapability } from "@/lib/tenant-permissions/service";
import { hasTenantServiceEnabled } from "@/lib/tenant-services/service";
import { blockAssistantConfigSchema } from "./copilot-config";

const MAX_ACCREDITATION_BLOCK_TITLE_LENGTH = 600;
const MAX_BLOCK_DEPTH = 2;

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

type BlockRow = {
  id: string;
  parentId: string | null;
  blockCode: string;
  lineageKey: string | null;
  blockType: CriterionBlockType;
  visibility: CriterionBlockVisibility;
  contributesToTotal: boolean;
  isSectionRoot: boolean;
  title: string;
  description: string | null;
  dataType: CriterionDataType;
  yearAggregation: CriterionYearAggregation;
  yearAggregationConfig: Prisma.JsonValue | null;
  maxScore: number | null;
  sortOrder: number;
  depth: number;
  unitOfMeasure: string | null;
  inputSchema: Prisma.JsonValue | null;
  outputSchema: Prisma.JsonValue | null;
  calculationRule: Prisma.JsonValue | null;
  scoringRule: Prisma.JsonValue | null;
  validationRules: Prisma.JsonValue | null;
  evidenceSchema: Prisma.JsonValue | null;
  expectedEvidence: Prisma.JsonValue | null;
  assistantConfig: Prisma.JsonValue | null;
  dependencyRules: Prisma.JsonValue | null;
  sourceLinks: Prisma.JsonValue | null;
  isLeaf: boolean;
  isActive: boolean;
  children: BlockRow[];
};

type BlockTopologyNode = {
  id: string;
  parentId: string | null;
  blockType: CriterionBlockType;
};

const blockInputSchema = z.object({
  parentId: z.string().trim().min(1).nullable().optional(),
  blockCode: z.string().trim().min(1).max(80),
  blockType: z.nativeEnum(CriterionBlockType).default(CriterionBlockType.METRIC),
  title: z.string().trim().min(2).max(MAX_ACCREDITATION_BLOCK_TITLE_LENGTH),
  description: z.string().trim().max(4000).nullable().optional(),
  dataType: z.nativeEnum(CriterionDataType).default(CriterionDataType.QUANTITATIVE),
  yearAggregation: z
    .nativeEnum(CriterionYearAggregation)
    .default(CriterionYearAggregation.AVERAGE),
  yearAggregationConfig: z.unknown().optional(),
  maxScore: z.number().nonnegative().nullable().optional(),
  sortOrder: z.number().int().min(0).default(0),
  unitOfMeasure: z.string().trim().max(80).nullable().optional(),
  inputSchema: z.unknown().optional(),
  outputSchema: z.unknown().optional(),
  calculationRule: z.unknown().optional(),
  scoringRule: z.unknown().optional(),
  validationRules: z.unknown().optional(),
  evidenceSchema: z.unknown().optional(),
  assistantConfig: z.unknown().optional(),
  dependencyRules: z.unknown().optional(),
  sourceLinks: z.unknown().optional(),
  isActive: z.boolean().optional(),
});

const blockPatchSchema = z.object({
  parentId: z.string().trim().min(1).nullable().optional(),
  blockCode: z.string().trim().min(1).max(80).optional(),
  blockType: z.nativeEnum(CriterionBlockType).optional(),
  title: z.string().trim().min(2).max(MAX_ACCREDITATION_BLOCK_TITLE_LENGTH).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  dataType: z.nativeEnum(CriterionDataType).optional(),
  yearAggregation: z.nativeEnum(CriterionYearAggregation).optional(),
  yearAggregationConfig: z.unknown().optional(),
  maxScore: z.number().nonnegative().nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
  unitOfMeasure: z.string().trim().max(80).nullable().optional(),
  inputSchema: z.unknown().optional(),
  outputSchema: z.unknown().optional(),
  calculationRule: z.unknown().optional(),
  scoringRule: z.unknown().optional(),
  validationRules: z.unknown().optional(),
  evidenceSchema: z.unknown().optional(),
  assistantConfig: z.unknown().optional(),
  dependencyRules: z.unknown().optional(),
  sourceLinks: z.unknown().optional(),
  isActive: z.boolean().optional(),
});

function normalizeNullableString(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function blockTypeSupportsChildren(blockType: CriterionBlockType) {
  return blockType === CriterionBlockType.GROUP || blockType === CriterionBlockType.COMPOSITE;
}

function blockTypeIsLeaf(blockType: CriterionBlockType) {
  return blockType === CriterionBlockType.METRIC || blockType === CriterionBlockType.QUALITATIVE;
}

function buildBlockTree(rows: Omit<BlockRow, "children">[]) {
  const map = new Map<string, BlockRow>();
  const roots: BlockRow[] = [];

  for (const row of rows) {
    map.set(row.id, { ...row, children: [] });
  }

  for (const row of map.values()) {
    if (!row.parentId) {
      roots.push(row);
      continue;
    }

    const parent = map.get(row.parentId);
    if (parent) {
      parent.children.push(row);
    } else {
      roots.push(row);
    }
  }

  const sortRecursive = (nodes: BlockRow[]) => {
    nodes.sort((a, b) => a.sortOrder - b.sortOrder || a.blockCode.localeCompare(b.blockCode));
    for (const node of nodes) {
      sortRecursive(node.children);
    }
  };

  sortRecursive(roots);
  return roots;
}

function buildBlockTopology(nodes: BlockTopologyNode[]) {
  const byId = new Map<string, BlockTopologyNode>();
  const childrenByParent = new Map<string, string[]>();

  for (const node of nodes) {
    byId.set(node.id, node);
    if (!node.parentId) {
      continue;
    }
    const children = childrenByParent.get(node.parentId) ?? [];
    children.push(node.id);
    childrenByParent.set(node.parentId, children);
  }

  return { byId, childrenByParent };
}

function resolveBlockActualDepth(
  blockId: string,
  topology: ReturnType<typeof buildBlockTopology>,
  cache = new Map<string, number>(),
  trail = new Set<string>(),
): number | null {
  const cached = cache.get(blockId);
  if (cached !== undefined) {
    return cached;
  }

  if (trail.has(blockId)) {
    return null;
  }

  const node = topology.byId.get(blockId);
  if (!node || !node.parentId) {
    cache.set(blockId, 0);
    return 0;
  }

  const parent = topology.byId.get(node.parentId);
  if (!parent) {
    cache.set(blockId, 0);
    return 0;
  }

  const nextTrail = new Set(trail);
  nextTrail.add(blockId);
  const parentDepth = resolveBlockActualDepth(parent.id, topology, cache, nextTrail);
  if (parentDepth === null) {
    return null;
  }

  const depth = parentDepth + 1;
  cache.set(blockId, depth);
  return depth;
}

function collectBlockRelativeDepths(
  rootId: string,
  topology: ReturnType<typeof buildBlockTopology>,
) {
  const relativeDepths = new Map<string, number>([[rootId, 0]]);
  const queue = [rootId];

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId) {
      continue;
    }

    const baseDepth = relativeDepths.get(nodeId) ?? 0;
    for (const childId of topology.childrenByParent.get(nodeId) ?? []) {
      if (relativeDepths.has(childId)) {
        return { error: "The block tree is inconsistent. Please fix the draft hierarchy first." };
      }
      relativeDepths.set(childId, baseDepth + 1);
      queue.push(childId);
    }
  }

  const maxRelativeDepth = Math.max(...relativeDepths.values());
  return { relativeDepths, maxRelativeDepth };
}

function parseJsonFieldInput(
  fieldName: string,
  value: unknown,
): { ok: true; value?: Prisma.InputJsonValue } | { ok: false; message: string } {
  if (value === undefined) {
    return { ok: true };
  }

  if (value === null) {
    return { ok: true, value: Prisma.JsonNull as unknown as Prisma.InputJsonValue };
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return { ok: true, value: Prisma.JsonNull as unknown as Prisma.InputJsonValue };
    }

    try {
      return { ok: true, value: JSON.parse(trimmed) as Prisma.InputJsonValue };
    } catch {
      return { ok: false, message: `${fieldName} must be valid JSON.` };
    }
  }

  return { ok: true, value: value as Prisma.InputJsonValue };
}

function serializeJsonFields(values: z.infer<typeof blockInputSchema> | z.infer<typeof blockPatchSchema>) {
  const jsonFields = [
    "yearAggregationConfig",
    "inputSchema",
    "outputSchema",
    "calculationRule",
    "scoringRule",
    "validationRules",
    "evidenceSchema",
    "assistantConfig",
    "dependencyRules",
    "sourceLinks",
  ] as const;

  const result: Record<string, Prisma.InputJsonValue | undefined> = {};

  for (const field of jsonFields) {
    const parsed = parseJsonFieldInput(field, values[field]);
    if (!parsed.ok) {
      return parsed;
    }
    result[field] = parsed.value;
  }

  return { ok: true as const, values: result };
}

async function ensureTenantAccreditationManagement(
  tenantId: string,
  actorUserId: string,
  actorRole: Role,
) {
  if (!(await hasTenantServiceEnabled(tenantId, "ACCREDITATION"))) {
    return "Accreditation service is not enabled for this tenant.";
  }

  const allowed = await hasTenantCapability({
    tenantId,
    userId: actorUserId,
    baseRole: actorRole,
    capability: "MANAGE_ACCREDITATION",
  });

  if (!allowed) {
    return "Insufficient permissions to manage accreditation.";
  }

  return null;
}

async function ensureTenantAccreditationReadAccess(tenantId: string) {
  return (await hasTenantServiceEnabled(tenantId, "ACCREDITATION"))
    ? null
    : "Accreditation service is not enabled for this tenant.";
}

async function getAccessibleVersionForTenant(tenantId: string, versionId: string) {
  return prisma.accreditationBodyVersion.findFirst({
    where: {
      id: versionId,
      body: {
        OR: [{ scope: AccreditationScope.GLOBAL, tenantId: null }, { scope: AccreditationScope.TENANT, tenantId }],
      },
    },
    include: {
      body: {
        select: {
          id: true,
          tenantId: true,
          scope: true,
          code: true,
          name: true,
          country: true,
          description: true,
          websiteUrl: true,
        },
      },
      _count: {
        select: {
          workspaces: true,
          blocks: true,
        },
      },
    },
  });
}

async function getEditableTenantVersion(tenantId: string, versionId: string) {
  return prisma.accreditationBodyVersion.findFirst({
    where: {
      id: versionId,
      body: {
        tenantId,
        scope: AccreditationScope.TENANT,
      },
    },
    include: {
      body: {
        select: {
          id: true,
          tenantId: true,
          scope: true,
        },
      },
      _count: {
        select: {
          workspaces: true,
          blocks: true,
        },
      },
    },
  });
}

async function getSuperadminVersion(versionId: string) {
  return prisma.accreditationBodyVersion.findFirst({
    where: {
      id: versionId,
      body: { scope: AccreditationScope.GLOBAL },
    },
    include: {
      body: {
        select: {
          id: true,
          scope: true,
        },
      },
      _count: {
        select: {
          workspaces: true,
          blocks: true,
        },
      },
    },
  });
}

function isEditableDraftLifecycle(status: AccreditationTemplateLifecycleStatus) {
  return (
    status === AccreditationTemplateLifecycleStatus.DRAFT ||
    status === AccreditationTemplateLifecycleStatus.VALIDATED
  );
}

function mapBlockRows(rows: Awaited<ReturnType<typeof prisma.criterionBlock.findMany>>) {
  return rows.map((block) => ({
    id: block.id,
    parentId: block.parentId,
    blockCode: block.blockCode,
    lineageKey: block.lineageKey,
    blockType: block.blockType,
    visibility: block.visibility,
    contributesToTotal: block.contributesToTotal,
    isSectionRoot: block.isSectionRoot,
    title: block.title,
    description: block.description,
    dataType: block.dataType,
    yearAggregation: block.yearAggregation,
    yearAggregationConfig: block.yearAggregationConfig as Prisma.JsonValue | null,
    maxScore: block.maxScore,
    sortOrder: block.sortOrder,
    depth: block.depth,
    unitOfMeasure: block.unitOfMeasure,
    inputSchema: block.inputSchema as Prisma.JsonValue | null,
    outputSchema: block.outputSchema as Prisma.JsonValue | null,
    calculationRule: block.calculationRule as Prisma.JsonValue | null,
    scoringRule: block.scoringRule as Prisma.JsonValue | null,
    validationRules: block.validationRules as Prisma.JsonValue | null,
    evidenceSchema: block.evidenceSchema as Prisma.JsonValue | null,
    expectedEvidence: block.expectedEvidence as Prisma.JsonValue | null,
    assistantConfig: block.assistantConfig as Prisma.JsonValue | null,
    dependencyRules: block.dependencyRules as Prisma.JsonValue | null,
    sourceLinks: block.sourceLinks as Prisma.JsonValue | null,
    isLeaf: block.isLeaf,
    isActive: block.isActive,
  }));
}

function validateAssistantConfigInput(value: Prisma.InputJsonValue | undefined, originalValue: unknown) {
  if (originalValue === undefined || originalValue === null) {
    return null;
  }
  if (typeof originalValue === "string" && originalValue.trim().length === 0) {
    return null;
  }
  if (value === undefined) {
    return null;
  }

  const parsed = blockAssistantConfigSchema.safeParse(value);
  return parsed.success ? null : parsed.error.issues[0]?.message ?? "assistantConfig is invalid.";
}

async function listVersionBlocks(versionId: string) {
  const blocks = await prisma.criterionBlock.findMany({
    where: { versionId },
    orderBy: [{ depth: "asc" }, { sortOrder: "asc" }, { blockCode: "asc" }],
  });

  return buildBlockTree(mapBlockRows(blocks));
}

function extractDependencyTargetCodes(blockCode: string, dependencyRules: Prisma.JsonValue | null) {
  if (!Array.isArray(dependencyRules)) {
    return [];
  }

  const refs: string[] = [];
  for (const rule of dependencyRules) {
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
      continue;
    }

    const targetBlockCode = Reflect.get(rule, "targetBlockCode");
    if (typeof targetBlockCode === "string" && targetBlockCode.trim().length > 0) {
      refs.push(targetBlockCode.trim());
    }
  }

  return refs.filter((targetCode) => targetCode !== blockCode);
}

function findDependencyCycle(graph: Map<string, string[]>) {
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (node: string, stack: string[]): string[] | null => {
    if (visiting.has(node)) {
      const cycleStart = stack.indexOf(node);
      return cycleStart >= 0 ? [...stack.slice(cycleStart), node] : [node, node];
    }
    if (visited.has(node)) {
      return null;
    }

    visiting.add(node);
    for (const next of graph.get(node) ?? []) {
      const cycle = visit(next, [...stack, node]);
      if (cycle) {
        return cycle;
      }
    }
    visiting.delete(node);
    visited.add(node);
    return null;
  };

  for (const node of graph.keys()) {
    const cycle = visit(node, []);
    if (cycle) {
      return cycle;
    }
  }

  return null;
}

async function validateVersionBlocksTx(tx: DbClient, versionId: string) {
  const blocks = await tx.criterionBlock.findMany({
    where: { versionId, isActive: true },
    orderBy: [{ depth: "asc" }, { sortOrder: "asc" }, { blockCode: "asc" }],
  });

  if (blocks.length === 0) {
    return { errors: ["Add at least one active template block before validation."], blockCount: 0, blocks };
  }

  const errors: string[] = [];
  const byId = new Map(blocks.map((block) => [block.id, block]));
  const byCode = new Map(blocks.map((block) => [block.blockCode, block]));
  const topology = buildBlockTopology(
    blocks.map((block) => ({
      id: block.id,
      parentId: block.parentId,
      blockType: block.blockType,
    })),
  );

  let rootCount = 0;
  let leafCount = 0;

  for (const block of blocks) {
    if (!block.parentId) {
      rootCount += 1;
    }

    const hasChildren = (topology.childrenByParent.get(block.id) ?? []).length > 0;
    if (
      (block.blockType === CriterionBlockType.METRIC || block.blockType === CriterionBlockType.QUALITATIVE) &&
      hasChildren
    ) {
      errors.push(`${block.blockCode} cannot have child blocks because it is a leaf block type.`);
    }
    if (
      (block.blockType === CriterionBlockType.METRIC || block.blockType === CriterionBlockType.QUALITATIVE) &&
      !hasChildren
    ) {
      leafCount += 1;
    }

    if (block.parentId) {
      const parent = byId.get(block.parentId);
      if (!parent) {
        errors.push(`${block.blockCode} references a missing parent block.`);
      } else {
        if (!blockTypeSupportsChildren(parent.blockType)) {
          errors.push(`${block.blockCode} cannot be nested under ${parent.blockCode} because the parent is a leaf block type.`);
        }
        if (!parent.isActive) {
          errors.push(`${block.blockCode} cannot stay active under inactive parent ${parent.blockCode}.`);
        }
      }
    }

    const actualDepth = resolveBlockActualDepth(block.id, topology);
    if (actualDepth === null) {
      errors.push(`The draft block tree contains a parent cycle involving ${block.blockCode}.`);
    } else if (actualDepth > MAX_BLOCK_DEPTH) {
      errors.push(`Block ${block.blockCode} exceeds the maximum supported depth of 3 levels.`);
    }

    for (const targetCode of extractDependencyTargetCodes(
      block.blockCode,
      block.dependencyRules as Prisma.JsonValue | null,
    )) {
      if (!byCode.has(targetCode)) {
        errors.push(`${block.blockCode} depends on unknown block ${targetCode}.`);
      }
    }
  }

  if (rootCount === 0) {
    errors.push("Add at least one root block before validation.");
  }

  if (leafCount === 0) {
    errors.push("Add at least one metric or qualitative leaf block before validation.");
  }

  const graph = new Map<string, string[]>();
  for (const block of blocks) {
    graph.set(
      block.blockCode,
      extractDependencyTargetCodes(block.blockCode, block.dependencyRules as Prisma.JsonValue | null),
    );
  }

  const cycle = findDependencyCycle(graph);
  if (cycle) {
    errors.push(`Block dependencies must be acyclic. Cycle detected: ${cycle.join(" -> ")}.`);
  }

  return {
    errors,
    blockCount: blocks.length,
    blocks,
  };
}

function extractSlabsFromScoringRule(scoringRule: Prisma.JsonValue | null) {
  if (!scoringRule || typeof scoringRule !== "object" || Array.isArray(scoringRule)) {
    return [];
  }

  const type = Reflect.get(scoringRule, "type");
  const slabs = Reflect.get(scoringRule, "slabs");
  if (type !== "SLAB" || !Array.isArray(slabs)) {
    return [];
  }

  return slabs
    .map((slab, index) => {
      if (!slab || typeof slab !== "object" || Array.isArray(slab)) {
        return null;
      }

      const min = Reflect.get(slab, "min");
      const max = Reflect.get(slab, "max");
      const label = Reflect.get(slab, "label");
      const pointsRaw = Reflect.get(slab, "points") ?? Reflect.get(slab, "pointsAwarded");
      const pointsAwarded =
        typeof pointsRaw === "number" && Number.isFinite(pointsRaw) ? pointsRaw : null;
      if (pointsAwarded === null) {
        return null;
      }

      return {
        rangeMin: typeof min === "number" && Number.isFinite(min) ? min : null,
        rangeMax: typeof max === "number" && Number.isFinite(max) ? max : null,
        rangeLabel: typeof label === "string" && label.trim().length > 0 ? label.trim() : null,
        pointsAwarded,
        sortOrder: index,
      };
    })
    .filter((row): row is { rangeMin: number | null; rangeMax: number | null; rangeLabel: string | null; pointsAwarded: number; sortOrder: number } => row !== null);
}

async function writeAuditLogTx(
  tx: DbClient,
  input: {
    tenantId?: string | null;
    actorUserId?: string | null;
    actorRole?: Role | null;
    targetType: string;
    targetId: string;
    action: string;
    previousState?: Prisma.InputJsonValue | null;
    newState?: Prisma.InputJsonValue | null;
    metadata?: Prisma.InputJsonValue | null;
  },
) {
  await tx.auditLog.create({
    data: {
      tenantId: input.tenantId ?? null,
      actorUserId: input.actorUserId ?? null,
      actorRole: input.actorRole ?? null,
      targetType: input.targetType,
      targetId: input.targetId,
      action: input.action,
      previousState: input.previousState ?? undefined,
      newState: input.newState ?? undefined,
      metadata: input.metadata ?? undefined,
    },
  });
}

async function assertEditableDraftVersion(
  version:
    | Awaited<ReturnType<typeof getEditableTenantVersion>>
    | Awaited<ReturnType<typeof getSuperadminVersion>>,
) {
  if (!version) {
    return "Version not found.";
  }

  if (!isEditableDraftLifecycle(version.lifecycleStatus)) {
    return "Only draft or validated template versions can be edited. Published versions must be forked or superseded.";
  }

  if (version._count.workspaces > 0) {
    return "Template versions already used by workspaces cannot be edited.";
  }

  return null;
}

async function createBlockTx(
  tx: DbClient,
  versionId: string,
  input: unknown,
  actorUserId?: string,
) {
  const parsed = blockInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error" as const, message: parsed.error.issues[0]?.message ?? "Invalid block input." };
  }

  const jsonFields = serializeJsonFields(parsed.data);
  if (!jsonFields.ok) {
    return { status: "error" as const, message: jsonFields.message };
  }
  const assistantConfigError = validateAssistantConfigInput(
    jsonFields.values.assistantConfig,
    parsed.data.assistantConfig,
  );
  if (assistantConfigError) {
    return { status: "error" as const, message: assistantConfigError };
  }

  let depth = 0;
  if (parsed.data.parentId) {
    const topology = buildBlockTopology(
      await tx.criterionBlock.findMany({
        where: { versionId },
        select: { id: true, parentId: true, blockType: true },
      }),
    );
    const parent = topology.byId.get(parsed.data.parentId);
    if (!parent) {
      return { status: "error" as const, message: "Parent block was not found in this template version." };
    }
    if (!blockTypeSupportsChildren(parent.blockType)) {
      return { status: "error" as const, message: "Leaf block types cannot have child blocks." };
    }

    const parentDepth = resolveBlockActualDepth(parent.id, topology);
    if (parentDepth === null) {
      return { status: "error" as const, message: "The block tree is inconsistent. Please fix the existing hierarchy first." };
    }

    depth = parentDepth + 1;
    if (depth > MAX_BLOCK_DEPTH) {
      return { status: "error" as const, message: "Template blocks support a maximum depth of 3 levels." };
    }
  }

  try {
    const block = await tx.criterionBlock.create({
      data: {
        versionId,
        parentId: parsed.data.parentId ?? null,
        blockCode: parsed.data.blockCode.trim(),
        lineageKey: parsed.data.blockCode.trim(),
        blockType: parsed.data.blockType,
        isLeaf: blockTypeIsLeaf(parsed.data.blockType),
        isSectionRoot: depth === 0,
        title: parsed.data.title.trim(),
        description: normalizeNullableString(parsed.data.description),
        dataType: parsed.data.dataType,
        yearAggregation: parsed.data.yearAggregation,
        yearAggregationConfig: jsonFields.values.yearAggregationConfig,
        maxScore: parsed.data.maxScore ?? null,
        sortOrder: parsed.data.sortOrder,
        depth,
        unitOfMeasure: normalizeNullableString(parsed.data.unitOfMeasure),
        inputSchema: jsonFields.values.inputSchema,
        outputSchema: jsonFields.values.outputSchema,
        calculationRule: jsonFields.values.calculationRule,
        scoringRule: jsonFields.values.scoringRule,
        validationRules: jsonFields.values.validationRules,
        evidenceSchema: jsonFields.values.evidenceSchema,
        expectedEvidence: jsonFields.values.evidenceSchema,
        assistantConfig: jsonFields.values.assistantConfig,
        dependencyRules: jsonFields.values.dependencyRules,
        sourceLinks: jsonFields.values.sourceLinks,
        isActive: parsed.data.isActive ?? true,
        createdByUserId: actorUserId ?? null,
      },
    });

    return { status: "success" as const, message: "Block created.", block };
  } catch (error) {
    return {
      status: "error" as const,
      message: error instanceof Error ? error.message : "Failed to create block.",
    };
  }
}

async function updateBlockTx(
  tx: DbClient,
  blockId: string,
  input: unknown,
) {
  const parsed = blockPatchSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error" as const, message: parsed.error.issues[0]?.message ?? "Invalid block input." };
  }

  const existing = await tx.criterionBlock.findUnique({
    where: { id: blockId },
    select: {
      id: true,
      versionId: true,
      blockCode: true,
      blockType: true,
      evidenceSchema: true,
      depth: true,
    },
  });
  if (!existing) {
    return { status: "error" as const, message: "Block not found." };
  }

  const jsonFields = serializeJsonFields(parsed.data);
  if (!jsonFields.ok) {
    return { status: "error" as const, message: jsonFields.message };
  }
  const assistantConfigError = validateAssistantConfigInput(
    jsonFields.values.assistantConfig,
    parsed.data.assistantConfig,
  );
  if (assistantConfigError) {
    return { status: "error" as const, message: assistantConfigError };
  }

  let topology:
    | ReturnType<typeof buildBlockTopology>
    | undefined;

  if (parsed.data.parentId !== undefined || parsed.data.blockType !== undefined) {
    topology = buildBlockTopology(
      await tx.criterionBlock.findMany({
        where: { versionId: existing.versionId },
        select: { id: true, parentId: true, blockType: true },
      }),
    );
  }

  if (
    parsed.data.blockType !== undefined &&
    !blockTypeSupportsChildren(parsed.data.blockType)
  ) {
    const childCount = topology?.childrenByParent.get(blockId)?.length ?? 0;
    if (childCount > 0) {
      return { status: "error" as const, message: "Blocks with child nodes cannot be converted into leaf block types." };
    }
  }

  let depth: number | undefined;
  let descendantDepthUpdates: Array<{ id: string; depth: number }> = [];
  if (parsed.data.parentId !== undefined) {
    if (!topology) {
      return { status: "error" as const, message: "Unable to validate the block hierarchy." };
    }

    if (parsed.data.parentId === blockId) {
      return { status: "error" as const, message: "A block cannot be its own parent." };
    }

    const subtree = collectBlockRelativeDepths(blockId, topology);
    if ("error" in subtree) {
      return { status: "error" as const, message: subtree.error };
    }

    if (parsed.data.parentId) {
      const parent = topology.byId.get(parsed.data.parentId);
      if (!parent) {
        return { status: "error" as const, message: "Parent block was not found in the selected version." };
      }
      if (!blockTypeSupportsChildren(parent.blockType)) {
        return { status: "error" as const, message: "Leaf block types cannot have child blocks." };
      }
      if (subtree.relativeDepths.has(parsed.data.parentId)) {
        return { status: "error" as const, message: "A block cannot be moved under one of its descendants." };
      }

      const parentDepth = resolveBlockActualDepth(parent.id, topology);
      if (parentDepth === null) {
        return { status: "error" as const, message: "The block tree is inconsistent. Please fix the existing hierarchy first." };
      }
      depth = parentDepth + 1;
    } else {
      depth = 0;
    }

    if (depth + subtree.maxRelativeDepth > MAX_BLOCK_DEPTH) {
      return { status: "error" as const, message: "Template blocks support a maximum depth of 3 levels." };
    }

    descendantDepthUpdates = [...subtree.relativeDepths.entries()]
      .filter(([nodeId]) => nodeId !== blockId)
      .map(([nodeId, relativeDepth]) => ({
        id: nodeId,
        depth: (depth ?? 0) + relativeDepth,
      }));
  }

  try {
    const updated = await tx.$transaction(async (innerTx) => {
      if (descendantDepthUpdates.length > 0) {
        for (const update of descendantDepthUpdates) {
          await innerTx.criterionBlock.update({
            where: { id: update.id },
            data: { depth: update.depth },
          });
        }
      }

      return innerTx.criterionBlock.update({
        where: { id: blockId },
        data: {
          ...(parsed.data.parentId !== undefined ? { parentId: parsed.data.parentId ?? null } : {}),
          ...(parsed.data.blockCode !== undefined
            ? {
                blockCode: parsed.data.blockCode.trim(),
              }
            : {}),
          ...(parsed.data.blockType !== undefined
            ? {
                blockType: parsed.data.blockType,
                isLeaf: blockTypeIsLeaf(parsed.data.blockType),
              }
            : {}),
          ...(parsed.data.title !== undefined ? { title: parsed.data.title.trim() } : {}),
          ...(parsed.data.description !== undefined ? { description: normalizeNullableString(parsed.data.description) } : {}),
          ...(parsed.data.dataType !== undefined ? { dataType: parsed.data.dataType } : {}),
          ...(parsed.data.yearAggregation !== undefined ? { yearAggregation: parsed.data.yearAggregation } : {}),
          ...(jsonFields.values.yearAggregationConfig !== undefined ? { yearAggregationConfig: jsonFields.values.yearAggregationConfig } : {}),
          ...(parsed.data.maxScore !== undefined ? { maxScore: parsed.data.maxScore ?? null } : {}),
          ...(parsed.data.sortOrder !== undefined ? { sortOrder: parsed.data.sortOrder } : {}),
          ...(depth !== undefined ? { depth, isSectionRoot: depth === 0 } : {}),
          ...(parsed.data.unitOfMeasure !== undefined ? { unitOfMeasure: normalizeNullableString(parsed.data.unitOfMeasure) } : {}),
          ...(jsonFields.values.inputSchema !== undefined ? { inputSchema: jsonFields.values.inputSchema } : {}),
          ...(jsonFields.values.outputSchema !== undefined ? { outputSchema: jsonFields.values.outputSchema } : {}),
          ...(jsonFields.values.calculationRule !== undefined ? { calculationRule: jsonFields.values.calculationRule } : {}),
          ...(jsonFields.values.scoringRule !== undefined ? { scoringRule: jsonFields.values.scoringRule } : {}),
          ...(jsonFields.values.validationRules !== undefined ? { validationRules: jsonFields.values.validationRules } : {}),
          ...(jsonFields.values.evidenceSchema !== undefined
            ? {
                evidenceSchema: jsonFields.values.evidenceSchema,
                expectedEvidence: jsonFields.values.evidenceSchema,
              }
            : {}),
          ...(jsonFields.values.assistantConfig !== undefined ? { assistantConfig: jsonFields.values.assistantConfig } : {}),
          ...(jsonFields.values.dependencyRules !== undefined ? { dependencyRules: jsonFields.values.dependencyRules } : {}),
          ...(jsonFields.values.sourceLinks !== undefined ? { sourceLinks: jsonFields.values.sourceLinks } : {}),
          ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
        },
      });
    });

    return { status: "success" as const, message: "Block updated.", block: updated };
  } catch (error) {
    return {
      status: "error" as const,
      message: error instanceof Error ? error.message : "Failed to update block.",
    };
  }
}

async function publishVersionBlocksTx(
  tx: DbClient,
  versionId: string,
  actorUserId: string | null,
  actorRole: Role | null,
  tenantId: string | null,
) {
  const validation = await validateVersionBlocksTx(tx, versionId);
  if (validation.errors.length > 0) {
    return { status: "error" as const, message: validation.errors[0]! };
  }

  const version = await tx.accreditationBodyVersion.findUnique({
    where: { id: versionId },
    include: {
      _count: {
        select: {
          workspaces: true,
        },
      },
    },
  });

  if (!version) {
    return { status: "error" as const, message: "Version not found." };
  }

  if (!isEditableDraftLifecycle(version.lifecycleStatus)) {
    return { status: "error" as const, message: "Only draft or validated template versions can be published." };
  }

  if (version._count.workspaces > 0) {
    return { status: "error" as const, message: "Template versions already used by workspaces cannot be republished in place." };
  }

  await tx.accreditationScoringSlab.deleteMany({
    where: {
      block: {
        versionId,
      },
    },
  });

  for (const block of validation.blocks) {
    await tx.criterionBlock.update({
      where: { id: block.id },
      data: {
        blockCode: block.blockCode,
        lineageKey: block.lineageKey ?? block.blockCode,
        expectedEvidence: block.evidenceSchema as Prisma.InputJsonValue | undefined,
        isLeaf: blockTypeIsLeaf(block.blockType),
        isSectionRoot: block.depth === 0,
      },
    });

    if (!block.isActive) {
      continue;
    }

    const slabs = extractSlabsFromScoringRule(block.scoringRule as Prisma.JsonValue | null);
    if (slabs.length > 0) {
      await tx.accreditationScoringSlab.createMany({
        data: slabs.map((slab) => ({
          blockId: block.id,
          rangeMin: slab.rangeMin,
          rangeMax: slab.rangeMax,
          rangeLabel: slab.rangeLabel,
          pointsAwarded: slab.pointsAwarded,
          sortOrder: slab.sortOrder,
        })),
      });
    }
  }

  const updatedVersion = await tx.accreditationBodyVersion.update({
    where: { id: versionId },
    data: {
        lifecycleStatus: AccreditationTemplateLifecycleStatus.PUBLISHED,
        publishedAt: new Date(),
        publishedByUserId: actorUserId,
        isLocked: true,
      },
    });

  await writeAuditLogTx(tx, {
    tenantId,
    actorUserId,
    actorRole,
    targetType: "AccreditationBodyVersion",
    targetId: versionId,
    action: "accreditation.template.publish",
    newState: {
      lifecycleStatus: AccreditationTemplateLifecycleStatus.PUBLISHED,
        publishedBlockCount: validation.blockCount,
      } as Prisma.InputJsonValue,
  });

  return {
    status: "success" as const,
    message: "Template published.",
    version: updatedVersion,
    publishedBlockCount: validation.blockCount,
  };
}

export async function listSuperadminVersionBlocks(versionId: string) {
  const version = await getSuperadminVersion(versionId);
  if (!version) {
    return { status: "error" as const, message: "Version not found." };
  }

  const blocks = await listVersionBlocks(versionId);
  return {
    status: "success" as const,
    version: {
      id: version.id,
      lifecycleStatus: version.lifecycleStatus,
      blockCount: version._count.blocks,
    },
    blocks,
  };
}

export async function listTenantVersionBlocks(tenantId: string, versionId: string) {
  const serviceError = await ensureTenantAccreditationReadAccess(tenantId);
  if (serviceError) {
    return { status: "error" as const, message: serviceError };
  }

  const version = await getAccessibleVersionForTenant(tenantId, versionId);
  if (!version) {
    return { status: "error" as const, message: "Version not found." };
  }

  const blocks = await listVersionBlocks(versionId);
  return {
    status: "success" as const,
    version: {
      id: version.id,
      lifecycleStatus: version.lifecycleStatus,
      scope: version.body.scope,
      blockCount: version._count.blocks,
    },
    blocks,
  };
}

export async function createSuperadminVersionBlock(
  versionId: string,
  input: unknown,
  actorUserId?: string,
) {
  const version = await getSuperadminVersion(versionId);
  const editableError = await assertEditableDraftVersion(version);
  if (editableError) {
    return { status: "error" as const, message: editableError };
  }

  return prisma.$transaction(async (tx) => {
    const result = await createBlockTx(tx, versionId, input, actorUserId);
    if (result.status === "success") {
      await writeAuditLogTx(tx, {
        actorUserId: actorUserId ?? null,
        actorRole: "SUPERADMIN",
        targetType: "CriterionBlock",
        targetId: result.block.id,
        action: "accreditation.block.create",
        newState: {
          versionId,
          blockCode: result.block.blockCode,
        } as Prisma.InputJsonValue,
      });
    }
    return result;
  });
}

export async function createTenantVersionBlock(
  tenantId: string,
  versionId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role,
) {
  const permissionError = await ensureTenantAccreditationManagement(tenantId, actorUserId, actorRole);
  if (permissionError) {
    return { status: "error" as const, message: permissionError };
  }

  const version = await getEditableTenantVersion(tenantId, versionId);
  const editableError = await assertEditableDraftVersion(version);
  if (editableError) {
    return { status: "error" as const, message: editableError };
  }

  return prisma.$transaction(async (tx) => {
    const result = await createBlockTx(tx, versionId, input, actorUserId);
    if (result.status === "success") {
      await writeAuditLogTx(tx, {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "CriterionBlock",
        targetId: result.block.id,
        action: "accreditation.block.create",
        newState: {
          versionId,
          blockCode: result.block.blockCode,
        } as Prisma.InputJsonValue,
      });
    }
    return result;
  });
}

export async function updateSuperadminVersionBlock(
  blockId: string,
  input: unknown,
  actorUserId?: string,
) {
  const block = await prisma.criterionBlock.findUnique({
    where: { id: blockId },
    include: {
      version: {
        include: {
          body: { select: { id: true, scope: true } },
          _count: { select: { workspaces: true, blocks: true } },
        },
      },
    },
  });
  if (!block || block.version.body.scope !== AccreditationScope.GLOBAL) {
    return { status: "error" as const, message: "Block not found." };
  }

  const editableError = await assertEditableDraftVersion(block.version);
  if (editableError) {
    return { status: "error" as const, message: editableError };
  }

  return prisma.$transaction(async (tx) => {
    const result = await updateBlockTx(tx, blockId, input);
    if (result.status === "success") {
      await writeAuditLogTx(tx, {
        actorUserId: actorUserId ?? null,
        actorRole: "SUPERADMIN",
        targetType: "CriterionBlock",
        targetId: blockId,
        action: "accreditation.block.update",
        newState: input as Prisma.InputJsonValue,
      });
    }
    return result;
  });
}

export async function updateTenantVersionBlock(
  tenantId: string,
  blockId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role,
) {
  const permissionError = await ensureTenantAccreditationManagement(tenantId, actorUserId, actorRole);
  if (permissionError) {
    return { status: "error" as const, message: permissionError };
  }

  const block = await prisma.criterionBlock.findUnique({
    where: { id: blockId },
    include: {
      version: {
        include: {
          body: { select: { id: true, scope: true, tenantId: true } },
          _count: { select: { workspaces: true, blocks: true } },
        },
      },
    },
  });
  if (!block || block.version.body.scope !== AccreditationScope.TENANT || block.version.body.tenantId !== tenantId) {
    return { status: "error" as const, message: "Block not found." };
  }

  const editableError = await assertEditableDraftVersion(block.version);
  if (editableError) {
    return { status: "error" as const, message: editableError };
  }

  return prisma.$transaction(async (tx) => {
    const result = await updateBlockTx(tx, blockId, input);
    if (result.status === "success") {
      await writeAuditLogTx(tx, {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "CriterionBlock",
        targetId: blockId,
        action: "accreditation.block.update",
        newState: input as Prisma.InputJsonValue,
      });
    }
    return result;
  });
}

export async function validateSuperadminVersionBlocks(versionId: string, actorUserId?: string) {
  const version = await getSuperadminVersion(versionId);
  const editableError = await assertEditableDraftVersion(version);
  if (editableError) {
    return { status: "error" as const, message: editableError };
  }

  return prisma.$transaction(async (tx) => {
    const validation = await validateVersionBlocksTx(tx, versionId);
    if (validation.errors.length > 0) {
      return {
        status: "error" as const,
        message: validation.errors[0]!,
        errors: validation.errors,
      };
    }

    const updatedVersion = await tx.accreditationBodyVersion.update({
      where: { id: versionId },
      data: { lifecycleStatus: AccreditationTemplateLifecycleStatus.VALIDATED },
    });

    await writeAuditLogTx(tx, {
      actorUserId: actorUserId ?? null,
      actorRole: "SUPERADMIN",
      targetType: "AccreditationBodyVersion",
      targetId: versionId,
      action: "accreditation.template.validate",
      newState: {
        lifecycleStatus: AccreditationTemplateLifecycleStatus.VALIDATED,
        blockCount: validation.blockCount,
      } as Prisma.InputJsonValue,
    });

    return {
      status: "success" as const,
      message: "Template validated.",
      version: updatedVersion,
      blockCount: validation.blockCount,
    };
  });
}

export async function validateTenantVersionBlocks(
  tenantId: string,
  versionId: string,
  actorUserId: string,
  actorRole: Role,
) {
  const permissionError = await ensureTenantAccreditationManagement(tenantId, actorUserId, actorRole);
  if (permissionError) {
    return { status: "error" as const, message: permissionError };
  }

  const version = await getEditableTenantVersion(tenantId, versionId);
  const editableError = await assertEditableDraftVersion(version);
  if (editableError) {
    return { status: "error" as const, message: editableError };
  }

  return prisma.$transaction(async (tx) => {
    const validation = await validateVersionBlocksTx(tx, versionId);
    if (validation.errors.length > 0) {
      return {
        status: "error" as const,
        message: validation.errors[0]!,
        errors: validation.errors,
      };
    }

    const updatedVersion = await tx.accreditationBodyVersion.update({
      where: { id: versionId },
      data: { lifecycleStatus: AccreditationTemplateLifecycleStatus.VALIDATED },
    });

    await writeAuditLogTx(tx, {
      tenantId,
      actorUserId,
      actorRole,
      targetType: "AccreditationBodyVersion",
      targetId: versionId,
      action: "accreditation.template.validate",
      newState: {
        lifecycleStatus: AccreditationTemplateLifecycleStatus.VALIDATED,
        blockCount: validation.blockCount,
      } as Prisma.InputJsonValue,
    });

    return {
      status: "success" as const,
      message: "Template validated.",
      version: updatedVersion,
      blockCount: validation.blockCount,
    };
  });
}

export async function publishSuperadminVersionBlocks(versionId: string, actorUserId: string) {
  const version = await getSuperadminVersion(versionId);
  const editableError = await assertEditableDraftVersion(version);
  if (editableError) {
    return { status: "error" as const, message: editableError };
  }

  return prisma.$transaction((tx) =>
    publishVersionBlocksTx(tx, versionId, actorUserId, "SUPERADMIN", null),
  );
}

export async function publishTenantVersionBlocks(
  tenantId: string,
  versionId: string,
  actorUserId: string,
  actorRole: Role,
) {
  const permissionError = await ensureTenantAccreditationManagement(tenantId, actorUserId, actorRole);
  if (permissionError) {
    return { status: "error" as const, message: permissionError };
  }

  const version = await getEditableTenantVersion(tenantId, versionId);
  const editableError = await assertEditableDraftVersion(version);
  if (editableError) {
    return { status: "error" as const, message: editableError };
  }

  return prisma.$transaction((tx) =>
    publishVersionBlocksTx(tx, versionId, actorUserId, actorRole, tenantId),
  );
}

async function getOrCreateTenantForkBodyTx(
  tx: DbClient,
  tenantId: string,
  sourceBody: {
    code: string;
    name: string;
    country: string | null;
    description: string | null;
    websiteUrl: string | null;
  },
  actorUserId: string,
) {
  const existing = await tx.accreditationBody.findFirst({
    where: {
      tenantId,
      scope: AccreditationScope.TENANT,
      code: sourceBody.code,
    },
  });

  if (existing) {
    return existing;
  }

  return tx.accreditationBody.create({
    data: {
      tenantId,
      scope: AccreditationScope.TENANT,
      code: sourceBody.code,
      name: sourceBody.name,
      country: sourceBody.country,
      description: sourceBody.description,
      websiteUrl: sourceBody.websiteUrl,
      createdByUserId: actorUserId,
    },
  });
}

async function getNextForkVersionCodeTx(tx: DbClient, bodyId: string, baseCode: string) {
  const existingCodes = new Set(
    (
      await tx.accreditationBodyVersion.findMany({
        where: { bodyId },
        select: { versionCode: true },
      })
    ).map((row) => row.versionCode),
  );

  const candidates = [baseCode.trim(), `${baseCode.trim()}-DRAFT`];
  for (const candidate of candidates) {
    if (!existingCodes.has(candidate)) {
      return candidate;
    }
  }

  let suffix = 2;
  while (existingCodes.has(`${baseCode.trim()}-DRAFT-${suffix}`)) {
    suffix += 1;
  }
  return `${baseCode.trim()}-DRAFT-${suffix}`;
}

function scoringRuleFromSlabs(
  slabs: Array<{
    rangeMin: number | null;
    rangeMax: number | null;
    rangeLabel: string | null;
    pointsAwarded: number;
    sortOrder: number;
  }>,
) {
  if (slabs.length === 0) {
    return Prisma.JsonNull;
  }

  return {
    type: "SLAB",
    slabs: slabs.map((slab) => ({
      min: slab.rangeMin,
      max: slab.rangeMax,
      label: slab.rangeLabel,
      points: slab.pointsAwarded,
      sortOrder: slab.sortOrder,
    })),
  } as Prisma.InputJsonValue;
}

export async function forkGlobalVersionToTenantDraft(
  tenantId: string,
  sourceVersionId: string,
  actorUserId: string,
  actorRole: Role,
) {
  const permissionError = await ensureTenantAccreditationManagement(tenantId, actorUserId, actorRole);
  if (permissionError) {
    return { status: "error" as const, message: permissionError };
  }

  return prisma.$transaction(async (tx) => {
    const sourceVersion = await tx.accreditationBodyVersion.findFirst({
      where: {
        id: sourceVersionId,
        lifecycleStatus: AccreditationTemplateLifecycleStatus.PUBLISHED,
        body: {
          scope: AccreditationScope.GLOBAL,
        },
      },
      include: {
        body: {
          select: {
            code: true,
            name: true,
            country: true,
            description: true,
            websiteUrl: true,
          },
        },
        profiles: {
          orderBy: [{ isDefault: "desc" }, { profileCode: "asc" }],
        },
        gradeBands: {
          orderBy: [{ sortOrder: "asc" }, { gradeLabel: "asc" }],
        },
        thresholdRules: {
          where: { blockId: null },
          orderBy: [{ thresholdType: "asc" }, { outcome: "asc" }],
        },
        blocks: {
          orderBy: [{ depth: "asc" }, { sortOrder: "asc" }, { blockCode: "asc" }],
        },
      },
    });

    if (!sourceVersion) {
      return { status: "error" as const, message: "Published global template version not found." };
    }

    const sourceBlocks =
      sourceVersion.blocks.length > 0
        ? sourceVersion.blocks.map((block) => ({
            sourceId: block.id,
            parentSourceId: block.parentId,
            blockCode: block.blockCode,
            blockType: block.blockType,
            title: block.title,
            description: block.description,
            dataType: block.dataType,
            yearAggregation: block.yearAggregation,
            yearAggregationConfig: block.yearAggregationConfig as Prisma.InputJsonValue | null,
            maxScore: block.maxScore,
            sortOrder: block.sortOrder,
            depth: block.depth,
            unitOfMeasure: block.unitOfMeasure,
            inputSchema: block.inputSchema as Prisma.InputJsonValue | null,
            outputSchema: block.outputSchema as Prisma.InputJsonValue | null,
            calculationRule: block.calculationRule as Prisma.InputJsonValue | null,
            scoringRule: block.scoringRule as Prisma.InputJsonValue | null,
            validationRules: block.validationRules as Prisma.InputJsonValue | null,
            evidenceSchema: block.evidenceSchema as Prisma.InputJsonValue | null,
            expectedEvidence: block.expectedEvidence as Prisma.InputJsonValue | null,
            assistantConfig: block.assistantConfig as Prisma.InputJsonValue | null,
            lineageKey: block.lineageKey,
            visibility: block.visibility,
            contributesToTotal: block.contributesToTotal,
            isSectionRoot: block.isSectionRoot,
            isLeaf: block.isLeaf,
            dependencyRules: block.dependencyRules as Prisma.InputJsonValue | null,
            sourceLinks: block.sourceLinks as Prisma.InputJsonValue | null,
            isActive: block.isActive,
          }))
        : [];

    if (sourceBlocks.length === 0) {
      return { status: "error" as const, message: "The source version does not contain any reusable blocks." };
    }

    const tenantBody = await getOrCreateTenantForkBodyTx(
      tx,
      tenantId,
      sourceVersion.body,
      actorUserId,
    );

    const draftVersion = await tx.accreditationBodyVersion.create({
      data: {
        bodyId: tenantBody.id,
        sourceVersionId: sourceVersion.id,
        versionCode: await getNextForkVersionCodeTx(tx, tenantBody.id, sourceVersion.versionCode),
        versionName: `${sourceVersion.versionName} (Tenant Draft)`,
        assistantPackKey: sourceVersion.assistantPackKey,
        copilotMode: sourceVersion.copilotMode,
        llmProfileId: sourceVersion.llmProfileId,
        llmConfig:
          sourceVersion.llmConfig === null
            ? Prisma.JsonNull
            : (sourceVersion.llmConfig as Prisma.InputJsonValue),
        scoreBase: sourceVersion.scoreBase,
        convertedScaleMax: sourceVersion.convertedScaleMax,
        conversionType: sourceVersion.conversionType,
        conversionFactor: sourceVersion.conversionFactor,
        effectiveFrom: sourceVersion.effectiveFrom,
        effectiveTo: sourceVersion.effectiveTo,
        lifecycleStatus: AccreditationTemplateLifecycleStatus.DRAFT,
        isActive: true,
      },
    });

    for (const profile of sourceVersion.profiles) {
      await tx.accreditationProfile.create({
        data: {
          versionId: draftVersion.id,
          profileCode: profile.profileCode,
          profileName: profile.profileName,
          description: profile.description,
          isDefault: profile.isDefault,
        },
      });
    }

    if (sourceVersion.gradeBands.length > 0) {
      await tx.accreditationGradeBand.createMany({
        data: sourceVersion.gradeBands.map((band) => ({
          versionId: draftVersion.id,
          gradeLabel: band.gradeLabel,
          scoreMin: band.scoreMin,
          scoreMax: band.scoreMax,
          outcome: band.outcome,
          sortOrder: band.sortOrder,
        })),
      });
    }

    if (sourceVersion.thresholdRules.length > 0) {
      await tx.accreditationThresholdRule.createMany({
        data: sourceVersion.thresholdRules.map((rule) => ({
          versionId: draftVersion.id,
          thresholdType: rule.thresholdType,
          minValue: rule.minValue,
          outcome: rule.outcome,
          description: rule.description,
        })),
      });
    }

    const sourceToDraft = new Map<string, string>();
    for (const block of sourceBlocks) {
      const created = await tx.criterionBlock.create({
        data: {
          versionId: draftVersion.id,
          parentId: block.parentSourceId ? sourceToDraft.get(block.parentSourceId) ?? null : null,
          blockCode: block.blockCode,
          lineageKey: block.lineageKey ?? block.blockCode,
          blockType: block.blockType,
          visibility: block.visibility ?? CriterionBlockVisibility.VISIBLE_INPUT,
          contributesToTotal: block.contributesToTotal ?? true,
          isSectionRoot: block.isSectionRoot ?? block.depth === 0,
          title: block.title,
          description: block.description,
          dataType: block.dataType,
          yearAggregation: block.yearAggregation,
          yearAggregationConfig: block.yearAggregationConfig ?? undefined,
          maxScore: block.maxScore,
          sortOrder: block.sortOrder,
          depth: block.depth,
          unitOfMeasure: block.unitOfMeasure,
          inputSchema: block.inputSchema ?? undefined,
          outputSchema: block.outputSchema ?? undefined,
          calculationRule: block.calculationRule ?? undefined,
          scoringRule: block.scoringRule ?? undefined,
          validationRules: block.validationRules ?? undefined,
          evidenceSchema: block.evidenceSchema ?? undefined,
          expectedEvidence: block.expectedEvidence ?? block.evidenceSchema ?? undefined,
          assistantConfig: block.assistantConfig ?? undefined,
          isLeaf: block.isLeaf ?? blockTypeIsLeaf(block.blockType),
          dependencyRules: block.dependencyRules ?? undefined,
          sourceLinks: block.sourceLinks ?? undefined,
          isActive: block.isActive,
          createdByUserId: actorUserId,
        },
      });
      sourceToDraft.set(block.sourceId, created.id);
    }

    await writeAuditLogTx(tx, {
      tenantId,
      actorUserId,
      actorRole,
      targetType: "AccreditationBodyVersion",
      targetId: draftVersion.id,
      action: "accreditation.template.fork",
      newState: {
        sourceVersionId: sourceVersion.id,
        lifecycleStatus: AccreditationTemplateLifecycleStatus.DRAFT,
        blockCount: sourceBlocks.length,
      } as Prisma.InputJsonValue,
    });

    return {
      status: "success" as const,
      message: "Global template forked into a tenant draft.",
      body: tenantBody,
      version: draftVersion,
      blockCount: sourceBlocks.length,
    };
  });
}
