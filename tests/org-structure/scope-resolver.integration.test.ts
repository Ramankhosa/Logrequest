import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  createOrgUnit,
  createOrgUnitType,
  publishOrgStructure,
  validateOrgStructureDraft,
} from "@/lib/org-structure/service";
import {
  assignRoleToUser,
  createRoleDefinition,
} from "@/lib/org-structure/roles-service";
import {
  resolveUserDashboardScope,
  resolveDashboardUnitSelection,
  DashboardUnitSelectionError,
  applyScopeFilter,
  type UserDashboardScope,
} from "@/lib/org-structure/scope-resolver";
import {
  cleanupTrackedData,
  createTenantActor,
  createTestMembership,
  createTestUser,
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

async function createPublishedStructure(ctx: ActorContext) {
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

  let draftUnits = await prisma.orgStructureVersion.findFirst({
    where: { tenantId: ctx.tenantId, state: { in: ["DRAFT", "VALIDATED"] } },
    orderBy: { versionNumber: "desc" },
    include: { units: true },
  });
  const rootUnit = draftUnits!.units.find((u) => u.code === "UNIV")!;

  await createOrgUnit({ ...ctx, values: { typeId: deptType.id, code: "CSE", name: "CS Department", parentId: rootUnit.id } });
  await createOrgUnit({ ...ctx, values: { typeId: deptType.id, code: "EEE", name: "EE Department", parentId: rootUnit.id } });

  draftUnits = await prisma.orgStructureVersion.findFirst({
    where: { tenantId: ctx.tenantId, state: { in: ["DRAFT", "VALIDATED"] } },
    orderBy: { versionNumber: "desc" },
    include: { units: true },
  });
  const cseUnit = draftUnits!.units.find((u) => u.code === "CSE")!;

  await createOrgUnit({ ...ctx, values: { typeId: teamType.id, code: "AI_TEAM", name: "AI Team", parentId: cseUnit.id } });

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
    cse: version!.units.find((u) => u.code === "CSE")!,
    eee: version!.units.find((u) => u.code === "EEE")!,
    aiTeam: version!.units.find((u) => u.code === "AI_TEAM")!,
  };
}

async function createRoleAndGetId(
  ctx: ActorContext,
  opts: { roleKey: string; displayLabel: string; isUnitHead: boolean; approvalAuthority: boolean },
): Promise<string> {
  await createRoleDefinition({
    ...ctx,
    values: {
      roleKey: opts.roleKey,
      displayLabel: opts.displayLabel,
      isUnitHead: opts.isUnitHead,
      approvalAuthority: opts.approvalAuthority,
    },
  });
  const def = await prisma.orgRoleDefinition.findFirst({
    where: { tenantId: ctx.tenantId, roleKey: opts.roleKey },
  });
  return def!.id;
}

