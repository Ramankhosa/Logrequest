import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  bulkCreateUnits,
  createOrgUnit,
  createOrgUnitType,
  deleteOrgUnit,
  discardOrgStructureDraft,
  getOrgStructureSnapshot,
  getVersionDetail,
  getVersionHistory,
  publishOrgStructure,
  toggleOrgUnitState,
  updateOrgUnit,
  validateOrgStructureDraft,
} from "@/lib/org-structure/service";
import {
  cleanupTrackedData,
  createTenantActor,
  newDbTracker,
  type DbTracker,
} from "../helpers/db";

type ActorContext = {
  tenantId: string;
  actorUserId: string;
  actorRole: Role;
};

async function withIsolatedDb(run: (tracker: DbTracker) => Promise<void>) {
  const tracker = newDbTracker();
  try {
    await run(tracker);
  } finally {
    await cleanupTrackedData(tracker);
  }
}

async function setupActor(tracker: DbTracker, role: Role = "TENANT_OWNER") {
  const { tenant, actor } = await createTenantActor(tracker, role);
  return {
    tenant,
    actor,
    context: {
      tenantId: tenant.id,
      actorUserId: actor.id,
      actorRole: role,
    } satisfies ActorContext,
  };
}

async function getActiveDraft(tenantId: string) {
  return prisma.orgStructureVersion.findFirst({
    where: {
      tenantId,
      state: {
        in: ["DRAFT", "VALIDATED"],
      },
    },
    orderBy: {
      versionNumber: "desc",
    },
    include: {
      unitTypes: {
        orderBy: {
          sortOrder: "asc",
        },
      },
      units: {
        orderBy: {
          level: "asc",
        },
      },
    },
  });
}

async function createBaseDraftStructure(ctx: ActorContext) {
  await createOrgUnitType({
    ...ctx,
    values: {
      typeKey: "ROOT",
      displayLabel: "Root Unit",
      internalCategory: "ORG_ROOT",
      allowRoot: true,
    },
  });
  await createOrgUnitType({
    ...ctx,
    values: {
      typeKey: "DEPT",
      displayLabel: "Department",
      internalCategory: "DEPARTMENT_LIKE_UNIT",
      allowRoot: false,
    },
  });

  let draft = await getActiveDraft(ctx.tenantId);
  expect(draft).not.toBeNull();

  const rootType = draft?.unitTypes.find((t) => t.typeKey === "ROOT");
  const deptType = draft?.unitTypes.find((t) => t.typeKey === "DEPT");
  expect(rootType).toBeTruthy();
  expect(deptType).toBeTruthy();

  await createOrgUnit({
    ...ctx,
    values: {
      typeId: rootType!.id,
      code: "UNIV",
      name: "University",
    },
  });

  draft = await getActiveDraft(ctx.tenantId);
  const rootUnit = draft?.units.find((u) => u.code === "UNIV");
  expect(rootUnit).toBeTruthy();

  await createOrgUnit({
    ...ctx,
    values: {
      typeId: deptType!.id,
      code: "CSE",
      name: "Computer Science",
      parentId: rootUnit!.id,
    },
  });

  draft = await getActiveDraft(ctx.tenantId);
  const childUnit = draft?.units.find((u) => u.code === "CSE");
  expect(childUnit).toBeTruthy();

  return {
    draft: draft!,
    rootTypeId: rootType!.id,
    deptTypeId: deptType!.id,
    rootUnitId: rootUnit!.id,
    childUnitId: childUnit!.id,
  };
}

