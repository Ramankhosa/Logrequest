import { describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  recommendAchievement,
  submitForVerification,
  verifyAchievement,
} from "@/lib/kra-kpi/achievement-service";
import { updatePersonnelStatus } from "@/lib/personnel/service";
import {
  createScenarioAllocation,
  createWorkflowCoreFixture,
  loadQueueItem,
  recordScenarioAchievement,
  withKraKpiScenarioDb,
} from "../helpers/kra-kpi-db-scenarios";

describe("workflow ownership routing", () => {
  test("routes named reviewers instead of the generic unit head queue", async () => {
    await withKraKpiScenarioDb(async (tracker) => {
      const fixture = await createWorkflowCoreFixture(tracker, {
        extraCseHeadCount: 1,
        extraEceHeadCount: 1,
      });

      const keyReviewer = fixture.users.extraEceHeads[0]!;
      const finalReviewer = fixture.users.extraCseHeads[0]!;

      await prisma.kpiDefinition.update({
        where: { id: fixture.kpis.twoStep.id },
        data: {
          state: "ACTIVE",
          keyReviewerUserId: keyReviewer.id,
          finalReviewerUserId: finalReviewer.id,
        },
      });

      const allocation = await createScenarioAllocation({
        fixture,
        kpiId: fixture.kpis.twoStep.id,
        assignedToUserId: fixture.users.facultyCse.id,
        targetValue: 2,
      });
      const achievement = await recordScenarioAchievement({
        fixture,
        kpiId: fixture.kpis.twoStep.id,
        targetAllocationId: allocation.id,
        actorUserId: fixture.users.facultyCse.id,
      });

      const submitResult = await submitForVerification(
        achievement.id!,
        fixture.tenant.id,
        fixture.users.facultyCse.id,
        "TENANT_USER",
      );
      expect(submitResult).toMatchObject({ status: "success" });

      const afterSubmit = await prisma.achievement.findUniqueOrThrow({
        where: { id: achievement.id! },
        select: {
          currentVerifierUnitId: true,
          currentVerifierUserId: true,
        },
      });
      expect(afterSubmit.currentVerifierUnitId).toBe(fixture.structure.eceUnitId);
      expect(afterSubmit.currentVerifierUserId).toBe(keyReviewer.id);

      expect(
        await loadQueueItem({
          tenantId: fixture.tenant.id,
          userId: keyReviewer.id,
          periodId: fixture.period.id,
          achievementId: achievement.id!,
        }),
      ).not.toBeNull();
      expect(
        await loadQueueItem({
          tenantId: fixture.tenant.id,
          userId: fixture.users.eceHead.id,
          periodId: fixture.period.id,
          achievementId: achievement.id!,
        }),
      ).toBeNull();

      const blockedRecommend = await recommendAchievement(
        achievement.id!,
        fixture.tenant.id,
        true,
        "Not your queue",
        fixture.users.eceHead.id,
        "TENANT_USER",
      );
      expect(blockedRecommend.status).toBe("error");
      expect(blockedRecommend.message).toContain("assigned to another reviewer");

      const recommendResult = await recommendAchievement(
        achievement.id!,
        fixture.tenant.id,
        true,
        "Reviewed by named key reviewer",
        keyReviewer.id,
        "TENANT_USER",
      );
      expect(recommendResult).toMatchObject({ status: "success" });

      const afterRecommend = await prisma.achievement.findUniqueOrThrow({
        where: { id: achievement.id! },
        select: {
          state: true,
          currentVerifierUnitId: true,
          currentVerifierUserId: true,
        },
      });
      expect(afterRecommend.state).toBe("RECOMMENDED");
      expect(afterRecommend.currentVerifierUnitId).toBe(fixture.structure.cseUnitId);
      expect(afterRecommend.currentVerifierUserId).toBe(finalReviewer.id);

      const blockedVerify = await verifyAchievement(
        achievement.id!,
        fixture.tenant.id,
        true,
        "Not your queue",
        fixture.users.cseHead.id,
        "TENANT_USER",
      );
      expect(blockedVerify.status).toBe("error");
      expect(blockedVerify.message).toContain("assigned to another reviewer");

      const verifyResult = await verifyAchievement(
        achievement.id!,
        fixture.tenant.id,
        true,
        "Verified by named final reviewer",
        finalReviewer.id,
        "TENANT_USER",
      );
      expect(verifyResult).toMatchObject({ status: "success" });
    });
  });

  test("rebinds open workflow requests when the assigned reviewer becomes ineligible", async () => {
    await withKraKpiScenarioDb(async (tracker) => {
      const fixture = await createWorkflowCoreFixture(tracker, {
        extraEceHeadCount: 1,
      });

      const keyReviewer = fixture.users.extraEceHeads[0]!;
      await prisma.kpiDefinition.update({
        where: { id: fixture.kpis.keyOnly.id },
        data: {
          state: "ACTIVE",
          keyReviewerUserId: keyReviewer.id,
          finalReviewerUserId: null,
        },
      });

      const allocation = await createScenarioAllocation({
        fixture,
        kpiId: fixture.kpis.keyOnly.id,
        assignedToUserId: fixture.users.facultyCse.id,
        targetValue: 2,
      });
      const achievement = await recordScenarioAchievement({
        fixture,
        kpiId: fixture.kpis.keyOnly.id,
        targetAllocationId: allocation.id,
        actorUserId: fixture.users.facultyCse.id,
      });

      await submitForVerification(
        achievement.id!,
        fixture.tenant.id,
        fixture.users.facultyCse.id,
        "TENANT_USER",
      );

      const membership = await prisma.membership.findFirstOrThrow({
        where: {
          tenantId: fixture.tenant.id,
          userId: keyReviewer.id,
        },
        select: { id: true },
      });

      const statusResult = await updatePersonnelStatus({
        tenantId: fixture.tenant.id,
        actorUserId: fixture.actor.id,
        actorRole: "TENANT_OWNER",
        membershipId: membership.id,
        newStatus: "SUSPENDED_HR",
        reason: "No longer eligible to review",
      });
      expect(statusResult).toMatchObject({ status: "success" });

      const rebound = await prisma.achievement.findUniqueOrThrow({
        where: { id: achievement.id! },
        select: {
          currentVerifierUnitId: true,
          currentVerifierUserId: true,
        },
      });
      expect(rebound.currentVerifierUnitId).toBe(fixture.structure.eceUnitId);
      expect(rebound.currentVerifierUserId).toBe(fixture.users.eceHead.id);
    });
  });
});
