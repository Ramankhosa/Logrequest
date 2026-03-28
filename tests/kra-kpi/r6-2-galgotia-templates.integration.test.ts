import { afterEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  recordAchievement,
  submitForVerification,
} from "@/lib/kra-kpi/achievement-service";
import { kpiTemplateWriteSchema } from "@/lib/kra-kpi/builder-shared";
import {
  GALGOTIA_KPI_TEMPLATES,
} from "@/lib/kra-kpi/galgotia-kpi-templates";
import {
  GALGOTIA_TEMPLATE_CODES,
} from "@/lib/kra-kpi/galgotia-template-constants";
import { getMyReviewQueue } from "@/lib/kra-kpi/my-kpi-service";
import { listKpiTemplates, applyTemplateToKpi, seedSystemKpiTemplates } from "@/lib/kra-kpi/kpi-template-service";
import { previewKpiRewards } from "@/lib/kra-kpi/reward-service";
import {
  cleanupTrackedData,
  createTestUser,
  newDbTracker,
  type DbTracker,
} from "../helpers/db";
import {
  createScenarioAllocation,
  createWorkflowCoreFixture,
} from "../helpers/kra-kpi-db-scenarios";

let tracker: DbTracker | null = null;

afterEach(async () => {
  if (tracker) {
    await cleanupTrackedData(tracker);
    tracker = null;
  }
});

function previewContributor(input: {
  userId: string | null;
  contributorRoleId: string | null;
  creditPercent: number;
  isExcludedFromReward?: boolean;
  selectorTags?: string[];
}) {
  return {
    userId: input.userId ?? undefined,
    contributorRoleId: input.contributorRoleId,
    creditPercent: input.creditPercent,
    isExcludedFromReward: input.isExcludedFromReward ?? false,
    selectorTags: input.selectorTags ?? [],
  };
}

async function createGalgotiaFixture() {
  tracker ??= newDbTracker();
  return createWorkflowCoreFixture(tracker, { periodStateAfterSetup: "OPEN" });
}

async function setPeriodInProgress(periodId: string) {
  await prisma.assessmentPeriod.update({
    where: { id: periodId },
    data: { state: "IN_PROGRESS" },
  });
}

async function applyGalgotiaTemplate(
  tenantId: string,
  actorUserId: string,
  kraId: string,
  startingUnitId: string,
  code: (typeof GALGOTIA_TEMPLATE_CODES)[number],
  titleSuffix?: string,
) {
  const templates = await listKpiTemplates(tenantId);
  const template = templates.find((row) => row.code === code);
  expect(template).toBeTruthy();

  const applyResult = await applyTemplateToKpi(
    tenantId,
    template!.id,
    {
      kraDefinitionId: kraId,
      startingUnitId,
      titleOverride: titleSuffix ? `${template!.name} ${titleSuffix}` : template!.name,
    },
    actorUserId,
    "TENANT_OWNER",
  );
  expect(applyResult.status).toBe("success");

  await prisma.kpiDefinition.update({
    where: { id: applyResult.id! },
    data: { state: "ACTIVE" },
  });

  return prisma.kpiDefinition.findUniqueOrThrow({
    where: { id: applyResult.id! },
    select: {
      id: true,
      title: true,
      guidanceNotes: true,
      achievementTemplateKey: true,
      achievementFormConfig: true,
    },
  });
}

async function loadRoleIds(tenantId: string, codes: string[]) {
  const rows = await prisma.contributorRole.findMany({
    where: {
      tenantId,
      code: { in: codes },
    },
    select: { id: true, code: true },
  });
  const byCode = new Map(rows.map((row) => [row.code, row.id]));
  for (const code of codes) {
    expect(byCode.get(code)).toBeTruthy();
  }
  return byCode;
}

