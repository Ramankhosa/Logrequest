import { afterEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { cascadeTargets, createAllocation } from "@/lib/kra-kpi/target-service";
import { submitForVerification } from "@/lib/kra-kpi/achievement-service";
import { getMyAllocations, getMyPendingCount } from "@/lib/kra-kpi/my-kpi-service";
import {
  createScenarioAllocation,
  createWorkflowCoreFixture,
  loadQueueItem,
  recordScenarioAchievement,
  withKraKpiScenarioDb,
} from "../helpers/kra-kpi-db-scenarios";

describe("database-first allocation and routing scenarios", () => {
  test("routes direct, key-only, final-only, and two-step submissions to the correct live verifier queues", async () => {
    await withKraKpiScenarioDb(async (tracker) => {
      const fixture = await createWorkflowCoreFixture(tracker);

      const directAllocation = await createScenarioAllocation({
        fixture,
        kpiId: fixture.kpis.direct.id,
        assignedToUserId: fixture.users.facultyCse.id,
        targetValue: 2,
      });
      const keyOnlyAllocation = await createScenarioAllocation({
        fixture,
        kpiId: fixture.kpis.keyOnly.id,
        assignedToUserId: fixture.users.facultyCse.id,
        targetValue: 2,
      });
      const finalOnlyAllocation = await createScenarioAllocation({
        fixture,
        kpiId: fixture.kpis.finalOnly.id,
        assignedToUserId: fixture.users.facultyEce.id,
        targetValue: 2,
      });
      const twoStepAllocation = await createScenarioAllocation({
        fixture,
        kpiId: fixture.kpis.twoStep.id,
        assignedToUserId: fixture.users.facultyCse.id,
        targetValue: 2,
      });

      const directAchievement = await recordScenarioAchievement({
        fixture,
        kpiId: fixture.kpis.direct.id,
        targetAllocationId: directAllocation.id,
        actorUserId: fixture.users.facultyCse.id,
      });
      const keyOnlyAchievement = await recordScenarioAchievement({
        fixture,
        kpiId: fixture.kpis.keyOnly.id,
        targetAllocationId: keyOnlyAllocation.id,
        actorUserId: fixture.users.facultyCse.id,
      });
      const finalOnlyAchievement = await recordScenarioAchievement({
        fixture,
        kpiId: fixture.kpis.finalOnly.id,
        targetAllocationId: finalOnlyAllocation.id,
        actorUserId: fixture.users.facultyEce.id,
      });
      const twoStepAchievement = await recordScenarioAchievement({
        fixture,
        kpiId: fixture.kpis.twoStep.id,
        targetAllocationId: twoStepAllocation.id,
        actorUserId: fixture.users.facultyCse.id,
      });

      for (const [achievementId, actorUserId] of [
        [directAchievement.id!, fixture.users.facultyCse.id],
        [keyOnlyAchievement.id!, fixture.users.facultyCse.id],
        [finalOnlyAchievement.id!, fixture.users.facultyEce.id],
        [twoStepAchievement.id!, fixture.users.facultyCse.id],
      ] as const) {
        const submitResult = await submitForVerification(
          achievementId,
          fixture.tenant.id,
          actorUserId,
          "TENANT_USER",
          "Submitting from the DB matrix suite.",
        );
        expect(submitResult.status).toBe("success");
      }

      const stored = await prisma.achievement.findMany({
        where: {
          id: {
            in: [
              directAchievement.id!,
              keyOnlyAchievement.id!,
              finalOnlyAchievement.id!,
              twoStepAchievement.id!,
            ],
          },
        },
        select: {
          id: true,
          state: true,
          currentVerifierUnitId: true,
          currentVerifierUserId: true,
        },
      });
      const byId = new Map(stored.map((row) => [row.id, row]));

      expect(byId.get(directAchievement.id!)?.currentVerifierUnitId).toBe(
        fixture.structure.cseUnitId,
      );
      expect(byId.get(keyOnlyAchievement.id!)?.currentVerifierUnitId).toBe(
        fixture.structure.eceUnitId,
      );
      expect(byId.get(finalOnlyAchievement.id!)?.currentVerifierUnitId).toBe(
        fixture.structure.cseUnitId,
      );
      expect(byId.get(twoStepAchievement.id!)?.currentVerifierUnitId).toBe(
        fixture.structure.eceUnitId,
      );

      expect(
        await loadQueueItem({
          tenantId: fixture.tenant.id,
          userId: fixture.users.cseHead.id,
          periodId: fixture.period.id,
          achievementId: directAchievement.id!,
        }),
      ).toMatchObject({
        reviewLevel: "VERIFY",
        achievementState: "SUBMITTED",
      });
      expect(
        await loadQueueItem({
          tenantId: fixture.tenant.id,
          userId: fixture.users.eceHead.id,
          periodId: fixture.period.id,
          achievementId: keyOnlyAchievement.id!,
        }),
      ).toMatchObject({
        reviewLevel: "VERIFY",
        achievementState: "SUBMITTED",
      });
      expect(
        await loadQueueItem({
          tenantId: fixture.tenant.id,
          userId: fixture.users.cseHead.id,
          periodId: fixture.period.id,
          achievementId: finalOnlyAchievement.id!,
        }),
      ).toMatchObject({
        reviewLevel: "VERIFY",
        achievementState: "SUBMITTED",
      });
      expect(
        await loadQueueItem({
          tenantId: fixture.tenant.id,
          userId: fixture.users.eceHead.id,
          periodId: fixture.period.id,
          achievementId: twoStepAchievement.id!,
        }),
      ).toMatchObject({
        reviewLevel: "RECOMMEND",
        achievementState: "SUBMITTED",
      });

      expect(await getMyPendingCount(fixture.tenant.id, fixture.users.cseHead.id)).toBe(2);
      expect(await getMyPendingCount(fixture.tenant.id, fixture.users.eceHead.id)).toBe(2);
    });
  });

  test("enforces BOTH-allocation cascade totals and persists child allocations only on valid splits", async () => {
    await withKraKpiScenarioDb(async (tracker) => {
      const fixture = await createWorkflowCoreFixture(tracker);
      const parentAllocation = await createScenarioAllocation({
        fixture,
        kpiId: fixture.kpis.both.id,
        assignedToUnitId: fixture.structure.schoolUnitId,
        targetValue: 10,
      });

      const invalidCascade = await cascadeTargets(
        parentAllocation.id,
        fixture.tenant.id,
        {
          distributions: [
            { assignedToUnitId: fixture.structure.cseUnitId, targetValue: 6 },
            { assignedToUnitId: fixture.structure.eceUnitId, targetValue: 3 },
          ],
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(invalidCascade.status).toBe("error");
      expect(invalidCascade.message).toContain("Child target values must sum to parent");

      const validCascade = await cascadeTargets(
        parentAllocation.id,
        fixture.tenant.id,
        {
          distributions: [
            { assignedToUnitId: fixture.structure.cseUnitId, targetValue: 6 },
            { assignedToUnitId: fixture.structure.eceUnitId, targetValue: 4 },
          ],
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(validCascade.status).toBe("success");

      const childAllocations = await prisma.targetAllocation.findMany({
        where: { parentAllocationId: parentAllocation.id },
        orderBy: { targetValue: "desc" },
        select: {
          assignedToUnitId: true,
          targetValue: true,
        },
      });
      expect(childAllocations).toEqual([
        { assignedToUnitId: fixture.structure.cseUnitId, targetValue: 6 },
        { assignedToUnitId: fixture.structure.eceUnitId, targetValue: 4 },
      ]);
    });
  });

  test("blocks null-target allocation creation and rejects legacy null-target submissions or outsider access", async () => {
    await withKraKpiScenarioDb(async (tracker) => {
      const fixture = await createWorkflowCoreFixture(tracker);
      const allocationAttempt = await createAllocation(
        fixture.tenant.id,
        {
          periodId: fixture.period.id,
          kpiDefinitionId: fixture.kpis.direct.id,
          assignedToUserId: fixture.users.facultyCse.id,
        },
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(allocationAttempt.status).toBe("error");
      expect(allocationAttempt.message).toContain("Enter a target value before allocating.");

      const validAllocation = await createScenarioAllocation({
        fixture,
        kpiId: fixture.kpis.direct.id,
        assignedToUserId: fixture.users.facultyCse.id,
        targetValue: 4,
      });

      const outsiderBlocked = await recordScenarioAchievement({
        fixture,
        kpiId: fixture.kpis.direct.id,
        targetAllocationId: validAllocation.id,
        actorUserId: fixture.users.facultyEce.id,
      });
      expect(outsiderBlocked.status).toBe("error");
      expect(outsiderBlocked.message).toContain("not allowed");

      await prisma.targetAllocation.update({
        where: { id: validAllocation.id },
        data: {
          targetValue: null,
          targetDate: null,
          targetMilestone: null,
          targetGrade: null,
          targetBoolean: null,
          targetRating: null,
        },
      });

      const myAllocations = await getMyAllocations(
        fixture.tenant.id,
        fixture.users.facultyCse.id,
        fixture.period.id,
      );
      const visible = myAllocations.find((row) => row.id === validAllocation.id);
      expect(visible?.targetValue).toBeNull();

      const blockedForNullTarget = await recordScenarioAchievement({
        fixture,
        kpiId: fixture.kpis.direct.id,
        targetAllocationId: validAllocation.id,
        actorUserId: fixture.users.facultyCse.id,
      });
      expect(blockedForNullTarget.status).toBe("error");
      expect(blockedForNullTarget.message).toContain("Target not set yet");
    });
  });
});
