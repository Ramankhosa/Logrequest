import {
  AccreditationScope,
  CriterionDataType,
  Prisma,
  Role,
} from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hasTenantCapability } from "@/lib/tenant-permissions/service";
import { hasTenantServiceEnabled } from "@/lib/tenant-services/service";

const tenantOwnerRole = "TENANT_OWNER" satisfies Role;
const tenantAdminRole = "TENANT_ADMIN" satisfies Role;

const bodyInputSchema = z.object({
  code: z.string().trim().min(2).max(40),
  name: z.string().trim().min(2).max(200),
  country: z.string().trim().max(20).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  websiteUrl: z.string().trim().url().nullable().optional(),
  isActive: z.boolean().optional(),
});

const versionInputSchema = z.object({
  versionCode: z.string().trim().min(1).max(80),
  versionName: z.string().trim().min(2).max(200),
  scoreBase: z.number().positive(),
  convertedScaleMax: z.number().positive().nullable().optional(),
  conversionFormula: z.string().trim().max(200).nullable().optional(),
  effectiveFrom: z.coerce.date().nullable().optional(),
  effectiveTo: z.coerce.date().nullable().optional(),
  isActive: z.boolean().optional(),
});

const profileInputSchema = z.object({
  profileCode: z.string().trim().min(1).max(80),
  profileName: z.string().trim().min(2).max(200),
  description: z.string().trim().max(1000).nullable().optional(),
  isDefault: z.boolean().optional(),
});

const criterionInputSchema = z.object({
  parentId: z.string().trim().min(1).nullable().optional(),
  criterionCode: z.string().trim().min(1).max(80),
  title: z.string().trim().min(2).max(300),
  description: z.string().trim().max(4000).nullable().optional(),
  dataType: z.nativeEnum(CriterionDataType).default(CriterionDataType.QUANTITATIVE),
  maxScore: z.number().nonnegative().nullable().optional(),
  sortOrder: z.number().int().min(0).default(0),
  unitOfMeasure: z.string().trim().max(80).nullable().optional(),
  validationRules: z.unknown().optional(),
  expectedEvidence: z.unknown().optional(),
  isLeaf: z.boolean().default(false),
  isActive: z.boolean().optional(),
});

const profileWeightsInputSchema = z.object({
  weights: z.array(
    z.object({
      criterionId: z.string().trim().min(1),
      maxScore: z.number().nonnegative(),
      weightPercent: z.number().nonnegative().nullable().optional(),
    }),
  ),
});

const accreditationLinkInputSchema = z.object({
  criterionId: z.string().trim().min(1),
  notes: z.string().trim().max(1000).nullable().optional(),
});

const MAX_CRITERION_DEPTH = 2;

type ProfileWeightInput = z.infer<typeof profileWeightsInputSchema>["weights"][number];

type CriterionRow = {
  id: string;
  parentId: string | null;
  criterionCode: string;
  title: string;
  description: string | null;
  dataType: CriterionDataType;
  maxScore: number | null;
  sortOrder: number;
  depth: number;
  unitOfMeasure: string | null;
  validationRules: Prisma.JsonValue | null;
  expectedEvidence: Prisma.JsonValue | null;
  isLeaf: boolean;
  isActive: boolean;
  children: CriterionRow[];
};

type CriterionTopologyNode = {
  id: string;
  parentId: string | null;
  isLeaf: boolean;
};

function isAdminOrOwner(role: Role) {
  return role === "SUPERADMIN" || role === tenantOwnerRole || role === tenantAdminRole;
}

function normalizeNullableString(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function isPrismaErrorWithCode(error: unknown, code: string) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

function buildCriterionTopology(nodes: CriterionTopologyNode[]) {
  const byId = new Map<string, CriterionTopologyNode>();
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

function resolveCriterionActualDepth(
  criterionId: string,
  topology: ReturnType<typeof buildCriterionTopology>,
  cache = new Map<string, number>(),
  trail = new Set<string>(),
): number | null {
  const cached = cache.get(criterionId);
  if (cached !== undefined) {
    return cached;
  }

  if (trail.has(criterionId)) {
    return null;
  }

  const node = topology.byId.get(criterionId);
  if (!node || !node.parentId) {
    cache.set(criterionId, 0);
    return 0;
  }

  const parent = topology.byId.get(node.parentId);
  if (!parent) {
    cache.set(criterionId, 0);
    return 0;
  }

  const nextTrail = new Set(trail);
  nextTrail.add(criterionId);
  const parentDepth = resolveCriterionActualDepth(parent.id, topology, cache, nextTrail);
  if (parentDepth === null) {
    return null;
  }

  const depth = parentDepth + 1;
  cache.set(criterionId, depth);
  return depth;
}

function collectCriterionRelativeDepths(
  rootId: string,
  topology: ReturnType<typeof buildCriterionTopology>,
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
        return { error: "The accreditation criteria tree is inconsistent. Please fix the existing hierarchy first." };
      }
      relativeDepths.set(childId, baseDepth + 1);
      queue.push(childId);
    }
  }

  const maxRelativeDepth = Math.max(...relativeDepths.values());
  return { relativeDepths, maxRelativeDepth };
}

