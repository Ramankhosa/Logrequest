import { afterEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import type { KpiBuilderPayload } from "@/lib/kra-kpi/builder-shared";
import {
  recordAchievement,
  submitForVerification,
  verifyAchievement,
} from "@/lib/kra-kpi/achievement-service";
import { saveKpiBuilder } from "@/lib/kra-kpi/kpi-builder-service";
import { createKra } from "@/lib/kra-kpi/kra-service";
import { createKpi, updateKpi } from "@/lib/kra-kpi/kpi-service";
import { getMyAllocations, getMyDashboardSummary } from "@/lib/kra-kpi/my-kpi-service";
import { createPeriod } from "@/lib/kra-kpi/period-service";
import { markStageComplete } from "@/lib/kra-kpi/stage-progress-service";
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

async function createBaseFixture() {
  tracker ??= newDbTracker();
  const { tenant, actor } = await createTenantActor(tracker, "TENANT_OWNER");
  const faculty = await createTestUser(tracker, {
    firstName: "Raman",
    lastName: "Faculty",
  });

  await createTestMembership({
    tenantId: tenant.id,
    userId: faculty.id,
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
      name: "Research Department",
      state: "ACTIVE",
    },
  });

  for (const userId of [actor.id, faculty.id]) {
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
      name: "Parallel Achievement Period",
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

  return {
    tenant,
    actor,
    faculty,
    period: period!,
    kra: kra!,
    unit,
  };
}

async function createPublicationKpiFixture(input?: {
  allowMultipleAchievementsPerAllocation?: boolean;
  defaultTarget?: number;
}) {
  const base = await createBaseFixture();
  const kpiTitle = rand("PUBLICATION_KPI");
  const createResult = await createKpi(
    base.tenant.id,
    {
      kraDefinitionId: base.kra.id,
      title: kpiTitle,
      description: "Tracks publication submissions per paper.",
      measurementType: "NUMERIC",
      unitLabel: "papers",
      weightage: 100,
      allocationType: "INDIVIDUAL",
      startingUnitId: base.unit.id,
      defaultTarget: input?.defaultTarget ?? 2,
      evidenceRequired: true,
      allowMultipleAchievementsPerAllocation:
        input?.allowMultipleAchievementsPerAllocation ?? true,
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
          },
        ],
      },
    },
    base.actor.id,
    "TENANT_OWNER",
  );
  expect(createResult.status).toBe("success");

  const kpi = await prisma.kpiDefinition.findFirst({
    where: { kraDefinitionId: base.kra.id, title: kpiTitle },
  });
  expect(kpi).toBeTruthy();

  await prisma.kpiDefinition.update({
    where: { id: kpi!.id },
    data: { state: "ACTIVE" },
  });
  await prisma.assessmentPeriod.update({
    where: { id: base.period.id },
    data: { state: "IN_PROGRESS" },
  });

  const allocation = await prisma.targetAllocation.create({
    data: {
      tenantId: base.tenant.id,
      periodId: base.period.id,
      kpiDefinitionId: kpi!.id,
      assignedToUserId: base.faculty.id,
      allocatedByUserId: base.actor.id,
      targetValue: input?.defaultTarget ?? 2,
      state: "ACTIVE",
    },
  });

  return {
    ...base,
    kpi: kpi!,
    allocation,
  };
}

async function recordPaperAchievement(input: {
  tenantId: string;
  periodId: string;
  kpiDefinitionId: string;
  targetAllocationId: string;
  actorUserId: string;
  paperTitle: string;
  actualValue: number;
  reportingDate: string;
}) {
  return recordAchievement(
    input.tenantId,
    {
      periodId: input.periodId,
      kpiDefinitionId: input.kpiDefinitionId,
      targetAllocationId: input.targetAllocationId,
      actualValue: input.actualValue,
      reportingDate: new Date(input.reportingDate),
      evidenceDescription: `${input.paperTitle} evidence`,
      achievementFormData: {
        paperTitle: input.paperTitle,
      },
    },
    input.actorUserId,
    "TENANT_USER",
  );
}

