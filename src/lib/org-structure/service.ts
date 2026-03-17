import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import type {
  OrgStructureState,
  OrgUnitCategory,
  OrgUnitState,
  Role,
} from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { OrgStructureActionResult } from "@/lib/org-structure/shared";

const orgUnitCategories = [
  "ORG_ROOT",
  "CAMPUS",
  "SCHOOL_LIKE_UNIT",
  "DEPARTMENT_LIKE_UNIT",
  "CENTER",
  "LAB",
  "OFFICE",
  "DIVISION",
  "PROGRAM",
  "ADMINISTRATIVE_UNIT",
  "BUSINESS_UNIT",
  "FUNCTION",
  "TEAM",
  "REGION",
  "BRANCH",
  "SITE",
  "PROJECT_UNIT",
  "CUSTOM_UNIT",
] as const satisfies readonly OrgUnitCategory[];

const structureDraftStates = [
  "DRAFT",
  "VALIDATED",
] as const satisfies readonly OrgStructureState[];

const structureDraftState = "DRAFT" satisfies OrgStructureState;
const structureValidatedState = "VALIDATED" satisfies OrgStructureState;
const structurePublishedState = "PUBLISHED" satisfies OrgStructureState;
const structureSupersededState = "SUPERSEDED" satisfies OrgStructureState;
const structureArchivedState = "ARCHIVED" satisfies OrgStructureState;
const unitDraftState = "DRAFT" satisfies OrgUnitState;
const tenantOwnerRole = "TENANT_OWNER" satisfies Role;
const tenantAdminRole = "TENANT_ADMIN" satisfies Role;

const unitTypeSchema = z.object({
  typeKey: z
    .string()
    .trim()
    .min(2)
    .regex(/^[A-Z0-9_]+$/),
  displayLabel: z.string().trim().min(2),
  internalCategory: z.enum(orgUnitCategories),
  allowRoot: z.boolean(),
});

const unitSchema = z.object({
  typeId: z.string().trim().min(1),
  code: z
    .string()
    .trim()
    .min(2)
    .regex(/^[A-Z0-9_-]+$/),
  name: z.string().trim().min(2),
  parentId: z.string().trim().optional(),
});

export type CreateOrgUnitTypeInput = z.input<typeof unitTypeSchema>;
export type CreateOrgUnitInput = z.input<typeof unitSchema>;

type StructureVersionWithCounts = {
  id: string;
  name: string;
  versionNumber: number;
  state: OrgStructureState;
  validatedAt: Date | null;
  publishedAt: Date | null;
  unitTypeCount: number;
  unitCount: number;
};

type UnitTypeView = {
  id: string;
  typeKey: string;
  displayLabel: string;
  internalCategory: OrgUnitCategory;
  allowRoot: boolean;
};

type UnitView = {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  level: number;
  path: string | null;
  state: OrgUnitState;
  typeLabel: string;
  typeKey: string;
};

export type OrgStructureSnapshot = {
  draft: StructureVersionWithCounts | null;
  published: StructureVersionWithCounts | null;
  draftUnitTypes: UnitTypeView[];
  draftUnits: UnitView[];
  publishedUnitTypes: UnitTypeView[];
  publishedUnits: UnitView[];
};

export type VersionHistoryEntry = {
  id: string;
  name: string;
  versionNumber: number;
  state: OrgStructureState;
  publishedAt: Date | null;
  createdAt: Date;
  unitTypeCount: number;
  unitCount: number;
};

export type OrgStructureDraftContext = {
  draft: StructureVersionWithCounts | null;
  unitTypes: Array<{
    id: string;
    typeKey: string;
    displayLabel: string;
    allowRoot: boolean;
  }>;
  units: Array<{
    id: string;
    code: string;
    name: string;
    parentId: string | null;
    level: number;
    path: string | null;
  }>;
};

