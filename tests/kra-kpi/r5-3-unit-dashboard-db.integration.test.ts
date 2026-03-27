import type { KpiMeasurementType } from "@prisma/client";
import { describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  getPersonDetail,
  getUnitMembersSummary,
  getUnitSummary,
} from "@/lib/kra-kpi/dashboard-service";
import { createKpi } from "@/lib/kra-kpi/kpi-service";
import { listScopedPersonRewards } from "@/lib/kra-kpi/reward-ops-service";
import { createStage } from "@/lib/kra-kpi/stage-service";
import { markStageComplete } from "@/lib/kra-kpi/stage-progress-service";
import {
  submitForVerification,
  verifyAchievement,
} from "@/lib/kra-kpi/achievement-service";
import { resolveDashboardUnitSelection } from "@/lib/org-structure/scope-resolver";
import {
  createPublicationRewardFixture,
  createScenarioAllocation,
  createWorkflowCoreFixture,
  recordScenarioAchievement,
  withKraKpiScenarioDb,
} from "../helpers/kra-kpi-db-scenarios";

function uniqueCode(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

async function createMeasuredKpi(input: {
  fixture: Awaited<ReturnType<typeof createWorkflowCoreFixture>>;
  titlePrefix: string;
  measurementType: KpiMeasurementType;
  unitLabel: string | null;
  measurementConfig: Record<string, unknown>;
  startingUnitId: string;
  finalUnitId?: string;
}) {
  const result = await createKpi(
    input.fixture.tenant.id,
    {
      kraDefinitionId: input.fixture.kra.id,
      title: uniqueCode(input.titlePrefix),
      description: `${input.measurementType} unit dashboard test`,
      measurementType: input.measurementType,
      unitLabel: input.unitLabel ?? undefined,
      weightage: 0,
      measurementConfig: input.measurementConfig as never,
      scoringMethod: "LINEAR",
      scoringDirection: "ASCENDING",
      scoringConfig: { method: "LINEAR", capAt100: true },
      allocationType: "INDIVIDUAL",
      startingUnitId: input.startingUnitId,
      ...(input.finalUnitId ? { finalUnitId: input.finalUnitId } : {}),
      allowPartialCompletion: true,
      sortOrder: 25,
    },
    input.fixture.actor.id,
    "TENANT_OWNER",
  );

  expect(result.status).toBe("success");
  expect(result.id).toBeTruthy();

  await prisma.kpiDefinition.update({
    where: { id: result.id! },
    data: { state: "ACTIVE" },
  });

  return result.id!;
}

describe("R5.3 unit dashboard database coverage", () => {
  test("NODE heads see only their headed unit allocations and member summaries", async () => {
    await withKraKpiScenarioDb(async (tracker) => {
      const fixture = await createWorkflowCoreFixture(tracker);

      await createScenarioAllocation({
        fixture,
        kpiId: fixture.kpis.direct.id,
        assignedToUserId: fixture.users.facultyCse.id,
        targetValue: 10,
        notes: uniqueCode("R53_NODE_CSE"),
      });
      await createScenarioAllocation({
        fixture,
        kpiId: fixture.kpis.finalOnly.id,
        assignedToUserId: fixture.users.facultyEce.id,
        targetValue: 12,
        notes: uniqueCode("R53_NODE_ECE"),
      });

      const selection = await resolveDashboardUnitSelection(
        fixture.tenant.id,
        fixture.users.cseHead.id,
      );
      const summary = await getUnitSummary(
        fixture.tenant.id,
        fixture.period.id,
        selection.rootUnit.unitId,
        selection.scopeMode,
        selection.effectiveUnitIds,
      );
      const members = await getUnitMembersSummary(
        fixture.tenant.id,
        fixture.period.id,
        selection.effectiveUnitIds,
      );

      expect(selection.scopeMode).toBe("NODE");
      expect(selection.effectiveUnitIds).toEqual([fixture.structure.cseUnitId]);
      expect(summary).toBeTruthy();
      expect(summary?.unitId).toBe(fixture.structure.cseUnitId);
      expect(summary?.totalAllocations).toBe(1);
      expect(summary?.stageKpiOptions).toEqual([]);
      expect(members.some((member) => member.userId === fixture.users.facultyCse.id)).toBe(true);
      expect(members.some((member) => member.userId === fixture.users.facultyEce.id)).toBe(false);
    });
  });

  test("DESCENDANTS heads see subtree metrics and staged KPI options from child units", async () => {
    await withKraKpiScenarioDb(async (tracker) => {
      const fixture = await createWorkflowCoreFixture(tracker, {
        periodStateAfterSetup: "OPEN",
      });

      await prisma.orgRoleAssignment.updateMany({
        where: {
          versionId: fixture.structure.versionId,
          userId: fixture.users.schoolHead.id,
          unitId: fixture.structure.schoolUnitId,
        },
        data: { scope: "DESCENDANTS" },
      });

      const stagedKpiId = await createMeasuredKpi({
        fixture,
        titlePrefix: "R53_STAGE_DESC",
        measurementType: "NUMERIC",
        unitLabel: "units",
        measurementConfig: { type: "NUMERIC", decimalPlaces: 0 },
        startingUnitId: fixture.structure.eceUnitId,
        finalUnitId: fixture.structure.eceUnitId,
      });
      await createStage(
        stagedKpiId,
        fixture.tenant.id,
        { title: "Draft", weight: 50, deadline: new Date("2026-02-01T00:00:00.000Z") },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      await createStage(
        stagedKpiId,
        fixture.tenant.id,
        { title: "Publish", weight: 50, deadline: new Date("2026-02-20T00:00:00.000Z") },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      await prisma.assessmentPeriod.update({
        where: { id: fixture.period.id },
        data: { state: "IN_PROGRESS" },
      });

      await createScenarioAllocation({
        fixture,
        kpiId: fixture.kpis.direct.id,
        assignedToUserId: fixture.users.facultyCse.id,
        targetValue: 10,
        notes: uniqueCode("R53_DESC_CSE"),
      });
      await createScenarioAllocation({
        fixture,
        kpiId: stagedKpiId,
        assignedToUserId: fixture.users.facultyEce.id,
        targetValue: 15,
        notes: uniqueCode("R53_DESC_ECE"),
      });

      const selection = await resolveDashboardUnitSelection(
        fixture.tenant.id,
        fixture.users.schoolHead.id,
      );
      const summary = await getUnitSummary(
        fixture.tenant.id,
        fixture.period.id,
        selection.rootUnit.unitId,
        selection.scopeMode,
        selection.effectiveUnitIds,
      );
      const members = await getUnitMembersSummary(
        fixture.tenant.id,
        fixture.period.id,
        selection.effectiveUnitIds,
      );

      expect(selection.scopeMode).toBe("DESCENDANTS");
      expect(selection.effectiveUnitIds).toContain(fixture.structure.schoolUnitId);
      expect(selection.effectiveUnitIds).toContain(fixture.structure.cseUnitId);
      expect(selection.effectiveUnitIds).toContain(fixture.structure.eceUnitId);
      expect(summary?.totalAllocations).toBe(2);
      expect(summary?.stageKpiOptions.some((option) => option.kpiId === stagedKpiId)).toBe(true);
      expect(members.some((member) => member.userId === fixture.users.facultyCse.id)).toBe(true);
      expect(members.some((member) => member.userId === fixture.users.facultyEce.id)).toBe(true);
    });
  });

  test("multi-head users can switch units and get different summaries, member rows, and stage options", async () => {
    await withKraKpiScenarioDb(async (tracker) => {
      const fixture = await createWorkflowCoreFixture(tracker, {
        periodStateAfterSetup: "OPEN",
      });

      const roleDefinition = await prisma.orgRoleDefinition.findFirstOrThrow({
        where: {
          tenantId: fixture.tenant.id,
          roleKey: "DEPARTMENT_HEAD",
        },
        select: { id: true, displayLabel: true },
      });

      await prisma.orgRoleAssignment.create({
        data: {
          versionId: fixture.structure.versionId,
          unitId: fixture.structure.eceUnitId,
          userId: fixture.users.cseHead.id,
          roleDefinitionId: roleDefinition.id,
          roleName: roleDefinition.displayLabel,
          scope: "NODE",
        },
      });

      const stagedKpiId = await createMeasuredKpi({
        fixture,
        titlePrefix: "R53_MULTI_STAGE",
        measurementType: "NUMERIC",
        unitLabel: "units",
        measurementConfig: { type: "NUMERIC", decimalPlaces: 0 },
        startingUnitId: fixture.structure.eceUnitId,
        finalUnitId: fixture.structure.eceUnitId,
      });
      await createStage(
        stagedKpiId,
        fixture.tenant.id,
        { title: "Collect", weight: 100, deadline: new Date("2026-02-10T00:00:00.000Z") },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      await prisma.assessmentPeriod.update({
        where: { id: fixture.period.id },
        data: { state: "IN_PROGRESS" },
      });

      await createScenarioAllocation({
        fixture,
        kpiId: fixture.kpis.direct.id,
        assignedToUserId: fixture.users.facultyCse.id,
        targetValue: 8,
        notes: uniqueCode("R53_MULTI_CSE"),
      });
      await createScenarioAllocation({
        fixture,
        kpiId: stagedKpiId,
        assignedToUserId: fixture.users.facultyEce.id,
        targetValue: 9,
        notes: uniqueCode("R53_MULTI_ECE"),
      });

      const cseSelection = await resolveDashboardUnitSelection(
        fixture.tenant.id,
        fixture.users.cseHead.id,
        fixture.structure.cseUnitId,
      );
      const eceSelection = await resolveDashboardUnitSelection(
        fixture.tenant.id,
        fixture.users.cseHead.id,
        fixture.structure.eceUnitId,
      );

      const [cseSummary, eceSummary, cseMembers, eceMembers] = await Promise.all([
        getUnitSummary(
          fixture.tenant.id,
          fixture.period.id,
          cseSelection.rootUnit.unitId,
          cseSelection.scopeMode,
          cseSelection.effectiveUnitIds,
        ),
        getUnitSummary(
          fixture.tenant.id,
          fixture.period.id,
          eceSelection.rootUnit.unitId,
          eceSelection.scopeMode,
          eceSelection.effectiveUnitIds,
        ),
        getUnitMembersSummary(fixture.tenant.id, fixture.period.id, cseSelection.effectiveUnitIds),
        getUnitMembersSummary(fixture.tenant.id, fixture.period.id, eceSelection.effectiveUnitIds),
      ]);

      expect(cseSummary?.unitId).toBe(fixture.structure.cseUnitId);
      expect(cseSummary?.totalAllocations).toBe(1);
      expect(cseSummary?.stageKpiOptions).toHaveLength(0);
      expect(cseMembers.some((member) => member.userId === fixture.users.facultyCse.id)).toBe(true);
      expect(cseMembers.some((member) => member.userId === fixture.users.facultyEce.id)).toBe(false);

      expect(eceSummary?.unitId).toBe(fixture.structure.eceUnitId);
      expect(eceSummary?.totalAllocations).toBe(1);
      expect(eceSummary?.stageKpiOptions).toHaveLength(1);
      expect(eceSummary?.stageKpiOptions[0]?.kpiId).toBe(stagedKpiId);
      expect(eceMembers.some((member) => member.userId === fixture.users.facultyEce.id)).toBe(true);
      expect(eceMembers.some((member) => member.userId === fixture.users.facultyCse.id)).toBe(false);
    });
  });

  test("person detail stays measurement-aware and includes real stage rows", async () => {
    await withKraKpiScenarioDb(async (tracker) => {
      const fixture = await createWorkflowCoreFixture(tracker, {
        periodStateAfterSetup: "OPEN",
      });

      const currencyKpiId = await createMeasuredKpi({
        fixture,
        titlePrefix: "R53_CURRENCY_STAGE",
        measurementType: "CURRENCY",
        unitLabel: "INR",
        measurementConfig: { type: "CURRENCY", currencyCode: "INR", decimalPlaces: 0, minValue: 0 },
        startingUnitId: fixture.structure.cseUnitId,
        finalUnitId: fixture.structure.cseUnitId,
      });
      await createStage(
        currencyKpiId,
        fixture.tenant.id,
        { title: "Prepare", weight: 40, deadline: new Date("2026-01-31T00:00:00.000Z") },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      await createStage(
        currencyKpiId,
        fixture.tenant.id,
        { title: "Deliver", weight: 60, deadline: new Date("2026-02-28T00:00:00.000Z") },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      await prisma.assessmentPeriod.update({
        where: { id: fixture.period.id },
        data: { state: "IN_PROGRESS" },
      });

      const allocation = await createScenarioAllocation({
        fixture,
        kpiId: currencyKpiId,
        assignedToUserId: fixture.users.facultyCse.id,
        targetValue: 50000,
        notes: uniqueCode("R53_PERSON_TARGET"),
      });
      const achievement = await recordScenarioAchievement({
        fixture,
        kpiId: currencyKpiId,
        targetAllocationId: allocation.id,
        actorUserId: fixture.users.facultyCse.id,
        actualValue: 35000,
      });
      expect(achievement.status).toBe("success");

      const progressRows = await prisma.kpiStageProgress.findMany({
        where: { achievementId: achievement.id! },
        orderBy: { stageDefinition: { stageOrder: "asc" } },
      });
      expect(progressRows).toHaveLength(2);

      const markResult = await markStageComplete(
        progressRows[0]!.id,
        fixture.tenant.id,
        {},
        fixture.users.facultyCse.id,
        "TENANT_USER",
      );
      expect(markResult.ok).toBe(true);

      const selection = await resolveDashboardUnitSelection(
        fixture.tenant.id,
        fixture.users.cseHead.id,
      );
      const detail = await getPersonDetail(
        fixture.tenant.id,
        fixture.period.id,
        fixture.users.facultyCse.id,
        selection.effectiveUnitIds,
      );

      expect(detail).toBeTruthy();
      expect(detail?.primaryUnitId).toBe(fixture.structure.cseUnitId);
      expect(detail?.allocations).toHaveLength(1);
      expect(detail?.allocations[0]?.targetDisplay).toBe("INR 50,000");
      expect(detail?.allocations[0]?.latestAchievementId).toBe(achievement.id!);
      expect(detail?.allocations[0]?.stageRows).toHaveLength(2);
      expect(detail?.allocations[0]?.completionPercent).toBe(50);
      expect(detail?.allocations[0]?.stageRows.some((stage) => stage.isCompleted)).toBe(true);
      expect(detail?.allocations[0]?.stageRows.some((stage) => stage.isOverdue)).toBe(true);
    });
  });

  test("scoped person rewards include reporter-owned rows and empty payloads stay stable", async () => {
    await withKraKpiScenarioDb(async (tracker) => {
      const fixture = await createPublicationRewardFixture(tracker);

      const achievement = await recordScenarioAchievement({
        fixture,
        kpiId: fixture.publication.kpi.id,
        targetAllocationId: fixture.publication.allocation.id,
        actorUserId: fixture.users.facultyCse.id,
        actualValue: 1,
        achievementFormData: {
          paperTitle: "R5.3 Reward Scenario",
          journalName: "Adaptive Metrics Journal",
          indexing: ["Scopus"],
          journalTier: "Q1",
          publicationDate: new Date("2026-05-15T00:00:00.000Z").toISOString(),
          doi: "10.1000/r53-reward",
          pdfLink: "https://example.com/r53-reward.pdf",
        },
        contributors: [
          {
            type: "INTERNAL",
            userId: fixture.users.facultyCse.id,
            contributorRoleId: fixture.publication.roles.leadAuthor.id,
            selectorTags: ["FIRST_AUTHOR"],
          },
        ],
      });
      expect(achievement.status).toBe("success");

      await submitForVerification(
        achievement.id!,
        fixture.tenant.id,
        fixture.users.facultyCse.id,
        "TENANT_USER",
        "Reward generation submit",
      );
      await verifyAchievement(
        achievement.id!,
        fixture.tenant.id,
        true,
        "Reward generation verify",
        fixture.users.cseHead.id,
        "TENANT_USER",
      );

      const rewards = await prisma.contributorReward.findMany({
        where: { achievementId: achievement.id! },
        orderBy: { createdAt: "asc" },
      });
      expect(rewards.length).toBeGreaterThanOrEqual(2);

      await prisma.contributorReward.update({
        where: { id: rewards[0]!.id },
        data: { contributorUserId: null },
      });

      const scopedRewards = await listScopedPersonRewards(
        fixture.tenant.id,
        fixture.period.id,
        fixture.users.facultyCse.id,
        [fixture.structure.cseUnitId],
      );
      const emptyScopedRewards = await listScopedPersonRewards(
        fixture.tenant.id,
        fixture.period.id,
        fixture.users.facultyEce.id,
        [fixture.structure.cseUnitId],
      );
      const emptySummary = await getUnitSummary(
        fixture.tenant.id,
        fixture.period.id,
        fixture.structure.eceUnitId,
        "NODE",
        [fixture.structure.eceUnitId],
      );
      const emptyPersonDetail = await getPersonDetail(
        fixture.tenant.id,
        fixture.period.id,
        fixture.users.facultyEce.id,
        [fixture.structure.eceUnitId],
      );

      expect(scopedRewards.totalRows).toBeGreaterThan(0);
      expect(scopedRewards.rewards.some((reward) => reward.contributorUserId == null)).toBe(true);
      expect(scopedRewards.rewards.every((reward) => reward.reportedByUserId === fixture.users.facultyCse.id)).toBe(true);
      expect(emptyScopedRewards.totalRows).toBe(0);
      expect(emptyScopedRewards.rewards).toEqual([]);
      expect(emptySummary?.totalAllocations).toBe(0);
      expect(emptySummary?.stageKpiOptions).toEqual([]);
      expect(emptyPersonDetail?.allocations).toEqual([]);
    });
  });
});
