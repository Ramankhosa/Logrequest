import { afterEach, describe, expect, test } from "vitest";
import type { DbTracker } from "../helpers/db";
import {
  cleanupTrackedData,
  createTenantActor,
  newDbTracker,
} from "../helpers/db";
import { prisma } from "@/lib/prisma";
import { createPeriod } from "@/lib/kra-kpi/period-service";
import { createKra } from "@/lib/kra-kpi/kra-service";
import { createKpi } from "@/lib/kra-kpi/kpi-service";
import {
  archiveContributorRole,
  createContributorRole,
  getApplicableRoles,
  setApplicableRoles,
  updateContributorRole,
} from "@/lib/kra-kpi/contributor-role-service";

let tracker: DbTracker | null = null;

afterEach(async () => {
  if (tracker) {
    await cleanupTrackedData(tracker);
    tracker = null;
  }
});

function rand(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

async function createFixture() {
  tracker ??= newDbTracker();
  const { tenant, actor } = await createTenantActor(tracker, "TENANT_OWNER");

  const version = await prisma.orgStructureVersion.create({
    data: {
      tenantId: tenant.id,
      name: rand("VERSION"),
      versionNumber: 1,
      state: "PUBLISHED",
    },
  });
  const unitType = await prisma.orgUnitType.create({
    data: {
      versionId: version.id,
      typeKey: rand("DEPT"),
      internalCategory: "DEPARTMENT_LIKE_UNIT",
      displayLabel: "Department",
    },
  });
  const startingUnit = await prisma.orgUnit.create({
    data: {
      tenantId: tenant.id,
      versionId: version.id,
      typeId: unitType.id,
      code: rand("UNIT"),
      name: "Starting Unit",
      state: "ACTIVE",
    },
  });

  const periodCode = rand("PERIOD");
  const periodResult = await createPeriod(
    tenant.id,
    {
      name: "R4.1a Period",
      code: periodCode,
      periodType: "SPECIFIC_RANGE",
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      endDate: new Date("2026-12-31T00:00:00.000Z"),
      reviewFrequency: "ANNUAL",
    },
    actor.id,
    "TENANT_OWNER",
  );
  expect(periodResult.status).toBe("success");

  const period = await prisma.assessmentPeriod.findUnique({
    where: {
      tenantId_code: {
        tenantId: tenant.id,
        code: periodCode,
      },
    },
  });
  expect(period).toBeTruthy();

  const kraTitle = rand("KRA");
  const kraResult = await createKra(
    tenant.id,
    {
      periodId: period!.id,
      title: kraTitle,
      weightage: 100,
    },
    actor.id,
    "TENANT_OWNER",
  );
  expect(kraResult.status).toBe("success");

  const kra = await prisma.kraDefinition.findFirst({
    where: { tenantId: tenant.id, title: kraTitle },
  });
  expect(kra).toBeTruthy();

  const kpiTitle = rand("KPI");
  const kpiResult = await createKpi(
    tenant.id,
    {
      kraDefinitionId: kra!.id,
      title: kpiTitle,
      measurementType: "NUMERIC",
      weightage: 100,
      allocationType: "DEPARTMENT",
      startingUnitId: startingUnit.id,
    },
    actor.id,
    "TENANT_OWNER",
  );
  expect(kpiResult.status).toBe("success");

  const kpi = await prisma.kpiDefinition.findFirst({
    where: { kraDefinitionId: kra!.id, title: kpiTitle },
  });
  expect(kpi).toBeTruthy();

  return { tenant, actor, kpiId: kpi!.id };
}

async function createRole(input: {
  tenantId: string;
  actorUserId: string;
  code: string;
  name: string;
  defaultCreditPercent?: number;
}) {
  const result = await createContributorRole(
    input.tenantId,
    {
      code: input.code,
      name: input.name,
      defaultCreditPercent: input.defaultCreditPercent ?? 50,
    },
    input.actorUserId,
    "TENANT_OWNER",
  );
  expect(result.status).toBe("success");

  const saved = await prisma.contributorRole.findUnique({
    where: {
      tenantId_code: {
        tenantId: input.tenantId,
        code: input.code,
      },
    },
  });
  expect(saved).toBeTruthy();
  return saved!;
}

describe("R4.1a contributor role regressions", () => {
  test("setApplicableRoles rejects an empty role list", async () => {
    const { tenant, actor, kpiId } = await createFixture();

    const result = await setApplicableRoles(
      kpiId,
      tenant.id,
      { roles: [] },
      actor.id,
      "TENANT_OWNER",
    );

    expect(result.status).toBe("error");
    expect(result.code).toBe("APPLICABLE_ROLES_REQUIRED");
    expect(
      await prisma.kpiApplicableRole.count({ where: { kpiDefinitionId: kpiId } }),
    ).toBe(0);
  });

  test("archiving a linked role removes KPI links and promotes another default", async () => {
    const { tenant, actor, kpiId } = await createFixture();
    const defaultRole = await createRole({
      tenantId: tenant.id,
      actorUserId: actor.id,
      code: "PRIMARY_ARCHIVE",
      name: "Primary Role",
    });
    const backupRole = await createRole({
      tenantId: tenant.id,
      actorUserId: actor.id,
      code: "BACKUP_ARCHIVE",
      name: "Backup Role",
    });

    const linked = await setApplicableRoles(
      kpiId,
      tenant.id,
      {
        roles: [
          { roleId: defaultRole.id, isDefault: true, sortOrder: 0 },
          { roleId: backupRole.id, isDefault: false, sortOrder: 1 },
        ],
      },
      actor.id,
      "TENANT_OWNER",
    );
    expect(linked.status).toBe("success");

    const archived = await archiveContributorRole(
      defaultRole.id,
      tenant.id,
      actor.id,
      "TENANT_OWNER",
    );

    expect(archived.status).toBe("success");
    const role = await prisma.contributorRole.findUnique({
      where: { id: defaultRole.id },
    });
    expect(role?.isActive).toBe(false);

    const remaining = await getApplicableRoles(kpiId, tenant.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(backupRole.id);
    expect(remaining[0]?.linkIsDefault).toBe(true);
  });

  test("deactivating via update also removes KPI links and preserves a default", async () => {
    const { tenant, actor, kpiId } = await createFixture();
    const defaultRole = await createRole({
      tenantId: tenant.id,
      actorUserId: actor.id,
      code: "PRIMARY_UPDATE",
      name: "Primary Role",
    });
    const backupRole = await createRole({
      tenantId: tenant.id,
      actorUserId: actor.id,
      code: "BACKUP_UPDATE",
      name: "Backup Role",
    });

    await setApplicableRoles(
      kpiId,
      tenant.id,
      {
        roles: [
          { roleId: defaultRole.id, isDefault: true, sortOrder: 0 },
          { roleId: backupRole.id, isDefault: false, sortOrder: 1 },
        ],
      },
      actor.id,
      "TENANT_OWNER",
    );

    const updated = await updateContributorRole(
      defaultRole.id,
      tenant.id,
      { isActive: false },
      actor.id,
      "TENANT_OWNER",
    );

    expect(updated.status).toBe("success");
    const remaining = await getApplicableRoles(kpiId, tenant.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(backupRole.id);
    expect(remaining[0]?.linkIsDefault).toBe(true);
  });

  test("archiving is blocked when the role is the only active applicable role", async () => {
    const { tenant, actor, kpiId } = await createFixture();
    const onlyRole = await createRole({
      tenantId: tenant.id,
      actorUserId: actor.id,
      code: "ONLY_ROLE",
      name: "Only Role",
    });

    await setApplicableRoles(
      kpiId,
      tenant.id,
      {
        roles: [{ roleId: onlyRole.id, isDefault: true, sortOrder: 0 }],
      },
      actor.id,
      "TENANT_OWNER",
    );

    const archived = await archiveContributorRole(
      onlyRole.id,
      tenant.id,
      actor.id,
      "TENANT_OWNER",
    );

    expect(archived.status).toBe("error");
    expect(archived.code).toBe("ROLE_LAST_APPLICABLE");
    expect(
      await prisma.kpiApplicableRole.count({
        where: { kpiDefinitionId: kpiId, contributorRoleId: onlyRole.id },
      }),
    ).toBe(1);
  });
});
