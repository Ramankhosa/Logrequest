import { TenantFeatureCode, TenantServiceCode } from "@prisma/client";
import { describe, expect, test } from "vitest";
import {
  hasTenantFeatureEnabled,
  listEnabledTenantFeatureCodes,
  setTenantFeatureEntitlement,
  setTenantServiceEntitlement,
} from "@/lib/tenant-services/service";
import {
  cleanupTrackedData,
  createTenantActor,
  enableTenantService,
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

describe("tenant feature entitlements", () => {
  test("missing feature entitlement defaults to disabled", async () => {
    await withIsolatedDb(async (tracker) => {
      const { tenant, actor } = await createTenantActor(tracker, "TENANT_OWNER");

      await enableTenantService({
        tenantId: tenant.id,
        serviceCode: TenantServiceCode.ACCREDITATION,
        actorUserId: actor.id,
      });

      await expect(
        hasTenantFeatureEnabled(tenant.id, TenantFeatureCode.ACCREDITATION_COPILOT),
      ).resolves.toBe(false);
      await expect(listEnabledTenantFeatureCodes(tenant.id)).resolves.toEqual([]);
    });
  });

  test("feature access depends on the parent service and restores after re-enable", async () => {
    await withIsolatedDb(async (tracker) => {
      const { tenant, actor } = await createTenantActor(tracker, "TENANT_OWNER");

      const enableFeatureResult = await setTenantFeatureEntitlement({
        tenantId: tenant.id,
        featureCode: TenantFeatureCode.ACCREDITATION_COPILOT,
        enabled: true,
        actorUserId: actor.id,
        actorRole: "SUPERADMIN",
      });
      expect(enableFeatureResult).toMatchObject({ status: "success" });

      await expect(
        hasTenantFeatureEnabled(tenant.id, TenantFeatureCode.ACCREDITATION_COPILOT),
      ).resolves.toBe(false);

      const enableServiceResult = await setTenantServiceEntitlement({
        tenantId: tenant.id,
        serviceCode: TenantServiceCode.ACCREDITATION,
        enabled: true,
        actorUserId: actor.id,
        actorRole: "SUPERADMIN",
      });
      expect(enableServiceResult).toMatchObject({ status: "success" });

      await expect(
        hasTenantFeatureEnabled(tenant.id, TenantFeatureCode.ACCREDITATION_COPILOT),
      ).resolves.toBe(true);
      await expect(listEnabledTenantFeatureCodes(tenant.id)).resolves.toEqual([
        TenantFeatureCode.ACCREDITATION_COPILOT,
      ]);

      const disableServiceResult = await setTenantServiceEntitlement({
        tenantId: tenant.id,
        serviceCode: TenantServiceCode.ACCREDITATION,
        enabled: false,
        actorUserId: actor.id,
        actorRole: "SUPERADMIN",
      });
      expect(disableServiceResult).toMatchObject({ status: "success" });

      await expect(
        hasTenantFeatureEnabled(tenant.id, TenantFeatureCode.ACCREDITATION_COPILOT),
      ).resolves.toBe(false);
      await expect(listEnabledTenantFeatureCodes(tenant.id)).resolves.toEqual([]);

      const reenableServiceResult = await setTenantServiceEntitlement({
        tenantId: tenant.id,
        serviceCode: TenantServiceCode.ACCREDITATION,
        enabled: true,
        actorUserId: actor.id,
        actorRole: "SUPERADMIN",
      });
      expect(reenableServiceResult).toMatchObject({ status: "success" });

      await expect(
        hasTenantFeatureEnabled(tenant.id, TenantFeatureCode.ACCREDITATION_COPILOT),
      ).resolves.toBe(true);
      await expect(listEnabledTenantFeatureCodes(tenant.id)).resolves.toEqual([
        TenantFeatureCode.ACCREDITATION_COPILOT,
      ]);
    });
  });
});
