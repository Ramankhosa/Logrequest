import { afterEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { recordAchievement } from "@/lib/kra-kpi/achievement-service";
import { createKra } from "@/lib/kra-kpi/kra-service";
import { createPeriod } from "@/lib/kra-kpi/period-service";
import { applyTemplateToKpi, listKpiTemplates } from "@/lib/kra-kpi/kpi-template-service";
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

async function createJournalFixture() {
  tracker ??= newDbTracker();
  const { tenant, actor } = await createTenantActor(tracker, "TENANT_OWNER");
  const faculty = await createTestUser(tracker, { firstName: "Raman", lastName: "Faculty" });
  const coAuthorOne = await createTestUser(tracker, { firstName: "Anita", lastName: "CoAuthor" });
  const coAuthorTwo = await createTestUser(tracker, { firstName: "Vijay", lastName: "CoAuthor2" });

  for (const user of [faculty, coAuthorOne, coAuthorTwo]) {
    await createTestMembership({
      tenantId: tenant.id,
      userId: user.id,
      role: "TENANT_USER",
      createdByUserId: actor.id,
    });
  }

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
      name: "Research Department",
      state: "ACTIVE",
    },
  });

  await prisma.userOrgAssignment.createMany({
    data: [
      { versionId: version.id, userId: actor.id, unitId: unit.id, isPrimary: true },
      { versionId: version.id, userId: faculty.id, unitId: unit.id, isPrimary: true },
      { versionId: version.id, userId: coAuthorOne.id, unitId: unit.id, isPrimary: true },
      { versionId: version.id, userId: coAuthorTwo.id, unitId: unit.id, isPrimary: true },
    ],
  });

  const periodCode = rand("PERIOD");
  const periodResult = await createPeriod(
    tenant.id,
    {
      name: "Journal Template Period",
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

  const templates = await listKpiTemplates(tenant.id);
  const journalTemplate = templates.find((row) => row.code === "SYSTEM_TEMPLATE_JOURNAL_ARTICLE");
  expect(journalTemplate).toBeTruthy();

  const applyResult = await applyTemplateToKpi(
    tenant.id,
    journalTemplate!.id,
    {
      kraDefinitionId: kra!.id,
      titleOverride: "Journal Article KPI",
      startingUnitId: unit.id,
    },
    actor.id,
    "TENANT_OWNER",
  );
  expect(applyResult.status).toBe("success");

  const kpi = await prisma.kpiDefinition.findUnique({
    where: { id: applyResult.id! },
  });
  expect(kpi).toBeTruthy();

  await prisma.kpiDefinition.update({
    where: { id: kpi!.id },
    data: { state: "ACTIVE" },
  });
  await prisma.kraDefinition.update({
    where: { id: kra!.id },
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
      targetValue: 1,
      state: "ACTIVE",
    },
  });

  const roles = await prisma.contributorRole.findMany({
    where: {
      tenantId: tenant.id,
      code: { in: ["LEAD_AUTHOR", "CO_AUTHOR", "CORRESPONDING"] },
    },
  });
  const roleByCode = new Map(roles.map((role) => [role.code, role]));

  return {
    tenant,
    actor,
    faculty,
    coAuthorOne,
    coAuthorTwo,
    period: period!,
    kpi: kpi!,
    allocation,
    roles: {
      leadAuthor: roleByCode.get("LEAD_AUTHOR")!,
      coAuthor: roleByCode.get("CO_AUTHOR")!,
      corresponding: roleByCode.get("CORRESPONDING")!,
    },
  };
}

function journalAchievementFormData(overrides?: Record<string, unknown>) {
  return {
    paperTitle: "A New Journal Article",
    journalName: "International Journal of Testing",
    indexing: ["Scopus"],
    publicationDate: new Date("2026-04-10T00:00:00.000Z").toISOString(),
    pdfLink: "https://example.com/article.pdf",
    journalQuartile: "Q1",
    doi: "10.1000/journal-template-paper",
    ...overrides,
  };
}

describe("Journal article template contributor credits", () => {
  test("multi-author journal template assigns 70 percent to the lead internal author and excludes externals", async () => {
    const fixture = await createJournalFixture();

    const result = await recordAchievement(
      fixture.tenant.id,
      {
        periodId: fixture.period.id,
        kpiDefinitionId: fixture.kpi.id,
        targetAllocationId: fixture.allocation.id,
        actualValue: 1,
        evidenceLinks: ["https://example.com/article-proof"],
        achievementFormData: journalAchievementFormData(),
        contributors: [
          {
            type: "INTERNAL",
            userId: fixture.faculty.id,
            contributorRoleId: fixture.roles.leadAuthor.id,
            selectorTags: ["FIRST_AUTHOR"],
          },
          {
            type: "INTERNAL",
            userId: fixture.coAuthorOne.id,
            contributorRoleId: fixture.roles.coAuthor.id,
          },
          {
            type: "INTERNAL",
            userId: fixture.coAuthorTwo.id,
            contributorRoleId: fixture.roles.corresponding.id,
            selectorTags: ["CORRESPONDING_AUTHOR"],
          },
          {
            type: "EXTERNAL",
            contributorRoleId: fixture.roles.coAuthor.id,
            externalName: "External Researcher",
            externalAffiliation: "Partner University",
            externalScope: "INTERNATIONAL",
            externalData: {
              country: "USA",
            },
          },
        ],
      },
      fixture.faculty.id,
      "TENANT_USER",
    );

    expect(result.status).toBe("success");

    const achievement = await prisma.achievement.findUnique({
      where: { id: result.id! },
      include: {
        contributors: {
          orderBy: [{ type: "asc" }, { userId: "asc" }],
        },
      },
    });
    expect(achievement).toBeTruthy();

    const byUser = new Map(
      achievement!.contributors
        .filter((contributor) => contributor.userId != null)
        .map((contributor) => [contributor.userId!, contributor]),
    );
    expect(byUser.get(fixture.faculty.id)?.creditPercent).toBe(70);
    expect(byUser.get(fixture.coAuthorOne.id)?.creditPercent).toBe(15);
    expect(byUser.get(fixture.coAuthorTwo.id)?.creditPercent).toBe(15);

    const external = achievement!.contributors.find((contributor) => contributor.type === "EXTERNAL");
    expect(external?.creditPercent).toBe(0);
    expect(external?.isExcludedFromReward).toBe(true);
    expect(achievement?.creditPercent).toBe(70);
  });

  test("solo journal template contributor keeps full credit", async () => {
    const fixture = await createJournalFixture();

    const result = await recordAchievement(
      fixture.tenant.id,
      {
        periodId: fixture.period.id,
        kpiDefinitionId: fixture.kpi.id,
        targetAllocationId: fixture.allocation.id,
        actualValue: 1,
        evidenceLinks: ["https://example.com/article-proof"],
        achievementFormData: journalAchievementFormData({
          doi: "10.1000/journal-template-solo",
        }),
        contributors: [
          {
            type: "INTERNAL",
            userId: fixture.faculty.id,
            contributorRoleId: fixture.roles.leadAuthor.id,
            selectorTags: ["FIRST_AUTHOR", "CORRESPONDING_AUTHOR"],
          },
        ],
      },
      fixture.faculty.id,
      "TENANT_USER",
    );

    expect(result.status).toBe("success");

    const achievement = await prisma.achievement.findUnique({
      where: { id: result.id! },
      include: { contributors: true },
    });
    expect(achievement?.contributors).toHaveLength(1);
    expect(achievement?.contributors[0]?.creditPercent).toBe(100);
    expect(achievement?.creditPercent).toBe(100);
  });
});