export async function getOrgStructureSnapshot(
  tenantId: string,
): Promise<OrgStructureSnapshot> {
  const [draftVersion, publishedVersion] = await Promise.all([
    prisma.orgStructureVersion.findFirst({
      where: {
        tenantId,
        state: {
          in: [...structureDraftStates],
        },
      },
      orderBy: {
        versionNumber: "desc",
      },
      include: {
        _count: {
          select: {
            unitTypes: true,
            units: true,
          },
        },
        unitTypes: {
          orderBy: [
            { sortOrder: "asc" },
            { displayLabel: "asc" },
          ],
        },
        units: {
          include: {
            type: true,
          },
          orderBy: [
            { level: "asc" },
            { sortOrder: "asc" },
            { name: "asc" },
          ],
        },
      },
    }),
    prisma.orgStructureVersion.findFirst({
      where: {
        tenantId,
        state: structurePublishedState,
      },
      orderBy: {
        versionNumber: "desc",
      },
      include: {
        _count: {
          select: {
            unitTypes: true,
            units: true,
          },
        },
        unitTypes: {
          orderBy: [
            { sortOrder: "asc" },
            { displayLabel: "asc" },
          ],
        },
        units: {
          include: { type: true },
          orderBy: [
            { level: "asc" },
            { sortOrder: "asc" },
            { name: "asc" },
          ],
        },
      },
    }),
  ]);

  const mapUnitTypes = (types: typeof draftVersion extends null ? never : NonNullable<typeof draftVersion>["unitTypes"]): UnitTypeView[] =>
    types.map((type) => ({
      id: type.id,
      typeKey: type.typeKey,
      displayLabel: type.displayLabel,
      internalCategory: type.internalCategory,
      allowRoot: type.allowRoot,
    }));

  const mapUnits = (units: typeof draftVersion extends null ? never : NonNullable<typeof draftVersion>["units"]): UnitView[] =>
    units.map((unit) => ({
      id: unit.id,
      code: unit.code,
      name: unit.name,
      parentId: unit.parentId,
      level: unit.level,
      path: unit.path,
      state: unit.state,
      typeLabel: unit.type.displayLabel,
      typeKey: unit.type.typeKey,
    }));

  return {
    draft: draftVersion ? mapVersionWithCounts(draftVersion) : null,
    published: publishedVersion ? mapVersionWithCounts(publishedVersion) : null,
    draftUnitTypes: draftVersion?.unitTypes ? mapUnitTypes(draftVersion.unitTypes) : [],
    draftUnits: draftVersion?.units ? mapUnits(draftVersion.units) : [],
    publishedUnitTypes: publishedVersion?.unitTypes ? mapUnitTypes(publishedVersion.unitTypes) : [],
    publishedUnits: publishedVersion?.units ? mapUnits(publishedVersion.units) : [],
  };
}

export async function getOrgStructureDraftContext(
  tenantId: string,
): Promise<OrgStructureDraftContext> {
  const draft = await prisma.orgStructureVersion.findFirst({
    where: {
      tenantId,
      state: {
        in: [...structureDraftStates],
      },
    },
    orderBy: {
      versionNumber: "desc",
    },
    include: {
      _count: {
        select: {
          unitTypes: true,
          units: true,
        },
      },
      unitTypes: {
        orderBy: [
          { sortOrder: "asc" },
          { displayLabel: "asc" },
        ],
      },
      units: {
        orderBy: [
          { level: "asc" },
          { sortOrder: "asc" },
          { name: "asc" },
        ],
      },
    },
  });

  return {
    draft: draft ? mapVersionWithCounts(draft) : null,
    unitTypes:
      draft?.unitTypes.map((type) => ({
        id: type.id,
        typeKey: type.typeKey,
        displayLabel: type.displayLabel,
        allowRoot: type.allowRoot,
      })) ?? [],
    units:
      draft?.units.map((unit) => ({
        id: unit.id,
        code: unit.code,
        name: unit.name,
        parentId: unit.parentId,
        level: unit.level,
        path: unit.path,
      })) ?? [],
  };
}

export async function createOrgUnitType(input: {
  tenantId: string;
  actorUserId: string;
  actorRole: Role;
  values: CreateOrgUnitTypeInput;
}): Promise<OrgStructureActionResult> {
  if (!canManageStructure(input.actorRole)) {
    return {
      status: "error",
      message: "You do not have permission to manage organization structure.",
    };
  }

  const parsedValues = unitTypeSchema.safeParse(input.values);

  if (!parsedValues.success) {
    return {
      status: "error",
      message:
        parsedValues.error.issues[0]?.message ?? "Unit type details are invalid.",
    };
  }

  const values = parsedValues.data;

  const draft = await ensureDraftVersion({
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
  });

  const existingType = await prisma.orgUnitType.findUnique({
    where: {
      versionId_typeKey: {
        versionId: draft.id,
        typeKey: values.typeKey.trim().toUpperCase(),
      },
    },
  });

  if (existingType) {
    return {
      status: "error",
      message: "Type key already exists in the draft.",
    };
  }

  if (values.allowRoot) {
    const existingRootType = await prisma.orgUnitType.findFirst({
      where: {
        versionId: draft.id,
        allowRoot: true,
      },
    });

    if (existingRootType) {
      return {
        status: "error",
        message: "Only one root-capable unit type is allowed in the first version.",
      };
    }
  }

  const nextSortOrder = await prisma.orgUnitType.count({
    where: { versionId: draft.id },
  });

  await prisma.orgUnitType.create({
    data: {
      versionId: draft.id,
      typeKey: values.typeKey.trim().toUpperCase(),
      displayLabel: values.displayLabel.trim(),
      internalCategory: values.internalCategory,
      allowRoot: values.allowRoot,
      sortOrder: nextSortOrder,
    },
  });

  await prisma.orgStructureVersion.update({
    where: { id: draft.id },
      data: {
        state: structureDraftState,
        validatedAt: null,
        validationSummary: Prisma.JsonNull,
      },
    });

  return {
    status: "success",
    message: "Unit type created.",
  };
}