describe("Org Structure Service Integration - Unit Types and Units", () => {
  test("1.1 creates a unit type with valid data", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context, tenant } = await setupActor(tracker);
      const result = await createOrgUnitType({
        ...context,
        values: {
          typeKey: "ROOT",
          displayLabel: "University Root",
          internalCategory: "ORG_ROOT",
          allowRoot: true,
        },
      });

      expect(result.status).toBe("success");
      const type = await prisma.orgUnitType.findFirst({
        where: { version: { tenantId: tenant.id }, typeKey: "ROOT" },
      });
      expect(type).toBeTruthy();
    });
  });

  test("1.2 blocks duplicate typeKey in same draft", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      await createOrgUnitType({
        ...context,
        values: {
          typeKey: "ROOT",
          displayLabel: "Root",
          internalCategory: "ORG_ROOT",
          allowRoot: true,
        },
      });

      const second = await createOrgUnitType({
        ...context,
        values: {
          typeKey: "ROOT",
          displayLabel: "Root Duplicate",
          internalCategory: "ORG_ROOT",
          allowRoot: false,
        },
      });

      expect(second.status).toBe("error");
      expect(second.message).toContain("Type key already exists");
    });
  });

  test("1.4 rejects invalid typeKey format", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      const result = await createOrgUnitType({
        ...context,
        values: {
          typeKey: "root key",
          displayLabel: "Invalid",
          internalCategory: "ORG_ROOT",
          allowRoot: true,
        },
      });

      expect(result.status).toBe("error");
    });
  });

  test("1.3 blocks creating a second root-capable unit type", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      await createOrgUnitType({
        ...context,
        values: {
          typeKey: "ROOT",
          displayLabel: "Root",
          internalCategory: "ORG_ROOT",
          allowRoot: true,
        },
      });

      const second = await createOrgUnitType({
        ...context,
        values: {
          typeKey: "ROOT2",
          displayLabel: "Another Root",
          internalCategory: "ORG_ROOT",
          allowRoot: true,
        },
      });
      expect(second.status).toBe("error");
      expect(second.message).toContain("Only one root-capable");
    });
  });

  test("1.5 denies non-admin role for unit type creation", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker, "TENANT_USER");
      const result = await createOrgUnitType({
        ...context,
        values: {
          typeKey: "ROOT",
          displayLabel: "Root",
          internalCategory: "ORG_ROOT",
          allowRoot: true,
        },
      });

      expect(result.status).toBe("error");
      expect(result.message).toContain("permission");
    });
  });

  test("1.6 creating a type resets validated draft back to DRAFT", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      await createBaseDraftStructure(context);

      const validation = await validateOrgStructureDraft(context.tenantId);
      expect(validation.errors).toHaveLength(0);

      let draft = await getActiveDraft(context.tenantId);
      expect(draft?.state).toBe("VALIDATED");
      expect(draft?.validatedAt).not.toBeNull();

      await createOrgUnitType({
        ...context,
        values: {
          typeKey: "LAB",
          displayLabel: "Lab",
          internalCategory: "LAB",
          allowRoot: false,
        },
      });

      draft = await getActiveDraft(context.tenantId);
      expect(draft?.state).toBe("DRAFT");
      expect(draft?.validatedAt).toBeNull();
    });
  });

  test("2.1 creates a root unit at level 0", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      await createOrgUnitType({
        ...context,
        values: {
          typeKey: "ROOT",
          displayLabel: "Root",
          internalCategory: "ORG_ROOT",
          allowRoot: true,
        },
      });

      const draft = await getActiveDraft(context.tenantId);
      const rootType = draft?.unitTypes.find((t) => t.typeKey === "ROOT");
      expect(rootType).toBeTruthy();

      const result = await createOrgUnit({
        ...context,
        values: {
          typeId: rootType!.id,
          code: "UNIV",
          name: "University",
        },
      });

      expect(result.status).toBe("success");
      const createdDraft = await getActiveDraft(context.tenantId);
      const root = createdDraft?.units.find((u) => u.code === "UNIV");
      expect(root?.level).toBe(0);
    });
  });

  test("2.2 blocks creating a second root unit", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      const base = await createBaseDraftStructure(context);

      const result = await createOrgUnit({
        ...context,
        values: {
          typeId: base.rootTypeId,
          code: "ROOT2",
          name: "Another Root",
        },
      });

      expect(result.status).toBe("error");
      expect(result.message).toContain("Only one root unit");
    });
  });

  test("2.3 blocks root unit creation with non-root-capable type", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      await createOrgUnitType({
        ...context,
        values: {
          typeKey: "DEPT",
          displayLabel: "Department",
          internalCategory: "DEPARTMENT_LIKE_UNIT",
          allowRoot: false,
        },
      });
      const draft = await getActiveDraft(context.tenantId);
      const deptType = draft?.unitTypes.find((t) => t.typeKey === "DEPT");
      expect(deptType).toBeTruthy();

      const result = await createOrgUnit({
        ...context,
        values: {
          typeId: deptType!.id,
          code: "DEPTROOT",
          name: "Invalid Root",
        },
      });

      expect(result.status).toBe("error");
      expect(result.message).toContain("cannot be used as the root");
    });
  });

  test("2.4 creates child unit with computed level and path", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      await createBaseDraftStructure(context);
      const draft = await getActiveDraft(context.tenantId);
      const child = draft?.units.find((u) => u.code === "CSE");
      expect(child?.level).toBe(1);
      expect(child?.path).toBe("UNIV/CSE");
    });
  });

  test("2.5 blocks duplicate unit code in same draft", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      const base = await createBaseDraftStructure(context);

      const result = await createOrgUnit({
        ...context,
        values: {
          typeId: base.deptTypeId,
          code: "CSE",
          name: "Duplicate CSE",
          parentId: base.rootUnitId,
        },
      });

      expect(result.status).toBe("error");
      expect(result.message).toContain("Unit code already exists");
    });
  });

  test("2.7 rejects invalid parentId", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      const base = await createBaseDraftStructure(context);

      const result = await createOrgUnit({
        ...context,
        values: {
          typeId: base.deptTypeId,
          code: "EEE",
          name: "Electrical",
          parentId: "non-existent-parent",
        },
      });

      expect(result.status).toBe("error");
      expect(result.message).toContain("valid parent");
    });
  });

  test("2.6 rejects invalid unit code format", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      await createOrgUnitType({
        ...context,
        values: {
          typeKey: "ROOT",
          displayLabel: "Root",
          internalCategory: "ORG_ROOT",
          allowRoot: true,
        },
      });
      const draft = await getActiveDraft(context.tenantId);
      const rootType = draft?.unitTypes.find((t) => t.typeKey === "ROOT");
      expect(rootType).toBeTruthy();

      const result = await createOrgUnit({
        ...context,
        values: {
          typeId: rootType!.id,
          code: "x",
          name: "Bad",
        },
      });
      expect(result.status).toBe("error");
    });
  });

  test("2.8 deletes a leaf unit", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      const base = await createBaseDraftStructure(context);

      const result = await deleteOrgUnit({
        ...context,
        unitId: base.childUnitId,
      });
      expect(result.status).toBe("success");

      const draft = await getActiveDraft(context.tenantId);
      expect(draft?.units.find((u) => u.id === base.childUnitId)).toBeFalsy();
      expect(draft?.units.find((u) => u.id === base.rootUnitId)).toBeTruthy();
    });
  });

  test("2.9 deletes a unit with descendants recursively", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      const base = await createBaseDraftStructure(context);

      const result = await deleteOrgUnit({
        ...context,
        unitId: base.rootUnitId,
      });
      expect(result.status).toBe("success");

      const draft = await getActiveDraft(context.tenantId);
      expect(draft?.units).toHaveLength(0);
    });
  });

  test("2.10 deleting the root cascades and removes all units", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      const base = await createBaseDraftStructure(context);
      await createOrgUnit({
        ...context,
        values: {
          typeId: base.deptTypeId,
          code: "AI",
          name: "AI Lab",
          parentId: base.childUnitId,
        },
      });

      const result = await deleteOrgUnit({
        ...context,
        unitId: base.rootUnitId,
      });
      expect(result.status).toBe("success");

      const remaining = await prisma.orgUnit.findMany({
        where: {
          version: { tenantId: context.tenantId, state: { in: ["DRAFT", "VALIDATED"] } },
        },
      });
      expect(remaining).toHaveLength(0);
    });
  });

  test("2.11 updates unit fields (name, code, typeId)", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      const base = await createBaseDraftStructure(context);
      await createOrgUnitType({
        ...context,
        values: {
          typeKey: "CENTER",
          displayLabel: "Center",
          internalCategory: "CENTER",
          allowRoot: false,
        },
      });

      const draft = await getActiveDraft(context.tenantId);
      const centerType = draft?.unitTypes.find((t) => t.typeKey === "CENTER");
      expect(centerType).toBeTruthy();

      const result = await updateOrgUnit({
        ...context,
        unitId: base.childUnitId,
        values: {
          name: "AI Center",
          code: "AIC",
          typeId: centerType!.id,
        },
      });

      expect(result.status).toBe("success");
      const updated = await prisma.orgUnit.findUnique({
        where: { id: base.childUnitId },
      });
      expect(updated?.name).toBe("AI Center");
      expect(updated?.code).toBe("AIC");
      expect(updated?.typeId).toBe(centerType!.id);
    });
  });

  test("2.12 rejects update when new code already exists", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      const base = await createBaseDraftStructure(context);
      await createOrgUnit({
        ...context,
        values: {
          typeId: base.deptTypeId,
          code: "EEE",
          name: "Electrical",
          parentId: base.rootUnitId,
        },
      });

      const eee = await prisma.orgUnit.findFirst({
        where: {
          version: { tenantId: context.tenantId, state: { in: ["DRAFT", "VALIDATED"] } },
          code: "EEE",
        },
      });
      expect(eee).toBeTruthy();

      const result = await updateOrgUnit({
        ...context,
        unitId: eee!.id,
        values: {
          code: "CSE",
        },
      });

      expect(result.status).toBe("error");
      expect(result.message).toContain("already exists");
    });
  });

  test("2.14 blocks moving a unit under its own descendant", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      const base = await createBaseDraftStructure(context);

      const result = await updateOrgUnit({
        ...context,
        unitId: base.rootUnitId,
        values: {
          parentId: base.childUnitId,
        },
      });

      expect(result.status).toBe("error");
      expect(result.message).toContain("own descendant");
    });
  });

  test("2.13 reparenting updates level and path", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      const base = await createBaseDraftStructure(context);
      await createOrgUnit({
        ...context,
        values: {
          typeId: base.deptTypeId,
          code: "EEE",
          name: "Electrical",
          parentId: base.rootUnitId,
        },
      });

      const draft = await getActiveDraft(context.tenantId);
      const eee = draft?.units.find((u) => u.code === "EEE");
      expect(eee).toBeTruthy();

      const result = await updateOrgUnit({
        ...context,
        unitId: eee!.id,
        values: {
          parentId: base.childUnitId,
        },
      });
      expect(result.status).toBe("success");

      const moved = await prisma.orgUnit.findUnique({ where: { id: eee!.id } });
      expect(moved?.level).toBe(2);
      expect(moved?.path).toBe("UNIV/CSE/EEE");
    });
  });

  test("2.15 deactivates a unit and its descendants", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      const base = await createBaseDraftStructure(context);

      const result = await toggleOrgUnitState({
        ...context,
        unitId: base.rootUnitId,
        targetState: "INACTIVE",
      });

      expect(result.status).toBe("success");

      const units = await prisma.orgUnit.findMany({
        where: {
          version: { tenantId: context.tenantId, state: { in: ["DRAFT", "VALIDATED"] } },
        },
      });
      expect(units.every((u) => u.state === "INACTIVE")).toBe(true);
    });
  });

  test("2.16 blocks reactivating child while parent is inactive", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      const base = await createBaseDraftStructure(context);
      await toggleOrgUnitState({
        ...context,
        unitId: base.rootUnitId,
        targetState: "INACTIVE",
      });

      const result = await toggleOrgUnitState({
        ...context,
        unitId: base.childUnitId,
        targetState: "ACTIVE",
      });

      expect(result.status).toBe("error");
      expect(result.message).toContain("Reactivate the parent first");
    });
  });

  test("2.17 allows reactivating child when parent is active", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      const base = await createBaseDraftStructure(context);

      await toggleOrgUnitState({
        ...context,
        unitId: base.childUnitId,
        targetState: "INACTIVE",
      });

      const result = await toggleOrgUnitState({
        ...context,
        unitId: base.childUnitId,
        targetState: "ACTIVE",
      });

      expect(result.status).toBe("success");
      const child = await prisma.orgUnit.findUnique({
        where: { id: base.childUnitId },
      });
      expect(child?.state).toBe("ACTIVE");
    });
  });

  test("2.18 unit mutations reset validated draft state to DRAFT", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      const base = await createBaseDraftStructure(context);
      await validateOrgStructureDraft(context.tenantId);
      let draft = await getActiveDraft(context.tenantId);
      expect(draft?.state).toBe("VALIDATED");

      await updateOrgUnit({
        ...context,
        unitId: base.childUnitId,
        values: { name: "Computer Engineering" },
      });
      draft = await getActiveDraft(context.tenantId);
      expect(draft?.state).toBe("DRAFT");

      await validateOrgStructureDraft(context.tenantId);
      await toggleOrgUnitState({
        ...context,
        unitId: base.childUnitId,
        targetState: "INACTIVE",
      });
      draft = await getActiveDraft(context.tenantId);
      expect(draft?.state).toBe("DRAFT");

      await validateOrgStructureDraft(context.tenantId);
      await deleteOrgUnit({
        ...context,
        unitId: base.childUnitId,
      });
      draft = await getActiveDraft(context.tenantId);
      expect(draft?.state).toBe("DRAFT");
      expect(draft?.validatedAt).toBeNull();
    });
  });
});