async function validateProfileWeightCriteria(versionId: string, weights: ProfileWeightInput[]) {
  if (weights.length === 0) {
    return null;
  }

  const seenCriterionIds = new Set<string>();
  for (const weight of weights) {
    if (seenCriterionIds.has(weight.criterionId)) {
      return "Duplicate criterion weight overrides are not allowed.";
    }
    seenCriterionIds.add(weight.criterionId);
  }

  const criteria = await prisma.accreditationCriterion.findMany({
    where: {
      id: {
        in: [...seenCriterionIds],
      },
    },
    select: {
      id: true,
      versionId: true,
    },
  });

  if (criteria.length !== seenCriterionIds.size) {
    return "One or more criteria in the weight overrides were not found.";
  }

  const invalidCriterion = criteria.find((criterion) => criterion.versionId !== versionId);
  if (invalidCriterion) {
    return "Profile weights can only reference criteria from the same accreditation version.";
  }

  return null;
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
  const enabled = await hasTenantServiceEnabled(tenantId, "ACCREDITATION");
  return enabled ? null : "Accreditation service is not enabled for this tenant.";
}

function buildCriterionTree(rows: Omit<CriterionRow, "children">[]): CriterionRow[] {
  const map = new Map<string, CriterionRow>();
  const roots: CriterionRow[] = [];

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

  const sortRecursive = (nodes: CriterionRow[]) => {
    nodes.sort((a, b) => a.sortOrder - b.sortOrder || a.criterionCode.localeCompare(b.criterionCode));
    for (const node of nodes) {
      sortRecursive(node.children);
    }
  };

  sortRecursive(roots);
  return roots;
}

async function getTenantEditableBody(tenantId: string, bodyId: string) {
  return prisma.accreditationBody.findFirst({
    where: {
      id: bodyId,
      tenantId,
      scope: AccreditationScope.TENANT,
    },
  });
}

async function getAccessibleBodyForTenant(tenantId: string, bodyId: string) {
  return prisma.accreditationBody.findFirst({
    where: {
      id: bodyId,
      OR: [
        { scope: AccreditationScope.GLOBAL, tenantId: null },
        { scope: AccreditationScope.TENANT, tenantId },
      ],
    },
  });
}

async function getEditableVersionForTenant(tenantId: string, versionId: string) {
  return prisma.accreditationBodyVersion.findFirst({
    where: {
      id: versionId,
      body: {
        tenantId,
        scope: AccreditationScope.TENANT,
      },
    },
  });
}

async function getAccessibleVersionForTenant(tenantId: string, versionId: string) {
  return prisma.accreditationBodyVersion.findFirst({
    where: {
      id: versionId,
      body: {
        OR: [
          { scope: AccreditationScope.GLOBAL, tenantId: null },
          { scope: AccreditationScope.TENANT, tenantId },
        ],
      },
    },
  });
}

async function getEditableProfileForTenant(tenantId: string, profileId: string) {
  return prisma.accreditationProfile.findFirst({
    where: {
      id: profileId,
      version: {
        body: {
          tenantId,
          scope: AccreditationScope.TENANT,
        },
      },
    },
  });
}

async function getEditableCriterionForTenant(tenantId: string, criterionId: string) {
  return prisma.accreditationCriterion.findFirst({
    where: {
      id: criterionId,
      version: {
        body: {
          tenantId,
          scope: AccreditationScope.TENANT,
        },
      },
    },
  });
}

async function resolveCriterionDepth(versionId: string, parentId: string | null) {
  if (!parentId) {
    return { depth: 0 };
  }

  const parent = await prisma.accreditationCriterion.findUnique({
    where: { id: parentId },
    select: { id: true, versionId: true, depth: true, isLeaf: true },
  });

  if (!parent || parent.versionId !== versionId) {
    return { error: "Parent criterion was not found in the selected version." };
  }

  if (parent.isLeaf) {
    return { error: "Leaf criteria cannot have child criteria." };
  }

  if (parent.depth >= MAX_CRITERION_DEPTH) {
    return { error: "Accreditation criteria support a maximum depth of 3 levels." };
  }

  return { depth: parent.depth + 1 };
}

