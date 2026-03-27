import type {
  GradeValue,
  KpiMeasurementType,
  MilestoneStatus,
} from "@prisma/client";
import { describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  recommendAchievement,
  recordAchievement,
  submitForVerification,
  verifyAchievement,
} from "@/lib/kra-kpi/achievement-service";
import { getKpiCrossComparison } from "@/lib/kra-kpi/dashboard-service";
import { createKpi } from "@/lib/kra-kpi/kpi-service";
import { getMyPendingCount, getMyReviewQueue } from "@/lib/kra-kpi/my-kpi-service";
import {
  listMyRewards,
  transitionContributorRewards,
} from "@/lib/kra-kpi/reward-ops-service";
import { createAllocation } from "@/lib/kra-kpi/target-service";
import {
  createPublicationRewardFixture,
  createScenarioAllocation,
  createWorkflowCoreFixture,
  loadQueueItem,
  loadTrailActions,
  recordScenarioAchievement,
  withKraKpiScenarioDb,
} from "../helpers/kra-kpi-db-scenarios";

type AllocationTargetInput = {
  targetValue?: number;
  targetDate?: Date;
  targetMilestone?: MilestoneStatus;
  targetGrade?: GradeValue;
  targetBoolean?: boolean;
  targetRating?: number;
};

type AchievementActualInput = {
  actualValue?: number;
  actualDate?: Date;
  actualMilestone?: MilestoneStatus;
  actualGrade?: GradeValue;
  actualBoolean?: boolean;
  actualRating?: number;
};

type MeasurementScenario = {
  measurementType: KpiMeasurementType;
  unitLabel: string | null;
  measurementConfig: Record<string, unknown>;
  allocation: AllocationTargetInput;
  achievement: AchievementActualInput;
  expectedTarget: string;
  expectedActual: string;
};

