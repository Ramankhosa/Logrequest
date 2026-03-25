import { describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  recommendAchievement,
  resubmitAchievement,
  submitForVerification,
  verifyAchievement,
  withdrawAchievement,
} from "@/lib/kra-kpi/achievement-service";
import { getMyDashboardSummary, getMyPendingCount } from "@/lib/kra-kpi/my-kpi-service";
import { markAllRead } from "@/lib/notifications/notification-service";
import {
  createScenarioAllocation,
  createWorkflowCoreFixture,
  loadNotificationsForUser,
  loadQueueItem,
  loadTrailActions,
  recordScenarioAchievement,
  withKraKpiScenarioDb,
} from "../helpers/kra-kpi-db-scenarios";

describe("database-first workflow, queue, and notification scenarios", () => {
  test("keeps two-step workflow movement aligned across queues, dashboard counts, trail rows, and notifications", async () => {
    await withKraKpiScenarioDb(async (tracker) => {
      const fixture = await createWorkflowCoreFixture(tracker);
      const allocation = await createScenarioAllocation({
        fixture,
        kpiId: fixture.kpis.twoStep.id,
        assignedToUserId: fixture.users.facultyCse.id,
        targetValue: 2,
      });

      const draftResult = await recordScenarioAchievement({
        fixture,
        kpiId: fixture.kpis.twoStep.id,
        targetAllocationId: allocation.id,
        actorUserId: fixture.users.facultyCse.id,
      });
      expect(draftResult.status).toBe("success");

      const summaryAfterDraft = await getMyDashboardSummary(
        fixture.tenant.id,
        fixture.users.facultyCse.id,
        fixture.period.id,
      );
      expect(summaryAfterDraft?.statusCounts.inProgress).toBe(1);
      expect(summaryAfterDraft?.pendingReviewCount).toBe(0);

      const submitResult = await submitForVerification(
        draftResult.id!,
        fixture.tenant.id,
        fixture.users.facultyCse.id,
        "TENANT_USER",
        "Submitting from workflow notification DB test.",
      );
      expect(submitResult.status).toBe("success");
      expect(await getMyPendingCount(fixture.tenant.id, fixture.users.eceHead.id)).toBe(1);
      expect(await getMyPendingCount(fixture.tenant.id, fixture.users.cseHead.id)).toBe(0);
      expect(
        await loadQueueItem({
          tenantId: fixture.tenant.id,
          userId: fixture.users.eceHead.id,
          periodId: fixture.period.id,
          achievementId: draftResult.id!,
        }),
      ).toMatchObject({
        reviewLevel: "RECOMMEND",
        achievementState: "SUBMITTED",
      });

      const submitNotifications = await loadNotificationsForUser({
        tenantId: fixture.tenant.id,
        userId: fixture.users.eceHead.id,
        entityId: draftResult.id!,
      });
      expect(submitNotifications.map((row) => row.type)).toContain("ACHIEVEMENT_SUBMITTED");

      const summaryAfterSubmit = await getMyDashboardSummary(
        fixture.tenant.id,
        fixture.users.facultyCse.id,
        fixture.period.id,
      );
      expect(summaryAfterSubmit?.statusCounts.pendingReview).toBe(1);
      expect(summaryAfterSubmit?.pendingReviewCount).toBe(1);

      const recommendResult = await recommendAchievement(
        draftResult.id!,
        fixture.tenant.id,
        true,
        "Recommended at first review level.",
        fixture.users.eceHead.id,
        "TENANT_USER",
      );
      expect(recommendResult.status).toBe("success");
      expect(await getMyPendingCount(fixture.tenant.id, fixture.users.eceHead.id)).toBe(0);
      expect(await getMyPendingCount(fixture.tenant.id, fixture.users.cseHead.id)).toBe(1);
      expect(
        await loadQueueItem({
          tenantId: fixture.tenant.id,
          userId: fixture.users.cseHead.id,
          periodId: fixture.period.id,
          achievementId: draftResult.id!,
        }),
      ).toMatchObject({
        reviewLevel: "VERIFY",
        achievementState: "RECOMMENDED",
      });

      const recommendNotifications = await loadNotificationsForUser({
        tenantId: fixture.tenant.id,
        userId: fixture.users.cseHead.id,
        entityId: draftResult.id!,
      });
      expect(recommendNotifications.map((row) => row.type)).toContain(
        "ACHIEVEMENT_RECOMMENDED",
      );

      const verifyResult = await verifyAchievement(
        draftResult.id!,
        fixture.tenant.id,
        true,
        "Approved at final review level.",
        fixture.users.cseHead.id,
        "TENANT_USER",
      );
      expect(verifyResult.status).toBe("success");
      expect(await getMyPendingCount(fixture.tenant.id, fixture.users.eceHead.id)).toBe(0);
      expect(await getMyPendingCount(fixture.tenant.id, fixture.users.cseHead.id)).toBe(0);
      expect(
        await loadQueueItem({
          tenantId: fixture.tenant.id,
          userId: fixture.users.cseHead.id,
          periodId: fixture.period.id,
          achievementId: draftResult.id!,
        }),
      ).toBeNull();

      const summaryAfterVerify = await getMyDashboardSummary(
        fixture.tenant.id,
        fixture.users.facultyCse.id,
        fixture.period.id,
      );
      expect(summaryAfterVerify?.statusCounts.completed).toBe(1);
      expect(summaryAfterVerify?.pendingReviewCount).toBe(0);

      const approvalNotifications = await loadNotificationsForUser({
        tenantId: fixture.tenant.id,
        userId: fixture.users.facultyCse.id,
        entityId: draftResult.id!,
      });
      expect(approvalNotifications.map((row) => row.type)).toContain("ACHIEVEMENT_APPROVED");

      const trail = await loadTrailActions(draftResult.id!);
      expect(trail.map((row) => row.action)).toEqual([
        "SUBMITTED",
        "RECOMMENDED",
        "VERIFIED",
      ]);
    });
  });

  test("stale review notifications never override DB-derived queue truth for multi-head reviewers", async () => {
    await withKraKpiScenarioDb(async (tracker) => {
      const fixture = await createWorkflowCoreFixture(tracker, { extraEceHeadCount: 1 });
      const secondEceHead = fixture.users.extraEceHeads[0];
      expect(secondEceHead).toBeTruthy();

      const allocation = await createScenarioAllocation({
        fixture,
        kpiId: fixture.kpis.twoStep.id,
        assignedToUserId: fixture.users.facultyCse.id,
        targetValue: 1,
      });
      const draftResult = await recordScenarioAchievement({
        fixture,
        kpiId: fixture.kpis.twoStep.id,
        targetAllocationId: allocation.id,
        actorUserId: fixture.users.facultyCse.id,
      });
      expect(draftResult.status).toBe("success");

      const submitResult = await submitForVerification(
        draftResult.id!,
        fixture.tenant.id,
        fixture.users.facultyCse.id,
        "TENANT_USER",
        "Submitting for multi-head stale notification test.",
      );
      expect(submitResult.status).toBe("success");

      const notificationsPrimary = await loadNotificationsForUser({
        tenantId: fixture.tenant.id,
        userId: fixture.users.eceHead.id,
        entityId: draftResult.id!,
      });
      const notificationsSecondary = await loadNotificationsForUser({
        tenantId: fixture.tenant.id,
        userId: secondEceHead.id,
        entityId: draftResult.id!,
      });
      expect(notificationsPrimary.map((row) => row.type)).toContain("ACHIEVEMENT_SUBMITTED");
      expect(notificationsSecondary.map((row) => row.type)).toContain("ACHIEVEMENT_SUBMITTED");

      await markAllRead(fixture.tenant.id, secondEceHead.id);
      expect(await getMyPendingCount(fixture.tenant.id, secondEceHead.id)).toBe(1);
      expect(
        await loadQueueItem({
          tenantId: fixture.tenant.id,
          userId: secondEceHead.id,
          periodId: fixture.period.id,
          achievementId: draftResult.id!,
        }),
      ).not.toBeNull();

      const recommendResult = await recommendAchievement(
        draftResult.id!,
        fixture.tenant.id,
        true,
        "First head acted on the submission.",
        fixture.users.eceHead.id,
        "TENANT_USER",
      );
      expect(recommendResult.status).toBe("success");

      const staleRecommend = await recommendAchievement(
        draftResult.id!,
        fixture.tenant.id,
        true,
        "Second head tried from a stale notification.",
        secondEceHead.id,
        "TENANT_USER",
      );
      expect(staleRecommend.status).toBe("error");
      expect(staleRecommend.message).toContain("Cannot recommend");
      expect(await getMyPendingCount(fixture.tenant.id, fixture.users.eceHead.id)).toBe(0);
      expect(await getMyPendingCount(fixture.tenant.id, secondEceHead.id)).toBe(0);
      expect(await getMyPendingCount(fixture.tenant.id, fixture.users.cseHead.id)).toBe(1);
    });
  });

  test("reject, resubmit, and withdraw preserve remarks and valid DB state transitions", async () => {
    await withKraKpiScenarioDb(async (tracker) => {
      const fixture = await createWorkflowCoreFixture(tracker);
      const allocation = await createScenarioAllocation({
        fixture,
        kpiId: fixture.kpis.direct.id,
        assignedToUserId: fixture.users.facultyCse.id,
        targetValue: 1,
      });
      const draftResult = await recordScenarioAchievement({
        fixture,
        kpiId: fixture.kpis.direct.id,
        targetAllocationId: allocation.id,
        actorUserId: fixture.users.facultyCse.id,
      });
      expect(draftResult.status).toBe("success");

      const submitResult = await submitForVerification(
        draftResult.id!,
        fixture.tenant.id,
        fixture.users.facultyCse.id,
        "TENANT_USER",
        "First submission before rejection.",
      );
      expect(submitResult.status).toBe("success");

      const rejectResult = await verifyAchievement(
        draftResult.id!,
        fixture.tenant.id,
        false,
        "Need revised proof before approval.",
        fixture.users.cseHead.id,
        "TENANT_USER",
      );
      expect(rejectResult.status).toBe("success");

      const afterReject = await prisma.achievement.findUniqueOrThrow({
        where: { id: draftResult.id! },
        select: {
          state: true,
          rejectionReason: true,
          currentVerifierUnitId: true,
        },
      });
      expect(afterReject).toMatchObject({
        state: "REJECTED",
        rejectionReason: "Need revised proof before approval.",
        currentVerifierUnitId: null,
      });

      const rejectNotifications = await loadNotificationsForUser({
        tenantId: fixture.tenant.id,
        userId: fixture.users.facultyCse.id,
        entityId: draftResult.id!,
      });
      expect(rejectNotifications.map((row) => row.type)).toContain("ACHIEVEMENT_REJECTED");

      const invalidWithdraw = await withdrawAchievement(
        draftResult.id!,
        fixture.tenant.id,
        fixture.users.facultyCse.id,
      );
      expect(invalidWithdraw.status).toBe("error");
      expect(invalidWithdraw.message).toContain("Can only withdraw");

      const resubmitResult = await resubmitAchievement(
        draftResult.id!,
        fixture.tenant.id,
        fixture.users.facultyCse.id,
      );
      expect(resubmitResult.status).toBe("success");

      const afterResubmit = await prisma.achievement.findUniqueOrThrow({
        where: { id: draftResult.id! },
        select: {
          state: true,
          rejectionReason: true,
          currentVerifierUnitId: true,
          currentVerifierUserId: true,
        },
      });
      expect(afterResubmit).toMatchObject({
        state: "DRAFT",
        rejectionReason: null,
        currentVerifierUnitId: null,
        currentVerifierUserId: null,
      });

      const secondSubmit = await submitForVerification(
        draftResult.id!,
        fixture.tenant.id,
        fixture.users.facultyCse.id,
        "TENANT_USER",
        "Second submission after correction.",
      );
      expect(secondSubmit.status).toBe("success");

      const withdrawResult = await withdrawAchievement(
        draftResult.id!,
        fixture.tenant.id,
        fixture.users.facultyCse.id,
      );
      expect(withdrawResult.status).toBe("success");

      const afterWithdraw = await prisma.achievement.findUniqueOrThrow({
        where: { id: draftResult.id! },
        select: {
          state: true,
          currentVerifierUnitId: true,
          currentVerifierUserId: true,
        },
      });
      expect(afterWithdraw).toMatchObject({
        state: "DRAFT",
        currentVerifierUnitId: null,
        currentVerifierUserId: null,
      });

      const trail = await loadTrailActions(draftResult.id!);
      expect(trail.map((row) => row.action)).toEqual([
        "SUBMITTED",
        "REJECTED",
        "RESUBMITTED",
        "SUBMITTED",
        "WITHDRAWN",
      ]);

      const withdrawNotifications = await loadNotificationsForUser({
        tenantId: fixture.tenant.id,
        userId: fixture.users.cseHead.id,
        entityId: draftResult.id!,
      });
      expect(withdrawNotifications.map((row) => row.type)).toContain(
        "ACHIEVEMENT_WITHDRAWN",
      );
    });
  });
});
