import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  createOrgUnit,
  createOrgUnitType,
  publishOrgStructure,
  validateOrgStructureDraft,
} from "@/lib/org-structure/service";
import {
  getDescendantUnitIds,
  getSubtreeUnitIds,
  getAncestorChain,
  getSiblingUnits,
  getPublishedVersionId,
} from "@/lib/org-structure/hierarchy-utils";
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

/**
 * Build a 3-level tree: ROOT → [DEPT_A, DEPT_B] → [TEAM_A1 under DEPT_A]
 */
async function create3LevelStructure(ctx: ActorContext) {
  await createOrgUnitType({
    ...ctx,
    values: { typeKey: "ROOT", displayLabel: "Root", internalCategory: "ORG_ROOT", allowRoot: true },
  });
  await createOrgUnitType({
    ...ctx,
    values: { typeKey: "DEPT", displayLabel: "Department", internalCategory: "DEPARTMENT_LIKE_UNIT", allowRoot: false },
  });
  await createOrgUnitType({
    ...ctx,
    values: { typeKey: "TEAM", displayLabel: "Team", internalCategory: "DEPARTMENT_LIKE_UNIT", allowRoot: false },
  });

  const draft = await prisma.orgStructureVersion.findFirst({
    where: { tenantId: ctx.tenantId, state: { in: ["DRAFT", "VALIDATED"] } },
    orderBy: { versionNumber: "desc" },
    include: { unitTypes: true },
  });

  const rootType = draft!.unitTypes.find((t) => t.typeKey === "ROOT")!;
  const deptType = draft!.unitTypes.find((t) => t.typeKey === "DEPT")!;
  const teamType = draft!.unitTypes.find((t) => t.typeKey === "TEAM")!;

  await createOrgUnit({ ...ctx, values: { typeId: rootType.id, code: "UNIV", name: "University" } });

  const draftUnits = await prisma.orgStructureVersion.findFirst({
    where: { tenantId: ctx.tenantId, state: { in: ["DRAFT", "VALIDATED"] } },
    orderBy: { versionNumber: "desc" },
    include: { units: true },
  });
  const rootUnit = draftUnits!.units.find((u) => u.code === "UNIV")!;

  await createOrgUnit({ ...ctx, values: { typeId: deptType.id, code: "DEPT_A", name: "Department A", parentId: rootUnit.id } });
  await createOrgUnit({ ...ctx, values: { typeId: deptType.id, code: "DEPT_B", name: "Department B", parentId: rootUnit.id } });

  const draftAfterDepts = await prisma.orgStructureVersion.findFirst({
    where: { tenantId: ctx.tenantId, state: { in: ["DRAFT", "VALIDATED"] } },
    orderBy: { versionNumber: "desc" },
    include: { units: true },
  });
  const deptA = draftAfterDepts!.units.find((u) => u.code === "DEPT_A")!;

  await createOrgUnit({ ...ctx, values: { typeId: teamType.id, code: "TEAM_A1", name: "Team A1", parentId: deptA.id } });

  const validation = await validateOrgStructureDraft(ctx.tenantId);
  expect(validation.errors).toHaveLength(0);
  const published = await publishOrgStructure(ctx);
  expect(published.status).toBe("success");

  const version = await prisma.orgStructureVersion.findFirst({
    where: { tenantId: ctx.tenantId, state: "PUBLISHED" },
    orderBy: { versionNumber: "desc" },
    include: { units: true },
  });

  return {
    versionId: version!.id,
    root: version!.units.find((u) => u.code === "UNIV")!,
    deptA: version!.units.find((u) => u.code === "DEPT_A")!,
    deptB: version!.units.find((u) => u.code === "DEPT_B")!,
    teamA1: version!.units.find((u) => u.code === "TEAM_A1")!,
  };
}