export async function listSuperadminAccreditationBodies() {
  const rows = await prisma.accreditationBody.findMany({
    where: { scope: AccreditationScope.GLOBAL },
    include: { _count: { select: { versions: true } } },
    orderBy: [{ isActive: "desc" }, { code: "asc" }],
  });

  return rows.map((row) => ({
    id: row.id,
    scope: row.scope,
    code: row.code,
    name: row.name,
    country: row.country,
    description: row.description,
    websiteUrl: row.websiteUrl,
    isActive: row.isActive,
    versionCount: row._count.versions,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

export async function listTenantAccreditationBodies(tenantId: string) {
  const serviceError = await ensureTenantAccreditationReadAccess(tenantId);
  if (serviceError) {
    return { status: "error" as const, message: serviceError };
  }

  const rows = await prisma.accreditationBody.findMany({
    where: {
      OR: [
        { scope: AccreditationScope.GLOBAL, tenantId: null },
        { scope: AccreditationScope.TENANT, tenantId },
      ],
    },
    include: { _count: { select: { versions: true } } },
    orderBy: [{ scope: "asc" }, { isActive: "desc" }, { code: "asc" }],
  });

  return {
    status: "success" as const,
    bodies: rows.map((row) => ({
      id: row.id,
      scope: row.scope,
      code: row.code,
      name: row.name,
      country: row.country,
      description: row.description,
      websiteUrl: row.websiteUrl,
      isActive: row.isActive,
      versionCount: row._count.versions,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
  };
}

export async function createSuperadminAccreditationBody(
  input: unknown,
  actorUserId: string,
) {
  const parsed = bodyInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error" as const, message: parsed.error.issues[0]?.message ?? "Invalid body input." };
  }

  try {
    const body = await prisma.accreditationBody.create({
      data: {
        scope: AccreditationScope.GLOBAL,
        tenantId: null,
        code: parsed.data.code.trim().toUpperCase(),
        name: parsed.data.name.trim(),
        country: normalizeNullableString(parsed.data.country),
        description: normalizeNullableString(parsed.data.description),
        websiteUrl: normalizeNullableString(parsed.data.websiteUrl),
        isActive: parsed.data.isActive ?? true,
        createdByUserId: actorUserId,
      },
    });

    return { status: "success" as const, message: "Accreditation body created.", body };
  } catch (error) {
    return {
      status: "error" as const,
      message: error instanceof Error ? error.message : "Failed to create accreditation body.",
    };
  }
}

export async function createTenantAccreditationBody(
  tenantId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role,
) {
  const permissionError = await ensureTenantAccreditationManagement(tenantId, actorUserId, actorRole);
  if (permissionError) {
    return { status: "error" as const, message: permissionError };
  }

  const parsed = bodyInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error" as const, message: parsed.error.issues[0]?.message ?? "Invalid body input." };
  }

  try {
    const body = await prisma.accreditationBody.create({
      data: {
        scope: AccreditationScope.TENANT,
        tenantId,
        code: parsed.data.code.trim().toUpperCase(),
        name: parsed.data.name.trim(),
        country: normalizeNullableString(parsed.data.country),
        description: normalizeNullableString(parsed.data.description),
        websiteUrl: normalizeNullableString(parsed.data.websiteUrl),
        isActive: parsed.data.isActive ?? true,
        createdByUserId: actorUserId,
      },
    });

    return { status: "success" as const, message: "Accreditation body created.", body };
  } catch (error) {
    return {
      status: "error" as const,
      message: error instanceof Error ? error.message : "Failed to create accreditation body.",
    };
  }
}

async function updateBody(bodyId: string, input: unknown) {
  const parsed = bodyInputSchema.partial().safeParse(input);
  if (!parsed.success) {
    return { status: "error" as const, message: parsed.error.issues[0]?.message ?? "Invalid body input." };
  }

  const updated = await prisma.accreditationBody.update({
    where: { id: bodyId },
    data: {
      ...(parsed.data.code !== undefined ? { code: parsed.data.code.trim().toUpperCase() } : {}),
      ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
      ...(parsed.data.country !== undefined ? { country: normalizeNullableString(parsed.data.country) } : {}),
      ...(parsed.data.description !== undefined ? { description: normalizeNullableString(parsed.data.description) } : {}),
      ...(parsed.data.websiteUrl !== undefined ? { websiteUrl: normalizeNullableString(parsed.data.websiteUrl) } : {}),
      ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
    },
  });

  return { status: "success" as const, message: "Accreditation body updated.", body: updated };
}

export async function updateSuperadminAccreditationBody(bodyId: string, input: unknown) {
  const body = await prisma.accreditationBody.findFirst({
    where: { id: bodyId, scope: AccreditationScope.GLOBAL },
  });
  if (!body) {
    return { status: "error" as const, message: "Accreditation body not found." };
  }

  return updateBody(bodyId, input);
}

export async function updateTenantAccreditationBody(
  tenantId: string,
  bodyId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role,
) {
  const permissionError = await ensureTenantAccreditationManagement(tenantId, actorUserId, actorRole);
  if (permissionError) {
    return { status: "error" as const, message: permissionError };
  }

  const body = await getTenantEditableBody(tenantId, bodyId);
  if (!body) {
    return { status: "error" as const, message: "Accreditation body not found." };
  }

  return updateBody(bodyId, input);
}

export async function listSuperadminBodyVersions(bodyId: string) {
  const body = await prisma.accreditationBody.findFirst({
    where: { id: bodyId, scope: AccreditationScope.GLOBAL },
  });
  if (!body) {
    return { status: "error" as const, message: "Accreditation body not found." };
  }

  const versions = await prisma.accreditationBodyVersion.findMany({
    where: { bodyId },
    orderBy: [{ isActive: "desc" }, { versionCode: "asc" }],
  });
  return { status: "success" as const, versions };
}

export async function listTenantBodyVersions(tenantId: string, bodyId: string) {
  const serviceError = await ensureTenantAccreditationReadAccess(tenantId);
  if (serviceError) {
    return { status: "error" as const, message: serviceError };
  }

  const body = await getAccessibleBodyForTenant(tenantId, bodyId);
  if (!body) {
    return { status: "error" as const, message: "Accreditation body not found." };
  }

  const versions = await prisma.accreditationBodyVersion.findMany({
    where: { bodyId },
    orderBy: [{ isActive: "desc" }, { versionCode: "asc" }],
  });
  return { status: "success" as const, versions };
}

async function createVersion(bodyId: string, input: unknown) {
  const parsed = versionInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error" as const, message: parsed.error.issues[0]?.message ?? "Invalid version input." };
  }

  try {
    const version = await prisma.accreditationBodyVersion.create({
      data: {
        bodyId,
        versionCode: parsed.data.versionCode.trim(),
        versionName: parsed.data.versionName.trim(),
        scoreBase: parsed.data.scoreBase,
        convertedScaleMax: parsed.data.convertedScaleMax ?? null,
        conversionFormula: normalizeNullableString(parsed.data.conversionFormula),
        effectiveFrom: parsed.data.effectiveFrom ?? null,
        effectiveTo: parsed.data.effectiveTo ?? null,
        isActive: parsed.data.isActive ?? true,
      },
    });

    return { status: "success" as const, message: "Version created.", version };
  } catch (error) {
    return {
      status: "error" as const,
      message: error instanceof Error ? error.message : "Failed to create version.",
    };
  }
}

export async function createSuperadminBodyVersion(bodyId: string, input: unknown) {
  const body = await prisma.accreditationBody.findFirst({
    where: { id: bodyId, scope: AccreditationScope.GLOBAL },
  });
  if (!body) {
    return { status: "error" as const, message: "Accreditation body not found." };
  }

  return createVersion(bodyId, input);
}

export async function createTenantBodyVersion(
  tenantId: string,
  bodyId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role,
) {
  const permissionError = await ensureTenantAccreditationManagement(tenantId, actorUserId, actorRole);
  if (permissionError) {
    return { status: "error" as const, message: permissionError };
  }

  const body = await getTenantEditableBody(tenantId, bodyId);
  if (!body) {
    return { status: "error" as const, message: "Accreditation body not found." };
  }

  return createVersion(bodyId, input);
}

async function updateVersion(versionId: string, input: unknown) {
  const parsed = versionInputSchema.partial().safeParse(input);
  if (!parsed.success) {
    return { status: "error" as const, message: parsed.error.issues[0]?.message ?? "Invalid version input." };
  }

  const updated = await prisma.accreditationBodyVersion.update({
    where: { id: versionId },
    data: {
      ...(parsed.data.versionCode !== undefined ? { versionCode: parsed.data.versionCode.trim() } : {}),
      ...(parsed.data.versionName !== undefined ? { versionName: parsed.data.versionName.trim() } : {}),
      ...(parsed.data.scoreBase !== undefined ? { scoreBase: parsed.data.scoreBase } : {}),
      ...(parsed.data.convertedScaleMax !== undefined ? { convertedScaleMax: parsed.data.convertedScaleMax ?? null } : {}),
      ...(parsed.data.conversionFormula !== undefined ? { conversionFormula: normalizeNullableString(parsed.data.conversionFormula) } : {}),
      ...(parsed.data.effectiveFrom !== undefined ? { effectiveFrom: parsed.data.effectiveFrom ?? null } : {}),
      ...(parsed.data.effectiveTo !== undefined ? { effectiveTo: parsed.data.effectiveTo ?? null } : {}),
      ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
    },
  });

  return { status: "success" as const, message: "Version updated.", version: updated };
}

export async function updateSuperadminBodyVersion(versionId: string, input: unknown) {
  const version = await prisma.accreditationBodyVersion.findFirst({
    where: { id: versionId, body: { scope: AccreditationScope.GLOBAL } },
  });
  if (!version) {
    return { status: "error" as const, message: "Version not found." };
  }

  return updateVersion(versionId, input);
}

export async function updateTenantBodyVersion(
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

  const version = await getEditableVersionForTenant(tenantId, versionId);
  if (!version) {
    return { status: "error" as const, message: "Version not found." };
  }

  return updateVersion(versionId, input);
}

async function createProfile(versionId: string, input: unknown) {
  const parsed = profileInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error" as const, message: parsed.error.issues[0]?.message ?? "Invalid profile input." };
  }

  try {
    const profile = await prisma.$transaction(async (tx) => {
      if (parsed.data.isDefault) {
        await tx.accreditationProfile.updateMany({
          where: {
            versionId,
            isDefault: true,
          },
          data: {
            isDefault: false,
          },
        });
      }

      return tx.accreditationProfile.create({
        data: {
          versionId,
          profileCode: parsed.data.profileCode.trim().toUpperCase(),
          profileName: parsed.data.profileName.trim(),
          description: normalizeNullableString(parsed.data.description),
          isDefault: parsed.data.isDefault ?? false,
        },
      });
    });
    return { status: "success" as const, message: "Profile created.", profile };
  } catch (error) {
    return {
      status: "error" as const,
      message: error instanceof Error ? error.message : "Failed to create profile.",
    };
  }
}

export async function listSuperadminVersionProfiles(versionId: string) {
  const version = await prisma.accreditationBodyVersion.findFirst({
    where: { id: versionId, body: { scope: AccreditationScope.GLOBAL } },
  });
  if (!version) {
    return { status: "error" as const, message: "Version not found." };
  }

  const profiles = await prisma.accreditationProfile.findMany({
    where: { versionId },
    include: {
      _count: { select: { weightOverrides: true } },
      weightOverrides: {
        select: {
          criterionId: true,
          maxScore: true,
          weightPercent: true,
        },
        orderBy: [{ criterionId: "asc" }],
      },
    },
    orderBy: [{ isDefault: "desc" }, { profileCode: "asc" }],
  });
  return {
    status: "success" as const,
    profiles: profiles.map((profile) => ({
      ...profile,
      weightOverrideCount: profile._count.weightOverrides,
    })),
  };
}

export async function listTenantVersionProfiles(tenantId: string, versionId: string) {
  const serviceError = await ensureTenantAccreditationReadAccess(tenantId);
  if (serviceError) {
    return { status: "error" as const, message: serviceError };
  }

  const version = await getAccessibleVersionForTenant(tenantId, versionId);
  if (!version) {
    return { status: "error" as const, message: "Version not found." };
  }

  const profiles = await prisma.accreditationProfile.findMany({
    where: { versionId },
    include: {
      _count: { select: { weightOverrides: true } },
      weightOverrides: {
        select: {
          criterionId: true,
          maxScore: true,
          weightPercent: true,
        },
        orderBy: [{ criterionId: "asc" }],
      },
    },
    orderBy: [{ isDefault: "desc" }, { profileCode: "asc" }],
  });
  return {
    status: "success" as const,
    profiles: profiles.map((profile) => ({
      ...profile,
      weightOverrideCount: profile._count.weightOverrides,
    })),
  };
}

export async function createSuperadminVersionProfile(versionId: string, input: unknown) {
  const version = await prisma.accreditationBodyVersion.findFirst({
    where: { id: versionId, body: { scope: AccreditationScope.GLOBAL } },
  });
  if (!version) {
    return { status: "error" as const, message: "Version not found." };
  }
  return createProfile(versionId, input);
}

export async function setSuperadminProfileWeights(profileId: string, input: unknown) {
  const parsed = profileWeightsInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error" as const, message: parsed.error.issues[0]?.message ?? "Invalid weight overrides." };
  }

  const profile = await prisma.accreditationProfile.findFirst({
    where: {
      id: profileId,
      version: {
        body: {
          scope: AccreditationScope.GLOBAL,
        },
      },
    },
    select: { id: true, versionId: true },
  });
  if (!profile) {
    return { status: "error" as const, message: "Profile not found." };
  }

  const weightsError = await validateProfileWeightCriteria(profile.versionId, parsed.data.weights);
  if (weightsError) {
    return { status: "error" as const, message: weightsError };
  }

  await prisma.$transaction(async (tx) => {
    await tx.accreditationProfileWeight.deleteMany({ where: { profileId } });
    if (parsed.data.weights.length > 0) {
      await tx.accreditationProfileWeight.createMany({
        data: parsed.data.weights.map((weight) => ({
          profileId,
          criterionId: weight.criterionId,
          maxScore: weight.maxScore,
          weightPercent: weight.weightPercent ?? null,
        })),
      });
    }
  });

  return { status: "success" as const, message: "Profile weights updated." };
}

export async function createTenantVersionProfile(
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

  const version = await getEditableVersionForTenant(tenantId, versionId);
  if (!version) {
    return { status: "error" as const, message: "Version not found." };
  }
  return createProfile(versionId, input);
}

async function createCriterion(versionId: string, input: unknown) {
  const parsed = criterionInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error" as const, message: parsed.error.issues[0]?.message ?? "Invalid criterion input." };
  }

  const parentResolution = await resolveCriterionDepth(versionId, parsed.data.parentId ?? null);
  if ("error" in parentResolution) {
    return { status: "error" as const, message: parentResolution.error };
  }

  try {
    const criterion = await prisma.accreditationCriterion.create({
      data: {
        versionId,
        parentId: parsed.data.parentId ?? null,
        criterionCode: parsed.data.criterionCode.trim(),
        title: parsed.data.title.trim(),
        description: normalizeNullableString(parsed.data.description),
        dataType: parsed.data.dataType,
        maxScore: parsed.data.maxScore ?? null,
        sortOrder: parsed.data.sortOrder,
        depth: parentResolution.depth,
        unitOfMeasure: normalizeNullableString(parsed.data.unitOfMeasure),
        validationRules:
          parsed.data.validationRules === undefined
            ? Prisma.JsonNull
            : (parsed.data.validationRules as Prisma.InputJsonValue),
        expectedEvidence:
          parsed.data.expectedEvidence === undefined
            ? Prisma.JsonNull
            : (parsed.data.expectedEvidence as Prisma.InputJsonValue),
        isLeaf: parsed.data.isLeaf,
        isActive: parsed.data.isActive ?? true,
      },
    });

    return { status: "success" as const, message: "Criterion created.", criterion };
  } catch (error) {
    return {
      status: "error" as const,
      message: error instanceof Error ? error.message : "Failed to create criterion.",
    };
  }
}

async function listCriteriaTree(versionId: string) {
  const criteria = await prisma.accreditationCriterion.findMany({
    where: { versionId },
    orderBy: [{ depth: "asc" }, { sortOrder: "asc" }, { criterionCode: "asc" }],
  });

  return buildCriterionTree(
    criteria.map((criterion) => ({
      id: criterion.id,
      parentId: criterion.parentId,
      criterionCode: criterion.criterionCode,
      title: criterion.title,
      description: criterion.description,
      dataType: criterion.dataType,
      maxScore: criterion.maxScore,
      sortOrder: criterion.sortOrder,
      depth: criterion.depth,
      unitOfMeasure: criterion.unitOfMeasure,
      validationRules: criterion.validationRules as Prisma.JsonValue | null,
      expectedEvidence: criterion.expectedEvidence as Prisma.JsonValue | null,
      isLeaf: criterion.isLeaf,
      isActive: criterion.isActive,
    })),
  );
}

export async function listSuperadminVersionCriteria(versionId: string) {
  const version = await prisma.accreditationBodyVersion.findFirst({
    where: { id: versionId, body: { scope: AccreditationScope.GLOBAL } },
  });
  if (!version) {
    return { status: "error" as const, message: "Version not found." };
  }
  return { status: "success" as const, criteria: await listCriteriaTree(versionId) };
}

export async function listTenantVersionCriteria(tenantId: string, versionId: string) {
  const serviceError = await ensureTenantAccreditationReadAccess(tenantId);
  if (serviceError) {
    return { status: "error" as const, message: serviceError };
  }

  const version = await getAccessibleVersionForTenant(tenantId, versionId);
  if (!version) {
    return { status: "error" as const, message: "Version not found." };
  }
  return { status: "success" as const, criteria: await listCriteriaTree(versionId) };
}

export async function createSuperadminVersionCriterion(versionId: string, input: unknown) {
  const version = await prisma.accreditationBodyVersion.findFirst({
    where: { id: versionId, body: { scope: AccreditationScope.GLOBAL } },
  });
  if (!version) {
    return { status: "error" as const, message: "Version not found." };
  }
  return createCriterion(versionId, input);
}

export async function createTenantVersionCriterion(
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

  const version = await getEditableVersionForTenant(tenantId, versionId);
  if (!version) {
    return { status: "error" as const, message: "Version not found." };
  }
  return createCriterion(versionId, input);
}

async function updateCriterion(criterionId: string, input: unknown) {
  const parsed = criterionInputSchema.partial().safeParse(input);
  if (!parsed.success) {
    return { status: "error" as const, message: parsed.error.issues[0]?.message ?? "Invalid criterion input." };
  }

  const existing = await prisma.accreditationCriterion.findUnique({
    where: { id: criterionId },
    select: { id: true, versionId: true },
  });
  if (!existing) {
    return { status: "error" as const, message: "Criterion not found." };
  }

  let topology:
    | ReturnType<typeof buildCriterionTopology>
    | undefined;
  if (parsed.data.parentId !== undefined || parsed.data.isLeaf === true) {
    const versionCriteria = await prisma.accreditationCriterion.findMany({
      where: { versionId: existing.versionId },
      select: {
        id: true,
        parentId: true,
        isLeaf: true,
      },
    });
    topology = buildCriterionTopology(versionCriteria);
  }

  if (parsed.data.isLeaf === true) {
    const childCount = topology?.childrenByParent.get(criterionId)?.length ?? 0;
    if (childCount > 0) {
      return { status: "error" as const, message: "Criteria with child nodes cannot be marked as leaf criteria." };
    }
  }

  let depth: number | undefined;
  let descendantDepthUpdates: Array<{ id: string; depth: number }> = [];
  if (parsed.data.parentId !== undefined) {
    if (!topology) {
      return { status: "error" as const, message: "Unable to validate the accreditation criteria hierarchy." };
    }

    if (parsed.data.parentId === criterionId) {
      return { status: "error" as const, message: "A criterion cannot be its own parent." };
    }

    const subtree = collectCriterionRelativeDepths(criterionId, topology);
    if ("error" in subtree) {
      return { status: "error" as const, message: subtree.error };
    }

    if (parsed.data.parentId) {
      const parent = topology.byId.get(parsed.data.parentId);
      if (!parent) {
        return { status: "error" as const, message: "Parent criterion was not found in the selected version." };
      }
      if (parent.isLeaf) {
        return { status: "error" as const, message: "Leaf criteria cannot have child criteria." };
      }
      if (subtree.relativeDepths.has(parsed.data.parentId)) {
        return { status: "error" as const, message: "A criterion cannot be moved under one of its descendants." };
      }

      const parentDepth = resolveCriterionActualDepth(parent.id, topology);
      if (parentDepth === null) {
        return { status: "error" as const, message: "The accreditation criteria tree is inconsistent. Please fix the existing hierarchy first." };
      }
      depth = parentDepth + 1;
    } else {
      depth = 0;
    }

    if (depth + subtree.maxRelativeDepth > MAX_CRITERION_DEPTH) {
      return { status: "error" as const, message: "Accreditation criteria support a maximum depth of 3 levels." };
    }

    if (depth === undefined) {
      return { status: "error" as const, message: "Unable to calculate the criterion depth for this move." };
    }

    const nextDepth = depth;
    descendantDepthUpdates = [...subtree.relativeDepths.entries()]
      .filter(([nodeId]) => nodeId !== criterionId)
      .map(([nodeId, relativeDepth]) => ({
        id: nodeId,
        depth: nextDepth + relativeDepth,
      }));
  }

  const updateData = {
    ...(parsed.data.parentId !== undefined ? { parentId: parsed.data.parentId ?? null } : {}),
    ...(parsed.data.criterionCode !== undefined ? { criterionCode: parsed.data.criterionCode.trim() } : {}),
    ...(parsed.data.title !== undefined ? { title: parsed.data.title.trim() } : {}),
    ...(parsed.data.description !== undefined ? { description: normalizeNullableString(parsed.data.description) } : {}),
    ...(parsed.data.dataType !== undefined ? { dataType: parsed.data.dataType } : {}),
    ...(parsed.data.maxScore !== undefined ? { maxScore: parsed.data.maxScore ?? null } : {}),
    ...(parsed.data.sortOrder !== undefined ? { sortOrder: parsed.data.sortOrder } : {}),
    ...(depth !== undefined ? { depth } : {}),
    ...(parsed.data.unitOfMeasure !== undefined ? { unitOfMeasure: normalizeNullableString(parsed.data.unitOfMeasure) } : {}),
    ...(parsed.data.validationRules !== undefined ? { validationRules: parsed.data.validationRules as Prisma.InputJsonValue } : {}),
    ...(parsed.data.expectedEvidence !== undefined ? { expectedEvidence: parsed.data.expectedEvidence as Prisma.InputJsonValue } : {}),
    ...(parsed.data.isLeaf !== undefined ? { isLeaf: parsed.data.isLeaf } : {}),
    ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
  } satisfies Prisma.AccreditationCriterionUpdateInput;

  try {
    const criterion =
      parsed.data.parentId !== undefined
        ? await prisma.$transaction(async (tx) => {
            const updatedCriterion = await tx.accreditationCriterion.update({
              where: { id: criterionId },
              data: updateData,
            });

            for (const descendant of descendantDepthUpdates) {
              await tx.accreditationCriterion.update({
                where: { id: descendant.id },
                data: { depth: descendant.depth },
              });
            }

            return updatedCriterion;
          })
        : await prisma.accreditationCriterion.update({
            where: { id: criterionId },
            data: updateData,
          });

    return { status: "success" as const, message: "Criterion updated.", criterion };
  } catch (error) {
    if (isPrismaErrorWithCode(error, "P2002")) {
      return { status: "error" as const, message: "Criterion code already exists in this accreditation version." };
    }

    return {
      status: "error" as const,
      message: error instanceof Error ? error.message : "Failed to update criterion.",
    };
  }
}

export async function updateSuperadminCriterion(criterionId: string, input: unknown) {
  const criterion = await prisma.accreditationCriterion.findFirst({
    where: { id: criterionId, version: { body: { scope: AccreditationScope.GLOBAL } } },
    select: { id: true },
  });
  if (!criterion) {
    return { status: "error" as const, message: "Criterion not found." };
  }
  return updateCriterion(criterionId, input);
}

export async function updateTenantCriterion(
  tenantId: string,
  criterionId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role,
) {
  const permissionError = await ensureTenantAccreditationManagement(tenantId, actorUserId, actorRole);
  if (permissionError) {
    return { status: "error" as const, message: permissionError };
  }

  const criterion = await getEditableCriterionForTenant(tenantId, criterionId);
  if (!criterion) {
    return { status: "error" as const, message: "Criterion not found." };
  }
  return updateCriterion(criterionId, input);
}

export async function setTenantProfileWeights(
  tenantId: string,
  profileId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role,
) {
  const permissionError = await ensureTenantAccreditationManagement(tenantId, actorUserId, actorRole);
  if (permissionError) {
    return { status: "error" as const, message: permissionError };
  }

  const parsed = profileWeightsInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error" as const, message: parsed.error.issues[0]?.message ?? "Invalid weight overrides." };
  }

  const profile = await getEditableProfileForTenant(tenantId, profileId);
  if (!profile) {
    return { status: "error" as const, message: "Profile not found." };
  }

  const weightsError = await validateProfileWeightCriteria(profile.versionId, parsed.data.weights);
  if (weightsError) {
    return { status: "error" as const, message: weightsError };
  }

  await prisma.$transaction(async (tx) => {
    await tx.accreditationProfileWeight.deleteMany({ where: { profileId } });
    if (parsed.data.weights.length > 0) {
      await tx.accreditationProfileWeight.createMany({
        data: parsed.data.weights.map((weight) => ({
          profileId,
          criterionId: weight.criterionId,
          maxScore: weight.maxScore,
          weightPercent: weight.weightPercent ?? null,
        })),
      });
    }
  });

  return { status: "success" as const, message: "Profile weights updated." };
}

