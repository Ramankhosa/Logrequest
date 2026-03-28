import { afterEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { createKpi } from "@/lib/kra-kpi/kpi-service";
import { createKra, copyKrasFromPeriod } from "@/lib/kra-kpi/kra-service";
import {
  archiveTemplate,
  createTemplate,
  listTemplates,
  seedDefaultTemplates,
  setDefault,
  updateTemplate,
  validateExternalData,
} from "@/lib/kra-kpi/external-contrib-template-service";
import {
  getConfig,
  getEffectiveConfig,
  setConfig,
} from "@/lib/kra-kpi/kpi-contributor-config-service";
import { createPeriod } from "@/lib/kra-kpi/period-service";
import {
  cleanupTrackedData,
  createTenantActor,
  newDbTracker,
  type DbTracker,
} from "../helpers/db";
import type { AchievementFieldConfig } from "@/lib/kra-kpi/shared";

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

async function createKpiFixture(
  achievementFields: AchievementFieldConfig[] = [
    { key: "paperTitle", label: "Paper Title", type: "TEXT", required: true, sortOrder: 0 },
    { key: "doi", label: "DOI", type: "TEXT", required: false, sortOrder: 1 },
  ],
) {
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
      name: "R4.1b Period",
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
      achievementTemplateKey: "PUBLICATION",
      achievementFormConfig: {
        templateKey: "PUBLICATION",
        fields: achievementFields,
      },
    },
    actor.id,
    "TENANT_OWNER",
  );
  expect(kpiResult.status).toBe("success");

  const kpi = await prisma.kpiDefinition.findFirst({
    where: { kraDefinitionId: kra!.id, title: kpiTitle },
  });
  expect(kpi).toBeTruthy();

  return {
    tenant,
    actor,
    periodId: period!.id,
    kraId: kra!.id,
    kpiId: kpi!.id,
    kpiTitle,
    startingUnitId: startingUnit.id,
  };
}

async function getTemplateByName(tenantId: string, name: string) {
  const templates = await listTemplates(tenantId, true);
  return templates.find((template) => template.name === name) ?? null;
}

async function createCustomTemplate(input: {
  tenantId: string;
  actorUserId: string;
  name: string;
  fields?: AchievementFieldConfig[];
}) {
  const result = await createTemplate(
    input.tenantId,
    {
      name: input.name,
      description: "Custom external template",
      fields:
        input.fields ?? [
          { key: "name", label: "Full Name", type: "TEXT", required: true, sortOrder: 0 },
          {
            key: "affiliation",
            label: "Institution / Organization",
            type: "TEXT",
            required: true,
            sortOrder: 1,
          },
          { key: "orcid", label: "ORCID", type: "TEXT", required: false, sortOrder: 2 },
        ],
      sortOrder: 5,
    },
    input.actorUserId,
    "TENANT_OWNER",
  );

  expect(result.status).toBe("success");
  const template = await prisma.externalContributorTemplate.findUnique({
    where: { id: result.id! },
  });
  expect(template).toBeTruthy();
  return template!;
}

