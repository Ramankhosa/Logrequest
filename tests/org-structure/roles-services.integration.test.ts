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
  bulkAssignRoles,
  createRoleDefinition,
  deleteRoleDefinition,
  deriveReportingLines,
  getApprovalChain,
  getUnitMembers,
  getUserAssignments,
  listRoleDefinitions,
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
    where: {
      tenantId: ctx.tenantId,
      state: {
        in: ["DRAFT", "VALIDATED"],
      },
    },
    orderBy: {
      versionNumber: "desc",
    },
    include: {
      unitTypes: true,
    },
  });
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

  const withRoot = await prisma.orgStructureVersion.findFirst({
    where: {
      tenantId: ctx.tenantId,
      state: {
        in: ["DRAFT", "VALIDATED"],
      },
    },
    orderBy: {
      versionNumber: "desc",
    },
    include: {
      units: true,
    },
  });
  const rootUnit = withRoot?.units.find((u) => u.code === "UNIV");
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

  const validation = await validateOrgStructureDraft(ctx.tenantId);
  expect(validation.errors).toHaveLength(0);
  const published = await publishOrgStructure(ctx);
  expect(published.status).toBe("success");

  const version = await prisma.orgStructureVersion.findFirst({
    where: { tenantId: ctx.tenantId, state: "PUBLISHED" },
    orderBy: { versionNumber: "desc" },
    include: { units: true },
  });
  expect(version).toBeTruthy();

  const root = version!.units.find((u) => u.code === "UNIV");
  const cse = version!.units.find((u) => u.code === "CSE");
  expect(root).toBeTruthy();
  expect(cse).toBeTruthy();

  return {
    versionId: version!.id,
    rootUnitId: root!.id,
    cseUnitId: cse!.id,
  };
}

async function createRole(ctx: ActorContext, input?: { roleKey?: string; displayLabel?: string; isUnitHead?: boolean; maxPerUnit?: number; sortOrder?: number; isActive?: boolean; }) {
  const roleKey = input?.roleKey ?? "DEPT_HEAD";
  const displayLabel = input?.displayLabel ?? "Department Head";
  const result = await createRoleDefinition({
    ...ctx,
    values: {
      roleKey,
      displayLabel,
      description: `${displayLabel} role`,
      isUnitHead: input?.isUnitHead ?? false,
      approvalAuthority: false,
      maxPerUnit: input?.maxPerUnit ?? -1,
      sortOrder: input?.sortOrder ?? 0,
    },
  });
  expect(result.status).toBe("success");

  const definition = await prisma.orgRoleDefinition.findFirst({
    where: { tenantId: ctx.tenantId, roleKey },
  });
  expect(definition).toBeTruthy();

  if (input?.isActive === false) {
    await updateRoleDefinition({
      ...ctx,
      roleId: definition!.id,
      values: {
        isActive: false,
      },
    });
  }

  return definition!;
}