describe("R6.2 Galgotia templates", () => {
  test("seeded Galgotia templates validate, seed idempotently, and apply to KPIs", async () => {
    const fixture = await createGalgotiaFixture();

    for (const template of GALGOTIA_KPI_TEMPLATES) {
      const parsed = kpiTemplateWriteSchema.safeParse(template);
      expect(parsed.success).toBe(true);
    }

    await seedSystemKpiTemplates();
    await seedSystemKpiTemplates();

    const templates = await listKpiTemplates(fixture.tenant.id);
    const galgotia = templates.filter((template) =>
      GALGOTIA_TEMPLATE_CODES.includes(template.code as (typeof GALGOTIA_TEMPLATE_CODES)[number]),
    );

    expect(galgotia.map((template) => template.code).sort()).toEqual(
      [...GALGOTIA_TEMPLATE_CODES].sort(),
    );

    for (const [index, code] of GALGOTIA_TEMPLATE_CODES.entries()) {
      const applied = await applyGalgotiaTemplate(
        fixture.tenant.id,
        fixture.actor.id,
        fixture.kra.id,
        fixture.structure.cseUnitId,
        code,
        `R6_2_${index + 1}`,
      );
      expect(applied.achievementTemplateKey).toBeTruthy();
    }

    const appliedCount = await prisma.kpiDefinition.count({
      where: {
        kraDefinitionId: fixture.kra.id,
        title: { contains: "R6_2_" },
      },
    });
    expect(appliedCount).toBe(12);
  });

  test("journal case matrix pays the correct Galgotia amounts across quartiles", async () => {
    const fixture = await createGalgotiaFixture();
    const journalKpi = await applyGalgotiaTemplate(
      fixture.tenant.id,
      fixture.actor.id,
      fixture.kra.id,
      fixture.structure.cseUnitId,
      "GU_SCOPUS_JOURNAL_PUBLICATION",
    );
    const roles = await loadRoleIds(fixture.tenant.id, [
      "FIRST_AUTHOR",
      "CORRESPONDING_AUTHOR",
      "CO_AUTHOR",
    ]);

    const users = [
      await createTestUser(tracker!, { firstName: "First", lastName: "Author" }),
      await createTestUser(tracker!, { firstName: "Corr", lastName: "Author" }),
      await createTestUser(tracker!, { firstName: "Co", lastName: "Author1" }),
      await createTestUser(tracker!, { firstName: "Co", lastName: "Author2" }),
    ];

    const quartileAmounts: Record<string, number> = {
      Q1: 30000,
      Q2: 25000,
      Q3: 15000,
      Q4: 10000,
    };

    const cases: Array<{
      caseCode: string;
      credits: Map<string, number>;
      contributors: ReturnType<typeof previewContributor>[];
    }> = [
      {
        caseCode: "CASE_1",
        credits: new Map([
          [users[0].id, 35],
          [users[1].id, 35],
          [users[2].id, 15],
          [users[3].id, 15],
        ]),
        contributors: [
          previewContributor({ userId: users[0].id, contributorRoleId: roles.get("FIRST_AUTHOR")!, creditPercent: 35 }),
          previewContributor({ userId: users[1].id, contributorRoleId: roles.get("CORRESPONDING_AUTHOR")!, creditPercent: 35 }),
          previewContributor({ userId: users[2].id, contributorRoleId: roles.get("CO_AUTHOR")!, creditPercent: 15 }),
          previewContributor({ userId: users[3].id, contributorRoleId: roles.get("CO_AUTHOR")!, creditPercent: 15 }),
        ],
      },
      {
        caseCode: "CASE_2",
        credits: new Map([
          [users[0].id, 50],
          [users[1].id, 50],
        ]),
        contributors: [
          previewContributor({ userId: users[0].id, contributorRoleId: roles.get("FIRST_AUTHOR")!, creditPercent: 50 }),
          previewContributor({ userId: users[1].id, contributorRoleId: roles.get("CORRESPONDING_AUTHOR")!, creditPercent: 50 }),
        ],
      },
      {
        caseCode: "CASE_3",
        credits: new Map([
          [users[0].id, 60],
          [users[2].id, 20],
          [users[3].id, 20],
        ]),
        contributors: [
          previewContributor({ userId: users[0].id, contributorRoleId: roles.get("FIRST_AUTHOR")!, creditPercent: 60 }),
          previewContributor({ userId: users[2].id, contributorRoleId: roles.get("CO_AUTHOR")!, creditPercent: 20 }),
          previewContributor({ userId: users[3].id, contributorRoleId: roles.get("CO_AUTHOR")!, creditPercent: 20 }),
        ],
      },
      {
        caseCode: "CASE_4",
        credits: new Map([[users[1].id, 100]]),
        contributors: [
          previewContributor({ userId: users[1].id, contributorRoleId: roles.get("CORRESPONDING_AUTHOR")!, creditPercent: 100 }),
        ],
      },
      {
        caseCode: "CASE_5",
        credits: new Map([
          [users[2].id, 50],
          [users[3].id, 50],
        ]),
        contributors: [
          previewContributor({ userId: users[2].id, contributorRoleId: roles.get("CO_AUTHOR")!, creditPercent: 50 }),
          previewContributor({ userId: users[3].id, contributorRoleId: roles.get("CO_AUTHOR")!, creditPercent: 50 }),
        ],
      },
    ];

    for (const [quartile, baseAmount] of Object.entries(quartileAmounts)) {
      for (const testCase of cases) {
        const preview = await previewKpiRewards(journalKpi.id, fixture.tenant.id, {
          actualValue: 1,
          reportingDate: new Date("2026-06-01T00:00:00.000Z"),
          achievementFormData: {
            paperTitle: `${quartile}-${testCase.caseCode}`,
            journalName: "Galgotias Journal",
            indexing: ["Scopus"],
            publicationDate: new Date("2026-05-20T00:00:00.000Z").toISOString(),
            pdfLink: "https://example.com/paper.pdf",
            doi: `10.1000/${quartile.toLowerCase()}-${testCase.caseCode.toLowerCase()}`,
            journalQuartile: quartile,
            authorshipCase: testCase.caseCode,
            totalAuthors: testCase.contributors.length,
            guAuthorsCount: testCase.contributors.length,
          },
          contributors: testCase.contributors,
          systemMetrics: {},
        });

        const expectedTotal =
          testCase.caseCode === "CASE_5"
            ? Math.round(baseAmount * 0.4)
            : baseAmount;

        expect(preview?.matchedTiers.map((tier) => tier.code)).toEqual([
          `${quartile}_${testCase.caseCode}`,
        ]);

        const component = preview?.components.find(
          (row) => row.componentCode === `${quartile}_${testCase.caseCode}_INCENTIVE`,
        );
        expect(component?.totalAmount).toBe(expectedTotal);

        for (const contributor of component?.contributors ?? []) {
          const expectedCredit = testCase.credits.get(contributor.userId ?? "");
          expect(expectedCredit).toBeDefined();
          expect(contributor.amount).toBeCloseTo(
            expectedTotal * (expectedCredit! / 100),
            2,
          );
        }
      }
    }
  });

  test("Galgotia reward templates use the expected split and gating logic", async () => {
    const fixture = await createGalgotiaFixture();

    const phdKpi = await applyGalgotiaTemplate(
      fixture.tenant.id,
      fixture.actor.id,
      fixture.kra.id,
      fixture.structure.cseUnitId,
      "GU_PHD_AWARDED",
    );
    const grantKpi = await applyGalgotiaTemplate(
      fixture.tenant.id,
      fixture.actor.id,
      fixture.kra.id,
      fixture.structure.cseUnitId,
      "GU_RESEARCH_GRANT",
    );
    const consultancyKpi = await applyGalgotiaTemplate(
      fixture.tenant.id,
      fixture.actor.id,
      fixture.kra.id,
      fixture.structure.cseUnitId,
      "GU_CONSULTANCY_PROJECT",
    );
    const patentKpi = await applyGalgotiaTemplate(
      fixture.tenant.id,
      fixture.actor.id,
      fixture.kra.id,
      fixture.structure.cseUnitId,
      "GU_PATENT_FILING",
    );
    const intlConvenorKpi = await applyGalgotiaTemplate(
      fixture.tenant.id,
      fixture.actor.id,
      fixture.kra.id,
      fixture.structure.cseUnitId,
      "GU_INTL_CONFERENCE_CONVENOR",
    );
    const fdpKpi = await applyGalgotiaTemplate(
      fixture.tenant.id,
      fixture.actor.id,
      fixture.kra.id,
      fixture.structure.cseUnitId,
      "GU_FDP_STC_VAC_TRAINING_CONVENOR",
    );
    const conferencePaperKpi = await applyGalgotiaTemplate(
      fixture.tenant.id,
      fixture.actor.id,
      fixture.kra.id,
      fixture.structure.cseUnitId,
      "GU_CONFERENCE_PAPER",
    );
    const edpKpi = await applyGalgotiaTemplate(
      fixture.tenant.id,
      fixture.actor.id,
      fixture.kra.id,
      fixture.structure.cseUnitId,
      "GU_EDP_MDP_CONVENOR",
    );

    const roles = await loadRoleIds(fixture.tenant.id, [
      "SUPERVISOR",
      "CO_SUPERVISOR",
      "PI",
      "CO_PI",
      "LEAD_CONSULTANT",
      "CONSULTANT",
      "INVENTOR",
      "CONVENOR",
      "TEAM_MEMBER",
      "AUTHOR",
      "CO_AUTHOR",
    ]);

    const phdPreview = await previewKpiRewards(phdKpi.id, fixture.tenant.id, {
      actualValue: 1,
      achievementFormData: {
        scholarName: "Scholar A",
        thesisTitle: "PhD Thesis",
        university: "Galgotias University",
        enrollmentNumber: "PHD-001",
        awardDate: new Date("2026-04-01T00:00:00.000Z").toISOString(),
        degreeCertificateLink: "https://example.com/phd.pdf",
      },
      contributors: [
        previewContributor({ userId: fixture.users.facultyCse.id, contributorRoleId: roles.get("SUPERVISOR")!, creditPercent: 60 }),
        previewContributor({ userId: fixture.users.facultyEce.id, contributorRoleId: roles.get("CO_SUPERVISOR")!, creditPercent: 20 }),
        previewContributor({ userId: fixture.users.schoolHead.id, contributorRoleId: roles.get("CO_SUPERVISOR")!, creditPercent: 20 }),
      ],
      systemMetrics: {},
    });
    const phdComponent = phdPreview?.components.find((row) => row.componentCode === "PHD_SUPERVISION_INCENTIVE");
    expect(phdComponent?.totalAmount).toBe(18000);
    expect(phdComponent?.contributors.find((row) => row.userId === fixture.users.facultyCse.id)?.amount).toBeCloseTo(10800, 2);
    expect(phdComponent?.contributors.find((row) => row.userId === fixture.users.facultyEce.id)?.amount).toBeCloseTo(3600, 2);
    expect(phdComponent?.contributors.find((row) => row.userId === fixture.users.schoolHead.id)?.amount).toBeCloseTo(3600, 2);

    const grantPreview = await previewKpiRewards(grantKpi.id, fixture.tenant.id, {
      actualValue: 1,
      achievementFormData: {
        projectTitle: "Grant Project",
        fundingAgency: "DST",
        sanctionedAmount: 1_000_000,
        sanctionNumber: "GRANT-001",
        startDate: new Date("2026-03-01T00:00:00.000Z").toISOString(),
        sanctionLetterLink: "https://example.com/grant.pdf",
        grantType: "Government",
      },
      contributors: [
        previewContributor({ userId: fixture.users.facultyCse.id, contributorRoleId: roles.get("PI")!, creditPercent: 60 }),
        previewContributor({ userId: fixture.users.facultyEce.id, contributorRoleId: roles.get("CO_PI")!, creditPercent: 20 }),
        previewContributor({ userId: fixture.users.schoolHead.id, contributorRoleId: roles.get("CO_PI")!, creditPercent: 20 }),
      ],
      systemMetrics: {},
    });
    const grantComponent = grantPreview?.components.find((row) => row.componentCode === "GRANT_INCENTIVE");
    expect(grantComponent?.totalAmount).toBe(100000);
    expect(grantComponent?.contributors.find((row) => row.userId === fixture.users.facultyCse.id)?.amount).toBeCloseTo(60000, 2);
    expect(grantComponent?.contributors.find((row) => row.userId === fixture.users.facultyEce.id)?.amount).toBeCloseTo(20000, 2);
    expect(grantComponent?.contributors.find((row) => row.userId === fixture.users.schoolHead.id)?.amount).toBeCloseTo(20000, 2);

    const consultancyPreview = await previewKpiRewards(consultancyKpi.id, fixture.tenant.id, {
      actualValue: 1,
      achievementFormData: {
        projectTitle: "Consultancy",
        clientOrg: "Client Inc",
        projectValue: 300000,
        totalExpenditure: 200000,
        savings: 100000,
        startDate: new Date("2026-01-01T00:00:00.000Z").toISOString(),
        endDate: new Date("2026-02-01T00:00:00.000Z").toISOString(),
        referenceNumber: "CONS-001",
        approvalLink: "https://example.com/consultancy.pdf",
      },
      contributors: [
        previewContributor({ userId: fixture.users.facultyCse.id, contributorRoleId: roles.get("LEAD_CONSULTANT")!, creditPercent: 34 }),
        previewContributor({ userId: fixture.users.facultyEce.id, contributorRoleId: roles.get("CONSULTANT")!, creditPercent: 33 }),
        previewContributor({ userId: fixture.users.schoolHead.id, contributorRoleId: roles.get("CONSULTANT")!, creditPercent: 33 }),
      ],
      systemMetrics: {},
    });
    const consultancyComponent = consultancyPreview?.components.find((row) => row.componentCode === "CONSULTANCY_INCENTIVE");
    expect(consultancyComponent?.totalAmount).toBe(70000);
    expect(consultancyComponent?.contributors).toHaveLength(3);
    expect(consultancyComponent?.contributors[0]?.amount).toBeCloseTo(23333.34, 2);

    const patentBlocked = await previewKpiRewards(patentKpi.id, fixture.tenant.id, {
      achievementFormData: {
        patentTitle: "Patent",
        applicationNumber: "PAT-001",
        patentOffice: "Indian Patent Office",
        filingDate: new Date("2026-02-02T00:00:00.000Z").toISOString(),
        status: "Filed",
        inventors: "Faculty CSE",
        applicantIsGU: false,
      },
      contributors: [
        previewContributor({ userId: fixture.users.facultyCse.id, contributorRoleId: roles.get("INVENTOR")!, creditPercent: 100 }),
      ],
      systemMetrics: {},
    });
    expect(patentBlocked?.components).toHaveLength(0);

    const patentAllowed = await previewKpiRewards(patentKpi.id, fixture.tenant.id, {
      achievementFormData: {
        patentTitle: "Patent",
        applicationNumber: "PAT-002",
        patentOffice: "Indian Patent Office",
        filingDate: new Date("2026-02-02T00:00:00.000Z").toISOString(),
        status: "Filed",
        inventors: "Faculty CSE, Faculty ECE",
        applicantIsGU: true,
      },
      contributors: [
        previewContributor({ userId: fixture.users.facultyCse.id, contributorRoleId: roles.get("INVENTOR")!, creditPercent: 50 }),
        previewContributor({ userId: fixture.users.facultyEce.id, contributorRoleId: roles.get("INVENTOR")!, creditPercent: 50 }),
      ],
      systemMetrics: {},
    });
    const patentComponent = patentAllowed?.components.find((row) => row.componentCode === "PATENT_FILING_INCENTIVE");
    expect(patentComponent?.totalAmount).toBe(2000);
    expect(patentComponent?.contributors[0]?.amount).toBeCloseTo(1000, 2);
    expect(patentComponent?.contributors[1]?.amount).toBeCloseTo(1000, 2);

    const intlConvenorBlocked = await previewKpiRewards(intlConvenorKpi.id, fixture.tenant.id, {
      achievementFormData: {
        conferenceName: "Intl Conf",
        conferenceType: "International",
        venue: "Campus",
        startDate: new Date("2026-04-10T00:00:00.000Z").toISOString(),
        endDate: new Date("2026-04-12T00:00:00.000Z").toISOString(),
        proceedingsPublisher: "Springer",
        proceedingsScopusIndexed: false,
        proceedingsLink: "https://example.com/proceedings",
        referenceNumber: "CONF-001",
      },
      contributors: [
        previewContributor({ userId: fixture.users.cseHead.id, contributorRoleId: roles.get("CONVENOR")!, creditPercent: 100 }),
      ],
      systemMetrics: {},
    });
    expect(intlConvenorBlocked?.components).toHaveLength(0);

    const intlConvenorAllowed = await previewKpiRewards(intlConvenorKpi.id, fixture.tenant.id, {
      achievementFormData: {
        conferenceName: "Intl Conf",
        conferenceType: "International",
        venue: "Campus",
        startDate: new Date("2026-04-10T00:00:00.000Z").toISOString(),
        endDate: new Date("2026-04-12T00:00:00.000Z").toISOString(),
        proceedingsPublisher: "Springer",
        proceedingsScopusIndexed: true,
        proceedingsLink: "https://example.com/proceedings",
        referenceNumber: "CONF-002",
      },
      contributors: [
        previewContributor({ userId: fixture.users.cseHead.id, contributorRoleId: roles.get("CONVENOR")!, creditPercent: 100 }),
      ],
      systemMetrics: {},
    });
    expect(
      intlConvenorAllowed?.components.find((row) => row.componentCode === "CONFERENCE_CONVENOR_INCENTIVE")?.totalAmount,
    ).toBe(5000);

    const fdpAllowed = await previewKpiRewards(fdpKpi.id, fixture.tenant.id, {
      achievementFormData: {
        programName: "FDP",
        programType: "FDP",
        sponsoringAgency: "AICTE",
        isSponsored: true,
        startDate: new Date("2026-04-01T00:00:00.000Z").toISOString(),
        endDate: new Date("2026-04-05T00:00:00.000Z").toISOString(),
        totalHours: 32,
        participantCount: 50,
        referenceNumber: "FDP-001",
        certificateLink: "https://example.com/fdp",
      },
      contributors: [
        previewContributor({ userId: fixture.users.cseHead.id, contributorRoleId: roles.get("CONVENOR")!, creditPercent: 100 }),
      ],
      systemMetrics: {},
    });
    expect(
      fdpAllowed?.components.find((row) => row.componentCode === "FDP_WORKSHOP_INCENTIVE")?.totalAmount,
    ).toBe(5000);

    const conferencePaperPreview = await previewKpiRewards(conferencePaperKpi.id, fixture.tenant.id, {
      actualValue: 1,
      achievementFormData: {
        conferenceName: "Conference",
        paperTitle: "Conference Paper",
        presentationType: "Oral",
        location: "Delhi",
        date: new Date("2026-05-01T00:00:00.000Z").toISOString(),
        proceedingsLink: "https://example.com/conf-paper",
        conferenceScope: "International",
        receivedUniversityFunding: false,
      },
      contributors: [
        previewContributor({ userId: fixture.users.facultyCse.id, contributorRoleId: roles.get("AUTHOR")!, creditPercent: 50 }),
        previewContributor({ userId: fixture.users.facultyEce.id, contributorRoleId: roles.get("CO_AUTHOR")!, creditPercent: 50 }),
      ],
      systemMetrics: {},
    });
    expect(conferencePaperKpi.guidanceNotes).toContain("max 2 claims per faculty per semester");
    expect(
      conferencePaperPreview?.components.find((row) => row.componentCode === "CONFERENCE_PAPER_INCENTIVE")?.totalAmount,
    ).toBe(5000);

    const edpPreview = await previewKpiRewards(edpKpi.id, fixture.tenant.id, {
      actualValue: 1,
      achievementFormData: {
        projectTitle: "EDP Program",
        clientOrg: "Client Org",
        projectValue: 300000,
        totalExpenditure: 200000,
        savings: 100000,
        startDate: new Date("2026-06-01T00:00:00.000Z").toISOString(),
        endDate: new Date("2026-06-05T00:00:00.000Z").toISOString(),
        referenceNumber: "EDP-001",
        approvalLink: "https://example.com/edp",
        programType: "EDP",
      },
      contributors: [
        previewContributor({ userId: fixture.users.cseHead.id, contributorRoleId: roles.get("CONVENOR")!, creditPercent: 70 }),
        previewContributor({ userId: fixture.users.facultyCse.id, contributorRoleId: roles.get("TEAM_MEMBER")!, creditPercent: 30 }),
      ],
      systemMetrics: {},
    });
    const edpComponent = edpPreview?.components.find((row) => row.componentCode === "EDP_MDP_INCENTIVE");
    expect(edpComponent?.totalAmount).toBe(70000);
    expect(edpComponent?.contributors.find((row) => row.userId === fixture.users.cseHead.id)?.amount).toBeCloseTo(49000, 2);
    expect(edpComponent?.contributors.find((row) => row.userId === fixture.users.facultyCse.id)?.amount).toBeCloseTo(21000, 2);
  });

  test("journal achievement stores manual credits and auto-excludes external contributors", async () => {
    const fixture = await createGalgotiaFixture();
    const journalKpi = await applyGalgotiaTemplate(
      fixture.tenant.id,
      fixture.actor.id,
      fixture.kra.id,
      fixture.structure.cseUnitId,
      "GU_SCOPUS_JOURNAL_PUBLICATION",
    );
    const allocation = await createScenarioAllocation({
      fixture,
      kpiId: journalKpi.id,
      assignedToUserId: fixture.users.facultyCse.id,
      targetValue: 1,
      notes: "GALGOTIA_JOURNAL_ALLOC",
    });
    const roles = await loadRoleIds(fixture.tenant.id, [
      "FIRST_AUTHOR",
      "CO_AUTHOR",
    ]);

    await setPeriodInProgress(fixture.period.id);

    const created = await recordAchievement(
      fixture.tenant.id,
      {
        periodId: fixture.period.id,
        kpiDefinitionId: journalKpi.id,
        targetAllocationId: allocation.id,
        actualValue: 1,
        evidenceLinks: ["https://example.com/journal-proof"],
        achievementFormData: {
          paperTitle: "Journal Case 5",
          journalName: "Journal",
          indexing: ["Scopus"],
          publicationDate: new Date("2026-05-10T00:00:00.000Z").toISOString(),
          pdfLink: "https://example.com/paper.pdf",
          doi: "10.1000/case-5",
          journalQuartile: "Q1",
          authorshipCase: "CASE_5",
          totalAuthors: 3,
          guAuthorsCount: 1,
          selfDeclaration: true,
        },
        contributors: [
          {
            type: "INTERNAL",
            userId: fixture.users.facultyCse.id,
            contributorRoleId: roles.get("CO_AUTHOR")!,
            creditPercent: 100,
          },
          {
            type: "EXTERNAL",
            contributorRoleId: roles.get("FIRST_AUTHOR")!,
            externalName: "External Author",
            externalAffiliation: "Other University",
            externalScope: "INTERNATIONAL",
            externalData: { country: "India" },
          },
        ],
      },
      fixture.users.facultyCse.id,
      "TENANT_USER",
    );
    expect(created.status).toBe("success");

    const achievement = await prisma.achievement.findUniqueOrThrow({
      where: { id: created.id! },
      include: { contributors: true },
    });

    const internal = achievement.contributors.find((row) => row.userId === fixture.users.facultyCse.id);
    const external = achievement.contributors.find((row) => row.type === "EXTERNAL");
    expect(internal?.creditPercent).toBe(100);
    expect(external?.isExcludedFromReward).toBe(true);

    const submitResult = await submitForVerification(
      achievement.id,
      fixture.tenant.id,
      fixture.users.facultyCse.id,
      "TENANT_USER",
      "Submitting case 5 claim",
    );
    expect(submitResult.status).toBe("success");
  });

  test("edited-book and chapter claims surface same-ISBN reviewer warnings", async () => {
    const fixture = await createGalgotiaFixture();
    const editedBookKpi = await applyGalgotiaTemplate(
      fixture.tenant.id,
      fixture.actor.id,
      fixture.kra.id,
      fixture.structure.cseUnitId,
      "GU_SCOPUS_EDITED_BOOK",
    );
    const chapterKpi = await applyGalgotiaTemplate(
      fixture.tenant.id,
      fixture.actor.id,
      fixture.kra.id,
      fixture.structure.cseUnitId,
      "GU_SCOPUS_BOOK_CHAPTER",
    );
    const roles = await loadRoleIds(fixture.tenant.id, [
      "CHIEF_EDITOR",
      "AUTHOR",
    ]);

    await setPeriodInProgress(fixture.period.id);

    const editedAllocation = await createScenarioAllocation({
      fixture,
      kpiId: editedBookKpi.id,
      assignedToUserId: fixture.users.facultyCse.id,
      targetValue: 1,
      notes: "EDITED_BOOK_ALLOC",
    });
    const chapterAllocation = await createScenarioAllocation({
      fixture,
      kpiId: chapterKpi.id,
      assignedToUserId: fixture.users.facultyCse.id,
      targetValue: 1,
      notes: "BOOK_CHAPTER_ALLOC",
    });

    const editedBook = await recordAchievement(
      fixture.tenant.id,
      {
        periodId: fixture.period.id,
        kpiDefinitionId: editedBookKpi.id,
        targetAllocationId: editedAllocation.id,
        actualValue: 1,
        evidenceLinks: ["https://example.com/edited-book"],
        achievementFormData: {
          bookTitle: "Edited Book",
          publisher: "Publisher",
          isbn: "978-93-000000-1",
          publicationYear: 2026,
          scopusIndexed: true,
          publisherLink: "https://example.com/book",
          bookType: "Edited Book",
          editorRole: "Chief Editor",
          selfDeclaration: true,
        },
        contributors: [
          {
            type: "INTERNAL",
            userId: fixture.users.facultyCse.id,
            contributorRoleId: roles.get("CHIEF_EDITOR")!,
          },
        ],
      },
      fixture.users.facultyCse.id,
      "TENANT_USER",
    );
    expect(editedBook.status).toBe("success");
    expect(
      await submitForVerification(
        editedBook.id!,
        fixture.tenant.id,
        fixture.users.facultyCse.id,
        "TENANT_USER",
        "Edited book submit",
      ),
    ).toMatchObject({ status: "success" });

    const chapter = await recordAchievement(
      fixture.tenant.id,
      {
        periodId: fixture.period.id,
        kpiDefinitionId: chapterKpi.id,
        targetAllocationId: chapterAllocation.id,
        actualValue: 1,
        evidenceLinks: ["https://example.com/chapter"],
        achievementFormData: {
          bookTitle: "Edited Book",
          publisher: "Publisher",
          isbn: "978-93-000000-1",
          publicationYear: 2026,
          scopusIndexed: true,
          publisherLink: "https://example.com/book",
          chapterTitle: "My Chapter",
          chapterNumber: 2,
          selfDeclaration: true,
        },
        contributors: [
          {
            type: "INTERNAL",
            userId: fixture.users.facultyCse.id,
            contributorRoleId: roles.get("AUTHOR")!,
          },
        ],
      },
      fixture.users.facultyCse.id,
      "TENANT_USER",
    );
    expect(chapter.status).toBe("success");

    const submitChapter = await submitForVerification(
      chapter.id!,
      fixture.tenant.id,
      fixture.users.facultyCse.id,
      "TENANT_USER",
      "Chapter submit",
    );
    expect(submitChapter.status).toBe("success");

    const chapterAchievement = await prisma.achievement.findUniqueOrThrow({
      where: { id: chapter.id! },
      select: {
        duplicateCheckResult: true,
      },
    });
    const duplicateCheckResult = chapterAchievement.duplicateCheckResult as {
      matches: Array<{ matchType?: string; note?: string | null; relatedKpiTitle?: string | null }>;
    } | null;
    expect(duplicateCheckResult?.matches.some((match) => match.matchType === "POLICY_WARNING")).toBe(true);

    const reviewQueue = await getMyReviewQueue(
      fixture.tenant.id,
      fixture.users.cseHead.id,
      fixture.period.id,
    );
    const queueItem = reviewQueue.find((item) => item.achievementId === chapter.id!);
    expect(queueItem?.guidanceNotes).toContain("Rs. 20,000");
    expect(queueItem?.duplicateCheckResult?.matches.some((match) => match.matchType === "POLICY_WARNING")).toBe(true);
  });
});