describe("R4.1b external contributors and templates", () => {
  test("seedDefaultTemplates is idempotent and creates the expected default set", async () => {
    tracker ??= newDbTracker();
    const { tenant } = await createTenantActor(tracker, "TENANT_OWNER");

    await seedDefaultTemplates(tenant.id);
    await seedDefaultTemplates(tenant.id);

    const templates = await listTemplates(tenant.id, true);
    expect(templates).toHaveLength(3);
    expect(templates.map((template) => template.name)).toEqual([
      "Default External",
      "Research Collaborator",
      "Industry Partner",
    ]);
    expect(templates.filter((template) => template.isDefault)).toHaveLength(1);
    expect(templates.find((template) => template.isDefault)?.name).toBe("Default External");
  });

  test("createTemplate rejects missing base fields and duplicate keys", async () => {
    const { tenant, actor } = await createKpiFixture();

    const missingAffiliation = await createTemplate(
      tenant.id,
      {
        name: "Broken Template",
        fields: [
          { key: "name", label: "Full Name", type: "TEXT", required: true, sortOrder: 0 },
          { key: "email", label: "Email", type: "EMAIL", required: false, sortOrder: 1 },
        ],
      },
      actor.id,
      "TENANT_OWNER",
    );
    expect(missingAffiliation.status).toBe("error");
    expect(missingAffiliation.message).toContain("affiliation");

    const duplicateKey = await createTemplate(
      tenant.id,
      {
        name: "Duplicate Key Template",
        fields: [
          { key: "name", label: "Full Name", type: "TEXT", required: true, sortOrder: 0 },
          {
            key: "affiliation",
            label: "Institution / Organization",
            type: "TEXT",
            required: true,
            sortOrder: 1,
          },
          { key: "name", label: "Display Name", type: "TEXT", required: false, sortOrder: 2 },
        ],
      },
      actor.id,
      "TENANT_OWNER",
    );
    expect(duplicateKey.status).toBe("error");
    expect(duplicateKey.message).toContain('Duplicate field key "name"');

    const declarationField = await createTemplate(
      tenant.id,
      {
        name: "Declaration Template",
        fields: [
          { key: "name", label: "Full Name", type: "TEXT", required: true, sortOrder: 0 },
          {
            key: "affiliation",
            label: "Institution / Organization",
            type: "TEXT",
            required: true,
            sortOrder: 1,
          },
          {
            key: "attestation",
            label: "I confirm the external profile is correct",
            type: "DECLARATION",
            required: true,
            sortOrder: 2,
          },
        ],
      },
      actor.id,
      "TENANT_OWNER",
    );
    expect(declarationField.status).toBe("error");
    expect(declarationField.message).toContain("not supported");
  });

  test("templates can be updated and default reassigned", async () => {
    const { tenant, actor } = await createKpiFixture();
    const template = await createCustomTemplate({
      tenantId: tenant.id,
      actorUserId: actor.id,
      name: "Visiting Expert",
    });

    const updated = await updateTemplate(
      template.id,
      tenant.id,
      {
        description: "Updated template",
        fields: [
          { key: "name", label: "Full Name", type: "TEXT", required: true, sortOrder: 0 },
          {
            key: "affiliation",
            label: "Institution / Organization",
            type: "TEXT",
            required: true,
            sortOrder: 1,
          },
          {
            key: "email",
            label: "Email",
            type: "EMAIL",
            required: false,
            sortOrder: 2,
          },
        ],
      },
      actor.id,
      "TENANT_OWNER",
    );
    expect(updated.status).toBe("success");

    const setDefaultResult = await setDefault(template.id, tenant.id, actor.id, "TENANT_OWNER");
    expect(setDefaultResult.status).toBe("success");

    const templates = await listTemplates(tenant.id, true);
    const saved = templates.find((row) => row.id === template.id);
    expect(saved?.description).toBe("Updated template");
    expect(saved?.fields.some((field) => field.key === "email")).toBe(true);
    expect(saved?.isDefault).toBe(true);
    expect(templates.filter((row) => row.isDefault)).toHaveLength(1);
  });

  test("archiveTemplate blocks when the template is linked to a KPI config", async () => {
    const { tenant, actor, kpiId } = await createKpiFixture();
    const template = await createCustomTemplate({
      tenantId: tenant.id,
      actorUserId: actor.id,
      name: "Industry Advisor",
    });

    const configResult = await setConfig(
      kpiId,
      tenant.id,
      {
        externalContribTemplateId: template.id,
      },
      actor.id,
      "TENANT_OWNER",
    );
    expect(configResult.status).toBe("success");

    const archived = await archiveTemplate(template.id, tenant.id, actor.id, "TENANT_OWNER");
    expect(archived.status).toBe("error");
    expect(archived.code).toBe("EXTERNAL_TEMPLATE_IN_USE");
  });

  test("validateExternalData covers valid, invalid, and unknown-key scenarios", async () => {
    const { tenant } = await createKpiFixture();
    const researchTemplate = await getTemplateByName(tenant.id, "Research Collaborator");
    expect(researchTemplate).toBeTruthy();

    const valid = await validateExternalData(researchTemplate!.id, tenant.id, {
      name: "Dr Jane Smith",
      affiliation: "Example University",
      scope: "International",
      country: "USA",
      orcid: "0000-0002-1234-5678",
      unexpected: "ignored",
    });
    expect(valid).toEqual({ valid: true, errors: [] });

    const missingCountry = await validateExternalData(researchTemplate!.id, tenant.id, {
      name: "Dr Jane Smith",
      affiliation: "Example University",
      scope: "International",
      orcid: "0000-0002-1234-5678",
    });
    expect(missingCountry.valid).toBe(false);
    expect(missingCountry.errors).toContain(
      "Country is required for international external contributors.",
    );

    const invalidOrcid = await validateExternalData(researchTemplate!.id, tenant.id, {
      name: "Dr Jane Smith",
      affiliation: "Example University",
      scope: "National",
      orcid: "abc",
    });
    expect(invalidOrcid.valid).toBe(false);
    expect(invalidOrcid.errors[0]).toContain("ORCID");
  });

  test("setConfig saves config, warns on unknown duplicate fields, and exposes raw/effective values", async () => {
    const { tenant, actor, kpiId } = await createKpiFixture();
    const researchTemplate = await getTemplateByName(tenant.id, "Research Collaborator");
    expect(researchTemplate).toBeTruthy();

    const result = await setConfig(
      kpiId,
      tenant.id,
      {
        allowExternalContributors: false,
        externalContribTemplateId: researchTemplate!.id,
        duplicateCheckFields: ["doi", "missingField"],
        creditSumMode: "MAX_100",
      },
      actor.id,
      "TENANT_OWNER",
    );
    expect(result.status).toBe("success");
    expect(result.message).toContain("missingField");

    const rawConfig = await getConfig(kpiId, tenant.id);
    expect(rawConfig).toMatchObject({
      externalContribTemplateId: researchTemplate!.id,
      allowExternalContributors: false,
      duplicateCheckFields: ["doi", "missingField"],
      creditSumMode: "MAX_100",
    });

    const effectiveConfig = await getEffectiveConfig(kpiId, tenant.id);
    expect(effectiveConfig).toMatchObject({
      externalContribTemplateId: researchTemplate!.id,
      externalContribTemplateName: "Research Collaborator",
      allowExternalContributors: false,
      duplicateCheckFields: ["doi", "missingField"],
      creditSumMode: "MAX_100",
      inheritedTemplate: false,
    });
  });

  test("getEffectiveConfig falls back to the tenant default template when no raw config exists", async () => {
    const { tenant, kpiId } = await createKpiFixture();

    const effectiveConfig = await getEffectiveConfig(kpiId, tenant.id);
    expect(effectiveConfig).toMatchObject({
      id: null,
      kpiDefinitionId: kpiId,
      externalContribTemplateName: "Default External",
      allowExternalContributors: true,
      duplicateCheckFields: [],
      creditSumMode: "MUST_EQUAL_100",
      inheritedTemplate: true,
    });
  });

  test("setConfig rejects templates from another tenant", async () => {
    const firstFixture = await createKpiFixture();
    tracker ??= newDbTracker();
    const secondTenant = await createTenantActor(tracker, "TENANT_OWNER");
    await seedDefaultTemplates(secondTenant.tenant.id);
    const foreignTemplate = await getTemplateByName(secondTenant.tenant.id, "Default External");
    expect(foreignTemplate).toBeTruthy();

    const result = await setConfig(
      firstFixture.kpiId,
      firstFixture.tenant.id,
      {
        externalContribTemplateId: foreignTemplate!.id,
      },
      firstFixture.actor.id,
      "TENANT_OWNER",
    );
    expect(result.status).toBe("error");
    expect(result.code).toBe("EXTERNAL_TEMPLATE_WRONG_TENANT");
  });

  test("copyKrasFromPeriod copies KPI contributor config", async () => {
    const { tenant, actor, periodId, kpiId, kpiTitle } = await createKpiFixture();
    const targetPeriodCode = rand("PERIOD");
    const targetPeriodResult = await createPeriod(
      tenant.id,
      {
        name: "Next Period",
        code: targetPeriodCode,
        periodType: "SPECIFIC_RANGE",
        startDate: new Date("2027-01-01T00:00:00.000Z"),
        endDate: new Date("2027-12-31T00:00:00.000Z"),
        reviewFrequency: "ANNUAL",
      },
      actor.id,
      "TENANT_OWNER",
    );
    expect(targetPeriodResult.status).toBe("success");

    const targetPeriod = await prisma.assessmentPeriod.findUnique({
      where: {
        tenantId_code: {
          tenantId: tenant.id,
          code: targetPeriodCode,
        },
      },
    });
    expect(targetPeriod).toBeTruthy();

    const template = await getTemplateByName(tenant.id, "Research Collaborator");
    expect(template).toBeTruthy();

    const configResult = await setConfig(
      kpiId,
      tenant.id,
      {
        externalContribTemplateId: template!.id,
        duplicateCheckFields: ["doi"],
        creditSumMode: "MAX_100",
      },
      actor.id,
      "TENANT_OWNER",
    );
    expect(configResult.status).toBe("success");

    const copyResult = await copyKrasFromPeriod(
      targetPeriod!.id,
      tenant.id,
      { sourcePeriodId: periodId },
      actor.id,
      "TENANT_OWNER",
    );
    expect(copyResult.status).toBe("success");

    const copiedKpi = await prisma.kpiDefinition.findFirst({
      where: {
        title: kpiTitle,
        kraDefinition: {
          tenantId: tenant.id,
          periodId: targetPeriod!.id,
        },
      },
      include: {
        contributorConfig: true,
      },
    });
    expect(copiedKpi?.contributorConfig).toMatchObject({
      externalContribTemplateId: template!.id,
      allowExternalContributors: true,
      duplicateCheckFields: ["doi"],
      creditSumMode: "MAX_100",
    });
  });
});