export async function listAccreditationLinksForKpi(tenantId: string, kpiId: string) {
  const serviceError = await ensureTenantAccreditationReadAccess(tenantId);
  if (serviceError) {
    return { status: "error" as const, message: serviceError };
  }

  const kpi = await prisma.kpiDefinition.findFirst({
    where: { id: kpiId, kraDefinition: { tenantId } },
    select: { id: true },
  });
  if (!kpi) {
    return { status: "error" as const, message: "KPI not found." };
  }

  const links = await prisma.kpiAccreditationCriterionLink.findMany({
    where: { tenantId, kpiDefinitionId: kpiId },
    include: {
      criterion: {
        include: {
          version: {
            include: {
              body: true,
            },
          },
        },
      },
    },
    orderBy: [{ criterion: { criterionCode: "asc" } }],
  });

  return {
    status: "success" as const,
    links: links.map((link) => ({
      id: link.id,
      notes: link.notes,
      criterionId: link.criterionId,
      criterionCode: link.criterion.criterionCode,
      criterionTitle: link.criterion.title,
      versionId: link.criterion.versionId,
      versionCode: link.criterion.version.versionCode,
      bodyId: link.criterion.version.bodyId,
      bodyCode: link.criterion.version.body.code,
      bodyName: link.criterion.version.body.name,
      scope: link.criterion.version.body.scope,
    })),
  };
}