function uniqueCode(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

async function createMeasuredKpi(
  fixture: Awaited<ReturnType<typeof createWorkflowCoreFixture>>,
  scenario: MeasurementScenario,
) {
  const result = await createKpi(
    fixture.tenant.id,
    {
      kraDefinitionId: fixture.kra.id,
      title: uniqueCode(`R52_${scenario.measurementType}`),
      description: `${scenario.measurementType} dashboard coverage`,
      measurementType: scenario.measurementType,
      unitLabel: scenario.unitLabel ?? undefined,
      weightage: 0,
      ...(scenario.allocation.targetValue !== undefined
        ? { defaultTarget: scenario.allocation.targetValue }
        : {}),
      measurementConfig: scenario.measurementConfig as never,
      scoringMethod: "LINEAR",
      scoringDirection: "ASCENDING",
      scoringConfig: { method: "LINEAR", capAt100: true },
      allocationType: "INDIVIDUAL",
      startingUnitId: fixture.structure.cseUnitId,
      finalUnitId: fixture.structure.cseUnitId,
      allowPartialCompletion: true,
      sortOrder: 10,
    },
    fixture.actor.id,
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

async function createMeasuredAllocation(input: {
  fixture: Awaited<ReturnType<typeof createWorkflowCoreFixture>>;
  kpiId: string;
  assignedToUserId: string;
  target: AllocationTargetInput;
}) {
  const notes = uniqueCode(`ALLOC_${input.kpiId.slice(0, 6)}`);
  const result = await createAllocation(
    input.fixture.tenant.id,
    {
      periodId: input.fixture.period.id,
      kpiDefinitionId: input.kpiId,
      assignedToUserId: input.assignedToUserId,
      notes,
      ...input.target,
    },
    input.fixture.actor.id,
    "TENANT_OWNER",
  );

  expect(result.status).toBe("success");

  return prisma.targetAllocation.findFirstOrThrow({
    where: { tenantId: input.fixture.tenant.id, notes },
  });
}

describe("R5.2 dashboard database coverage", () => {
  test("review queue returns measurement-aware displays across KPI measurement types", async () => {
    await withKraKpiScenarioDb(async (tracker) => {
      const fixture = await createWorkflowCoreFixture(tracker, {
        periodStateAfterSetup: "OPEN",
      });

      const scenarios: MeasurementScenario[] = [
        {
          measurementType: "NUMERIC",
          unitLabel: "papers",
          measurementConfig: { type: "NUMERIC", decimalPlaces: 0 },
          allocation: { targetValue: 5 },
          achievement: { actualValue: 4 },
          expectedTarget: "5 papers",
          expectedActual: "4 papers",
        },
        {
          measurementType: "PERCENTAGE",
          unitLabel: null,
          measurementConfig: { type: "PERCENTAGE", decimalPlaces: 0, minValue: 0, maxValue: 100 },
          allocation: { targetValue: 80 },
          achievement: { actualValue: 82 },
          expectedTarget: "80%",
          expectedActual: "82%",
        },
        {
          measurementType: "CURRENCY",
          unitLabel: "INR",
          measurementConfig: { type: "CURRENCY", currencyCode: "INR", decimalPlaces: 0, minValue: 0 },
          allocation: { targetValue: 50000 },
          achievement: { actualValue: 45000 },
          expectedTarget: "INR 50,000",
          expectedActual: "INR 45,000",
        },
        {
          measurementType: "BOOLEAN",
          unitLabel: null,
          measurementConfig: { type: "BOOLEAN", trueLabel: "Yes", falseLabel: "No" },
          allocation: { targetBoolean: true },
          achievement: { actualBoolean: false },
          expectedTarget: "Yes",
          expectedActual: "No",
        },
        {
          measurementType: "RATING",
          unitLabel: null,
          measurementConfig: { type: "RATING", minRating: 1, maxRating: 5 },
          allocation: { targetRating: 4 },
          achievement: { actualRating: 5 },
          expectedTarget: "4",
          expectedActual: "5",
        },
        {
          measurementType: "MILESTONE",
          unitLabel: null,
          measurementConfig: { type: "MILESTONE" },
          allocation: { targetMilestone: "COMPLETED" },
          achievement: { actualMilestone: "IN_PROGRESS" },
          expectedTarget: "COMPLETED",
          expectedActual: "IN_PROGRESS",
        },
        {
          measurementType: "DATE_TARGET",
          unitLabel: null,
          measurementConfig: { type: "DATE_TARGET", allowEarly: true, gracePeriodDays: 0, latePenaltyEnabled: false, latePenaltyPercentPerDay: 0 },
          allocation: { targetDate: new Date("2026-09-15T00:00:00.000Z") },
          achievement: { actualDate: new Date("2026-09-10T00:00:00.000Z") },
          expectedTarget: "2026-09-15",
          expectedActual: "2026-09-10",
        },
        {
          measurementType: "GRADE",
          unitLabel: null,
          measurementConfig: { type: "GRADE" },
          allocation: { targetGrade: "VERY_GOOD" },
          achievement: { actualGrade: "OUTSTANDING" },
          expectedTarget: "VERY_GOOD",
          expectedActual: "OUTSTANDING",
        },
      ];

      const scenariosWithKpis = await Promise.all(
        scenarios.map(async (scenario) => ({
          scenario,
          kpiId: await createMeasuredKpi(fixture, scenario),
        })),
      );

      await prisma.assessmentPeriod.update({
        where: { id: fixture.period.id },
        data: { state: "IN_PROGRESS" },
      });

      for (const { scenario, kpiId } of scenariosWithKpis) {
        const allocation = await createMeasuredAllocation({
          fixture,
          kpiId,
          assignedToUserId: fixture.users.facultyCse.id,
          target: scenario.allocation,
        });

        const achievement = await recordAchievement(
          fixture.tenant.id,
          {
            periodId: fixture.period.id,
            kpiDefinitionId: kpiId,
            targetAllocationId: allocation.id,
            evidenceDescription: `${scenario.measurementType} evidence`,
            evidenceLinks: ["https://example.com/r52-proof.pdf"],
            achievementFormData: { description: `${scenario.measurementType} form payload` },
            ...scenario.achievement,
          },
          fixture.users.facultyCse.id,
          "TENANT_USER",
        );

        expect(achievement.status).toBe("success");
        expect(achievement.id).toBeTruthy();

        const submitResult = await submitForVerification(
          achievement.id!,
          fixture.tenant.id,
          fixture.users.facultyCse.id,
          "TENANT_USER",
          `${scenario.measurementType} submission`,
        );
        expect(submitResult.status).toBe("success");

        const queueItem = await loadQueueItem({
          tenantId: fixture.tenant.id,
          userId: fixture.users.cseHead.id,
          periodId: fixture.period.id,
          achievementId: achievement.id!,
        });

        expect(queueItem).toBeTruthy();
        expect(queueItem?.reviewUnitId).toBe(fixture.structure.cseUnitId);
        expect(queueItem?.reviewUnitName).toBe("Computer Science");
        expect(queueItem?.targetDisplay).toBe(scenario.expectedTarget);
        expect(queueItem?.actualDisplay).toBe(scenario.expectedActual);
      }
    });
  });

  test("descendant-scope reviewers inherit queue visibility and pending counts", async () => {
    await withKraKpiScenarioDb(async (tracker) => {
      const fixture = await createWorkflowCoreFixture(tracker);

      await prisma.orgRoleAssignment.updateMany({
        where: {
          versionId: fixture.structure.versionId,
          userId: fixture.users.schoolHead.id,
          unitId: fixture.structure.schoolUnitId,
        },
        data: { scope: "DESCENDANTS" },
      });

      const allocation = await createScenarioAllocation({
        fixture,
        kpiId: fixture.kpis.direct.id,
        assignedToUserId: fixture.users.facultyCse.id,
        targetValue: 10,
        notes: uniqueCode("R52_DESC_SCOPE"),
      });
      const achievement = await recordScenarioAchievement({
        fixture,
        kpiId: fixture.kpis.direct.id,
        targetAllocationId: allocation.id,
        actorUserId: fixture.users.facultyCse.id,
        actualValue: 8,
        reportingDate: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
      });
      expect(achievement.status).toBe("success");

      const submitResult = await submitForVerification(
        achievement.id!,
        fixture.tenant.id,
        fixture.users.facultyCse.id,
        "TENANT_USER",
        "Submit for descendant scope review",
      );
      expect(submitResult.status).toBe("success");

      const schoolQueue = await getMyReviewQueue(
        fixture.tenant.id,
        fixture.users.schoolHead.id,
        fixture.period.id,
      );
      const schoolQueueItem = schoolQueue.find((item) => item.achievementId === achievement.id);

      expect(schoolQueueItem).toBeTruthy();
      expect(schoolQueueItem?.reviewUnitId).toBe(fixture.structure.cseUnitId);
      expect(schoolQueueItem?.waitingDays).toBeGreaterThanOrEqual(15);
      expect(await getMyPendingCount(fixture.tenant.id, fixture.users.schoolHead.id, fixture.period.id)).toBeGreaterThan(0);
    });
  });

  test("send back and reject remain workflow-compatible but are audit-distinct", async () => {
    await withKraKpiScenarioDb(async (tracker) => {
      const fixture = await createWorkflowCoreFixture(tracker);

      const sendBackAllocation = await createScenarioAllocation({
        fixture,
        kpiId: fixture.kpis.twoStep.id,
        assignedToUserId: fixture.users.facultyCse.id,
        targetValue: 12,
        notes: uniqueCode("R52_SEND_BACK"),
      });
      const sendBackAchievement = await recordScenarioAchievement({
        fixture,
        kpiId: fixture.kpis.twoStep.id,
        targetAllocationId: sendBackAllocation.id,
        actorUserId: fixture.users.facultyCse.id,
        actualValue: 7,
      });
      expect(sendBackAchievement.status).toBe("success");

      await submitForVerification(
        sendBackAchievement.id!,
        fixture.tenant.id,
        fixture.users.facultyCse.id,
        "TENANT_USER",
        "Submit for send back",
      );
      const sendBackResult = await recommendAchievement(
        sendBackAchievement.id!,
        fixture.tenant.id,
        false,
        "Please correct the supporting details.",
        fixture.users.eceHead.id,
        "TENANT_USER",
        "SEND_BACK",
      );
      expect(sendBackResult.status).toBe("success");

      const sendBackAchievementRow = await prisma.achievement.findUniqueOrThrow({
        where: { id: sendBackAchievement.id! },
        select: { state: true, verificationLog: true },
      });
      expect(sendBackAchievementRow.state).toBe("REJECTED");
      expect((sendBackAchievementRow.verificationLog as Array<{ level: string }>).at(-1)?.level).toBe("SEND_BACK");

      const sendBackTrail = await loadTrailActions(sendBackAchievement.id!);
      expect(sendBackTrail.at(-1)?.action).toBe("SENT_BACK");

      const sendBackAudit = await prisma.auditLog.findFirstOrThrow({
        where: {
          tenantId: fixture.tenant.id,
          targetId: sendBackAchievement.id!,
          action: "SEND_BACK",
        },
        orderBy: { createdAt: "desc" },
      });
      expect((sendBackAudit.newState as { rejectionType?: string }).rejectionType).toBe("SEND_BACK");

      const rejectAllocation = await createScenarioAllocation({
        fixture,
        kpiId: fixture.kpis.direct.id,
        assignedToUserId: fixture.users.facultyCse.id,
        targetValue: 9,
        notes: uniqueCode("R52_REJECT"),
      });
      const rejectAchievement = await recordScenarioAchievement({
        fixture,
        kpiId: fixture.kpis.direct.id,
        targetAllocationId: rejectAllocation.id,
        actorUserId: fixture.users.facultyCse.id,
        actualValue: 3,
      });
      expect(rejectAchievement.status).toBe("success");

      await submitForVerification(
        rejectAchievement.id!,
        fixture.tenant.id,
        fixture.users.facultyCse.id,
        "TENANT_USER",
        "Submit for final reject",
      );
      const rejectResult = await verifyAchievement(
        rejectAchievement.id!,
        fixture.tenant.id,
        false,
        "Rejected after final review.",
        fixture.users.cseHead.id,
        "TENANT_USER",
        "REJECT",
      );
      expect(rejectResult.status).toBe("success");

      const rejectAchievementRow = await prisma.achievement.findUniqueOrThrow({
        where: { id: rejectAchievement.id! },
        select: { state: true, verificationLog: true },
      });
      expect(rejectAchievementRow.state).toBe("REJECTED");
      expect((rejectAchievementRow.verificationLog as Array<{ level: string }>).at(-1)?.level).toBe("REJECT");

      const rejectTrail = await loadTrailActions(rejectAchievement.id!);
      expect(rejectTrail.at(-1)?.action).toBe("REJECTED");

      const rejectAudit = await prisma.auditLog.findFirstOrThrow({
        where: {
          tenantId: fixture.tenant.id,
          targetId: rejectAchievement.id!,
          action: "REJECT",
        },
        orderBy: { createdAt: "desc" },
      });
      expect((rejectAudit.newState as { rejectionType?: string }).rejectionType).toBe("REJECT");
    });
  });

  test("my rewards stay grouped by state and unit and still include reporter-owned rewards", async () => {
    await withKraKpiScenarioDb(async (tracker) => {
      const fixture = await createPublicationRewardFixture(tracker);
      const achievement = await recordScenarioAchievement({
        fixture,
        kpiId: fixture.publication.kpi.id,
        targetAllocationId: fixture.publication.allocation.id,
        actorUserId: fixture.users.facultyCse.id,
        actualValue: 1,
        achievementFormData: {
          paperTitle: "R5.2 Reward Scenario",
          journalName: "Journal of Reward Integrity",
          indexing: ["Scopus"],
          journalTier: "Q1",
          publicationDate: new Date("2026-05-15T00:00:00.000Z").toISOString(),
          doi: "10.1000/r52-reward",
          pdfLink: "https://example.com/r52-reward.pdf",
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

      const releaseResult = await transitionContributorRewards(
        fixture.tenant.id,
        [rewards[0]!.id],
        "RELEASED",
        fixture.actor.id,
        "TENANT_OWNER",
        { note: "Release first reward", releaseReference: "R52-RELEASE-1" },
      );
      expect(releaseResult.updatedCount).toBe(1);

      const pendingResult = await transitionContributorRewards(
        fixture.tenant.id,
        [rewards[1]!.id],
        "PENDING",
        fixture.actor.id,
        "TENANT_OWNER",
        { note: "Move second reward pending" },
      );
      expect(pendingResult.updatedCount).toBe(1);

      const myRewards = await listMyRewards(fixture.tenant.id, fixture.users.facultyCse.id, {
        periodId: fixture.period.id,
        limit: 20,
      });

      expect(myRewards.rewards.some((reward) => reward.id === rewards[0]!.id)).toBe(true);
      expect(myRewards.totalsByState.RELEASED.length).toBeGreaterThan(0);
      expect(myRewards.totalsByState.PENDING.length).toBeGreaterThan(0);
      expect(new Set(myRewards.rewards.map((reward) => reward.benefitUnit)).size).toBeGreaterThan(1);
    });
  });

  test("cross comparison uses stored scores for non-numeric KPIs", async () => {
    await withKraKpiScenarioDb(async (tracker) => {
      const fixture = await createWorkflowCoreFixture(tracker, {
        periodStateAfterSetup: "OPEN",
      });
      const booleanScenario: MeasurementScenario = {
        measurementType: "BOOLEAN",
        unitLabel: null,
        measurementConfig: { type: "BOOLEAN", trueLabel: "Yes", falseLabel: "No" },
        allocation: { targetBoolean: true },
        achievement: { actualBoolean: true },
        expectedTarget: "Yes",
        expectedActual: "Yes",
      };

      const kpiResult = await createKpi(
        fixture.tenant.id,
        {
          kraDefinitionId: fixture.kra.id,
          title: uniqueCode("R52_CROSS_BOOLEAN"),
          description: "Boolean score cross comparison",
          measurementType: "BOOLEAN",
          weightage: 0,
          measurementConfig: booleanScenario.measurementConfig as never,
          scoringMethod: "LINEAR",
          scoringDirection: "ASCENDING",
          scoringConfig: { method: "LINEAR", capAt100: true },
          allocationType: "INDIVIDUAL",
          startingUnitId: fixture.structure.schoolUnitId,
          finalUnitId: fixture.structure.schoolUnitId,
          allowPartialCompletion: true,
          sortOrder: 22,
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );

      expect(kpiResult.status).toBe("success");
      expect(kpiResult.id).toBeTruthy();
      await prisma.kpiDefinition.update({
        where: { id: kpiResult.id! },
        data: { state: "ACTIVE" },
      });
      await prisma.assessmentPeriod.update({
        where: { id: fixture.period.id },
        data: { state: "IN_PROGRESS" },
      });

      const cseAllocation = await createMeasuredAllocation({
        fixture,
        kpiId: kpiResult.id!,
        assignedToUserId: fixture.users.facultyCse.id,
        target: { targetBoolean: true },
      });
      const eceAllocation = await createMeasuredAllocation({
        fixture,
        kpiId: kpiResult.id!,
        assignedToUserId: fixture.users.facultyEce.id,
        target: { targetBoolean: true },
      });

      const cseAchievement = await recordAchievement(
        fixture.tenant.id,
        {
          periodId: fixture.period.id,
          kpiDefinitionId: kpiResult.id!,
          targetAllocationId: cseAllocation.id,
          actualBoolean: true,
          evidenceDescription: "Boolean success",
          evidenceLinks: ["https://example.com/cse-bool.pdf"],
          achievementFormData: { description: "CSE boolean" },
        },
        fixture.users.facultyCse.id,
        "TENANT_USER",
      );
      const eceAchievement = await recordAchievement(
        fixture.tenant.id,
        {
          periodId: fixture.period.id,
          kpiDefinitionId: kpiResult.id!,
          targetAllocationId: eceAllocation.id,
          actualBoolean: false,
          evidenceDescription: "Boolean miss",
          evidenceLinks: ["https://example.com/ece-bool.pdf"],
          achievementFormData: { description: "ECE boolean" },
        },
        fixture.users.facultyEce.id,
        "TENANT_USER",
      );
      expect(cseAchievement.status).toBe("success");
      expect(eceAchievement.status).toBe("success");

      for (const [userId, achievementId] of [
        [fixture.users.facultyCse.id, cseAchievement.id!],
        [fixture.users.facultyEce.id, eceAchievement.id!],
      ] as const) {
        await submitForVerification(achievementId, fixture.tenant.id, userId, "TENANT_USER", "Cross comparison submit");
        await verifyAchievement(
          achievementId,
          fixture.tenant.id,
          true,
          "Cross comparison verify",
          fixture.users.schoolHead.id,
          "TENANT_USER",
        );
      }

      const comparison = await getKpiCrossComparison(
        fixture.tenant.id,
        fixture.period.id,
        kpiResult.id!,
        "ALL",
      );

      expect(comparison).toBeTruthy();
      expect(comparison?.totalAllocations).toBe(2);
      expect(comparison?.overallAverageScore).toBe(50);

      const cseUnit = comparison?.units.find((unit) => unit.unitName === "Computer Science");
      const eceUnit = comparison?.units.find((unit) => unit.unitName === "Electronics");
      expect(cseUnit?.allocationCount).toBe(1);
      expect(cseUnit?.scoredCount).toBe(1);
      expect(cseUnit?.averageScore).toBe(100);
      expect(eceUnit?.averageScore).toBe(0);
    });
  });
});
