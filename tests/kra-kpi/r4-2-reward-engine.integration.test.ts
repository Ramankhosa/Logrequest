import { afterEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { createKra } from "@/lib/kra-kpi/kra-service";
import { createPeriod } from "@/lib/kra-kpi/period-service";
import { listKpiTemplates, applyTemplateToKpi } from "@/lib/kra-kpi/kpi-template-service";
import { saveKpiBuilder } from "@/lib/kra-kpi/kpi-builder-service";
import {
  previewKpiRewards,
  syncContributorRewardsForAchievement,
} from "@/lib/kra-kpi/reward-service";
import { seedDefaultBenefitTypes } from "@/lib/kra-kpi/benefit-type-service";
import { seedDefaultContributorRoles } from "@/lib/kra-kpi/contributor-role-service";
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

function previewContributor(input: {
  userId: string;
  contributorRoleId: string | null;
  creditPercent: number;
  selectorTags?: string[];
  isExcludedFromReward?: boolean;
}) {
  return {
    userId: input.userId,
    contributorRoleId: input.contributorRoleId,
    creditPercent: input.creditPercent,
    selectorTags: input.selectorTags ?? [],
    isExcludedFromReward: input.isExcludedFromReward ?? false,
  };
}

async function createPublicationFixture() {
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
  const periodResult = await createPeriod(
    tenant.id,
    {
      name: "R4.2 Reward Period",
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
        in: ["LEAD_AUTHOR", "CO_AUTHOR", "CORRESPONDING"],
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
      corresponding: roleByCode.get("CORRESPONDING")!,
    },
  };
}

async function createJournalArticleFixture() {
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
  const periodResult = await createPeriod(
    tenant.id,
    {
      name: "Journal Article Reward Period",
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

  const kpi = await prisma.kpiDefinition.findFirst({
    where: { id: applyResult.id },
  });
  expect(kpi).toBeTruthy();

  const roles = await prisma.contributorRole.findMany({
    where: {
      tenantId: tenant.id,
      code: {
        in: ["LEAD_AUTHOR", "CO_AUTHOR", "CORRESPONDING"],
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
      corresponding: roleByCode.get("CORRESPONDING")!,
    },
  };
}

async function createBuilderFixture() {
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
      name: "Operations Department",
      state: "ACTIVE",
    },
  });

  const periodCode = rand("PERIOD");
  await createPeriod(
    tenant.id,
    {
      name: "R4.2 Builder Period",
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

  await seedDefaultBenefitTypes(tenant.id);
  await seedDefaultContributorRoles(tenant.id);

  return { tenant, actor, period: period!, kra: kra!, unit };
}

describe("R4.2 reward engine", () => {
  test("journal article preview returns monetary, research-points, weighted, and flat publication outputs", async () => {
    const fixture = await createJournalArticleFixture();
    const firstAuthor = await createTestUser(tracker!);
    const coAuthorOne = await createTestUser(tracker!);
    const coAuthorTwo = await createTestUser(tracker!);

    const preview = await previewKpiRewards(fixture.kpi.id, fixture.tenant.id, {
      actualValue: 1,
      reportingDate: new Date("2026-06-05T00:00:00.000Z"),
      achievementFormData: {
        journalQuartile: "Q1",
        publicationDate: new Date("2026-06-01T00:00:00.000Z").toISOString(),
        doi: "10.1000/new-q1-paper",
      },
      contributors: [
        previewContributor({
          userId: firstAuthor.id,
          contributorRoleId: fixture.roles.leadAuthor.id,
          creditPercent: 70,
          selectorTags: ["FIRST_AUTHOR"],
        }),
        previewContributor({
          userId: coAuthorOne.id,
          contributorRoleId: fixture.roles.coAuthor.id,
          creditPercent: 15,
        }),
        previewContributor({
          userId: coAuthorTwo.id,
          contributorRoleId: fixture.roles.coAuthor.id,
          creditPercent: 15,
        }),
      ],
      systemMetrics: {},
    });

    expect(preview?.matchedTiers.map((tier) => tier.code)).toEqual(["Q1"]);

    const money = preview?.components.find(
      (component) => component.componentCode === "Q1_JOURNAL_MONETARY",
    );
    expect(money?.totalAmount).toBe(35000);

    const researchPoints = preview?.components.find(
      (component) => component.componentCode === "Q1_JOURNAL_RESEARCH_POINTS",
    );
    expect(researchPoints?.totalAmount).toBe(150);

    const weightedAchievement = preview?.components.find(
      (component) => component.componentCode === "Q1_JOURNAL_PUBLICATION_WEIGHTED",
    );
    expect(weightedAchievement?.totalAmount).toBe(1);

    const flatAchievement = preview?.components.find(
      (component) => component.componentCode === "Q1_JOURNAL_PUBLICATION",
    );
    expect(flatAchievement?.baseAmount).toBe(3);
    expect(flatAchievement?.contributors.every((contributor) => contributor.amount === 1)).toBe(true);

    const moneyByUser = new Map(
      money?.contributors.map((contributor) => [contributor.userId, contributor.amount]) ?? [],
    );
    expect(moneyByUser.get(firstAuthor.id)).toBeCloseTo(24500, 2);
    expect(moneyByUser.get(coAuthorOne.id)).toBeCloseTo(5250, 2);
    expect(moneyByUser.get(coAuthorTwo.id)).toBeCloseTo(5250, 2);

    const researchByUser = new Map(
      researchPoints?.contributors.map((contributor) => [contributor.userId, contributor.amount]) ?? [],
    );
    expect(researchByUser.get(firstAuthor.id)).toBeCloseTo(105, 2);
    expect(researchByUser.get(coAuthorOne.id)).toBeCloseTo(22.5, 2);
    expect(researchByUser.get(coAuthorTwo.id)).toBeCloseTo(22.5, 2);

    const weightedByUser = new Map(
      weightedAchievement?.contributors.map((contributor) => [contributor.userId, contributor.amount]) ?? [],
    );
    expect(weightedByUser.get(firstAuthor.id)).toBeCloseTo(0.7, 2);
    expect(weightedByUser.get(coAuthorOne.id)).toBeCloseTo(0.15, 2);
    expect(weightedByUser.get(coAuthorTwo.id)).toBeCloseTo(0.15, 2);
  });

  test("publication Q1 preview uses first-author-led 70/30 split", async () => {
    const fixture = await createPublicationFixture();
    const firstAuthor = await createTestUser(tracker!);
    const coAuthorOne = await createTestUser(tracker!);
    const coAuthorTwo = await createTestUser(tracker!);

    const preview = await previewKpiRewards(fixture.kpi.id, fixture.tenant.id, {
      actualValue: 1,
      reportingDate: new Date("2026-06-05T00:00:00.000Z"),
      achievementFormData: {
        journalTier: "Q1",
        publicationDate: new Date("2026-06-01T00:00:00.000Z").toISOString(),
        doi: "10.1000/q1-paper",
      },
      contributors: [
        previewContributor({
          userId: firstAuthor.id,
          contributorRoleId: fixture.roles.leadAuthor.id,
          creditPercent: 60,
          selectorTags: ["FIRST_AUTHOR"],
        }),
        previewContributor({
          userId: coAuthorOne.id,
          contributorRoleId: fixture.roles.coAuthor.id,
          creditPercent: 20,
        }),
        previewContributor({
          userId: coAuthorTwo.id,
          contributorRoleId: fixture.roles.coAuthor.id,
          creditPercent: 20,
        }),
      ],
      systemMetrics: {},
    });

    expect(preview).not.toBeNull();
    expect(preview?.matchedTiers.map((tier) => tier.code)).toEqual(["Q1"]);

    const money = preview?.components.find((component) => component.componentCode === "Q1_MONETARY");
    expect(money?.baseAmount).toBe(35000);
    expect(money?.totalAmount).toBe(35000);
    expect(money?.contributors).toHaveLength(3);

    const amountsByUser = new Map(
      money?.contributors.map((contributor) => [contributor.userId, contributor.amount]) ?? [],
    );
    expect(amountsByUser.get(firstAuthor.id)).toBeCloseTo(24500, 2);
    expect(amountsByUser.get(coAuthorOne.id)).toBeCloseTo(5250, 2);
    expect(amountsByUser.get(coAuthorTwo.id)).toBeCloseTo(5250, 2);

    const leave = preview?.components.find((component) => component.componentCode === "Q1_LEAVE_POINTS");
    expect(leave?.totalAmount).toBe(10);
  });

  test("UGC preview uses corresponding-author-led 70/30 split", async () => {
    const fixture = await createPublicationFixture();
    const firstAuthor = await createTestUser(tracker!);
    const corresponding = await createTestUser(tracker!);
    const coAuthor = await createTestUser(tracker!);

    const preview = await previewKpiRewards(fixture.kpi.id, fixture.tenant.id, {
      reportingDate: new Date("2026-09-05T00:00:00.000Z"),
      achievementFormData: {
        journalTier: "UGC_CARE",
        publicationDate: new Date("2026-09-01T00:00:00.000Z").toISOString(),
        doi: "10.1000/ugc-paper",
      },
      contributors: [
        previewContributor({
          userId: firstAuthor.id,
          contributorRoleId: fixture.roles.leadAuthor.id,
          creditPercent: 50,
          selectorTags: ["FIRST_AUTHOR"],
        }),
        previewContributor({
          userId: corresponding.id,
          contributorRoleId: fixture.roles.corresponding.id,
          creditPercent: 30,
          selectorTags: ["CORRESPONDING_AUTHOR"],
        }),
        previewContributor({
          userId: coAuthor.id,
          contributorRoleId: fixture.roles.coAuthor.id,
          creditPercent: 20,
        }),
      ],
      systemMetrics: {},
    });

    expect(preview?.matchedTiers.map((tier) => tier.code)).toEqual(["UGC_CARE"]);

    const money = preview?.components.find((component) => component.componentCode === "UGC_CARE_MONETARY");
    const amountsByUser = new Map(
      money?.contributors.map((contributor) => [contributor.userId, contributor.amount]) ?? [],
    );
    expect(amountsByUser.get(corresponding.id)).toBeCloseTo(3500, 2);
    expect(amountsByUser.get(firstAuthor.id)).toBeCloseTo(750, 2);
    expect(amountsByUser.get(coAuthor.id)).toBeCloseTo(750, 2);
  });

  test("single-author publication falls back to 100 percent for the only contributor", async () => {
    const fixture = await createPublicationFixture();
    const firstAuthor = await createTestUser(tracker!);

    const preview = await previewKpiRewards(fixture.kpi.id, fixture.tenant.id, {
      reportingDate: new Date("2026-04-05T00:00:00.000Z"),
      achievementFormData: {
        journalTier: "Q1",
        publicationDate: new Date("2026-04-01T00:00:00.000Z").toISOString(),
        doi: "10.1000/solo-paper",
      },
      contributors: [
        previewContributor({
          userId: firstAuthor.id,
          contributorRoleId: fixture.roles.leadAuthor.id,
          creditPercent: 100,
          selectorTags: ["FIRST_AUTHOR"],
        }),
      ],
      systemMetrics: {},
    });

    const money = preview?.components.find((component) => component.componentCode === "Q1_MONETARY");
    expect(money?.fallbackApplied).toBe("FULL_TO_SINGLE");
    expect(money?.contributors).toHaveLength(1);
    expect(money?.contributors[0]?.amount).toBeCloseTo(35000, 2);
  });

  test("once-per-unique-key blocks repeated previews and reward sync is idempotent", async () => {
    const fixture = await createPublicationFixture();
    const firstAuthor = await createTestUser(tracker!);
    const coAuthor = await createTestUser(tracker!);

    const achievement = await prisma.achievement.create({
      data: {
        tenantId: fixture.tenant.id,
        periodId: fixture.period.id,
        kpiDefinitionId: fixture.kpi.id,
        reportedByUserId: firstAuthor.id,
        evidenceLinks: [],
        state: "VERIFIED",
        achievementFormData: {
          journalTier: "Q1",
          publicationDate: new Date("2026-05-01T00:00:00.000Z").toISOString(),
          doi: "10.1000/unique-paper",
        },
        contributors: {
          create: [
            {
              userId: firstAuthor.id,
              contributorRoleId: fixture.roles.leadAuthor.id,
              creditPercent: 60,
              selectorTags: ["FIRST_AUTHOR"],
            },
            {
              userId: coAuthor.id,
              contributorRoleId: fixture.roles.coAuthor.id,
              creditPercent: 40,
            },
          ],
        },
      },
    });

    const firstRun = await syncContributorRewardsForAchievement(achievement.id, fixture.tenant.id);
    const secondRun = await syncContributorRewardsForAchievement(achievement.id, fixture.tenant.id);
    expect(firstRun.createdCount).toBe(4);
    expect(secondRun.createdCount).toBe(0);

    const storedRewards = await prisma.contributorReward.findMany({
      where: { achievementId: achievement.id },
    });
    expect(storedRewards).toHaveLength(4);

    const repeatPreview = await previewKpiRewards(fixture.kpi.id, fixture.tenant.id, {
      reportingDate: new Date("2026-05-10T00:00:00.000Z"),
      achievementFormData: {
        journalTier: "Q1",
        publicationDate: new Date("2026-05-09T00:00:00.000Z").toISOString(),
        doi: "10.1000/unique-paper",
      },
      contributors: [
        previewContributor({
          userId: firstAuthor.id,
          contributorRoleId: fixture.roles.leadAuthor.id,
          creditPercent: 100,
          selectorTags: ["FIRST_AUTHOR"],
        }),
      ],
      systemMetrics: {},
    });

    expect(repeatPreview?.recurrenceKey).toBe("doi=10.1000/unique-paper");
    expect(
      repeatPreview?.components.every((component) =>
        component.contributors.every((contributor) => contributor.blocked && contributor.amount === 0),
      ),
    ).toBe(true);
  });

  test("reward engine supports effective windows, amount modes, and distribution modes", async () => {
    const fixture = await createBuilderFixture();
    const owner = await createTestUser(tracker!);
    const collaborator = await createTestUser(tracker!);
    const lead = await createTestUser(tracker!);

    const builderResult = await saveKpiBuilder(
      fixture.tenant.id,
      {
        definition: {
          kraDefinitionId: fixture.kra.id,
          title: "Universal Reward KPI",
          description: "Custom reward engine test KPI",
          measurementType: "NUMERIC",
          unitLabel: "count",
          weightage: 10,
          defaultTarget: null,
          measurementConfig: null,
          scoringMethod: "LINEAR",
          scoringDirection: "ASCENDING",
          scoringConfig: null,
          isPerCapita: false,
          allocationType: "BOTH",
          startingUnitId: fixture.unit.id,
          achievementTemplateKey: null,
          achievementFormConfig: {
            fields: [
              {
                key: "band",
                label: "Band",
                type: "SELECT",
                required: true,
                options: ["HIGH"],
                sortOrder: 0,
              },
              {
                key: "grantAmount",
                label: "Grant Amount",
                type: "NUMBER",
                required: false,
                sortOrder: 1,
              },
              {
                key: "unitCount",
                label: "Unit Count",
                type: "NUMBER",
                required: false,
                sortOrder: 2,
              },
              {
                key: "policyDate",
                label: "Policy Date",
                type: "DATE",
                required: true,
                sortOrder: 3,
              },
            ],
          },
          guidanceNotes: null,
          sortOrder: 0,
          keyUnitId: null,
          finalUnitId: null,
          sopDescription: null,
          evidenceRequired: false,
          evidenceTypes: ["NONE"],
          evidenceInstructions: null,
          isTeamKpi: true,
          teamCreditMethod: "WEIGHTED_SPLIT",
          allowPartialCompletion: true,
          participantMode: "OPTIONAL_TEAM",
          rewardRecurrencePolicy: "ONCE_PER_PERIOD",
          policyDateFieldKey: "policyDate",
          contributionRoles: null,
        },
        applicableRoles: [
          { roleCode: "MEMBER", isDefault: true, sortOrder: 0 },
          { roleCode: "COORDINATOR", isDefault: false, sortOrder: 1 },
        ],
        contributorConfig: {
          allowExternalContributors: false,
          duplicateCheckFields: [],
          creditSumMode: "MUST_EQUAL_100",
        },
        stages: [],
        rewardTiers: [
          {
            refKey: "HIGH_H1",
            tierSetKey: "PRIMARY",
            code: "HIGH",
            name: "High Band H1",
            priority: 0,
            matchMode: "HIGHEST_MATCH",
            effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
            effectiveTo: new Date("2026-06-30T23:59:59.000Z"),
            isActive: true,
            rules: [
              {
                source: "FORM_FIELD",
                operator: "eq",
                fieldKey: "band",
                value: "HIGH",
                sortOrder: 0,
              },
            ],
          },
          {
            refKey: "HIGH_H2",
            tierSetKey: "PRIMARY",
            code: "HIGH",
            name: "High Band H2",
            priority: 0,
            matchMode: "HIGHEST_MATCH",
            effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
            effectiveTo: new Date("2026-12-31T23:59:59.000Z"),
            isActive: true,
            rules: [
              {
                source: "FORM_FIELD",
                operator: "eq",
                fieldKey: "band",
                value: "HIGH",
                sortOrder: 0,
              },
            ],
          },
        ],
        rewardComponents: [
          {
            rewardTierRef: "HIGH_H1",
            benefitTypeCode: "MONETARY",
            code: "H1_DIRECT",
            name: "H1 Direct Owner",
            trigger: "FINAL_VERIFY",
            amountMode: "FIXED_VALUE",
            amountValue: 100,
            distributionMode: "DIRECT_OWNER",
            distributions: [],
          },
          {
            rewardTierRef: "HIGH_H2",
            benefitTypeCode: "MONETARY",
            code: "H2_DIRECT",
            name: "H2 Direct Owner",
            trigger: "FINAL_VERIFY",
            amountMode: "FIXED_VALUE",
            amountValue: 50,
            distributionMode: "DIRECT_OWNER",
            distributions: [],
          },
          {
            benefitTypeCode: "MONETARY",
            code: "EQUAL_POOL",
            name: "Equal Pool",
            trigger: "FINAL_VERIFY",
            amountMode: "FIXED_POOL",
            amountValue: 90,
            distributionMode: "EQUAL_SPLIT",
            distributions: [],
          },
          {
            benefitTypeCode: "MONETARY",
            code: "CREDIT_POOL",
            name: "Credit Pool",
            trigger: "FINAL_VERIFY",
            amountMode: "FIXED_POOL",
            amountValue: 100,
            distributionMode: "CREDIT_PERCENT_SPLIT",
            distributions: [],
          },
          {
            benefitTypeCode: "MONETARY",
            code: "LEAD_ONLY_POOL",
            name: "Lead Only",
            trigger: "FINAL_VERIFY",
            amountMode: "FIXED_POOL",
            amountValue: 80,
            distributionMode: "LEAD_ONLY",
            distributions: [
              {
                selectorType: "SELECTOR_TAG",
                selectorTag: "LEAD",
                sortOrder: 0,
              },
            ],
          },
          {
            benefitTypeCode: "MONETARY",
            code: "FIXED_EACH",
            name: "Fixed Each",
            trigger: "FINAL_VERIFY",
            amountMode: "FIXED_PER_PERSON",
            amountValue: 10,
            distributionMode: "FIXED_PER_PERSON",
            distributions: [],
          },
          {
            benefitTypeCode: "MONETARY",
            code: "PERCENT_OF_FIELD",
            name: "Percent Of Field",
            trigger: "FINAL_VERIFY",
            amountMode: "PERCENT_OF_FIELD",
            amountValue: 5,
            amountFieldKey: "grantAmount",
            distributionMode: "DIRECT_OWNER",
            distributions: [],
          },
          {
            benefitTypeCode: "MONETARY",
            code: "PER_UNIT",
            name: "Per Unit",
            trigger: "FINAL_VERIFY",
            amountMode: "PER_UNIT",
            amountValue: 2,
            amountFieldKey: "unitCount",
            distributionMode: "DIRECT_OWNER",
            distributions: [],
          },
          {
            benefitTypeCode: "MONETARY",
            code: "PERCENT_OF_SCORE",
            name: "Percent Of Score",
            trigger: "FINAL_VERIFY",
            amountMode: "PERCENT_OF_SCORE",
            amountValue: 10,
            distributionMode: "DIRECT_OWNER",
            distributions: [],
          },
        ],
      },
      fixture.actor.id,
      "TENANT_OWNER",
    );
    expect(builderResult.status).toBe("success");

    const previewH1 = await previewKpiRewards(builderResult.id!, fixture.tenant.id, {
      reportingDate: new Date("2026-03-10T00:00:00.000Z"),
      effectiveScore: 80,
      achievementFormData: {
        band: "HIGH",
        grantAmount: 2000,
        unitCount: 4,
        policyDate: new Date("2026-03-10T00:00:00.000Z").toISOString(),
      },
      contributors: [
        previewContributor({
          userId: owner.id,
          contributorRoleId: null,
          creditPercent: 50,
        }),
        previewContributor({
          userId: collaborator.id,
          contributorRoleId: null,
          creditPercent: 30,
        }),
        previewContributor({
          userId: lead.id,
          contributorRoleId: null,
          creditPercent: 20,
          selectorTags: ["LEAD"],
        }),
      ],
      systemMetrics: {},
    });

    expect(previewH1?.matchedTiers.map((tier) => tier.name)).toEqual(["High Band H1"]);
    expect(previewH1?.components.find((component) => component.componentCode === "H1_DIRECT")?.totalAmount).toBe(100);
    expect(previewH1?.components.find((component) => component.componentCode === "H2_DIRECT")).toBeUndefined();

    const equalPool = previewH1?.components.find((component) => component.componentCode === "EQUAL_POOL");
    expect(equalPool?.contributors.map((contributor) => contributor.amount)).toEqual([30, 30, 30]);

    const creditPool = previewH1?.components.find((component) => component.componentCode === "CREDIT_POOL");
    expect(creditPool?.contributors.map((contributor) => contributor.amount)).toEqual([50, 30, 20]);

    const leadOnly = previewH1?.components.find((component) => component.componentCode === "LEAD_ONLY_POOL");
    const leadAmounts = new Map(leadOnly?.contributors.map((contributor) => [contributor.userId, contributor.amount]) ?? []);
    expect(leadAmounts.get(lead.id)).toBe(80);

    expect(previewH1?.components.find((component) => component.componentCode === "FIXED_EACH")?.totalAmount).toBe(30);
    expect(previewH1?.components.find((component) => component.componentCode === "PERCENT_OF_FIELD")?.totalAmount).toBe(100);
    expect(previewH1?.components.find((component) => component.componentCode === "PER_UNIT")?.totalAmount).toBe(8);
    expect(previewH1?.components.find((component) => component.componentCode === "PERCENT_OF_SCORE")?.totalAmount).toBe(8);

    const existingAchievement = await prisma.achievement.create({
      data: {
        tenantId: fixture.tenant.id,
        periodId: fixture.period.id,
        kpiDefinitionId: builderResult.id!,
        reportedByUserId: owner.id,
        evidenceLinks: [],
        state: "VERIFIED",
      },
    });

    await prisma.contributorReward.create({
      data: {
        tenantId: fixture.tenant.id,
        periodId: fixture.period.id,
        kpiDefinitionId: builderResult.id!,
        achievementId: existingAchievement.id,
        contributorUserId: owner.id,
        benefitTypeId: (
          await prisma.benefitType.findUniqueOrThrow({
            where: { tenantId_code: { tenantId: fixture.tenant.id, code: "MONETARY" } },
          })
        ).id,
        rewardComponentId: (
          await prisma.kpiRewardComponent.findFirstOrThrow({
            where: { kpiDefinitionId: builderResult.id!, code: "H1_DIRECT" },
          })
        ).id,
        baseAmount: 100,
        finalAmount: 100,
        idempotencyKey: rand("REWARD"),
      },
    });

    const recurrencePreview = await previewKpiRewards(builderResult.id!, fixture.tenant.id, {
      reportingDate: new Date("2026-04-01T00:00:00.000Z"),
      effectiveScore: 80,
      achievementFormData: {
        band: "HIGH",
        grantAmount: 2000,
        unitCount: 4,
        policyDate: new Date("2026-04-01T00:00:00.000Z").toISOString(),
      },
      contributors: [
        previewContributor({
          userId: owner.id,
          contributorRoleId: null,
          creditPercent: 100,
        }),
      ],
      systemMetrics: {},
    });
    expect(
      recurrencePreview?.components.every((component) =>
        component.contributors.every((contributor) => contributor.blocked),
      ),
    ).toBe(true);

    const previewH2 = await previewKpiRewards(builderResult.id!, fixture.tenant.id, {
      reportingDate: new Date("2026-08-10T00:00:00.000Z"),
      effectiveScore: 80,
      achievementFormData: {
        band: "HIGH",
        grantAmount: 2000,
        unitCount: 4,
        policyDate: new Date("2026-08-10T00:00:00.000Z").toISOString(),
      },
      contributors: [
        previewContributor({
          userId: collaborator.id,
          contributorRoleId: null,
          creditPercent: 100,
        }),
      ],
      systemMetrics: {},
    });

    expect(previewH2?.matchedTiers.map((tier) => tier.name)).toEqual(["High Band H2"]);
    expect(previewH2?.components.find((component) => component.componentCode === "H2_DIRECT")?.totalAmount).toBe(50);
    expect(previewH2?.components.find((component) => component.componentCode === "H1_DIRECT")).toBeUndefined();
  });
});