describe("Org Structure Service Integration - Versioning & Publishing", () => {
  test("3.1 validate draft with no unit types returns error", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      await prisma.orgStructureVersion.create({
        data: {
          tenantId: context.tenantId,
          name: "Draft 1",
          versionNumber: 1,
          state: "DRAFT",
          createdByUserId: context.actorUserId,
        },
      });
      const result = await validateOrgStructureDraft(context.tenantId);
      expect(result.errors[0]).toContain("Add at least one unit type");
    });
  });

  test("3.2 validate draft with types but no units returns error", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      await createOrgUnitType({
        ...context,
        values: {
          typeKey: "ROOT",
          displayLabel: "Root",
          internalCategory: "ORG_ROOT",
          allowRoot: true,
        },
      });

      const result = await validateOrgStructureDraft(context.tenantId);
      expect(result.errors[0]).toContain("Add at least one unit");
    });
  });

  test("3.3 validate valid draft sets state VALIDATED", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      await createBaseDraftStructure(context);

      const result = await validateOrgStructureDraft(context.tenantId);
      expect(result.errors).toHaveLength(0);

      const draft = await getActiveDraft(context.tenantId);
      expect(draft?.state).toBe("VALIDATED");
      expect(draft?.validatedAt).not.toBeNull();
    });
  });

  test("3.4 publish validated draft sets PUBLISHED and supersedes previous", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      await createBaseDraftStructure(context);
      await validateOrgStructureDraft(context.tenantId);
      const first = await publishOrgStructure(context);
      expect(first.status).toBe("success");

      await createOrgUnitType({
        ...context,
        values: {
          typeKey: "LAB",
          displayLabel: "Lab",
          internalCategory: "LAB",
          allowRoot: false,
        },
      });
      await validateOrgStructureDraft(context.tenantId);
      const second = await publishOrgStructure(context);
      expect(second.status).toBe("success");

      const versions = await prisma.orgStructureVersion.findMany({
        where: { tenantId: context.tenantId },
        orderBy: { versionNumber: "asc" },
      });
      expect(versions.filter((v) => v.state === "PUBLISHED")).toHaveLength(1);
      expect(versions.some((v) => v.state === "SUPERSEDED")).toBe(true);
    });
  });

  test("3.5 publish with validation errors fails", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      await createOrgUnitType({
        ...context,
        values: {
          typeKey: "ROOT",
          displayLabel: "Root",
          internalCategory: "ORG_ROOT",
          allowRoot: true,
        },
      });

      const result = await publishOrgStructure(context);
      expect(result.status).toBe("error");
      expect(result.message).toContain("Add at least one unit");
    });
  });

  test("3.6 discard active draft archives it", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      await createOrgUnitType({
        ...context,
        values: {
          typeKey: "ROOT",
          displayLabel: "Root",
          internalCategory: "ORG_ROOT",
          allowRoot: true,
        },
      });

      const result = await discardOrgStructureDraft(context);
      expect(result.status).toBe("success");

      const archived = await prisma.orgStructureVersion.findFirst({
        where: { tenantId: context.tenantId, state: "ARCHIVED" },
      });
      expect(archived).toBeTruthy();
    });
  });

  test("3.7 creating new draft after publish clones types and units with new IDs", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      const base = await createBaseDraftStructure(context);
      await validateOrgStructureDraft(context.tenantId);
      await publishOrgStructure(context);

      const published = await prisma.orgStructureVersion.findFirst({
        where: { tenantId: context.tenantId, state: "PUBLISHED" },
        include: { unitTypes: true, units: true },
      });
      expect(published).toBeTruthy();

      await createOrgUnitType({
        ...context,
        values: {
          typeKey: "OFFICE",
          displayLabel: "Office",
          internalCategory: "OFFICE",
          allowRoot: false,
        },
      });

      const draft = await getActiveDraft(context.tenantId);
      expect(draft).toBeTruthy();
      expect(draft?.versionNumber).toBe((published?.versionNumber ?? 0) + 1);

      const clonedRoot = draft?.units.find((u) => u.code === "UNIV");
      const publishedRoot = published?.units.find((u) => u.code === "UNIV");
      expect(clonedRoot).toBeTruthy();
      expect(publishedRoot).toBeTruthy();
      expect(clonedRoot?.id).not.toBe(publishedRoot?.id);
      expect(clonedRoot?.parentId).toBeNull();
      expect(base.rootUnitId).not.toBe(clonedRoot?.id);
    });
  });

  test("3.8 cloned units preserve parent-child relationships with remapped IDs", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      await createBaseDraftStructure(context);
      await validateOrgStructureDraft(context.tenantId);
      await publishOrgStructure(context);

      await createOrgUnitType({
        ...context,
        values: {
          typeKey: "OFFICE",
          displayLabel: "Office",
          internalCategory: "OFFICE",
          allowRoot: false,
        },
      });

      const published = await prisma.orgStructureVersion.findFirst({
        where: { tenantId: context.tenantId, state: "PUBLISHED" },
        include: { units: true },
      });
      const draft = await getActiveDraft(context.tenantId);
      expect(published).toBeTruthy();
      expect(draft).toBeTruthy();

      const publishedRoot = published!.units.find((u) => u.code === "UNIV");
      const publishedChild = published!.units.find((u) => u.code === "CSE");
      const draftRoot = draft!.units.find((u) => u.code === "UNIV");
      const draftChild = draft!.units.find((u) => u.code === "CSE");

      expect(publishedRoot).toBeTruthy();
      expect(publishedChild).toBeTruthy();
      expect(draftRoot).toBeTruthy();
      expect(draftChild).toBeTruthy();
      expect(draftChild?.parentId).toBe(draftRoot?.id);
      expect(draftRoot?.id).not.toBe(publishedRoot?.id);
      expect(draftChild?.id).not.toBe(publishedChild?.id);
    });
  });

  test("3.9 getVersionHistory returns versions ordered DESC", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      await createBaseDraftStructure(context);
      await validateOrgStructureDraft(context.tenantId);
      await publishOrgStructure(context);
      await createOrgUnitType({
        ...context,
        values: {
          typeKey: "LAB",
          displayLabel: "Lab",
          internalCategory: "LAB",
          allowRoot: false,
        },
      });

      const history = await getVersionHistory(context.tenantId);
      expect(history.length).toBeGreaterThan(1);
      for (let i = 1; i < history.length; i += 1) {
        expect(history[i - 1]!.versionNumber).toBeGreaterThanOrEqual(
          history[i]!.versionNumber,
        );
      }
    });
  });

  test("3.10 getVersionDetail returns version with unit types and units", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      await createBaseDraftStructure(context);
      await validateOrgStructureDraft(context.tenantId);
      await publishOrgStructure(context);

      const published = await prisma.orgStructureVersion.findFirst({
        where: { tenantId: context.tenantId, state: "PUBLISHED" },
      });
      expect(published).toBeTruthy();

      const detail = await getVersionDetail(context.tenantId, published!.id);
      expect(detail).toBeTruthy();
      expect(detail?.version.id).toBe(published!.id);
      expect(detail?.unitTypes.length).toBeGreaterThan(0);
      expect(detail?.units.length).toBeGreaterThan(0);
    });
  });

  test("3.11 get snapshot returns both draft and published sections", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      await createBaseDraftStructure(context);
      await validateOrgStructureDraft(context.tenantId);
      await publishOrgStructure(context);

      await createOrgUnitType({
        ...context,
        values: {
          typeKey: "LAB",
          displayLabel: "Lab",
          internalCategory: "LAB",
          allowRoot: false,
        },
      });

      const snapshot = await getOrgStructureSnapshot(context.tenantId);
      expect(snapshot.published).not.toBeNull();
      expect(snapshot.draft).not.toBeNull();
      expect(snapshot.publishedUnits.length).toBeGreaterThan(0);
      expect(snapshot.draftUnitTypes.length).toBeGreaterThan(0);
    });
  });
});

