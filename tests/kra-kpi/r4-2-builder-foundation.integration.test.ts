import { afterEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import type { KpiBuilderPayload } from "@/lib/kra-kpi/builder-shared";
import { saveKpiBuilder, getKpiBuilder } from "@/lib/kra-kpi/kpi-builder-service";
import { createContributorRole } from "@/lib/kra-kpi/contributor-role-service";
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
      name: "Research Cell",
      state: "ACTIVE",
    },
  });

  const periodCode = rand("PERIOD");
  const periodResult = await createPeriod(
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

  const leadRoleResult = await createContributorRole(
    tenant.id,
    {
      code: rand("LEAD"),
      name: "Lead Author",
      defaultCreditPercent: 70,
      sortOrder: 0,
    },
    actor.id,
    "TENANT_OWNER",
  );
  const coRoleResult = await createContributorRole(
    tenant.id,
    {
      code: rand("CO"),
      name: "Co Author",
      defaultCreditPercent: 30,
      sortOrder: 1,
    },
    actor.id,
    "TENANT_OWNER",
  );
  expect(leadRoleResult.status).toBe("success");
  expect(coRoleResult.status).toBe("success");

  return {
    tenant,
    actor,
    unit,
    kra: kra!,
    leadRoleId: leadRoleResult.id!,
    coRoleId: coRoleResult.id!,
  };
}

function buildPayload(input: {
  kraDefinitionId: string;
  startingUnitId: string;
  leadRoleId: string;
  coRoleId: string;
  existingId?: string;
}): KpiBuilderPayload {
  return {
    definition: {
      id: input.existingId,
      kraDefinitionId: input.kraDefinitionId,
      title: "Faculty Publication KPI",
      description: "Tracks verified research publications.",
      measurementType: "NUMERIC",
      unitLabel: "papers",
      weightage: 60,
      defaultTarget: 12,
      measurementConfig: {
        type: "NUMERIC",
        decimalPlaces: 0,
      },
      scoringMethod: "LINEAR",
      scoringDirection: "ASCENDING",
      scoringConfig: null,
      isPerCapita: false,
      allocationType: "INDIVIDUAL",
      startingUnitId: input.startingUnitId,
      achievementTemplateKey: null,
      achievementFormConfig: {
        fields: [
          {
            key: "paperTitle",
            label: "Paper Title",
            type: "TEXT",
            required: true,
            sortOrder: 0,
          },
          {
            key: "doi",
            label: "DOI",
            type: "TEXT",
            required: false,
            sortOrder: 1,
            marker: "UNIQUE_CHECK",
          },
          {
            key: "publicationDate",
            label: "Publication Date",
            type: "DATE",
            required: true,
            sortOrder: 2,
            binding: "POLICY_DATE_FIELD",
          },
        ],
      },
      guidanceNotes: "Attach the accepted publication evidence.",
      sortOrder: 0,
      keyUnitId: null,
      finalUnitId: null,
      sopDescription: null,
      evidenceRequired: true,
      evidenceTypes: ["DOCUMENT", "URL"],
      evidenceInstructions: "Attach publication proof.",
      isTeamKpi: true,
      teamCreditMethod: "WEIGHTED_SPLIT",
      allowPartialCompletion: true,
      participantMode: "OPTIONAL_TEAM",
      rewardRecurrencePolicy: "ONCE_PER_UNIQUE_KEY",
      policyDateFieldKey: "publicationDate",
      contributionRoles: null,
    },
    applicableRoles: [
      { roleId: input.leadRoleId, isDefault: true, sortOrder: 0 },
      { roleId: input.coRoleId, isDefault: false, sortOrder: 1 },
    ],
    contributorConfig: {
      externalContribTemplateId: null,
      allowExternalContributors: true,
      duplicateCheckFields: ["doi"],
      creditSumMode: "MUST_EQUAL_100",
    },
    stages: [
      {
        title: "Submission",
        description: "Submit paper details",
        stageOrder: 1,
        weight: 50,
        isMandatory: true,
        evidenceRequired: true,
        evidenceTypes: ["DOCUMENT"],
        evidenceInstructions: "Attach draft or acceptance letter.",
        deadline: new Date("2026-06-30T00:00:00.000Z"),
      },
      {
        title: "Verification",
        description: "Verification by research office",
        stageOrder: 2,
        weight: 50,
        isMandatory: true,
        evidenceRequired: false,
        evidenceTypes: [],
        evidenceInstructions: null,
        deadline: new Date("2026-12-31T00:00:00.000Z"),
      },
    ],
    rewardTiers: [],
    rewardComponents: [],
  };
}