export async function createAccreditationLink(
  tenantId: string,
  kpiId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role,
) {
  const permissionError = await ensureTenantAccreditationManagement(tenantId, actorUserId, actorRole);
  if (permissionError) {
    return { status: "error" as const, message: permissionError };
  }

  const parsed = accreditationLinkInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error" as const, message: parsed.error.issues[0]?.message ?? "Invalid KPI link input." };
  }

  const [kpi, criterion] = await Promise.all([
    prisma.kpiDefinition.findFirst({
      where: { id: kpiId, kraDefinition: { tenantId } },
      select: { id: true },
    }),
    prisma.accreditationCriterion.findFirst({
      where: {
        id: parsed.data.criterionId,
        isActive: true,
        isLeaf: true,
        version: {
          isActive: true,
          body: {
            isActive: true,
            OR: [
              { scope: AccreditationScope.GLOBAL, tenantId: null },
              { scope: AccreditationScope.TENANT, tenantId },
            ],
          },
        },
      },
      select: { id: true },
    }),
  ]);

  if (!kpi) {
    return { status: "error" as const, message: "KPI not found." };
  }
  if (!criterion) {
    return { status: "error" as const, message: "Criterion not found or cannot be linked." };
  }

  const existingLink = await prisma.kpiAccreditationCriterionLink.findFirst({
    where: {
      tenantId,
      kpiDefinitionId: kpiId,
      criterionId: parsed.data.criterionId,
    },
    select: { id: true },
  });
  if (existingLink) {
    return {
      status: "error" as const,
      message: "This KPI is already linked to the selected accreditation criterion.",
    };
  }

  try {
    const link = await prisma.kpiAccreditationCriterionLink.create({
      data: {
        tenantId,
        kpiDefinitionId: kpiId,
        criterionId: parsed.data.criterionId,
        notes: normalizeNullableString(parsed.data.notes),
        createdByUserId: actorUserId,
      },
    });

    return { status: "success" as const, message: "KPI accreditation link created.", link };
  } catch (error) {
    if (isPrismaErrorWithCode(error, "P2002")) {
      return {
        status: "error" as const,
        message: "This KPI is already linked to the selected accreditation criterion.",
      };
    }

    return {
      status: "error" as const,
      message: error instanceof Error ? error.message : "Failed to create KPI accreditation link.",
    };
  }
}

