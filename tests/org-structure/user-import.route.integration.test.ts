import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  createOrgUnit,
  createOrgUnitType,
  publishOrgStructure,
  validateOrgStructureDraft,
} from "@/lib/org-structure/service";
import { createRoleDefinition } from "@/lib/org-structure/roles-service";
import {
  cleanupTrackedData,
  createTenantActor,
  createTestMembership,
  createTestUser,
  newDbTracker,
  type DbTracker,
} from "../helpers/db";

const getServerSessionMock = vi.fn();

vi.mock("next-auth", () => ({
  default: vi.fn(() => ({})),
  getServerSession: getServerSessionMock,
}));

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

async function setupAdmin(tracker: DbTracker) {
  const { tenant, actor } = await createTenantActor(tracker, "TENANT_ADMIN");
  const context: ActorContext = {
    tenantId: tenant.id,
    actorUserId: actor.id,
    actorRole: "TENANT_ADMIN",
  };
  getServerSessionMock.mockResolvedValue({
    user: {
      id: actor.id,
      tenantId: tenant.id,
      role: "TENANT_ADMIN",
    },
  });
  return { tenant, actor, context };
}

async function createPublishedStructureWithTwoUnits(ctx: ActorContext) {
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
    values: {
      typeId: rootType.id,
      code: "UNIV",
      name: "University",
    },
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
}

async function createRole(ctx: ActorContext, roleKey: string, displayLabel: string, options?: { isUnitHead?: boolean; maxPerUnit?: number }) {
  const result = await createRoleDefinition({
    ...ctx,
    values: {
      roleKey,
      displayLabel,
      description: `${displayLabel} role`,
      isUnitHead: options?.isUnitHead ?? false,
      approvalAuthority: false,
      maxPerUnit: options?.maxPerUnit ?? -1,
      sortOrder: 1,
    },
  });
  expect(result.status).toBe("success");
}

function csvFile(content: string) {
  return new File([content], "user-role-import.csv", { type: "text/csv" });
}