describe("parallel achievement requests under one allocation", () => {
  test("multi-request KPI allows multiple same-cycle paper requests and forces actual value to one", async () => {
    const fixture = await createPublicationKpiFixture({
      allowMultipleAchievementsPerAllocation: true,
      defaultTarget: 3,
    });

    const first = await recordPaperAchievement({
      tenantId: fixture.tenant.id,
      periodId: fixture.period.id,
      kpiDefinitionId: fixture.kpi.id,
      targetAllocationId: fixture.allocation.id,
      actorUserId: fixture.faculty.id,
      paperTitle: "Paper One",
      actualValue: 5,
      reportingDate: "2026-01-10T00:00:00.000Z",
    });
    const second = await recordPaperAchievement({
      tenantId: fixture.tenant.id,
      periodId: fixture.period.id,
      kpiDefinitionId: fixture.kpi.id,
      targetAllocationId: fixture.allocation.id,
      actorUserId: fixture.faculty.id,
      paperTitle: "Paper Two",
      actualValue: 9,
      reportingDate: "2026-01-25T00:00:00.000Z",
    });

    expect(first.status).toBe("success");
    expect(second.status).toBe("success");

    const achievements = await prisma.achievement.findMany({
      where: {
        tenantId: fixture.tenant.id,
        targetAllocationId: fixture.allocation.id,
      },
      orderBy: { reportingDate: "asc" },
      select: {
        title: true,
        actualValue: true,
      },
    });

    expect(achievements).toHaveLength(2);
    expect(achievements.map((achievement) => achievement.title)).toEqual([
      "Paper One",
      "Paper Two",
    ]);
    expect(achievements.every((achievement) => achievement.actualValue === 1)).toBe(true);
  });

  test("official progress rolls up from verified requests only even when the latest request is still pending", async () => {
    const fixture = await createPublicationKpiFixture({
      allowMultipleAchievementsPerAllocation: true,
      defaultTarget: 2,
    });

    const first = await recordPaperAchievement({
      tenantId: fixture.tenant.id,
      periodId: fixture.period.id,
      kpiDefinitionId: fixture.kpi.id,
      targetAllocationId: fixture.allocation.id,
      actorUserId: fixture.faculty.id,
      paperTitle: "Verified Paper One",
      actualValue: 3,
      reportingDate: "2026-02-01T00:00:00.000Z",
    });
    const second = await recordPaperAchievement({
      tenantId: fixture.tenant.id,
      periodId: fixture.period.id,
      kpiDefinitionId: fixture.kpi.id,
      targetAllocationId: fixture.allocation.id,
      actorUserId: fixture.faculty.id,
      paperTitle: "Verified Paper Two",
      actualValue: 4,
      reportingDate: "2026-03-01T00:00:00.000Z",
    });
    const third = await recordPaperAchievement({
      tenantId: fixture.tenant.id,
      periodId: fixture.period.id,
      kpiDefinitionId: fixture.kpi.id,
      targetAllocationId: fixture.allocation.id,
      actorUserId: fixture.faculty.id,
      paperTitle: "Pending Paper Three",
      actualValue: 8,
      reportingDate: "2026-04-01T00:00:00.000Z",
    });

    for (const achievementId of [first.id!, second.id!, third.id!]) {
      const submitResult = await submitForVerification(
        achievementId,
        fixture.tenant.id,
        fixture.faculty.id,
        "TENANT_USER",
      );
      expect(submitResult.status).toBe("success");
    }

    for (const achievementId of [first.id!, second.id!]) {
      const verifyResult = await verifyAchievement(
        achievementId,
        fixture.tenant.id,
        true,
        "Verified",
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(verifyResult.status).toBe("success");
    }

    const allocations = await getMyAllocations(
      fixture.tenant.id,
      fixture.faculty.id,
      fixture.period.id,
    );
    expect(allocations).toHaveLength(1);
    expect(allocations[0]?.achievement?.title).toBe("Pending Paper Three");
    expect(allocations[0]?.achievement?.state).toBe("SUBMITTED");
    expect(allocations[0]?.achievementAggregate.totalRequests).toBe(3);
    expect(allocations[0]?.achievementAggregate.officialActualValue).toBe(2);
    expect(allocations[0]?.achievementAggregate.countsByState.verified).toBe(2);
    expect(allocations[0]?.achievementAggregate.countsByState.submitted).toBe(1);
    expect(allocations[0]?.achievementAggregate.officialScore).toBe(100);

    const dashboard = await getMyDashboardSummary(
      fixture.tenant.id,
      fixture.faculty.id,
      fixture.period.id,
    );
    expect(dashboard?.statusCounts.completed).toBe(1);
    expect(dashboard?.statusCounts.pendingReview).toBe(0);
    expect(dashboard?.overallPercentage).toBe(100);
  });

  test("cannot disable parallel mode once an allocation already has multiple linked achievements", async () => {
    const fixture = await createPublicationKpiFixture({
      allowMultipleAchievementsPerAllocation: true,
      defaultTarget: 2,
    });

    const first = await recordPaperAchievement({
      tenantId: fixture.tenant.id,
      periodId: fixture.period.id,
      kpiDefinitionId: fixture.kpi.id,
      targetAllocationId: fixture.allocation.id,
      actorUserId: fixture.faculty.id,
      paperTitle: "Disable Guard One",
      actualValue: 10,
      reportingDate: "2026-01-05T00:00:00.000Z",
    });
    const second = await recordPaperAchievement({
      tenantId: fixture.tenant.id,
      periodId: fixture.period.id,
      kpiDefinitionId: fixture.kpi.id,
      targetAllocationId: fixture.allocation.id,
      actorUserId: fixture.faculty.id,
      paperTitle: "Disable Guard Two",
      actualValue: 11,
      reportingDate: "2026-01-18T00:00:00.000Z",
    });

    expect(first.status).toBe("success");
    expect(second.status).toBe("success");

    await prisma.assessmentPeriod.update({
      where: { id: fixture.period.id },
      data: { state: "OPEN" },
    });

    const updateResult = await updateKpi(
      fixture.kpi.id,
      fixture.tenant.id,
      {
        allowMultipleAchievementsPerAllocation: false,
      },
      fixture.actor.id,
      "TENANT_OWNER",
    );

    expect(updateResult.status).toBe("error");
    expect(updateResult.message).toContain("multiple linked achievements");
  });

  test("non-numeric KPIs can also enable parallel achievement requests", async () => {
    const base = await createBaseFixture();
    const kpiTitle = rand("BOOLEAN_MULTI_KPI");

    const result = await createKpi(
      base.tenant.id,
      {
        kraDefinitionId: base.kra.id,
        title: kpiTitle,
        description: "Boolean KPI with parallel request mode enabled.",
        measurementType: "BOOLEAN",
        weightage: 100,
        allocationType: "INDIVIDUAL",
        startingUnitId: base.unit.id,
        evidenceRequired: true,
        allowMultipleAchievementsPerAllocation: true,
      },
      base.actor.id,
      "TENANT_OWNER",
    );

    expect(result.status).toBe("success");

    const kpi = await prisma.kpiDefinition.findFirst({
      where: { kraDefinitionId: base.kra.id, title: kpiTitle },
      select: {
        allowMultipleAchievementsPerAllocation: true,
        measurementType: true,
      },
    });

    expect(kpi).toMatchObject({
      allowMultipleAchievementsPerAllocation: true,
      measurementType: "BOOLEAN",
    });
  });

  test("staged KPIs can keep parallel requests open while earlier requests are already submitted", async () => {
    const base = await createBaseFixture();

    const payload: KpiBuilderPayload = {
      definition: {
        kraDefinitionId: base.kra.id,
        title: "Staged Publication Workflow",
        description: "Allows multiple staged requests in parallel.",
        measurementType: "NUMERIC",
        unitLabel: "papers",
        weightage: 100,
        defaultTarget: 2,
        measurementConfig: { type: "NUMERIC", decimalPlaces: 0 },
        scoringMethod: "LINEAR",
        scoringDirection: "ASCENDING",
        scoringConfig: null,
        isPerCapita: false,
        allocationType: "INDIVIDUAL",
        startingUnitId: base.unit.id,
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
          ],
        },
        guidanceNotes: null,
        sortOrder: 0,
        keyUnitId: null,
        finalUnitId: null,
        sopDescription: null,
        evidenceRequired: true,
        evidenceTypes: ["DOCUMENT"],
        evidenceInstructions: "Attach the manuscript.",
        isTeamKpi: false,
        teamCreditMethod: "FULL_EACH",
        allowPartialCompletion: true,
        allowMultipleAchievementsPerAllocation: true,
        participantMode: "SINGLE_OWNER",
        rewardRecurrencePolicy: "RECURRING",
        policyDateFieldKey: null,
        contributionRoles: null,
      },
      applicableRoles: [],
      contributorConfig: {
        externalContribTemplateId: null,
        allowExternalContributors: false,
        duplicateCheckFields: [],
        creditSumMode: "MUST_EQUAL_100",
      },
      stages: [
        {
          title: "Department Review",
          description: "Department screens the submission.",
          stageOrder: 1,
          weight: 100,
          isMandatory: true,
          evidenceRequired: false,
          evidenceTypes: [],
          evidenceInstructions: null,
          deadline: null,
        },
      ],
      rewardTiers: [],
      rewardComponents: [],
    };

    const result = await saveKpiBuilder(
      base.tenant.id,
      payload,
      base.actor.id,
      "TENANT_OWNER",
    );

    expect(result.status).toBe("success");
    expect(result.id).toBeTruthy();

    const kpi = await prisma.kpiDefinition.findUnique({
      where: { id: result.id! },
      select: { id: true },
    });
    expect(kpi).toBeTruthy();

    await prisma.kpiDefinition.update({
      where: { id: result.id! },
      data: { state: "ACTIVE" },
    });
    await prisma.assessmentPeriod.update({
      where: { id: base.period.id },
      data: { state: "IN_PROGRESS" },
    });

    const allocation = await prisma.targetAllocation.create({
      data: {
        tenantId: base.tenant.id,
        periodId: base.period.id,
        kpiDefinitionId: result.id!,
        assignedToUserId: base.faculty.id,
        allocatedByUserId: base.actor.id,
        targetValue: 2,
        state: "ACTIVE",
      },
    });

    const first = await recordAchievement(
      base.tenant.id,
      {
        periodId: base.period.id,
        kpiDefinitionId: result.id!,
        targetAllocationId: allocation.id,
        actualValue: 7,
        reportingDate: new Date("2026-06-01T00:00:00.000Z"),
        evidenceDescription: "Initial staged request evidence",
        achievementFormData: {
          paperTitle: "Staged Request One",
        },
      },
      base.faculty.id,
      "TENANT_USER",
    );
    expect(first.status).toBe("success");
    expect(first.id).toBeTruthy();

    const progress = await prisma.kpiStageProgress.findFirst({
      where: { achievementId: first.id! },
      select: { id: true },
    });
    expect(progress).toBeTruthy();

    const completeResult = await markStageComplete(
      progress!.id,
      base.tenant.id,
      { notes: "Department review completed." },
      base.faculty.id,
      "TENANT_USER",
    );
    expect(completeResult.ok).toBe(true);

    const submitResult = await submitForVerification(
      first.id!,
      base.tenant.id,
      base.faculty.id,
      "TENANT_USER",
    );
    expect(submitResult.status).toBe("success");

    const second = await recordAchievement(
      base.tenant.id,
      {
        periodId: base.period.id,
        kpiDefinitionId: result.id!,
        targetAllocationId: allocation.id,
        actualValue: 9,
        reportingDate: new Date("2026-06-15T00:00:00.000Z"),
        evidenceDescription: "Follow-up staged request evidence",
        achievementFormData: {
          paperTitle: "Staged Request Two",
        },
      },
      base.faculty.id,
      "TENANT_USER",
    );
    expect(second.status).toBe("success");

    const achievements = await prisma.achievement.findMany({
      where: { targetAllocationId: allocation.id },
      orderBy: { reportingDate: "asc" },
      select: { state: true, title: true },
    });
    expect(achievements).toEqual([
      { state: "SUBMITTED", title: "Staged Request One" },
      { state: "DRAFT", title: "Staged Request Two" },
    ]);
  });
});