export async function deleteAccreditationLink(
  tenantId: string,
  linkId: string,
  actorUserId: string,
  actorRole: Role,
) {
  const permissionError = await ensureTenantAccreditationManagement(tenantId, actorUserId, actorRole);
  if (permissionError) {
    return { status: "error" as const, message: permissionError };
  }

  const link = await prisma.kpiAccreditationCriterionLink.findFirst({
    where: { id: linkId, tenantId },
    select: { id: true },
  });
  if (!link) {
    return { status: "error" as const, message: "KPI accreditation link not found." };
  }

  await prisma.kpiAccreditationCriterionLink.delete({ where: { id: linkId } });
  return { status: "success" as const, message: "KPI accreditation link removed." };
}

export async function listKpisForCriterion(tenantId: string, criterionId: string) {
  const serviceError = await ensureTenantAccreditationReadAccess(tenantId);
  if (serviceError) {
    return { status: "error" as const, message: serviceError };
  }

  const criterion = await prisma.accreditationCriterion.findFirst({
    where: {
      id: criterionId,
      version: {
        body: {
          OR: [
            { scope: AccreditationScope.GLOBAL, tenantId: null },
            { scope: AccreditationScope.TENANT, tenantId },
          ],
        },
      },
    },
    select: { id: true },
  });
  if (!criterion) {
    return { status: "error" as const, message: "Criterion not found." };
  }

  const links = await prisma.kpiAccreditationCriterionLink.findMany({
    where: { tenantId, criterionId },
    include: {
      kpiDefinition: {
        include: {
          kraDefinition: {
            include: {
              period: { select: { name: true } },
            },
          },
        },
      },
    },
    orderBy: [{ kpiDefinition: { title: "asc" } }],
  });

  return {
    status: "success" as const,
    kpis: links.map((link) => ({
      linkId: link.id,
      kpiId: link.kpiDefinitionId,
      title: link.kpiDefinition.title,
      kraTitle: link.kpiDefinition.kraDefinition.title,
      periodName: link.kpiDefinition.kraDefinition.period.name,
      notes: link.notes,
    })),
  };
}

