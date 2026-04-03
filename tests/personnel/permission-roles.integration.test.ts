import { describe, expect, test } from "vitest";
import { TenantPermissionRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  getTenantPermissionAccessContext,
  hasTenantCapability,
  replaceTenantPermissionAssignments,
} from "@/lib/tenant-permissions/service";
import {
  cleanupTrackedData,
  createTenantActor,
  createTestMembership,
  createTestUser,
  newDbTracker,
  type DbTracker,
} from "../helpers/db";

async function withIsolatedDb(run: (tracker: DbTracker) => Promise<void>) {
  const tracker = newDbTracker();
  try {
    await run(tracker);
  } finally {
    await cleanupTrackedData(tracker);
  }
}

describe("tenant permission role assignments", () => {
  test("roles are additive, access admins can delegate, and separated users lose built-in capabilities", async () => {
    await withIsolatedDb(async (tracker) => {
      const { tenant, actor } = await createTenantActor(tracker, "TENANT_OWNER");

      const accessAdminUser = await createTestUser(tracker, {
        firstName: "Access",
        lastName: "Admin",
      });
      const editorUser = await createTestUser(tracker, {
        firstName: "Kpi",
        lastName: "Editor",
      });

      const accessMembership = await createTestMembership({
        tenantId: tenant.id,
        userId: accessAdminUser.id,
        role: "TENANT_USER",
        createdByUserId: actor.id,
      });
      const editorMembership = await createTestMembership({
        tenantId: tenant.id,
        userId: editorUser.id,
        role: "TENANT_USER",
        createdByUserId: actor.id,
      });

      const grantAccessAdmin = await replaceTenantPermissionAssignments({
        tenantId: tenant.id,
        actorUserId: actor.id,
        actorRole: "TENANT_OWNER",
        targetUserId: accessAdminUser.id,
        roleCodes: [TenantPermissionRole.ACCESS_ADMIN],
      });
      expect(grantAccessAdmin).toMatchObject({ status: "success" });

      const delegatedGrant = await replaceTenantPermissionAssignments({
        tenantId: tenant.id,
        actorUserId: accessAdminUser.id,
        actorRole: "TENANT_USER",
        targetUserId: editorUser.id,
        roleCodes: [
          TenantPermissionRole.KPI_EDITOR,
          TenantPermissionRole.WORKFLOW_MANAGER,
        ],
      });
      expect(delegatedGrant).toMatchObject({ status: "success" });

      const editorAccess = await getTenantPermissionAccessContext({
        tenantId: tenant.id,
        userId: editorUser.id,
        baseRole: "TENANT_USER",
      });
      expect(editorAccess.permissionRoles).toEqual([
        TenantPermissionRole.KPI_EDITOR,
        TenantPermissionRole.WORKFLOW_MANAGER,
      ]);
      expect(editorAccess.capabilities).toEqual(
        expect.arrayContaining(["MANAGE_KPI", "MANAGE_WORKFLOW"]),
      );

      const accreditationGrant = await replaceTenantPermissionAssignments({
        tenantId: tenant.id,
        actorUserId: actor.id,
        actorRole: "TENANT_OWNER",
        targetUserId: editorUser.id,
        roleCodes: [
          TenantPermissionRole.KPI_EDITOR,
          TenantPermissionRole.WORKFLOW_MANAGER,
          TenantPermissionRole.ACCREDITATION_MANAGER,
        ],
      });
      expect(accreditationGrant).toMatchObject({ status: "success" });

      expect(
        await hasTenantCapability({
          tenantId: tenant.id,
          userId: editorUser.id,
          baseRole: "TENANT_USER",
          capability: "MANAGE_ACCREDITATION",
        }),
      ).toBe(true);

      const selfGrantBlocked = await replaceTenantPermissionAssignments({
        tenantId: tenant.id,
        actorUserId: accessAdminUser.id,
        actorRole: "TENANT_USER",
        targetUserId: accessAdminUser.id,
        roleCodes: [TenantPermissionRole.ACCESS_ADMIN],
      });
      expect(selfGrantBlocked).toMatchObject({
        status: "error",
      });
      expect(selfGrantBlocked.message).toContain("Access Admin role");

      await prisma.membership.update({
        where: { id: editorMembership.id },
        data: { personnelStatus: "SEPARATED" },
      });

      expect(
        await hasTenantCapability({
          tenantId: tenant.id,
          userId: editorUser.id,
          baseRole: "TENANT_USER",
          capability: "MANAGE_KPI",
        }),
      ).toBe(false);

      const accessAdminMembership = await prisma.membership.findUniqueOrThrow({
        where: { id: accessMembership.id },
        select: { status: true },
      });
      expect(accessAdminMembership.status).toBe("ACTIVE");
    });
  });
});
