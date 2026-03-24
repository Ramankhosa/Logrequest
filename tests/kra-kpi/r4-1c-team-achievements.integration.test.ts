import { afterEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { createPeriod } from "@/lib/kra-kpi/period-service";
import { createKra } from "@/lib/kra-kpi/kra-service";
import { createKpi } from "@/lib/kra-kpi/kpi-service";
import {
  createContributorRole,
  getApplicableRoles,
  setApplicableRoles,
} from "@/lib/kra-kpi/contributor-role-service";
import { setConfig } from "@/lib/kra-kpi/kpi-contributor-config-service";
import {
  recordAchievement,
  submitForVerification,
  updateAchievement,
} from "@/lib/kra-kpi/achievement-service";
import {
  cleanupTrackedData,
  createTenantActor,
  createTestMembership,
  createTestUser,
  newDbTracker,
  type DbTracker,
} from "../helpers/db";

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
  const faculty = await createTestUser(tracker, { firstName: "Raman", lastName: "Faculty" });
  const collaborator = await createTestUser(tracker, { firstName: "Anita", lastName: "Contributor" });

  await createTestMembership({
    tenantId: tenant.id,
    userId: faculty.id,
    role: "TENANT_USER",
    createdByUserId: actor.id,
  });
  await createTestMembership({
    tenantId: tenant.id,
    userId: collaborator.id,
    role: "TENANT_USER",
    createdByUserId: actor.id,
  });

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
  const unit = await prisma.orgUnit.create({
    data: {
      tenantId: tenant.id,
      versionId: version.id,
      typeId: unitType.id,
      code: rand("UNIT"),
      name: "Computer Science",
      state: "ACTIVE",
    },
  });

  for (const userId of [actor.id, faculty.id, collaborator.id]) {
    await prisma.userOrgAssignment.create({
      data: {
        versionId: version.id,
        userId,
        unitId: unit.id,
        isPrimary: true,
      },
    });
  }

  const periodCode = rand("PERIOD");
  const periodResult = await createPeriod(
    tenant.id,
    {
      name: "R4.1c Period",
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
  await prisma.kraDefinition.update({
    where: { id: kra!.id },
    data: { state: "ACTIVE" },
  });

  const kpiTitle = rand("KPI");
  const kpiResult = await createKpi(
    tenant.id,
    {
      kraDefinitionId: kra!.id,
      title: kpiTitle,
      measurementType: "NUMERIC",
      weightage: 100,
      allocationType: "INDIVIDUAL",
      startingUnitId: unit.id,
      defaultTarget: 100,
      evidenceRequired: true,
    },
    actor.id,
    "TENANT_OWNER",
  );
  expect(kpiResult.status).toBe("success");

  const kpi = await prisma.kpiDefinition.findFirst({
    where: { kraDefinitionId: kra!.id, title: kpiTitle },
  });
  expect(kpi).toBeTruthy();
  await prisma.kpiDefinition.update({
    where: { id: kpi!.id },
    data: { state: "ACTIVE" },
  });

  await prisma.assessmentPeriod.update({
    where: { id: period!.id },
    data: { state: "IN_PROGRESS" },
  });

  const allocation = await prisma.targetAllocation.create({
    data: {
      tenantId: tenant.id,
      periodId: period!.id,
      kpiDefinitionId: kpi!.id,
      assignedToUserId: faculty.id,
      allocatedByUserId: actor.id,
      targetValue: 100,
      state: "ACTIVE",
    },
  });

  return {
    tenant,
    actor,
    faculty,
    collaborator,
    period: period!,
    kpi: kpi!,
    allocation,
  };
}

describe("R4.1c team achievements", () => {
  test("createKpi seeds a baseline applicable role and recordAchievement auto-adds a starter contributor", async () => {
    const fixture = await createFixture();

    const applicableRoles = await getApplicableRoles(fixture.kpi.id, fixture.tenant.id);
    expect(applicableRoles).toHaveLength(1);
    expect(applicableRoles[0]?.code).toBe("MEMBER");
    expect(applicableRoles[0]?.linkIsDefault).toBe(true);

    const result = await recordAchievement(
      fixture.tenant.id,
      {
        periodId: fixture.period.id,
        kpiDefinitionId: fixture.kpi.id,
        targetAllocationId: fixture.allocation.id,
        actualValue: 80,
        evidenceLinks: ["https://example.com/evidence"],
      },
      fixture.faculty.id,
      "TENANT_USER",
    );

    expect(result.status).toBe("success");
    const achievement = await prisma.achievement.findUnique({
      where: { id: result.id! },
      include: {
        contributors: {
          include: {
            contributorRole: true,
          },
        },
      },
    });
    expect(achievement?.contributors).toHaveLength(1);
    expect(achievement?.contributors[0]?.userId).toBe(fixture.faculty.id);
    expect(achievement?.contributors[0]?.contributorRole.code).toBe("MEMBER");
    expect(achievement?.contributors[0]?.creditPercent).toBe(100);
    expect(achievement?.contributionRole).toBe("Team Member");
    expect(achievement?.creditPercent).toBe(100);
    expect(achievement?.effectiveScore).toBe(80);
  });

  test("submitForVerification blocks when the draft contributor list is emptied", async () => {
    const fixture = await createFixture();

    const created = await recordAchievement(
      fixture.tenant.id,
      {
        periodId: fixture.period.id,
        kpiDefinitionId: fixture.kpi.id,
        targetAllocationId: fixture.allocation.id,
        actualValue: 70,
        evidenceLinks: ["https://example.com/evidence"],
      },
      fixture.faculty.id,
      "TENANT_USER",
    );
    expect(created.status).toBe("success");

    const updated = await updateAchievement(
      created.id!,
      fixture.tenant.id,
      {
        contributors: [],
      },
      fixture.faculty.id,
      "TENANT_USER",
    );
    expect(updated.status).toBe("success");

    const submitResult = await submitForVerification(
      created.id!,
      fixture.tenant.id,
      fixture.faculty.id,
      "TENANT_USER",
    );
    expect(submitResult.status).toBe("error");
    expect(submitResult.code).toBe("CONTRIBUTORS_REQUIRED");
  });

  test("MAX_100 uses capped auto-credit normalization while effectiveScore stays unweighted", async () => {
    const fixture = await createFixture();

    const leadRole = await createContributorRole(
      fixture.tenant.id,
      {
        code: "LEAD_CAPPED",
        name: "Lead Role",
        defaultCreditPercent: 50,
      },
      fixture.actor.id,
      "TENANT_OWNER",
    );
    expect(leadRole.status).toBe("success");

    const supportRole = await createContributorRole(
      fixture.tenant.id,
      {
        code: "SUPPORT_CAPPED",
        name: "Support Role",
        defaultCreditPercent: 30,
      },
      fixture.actor.id,
      "TENANT_OWNER",
    );
    expect(supportRole.status).toBe("success");

    const lead = await prisma.contributorRole.findUnique({
      where: { tenantId_code: { tenantId: fixture.tenant.id, code: "LEAD_CAPPED" } },
    });
    const support = await prisma.contributorRole.findUnique({
      where: { tenantId_code: { tenantId: fixture.tenant.id, code: "SUPPORT_CAPPED" } },
    });
    expect(lead).toBeTruthy();
    expect(support).toBeTruthy();

    const applicable = await setApplicableRoles(
      fixture.kpi.id,
      fixture.tenant.id,
      {
        roles: [
          { roleId: lead!.id, isDefault: true, sortOrder: 0 },
          { roleId: support!.id, isDefault: false, sortOrder: 1 },
        ],
      },
      fixture.actor.id,
      "TENANT_OWNER",
    );
    expect(applicable.status).toBe("success");

    const config = await setConfig(
      fixture.kpi.id,
      fixture.tenant.id,
      {
        creditSumMode: "MAX_100",
      },
      fixture.actor.id,
      "TENANT_OWNER",
    );
    expect(config.status).toBe("success");

    const created = await recordAchievement(
      fixture.tenant.id,
      {
        periodId: fixture.period.id,
        kpiDefinitionId: fixture.kpi.id,
        targetAllocationId: fixture.allocation.id,
        actualValue: 80,
        evidenceLinks: ["https://example.com/evidence"],
        contributors: [
          {
            type: "INTERNAL",
            userId: fixture.faculty.id,
            contributorRoleId: lead!.id,
          },
          {
            type: "INTERNAL",
            userId: fixture.collaborator.id,
            contributorRoleId: support!.id,
          },
        ],
      },
      fixture.faculty.id,
      "TENANT_USER",
    );
    expect(created.status).toBe("success");

    const achievement = await prisma.achievement.findUnique({
      where: { id: created.id! },
      include: {
        contributors: {
          orderBy: { createdAt: "asc" },
        },
      },
    });
    expect(achievement?.contributors).toHaveLength(2);
    const creditValues = achievement!.contributors.map((row) => row.creditPercent).sort((a, b) => a - b);
    expect(creditValues[0]).toBeCloseTo(37.5, 4);
    expect(creditValues[1]).toBeCloseTo(62.5, 4);
    expect(
      achievement!.contributors.reduce((sum, row) => sum + row.creditPercent, 0),
    ).toBeCloseTo(100, 4);
    expect(achievement?.effectiveScore).toBe(80);
  });
});