export async function createOrgUnit(input: {
  tenantId: string;
  actorUserId: string;
  actorRole: Role;
  values: CreateOrgUnitInput;
}): Promise<OrgStructureActionResult> {
  if (!canManageStructure(input.actorRole)) {
    return {
      status: "error",
      message: "You do not have permission to manage organization structure.",
    };
  }

  const parsedValues = unitSchema.safeParse(input.values);

  if (!parsedValues.success) {
    return {
      status: "error",
      message:
        parsedValues.error.issues[0]?.message ?? "Unit details are invalid.",
    };
  }

  const values = parsedValues.data;
  const draft = await ensureDraftVersion({
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
  });

  const type = await prisma.orgUnitType.findFirst({
    where: {
      id: values.typeId,
      versionId: draft.id,
    },
  });

  if (!type) {
    return {
      status: "error",
      message: "Select a valid unit type.",
    };
  }

  const normalizedCode = values.code.trim().toUpperCase();

  const existingUnit = await prisma.orgUnit.findUnique({
    where: {
      versionId_code: {
        versionId: draft.id,
        code: normalizedCode,
      },
    },
  });

  if (existingUnit) {
    return {
      status: "error",
      message: "Unit code already exists in the draft.",
    };
  }

  let parent:
    | {
        id: string;
        level: number;
        path: string | null;
      }
    | null = null;

  if (values.parentId) {
    parent = await prisma.orgUnit.findFirst({
      where: {
        id: values.parentId,
        versionId: draft.id,
      },
      select: {
        id: true,
        level: true,
        path: true,
      },
    });

    if (!parent) {
      return {
        status: "error",
        message: "Select a valid parent unit.",
      };
    }
  } else {
    const existingRoot = await prisma.orgUnit.findFirst({
      where: {
        versionId: draft.id,
        parentId: null,
      },
    });

    if (existingRoot) {
      return {
        status: "error",
        message: "Only one root unit is allowed.",
      };
    }

    if (!type.allowRoot) {
      return {
        status: "error",
        message: "The selected type cannot be used as the root unit.",
      };
    }
  }

  const nextSortOrder = await prisma.orgUnit.count({
    where: {
      versionId: draft.id,
      parentId: parent?.id ?? null,
    },
  });

  await prisma.orgUnit.create({
    data: {
      tenantId: input.tenantId,
      versionId: draft.id,
      typeId: type.id,
      code: normalizedCode,
      name: values.name.trim(),
      parentId: parent?.id ?? null,
      level: parent ? parent.level + 1 : 0,
      sortOrder: nextSortOrder,
      path: parent?.path ? `${parent.path}/${normalizedCode}` : normalizedCode,
      state: unitDraftState,
      createdByUserId: input.actorUserId,
    },
  });

  await prisma.orgStructureVersion.update({
    where: { id: draft.id },
      data: {
        state: structureDraftState,
        validatedAt: null,
        validationSummary: Prisma.JsonNull,
      },
    });

  return {
    status: "success",
    message: "Unit created.",
  };
}

export async function deleteOrgUnit(input: {
  tenantId: string;
  actorUserId: string;
  actorRole: Role;
  unitId: string;
}): Promise<OrgStructureActionResult> {
  if (!canManageStructure(input.actorRole)) {
    return {
      status: "error",
      message: "You do not have permission to manage organization structure.",
    };
  }

  const activeDraft = await prisma.orgStructureVersion.findFirst({
    where: {
      tenantId: input.tenantId,
      state: { in: [...structureDraftStates] },
    },
    orderBy: { versionNumber: "desc" },
  });

  if (!activeDraft) {
    return { status: "error", message: "No active draft found." };
  }

  const unit = await prisma.orgUnit.findFirst({
    where: {
      id: input.unitId,
      versionId: activeDraft.id,
      tenantId: input.tenantId,
    },
  });

  if (!unit) {
    return { status: "error", message: "Unit not found in the draft." };
  }

  // Collect all descendant IDs via breadth-first traversal
  const toDelete: string[] = [unit.id];
  const queue = [unit.id];

  while (queue.length > 0) {
    const parentId = queue.shift()!;
    const children = await prisma.orgUnit.findMany({
      where: { versionId: activeDraft.id, parentId },
      select: { id: true },
    });
    for (const child of children) {
      toDelete.push(child.id);
      queue.push(child.id);
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.orgUnit.deleteMany({
      where: { id: { in: toDelete } },
    });

    await tx.orgStructureVersion.update({
      where: { id: activeDraft.id },
      data: {
        state: structureDraftState,
        validatedAt: null,
        validationSummary: Prisma.JsonNull,
      },
    });

    await tx.auditLog.create({
      data: {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        targetType: "OrgUnit",
        targetId: unit.id,
        action: "org_unit.deleted",
        previousState: {
          name: unit.name,
          code: unit.code,
          descendantsDeleted: toDelete.length - 1,
        },
      },
    });
  });

  return {
    status: "success",
    message:
      toDelete.length > 1
        ? `Deleted "${unit.name}" and ${toDelete.length - 1} descendant(s).`
        : `Deleted "${unit.name}".`,
  };
}

