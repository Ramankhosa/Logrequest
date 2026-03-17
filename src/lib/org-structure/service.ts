import { Prisma } from "@prisma/client";
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

export type OrgStructureSnapshot = {
  draft: StructureVersionWithCounts | null;
  published: StructureVersionWithCounts | null;
  draftUnitTypes: Array<{
    id: string;
    typeKey: string;
    displayLabel: string;
    internalCategory: OrgUnitCategory;
    allowRoot: boolean;
  }>;
  draftUnits: Array<{
    id: string;
    code: string;
    name: string;
    parentId: string | null;
    level: number;
    path: string | null;
    state: OrgUnitState;
    typeLabel: string;
    typeKey: string;
  }>;
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
      },
    }),
  ]);

  return {
    draft: draftVersion ? mapVersionWithCounts(draftVersion) : null,
    published: publishedVersion ? mapVersionWithCounts(publishedVersion) : null,
    draftUnitTypes:
      draftVersion?.unitTypes.map((type) => ({
        id: type.id,
        typeKey: type.typeKey,
        displayLabel: type.displayLabel,
        internalCategory: type.internalCategory,
        allowRoot: type.allowRoot,
      })) ?? [],
    draftUnits:
      draftVersion?.units.map((unit) => ({
        id: unit.id,
        code: unit.code,
        name: unit.name,
        parentId: unit.parentId,
        level: unit.level,
        path: unit.path,
        state: unit.state,
        typeLabel: unit.type.displayLabel,
        typeKey: unit.type.typeKey,
      })) ?? [],
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

async function ensureDraftVersion(input: {
  tenantId: string;
  actorUserId: string;
}) {
  const existingDraft = await prisma.orgStructureVersion.findFirst({
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

  const latestVersion = await prisma.orgStructureVersion.findFirst({
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

  const draft = await prisma.orgStructureVersion.create({
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

  const typeMap = new Map<string, string>();

  for (const type of latestVersion.unitTypes) {
    const createdType = await prisma.orgUnitType.create({
      data: {
        versionId: draft.id,
        typeKey: type.typeKey,
        internalCategory: type.internalCategory,
        displayLabel: type.displayLabel,
        description: type.description,
        allowRoot: type.allowRoot,
        sortOrder: type.sortOrder,
      },
    });

    typeMap.set(type.id, createdType.id);
  }

  const unitMap = new Map<string, string>();

  for (const unit of latestVersion.units) {
    const createdUnit = await prisma.orgUnit.create({
      data: {
        tenantId: input.tenantId,
        versionId: draft.id,
        typeId: typeMap.get(unit.typeId) ?? unit.typeId,
        code: unit.code,
        name: unit.name,
        parentId: unit.parentId ? unitMap.get(unit.parentId) ?? null : null,
        level: unit.level,
        sortOrder: unit.sortOrder,
        path: unit.path,
        state: unitDraftState,
        metadata: unit.metadata as Prisma.InputJsonValue | undefined,
        effectiveFrom: unit.effectiveFrom,
        effectiveTo: unit.effectiveTo,
        createdByUserId: input.actorUserId,
      },
    });

    unitMap.set(unit.id, createdUnit.id);
  }

  return draft;
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
