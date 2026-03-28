import { afterEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { createKra } from "@/lib/kra-kpi/kra-service";
import { createPeriod } from "@/lib/kra-kpi/period-service";
import { listKpiTemplates, applyTemplateToKpi } from "@/lib/kra-kpi/kpi-template-service";
import {
  correctVerifiedAchievement,
  submitForVerification,
  verifyAchievement,
} from "@/lib/kra-kpi/achievement-service";
import { transitionContributorRewards } from "@/lib/kra-kpi/reward-ops-service";
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

async function createPublicationRewardFixture() {
  tracker ??= newDbTracker();
  const { tenant, actor } = await createTenantActor(tracker, "TENANT_OWNER");
  const reporter = await createTestUser(tracker, { firstName: "Raman", lastName: "Faculty" });
  const coAuthor = await createTestUser(tracker, { firstName: "Anita", lastName: "CoAuthor" });

  for (const user of [reporter, coAuthor]) {
    await createTestMembership({
      tenantId: tenant.id,
      userId: user.id,
      role: "TENANT_USER",
      createdByUserId: actor.id,
    });
  }

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

  for (const user of [actor, reporter, coAuthor]) {
    await prisma.userOrgAssignment.create({
      data: {
        versionId: version.id,
        userId: user.id,
        unitId: unit.id,
        isPrimary: true,
      },
    });
  }

  const periodCode = rand("PERIOD");
  await createPeriod(
    tenant.id,
    {
      name: "R4.3 Period",
      code: periodCode,
      periodType: "SPECIFIC_RANGE",
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      endDate: new Date("2026-12-31T00:00:00.000Z"),
      reviewFrequency: "ANNUAL",
    },
    actor.id,
    "TENANT_OWNER",
  );

  const period = await prisma.assessmentPeriod.findUniqueOrThrow({
    where: {
      tenantId_code: {
        tenantId: tenant.id,
        code: periodCode,
      },
    },
  });

  await createKra(
    tenant.id,
    {
      periodId: period.id,
      title: "Research KRA",
      weightage: 100,
    },
    actor.id,
    "TENANT_OWNER",
  );
  const kra = await prisma.kraDefinition.findFirstOrThrow({
    where: { tenantId: tenant.id, title: "Research KRA" },
  });

  const templates = await listKpiTemplates(tenant.id);
  const publicationTemplate = templates.find((row) => row.code === "SYSTEM_RESEARCH_PUBLICATION");
  expect(publicationTemplate).toBeTruthy();

  const applyResult = await applyTemplateToKpi(
    tenant.id,
    publicationTemplate!.id,
    {
      kraDefinitionId: kra.id,
      titleOverride: "Research Publication KPI",
      startingUnitId: unit.id,
    },
    actor.id,
    "TENANT_OWNER",
  );
  expect(applyResult.status).toBe("success");

  const kpi = await prisma.kpiDefinition.findUniqueOrThrow({
    where: { id: applyResult.id! },
  });
  await prisma.assessmentPeriod.update({
    where: { id: period.id },
    data: { state: "IN_PROGRESS" },
  });
  await prisma.kraDefinition.update({
    where: { id: kra.id },
    data: { state: "ACTIVE" },
  });
  await prisma.kpiDefinition.update({
    where: { id: kpi.id },
    data: { state: "ACTIVE" },
  });

  const roles = await prisma.contributorRole.findMany({
    where: {
      tenantId: tenant.id,
      code: { in: ["LEAD_AUTHOR", "CO_AUTHOR", "CORRESPONDING"] },
    },
  });
  const roleByCode = new Map(roles.map((role) => [role.code, role]));

  return {
    tenant,
    actor,
    reporter,
    coAuthor,
    period,
    kpi,
    roles: {
      leadAuthor: roleByCode.get("LEAD_AUTHOR")!,
      coAuthor: roleByCode.get("CO_AUTHOR")!,
      corresponding: roleByCode.get("CORRESPONDING")!,
    },
  };
}

async function createSubmittedPublicationAchievement(fixture: Awaited<ReturnType<typeof createPublicationRewardFixture>>, input?: {
  doi?: string;
  tier?: "Q1" | "Q2" | "Q3" | "Q4" | "UGC_CARE";
}) {
  return prisma.achievement.create({
    data: {
      tenantId: fixture.tenant.id,
      periodId: fixture.period.id,
      kpiDefinitionId: fixture.kpi.id,
      reportedByUserId: fixture.reporter.id,
      evidenceLinks: ["https://example.com/proof"],
      evidenceDescription: "Submitted proof",
      state: "SUBMITTED",
      achievementFormData: {
        paperTitle: "Verified publication",
        journalName: "Journal of Testing",
        indexing: ["Scopus"],
        journalTier: input?.tier ?? "Q1",
        publicationDate: new Date("2026-05-01T00:00:00.000Z").toISOString(),
        doi: input?.doi ?? `10.1000/${rand("paper").toLowerCase()}`,
        pdfLink: "https://example.com/paper.pdf",
      },
      contributors: {
        create: [
          {
            userId: fixture.reporter.id,
            contributorRoleId: fixture.roles.leadAuthor.id,
            creditPercent: 70,
            selectorTags: ["FIRST_AUTHOR"],
          },
          {
            userId: fixture.coAuthor.id,
            contributorRoleId: fixture.roles.coAuthor.id,
            creditPercent: 30,
          },
        ],
      },
    },
  });
}

describe("R4.3 workflow remarks and reward operations", () => {
  test("submit remarks are stored in SubmissionTrail", async () => {
    const fixture = await createPublicationRewardFixture();

    const achievement = await prisma.achievement.create({
      data: {
        tenantId: fixture.tenant.id,
        periodId: fixture.period.id,
        kpiDefinitionId: fixture.kpi.id,
        reportedByUserId: fixture.reporter.id,
        state: "DRAFT",
        evidenceLinks: ["https://example.com/proof"],
        achievementFormData: {
          paperTitle: "Submission remark paper",
          journalName: "Remark Journal",
          indexing: ["Scopus"],
          journalTier: "Q1",
          publicationDate: new Date("2026-04-15T00:00:00.000Z").toISOString(),
          doi: `10.1000/${rand("submit").toLowerCase()}`,
          pdfLink: "https://example.com/remark-paper.pdf",
        },
        contributors: {
          create: [
            {
              userId: fixture.reporter.id,
              contributorRoleId: fixture.roles.leadAuthor.id,
              creditPercent: 100,
              selectorTags: ["FIRST_AUTHOR"],
            },
          ],
        },
      },
    });

    const result = await submitForVerification(
      achievement.id,
      fixture.tenant.id,
      fixture.reporter.id,
      "TENANT_USER",
      "Please note that the indexing update was delayed by the journal.",
    );

    expect(result.status).toBe("success");

    const trail = await prisma.submissionTrail.findMany({
      where: { achievementId: achievement.id },
      orderBy: { createdAt: "asc" },
    });
    expect(trail.at(-1)?.action).toBe("SUBMITTED");
    expect(trail.at(-1)?.note).toContain("indexing update");
  });

  test("verified correction keeps achievement verified and revokes/replaces released rewards", async () => {
    const fixture = await createPublicationRewardFixture();
    const achievement = await createSubmittedPublicationAchievement(fixture, {
      doi: "10.1000/released-paper",
      tier: "Q1",
    });

    const verifyResult = await verifyAchievement(
      achievement.id,
      fixture.tenant.id,
      true,
      "Verified initially",
      fixture.actor.id,
      "TENANT_OWNER",
    );
    expect(verifyResult.status).toBe("success");

    const initialRewards = await prisma.contributorReward.findMany({
      where: { achievementId: achievement.id },
      orderBy: { id: "asc" },
    });
    expect(initialRewards.length).toBeGreaterThan(0);

    const pendingResult = await transitionContributorRewards(
      fixture.tenant.id,
      initialRewards.map((reward) => reward.id),
      "PENDING",
      fixture.actor.id,
      "TENANT_OWNER",
      { note: "Ready for payout release" },
    );
    expect(pendingResult.updatedCount).toBe(initialRewards.length);
    expect(pendingResult.failed).toHaveLength(0);

    const releaseResult = await transitionContributorRewards(
      fixture.tenant.id,
      initialRewards.map((reward) => reward.id),
      "RELEASED",
      fixture.actor.id,
      "TENANT_OWNER",
      { releaseReference: "PAY-001" },
    );
    expect(releaseResult.updatedCount).toBe(initialRewards.length);
    expect(releaseResult.failed).toHaveLength(0);

    const correctionResult = await correctVerifiedAchievement(
      achievement.id,
      fixture.tenant.id,
      {
        achievementFormData: {
          journalTier: "Q2",
          publicationDate: new Date("2026-05-01T00:00:00.000Z").toISOString(),
          doi: "10.1000/released-paper",
        },
        evidenceDescription: "Corrected after journal reclassification",
      },
      "Tier updated after publisher correction.",
      fixture.actor.id,
      "TENANT_OWNER",
    );

    expect(correctionResult.status).toBe("success");

    const updatedAchievement = await prisma.achievement.findUniqueOrThrow({
      where: { id: achievement.id },
      select: {
        state: true,
        evidenceDescription: true,
        submissionTrail: {
          orderBy: { createdAt: "asc" },
          select: { action: true, note: true, metadata: true },
        },
      },
    });
    expect(updatedAchievement.state).toBe("VERIFIED");
    expect(updatedAchievement.evidenceDescription).toContain("journal reclassification");
    expect(updatedAchievement.submissionTrail.some((entry) => entry.action === "CORRECTED")).toBe(true);
    expect(updatedAchievement.submissionTrail.some((entry) => entry.action === "REWARD_RECALCULATED")).toBe(true);

    const rewards = await prisma.contributorReward.findMany({
      where: { achievementId: achievement.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: {
        rewardComponent: { select: { code: true } },
      },
    });

    const revokedRewards = rewards.filter((reward) => reward.state === "REVOKED");
    const replacementRewards = rewards.filter((reward) => reward.state === "DRAFT");
    expect(revokedRewards).toHaveLength(initialRewards.length);
    expect(replacementRewards).toHaveLength(initialRewards.length);
    expect(replacementRewards.every((reward) => reward.supersedesRewardId != null)).toBe(true);
    expect(revokedRewards.every((reward) => reward.replacedByRewardId != null)).toBe(true);

    const q2Monetary = replacementRewards
      .filter((reward) => reward.rewardComponent.code === "Q2_MONETARY")
      .reduce((sum, reward) => sum + reward.finalAmount, 0);
    const q2Leave = replacementRewards
      .filter((reward) => reward.rewardComponent.code === "Q2_LEAVE_POINTS")
      .reduce((sum, reward) => sum + reward.finalAmount, 0);
    expect(q2Monetary).toBeCloseTo(30000, 5);
    expect(q2Leave).toBeCloseTo(8, 5);

    const correctionNotifications = await prisma.notification.findMany({
      where: {
        tenantId: fixture.tenant.id,
        userId: fixture.reporter.id,
        type: "ACHIEVEMENT_CORRECTED",
      },
    });
    expect(correctionNotifications).toHaveLength(1);
  });

  test("reward transitions create event history and require revoke remarks", async () => {
    const fixture = await createPublicationRewardFixture();
    const achievement = await createSubmittedPublicationAchievement(fixture, {
      doi: "10.1000/transition-paper",
    });

    await verifyAchievement(
      achievement.id,
      fixture.tenant.id,
      true,
      "Verified for reward ops",
      fixture.actor.id,
      "TENANT_OWNER",
    );

    const rewards = await prisma.contributorReward.findMany({
      where: { achievementId: achievement.id },
      orderBy: { id: "asc" },
    });
    expect(rewards.length).toBeGreaterThan(0);

    const pendingResult = await transitionContributorRewards(
      fixture.tenant.id,
      [rewards[0]!.id],
      "PENDING",
      fixture.actor.id,
      "TENANT_OWNER",
      { note: "Ready for finance release" },
    );
    expect(pendingResult.updatedCount).toBe(1);
    expect(pendingResult.failed).toHaveLength(0);

    const releaseResult = await transitionContributorRewards(
      fixture.tenant.id,
      [rewards[0]!.id],
      "RELEASED",
      fixture.actor.id,
      "TENANT_OWNER",
      { releaseReference: "PAY-002" },
    );
    expect(releaseResult.updatedCount).toBe(1);
    expect(releaseResult.failed).toHaveLength(0);

    const revokeWithoutReason = await transitionContributorRewards(
      fixture.tenant.id,
      [rewards[0]!.id],
      "REVOKED",
      fixture.actor.id,
      "TENANT_OWNER",
      {},
    );
    expect(revokeWithoutReason.updatedCount).toBe(0);
    expect(revokeWithoutReason.failed[0]?.message).toContain("Revocation requires");

    const revokeResult = await transitionContributorRewards(
      fixture.tenant.id,
      [rewards[0]!.id],
      "REVOKED",
      fixture.actor.id,
      "TENANT_OWNER",
      { note: "Manual correction required" },
    );
    expect(revokeResult.updatedCount).toBe(1);
    expect(revokeResult.failed).toHaveLength(0);

    const reward = await prisma.contributorReward.findUniqueOrThrow({
      where: { id: rewards[0]!.id },
      include: {
        events: {
          orderBy: { createdAt: "asc" },
        },
      },
    });
    expect(reward.state).toBe("REVOKED");
    expect(reward.revocationReason).toContain("Manual correction");
    expect(reward.events.map((event) => event.action)).toEqual(
      expect.arrayContaining(["CALCULATED", "STATUS_UPDATED", "RELEASED", "REVOKED"]),
    );
  });
});