export async function publishOrgStructure(input: {
  tenantId: string;
  actorUserId: string;
  actorRole: Role;
}): Promise<OrgStructureActionResult> {
  if (!canManageStructure(input.actorRole)) {
    return {
      status: "error",
      message: "You do not have permission to publish organization structure.",
    };
  }

  const activeDraft = await prisma.orgStructureVersion.findFirst({
    where: {
      tenantId: input.tenantId,
      state: {
        in: [...structureDraftStates],
      },
    },
    orderBy: {
      versionNumber: "desc",
    },
    include: {
      unitTypes: true,
      units: true,
    },
  });

  if (!activeDraft) {
    return {
      status: "error",
      message: "There is no active draft to publish.",
    };
  }

  const validation = validateDraft(activeDraft);

  if (validation.errors.length) {
    await prisma.orgStructureVersion.update({
      where: { id: activeDraft.id },
      data: {
        state: structureDraftState,
        validatedAt: null,
        validationSummary: {
          errors: validation.errors,
          warnings: validation.warnings,
        },
      },
    });

    return {
      status: "error",
      message: validation.errors[0],
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.orgStructureVersion.updateMany({
      where: {
        tenantId: input.tenantId,
        state: structurePublishedState,
      },
      data: {
        state: structureSupersededState,
      },
    });

    await tx.orgStructureVersion.update({
      where: { id: activeDraft.id },
      data: {
        state: structurePublishedState,
        validatedAt: new Date(),
        publishedAt: new Date(),
        validationSummary: {
          errors: [],
          warnings: validation.warnings,
        },
      },
    });

    await tx.auditLog.create({
      data: {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        targetType: "OrgStructureVersion",
        targetId: activeDraft.id,
        action: "org_structure.published",
        newState: {
          versionNumber: activeDraft.versionNumber,
          unitTypes: activeDraft.unitTypes.length,
          units: activeDraft.units.length,
        },
        metadata: {
          warnings: validation.warnings,
        },
      },
    });
  });

  return {
    status: "success",
    message: "Structure published.",
  };
}

export async function discardOrgStructureDraft(input: {
  tenantId: string;
  actorUserId: string;
  actorRole: Role;
}): Promise<OrgStructureActionResult> {
  if (!canManageStructure(input.actorRole)) {
    return {
      status: "error",
      message: "You do not have permission to manage organization structure.",
    };
  }

  const activeDraft = await prisma.orgStructureVersion.findFirst({
    where: {
      tenantId: input.tenantId,
      state: {
        in: [...structureDraftStates],
      },
    },
    orderBy: {
      versionNumber: "desc",
    },
    include: {
      unitTypes: true,
      units: true,
    },
  });

  if (!activeDraft) {
    return {
      status: "error",
      message: "There is no active draft to discard.",
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.orgStructureVersion.update({
      where: { id: activeDraft.id },
      data: {
        state: structureArchivedState,
        validatedAt: null,
        validationSummary: Prisma.JsonNull,
      },
    });

    await tx.auditLog.create({
      data: {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        targetType: "OrgStructureVersion",
        targetId: activeDraft.id,
        action: "org_structure.discarded",
        previousState: {
          state: activeDraft.state,
          versionNumber: activeDraft.versionNumber,
        },
        newState: {
          state: structureArchivedState,
          versionNumber: activeDraft.versionNumber,
          unitTypes: activeDraft.unitTypes.length,
          units: activeDraft.units.length,
        },
      },
    });
  });

  return {
    status: "success",
    message: "Draft discarded.",
  };
}

export async function validateOrgStructureDraft(
  tenantId: string,
): Promise<{ errors: string[]; warnings: string[] }> {
  const activeDraft = await prisma.orgStructureVersion.findFirst({
    where: {
      tenantId,
      state: {
        in: [...structureDraftStates],
      },
    },
    orderBy: {
      versionNumber: "desc",
    },
    include: {
      unitTypes: true,
      units: true,
    },
  });

  if (!activeDraft) {
    return {
      errors: ["No active draft found."],
      warnings: [],
    };
  }

  const validation = validateDraft(activeDraft);

  await prisma.orgStructureVersion.update({
    where: { id: activeDraft.id },
    data: {
      state: validation.errors.length
        ? structureDraftState
        : structureValidatedState,
      validatedAt: validation.errors.length ? null : new Date(),
      validationSummary: {
        errors: validation.errors,
        warnings: validation.warnings,
      },
    },
  });

  return validation;
}

