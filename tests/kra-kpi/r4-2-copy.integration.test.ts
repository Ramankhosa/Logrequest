import { afterEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { saveKpiBuilder } from "@/lib/kra-kpi/kpi-builder-service";
import {
  copyKpiBuilderConfig,
  previewKpiCopy,
} from "@/lib/kra-kpi/kpi-copy-service";
import { copyKrasFromPeriod, createKra } from "@/lib/kra-kpi/kra-service";
import { createPeriod } from "@/lib/kra-kpi/period-service";
import { listKpiTemplates, applyTemplateToKpi } from "@/lib/kra-kpi/kpi-template-service";
import {
  cleanupTrackedData,
  createTenantActor,
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

async function createCopyFixture() {
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

  const sourcePeriodCode = rand("SRC_PERIOD");
  const targetPeriodCode = rand("TGT_PERIOD");

  const sourcePeriodResult = await createPeriod(
    tenant.id,
    {
      name: "R4.2 Source Period",
      code: sourcePeriodCode,
      periodType: "SPECIFIC_RANGE",
      startDate: new Date("2025-01-01T00:00:00.000Z"),
      endDate: new Date("2025-12-31T00:00:00.000Z"),
      reviewFrequency: "ANNUAL",
    },
    actor.id,
    "TENANT_OWNER",
  );
  const targetPeriodResult = await createPeriod(
    tenant.id,
    {
      name: "R4.2 Target Period",
      code: targetPeriodCode,
      periodType: "SPECIFIC_RANGE",
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      endDate: new Date("2026-12-31T00:00:00.000Z"),
      reviewFrequency: "ANNUAL",
    },
    actor.id,
    "TENANT_OWNER",
  );
  expect(sourcePeriodResult.status).toBe("success");
  expect(targetPeriodResult.status).toBe("success");

  const sourcePeriod = await prisma.assessmentPeriod.findUnique({
    where: {
      tenantId_code: {
        tenantId: tenant.id,
        code: sourcePeriodCode,
      },
    },
  });
  const targetPeriod = await prisma.assessmentPeriod.findUnique({
    where: {
      tenantId_code: {
        tenantId: tenant.id,
        code: targetPeriodCode,
      },
    },
  });
  expect(sourcePeriod).toBeTruthy();
  expect(targetPeriod).toBeTruthy();

  const sourceKraTitle = rand("SOURCE_KRA");
  const targetKraTitle = rand("TARGET_KRA");
  const sourceKraResult = await createKra(
    tenant.id,
    {
      periodId: sourcePeriod!.id,
      title: sourceKraTitle,
      weightage: 100,
    },
    actor.id,
    "TENANT_OWNER",
  );
  const targetKraResult = await createKra(
    tenant.id,
    {
      periodId: targetPeriod!.id,
      title: targetKraTitle,
      weightage: 100,
    },
    actor.id,
    "TENANT_OWNER",
  );
  expect(sourceKraResult.status).toBe("success");
  expect(targetKraResult.status).toBe("success");

  const sourceKra = await prisma.kraDefinition.findFirst({
    where: { tenantId: tenant.id, title: sourceKraTitle },
  });
  const targetKra = await prisma.kraDefinition.findFirst({
    where: { tenantId: tenant.id, title: targetKraTitle },
  });
  expect(sourceKra).toBeTruthy();
  expect(targetKra).toBeTruthy();

  const templates = await listKpiTemplates(tenant.id);
  const publicationTemplate = templates.find(
    (template) => template.code === "SYSTEM_RESEARCH_PUBLICATION",
  );
  expect(publicationTemplate).toBeTruthy();

  const sourceKpiResult = await applyTemplateToKpi(
    tenant.id,
    publicationTemplate!.id,
    {
      kraDefinitionId: sourceKra!.id,
      titleOverride: "Source Publication KPI",
      startingUnitId: unit.id,
    },
    actor.id,
    "TENANT_OWNER",
  );
  expect(sourceKpiResult.status).toBe("success");

  return {
    tenant,
    actor,
    unit,
    sourcePeriod: sourcePeriod!,
    targetPeriod: targetPeriod!,
    sourceKra: sourceKra!,
    targetKra: targetKra!,
    sourceKpiId: sourceKpiResult.id!,
  };
}

describe("R4.2 KPI copy/import", () => {
  test("previewKpiCopy reports source sections, counts, dependency hints, and summary", async () => {
    const fixture = await createCopyFixture();

    const preview = await previewKpiCopy(fixture.sourceKpiId, fixture.tenant.id);
    expect(preview).toBeTruthy();
    expect(preview?.sections.tiers).toBe(true);
    expect(preview?.sections.rewardComponents).toBe(true);
    expect(preview?.counts.tierCount).toBe(5);
    expect(preview?.counts.rewardComponentCount).toBe(10);
    expect(preview?.dependencyHints.distributionsRequireRewardComponents).toBe(true);
    expect(preview?.summary.tiers.map((tier) => tier.code)).toContain("Q1");
  });

  test("copyKpiBuilderConfig copies a full KPI config into a new KPI in another KRA", async () => {
    const fixture = await createCopyFixture();

    const result = await copyKpiBuilderConfig(
      fixture.tenant.id,
      {
        sourceKpiId: fixture.sourceKpiId,
        targetKraDefinitionId: fixture.targetKra.id,
        titleOverride: "Copied Publication KPI",
        startingUnitId: fixture.unit.id,
      },
      fixture.actor.id,
      "TENANT_OWNER",
    );

    expect(result.status).toBe("success");

    const copied = await prisma.kpiDefinition.findUnique({
      where: { id: result.id! },
      include: {
        rewardTiers: true,
        rewardComponents: { include: { distributions: true } },
      },
    });
    expect(copied?.title).toBe("Copied Publication KPI");
    expect(copied?.rewardTiers).toHaveLength(5);
    expect(copied?.rewardComponents).toHaveLength(10);
    expect(copied?.rewardComponents.find((component) => component.code === "Q1_MONETARY")?.distributions).toHaveLength(2);
  });

  test("copyKpiBuilderConfig auto-selects reward components and tiers when only distributions are requested", async () => {
    const fixture = await createCopyFixture();

    const draftCreate = await saveKpiBuilder(
      fixture.tenant.id,
      {
        definition: {
          kraDefinitionId: fixture.targetKra.id,
          title: "Draft KPI",
          measurementType: "NUMERIC",
          weightage: 10,
          allocationType: "INDIVIDUAL",
          startingUnitId: fixture.unit.id,
        },
        applicableRoles: [],
        contributorConfig: {
          allowExternalContributors: true,
          duplicateCheckFields: [],
          creditSumMode: "MUST_EQUAL_100",
        },
        stages: [],
        rewardTiers: [],
        rewardComponents: [],
      },
      fixture.actor.id,
      "TENANT_OWNER",
    );
    expect(draftCreate.status).toBe("success");

    const result = await copyKpiBuilderConfig(
      fixture.tenant.id,
      {
        sourceKpiId: fixture.sourceKpiId,
        targetKraDefinitionId: fixture.targetKra.id,
        targetKpiId: draftCreate.id!,
        selection: {
          basics: false,
          fields: false,
          participantPolicy: false,
          externalContributorPolicy: false,
          duplicateCheckPolicy: false,
          roles: false,
          stages: false,
          tiers: false,
          rewardComponents: false,
          distributions: true,
        },
      },
      fixture.actor.id,
      "TENANT_OWNER",
    );
    expect(result.status).toBe("success");

    const copied = await prisma.kpiDefinition.findUnique({
      where: { id: draftCreate.id! },
      include: {
        rewardTiers: true,
        rewardComponents: { include: { distributions: true } },
      },
    });
    expect(copied?.title).toBe("Draft KPI");
    expect(copied?.rewardTiers).toHaveLength(5);
    expect(copied?.rewardComponents).toHaveLength(10);
  });

  test("copyKrasFromPeriod preserves builder-owned config in period-to-period cloning", async () => {
    const fixture = await createCopyFixture();

    const result = await copyKrasFromPeriod(
      fixture.targetPeriod.id,
      fixture.tenant.id,
      { sourcePeriodId: fixture.sourcePeriod.id },
      fixture.actor.id,
      "TENANT_OWNER",
    );

    expect(result.status).toBe("error");
    expect(result.code).toBe("TARGET_PERIOD_NOT_EMPTY");

    const emptyTargetPeriodCode = rand("EMPTY_PERIOD");
    const emptyPeriodResult = await createPeriod(
      fixture.tenant.id,
      {
        name: "R4.2 Empty Target Period",
        code: emptyTargetPeriodCode,
        periodType: "SPECIFIC_RANGE",
        startDate: new Date("2027-01-01T00:00:00.000Z"),
        endDate: new Date("2027-12-31T00:00:00.000Z"),
        reviewFrequency: "ANNUAL",
      },
      fixture.actor.id,
      "TENANT_OWNER",
    );
    expect(emptyPeriodResult.status).toBe("success");

    const emptyTargetPeriod = await prisma.assessmentPeriod.findUnique({
      where: {
        tenantId_code: {
          tenantId: fixture.tenant.id,
          code: emptyTargetPeriodCode,
        },
      },
    });
    expect(emptyTargetPeriod).toBeTruthy();

    const copyResult = await copyKrasFromPeriod(
      emptyTargetPeriod!.id,
      fixture.tenant.id,
      { sourcePeriodId: fixture.sourcePeriod.id },
      fixture.actor.id,
      "TENANT_OWNER",
    );
    expect(copyResult.status).toBe("success");

    const copiedKpi = await prisma.kpiDefinition.findFirst({
      where: {
        kraDefinition: {
          tenantId: fixture.tenant.id,
          periodId: emptyTargetPeriod!.id,
        },
        title: "Source Publication KPI",
      },
      include: {
        applicableRoles: true,
        stages: true,
        rewardTiers: true,
        rewardComponents: { include: { distributions: true } },
      },
    });

    expect(copiedKpi).toBeTruthy();
    expect(copiedKpi?.applicableRoles.length).toBeGreaterThan(0);
    expect(copiedKpi?.rewardTiers).toHaveLength(5);
    expect(copiedKpi?.rewardComponents).toHaveLength(10);
  });
});