async function postUserImport(formData: FormData) {
  const route = await import("@/app/api/tenant/structure/user-import/route");
  return route.POST(new Request("http://localhost", { method: "POST", body: formData }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("User Import Route Integration", () => {
  test("9.8 preview validates unit_code against published structure", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupAdmin(tracker);
      await createPublishedStructureWithTwoUnits(context);
      await createRole(context, "STAFF", "Staff");

      const formData = new FormData();
      formData.set("action", "preview");
      formData.set(
        "file",
        csvFile(
          "email,first_name,last_name,employee_id,unit_code,role_key\nalice@example.com,Alice,Walker,EMP001,UNKNOWN,STAFF",
        ),
      );

      const res = await postUserImport(formData);
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.data.rows[0].errors.join(" ")).toContain("Unit code");
    });
  });

  test("9.9 preview validates role_key against role definitions", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupAdmin(tracker);
      await createPublishedStructureWithTwoUnits(context);
      await createRole(context, "STAFF", "Staff");

      const formData = new FormData();
      formData.set("action", "preview");
      formData.set(
        "file",
        csvFile(
          "email,first_name,last_name,employee_id,unit_code,role_key\nalice@example.com,Alice,Walker,EMP001,CSE,UNKNOWN_ROLE",
        ),
      );

      const res = await postUserImport(formData);
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.data.rows[0].errors.join(" ")).toContain("Role key");
    });
  });

  test("9.10 confirm creates User record when user does not exist", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupAdmin(tracker);
      await createPublishedStructureWithTwoUnits(context);
      await createRole(context, "STAFF", "Staff");

      const formData = new FormData();
      formData.set("action", "confirm");
      formData.set(
        "file",
        csvFile(
          "email,first_name,last_name,employee_id,unit_code,role_key\nalice@example.com,Alice,Walker,EMP001,CSE,STAFF",
        ),
      );
      const res = await postUserImport(formData);
      expect(res.status).toBe(200);

      const user = await prisma.user.findUnique({
        where: { officialEmail: "alice@example.com" },
      });
      expect(user).toBeTruthy();
      expect(user?.lifecycleState).toBe("INVITED");
      if (user) tracker.userIds.add(user.id);
    });
  });

  test("9.11 confirm reuses existing user and does not duplicate", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupAdmin(tracker);
      await createPublishedStructureWithTwoUnits(context);
      await createRole(context, "STAFF", "Staff");
      const existing = await createTestUser(tracker, {
        firstName: "Alice",
        lastName: "Walker",
      });
      await prisma.user.update({
        where: { id: existing.id },
        data: { officialEmail: "alice@example.com" },
      });

      const formData = new FormData();
      formData.set("action", "confirm");
      formData.set(
        "file",
        csvFile(
          "email,first_name,last_name,employee_id,unit_code,role_key\nalice@example.com,Alice,Walker,EMP001,CSE,STAFF",
        ),
      );
      const res = await postUserImport(formData);
      expect(res.status).toBe(200);

      const users = await prisma.user.findMany({
        where: { officialEmail: "alice@example.com" },
      });
      expect(users).toHaveLength(1);
    });
  });

  test("9.12 and 9.13 membership create/skip behavior works", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context, tenant, actor } = await setupAdmin(tracker);
      await createPublishedStructureWithTwoUnits(context);
      await createRole(context, "STAFF", "Staff");

      const existing = await createTestUser(tracker, {
        firstName: "Bob",
        lastName: "Existing",
      });
      await prisma.user.update({
        where: { id: existing.id },
        data: { officialEmail: "bob@example.com" },
      });
      await createTestMembership({
        tenantId: tenant.id,
        userId: existing.id,
        role: "TENANT_USER",
        createdByUserId: actor.id,
      });

      const formData = new FormData();
      formData.set("action", "confirm");
      formData.set(
        "file",
        csvFile(
          [
            "email,first_name,last_name,employee_id,unit_code,role_key",
            "alice@example.com,Alice,Walker,EMP001,CSE,STAFF",
            "bob@example.com,Bob,Existing,EMP002,CSE,STAFF",
          ].join("\n"),
        ),
      );
      const res = await postUserImport(formData);
      expect(res.status).toBe(200);

      const alice = await prisma.user.findUnique({
        where: { officialEmail: "alice@example.com" },
      });
      expect(alice).toBeTruthy();
      if (alice) tracker.userIds.add(alice.id);

      const memberships = await prisma.membership.findMany({
        where: { tenantId: tenant.id },
      });
      const aliceMembership = memberships.find((m) => m.userId === alice?.id);
      const bobMemberships = memberships.filter((m) => m.userId === existing.id);
      expect(aliceMembership).toBeTruthy();
      expect(aliceMembership?.role).toBe("TENANT_USER");
      expect(bobMemberships).toHaveLength(1);
    });
  });

  test("9.14 confirm backfills employeeId when membership exists without one", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context, tenant, actor } = await setupAdmin(tracker);
      await createPublishedStructureWithTwoUnits(context);
      await createRole(context, "STAFF", "Staff");
      const user = await createTestUser(tracker);
      await prisma.user.update({
        where: { id: user.id },
        data: { officialEmail: "employee@example.com" },
      });
      const membership = await createTestMembership({
        tenantId: tenant.id,
        userId: user.id,
        role: "TENANT_USER",
        createdByUserId: actor.id,
      });
      expect(membership.employeeId).toBeNull();

      const formData = new FormData();
      formData.set("action", "confirm");
      formData.set(
        "file",
        csvFile(
          "email,first_name,last_name,employee_id,unit_code,role_key\nemployee@example.com,Emp,Loyee,EMP777,CSE,STAFF",
        ),
      );
      const res = await postUserImport(formData);
      expect(res.status).toBe(200);

      const updated = await prisma.membership.findUnique({
        where: { id: membership.id },
      });
      expect(updated?.employeeId).toBe("EMP777");
    });
  });

  test("9.15 confirm imports same user with different unit+role assignments", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupAdmin(tracker);
      await createPublishedStructureWithTwoUnits(context);
      await createRole(context, "STAFF", "Staff");
      await createRole(context, "COORD", "Coordinator");

      const formData = new FormData();
      formData.set("action", "confirm");
      formData.set(
        "file",
        csvFile(
          [
            "email,first_name,last_name,employee_id,unit_code,role_key",
            "alice@example.com,Alice,Walker,EMP001,CSE,STAFF",
            "alice@example.com,Alice,Walker,EMP001,EEE,COORD",
          ].join("\n"),
        ),
      );
      const res = await postUserImport(formData);
      expect(res.status).toBe(200);

      const user = await prisma.user.findUnique({
        where: { officialEmail: "alice@example.com" },
      });
      expect(user).toBeTruthy();
      if (user) tracker.userIds.add(user.id);

      const assignments = await prisma.orgRoleAssignment.findMany({
        where: { userId: user!.id },
      });
      expect(assignments).toHaveLength(2);
    });
  });

  test("9.16/9.17/9.18 confirm reports maxPerUnit, head conflict, and duplicate skips", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupAdmin(tracker);
      await createPublishedStructureWithTwoUnits(context);
      await createRole(context, "SINGLE", "Single Slot", { maxPerUnit: 1 });
      await createRole(context, "HOD", "Head", { isUnitHead: true, maxPerUnit: 1 });

      const formData = new FormData();
      formData.set("action", "confirm");
      formData.set(
        "file",
        csvFile(
          [
            "email,first_name,last_name,employee_id,unit_code,role_key",
            "u1@example.com,U,One,E1,CSE,SINGLE",
            "u2@example.com,U,Two,E2,CSE,SINGLE",
            "h1@example.com,H,One,E3,CSE,HOD",
            "h2@example.com,H,Two,E4,CSE,HOD",
            "u1@example.com,U,One,E1,CSE,SINGLE",
          ].join("\n"),
        ),
      );
      const res = await postUserImport(formData);
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.details.created).toBeGreaterThan(0);
      expect(json.details.errors.length).toBeGreaterThan(0);
      expect(json.details.skipped).toBeGreaterThanOrEqual(1);

      const audit = await prisma.auditLog.findFirst({
        where: {
          tenantId: context.tenantId,
          action: "user_role.bulk_import",
        },
        orderBy: { createdAt: "desc" },
      });
      expect(audit).toBeTruthy();
    });
  });

  test("9.20 confirm creates audit log with import counts", async () => {
    await withIsolatedDb(async (tracker) => {
      const { context } = await setupAdmin(tracker);
      await createPublishedStructureWithTwoUnits(context);
      await createRole(context, "STAFF", "Staff");

      const formData = new FormData();
      formData.set("action", "confirm");
      formData.set(
        "file",
        csvFile(
          "email,first_name,last_name,employee_id,unit_code,role_key\naudit@example.com,Audit,User,E1,CSE,STAFF",
        ),
      );
      const res = await postUserImport(formData);
      expect(res.status).toBe(200);

      const audit = await prisma.auditLog.findFirst({
        where: {
          tenantId: context.tenantId,
          action: "user_role.bulk_import",
        },
        orderBy: { createdAt: "desc" },
      });
      expect(audit).toBeTruthy();
      expect(audit?.newState).toBeTruthy();
    });
  });
});