const draftTransactionRetries = 3;

function isRetryableDraftError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P2034" || error.code === "P2002";
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("could not serialize") || message.includes("deadlock detected")
    );
  }

  return false;
}

async function runDraftTransaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < draftTransactionRetries; attempt += 1) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (isRetryableDraftError(error) && attempt < draftTransactionRetries - 1) {
        continue;
      }

      throw error;
    }
  }

  throw new Error("Failed to ensure a draft version after retrying.");
}

async function ensureDraftVersion(input: {
  tenantId: string;
  actorUserId: string;
}) {
  return runDraftTransaction(async (tx) => {
    const existingDraft = await tx.orgStructureVersion.findFirst({
      where: {
        tenantId: input.tenantId,
        state: {
          in: [...structureDraftStates],
        },
      },
      orderBy: {
        versionNumber: "desc",
      },
    });

    if (existingDraft) {
      return existingDraft;
    }

    const latestVersion = await tx.orgStructureVersion.findFirst({
      where: { tenantId: input.tenantId },
      orderBy: {
        versionNumber: "desc",
      },
      include: {
        unitTypes: {
          orderBy: [
            { sortOrder: "asc" },
            { displayLabel: "asc" },
          ],
        },
        units: {
          orderBy: [
            { level: "asc" },
            { sortOrder: "asc" },
            { name: "asc" },
          ],
        },
      },
    });

    const nextVersionNumber = (latestVersion?.versionNumber ?? 0) + 1;

    const draft = await tx.orgStructureVersion.create({
      data: {
        tenantId: input.tenantId,
        name: `Draft ${nextVersionNumber}`,
        versionNumber: nextVersionNumber,
        state: structureDraftState,
        createdByUserId: input.actorUserId,
      },
    });

    if (!latestVersion) {
      return draft;
    }

    const typeIdMap = new Map<string, string>();
    const unitTypeData = latestVersion.unitTypes.map((type) => {
      const id = randomUUID();
      typeIdMap.set(type.id, id);

      return {
        id,
        versionId: draft.id,
        typeKey: type.typeKey,
        internalCategory: type.internalCategory,
        displayLabel: type.displayLabel,
        description: type.description,
        allowRoot: type.allowRoot,
        sortOrder: type.sortOrder,
      };
    });

    if (unitTypeData.length) {
      await tx.orgUnitType.createMany({
        data: unitTypeData,
      });
    }

    const unitIdMap = new Map<string, string>();
    for (const unit of latestVersion.units) {
      unitIdMap.set(unit.id, randomUUID());
    }

    const unitData = latestVersion.units.map((unit) => ({
      id: unitIdMap.get(unit.id)!,
      tenantId: input.tenantId,
      versionId: draft.id,
      typeId: typeIdMap.get(unit.typeId) ?? unit.typeId,
      code: unit.code,
      name: unit.name,
      parentId: unit.parentId ? unitIdMap.get(unit.parentId) ?? null : null,
      level: unit.level,
      sortOrder: unit.sortOrder,
      path: unit.path,
      state: unitDraftState as OrgUnitState,
      metadata: unit.metadata as Prisma.InputJsonValue | undefined,
      effectiveFrom: unit.effectiveFrom,
      effectiveTo: unit.effectiveTo,
      createdByUserId: input.actorUserId,
    }));

    if (unitData.length) {
      await tx.orgUnit.createMany({
        data: unitData,
      });
    }

    return draft;
  });
}

function validateDraft(draft: {
  unitTypes: Array<{
    id: string;
    allowRoot: boolean;
  }>;
  units: Array<{
    id: string;
    parentId: string | null;
    typeId: string;
  }>;
}) {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!draft.unitTypes.length) {
    errors.push("Add at least one unit type before publishing.");
  }

  if (!draft.units.length) {
    errors.push("Add at least one unit before publishing.");
  }

  const rootUnits = draft.units.filter((unit) => !unit.parentId);

  if (draft.units.length && rootUnits.length !== 1) {
    errors.push("Exactly one root unit is required.");
  }

  if (rootUnits.length === 1) {
    const rootType = draft.unitTypes.find((type) => type.id === rootUnits[0].typeId);

    if (!rootType?.allowRoot) {
      errors.push("The root unit must use a root-capable unit type.");
    }
  }

  const nonRootCount = draft.units.filter((unit) => unit.parentId).length;

  if (nonRootCount === 0 && draft.units.length === 1) {
    warnings.push("The structure currently contains only the root unit.");
  }

  return {
    errors,
    warnings,
  };
}

function canManageStructure(role: Role) {
  return role === tenantOwnerRole || role === tenantAdminRole;
}

// ── Edit unit ─────────────────────────────────────────────────────────────