describe("hierarchy-utils", () => {
  describe("getPublishedVersionId", () => {
    it("returns null for tenant with no published version", async () => {
      await withIsolatedDb(async (tracker) => {
        const { context } = await setupActor(tracker);
        const versionId = await getPublishedVersionId(context.tenantId);
        expect(versionId).toBeNull();
      });
    });
  });

  describe("getDescendantUnitIds", () => {
    it("returns all descendants in a 3-level tree (includeRoot=true)", async () => {
      await withIsolatedDb(async (tracker) => {
        const { context } = await setupActor(tracker);
        const tree = await create3LevelStructure(context);

        const ids = await getDescendantUnitIds(context.tenantId, tree.root.id, true);
        expect(ids).toContain(tree.root.id);
        expect(ids).toContain(tree.deptA.id);
        expect(ids).toContain(tree.deptB.id);
        expect(ids).toContain(tree.teamA1.id);
        expect(ids).toHaveLength(4);
      });
    });

    it("excludes root when includeRoot=false", async () => {
      await withIsolatedDb(async (tracker) => {
        const { context } = await setupActor(tracker);
        const tree = await create3LevelStructure(context);

        const ids = await getDescendantUnitIds(context.tenantId, tree.root.id, false);
        expect(ids).not.toContain(tree.root.id);
        expect(ids).toContain(tree.deptA.id);
        expect(ids).toContain(tree.deptB.id);
        expect(ids).toContain(tree.teamA1.id);
        expect(ids).toHaveLength(3);
      });
    });

    it("returns only the node when querying a leaf unit", async () => {
      await withIsolatedDb(async (tracker) => {
        const { context } = await setupActor(tracker);
        const tree = await create3LevelStructure(context);

        const ids = await getDescendantUnitIds(context.tenantId, tree.teamA1.id, true);
        expect(ids).toEqual([tree.teamA1.id]);
      });
    });

    it("returns DEPT_A subtree correctly (2 nodes)", async () => {
      await withIsolatedDb(async (tracker) => {
        const { context } = await setupActor(tracker);
        const tree = await create3LevelStructure(context);

        const ids = await getDescendantUnitIds(context.tenantId, tree.deptA.id, true);
        expect(ids).toContain(tree.deptA.id);
        expect(ids).toContain(tree.teamA1.id);
        expect(ids).toHaveLength(2);
      });
    });
  });

  describe("getSubtreeUnitIds", () => {
    it("returns union of descendants across 2 separate roots, deduplicated", async () => {
      await withIsolatedDb(async (tracker) => {
        const { context } = await setupActor(tracker);
        const tree = await create3LevelStructure(context);

        const ids = await getSubtreeUnitIds(context.tenantId, [tree.deptA.id, tree.deptB.id]);
        expect(ids).toContain(tree.deptA.id);
        expect(ids).toContain(tree.deptB.id);
        expect(ids).toContain(tree.teamA1.id);
        expect(new Set(ids).size).toBe(ids.length);
      });
    });
  });

  describe("getAncestorChain", () => {
    it("returns root-to-leaf order for a leaf unit", async () => {
      await withIsolatedDb(async (tracker) => {
        const { context } = await setupActor(tracker);
        const tree = await create3LevelStructure(context);

        const chain = await getAncestorChain(context.tenantId, tree.teamA1.id);
        expect(chain).toHaveLength(3);
        expect(chain[0].id).toBe(tree.root.id);
        expect(chain[1].id).toBe(tree.deptA.id);
        expect(chain[2].id).toBe(tree.teamA1.id);
        expect(chain[0].level).toBe(0);
        expect(chain[2].level).toBe(2);
      });
    });

    it("returns single element for root unit", async () => {
      await withIsolatedDb(async (tracker) => {
        const { context } = await setupActor(tracker);
        const tree = await create3LevelStructure(context);

        const chain = await getAncestorChain(context.tenantId, tree.root.id);
        expect(chain).toHaveLength(1);
        expect(chain[0].id).toBe(tree.root.id);
      });
    });
  });

  describe("getSiblingUnits", () => {
    it("returns sibling units excluding the queried unit", async () => {
      await withIsolatedDb(async (tracker) => {
        const { context } = await setupActor(tracker);
        const tree = await create3LevelStructure(context);

        const siblings = await getSiblingUnits(context.tenantId, tree.deptA.id);
        expect(siblings).toHaveLength(1);
        expect(siblings[0].id).toBe(tree.deptB.id);
      });
    });

    it("returns empty for root unit (no siblings)", async () => {
      await withIsolatedDb(async (tracker) => {
        const { context } = await setupActor(tracker);
        const tree = await create3LevelStructure(context);

        const siblings = await getSiblingUnits(context.tenantId, tree.root.id);
        expect(siblings).toHaveLength(0);
      });
    });

    it("returns empty for a leaf with no siblings", async () => {
      await withIsolatedDb(async (tracker) => {
        const { context } = await setupActor(tracker);
        const tree = await create3LevelStructure(context);

        const siblings = await getSiblingUnits(context.tenantId, tree.teamA1.id);
        expect(siblings).toHaveLength(0);
      });
    });
  });
});