describe("scope-resolver", () => {
  describe("resolveUserDashboardScope", () => {
    it("tenant admin → visibleUnitIds = ALL with root scope units", async () => {
      await withIsolatedDb(async (tracker) => {
        const { context } = await setupActor(tracker, "TENANT_ADMIN");
        await createPublishedStructure(context);

        const scope = await resolveUserDashboardScope(context.tenantId, context.actorUserId);
        expect(scope.isTenantAdmin).toBe(true);
        expect(scope.visibleUnitIds).toBe("ALL");
        expect(scope.rootScopeUnits.length).toBeGreaterThanOrEqual(1);
        expect(scope.rootScopeUnits.some((u) => u.unitCode === "UNIV")).toBe(true);
      });
    });

    it("unit head with scope=NODE → only that unit visible", async () => {
      await withIsolatedDb(async (tracker) => {
        const { context } = await setupActor(tracker, "TENANT_OWNER");
        const tree = await createPublishedStructure(context);

        const headUser = await createTestUser(tracker, { firstName: "Head", lastName: "CSE" });
        await createTestMembership({
          tenantId: context.tenantId,
          userId: headUser.id,
          role: "TENANT_USER",
          status: "ACTIVE",
          createdByUserId: context.actorUserId,
        });

        const roleDefId = await createRoleAndGetId(context, {
          roleKey: "DEPT_HEAD",
          displayLabel: "Department Head",
          isUnitHead: true,
          approvalAuthority: false,
        });

        await assignRoleToUser({
          ...context,
          values: { unitId: tree.cse.id, userId: headUser.id, roleDefinitionId: roleDefId, scope: "NODE" },
        });

        const scope = await resolveUserDashboardScope(context.tenantId, headUser.id);
        expect(scope.isTenantAdmin).toBe(false);
        expect(scope.headOfUnits).toHaveLength(1);
        expect(scope.headOfUnits[0].scope).toBe("NODE");
        expect(scope.visibleUnitIds).toContain(tree.cse.id);
        expect(scope.visibleUnitIds).not.toContain(tree.aiTeam.id);
      });
    });

    it("unit head with scope=DESCENDANTS → entire subtree visible", async () => {
      await withIsolatedDb(async (tracker) => {
        const { context } = await setupActor(tracker, "TENANT_OWNER");
        const tree = await createPublishedStructure(context);

        const headUser = await createTestUser(tracker, { firstName: "Head", lastName: "CSE" });
        await createTestMembership({
          tenantId: context.tenantId,
          userId: headUser.id,
          role: "TENANT_USER",
          status: "ACTIVE",
          createdByUserId: context.actorUserId,
        });

        const roleDefId = await createRoleAndGetId(context, {
          roleKey: "DEAN",
          displayLabel: "Dean",
          isUnitHead: true,
          approvalAuthority: true,
        });

        await assignRoleToUser({
          ...context,
          values: { unitId: tree.cse.id, userId: headUser.id, roleDefinitionId: roleDefId, scope: "DESCENDANTS" },
        });

        const scope = await resolveUserDashboardScope(context.tenantId, headUser.id);
        expect(scope.isTenantAdmin).toBe(false);
        expect(scope.headOfUnits[0].scope).toBe("DESCENDANTS");
        expect(scope.visibleUnitIds).toContain(tree.cse.id);
        expect(scope.visibleUnitIds).toContain(tree.aiTeam.id);
        expect(scope.hasApprovalAuthority).toBe(true);
      });
    });

    it("user heading 2 units → union of both scopes", async () => {
      await withIsolatedDb(async (tracker) => {
        const { context } = await setupActor(tracker, "TENANT_OWNER");
        const tree = await createPublishedStructure(context);

        const headUser = await createTestUser(tracker, { firstName: "Multi", lastName: "Head" });
        await createTestMembership({
          tenantId: context.tenantId,
          userId: headUser.id,
          role: "TENANT_USER",
          status: "ACTIVE",
          createdByUserId: context.actorUserId,
        });

        const roleDefId = await createRoleAndGetId(context, {
          roleKey: "HOD",
          displayLabel: "Head of Dept",
          isUnitHead: true,
          approvalAuthority: false,
        });

        await assignRoleToUser({
          ...context,
          values: { unitId: tree.cse.id, userId: headUser.id, roleDefinitionId: roleDefId, scope: "NODE" },
        });
        await assignRoleToUser({
          ...context,
          values: { unitId: tree.eee.id, userId: headUser.id, roleDefinitionId: roleDefId, scope: "NODE" },
        });

        const scope = await resolveUserDashboardScope(context.tenantId, headUser.id);
        expect(scope.headOfUnits).toHaveLength(2);
        expect(scope.visibleUnitIds).toContain(tree.cse.id);
        expect(scope.visibleUnitIds).toContain(tree.eee.id);
      });
    });

    it("non-head user with UserOrgAssignment → memberOfUnits populated", async () => {
      await withIsolatedDb(async (tracker) => {
        const { context } = await setupActor(tracker, "TENANT_OWNER");
        const tree = await createPublishedStructure(context);

        const member = await createTestUser(tracker, { firstName: "Regular", lastName: "Member" });
        await createTestMembership({
          tenantId: context.tenantId,
          userId: member.id,
          role: "TENANT_USER",
          status: "ACTIVE",
          createdByUserId: context.actorUserId,
        });

        await prisma.userOrgAssignment.create({
          data: {
            versionId: tree.versionId,
            unitId: tree.cse.id,
            userId: member.id,
            assignmentType: "PRIMARY",
            isPrimary: true,
          },
        });

        const scope = await resolveUserDashboardScope(context.tenantId, member.id);
        expect(scope.isTenantAdmin).toBe(false);
        expect(scope.headOfUnits).toHaveLength(0);
        expect(scope.memberOfUnits.some((u) => u.unitId === tree.cse.id)).toBe(true);
        expect(scope.visibleUnitIds).toContain(tree.cse.id);
      });
    });

    it("user with approvalAuthority=true → hasApprovalAuthority is true", async () => {
      await withIsolatedDb(async (tracker) => {
        const { context } = await setupActor(tracker, "TENANT_OWNER");
        const tree = await createPublishedStructure(context);

        const approver = await createTestUser(tracker, { firstName: "Approver", lastName: "User" });
        await createTestMembership({
          tenantId: context.tenantId,
          userId: approver.id,
          role: "TENANT_USER",
          status: "ACTIVE",
          createdByUserId: context.actorUserId,
        });

        const roleDefId = await createRoleAndGetId(context, {
          roleKey: "APPROVER",
          displayLabel: "Approver",
          isUnitHead: false,
          approvalAuthority: true,
        });

        await assignRoleToUser({
          ...context,
          values: { unitId: tree.cse.id, userId: approver.id, roleDefinitionId: roleDefId },
        });

        const scope = await resolveUserDashboardScope(context.tenantId, approver.id);
        expect(scope.hasApprovalAuthority).toBe(true);
      });
    });
  });

  describe("applyScopeFilter", () => {
    it("returns base where unchanged when visibleUnitIds is ALL", () => {
      const scope = { visibleUnitIds: "ALL" as const } as UserDashboardScope;
      const base = { tenantId: "t1", periodId: "p1" };
      const result = applyScopeFilter(base, scope, "assignedToUnitId");
      expect(result).toEqual(base);
    });

    it("adds IN clause when visibleUnitIds is an array", () => {
      const scope = { visibleUnitIds: ["u1", "u2"] } as UserDashboardScope;
      const base = { tenantId: "t1" };
      const result = applyScopeFilter(base, scope, "assignedToUnitId");
      expect(result).toEqual({
        tenantId: "t1",
        assignedToUnitId: { in: ["u1", "u2"] },
      });
    });
  });

  describe("resolveDashboardUnitSelection", () => {
    it("defaults NODE heads to their headed unit only", async () => {
      await withIsolatedDb(async (tracker) => {
        const { context } = await setupActor(tracker, "TENANT_OWNER");
        const tree = await createPublishedStructure(context);

        const headUser = await createTestUser(tracker, { firstName: "Node", lastName: "Head" });
        await createTestMembership({
          tenantId: context.tenantId,
          userId: headUser.id,
          role: "TENANT_USER",
          status: "ACTIVE",
          createdByUserId: context.actorUserId,
        });

        const roleDefId = await createRoleAndGetId(context, {
          roleKey: "NODE_HEAD",
          displayLabel: "Node Head",
          isUnitHead: true,
          approvalAuthority: false,
        });

        await assignRoleToUser({
          ...context,
          values: { unitId: tree.cse.id, userId: headUser.id, roleDefinitionId: roleDefId, scope: "NODE" },
        });

        const selection = await resolveDashboardUnitSelection(context.tenantId, headUser.id);
        expect(selection.scopeMode).toBe("NODE");
        expect(selection.rootUnit.unitId).toBe(tree.cse.id);
        expect(selection.effectiveUnitIds).toEqual([tree.cse.id]);
      });
    });

    it("expands DESCENDANTS heads to the full subtree", async () => {
      await withIsolatedDb(async (tracker) => {
        const { context } = await setupActor(tracker, "TENANT_OWNER");
        const tree = await createPublishedStructure(context);

        const dean = await createTestUser(tracker, { firstName: "Dina", lastName: "Dean" });
        await createTestMembership({
          tenantId: context.tenantId,
          userId: dean.id,
          role: "TENANT_USER",
          status: "ACTIVE",
          createdByUserId: context.actorUserId,
        });

        const roleDefId = await createRoleAndGetId(context, {
          roleKey: "DESC_HEAD",
          displayLabel: "Desc Head",
          isUnitHead: true,
          approvalAuthority: false,
        });

        await assignRoleToUser({
          ...context,
          values: { unitId: tree.cse.id, userId: dean.id, roleDefinitionId: roleDefId, scope: "DESCENDANTS" },
        });

        const selection = await resolveDashboardUnitSelection(context.tenantId, dean.id);
        expect(selection.scopeMode).toBe("DESCENDANTS");
        expect(selection.effectiveUnitIds).toContain(tree.cse.id);
        expect(selection.effectiveUnitIds).toContain(tree.aiTeam.id);
      });
    });

    it("lets multi-head users switch between headed roots", async () => {
      await withIsolatedDb(async (tracker) => {
        const { context } = await setupActor(tracker, "TENANT_OWNER");
        const tree = await createPublishedStructure(context);

        const headUser = await createTestUser(tracker, { firstName: "Multi", lastName: "Head" });
        await createTestMembership({
          tenantId: context.tenantId,
          userId: headUser.id,
          role: "TENANT_USER",
          status: "ACTIVE",
          createdByUserId: context.actorUserId,
        });

        const roleDefId = await createRoleAndGetId(context, {
          roleKey: "MULTI_HEAD",
          displayLabel: "Multi Head",
          isUnitHead: true,
          approvalAuthority: false,
        });

        await assignRoleToUser({
          ...context,
          values: { unitId: tree.cse.id, userId: headUser.id, roleDefinitionId: roleDefId, scope: "NODE" },
        });
        await assignRoleToUser({
          ...context,
          values: { unitId: tree.eee.id, userId: headUser.id, roleDefinitionId: roleDefId, scope: "NODE" },
        });

        const selection = await resolveDashboardUnitSelection(context.tenantId, headUser.id, tree.eee.id);
        expect(selection.rootUnit.unitId).toBe(tree.eee.id);
        expect(selection.effectiveUnitIds).toEqual([tree.eee.id]);
      });
    });

    it("rejects explicit unit selection outside the caller's headed units", async () => {
      await withIsolatedDb(async (tracker) => {
        const { context } = await setupActor(tracker, "TENANT_OWNER");
        const tree = await createPublishedStructure(context);

        const headUser = await createTestUser(tracker, { firstName: "Scoped", lastName: "Head" });
        await createTestMembership({
          tenantId: context.tenantId,
          userId: headUser.id,
          role: "TENANT_USER",
          status: "ACTIVE",
          createdByUserId: context.actorUserId,
        });

        const roleDefId = await createRoleAndGetId(context, {
          roleKey: "SCOPED_HEAD",
          displayLabel: "Scoped Head",
          isUnitHead: true,
          approvalAuthority: false,
        });

        await assignRoleToUser({
          ...context,
          values: { unitId: tree.cse.id, userId: headUser.id, roleDefinitionId: roleDefId, scope: "NODE" },
        });

        await expect(
          resolveDashboardUnitSelection(context.tenantId, headUser.id, tree.eee.id),
        ).rejects.toMatchObject({
          name: DashboardUnitSelectionError.name,
          status: 403,
        });
      });
    });
  });
});