const updateUnitSchema = z.object({
  name: z.string().trim().min(2).optional(),
  code: z
    .string()
    .trim()
    .min(2)
    .regex(/^[A-Z0-9_-]+$/)
    .optional(),
  typeId: z.string().trim().min(1).optional(),
  parentId: z.string().trim().nullable().optional(),
});

export type UpdateOrgUnitInput = z.input<typeof updateUnitSchema>;

export async function updateOrgUnit(input: {
  tenantId: string;
  actorUserId: string;
  actorRole: Role;
  unitId: string;
  values: UpdateOrgUnitInput;
}): Promise<OrgStructureActionResult> {
  if (!canManageStructure(input.actorRole)) {
    return {
      status: "error",
      message: "You do not have permission to manage organization structure.",
    };
  }

  const parsedValues = updateUnitSchema.safeParse(input.values);
  if (!parsedValues.success) {
    return {
      status: "error",
      message:
        parsedValues.error.issues[0]?.message ?? "Invalid update values.",
    };
  }

  const values = parsedValues.data;

  const activeDraft = await prisma.orgStructureVersion.findFirst({
    where: {
      tenantId: input.tenantId,
      state: { in: [...structureDraftStates] },
    },
    orderBy: { versionNumber: "desc" },
  });

  if (!activeDraft) {
    return { status: "error", message: "No active draft found." };
  }

  const unit = await prisma.orgUnit.findFirst({
    where: {
      id: input.unitId,
      versionId: activeDraft.id,
      tenantId: input.tenantId,
    },
  });

  if (!unit) {
    return { status: "error", message: "Unit not found in the draft." };
  }

  const previousState = { name: unit.name, code: unit.code, typeId: unit.typeId, parentId: unit.parentId };

  // Check code uniqueness if changing
  if (values.code && values.code !== unit.code) {
    const existing = await prisma.orgUnit.findUnique({
      where: {
        versionId_code: {
          versionId: activeDraft.id,
          code: values.code.toUpperCase(),
        },
      },
    });
    if (existing) {
      return { status: "error", message: "Unit code already exists in the draft." };
    }
  }

  // Check type exists if changing
  if (values.typeId && values.typeId !== unit.typeId) {
    const type = await prisma.orgUnitType.findFirst({
      where: { id: values.typeId, versionId: activeDraft.id },
    });
    if (!type) {
      return { status: "error", message: "Invalid unit type." };
    }
  }

  // Check parent validity if changing
  if (values.parentId !== undefined && values.parentId !== unit.parentId) {
    if (values.parentId) {
      // Prevent circular: can't be own descendant
      const ancestors = new Set<string>();
      let current = values.parentId;
      while (current) {
        if (current === input.unitId) {
          return { status: "error", message: "Cannot move a unit under its own descendant." };
        }
        ancestors.add(current);
        const parentUnit = await prisma.orgUnit.findFirst({
          where: { id: current, versionId: activeDraft.id },
          select: { parentId: true },
        });
        current = parentUnit?.parentId ?? "";
        if (!current || ancestors.has(current)) break;
      }
    }
  }

  const newCode = values.code?.toUpperCase() ?? unit.code;

  // Compute new level and path
  let newLevel = unit.level;
  let newPath = unit.path;
  if (values.parentId !== undefined && values.parentId !== unit.parentId) {
    if (values.parentId) {
      const newParent = await prisma.orgUnit.findFirst({
        where: { id: values.parentId, versionId: activeDraft.id },
        select: { level: true, path: true },
      });
      newLevel = (newParent?.level ?? 0) + 1;
      newPath = newParent?.path ? `${newParent.path}/${newCode}` : newCode;
    } else {
      newLevel = 0;
      newPath = newCode;
    }
  } else if (values.code && values.code !== unit.code) {
    // Code changed but parent didn't - update path suffix
    const parts = (unit.path ?? "").split("/");
    parts[parts.length - 1] = newCode;
    newPath = parts.join("/");
  }

  await prisma.$transaction(async (tx) => {
    await tx.orgUnit.update({
      where: { id: input.unitId },
      data: {
        ...(values.name ? { name: values.name.trim() } : {}),
        ...(values.code ? { code: newCode } : {}),
        ...(values.typeId ? { typeId: values.typeId } : {}),
        ...(values.parentId !== undefined ? { parentId: values.parentId } : {}),
        level: newLevel,
        path: newPath,
      },
    });

    // Reset draft validation
    await tx.orgStructureVersion.update({
      where: { id: activeDraft.id },
      data: {
        state: structureDraftState,
        validatedAt: null,
        validationSummary: Prisma.JsonNull,
      },
    });

    await tx.auditLog.create({
      data: {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        targetType: "OrgUnit",
        targetId: input.unitId,
        action: "org_unit.updated",
        previousState,
        newState: { name: values.name ?? unit.name, code: newCode, typeId: values.typeId ?? unit.typeId },
      },
    });
  });

  return { status: "success", message: "Unit updated." };
}