describe("R4.2 builder foundation integration", () => {
  test("saveKpiBuilder creates and round-trips the builder payload for an existing KPI structure", async () => {
    const fixture = await createBuilderFixture();
    const payload = buildPayload({
      kraDefinitionId: fixture.kra.id,
      startingUnitId: fixture.unit.id,
      leadRoleId: fixture.leadRoleId,
      coRoleId: fixture.coRoleId,
    });

    const createResult = await saveKpiBuilder(
      fixture.tenant.id,
      payload,
      fixture.actor.id,
      "TENANT_OWNER",
    );

    expect(createResult.status).toBe("success");
    expect(createResult.id).toBeTruthy();

    const saved = await getKpiBuilder(createResult.id!, fixture.tenant.id);
    expect(saved).toBeTruthy();
    expect(saved?.definition.title).toBe("Faculty Publication KPI");
    expect(saved?.definition.participantMode).toBe("OPTIONAL_TEAM");
    expect(saved?.definition.rewardRecurrencePolicy).toBe("ONCE_PER_UNIQUE_KEY");
    expect(saved?.contributorConfig.duplicateCheckFields).toEqual(["doi"]);
    expect(saved?.applicableRoles).toHaveLength(2);
    expect(saved?.stages.map((stage) => stage.title)).toEqual([
      "Submission",
      "Verification",
    ]);
  });

  test("saveKpiBuilder updates builder-managed sections without breaking round-trip integrity", async () => {
    const fixture = await createBuilderFixture();
    const payload = buildPayload({
      kraDefinitionId: fixture.kra.id,
      startingUnitId: fixture.unit.id,
      leadRoleId: fixture.leadRoleId,
      coRoleId: fixture.coRoleId,
    });

    const createResult = await saveKpiBuilder(
      fixture.tenant.id,
      payload,
      fixture.actor.id,
      "TENANT_OWNER",
    );
    expect(createResult.status).toBe("success");

    const original = await getKpiBuilder(createResult.id!, fixture.tenant.id);
    expect(original).toBeTruthy();

    const updated: KpiBuilderPayload = {
      ...original!,
      definition: {
        ...original!.definition,
        title: "Faculty Publication KPI v2",
      },
      contributorConfig: {
        ...original!.contributorConfig,
        allowExternalContributors: false,
      },
      stages: [
        {
          ...original!.stages[0]!,
          title: "Initial Submission",
        },
      ],
    };

    const updateResult = await saveKpiBuilder(
      fixture.tenant.id,
      updated,
      fixture.actor.id,
      "TENANT_OWNER",
    );

    expect(updateResult.status).toBe("success");

    const saved = await getKpiBuilder(createResult.id!, fixture.tenant.id);
    expect(saved?.definition.title).toBe("Faculty Publication KPI v2");
    expect(saved?.contributorConfig.allowExternalContributors).toBe(false);
    expect(saved?.stages).toHaveLength(1);
    expect(saved?.stages[0]?.title).toBe("Initial Submission");
  });

  test("saveKpiBuilder rejects once-per-unique-key KPIs when duplicate-check fields are missing", async () => {
    const fixture = await createBuilderFixture();
    const payload = buildPayload({
      kraDefinitionId: fixture.kra.id,
      startingUnitId: fixture.unit.id,
      leadRoleId: fixture.leadRoleId,
      coRoleId: fixture.coRoleId,
    });

    payload.contributorConfig.duplicateCheckFields = [];

    const result = await saveKpiBuilder(
      fixture.tenant.id,
      payload,
      fixture.actor.id,
      "TENANT_OWNER",
    );

    expect(result.status).toBe("error");
    expect(result.code).toBe("REWARD_CONFIG_INVALID");
    expect(result.message).toContain("Once-per-unique-key");
  });
});
