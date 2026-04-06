import { afterEach, describe, expect, test } from "vitest";
import {
  AccreditationScope,
  AccreditationTemplateLifecycleStatus,
  CriterionBlockType,
  TenantServiceCode,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createKra } from "@/lib/kra-kpi/kra-service";
import { createPeriod } from "@/lib/kra-kpi/period-service";
import { applyTemplateToKpi, listKpiTemplates } from "@/lib/kra-kpi/kpi-template-service";
import {
  cleanupTrackedData,
  createTenantActor,
  enableTenantService,
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

async function createNaacTemplateFixture() {
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
      name: "NAAC KPI Template Period",
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

  const period = await prisma.assessmentPeriod.findUniqueOrThrow({
    where: {
      tenantId_code: {
        tenantId: tenant.id,
        code: periodCode,
      },
    },
  });

  const kraTitle = rand("KRA");
  const kraResult = await createKra(
    tenant.id,
    {
      periodId: period.id,
      title: kraTitle,
      weightage: 100,
    },
    actor.id,
    "TENANT_OWNER",
  );
  expect(kraResult.status).toBe("success");

  const kra = await prisma.kraDefinition.findFirstOrThrow({
    where: { tenantId: tenant.id, title: kraTitle },
  });

  return {
    tenant,
    actor,
    unit,
    kra,
  };
}

describe("R6.3 NAAC KPI starter templates", () => {
  test("system templates include the NAAC starter pack with portable accreditation refs", async () => {
    const fixture = await createNaacTemplateFixture();

    const templates = await listKpiTemplates(fixture.tenant.id);
    const publicationTemplate = templates.find(
      (row) => row.code === "SYSTEM_NAAC_UNIV_RESEARCH_PUBLICATION",
    );

    expect(publicationTemplate).toBeTruthy();
    expect(publicationTemplate?.category).toBe("NAAC_STARTER");

    const payload = publicationTemplate?.builderPayload as {
      meta?: {
        starterPackKey?: string | null;
        accreditationRefs?: Array<{ blockCode: string; officialMetricCode?: string | null }>;
      };
    };
    expect(payload.meta?.starterPackKey).toBe("NAAC_UNIVERSITY_2019_FACULTY_STARTER");
    expect(payload.meta?.accreditationRefs).toEqual([
      expect.objectContaining({
        blockCode: "METRIC_3.4.5",
        officialMetricCode: "3.4.5",
      }),
    ]);
  });

  test("applying a NAAC starter template still succeeds when accreditation is not enabled", async () => {
    const fixture = await createNaacTemplateFixture();

    const templates = await listKpiTemplates(fixture.tenant.id);
    const publicationTemplate = templates.find(
      (row) => row.code === "SYSTEM_NAAC_UNIV_RESEARCH_PUBLICATION",
    );
    expect(publicationTemplate).toBeTruthy();

    const applyResult = await applyTemplateToKpi(
      fixture.tenant.id,
      publicationTemplate!.id,
      {
        kraDefinitionId: fixture.kra.id,
        titleOverride: "NAAC Publication KPI",
        startingUnitId: fixture.unit.id,
      },
      fixture.actor.id,
      "TENANT_OWNER",
    );
    expect(applyResult.status).toBe("success");

    const linkCount = await prisma.kpiAccreditationBlockLink.count({
      where: {
        tenantId: fixture.tenant.id,
        kpiDefinitionId: applyResult.id!,
      },
    });
    expect(linkCount).toBe(0);
  });

  test("applying a NAAC starter template auto-links to seeded NAAC metric blocks when accreditation is enabled", async () => {
    const fixture = await createNaacTemplateFixture();

    await enableTenantService({
      tenantId: fixture.tenant.id,
      serviceCode: TenantServiceCode.ACCREDITATION,
      actorUserId: fixture.actor.id,
    });

    const body = await prisma.accreditationBody.create({
      data: {
        tenantId: fixture.tenant.id,
        scope: AccreditationScope.TENANT,
        code: "NAAC",
        name: "NAAC",
        isActive: true,
      },
    });

    const version = await prisma.accreditationBodyVersion.create({
      data: {
        bodyId: body.id,
        versionCode: "UNIVERSITY_MANUAL_DEC_2019",
        versionName: "University Manual December 2019",
        scoreBase: 1000,
        lifecycleStatus: AccreditationTemplateLifecycleStatus.PUBLISHED,
        publishedAt: new Date(),
        isActive: true,
      },
    });

    const root = await prisma.criterionBlock.create({
      data: {
        versionId: version.id,
        blockCode: "3.4",
        lineageKey: "3.4",
        blockType: CriterionBlockType.GROUP,
        title: "Research Publications and Awards",
        isLeaf: false,
        isSectionRoot: true,
        depth: 0,
        sortOrder: 1,
      },
    });

    await prisma.criterionBlock.create({
      data: {
        versionId: version.id,
        parentId: root.id,
        blockCode: "METRIC_3.4.5",
        lineageKey: "3.4.5",
        blockType: CriterionBlockType.METRIC,
        title: "Research papers per teacher",
        isLeaf: true,
        depth: 1,
        sortOrder: 1,
        maxScore: 25,
      },
    });

    const templates = await listKpiTemplates(fixture.tenant.id);
    const publicationTemplate = templates.find(
      (row) => row.code === "SYSTEM_NAAC_UNIV_RESEARCH_PUBLICATION",
    );
    expect(publicationTemplate).toBeTruthy();

    const applyResult = await applyTemplateToKpi(
      fixture.tenant.id,
      publicationTemplate!.id,
      {
        kraDefinitionId: fixture.kra.id,
        titleOverride: "NAAC Publication KPI",
        startingUnitId: fixture.unit.id,
      },
      fixture.actor.id,
      "TENANT_OWNER",
    );
    expect(applyResult.status).toBe("success");

    const links = await prisma.kpiAccreditationBlockLink.findMany({
      where: {
        tenantId: fixture.tenant.id,
        kpiDefinitionId: applyResult.id!,
      },
      include: {
        block: {
          select: {
            blockCode: true,
            version: {
              select: {
                versionCode: true,
                body: {
                  select: {
                    code: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    expect(links).toHaveLength(1);
    expect(links[0]?.block.blockCode).toBe("METRIC_3.4.5");
    expect(links[0]?.block.version.versionCode).toBe("UNIVERSITY_MANUAL_DEC_2019");
    expect(links[0]?.block.version.body.code).toBe("NAAC");
  });
});