// ── Toggle unit active/inactive ───────────────────────────────────────────

export async function toggleOrgUnitState(input: {
  tenantId: string;
  actorUserId: string;
  actorRole: Role;
  unitId: string;
  targetState: "ACTIVE" | "INACTIVE";
}): Promise<OrgStructureActionResult> {
  if (!canManageStructure(input.actorRole)) {
    return {
      status: "error",
      message: "You do not have permission to manage organization structure.",
    };
  }

  const activeDraft = await prisma.orgStructureVersion.findFirst({
    where: {
      tenantId: input.tenantId,
      state: { in: [...structureDraftStates] },
    },
    orderBy: { versionNumber: "desc" },
  });

  if (!activeDraft) {
    return { status: "error", message: "No active draft found." };
  }

  const unit = await prisma.orgUnit.findFirst({
    where: {
      id: input.unitId,
      versionId: activeDraft.id,
      tenantId: input.tenantId,
    },
  });

  if (!unit) {
    return { status: "error", message: "Unit not found in the draft." };
  }

  const newState = input.targetState as OrgUnitState;

  // If deactivating, also deactivate descendants
  const idsToUpdate = [unit.id];
  if (input.targetState === "INACTIVE") {
    const queue = [unit.id];
    while (queue.length > 0) {
      const parentId = queue.shift()!;
      const children = await prisma.orgUnit.findMany({
        where: { versionId: activeDraft.id, parentId },
        select: { id: true },
      });
      for (const child of children) {
        idsToUpdate.push(child.id);
        queue.push(child.id);
      }
    }
  }

  // If reactivating, ensure parent is active
  if (input.targetState === "ACTIVE" && unit.parentId) {
    const parent = await prisma.orgUnit.findFirst({
      where: { id: unit.parentId, versionId: activeDraft.id },
      select: { state: true },
    });
    if (parent?.state === "INACTIVE") {
      return {
        status: "error",
        message: "Cannot reactivate a unit whose parent is deactivated. Reactivate the parent first.",
      };
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.orgUnit.updateMany({
      where: { id: { in: idsToUpdate } },
      data: { state: newState },
    });

    await tx.orgStructureVersion.update({
      where: { id: activeDraft.id },
      data: {
        state: structureDraftState,
        validatedAt: null,
        validationSummary: Prisma.JsonNull,
      },
    });

    await tx.auditLog.create({
      data: {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        targetType: "OrgUnit",
        targetId: input.unitId,
        action: `org_unit.${input.targetState === "INACTIVE" ? "deactivated" : "reactivated"}`,
        newState: {
          state: newState,
          affectedUnits: idsToUpdate.length,
        },
      },
    });
  });

  const verb = input.targetState === "INACTIVE" ? "deactivated" : "reactivated";
  return {
    status: "success",
    message:
      idsToUpdate.length > 1
        ? `"${unit.name}" ${verb} along with ${idsToUpdate.length - 1} descendant(s).`
        : `"${unit.name}" ${verb}.`,
  };
}

// ── Version history ───────────────────────────────────────────────────────

export async function getVersionHistory(
  tenantId: string,
): Promise<VersionHistoryEntry[]> {
  const versions = await prisma.orgStructureVersion.findMany({
    where: { tenantId },
    orderBy: { versionNumber: "desc" },
    include: {
      _count: {
        select: { unitTypes: true, units: true },
      },
    },
  });

  return versions.map((v) => ({
    id: v.id,
    name: v.name,
    versionNumber: v.versionNumber,
    state: v.state,
    publishedAt: v.publishedAt,
    createdAt: v.createdAt,
    unitTypeCount: v._count.unitTypes,
    unitCount: v._count.units,
  }));
}

// ── Get specific version detail ───────────────────────────────────────────

