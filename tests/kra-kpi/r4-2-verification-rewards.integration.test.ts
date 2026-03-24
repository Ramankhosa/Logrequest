import { afterEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { createKra } from "@/lib/kra-kpi/kra-service";
import { createPeriod } from "@/lib/kra-kpi/period-service";
import { listKpiTemplates, applyTemplateToKpi } from "@/lib/kra-kpi/kpi-template-service";
import { verifyAchievement } from "@/lib/kra-kpi/achievement-service";
import {
  cleanupTrackedData,
  createTenantActor,
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

async function createPublicationVerificationFixture() {
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

  const periodCode = rand("PERIOD");
  await createPeriod(
    tenant.id,
    {
      name: "R4.2 Verify Period",
      code: periodCode,
      periodType: "SPECIFIC_RANGE",
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      endDate: new Date("2026-12-31T00:00:00.000Z"),
      reviewFrequency: "ANNUAL",
    },
    actor.id,
    "TENANT_OWNER",
  );

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
  await createKra(
    tenant.id,
    {
      periodId: period!.id,
      title: kraTitle,
      weightage: 100,
    },
    actor.id,
    "TENANT_OWNER",
  );

  const kra = await prisma.kraDefinition.findFirst({
    where: { tenantId: tenant.id, title: kraTitle },
  });
  expect(kra).toBeTruthy();

  const templates = await listKpiTemplates(tenant.id);
  const publicationTemplate = templates.find((row) => row.code === "SYSTEM_RESEARCH_PUBLICATION");
  expect(publicationTemplate).toBeTruthy();

  const applyResult = await applyTemplateToKpi(
    tenant.id,
    publicationTemplate!.id,
    {
      kraDefinitionId: kra!.id,
      titleOverride: "Publication KPI",
      startingUnitId: unit.id,
    },
    actor.id,
    "TENANT_OWNER",
  );
  expect(applyResult.status).toBe("success");

  const kpi = await prisma.kpiDefinition.findFirst({
    where: { id: applyResult.id },
  });
  expect(kpi).toBeTruthy();

  const roles = await prisma.contributorRole.findMany({
    where: {
      tenantId: tenant.id,
      code: {
        in: ["LEAD_AUTHOR", "CO_AUTHOR"],
      },
    },
  });
  const roleByCode = new Map(roles.map((role) => [role.code, role]));

  return {
    tenant,
    actor,
    period: period!,
    kpi: kpi!,
    roles: {
      leadAuthor: roleByCode.get("LEAD_AUTHOR")!,
      coAuthor: roleByCode.get("CO_AUTHOR")!,
    },
  };
}

describe("R4.2 verification reward hook", () => {
  test("final verification keeps the same workflow state change and creates rewards after approval", async () => {
    const fixture = await createPublicationVerificationFixture();
    const reporter = await createTestUser(tracker!);
    const coAuthor = await createTestUser(tracker!);

    const achievement = await prisma.achievement.create({
      data: {
        tenantId: fixture.tenant.id,
        periodId: fixture.period.id,
        kpiDefinitionId: fixture.kpi.id,
        reportedByUserId: reporter.id,
        evidenceLinks: [],
        state: "SUBMITTED",
        achievementFormData: {
          journalTier: "Q1",
          publicationDate: new Date("2026-05-01T00:00:00.000Z").toISOString(),
          doi: "10.1000/verified-paper",
        },
        contributors: {
          create: [
            {
              userId: reporter.id,
              contributorRoleId: fixture.roles.leadAuthor.id,
              creditPercent: 70,
              selectorTags: ["FIRST_AUTHOR"],
            },
            {
              userId: coAuthor.id,
              contributorRoleId: fixture.roles.coAuthor.id,
              creditPercent: 30,
            },
          ],
        },
      },
    });

    const result = await verifyAchievement(
      achievement.id,
      fixture.tenant.id,
      true,
      null,
      fixture.actor.id,
      "TENANT_OWNER",
    );

    expect(result.status).toBe("success");

    const updatedAchievement = await prisma.achievement.findUniqueOrThrow({
      where: { id: achievement.id },
      select: { state: true, verifiedByUserId: true, currentVerifierUnitId: true },
    });
    expect(updatedAchievement.state).toBe("VERIFIED");
    expect(updatedAchievement.verifiedByUserId).toBe(fixture.actor.id);
    expect(updatedAchievement.currentVerifierUnitId).toBeNull();

    const rewards = await prisma.contributorReward.findMany({
      where: { achievementId: achievement.id },
      orderBy: [{ rewardComponent: { code: "asc" } }, { contributorUserId: "asc" }],
      include: {
        rewardComponent: { select: { code: true } },
      },
    });
    expect(rewards).toHaveLength(4);
    expect(rewards.map((reward) => reward.rewardComponent.code).sort()).toEqual([
      "Q1_LEAVE_POINTS",
      "Q1_LEAVE_POINTS",
      "Q1_MONETARY",
      "Q1_MONETARY",
    ]);
  });
});