describe("Org Structure Service Integration - CSV Import (Service)", () => {
  test("4.10 bulkCreateUnits imports in topological order (parent before child)", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      await createOrgUnitType({
        ...context,
        values: {
          typeKey: "ROOT",
          displayLabel: "Root",
          internalCategory: "ORG_ROOT",
          allowRoot: true,
        },
      });
      await createOrgUnitType({
        ...context,
        values: {
          typeKey: "DEPT",
          displayLabel: "Department",
          internalCategory: "DEPARTMENT_LIKE_UNIT",
          allowRoot: false,
        },
      });

      const result = await bulkCreateUnits({
        ...context,
        rows: [
          { typeKey: "DEPT", code: "CSE", name: "Computer Science", parentCode: "UNIV" },
          { typeKey: "ROOT", code: "UNIV", name: "University", parentCode: null },
        ],
      });
      expect(result.status).toBe("success");

      const draft = await getActiveDraft(context.tenantId);
      const root = draft?.units.find((u) => u.code === "UNIV");
      const child = draft?.units.find((u) => u.code === "CSE");
      expect(root).toBeTruthy();
      expect(child).toBeTruthy();
      expect(child?.parentId).toBe(root?.id);
      expect(child?.level).toBe(1);
    });
  });

  test("4.11 bulkCreateUnits skips codes that already exist in draft", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      await createOrgUnitType({
        ...context,
        values: {
          typeKey: "ROOT",
          displayLabel: "Root",
          internalCategory: "ORG_ROOT",
          allowRoot: true,
        },
      });
      await createOrgUnitType({
        ...context,
        values: {
          typeKey: "DEPT",
          displayLabel: "Department",
          internalCategory: "DEPARTMENT_LIKE_UNIT",
          allowRoot: false,
        },
      });

      await bulkCreateUnits({
        ...context,
        rows: [{ typeKey: "ROOT", code: "UNIV", name: "University", parentCode: null }],
      });
      const second = await bulkCreateUnits({
        ...context,
        rows: [
          { typeKey: "ROOT", code: "UNIV", name: "University Duplicate", parentCode: null },
          { typeKey: "DEPT", code: "CSE", name: "Computer Science", parentCode: "UNIV" },
        ],
      });

      expect(second.status).toBe("success");
      expect(second.message).toContain("skipped");
      const draft = await getActiveDraft(context.tenantId);
      expect(draft?.units.filter((u) => u.code === "UNIV")).toHaveLength(1);
      expect(draft?.units.some((u) => u.code === "CSE")).toBe(true);
    });
  });
});