export async function getVersionDetail(
  tenantId: string,
  versionId: string,
): Promise<{
  version: StructureVersionWithCounts;
  unitTypes: UnitTypeView[];
  units: UnitView[];
} | null> {
  const v = await prisma.orgStructureVersion.findFirst({
    where: { id: versionId, tenantId },
    include: {
      _count: { select: { unitTypes: true, units: true } },
      unitTypes: { orderBy: [{ sortOrder: "asc" }, { displayLabel: "asc" }] },
      units: {
        include: { type: true },
        orderBy: [{ level: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      },
    },
  });

  if (!v) return null;

  return {
    version: mapVersionWithCounts(v),
    unitTypes: v.unitTypes.map((t) => ({
      id: t.id,
      typeKey: t.typeKey,
      displayLabel: t.displayLabel,
      internalCategory: t.internalCategory,
      allowRoot: t.allowRoot,
    })),
    units: v.units.map((u) => ({
      id: u.id,
      code: u.code,
      name: u.name,
      parentId: u.parentId,
      level: u.level,
      path: u.path,
      state: u.state,
      typeLabel: u.type.displayLabel,
      typeKey: u.type.typeKey,
    })),
  };
}

// ── Bulk create units from CSV upload ─────────────────────────────────────

export async function bulkCreateUnits(input: {
  tenantId: string;
  actorUserId: string;
  actorRole: Role;
  rows: Array<{
    typeKey: string;
    code: string;
    name: string;
    parentCode: string | null;
  }>;
}): Promise<OrgStructureActionResult> {
  if (!canManageStructure(input.actorRole)) {
    return {
      status: "error",
      message: "You do not have permission to manage organization structure.",
    };
  }

  if (input.rows.length === 0) {
    return { status: "error", message: "No rows to import." };
  }

  const draft = await ensureDraftVersion({
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
  });

  // Load existing unit types for the draft
  const existingTypes = await prisma.orgUnitType.findMany({
    where: { versionId: draft.id },
  });
  const typeMap = new Map(existingTypes.map((t) => [t.typeKey, t.id]));

  // Topologically sort: parents before children
  const codeToRow = new Map(input.rows.map((r) => [r.code, r]));
  const sorted: typeof input.rows = [];
  const visited = new Set<string>();

  function visit(code: string) {
    if (visited.has(code)) return;
    visited.add(code);
    const row = codeToRow.get(code);
    if (!row) return;
    if (row.parentCode && codeToRow.has(row.parentCode)) {
      visit(row.parentCode);
    }
    sorted.push(row);
  }

  for (const row of input.rows) visit(row.code);

  // Check for missing types
  for (const row of sorted) {
    if (!typeMap.has(row.typeKey)) {
      return {
        status: "error",
        message: `Unit type "${row.typeKey}" does not exist. Create it first or check the type_key column.`,
      };
    }
  }

  // Create all units in order
  const codeToId = new Map<string, string>();

  // Also load existing units so we can reference existing parents
  const existingUnits = await prisma.orgUnit.findMany({
    where: { versionId: draft.id },
    select: { id: true, code: true, level: true, path: true },
  });
  for (const u of existingUnits) {
    codeToId.set(u.code, u.id);
  }

  let created = 0;
  let skipped = 0;

  for (const row of sorted) {
    const code = row.code.toUpperCase();

    // Skip if already exists
    if (codeToId.has(code)) {
      skipped++;
      continue;
    }

    const parentId = row.parentCode ? codeToId.get(row.parentCode.toUpperCase()) ?? null : null;

    // Determine level and path
    let level = 0;
    let path = code;
    if (parentId) {
      const parentUnit = existingUnits.find((u) => u.id === parentId) ?? null;
      if (parentUnit) {
        level = parentUnit.level + 1;
        path = parentUnit.path ? `${parentUnit.path}/${code}` : code;
      } else {
        // Parent was just created in this batch - look at sorted data
        const parentRow = codeToRow.get(row.parentCode?.toUpperCase() ?? "");
        // Simple level calculation from traversal
        let l = 0;
        let p: string | null = row.parentCode?.toUpperCase() ?? null;
        while (p) {
          l++;
          const pr = codeToRow.get(p);
          p = pr?.parentCode?.toUpperCase() ?? null;
        }
        level = l;
        path = code; // simplified
      }
    }

    const newUnit = await prisma.orgUnit.create({
      data: {
        tenantId: input.tenantId,
        versionId: draft.id,
        typeId: typeMap.get(row.typeKey)!,
        code,
        name: row.name.trim(),
        parentId,
        level,
        path,
        state: unitDraftState,
        createdByUserId: input.actorUserId,
      },
    });

    codeToId.set(code, newUnit.id);
    existingUnits.push({ id: newUnit.id, code, level, path });
    created++;
  }

  // Reset validation
  await prisma.orgStructureVersion.update({
    where: { id: draft.id },
    data: {
      state: structureDraftState,
      validatedAt: null,
      validationSummary: Prisma.JsonNull,
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      targetType: "OrgStructureVersion",
      targetId: draft.id,
      action: "org_structure.bulk_import",
      newState: { created, skipped, totalRows: input.rows.length },
    },
  });

  return {
    status: "success",
    message: `Imported ${created} unit(s)${skipped ? `, ${skipped} skipped (already exist)` : ""}.`,
  };
}

function mapVersionWithCounts(version: {
  id: string;
  name: string;
  versionNumber: number;
  state: OrgStructureState;
  validatedAt: Date | null;
  publishedAt: Date | null;
  _count: {
    unitTypes: number;
    units: number;
  };
}) {
  return {
    id: version.id,
    name: version.name,
    versionNumber: version.versionNumber,
    state: version.state,
    validatedAt: version.validatedAt,
    publishedAt: version.publishedAt,
    unitTypeCount: version._count.unitTypes,
    unitCount: version._count.units,
  } satisfies StructureVersionWithCounts;
}