export async function listTenantAccreditationKpiOptions(tenantId: string) {
  const serviceError = await ensureTenantAccreditationReadAccess(tenantId);
  if (serviceError) {
    return { status: "error" as const, message: serviceError };
  }

  const kpis = await prisma.kpiDefinition.findMany({
    where: { kraDefinition: { tenantId } },
    include: {
      kraDefinition: {
        include: {
          period: { select: { name: true } },
        },
      },
      _count: {
        select: {
          accreditationCriterionLinks: true,
        },
      },
    },
    orderBy: [{ title: "asc" }],
  });

  return {
    status: "success" as const,
    kpis: kpis.map((kpi) => ({
      id: kpi.id,
      title: kpi.title,
      kraTitle: kpi.kraDefinition.title,
      periodName: kpi.kraDefinition.period.name,
      accreditationLinkCount: kpi._count.accreditationCriterionLinks,
    })),
  };
}

export async function listSuperadminTenantsWithServiceStates() {
  const tenants = await prisma.tenant.findMany({
    include: {
      serviceEntitlements: true,
    },
    orderBy: [{ name: "asc" }],
  });

  return tenants.map((tenant) => ({
    id: tenant.id,
    name: tenant.name,
    code: tenant.code,
    subscriptionPlan: tenant.subscriptionPlan,
    lifecycleState: tenant.lifecycleState,
    entitlementState: tenant.entitlementState,
    services: tenant.serviceEntitlements.map((service) => ({
      serviceCode: service.serviceCode,
      status: service.status,
      enabledAt: service.enabledAt,
      disabledAt: service.disabledAt,
      notes: service.notes,
    })),
  }));
}

export function tenantRoleCanSeeAccreditation(role: Role) {
  return isAdminOrOwner(role) || role === "TENANT_USER";
}
