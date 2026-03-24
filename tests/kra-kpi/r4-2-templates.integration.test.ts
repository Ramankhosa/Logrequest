import { afterEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import type { KpiTemplateWriteInput } from "@/lib/kra-kpi/builder-shared";
import { getKpiBuilder } from "@/lib/kra-kpi/kpi-builder-service";
import {
  applyTemplateToKpi,
  createKpiTemplate,
  getKpiTemplate,
  listKpiTemplates,
  updateKpiTemplate,
} from "@/lib/kra-kpi/kpi-template-service";
import { createKra } from "@/lib/kra-kpi/kra-service";
import { createPeriod } from "@/lib/kra-kpi/period-service";
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

async function createTemplateFixture() {
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
      name: "R4.2 Template Period",
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

  return {
    tenant,
    actor,
    unit,
    kra: kra!,
  };
}

describe("R4.2 KPI templates", () => {
  test("listKpiTemplates seeds system templates and publication template includes reward config", async () => {
    const fixture = await createTemplateFixture();

    const templates = await listKpiTemplates(fixture.tenant.id);
    expect(templates.some((row) => row.code === "SYSTEM_RESEARCH_PUBLICATION")).toBe(true);
    expect(templates.some((row) => row.code === "SYSTEM_RESEARCH_GRANT")).toBe(true);
    expect(templates.some((row) => row.code === "SYSTEM_PATENT")).toBe(true);

    const publication = templates.find((row) => row.code === "SYSTEM_RESEARCH_PUBLICATION");
    expect(publication).toBeTruthy();

    const payload = publication?.builderPayload as {
      rewardTiers: Array<unknown>;
      rewardComponents: Array<unknown>;
    };
    expect(payload.rewardTiers).toHaveLength(5);
    expect(payload.rewardComponents).toHaveLength(10);
  });

  test("create and update tenant templates keep a full builder snapshot", async () => {
    const fixture = await createTemplateFixture();
    const systemTemplates = await listKpiTemplates(fixture.tenant.id);
    const systemPublication = systemTemplates.find(
      (row) => row.code === "SYSTEM_RESEARCH_PUBLICATION",
    );
    expect(systemPublication).toBeTruthy();

    const tenantTemplate: KpiTemplateWriteInput = {
      code: rand("TENANT_TEMPLATE"),
      name: "Tenant Publication Template",
      description: "Customized publication template",
      category: "RESEARCH",
      isActive: true,
      sortOrder: 10,
      payload: systemPublication!.builderPayload as KpiTemplateWriteInput["payload"],
    };

    const createResult = await createKpiTemplate(
      fixture.tenant.id,
      tenantTemplate,
      fixture.actor.id,
      "TENANT_OWNER",
    );
    expect(createResult.status).toBe("success");

    const updateResult = await updateKpiTemplate(
      createResult.id!,
      fixture.tenant.id,
      {
        name: "Tenant Publication Template v2",
        payload: {
          ...(tenantTemplate.payload),
          definition: {
            ...tenantTemplate.payload.definition,
            title: "Tenant Publication KPI v2",
          },
        },
      },
      fixture.actor.id,
      "TENANT_OWNER",
    );
    expect(updateResult.status).toBe("success");

    const savedTemplate = await getKpiTemplate(createResult.id!, fixture.tenant.id);
    expect(savedTemplate?.name).toBe("Tenant Publication Template v2");
    expect(
      (savedTemplate?.builderPayload as { definition: { title: string } }).definition.title,
    ).toBe("Tenant Publication KPI v2");
  });

  test("applyTemplateToKpi materializes a decoupled KPI snapshot", async () => {
    const fixture = await createTemplateFixture();
    const systemTemplates = await listKpiTemplates(fixture.tenant.id);
    const systemPublication = systemTemplates.find(
      (row) => row.code === "SYSTEM_RESEARCH_PUBLICATION",
    );
    expect(systemPublication).toBeTruthy();

    const tenantTemplate: KpiTemplateWriteInput = {
      code: rand("TENANT_TEMPLATE"),
      name: "Tenant Publication Template",
      description: "Customized publication template",
      category: "RESEARCH",
      isActive: true,
      sortOrder: 10,
      payload: systemPublication!.builderPayload as KpiTemplateWriteInput["payload"],
    };
    const createTemplateResult = await createKpiTemplate(
      fixture.tenant.id,
      tenantTemplate,
      fixture.actor.id,
      "TENANT_OWNER",
    );
    expect(createTemplateResult.status).toBe("success");

    const applyResult = await applyTemplateToKpi(
      fixture.tenant.id,
      createTemplateResult.id!,
      {
        kraDefinitionId: fixture.kra.id,
        titleOverride: "Applied Publication KPI",
        startingUnitId: fixture.unit.id,
      },
      fixture.actor.id,
      "TENANT_OWNER",
    );
    expect(applyResult.status).toBe("success");

    const kpiBuilder = await getKpiBuilder(applyResult.id!, fixture.tenant.id);
    expect(kpiBuilder?.definition.title).toBe("Applied Publication KPI");
    expect(kpiBuilder?.rewardTiers).toHaveLength(5);
    expect(kpiBuilder?.rewardComponents).toHaveLength(10);
    expect(
      kpiBuilder?.rewardComponents.some(
        (component) =>
          component.code === "Q1_MONETARY" &&
          component.distributions.some(
            (distribution) =>
              distribution.selectorType === "SELECTOR_TAG" &&
              distribution.selectorTag === "FIRST_AUTHOR",
          ),
      ),
    ).toBe(true);

    const updateTemplateResult = await updateKpiTemplate(
      createTemplateResult.id!,
      fixture.tenant.id,
      {
        payload: {
          ...tenantTemplate.payload,
          definition: {
            ...tenantTemplate.payload.definition,
            title: "Mutated Template Title",
          },
        },
      },
      fixture.actor.id,
      "TENANT_OWNER",
    );
    expect(updateTemplateResult.status).toBe("success");

    const persistedKpi = await getKpiBuilder(applyResult.id!, fixture.tenant.id);
    expect(persistedKpi?.definition.title).toBe("Applied Publication KPI");
  });
});