describe("Org Structure Service Integration - Role Definitions", () => {
  test("5.1 creates role definition with valid data", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      const role = await createRole(context, {
        roleKey: "VC",
        displayLabel: "Vice Chancellor",
        isUnitHead: true,
        sortOrder: 0,
      });
      expect(role.roleKey).toBe("VC");
      expect(role.isUnitHead).toBe(true);
    });
  });

  test("5.2 rejects duplicate roleKey per tenant", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      await createRole(context, { roleKey: "DEAN" });

      const duplicate = await createRoleDefinition({
        ...context,
        values: {
          roleKey: "DEAN",
          displayLabel: "Dean Duplicate",
          description: "Duplicate",
          isUnitHead: false,
          approvalAuthority: false,
          maxPerUnit: -1,
          sortOrder: 2,
        },
      });
      expect(duplicate.status).toBe("error");
      expect(duplicate.message).toContain("already exists");
    });
  });

  test("5.3 rejects invalid roleKey", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      const result = await createRoleDefinition({
        ...context,
        values: {
          roleKey: "bad key",
          displayLabel: "Bad",
          description: "Bad",
          isUnitHead: false,
          approvalAuthority: false,
          maxPerUnit: -1,
          sortOrder: 1,
        },
      });
      expect(result.status).toBe("error");
    });
  });

  test("5.4 blocks role creation for TENANT_USER", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker, "TENANT_USER");
      const result = await createRoleDefinition({
        ...context,
        values: {
          roleKey: "DEAN",
          displayLabel: "Dean",
          description: "Dean role",
          isUnitHead: false,
          approvalAuthority: false,
          maxPerUnit: -1,
          sortOrder: 1,
        },
      });
      expect(result.status).toBe("error");
      expect(result.message).toContain("permission");
    });
  });

  test("5.6 updates role displayLabel", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      const definition = await createRole(context, {
        roleKey: "DEAN",
        displayLabel: "Dean",
      });
      const result = await updateRoleDefinition({
        ...context,
        roleId: definition.id,
        values: {
          displayLabel: "School Dean",
        },
      });
      expect(result.status).toBe("success");

      const updated = await prisma.orgRoleDefinition.findUnique({
        where: { id: definition.id },
      });
      expect(updated?.displayLabel).toBe("School Dean");
    });
  });

  test("5.9 deactivates role with no active assignments", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      const definition = await createRole(context, {
        roleKey: "COORD",
        displayLabel: "Coordinator",
      });

      const result = await updateRoleDefinition({
        ...context,
        roleId: definition.id,
        values: {
          isActive: false,
        },
      });
      expect(result.status).toBe("success");

      const deactivated = await prisma.orgRoleDefinition.findUnique({
        where: { id: definition.id },
      });
      expect(deactivated?.isActive).toBe(false);
    });
  });

  test("5.13 deletes role with zero assignments", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      const definition = await createRole(context, {
        roleKey: "TEMP_ROLE",
        displayLabel: "Temporary",
      });

      const result = await deleteRoleDefinition({
        ...context,
        roleId: definition.id,
      });
      expect(result.status).toBe("success");

      const missing = await prisma.orgRoleDefinition.findUnique({
        where: { id: definition.id },
      });
      expect(missing).toBeNull();
    });
  });

  test("5.5 listRoleDefinitions returns assignment counts", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context, tenant, actor } = await setupActor(tracker);
      const structure = await createPublishedStructure(context);
      const role = await createRole(context, {
        roleKey: "DEAN",
        displayLabel: "Dean",
      });
      const member = await createTestUser(tracker);
      await createTestMembership({
        tenantId: tenant.id,
        userId: member.id,
        role: "TENANT_USER",
        createdByUserId: actor.id,
      });
      await assignRoleToUser({
        ...context,
        values: {
          unitId: structure.cseUnitId,
          userId: member.id,
          roleDefinitionId: role.id,
          scope: "NODE",
        },
      });

      const definitions = await listRoleDefinitions(context.tenantId);
      const dean = definitions.find((d) => d.id === role.id);
      expect(dean).toBeTruthy();
      expect(dean?.assignmentCount).toBe(1);
    });
  });

  test("5.7 updating displayLabel syncs denormalized roleName in assignments", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context, tenant, actor } = await setupActor(tracker);
      const structure = await createPublishedStructure(context);
      const role = await createRole(context, {
        roleKey: "DEAN",
        displayLabel: "Dean",
      });
      const member = await createTestUser(tracker);
      await createTestMembership({
        tenantId: tenant.id,
        userId: member.id,
        role: "TENANT_USER",
        createdByUserId: actor.id,
      });
      await assignRoleToUser({
        ...context,
        values: {
          unitId: structure.cseUnitId,
          userId: member.id,
          roleDefinitionId: role.id,
          scope: "NODE",
        },
      });

      const updated = await updateRoleDefinition({
        ...context,
        roleId: role.id,
        values: {
          displayLabel: "School Dean",
        },
      });
      expect(updated.status).toBe("success");

      const assignment = await prisma.orgRoleAssignment.findFirst({
        where: { roleDefinitionId: role.id },
      });
      expect(assignment?.roleName).toBe("School Dean");
    });
  });

  test("5.8 cannot deactivate role with active assignments", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context, tenant, actor } = await setupActor(tracker);
      const structure = await createPublishedStructure(context);
      const role = await createRole(context, {
        roleKey: "DEAN",
        displayLabel: "Dean",
      });
      const member = await createTestUser(tracker);
      await createTestMembership({
        tenantId: tenant.id,
        userId: member.id,
        role: "TENANT_USER",
        createdByUserId: actor.id,
      });
      await assignRoleToUser({
        ...context,
        values: {
          unitId: structure.cseUnitId,
          userId: member.id,
          roleDefinitionId: role.id,
          scope: "NODE",
        },
      });

      const result = await updateRoleDefinition({
        ...context,
        roleId: role.id,
        values: {
          isActive: false,
        },
      });
      expect(result.status).toBe("error");
      expect(result.message).toContain("Cannot deactivate");
    });
  });

  test("5.10 cannot remove isUnitHead when role is sole head for a unit", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context, tenant, actor } = await setupActor(tracker);
      const structure = await createPublishedStructure(context);
      const role = await createRole(context, {
        roleKey: "HOD",
        displayLabel: "Head",
        isUnitHead: true,
      });
      const head = await createTestUser(tracker);
      await createTestMembership({
        tenantId: tenant.id,
        userId: head.id,
        role: "TENANT_USER",
        createdByUserId: actor.id,
      });
      await assignRoleToUser({
        ...context,
        values: {
          unitId: structure.cseUnitId,
          userId: head.id,
          roleDefinitionId: role.id,
          scope: "NODE",
        },
      });

      const result = await updateRoleDefinition({
        ...context,
        roleId: role.id,
        values: {
          isUnitHead: false,
        },
      });
      expect(result.status).toBe("error");
      expect(result.message).toContain("unit-head flag");
    });
  });

  test("5.11 removing isUnitHead succeeds when no assignments exist", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      const role = await createRole(context, {
        roleKey: "HOD",
        displayLabel: "Head",
        isUnitHead: true,
      });

      const result = await updateRoleDefinition({
        ...context,
        roleId: role.id,
        values: {
          isUnitHead: false,
        },
      });
      expect(result.status).toBe("success");
    });
  });

  test("5.12 deleteRoleDefinition fails when assignments reference role", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context, tenant, actor } = await setupActor(tracker);
      const structure = await createPublishedStructure(context);
      const role = await createRole(context, {
        roleKey: "DEAN",
        displayLabel: "Dean",
      });
      const member = await createTestUser(tracker);
      await createTestMembership({
        tenantId: tenant.id,
        userId: member.id,
        role: "TENANT_USER",
        createdByUserId: actor.id,
      });
      await assignRoleToUser({
        ...context,
        values: {
          unitId: structure.cseUnitId,
          userId: member.id,
          roleDefinitionId: role.id,
          scope: "NODE",
        },
      });

      const deleted = await deleteRoleDefinition({
        ...context,
        roleId: role.id,
      });
      expect(deleted.status).toBe("error");
      expect(deleted.message).toContain("Cannot delete");
    });
  });

  test("5.14 create role with maxPerUnit=1 succeeds", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      const created = await createRoleDefinition({
        ...context,
        values: {
          roleKey: "COORD",
          displayLabel: "Coordinator",
          description: "Coordinator",
          isUnitHead: false,
          approvalAuthority: false,
          maxPerUnit: 1,
          sortOrder: 5,
        },
      });
      expect(created.status).toBe("success");
    });
  });

  test("5.15 create role with sortOrder=0 succeeds", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      const created = await createRoleDefinition({
        ...context,
        values: {
          roleKey: "VC",
          displayLabel: "Vice Chancellor",
          description: "Top role",
          isUnitHead: true,
          approvalAuthority: true,
          maxPerUnit: 1,
          sortOrder: 0,
        },
      });
      expect(created.status).toBe("success");
    });
  });
});

