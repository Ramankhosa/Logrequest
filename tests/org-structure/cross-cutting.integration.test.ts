import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  bulkCreateUnits,
  createOrgUnit,
  createOrgUnitType,
  deleteOrgUnit,
  discardOrgStructureDraft,
  publishOrgStructure,
  validateOrgStructureDraft,
} from "@/lib/org-structure/service";
import {
  assignRoleToUser,
  bulkAssignRoles,
  createRoleDefinition,
  deleteRoleDefinition,
  deriveReportingLines,
  getApprovalChain,
  removeRoleAssignment,
  updateRoleDefinition,
} from "@/lib/org-structure/roles-service";
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

async function setupOwner(tracker: DbTracker) {
  const { tenant, actor } = await createTenantActor(tracker, "TENANT_OWNER");
  const context: ActorContext = {
    tenantId: tenant.id,
    actorUserId: actor.id,
    actorRole: "TENANT_OWNER",
  };
  return { tenant, actor, context };
}

async function createPublishedStructure(ctx: ActorContext) {
  await createOrgUnitType({
    ...ctx,
    values: {
      typeKey: "ROOT",
      displayLabel: "Root",
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

  const draft = await prisma.orgStructureVersion.findFirst({
    where: { tenantId: ctx.tenantId, state: "DRAFT" },
    include: { unitTypes: true },
  });
  const rootType = draft!.unitTypes.find((t) => t.typeKey === "ROOT")!;
  const deptType = draft!.unitTypes.find((t) => t.typeKey === "DEPT")!;

  await createOrgUnit({
    ...ctx,
    values: { typeId: rootType.id, code: "UNIV", name: "University" },
  });
  const root = await prisma.orgUnit.findFirst({
    where: { version: { tenantId: ctx.tenantId, state: "DRAFT" }, code: "UNIV" },
  });
  expect(root).toBeTruthy();
  await createOrgUnit({
    ...ctx,
    values: {
      typeId: deptType.id,
      code: "CSE",
      name: "Computer Science",
      parentId: root!.id,
    },
  });
  await createOrgUnit({
    ...ctx,
    values: {
      typeId: deptType.id,
      code: "EEE",
      name: "Electrical Engineering",
      parentId: root!.id,
    },
  });

  const validation = await validateOrgStructureDraft(ctx.tenantId);
  expect(validation.errors).toHaveLength(0);
  const publish = await publishOrgStructure(ctx);
  expect(publish.status).toBe("success");

  const version = await prisma.orgStructureVersion.findFirst({
    where: { tenantId: ctx.tenantId, state: "PUBLISHED" },
    include: { units: true },
  });
  expect(version).toBeTruthy();

  return {
    versionId: version!.id,
    rootUnitId: version!.units.find((u) => u.code === "UNIV")!.id,
    cseUnitId: version!.units.find((u) => u.code === "CSE")!.id,
    eeeUnitId: version!.units.find((u) => u.code === "EEE")!.id,
  };
}

async function createRole(ctx: ActorContext, values: {
  roleKey: string;
  displayLabel: string;
  isUnitHead?: boolean;
  maxPerUnit?: number;
  sortOrder?: number;
}) {
  const result = await createRoleDefinition({
    ...ctx,
    values: {
      roleKey: values.roleKey,
      displayLabel: values.displayLabel,
      description: values.displayLabel,
      isUnitHead: values.isUnitHead ?? false,
      approvalAuthority: false,
      maxPerUnit: values.maxPerUnit ?? -1,
      sortOrder: values.sortOrder ?? 1,
    },
  });
  expect(result.status).toBe("success");

  const role = await prisma.orgRoleDefinition.findFirst({
    where: { tenantId: ctx.tenantId, roleKey: values.roleKey },
  });
  expect(role).toBeTruthy();
  return role!;
}

describe("Cross-Cutting Integration", () => {
  test("8.3 derives only head->parent-head line when unit has head but no members", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context, tenant, actor } = await setupOwner(tracker);
      const structure = await createPublishedStructure(context);
      const headRole = await createRole(context, { roleKey: "HOD", displayLabel: "Head", isUnitHead: true });

      const rootHead = await createTestUser(tracker);
      const deptHead = await createTestUser(tracker);
      await createTestMembership({ tenantId: tenant.id, userId: rootHead.id, role: "TENANT_USER", createdByUserId: actor.id });
      await createTestMembership({ tenantId: tenant.id, userId: deptHead.id, role: "TENANT_USER", createdByUserId: actor.id });

      await assignRoleToUser({
        ...context,
        values: { unitId: structure.rootUnitId, userId: rootHead.id, roleDefinitionId: headRole.id, scope: "NODE" },
      });
      await assignRoleToUser({
        ...context,
        values: { unitId: structure.cseUnitId, userId: deptHead.id, roleDefinitionId: headRole.id, scope: "NODE" },
      });

      const result = await deriveReportingLines({
        tenantId: context.tenantId,
        versionId: structure.versionId,
        actorUserId: context.actorUserId,
        actorRole: context.actorRole,
      });
      expect(result.created).toBe(1);
    });
  });

  test("8.4 root head has no manager reporting line", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context, tenant, actor } = await setupOwner(tracker);
      const structure = await createPublishedStructure(context);
      const headRole = await createRole(context, { roleKey: "HOD", displayLabel: "Head", isUnitHead: true });
      const rootHead = await createTestUser(tracker);
      await createTestMembership({ tenantId: tenant.id, userId: rootHead.id, role: "TENANT_USER", createdByUserId: actor.id });
      await assignRoleToUser({
        ...context,
        values: { unitId: structure.rootUnitId, userId: rootHead.id, roleDefinitionId: headRole.id, scope: "NODE" },
      });

      const result = await deriveReportingLines({
        tenantId: context.tenantId,
        versionId: structure.versionId,
        actorUserId: context.actorUserId,
        actorRole: context.actorRole,
      });
      expect(result.created).toBe(0);
    });
  });

  test("8.7 supports same user as head at two units with separate relationships", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context, tenant, actor } = await setupOwner(tracker);
      const structure = await createPublishedStructure(context);
      const headRole = await createRole(context, { roleKey: "HOD", displayLabel: "Head", isUnitHead: true });
      const staffRole = await createRole(context, { roleKey: "STAFF", displayLabel: "Staff" });

      const head = await createTestUser(tracker);
      const rootMember = await createTestUser(tracker);
      const cseMember = await createTestUser(tracker);
      await createTestMembership({ tenantId: tenant.id, userId: head.id, role: "TENANT_USER", createdByUserId: actor.id });
      await createTestMembership({ tenantId: tenant.id, userId: rootMember.id, role: "TENANT_USER", createdByUserId: actor.id });
      await createTestMembership({ tenantId: tenant.id, userId: cseMember.id, role: "TENANT_USER", createdByUserId: actor.id });

      await assignRoleToUser({ ...context, values: { unitId: structure.rootUnitId, userId: head.id, roleDefinitionId: headRole.id, scope: "NODE" } });
      await assignRoleToUser({ ...context, values: { unitId: structure.cseUnitId, userId: head.id, roleDefinitionId: headRole.id, scope: "NODE" } });
      await assignRoleToUser({ ...context, values: { unitId: structure.rootUnitId, userId: rootMember.id, roleDefinitionId: staffRole.id, scope: "NODE" } });
      await assignRoleToUser({ ...context, values: { unitId: structure.cseUnitId, userId: cseMember.id, roleDefinitionId: staffRole.id, scope: "NODE" } });

      const result = await deriveReportingLines({
        tenantId: context.tenantId,
        versionId: structure.versionId,
        actorUserId: context.actorUserId,
        actorRole: context.actorRole,
      });
      expect(result.created).toBeGreaterThanOrEqual(2);
      const lines = await prisma.reportingLine.findMany({
        where: { versionId: structure.versionId, managerUserId: head.id },
      });
      expect(lines.some((l) => l.memberUserId === rootMember.id)).toBe(true);
      expect(lines.some((l) => l.memberUserId === cseMember.id)).toBe(true);
    });
  });

  test("8.8 deduplicates duplicate manager-member-unit pairs", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context, tenant, actor } = await setupOwner(tracker);
      const structure = await createPublishedStructure(context);
      const headRole = await createRole(context, { roleKey: "HOD", displayLabel: "Head", isUnitHead: true });
      const staffRole = await createRole(context, { roleKey: "STAFF", displayLabel: "Staff" });
      const extraRole = await createRole(context, { roleKey: "COORD", displayLabel: "Coordinator" });
      const head = await createTestUser(tracker);
      const member = await createTestUser(tracker);
      await createTestMembership({ tenantId: tenant.id, userId: head.id, role: "TENANT_USER", createdByUserId: actor.id });
      await createTestMembership({ tenantId: tenant.id, userId: member.id, role: "TENANT_USER", createdByUserId: actor.id });

      await assignRoleToUser({ ...context, values: { unitId: structure.cseUnitId, userId: head.id, roleDefinitionId: headRole.id, scope: "NODE" } });
      await assignRoleToUser({ ...context, values: { unitId: structure.cseUnitId, userId: member.id, roleDefinitionId: staffRole.id, scope: "NODE" } });
      await assignRoleToUser({ ...context, values: { unitId: structure.cseUnitId, userId: member.id, roleDefinitionId: extraRole.id, scope: "NODE" } });

      await deriveReportingLines({
        tenantId: context.tenantId,
        versionId: structure.versionId,
        actorUserId: context.actorUserId,
        actorRole: context.actorRole,
      });
      const lines = await prisma.reportingLine.findMany({
        where: {
          versionId: structure.versionId,
          unitId: structure.cseUnitId,
          managerUserId: head.id,
          memberUserId: member.id,
        },
      });
      expect(lines).toHaveLength(1);
    });
  });

  test("11.1 full flow create->publish->role->assignment->derive succeeds", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context, tenant, actor } = await setupOwner(tracker);
      const structure = await createPublishedStructure(context);
      const headRole = await createRole(context, { roleKey: "HOD", displayLabel: "Head", isUnitHead: true });
      const staffRole = await createRole(context, { roleKey: "STAFF", displayLabel: "Staff" });
      const head = await createTestUser(tracker);
      const member = await createTestUser(tracker);
      await createTestMembership({ tenantId: tenant.id, userId: head.id, role: "TENANT_USER", createdByUserId: actor.id });
      await createTestMembership({ tenantId: tenant.id, userId: member.id, role: "TENANT_USER", createdByUserId: actor.id });
      await assignRoleToUser({ ...context, values: { unitId: structure.cseUnitId, userId: head.id, roleDefinitionId: headRole.id, scope: "NODE" } });
      await assignRoleToUser({ ...context, values: { unitId: structure.cseUnitId, userId: member.id, roleDefinitionId: staffRole.id, scope: "NODE" } });
      const derive = await deriveReportingLines({
        tenantId: context.tenantId,
        versionId: structure.versionId,
        actorUserId: context.actorUserId,
        actorRole: context.actorRole,
      });
      expect(derive.created).toBeGreaterThan(0);
    });
  });

  test("11.2 publish then new draft does not affect old version assignments", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context, tenant, actor } = await setupOwner(tracker);
      const structure = await createPublishedStructure(context);
      const role = await createRole(context, { roleKey: "STAFF", displayLabel: "Staff" });
      const member = await createTestUser(tracker);
      await createTestMembership({ tenantId: tenant.id, userId: member.id, role: "TENANT_USER", createdByUserId: actor.id });
      await assignRoleToUser({ ...context, values: { unitId: structure.cseUnitId, userId: member.id, roleDefinitionId: role.id, scope: "NODE" } });
      const before = await prisma.orgRoleAssignment.findFirst({
        where: { versionId: structure.versionId, userId: member.id, roleDefinitionId: role.id },
      });
      expect(before).toBeTruthy();

      await createOrgUnitType({
        ...context,
        values: {
          typeKey: "OFFICE",
          displayLabel: "Office",
          internalCategory: "OFFICE",
          allowRoot: false,
        },
      });

      const after = await prisma.orgRoleAssignment.findFirst({
        where: { id: before!.id },
      });
      expect(after?.versionId).toBe(structure.versionId);
    });
  });

  test("11.3 assignments reference active versionId at assignment time", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context, tenant, actor } = await setupOwner(tracker);
      const structure = await createPublishedStructure(context);
      const role = await createRole(context, { roleKey: "STAFF", displayLabel: "Staff" });
      const member = await createTestUser(tracker);
      await createTestMembership({ tenantId: tenant.id, userId: member.id, role: "TENANT_USER", createdByUserId: actor.id });
      await assignRoleToUser({ ...context, values: { unitId: structure.cseUnitId, userId: member.id, roleDefinitionId: role.id, scope: "NODE" } });
      const assignment = await prisma.orgRoleAssignment.findFirst({
        where: { userId: member.id, roleDefinitionId: role.id },
      });
      expect(assignment?.versionId).toBe(structure.versionId);
    });
  });

  test("11.4 deleting unit with assignments cascades assignment deletion", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context, tenant, actor } = await setupOwner(tracker);
      await createPublishedStructure(context);
      await createOrgUnitType({
        ...context,
        values: {
          typeKey: "OFFICE",
          displayLabel: "Office",
          internalCategory: "OFFICE",
          allowRoot: false,
        },
      });
      const draft = await prisma.orgStructureVersion.findFirst({
        where: { tenantId: context.tenantId, state: "DRAFT" },
        include: { units: true },
      });
      const cse = draft!.units.find((u) => u.code === "CSE")!;
      const role = await createRole(context, { roleKey: "STAFF", displayLabel: "Staff" });
      const member = await createTestUser(tracker);
      await createTestMembership({ tenantId: tenant.id, userId: member.id, role: "TENANT_USER", createdByUserId: actor.id });
      await assignRoleToUser({ ...context, values: { unitId: cse.id, userId: member.id, roleDefinitionId: role.id, scope: "NODE" } });
      const assignment = await prisma.orgRoleAssignment.findFirst({
        where: { versionId: draft!.id, unitId: cse.id, userId: member.id },
      });
      expect(assignment).toBeTruthy();

      const deleted = await deleteOrgUnit({
        ...context,
        unitId: cse.id,
      });
      expect(deleted.status).toBe("success");
      const after = await prisma.orgRoleAssignment.findUnique({
        where: { id: assignment!.id },
      });
      expect(after).toBeNull();
    });
  });

  test("11.5 discarding draft with assignments removes draft assignments", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context, tenant, actor } = await setupOwner(tracker);
      await createPublishedStructure(context);
      await createOrgUnitType({
        ...context,
        values: {
          typeKey: "OFFICE",
          displayLabel: "Office",
          internalCategory: "OFFICE",
          allowRoot: false,
        },
      });
      const draft = await prisma.orgStructureVersion.findFirst({
        where: { tenantId: context.tenantId, state: "DRAFT" },
        include: { units: true },
      });
      const cse = draft!.units.find((u) => u.code === "CSE")!;
      const role = await createRole(context, { roleKey: "STAFF", displayLabel: "Staff" });
      const member = await createTestUser(tracker);
      await createTestMembership({ tenantId: tenant.id, userId: member.id, role: "TENANT_USER", createdByUserId: actor.id });
      await assignRoleToUser({ ...context, values: { unitId: cse.id, userId: member.id, roleDefinitionId: role.id, scope: "NODE" } });
      const beforeCount = await prisma.orgRoleAssignment.count({
        where: { versionId: draft!.id },
      });
      expect(beforeCount).toBeGreaterThan(0);

      const discarded = await discardOrgStructureDraft(context);
      expect(discarded.status).toBe("success");

      const afterCount = await prisma.orgRoleAssignment.count({
        where: { versionId: draft!.id },
      });
      expect(afterCount).toBe(0);
    });
  });

  test("11.6 same roleKey across tenants remains isolated", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context: c1 } = await setupOwner(tracker);
      const { context: c2 } = await setupOwner(tracker);
      await createRole(c1, { roleKey: "DEPT_HEAD", displayLabel: "Dept Head 1" });
      await createRole(c2, { roleKey: "DEPT_HEAD", displayLabel: "Dept Head 2" });

      const t1Roles = await prisma.orgRoleDefinition.findMany({
        where: { tenantId: c1.tenantId, roleKey: "DEPT_HEAD" },
      });
      const t2Roles = await prisma.orgRoleDefinition.findMany({
        where: { tenantId: c2.tenantId, roleKey: "DEPT_HEAD" },
      });
      expect(t1Roles).toHaveLength(1);
      expect(t2Roles).toHaveLength(1);
      expect(t1Roles[0]?.id).not.toBe(t2Roles[0]?.id);
    });
  });

  test("11.7 concurrent assignment attempts keep only one assignment record", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context, tenant, actor } = await setupOwner(tracker);
      const structure = await createPublishedStructure(context);
      const role = await createRole(context, { roleKey: "SINGLE", displayLabel: "Single", maxPerUnit: 1 });
      const member = await createTestUser(tracker);
      await createTestMembership({ tenantId: tenant.id, userId: member.id, role: "TENANT_USER", createdByUserId: actor.id });

      const results = await Promise.allSettled([
        assignRoleToUser({ ...context, values: { unitId: structure.cseUnitId, userId: member.id, roleDefinitionId: role.id, scope: "NODE" } }),
        assignRoleToUser({ ...context, values: { unitId: structure.cseUnitId, userId: member.id, roleDefinitionId: role.id, scope: "NODE" } }),
      ]);

      const assignments = await prisma.orgRoleAssignment.findMany({
        where: { versionId: structure.versionId, unitId: structure.cseUnitId, userId: member.id, roleDefinitionId: role.id },
      });
      expect(assignments).toHaveLength(1);
      expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    });
  });

  test("11.8 bulk assignment import of 100+ rows completes in reasonable time", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context, tenant, actor } = await setupOwner(tracker);
      const structure = await createPublishedStructure(context);
      await createRole(context, { roleKey: "STAFF", displayLabel: "Staff" });
      const role = await prisma.orgRoleDefinition.findFirst({
        where: { tenantId: context.tenantId, roleKey: "STAFF" },
      });
      expect(role).toBeTruthy();

      const assignments: Array<{ userId: string; unitCode: string; roleKey: string }> = [];
      for (let i = 0; i < 120; i += 1) {
        const user = await createTestUser(tracker, { firstName: `U${i}`, lastName: "Bulk" });
        await createTestMembership({ tenantId: tenant.id, userId: user.id, role: "TENANT_USER", createdByUserId: actor.id });
        assignments.push({ userId: user.id, unitCode: "CSE", roleKey: role!.roleKey });
      }

      const start = Date.now();
      const result = await bulkAssignRoles({
        tenantId: context.tenantId,
        actorUserId: context.actorUserId,
        actorRole: context.actorRole,
        assignments,
      });
      const elapsedMs = Date.now() - start;
      expect(result.status).toBe("success");
      expect(result.details?.created).toBe(120);
      expect(elapsedMs).toBeLessThan(20_000);
    });
  });

  test("11.9 approval chain traversal handles 500+ units", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupOwner(tracker);
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
          typeKey: "NODE",
          displayLabel: "Node",
          internalCategory: "CUSTOM_UNIT",
          allowRoot: false,
        },
      });

      const rows: Array<{ typeKey: string; code: string; name: string; parentCode: string | null }> = [];
      rows.push({ typeKey: "ROOT", code: "N0", name: "Node 0", parentCode: null });
      for (let i = 1; i <= 500; i += 1) {
        rows.push({
          typeKey: "NODE",
          code: `N${i}`,
          name: `Node ${i}`,
          parentCode: `N${i - 1}`,
        });
      }
      const imported = await bulkCreateUnits({
        ...context,
        rows,
      });
      expect(imported.status).toBe("success");
      await validateOrgStructureDraft(context.tenantId);
      await publishOrgStructure(context);

      const leaf = await prisma.orgUnit.findFirst({
        where: {
          version: { tenantId: context.tenantId, state: "PUBLISHED" },
          code: "N500",
        },
      });
      expect(leaf).toBeTruthy();

      const start = Date.now();
      const chain = await getApprovalChain(context.tenantId, leaf!.id);
      const elapsedMs = Date.now() - start;
      expect(chain.length).toBe(501);
      expect(elapsedMs).toBeLessThan(30_000);
    });
  });

  test("11.10 audit logs exist for role CRUD, assignments, import, and reporting derivation", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context, tenant, actor } = await setupOwner(tracker);
      const structure = await createPublishedStructure(context);
      const role = await createRole(context, { roleKey: "AUDIT_ROLE", displayLabel: "Audit Role" });

      const member = await createTestUser(tracker);
      await createTestMembership({ tenantId: tenant.id, userId: member.id, role: "TENANT_USER", createdByUserId: actor.id });
      await assignRoleToUser({
        ...context,
        values: { unitId: structure.cseUnitId, userId: member.id, roleDefinitionId: role.id, scope: "NODE" },
      });
      const assignment = await prisma.orgRoleAssignment.findFirst({
        where: { userId: member.id, roleDefinitionId: role.id },
      });
      expect(assignment).toBeTruthy();

      await updateRoleDefinition({
        ...context,
        roleId: role.id,
        values: { displayLabel: "Audit Role Updated" },
      });
      await removeRoleAssignment({
        ...context,
        assignmentId: assignment!.id,
      });
      await deriveReportingLines({
        tenantId: context.tenantId,
        versionId: structure.versionId,
        actorUserId: context.actorUserId,
        actorRole: context.actorRole,
      });
      await createOrgUnitType({
        ...context,
        values: {
          typeKey: "BULK",
          displayLabel: "Bulk",
          internalCategory: "CUSTOM_UNIT",
          allowRoot: false,
        },
      });
      await bulkCreateUnits({
        ...context,
        rows: [{ typeKey: "BULK", code: "BULK1", name: "Bulk 1", parentCode: "UNIV" }],
      });
      await deleteRoleDefinition({
        ...context,
        roleId: role.id,
      });

      const actions = await prisma.auditLog.findMany({
        where: { tenantId: context.tenantId },
        select: { action: true },
      });
      const actionSet = new Set(actions.map((a) => a.action));
      expect(actionSet.has("org_role_definition.created")).toBe(true);
      expect(actionSet.has("org_role_definition.updated")).toBe(true);
      expect(actionSet.has("org_role_definition.deleted")).toBe(true);
      expect(actionSet.has("org_role.assigned")).toBe(true);
      expect(actionSet.has("org_role.removed")).toBe(true);
      expect(actionSet.has("reporting_lines.derived")).toBe(true);
      expect(actionSet.has("org_structure.bulk_import")).toBe(true);
    });
  });
});