describe("Org Structure Service Integration - Assignments, Approval Chain, Reporting", () => {
  test("6.1 assigns role to user and creates UserOrgAssignment", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context, tenant, actor } = await setupActor(tracker);
      const structure = await createPublishedStructure(context);
      const role = await createRole(context, {
        roleKey: "DEPT_HEAD",
        displayLabel: "Department Head",
        isUnitHead: true,
      });
      const member = await createTestUser(tracker, {
        firstName: "Alice",
        lastName: "Head",
      });
      await createTestMembership({
        tenantId: tenant.id,
        userId: member.id,
        role: "TENANT_USER",
        createdByUserId: actor.id,
      });

      const result = await assignRoleToUser({
        ...context,
        values: {
          unitId: structure.cseUnitId,
          userId: member.id,
          roleDefinitionId: role.id,
          scope: "NODE",
        },
      });
      expect(result.status).toBe("success");

      const assignment = await prisma.orgRoleAssignment.findFirst({
        where: {
          versionId: structure.versionId,
          unitId: structure.cseUnitId,
          userId: member.id,
          roleDefinitionId: role.id,
        },
      });
      expect(assignment).toBeTruthy();

      const placement = await prisma.userOrgAssignment.findFirst({
        where: {
          versionId: structure.versionId,
          unitId: structure.cseUnitId,
          userId: member.id,
        },
      });
      expect(placement).toBeTruthy();
    });
  });

  test("6.2 rejects duplicate assignment for same user/unit/role", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context, tenant, actor } = await setupActor(tracker);
      const structure = await createPublishedStructure(context);
      const role = await createRole(context, {
        roleKey: "DEPT_HEAD",
        displayLabel: "Department Head",
      });
      const member = await createTestUser(tracker);
      await createTestMembership({
        tenantId: tenant.id,
        userId: member.id,
        role: "TENANT_USER",
        createdByUserId: actor.id,
      });

      await assignRoleToUser({
        ...context,
        values: {
          unitId: structure.cseUnitId,
          userId: member.id,
          roleDefinitionId: role.id,
          scope: "NODE",
        },
      });
      const second = await assignRoleToUser({
        ...context,
        values: {
          unitId: structure.cseUnitId,
          userId: member.id,
          roleDefinitionId: role.id,
          scope: "NODE",
        },
      });
      expect(second.status).toBe("error");
      expect(second.message).toContain("already has");
    });
  });

  test("6.3 rejects assignment when user is not a tenant member", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      const structure = await createPublishedStructure(context);
      const role = await createRole(context, {
        roleKey: "DEPT_HEAD",
        displayLabel: "Department Head",
      });
      const outsider = await createTestUser(tracker);

      const result = await assignRoleToUser({
        ...context,
        values: {
          unitId: structure.cseUnitId,
          userId: outsider.id,
          roleDefinitionId: role.id,
          scope: "NODE",
        },
      });
      expect(result.status).toBe("error");
      expect(result.message).toContain("not a member");
    });
  });

  test("6.4 rejects assignment to INACTIVE unit", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context, tenant, actor } = await setupActor(tracker);
      const structure = await createPublishedStructure(context);
      await prisma.orgUnit.update({
        where: { id: structure.cseUnitId },
        data: { state: "INACTIVE" },
      });
      const role = await createRole(context, {
        roleKey: "DEPT_HEAD",
        displayLabel: "Department Head",
      });
      const member = await createTestUser(tracker);
      await createTestMembership({
        tenantId: tenant.id,
        userId: member.id,
        role: "TENANT_USER",
        createdByUserId: actor.id,
      });

      const result = await assignRoleToUser({
        ...context,
        values: {
          unitId: structure.cseUnitId,
          userId: member.id,
          roleDefinitionId: role.id,
          scope: "NODE",
        },
      });
      expect(result.status).toBe("error");
      expect(result.message).toContain("inactive");
    });
  });

  test("6.6 rejects assignment for deactivated role definition", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context, tenant, actor } = await setupActor(tracker);
      const structure = await createPublishedStructure(context);
      const role = await createRole(context, {
        roleKey: "TEMP",
        displayLabel: "Temp Role",
        isActive: false,
      });
      const member = await createTestUser(tracker);
      await createTestMembership({
        tenantId: tenant.id,
        userId: member.id,
        role: "TENANT_USER",
        createdByUserId: actor.id,
      });

      const result = await assignRoleToUser({
        ...context,
        values: {
          unitId: structure.cseUnitId,
          userId: member.id,
          roleDefinitionId: role.id,
          scope: "NODE",
        },
      });
      expect(result.status).toBe("error");
      expect(result.message).toContain("deactivated");
    });
  });

  test("6.5 rejects assignment at ARCHIVED unit", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context, tenant, actor } = await setupActor(tracker);
      const structure = await createPublishedStructure(context);
      await prisma.orgUnit.update({
        where: { id: structure.cseUnitId },
        data: { state: "ARCHIVED" },
      });
      const role = await createRole(context, {
        roleKey: "DEPT_HEAD",
        displayLabel: "Department Head",
      });
      const member = await createTestUser(tracker);
      await createTestMembership({
        tenantId: tenant.id,
        userId: member.id,
        role: "TENANT_USER",
        createdByUserId: actor.id,
      });

      const result = await assignRoleToUser({
        ...context,
        values: {
          unitId: structure.cseUnitId,
          userId: member.id,
          roleDefinitionId: role.id,
          scope: "NODE",
        },
      });
      expect(result.status).toBe("error");
      expect(result.message).toContain("inactive or archived");
    });
  });

  test("6.7 rejects assignment when no structure version exists", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context, tenant, actor } = await setupActor(tracker);
      const role = await createRole(context, {
        roleKey: "DEPT_HEAD",
        displayLabel: "Department Head",
      });
      const member = await createTestUser(tracker);
      await createTestMembership({
        tenantId: tenant.id,
        userId: member.id,
        role: "TENANT_USER",
        createdByUserId: actor.id,
      });

      const result = await assignRoleToUser({
        ...context,
        values: {
          unitId: "missing-unit",
          userId: member.id,
          roleDefinitionId: role.id,
          scope: "NODE",
        },
      });
      expect(result.status).toBe("error");
      expect(result.message).toContain("No active structure version");
    });
  });

  test("6.8 enforces maxPerUnit=1", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context, tenant, actor } = await setupActor(tracker);
      const structure = await createPublishedStructure(context);
      const role = await createRole(context, {
        roleKey: "COORD",
        displayLabel: "Coordinator",
        maxPerUnit: 1,
      });

      const member1 = await createTestUser(tracker, {
        firstName: "Member",
        lastName: "One",
      });
      const member2 = await createTestUser(tracker, {
        firstName: "Member",
        lastName: "Two",
      });
      await createTestMembership({
        tenantId: tenant.id,
        userId: member1.id,
        role: "TENANT_USER",
        createdByUserId: actor.id,
      });
      await createTestMembership({
        tenantId: tenant.id,
        userId: member2.id,
        role: "TENANT_USER",
        createdByUserId: actor.id,
      });

      await assignRoleToUser({
        ...context,
        values: {
          unitId: structure.cseUnitId,
          userId: member1.id,
          roleDefinitionId: role.id,
          scope: "NODE",
        },
      });

      const second = await assignRoleToUser({
        ...context,
        values: {
          unitId: structure.cseUnitId,
          userId: member2.id,
          roleDefinitionId: role.id,
          scope: "NODE",
        },
      });
      expect(second.status).toBe("error");
      expect(second.message).toContain("max");
    });
  });

  test("6.9 enforces single unit head per unit", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context, tenant, actor } = await setupActor(tracker);
      const structure = await createPublishedStructure(context);
      const headRole1 = await createRole(context, {
        roleKey: "HOD",
        displayLabel: "Head of Department",
        isUnitHead: true,
        sortOrder: 1,
      });
      const headRole2 = await createRole(context, {
        roleKey: "ALT_HOD",
        displayLabel: "Alt Head",
        isUnitHead: true,
        sortOrder: 2,
      });

      const member1 = await createTestUser(tracker, {
        firstName: "Alice",
        lastName: "Head",
      });
      const member2 = await createTestUser(tracker, {
        firstName: "Bob",
        lastName: "Head",
      });
      await createTestMembership({
        tenantId: tenant.id,
        userId: member1.id,
        role: "TENANT_USER",
        createdByUserId: actor.id,
      });
      await createTestMembership({
        tenantId: tenant.id,
        userId: member2.id,
        role: "TENANT_USER",
        createdByUserId: actor.id,
      });

      await assignRoleToUser({
        ...context,
        values: {
          unitId: structure.cseUnitId,
          userId: member1.id,
          roleDefinitionId: headRole1.id,
          scope: "NODE",
        },
      });
      const second = await assignRoleToUser({
        ...context,
        values: {
          unitId: structure.cseUnitId,
          userId: member2.id,
          roleDefinitionId: headRole2.id,
          scope: "NODE",
        },
      });
      expect(second.status).toBe("error");
      expect(second.message).toContain("already has a head");
    });
  });

  test("6.10 assigning isUnitHead role on unit with no head succeeds", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context, tenant, actor } = await setupActor(tracker);
      const structure = await createPublishedStructure(context);
      const headRole = await createRole(context, {
        roleKey: "HOD",
        displayLabel: "Head of Department",
        isUnitHead: true,
      });
      const member = await createTestUser(tracker);
      await createTestMembership({
        tenantId: tenant.id,
        userId: member.id,
        role: "TENANT_USER",
        createdByUserId: actor.id,
      });

      const result = await assignRoleToUser({
        ...context,
        values: {
          unitId: structure.cseUnitId,
          userId: member.id,
          roleDefinitionId: headRole.id,
          scope: "NODE",
        },
      });
      expect(result.status).toBe("success");
    });
  });

  test("6.11 allows multiple non-head roles for same user in same unit", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context, tenant, actor } = await setupActor(tracker);
      const structure = await createPublishedStructure(context);
      const role1 = await createRole(context, {
        roleKey: "STAFF",
        displayLabel: "Staff",
      });
      const role2 = await createRole(context, {
        roleKey: "COORD",
        displayLabel: "Coordinator",
      });
      const member = await createTestUser(tracker);
      await createTestMembership({
        tenantId: tenant.id,
        userId: member.id,
        role: "TENANT_USER",
        createdByUserId: actor.id,
      });

      const first = await assignRoleToUser({
        ...context,
        values: {
          unitId: structure.cseUnitId,
          userId: member.id,
          roleDefinitionId: role1.id,
          scope: "NODE",
        },
      });
      const second = await assignRoleToUser({
        ...context,
        values: {
          unitId: structure.cseUnitId,
          userId: member.id,
          roleDefinitionId: role2.id,
          scope: "NODE",
        },
      });
      expect(first.status).toBe("success");
      expect(second.status).toBe("success");
    });
  });

  test("6.12 allows assigning same user across different units", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context, tenant, actor } = await setupActor(tracker);
      const structure = await createPublishedStructure(context);
      const role = await createRole(context, {
        roleKey: "STAFF",
        displayLabel: "Staff",
      });
      const member = await createTestUser(tracker);
      await createTestMembership({
        tenantId: tenant.id,
        userId: member.id,
        role: "TENANT_USER",
        createdByUserId: actor.id,
      });

      const first = await assignRoleToUser({
        ...context,
        values: {
          unitId: structure.rootUnitId,
          userId: member.id,
          roleDefinitionId: role.id,
          scope: "NODE",
        },
      });
      const second = await assignRoleToUser({
        ...context,
        values: {
          unitId: structure.cseUnitId,
          userId: member.id,
          roleDefinitionId: role.id,
          scope: "NODE",
        },
      });

      expect(first.status).toBe("success");
      expect(second.status).toBe("success");
    });
  });

  test("6.13 removeRoleAssignment removes assignment successfully", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context, tenant, actor } = await setupActor(tracker);
      const structure = await createPublishedStructure(context);
      const role = await createRole(context, {
        roleKey: "STAFF",
        displayLabel: "Staff",
      });
      const member = await createTestUser(tracker);
      await createTestMembership({
        tenantId: tenant.id,
        userId: member.id,
        role: "TENANT_USER",
        createdByUserId: actor.id,
      });
      await assignRoleToUser({
        ...context,
        values: {
          unitId: structure.cseUnitId,
          userId: member.id,
          roleDefinitionId: role.id,
          scope: "NODE",
        },
      });
      const assignment = await prisma.orgRoleAssignment.findFirst({
        where: { unitId: structure.cseUnitId, userId: member.id, roleDefinitionId: role.id },
      });
      expect(assignment).toBeTruthy();

      const removed = await removeRoleAssignment({
        ...context,
        assignmentId: assignment!.id,
      });
      expect(removed.status).toBe("success");
      const stillThere = await prisma.orgRoleAssignment.findUnique({
        where: { id: assignment!.id },
      });
      expect(stillThere).toBeNull();
    });
  });

  test("6.14 removing last role also removes UserOrgAssignment", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context, tenant, actor } = await setupActor(tracker);
      const structure = await createPublishedStructure(context);
      const role = await createRole(context, {
        roleKey: "COORD",
        displayLabel: "Coordinator",
      });
      const member = await createTestUser(tracker);
      await createTestMembership({
        tenantId: tenant.id,
        userId: member.id,
        role: "TENANT_USER",
        createdByUserId: actor.id,
      });
      await assignRoleToUser({
        ...context,
        values: {
          unitId: structure.cseUnitId,
          userId: member.id,
          roleDefinitionId: role.id,
          scope: "NODE",
        },
      });
      const assignment = await prisma.orgRoleAssignment.findFirst({
        where: {
          unitId: structure.cseUnitId,
          userId: member.id,
          roleDefinitionId: role.id,
        },
      });
      expect(assignment).toBeTruthy();

      const result = await removeRoleAssignment({
        ...context,
        assignmentId: assignment!.id,
      });
      expect(result.status).toBe("success");

      const placement = await prisma.userOrgAssignment.findFirst({
        where: {
          versionId: structure.versionId,
          unitId: structure.cseUnitId,
          userId: member.id,
        },
      });
      expect(placement).toBeNull();
    });
  });

  test("6.15 removing one of multiple roles keeps UserOrgAssignment", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context, tenant, actor } = await setupActor(tracker);
      const structure = await createPublishedStructure(context);
      const role1 = await createRole(context, { roleKey: "STAFF", displayLabel: "Staff" });
      const role2 = await createRole(context, { roleKey: "COORD", displayLabel: "Coordinator" });
      const member = await createTestUser(tracker);
      await createTestMembership({
        tenantId: tenant.id,
        userId: member.id,
        role: "TENANT_USER",
        createdByUserId: actor.id,
      });

      await assignRoleToUser({
        ...context,
        values: { unitId: structure.cseUnitId, userId: member.id, roleDefinitionId: role1.id, scope: "NODE" },
      });
      await assignRoleToUser({
        ...context,
        values: { unitId: structure.cseUnitId, userId: member.id, roleDefinitionId: role2.id, scope: "NODE" },
      });
      const assignment = await prisma.orgRoleAssignment.findFirst({
        where: { unitId: structure.cseUnitId, userId: member.id, roleDefinitionId: role1.id },
      });
      expect(assignment).toBeTruthy();

      await removeRoleAssignment({
        ...context,
        assignmentId: assignment!.id,
      });

      const placement = await prisma.userOrgAssignment.findFirst({
        where: { versionId: structure.versionId, unitId: structure.cseUnitId, userId: member.id },
      });
      expect(placement).toBeTruthy();
    });
  });

  test("6.16 removeRoleAssignment rejects assignment from another tenant", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context: t1Context } = await setupActor(tracker);
      const { context: t2Context, tenant: t2Tenant, actor: t2Actor } = await setupActor(tracker);
      const t2Structure = await createPublishedStructure(t2Context);
      const t2Role = await createRole(t2Context, {
        roleKey: "STAFF",
        displayLabel: "Staff",
      });
      const t2User = await createTestUser(tracker);
      await createTestMembership({
        tenantId: t2Tenant.id,
        userId: t2User.id,
        role: "TENANT_USER",
        createdByUserId: t2Actor.id,
      });
      await assignRoleToUser({
        ...t2Context,
        values: {
          unitId: t2Structure.cseUnitId,
          userId: t2User.id,
          roleDefinitionId: t2Role.id,
          scope: "NODE",
        },
      });

      const foreignAssignment = await prisma.orgRoleAssignment.findFirst({
        where: { unitId: t2Structure.cseUnitId, userId: t2User.id, roleDefinitionId: t2Role.id },
      });
      expect(foreignAssignment).toBeTruthy();

      const result = await removeRoleAssignment({
        ...t1Context,
        assignmentId: foreignAssignment!.id,
      });
      expect(result.status).toBe("error");
      expect(result.message).toContain("does not belong");
    });
  });

  test("6.17 getUnitMembers returns members sorted by role sortOrder", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context, tenant, actor } = await setupActor(tracker);
      const structure = await createPublishedStructure(context);
      const headRole = await createRole(context, {
        roleKey: "HOD",
        displayLabel: "Head",
        isUnitHead: true,
        sortOrder: 0,
      });
      const staffRole = await createRole(context, {
        roleKey: "STAFF",
        displayLabel: "Staff",
        sortOrder: 10,
      });
      const head = await createTestUser(tracker, {
        firstName: "Head",
        lastName: "User",
      });
      const staff = await createTestUser(tracker, {
        firstName: "Staff",
        lastName: "User",
      });
      await createTestMembership({
        tenantId: tenant.id,
        userId: head.id,
        role: "TENANT_USER",
        createdByUserId: actor.id,
      });
      await createTestMembership({
        tenantId: tenant.id,
        userId: staff.id,
        role: "TENANT_USER",
        createdByUserId: actor.id,
      });
      await assignRoleToUser({
        ...context,
        values: {
          unitId: structure.cseUnitId,
          userId: head.id,
          roleDefinitionId: headRole.id,
          scope: "NODE",
        },
      });
      await assignRoleToUser({
        ...context,
        values: {
          unitId: structure.cseUnitId,
          userId: staff.id,
          roleDefinitionId: staffRole.id,
          scope: "NODE",
        },
      });

      const members = await getUnitMembers(context.tenantId, structure.cseUnitId);
      expect(members).toHaveLength(2);
      expect(members[0]?.roleKey).toBe("HOD");
      expect(members[1]?.roleKey).toBe("STAFF");
    });
  });

  test("6.18 getUserAssignments returns assignments across units", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context, tenant, actor } = await setupActor(tracker);
      const structure = await createPublishedStructure(context);
      const role = await createRole(context, {
        roleKey: "STAFF",
        displayLabel: "Staff",
      });
      const member = await createTestUser(tracker);
      await createTestMembership({
        tenantId: tenant.id,
        userId: member.id,
        role: "TENANT_USER",
        createdByUserId: actor.id,
      });

      await assignRoleToUser({
        ...context,
        values: {
          unitId: structure.rootUnitId,
          userId: member.id,
          roleDefinitionId: role.id,
          scope: "NODE",
        },
      });
      await assignRoleToUser({
        ...context,
        values: {
          unitId: structure.cseUnitId,
          userId: member.id,
          roleDefinitionId: role.id,
          scope: "NODE",
        },
      });

      const assignments = await getUserAssignments(context.tenantId, member.id);
      expect(assignments).toHaveLength(2);
      expect(new Set(assignments.map((a) => a.unitId)).size).toBe(2);
    });
  });

  test("7.1 approval chain returns leaf-to-root when heads exist", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context, tenant, actor } = await setupActor(tracker);
      const structure = await createPublishedStructure(context);
      const headRole = await createRole(context, {
        roleKey: "HOD",
        displayLabel: "Head",
        isUnitHead: true,
      });
      const rootHead = await createTestUser(tracker, {
        firstName: "Root",
        lastName: "Head",
      });
      const deptHead = await createTestUser(tracker, {
        firstName: "Dept",
        lastName: "Head",
      });
      await createTestMembership({
        tenantId: tenant.id,
        userId: rootHead.id,
        role: "TENANT_USER",
        createdByUserId: actor.id,
      });
      await createTestMembership({
        tenantId: tenant.id,
        userId: deptHead.id,
        role: "TENANT_USER",
        createdByUserId: actor.id,
      });
      await assignRoleToUser({
        ...context,
        values: {
          unitId: structure.rootUnitId,
          userId: rootHead.id,
          roleDefinitionId: headRole.id,
          scope: "NODE",
        },
      });
      await assignRoleToUser({
        ...context,
        values: {
          unitId: structure.cseUnitId,
          userId: deptHead.id,
          roleDefinitionId: headRole.id,
          scope: "NODE",
        },
      });

      const chain = await getApprovalChain(context.tenantId, structure.cseUnitId);
      expect(chain).toHaveLength(2);
      expect(chain[0]?.unitId).toBe(structure.cseUnitId);
      expect(chain[1]?.unitId).toBe(structure.rootUnitId);
      expect(chain[0]?.headUserId).toBe(deptHead.id);
      expect(chain[1]?.headUserId).toBe(rootHead.id);
    });
  });

  test("7.2 approval chain includes null head for intermediate unit with no head", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context, tenant, actor } = await setupActor(tracker);
      const structure = await createPublishedStructure(context);
      const headRole = await createRole(context, {
        roleKey: "HOD",
        displayLabel: "Head",
        isUnitHead: true,
      });
      const rootHead = await createTestUser(tracker);
      await createTestMembership({
        tenantId: tenant.id,
        userId: rootHead.id,
        role: "TENANT_USER",
        createdByUserId: actor.id,
      });
      await assignRoleToUser({
        ...context,
        values: {
          unitId: structure.rootUnitId,
          userId: rootHead.id,
          roleDefinitionId: headRole.id,
          scope: "NODE",
        },
      });

      const chain = await getApprovalChain(context.tenantId, structure.cseUnitId);
      expect(chain).toHaveLength(2);
      expect(chain[0]?.unitId).toBe(structure.cseUnitId);
      expect(chain[0]?.headUserId).toBeNull();
      expect(chain[1]?.headUserId).toBe(rootHead.id);
    });
  });

  test("7.3 approval chain skips inactive intermediate unit", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context, tenant, actor } = await setupActor(tracker);
      const structure = await createPublishedStructure(context);
      await prisma.orgUnit.update({
        where: { id: structure.cseUnitId },
        data: { state: "INACTIVE" },
      });
      const headRole = await createRole(context, {
        roleKey: "HOD",
        displayLabel: "Head",
        isUnitHead: true,
      });
      const rootHead = await createTestUser(tracker);
      await createTestMembership({
        tenantId: tenant.id,
        userId: rootHead.id,
        role: "TENANT_USER",
        createdByUserId: actor.id,
      });
      await assignRoleToUser({
        ...context,
        values: {
          unitId: structure.rootUnitId,
          userId: rootHead.id,
          roleDefinitionId: headRole.id,
          scope: "NODE",
        },
      });

      const chain = await getApprovalChain(context.tenantId, structure.cseUnitId);
      expect(chain).toHaveLength(1);
      expect(chain[0]?.unitId).toBe(structure.rootUnitId);
    });
  });

  test("7.4 approval chain from root contains only root", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      const structure = await createPublishedStructure(context);
      const chain = await getApprovalChain(context.tenantId, structure.rootUnitId);
      expect(chain).toHaveLength(1);
      expect(chain[0]?.unitId).toBe(structure.rootUnitId);
    });
  });

  test("7.6 and 7.7 approval chain handles 5+ levels in leaf-to-root order", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context, tenant, actor } = await setupActor(tracker);
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

      const draft = await prisma.orgStructureVersion.findFirst({
        where: { tenantId: context.tenantId, state: "DRAFT" },
        include: { unitTypes: true },
      });
      const rootType = draft!.unitTypes.find((t) => t.typeKey === "ROOT")!;
      const nodeType = draft!.unitTypes.find((t) => t.typeKey === "NODE")!;
      await createOrgUnit({
        ...context,
        values: { typeId: rootType.id, code: "L0", name: "Level 0" },
      });
      let parent = await prisma.orgUnit.findFirst({
        where: { version: { tenantId: context.tenantId, state: "DRAFT" }, code: "L0" },
      });
      expect(parent).toBeTruthy();
      for (let i = 1; i <= 5; i += 1) {
        await createOrgUnit({
          ...context,
          values: {
            typeId: nodeType.id,
            code: `L${i}`,
            name: `Level ${i}`,
            parentId: parent!.id,
          },
        });
        parent = await prisma.orgUnit.findFirst({
          where: { version: { tenantId: context.tenantId, state: "DRAFT" }, code: `L${i}` },
        });
      }
      await validateOrgStructureDraft(context.tenantId);
      await publishOrgStructure(context);

      const headRole = await createRole(context, { roleKey: "HOD", displayLabel: "Head", isUnitHead: true });
      const version = await prisma.orgStructureVersion.findFirst({
        where: { tenantId: context.tenantId, state: "PUBLISHED" },
        include: { units: true },
      });
      for (const unit of version!.units) {
        const head = await createTestUser(tracker);
        await createTestMembership({
          tenantId: tenant.id,
          userId: head.id,
          role: "TENANT_USER",
          createdByUserId: actor.id,
        });
        await assignRoleToUser({
          ...context,
          values: { unitId: unit.id, userId: head.id, roleDefinitionId: headRole.id, scope: "NODE" },
        });
      }

      const leaf = version!.units.find((u) => u.code === "L5")!;
      const chain = await getApprovalChain(context.tenantId, leaf.id);
      expect(chain.length).toBe(6);
      expect(chain[0]?.unitCode).toBe("L5");
      expect(chain[chain.length - 1]?.unitCode).toBe("L0");
    });
  });

  test("7.5 approval chain is empty when no published version exists", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      const chain = await getApprovalChain(context.tenantId, "missing");
      expect(chain).toEqual([]);
    });
  });

  test("8.1 deriveReportingLines creates member->head and head->parent-head lines", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context, tenant, actor } = await setupActor(tracker);
      const structure = await createPublishedStructure(context);

      const headRole = await createRole(context, {
        roleKey: "HOD",
        displayLabel: "Head",
        isUnitHead: true,
      });
      const staffRole = await createRole(context, {
        roleKey: "STAFF",
        displayLabel: "Staff",
      });

      const rootHead = await createTestUser(tracker, { firstName: "Root", lastName: "Head" });
      const deptHead = await createTestUser(tracker, { firstName: "Dept", lastName: "Head" });
      const staff = await createTestUser(tracker, { firstName: "Dept", lastName: "Staff" });

      await createTestMembership({ tenantId: tenant.id, userId: rootHead.id, role: "TENANT_USER", createdByUserId: actor.id });
      await createTestMembership({ tenantId: tenant.id, userId: deptHead.id, role: "TENANT_USER", createdByUserId: actor.id });
      await createTestMembership({ tenantId: tenant.id, userId: staff.id, role: "TENANT_USER", createdByUserId: actor.id });

      await assignRoleToUser({
        ...context,
        values: { unitId: structure.rootUnitId, userId: rootHead.id, roleDefinitionId: headRole.id, scope: "NODE" },
      });
      await assignRoleToUser({
        ...context,
        values: { unitId: structure.cseUnitId, userId: deptHead.id, roleDefinitionId: headRole.id, scope: "NODE" },
      });
      await assignRoleToUser({
        ...context,
        values: { unitId: structure.cseUnitId, userId: staff.id, roleDefinitionId: staffRole.id, scope: "NODE" },
      });

      const result = await deriveReportingLines({
        tenantId: context.tenantId,
        versionId: structure.versionId,
        actorUserId: context.actorUserId,
        actorRole: context.actorRole,
      });
      expect(result.created).toBeGreaterThanOrEqual(2);

      const lines = await prisma.reportingLine.findMany({
        where: { versionId: structure.versionId },
      });
      expect(
        lines.some(
          (l) => l.managerUserId === deptHead.id && l.memberUserId === staff.id,
        ),
      ).toBe(true);
      expect(
        lines.some(
          (l) => l.managerUserId === rootHead.id && l.memberUserId === deptHead.id,
        ),
      ).toBe(true);
    });
  });

  test("8.2 deriveReportingLines warns when unit has members but no head", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context, tenant, actor } = await setupActor(tracker);
      const structure = await createPublishedStructure(context);
      const staffRole = await createRole(context, { roleKey: "STAFF", displayLabel: "Staff" });
      const member = await createTestUser(tracker);
      await createTestMembership({
        tenantId: tenant.id,
        userId: member.id,
        role: "TENANT_USER",
        createdByUserId: actor.id,
      });
      await assignRoleToUser({
        ...context,
        values: { unitId: structure.cseUnitId, userId: member.id, roleDefinitionId: staffRole.id, scope: "NODE" },
      });

      const result = await deriveReportingLines({
        tenantId: context.tenantId,
        versionId: structure.versionId,
        actorUserId: context.actorUserId,
        actorRole: context.actorRole,
      });
      expect(result.warnings.some((w) => w.includes("has members but no unit head"))).toBe(true);
    });
  });

  test("8.5 re-deriving reporting lines replaces previous lines", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      const structure = await createPublishedStructure(context);

      await prisma.reportingLine.create({
        data: {
          versionId: structure.versionId,
          unitId: structure.rootUnitId,
          managerUserId: context.actorUserId,
          memberUserId: context.actorUserId,
          lineType: "SOLID",
        },
      });

      const result = await deriveReportingLines({
        tenantId: context.tenantId,
        versionId: structure.versionId,
        actorUserId: context.actorUserId,
        actorRole: context.actorRole,
      });
      expect(result.created).toBe(0);

      const lines = await prisma.reportingLine.findMany({
        where: { versionId: structure.versionId },
      });
      expect(lines).toHaveLength(0);
    });
  });

  test("8.6 deriveReportingLines skips inactive units", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context, tenant, actor } = await setupActor(tracker);
      const structure = await createPublishedStructure(context);
      await prisma.orgUnit.update({
        where: { id: structure.cseUnitId },
        data: { state: "INACTIVE" },
      });
      const headRole = await createRole(context, { roleKey: "HOD", displayLabel: "Head", isUnitHead: true });
      const staffRole = await createRole(context, { roleKey: "STAFF", displayLabel: "Staff" });
      const head = await createTestUser(tracker);
      const staff = await createTestUser(tracker);
      await createTestMembership({ tenantId: tenant.id, userId: head.id, role: "TENANT_USER", createdByUserId: actor.id });
      await createTestMembership({ tenantId: tenant.id, userId: staff.id, role: "TENANT_USER", createdByUserId: actor.id });
      await assignRoleToUser({
        ...context,
        values: { unitId: structure.cseUnitId, userId: head.id, roleDefinitionId: headRole.id, scope: "NODE" },
      }).catch(() => undefined);
      await assignRoleToUser({
        ...context,
        values: { unitId: structure.cseUnitId, userId: staff.id, roleDefinitionId: staffRole.id, scope: "NODE" },
      }).catch(() => undefined);

      const result = await deriveReportingLines({
        tenantId: context.tenantId,
        versionId: structure.versionId,
        actorUserId: context.actorUserId,
        actorRole: context.actorRole,
      });
      expect(result.created).toBe(0);
    });
  });

  test("8.9 deriveReportingLines handles empty assignments with 0 lines", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      const structure = await createPublishedStructure(context);

      const result = await deriveReportingLines({
        tenantId: context.tenantId,
        versionId: structure.versionId,
        actorUserId: context.actorUserId,
        actorRole: context.actorRole,
      });

      expect(result.created).toBe(0);
      const lines = await prisma.reportingLine.findMany({
        where: { versionId: structure.versionId },
      });
      expect(lines).toHaveLength(0);
    });
  });

  test("8.10 deriveReportingLines writes audit log with counts", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupActor(tracker);
      const structure = await createPublishedStructure(context);

      await deriveReportingLines({
        tenantId: context.tenantId,
        versionId: structure.versionId,
        actorUserId: context.actorUserId,
        actorRole: context.actorRole,
      });

      const audit = await prisma.auditLog.findFirst({
        where: {
          tenantId: context.tenantId,
          action: "reporting_lines.derived",
          targetId: structure.versionId,
        },
        orderBy: { createdAt: "desc" },
      });
      expect(audit).toBeTruthy();
      expect(audit?.newState).toBeTruthy();
    });
  });
});
