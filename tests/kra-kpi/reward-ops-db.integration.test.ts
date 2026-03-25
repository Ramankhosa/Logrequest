import { describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  correctVerifiedAchievement,
  submitForVerification,
  verifyAchievement,
} from "@/lib/kra-kpi/achievement-service";
import { listContributorRewards, transitionContributorRewards } from "@/lib/kra-kpi/reward-ops-service";
import {
  createPublicationRewardFixture,
  createScenarioAllocation,
  loadActiveRewards,
  moveUserPrimaryUnit,
  recordScenarioAchievement,
  withKraKpiScenarioDb,
} from "../helpers/kra-kpi-db-scenarios";

async function recordPublicationAchievement(input: {
  fixture: Awaited<ReturnType<typeof createPublicationRewardFixture>>;
  allocationId: string;
  reporterUserId: string;
  doi: string;
  tier: "Q1" | "Q2" | "Q3" | "Q4" | "UGC_CARE";
  contributors: Array<Record<string, unknown>>;
}) {
  return recordScenarioAchievement({
    fixture: input.fixture,
    kpiId: input.fixture.publication.kpi.id,
    targetAllocationId: input.allocationId,
    actorUserId: input.reporterUserId,
    actualValue: 1,
    achievementFormData: {
      paperTitle: `Paper ${input.doi}`,
      journalName: "Journal of Database Scenarios",
      indexing: input.tier === "UGC_CARE" ? ["UGC CARE List"] : ["Scopus"],
      journalTier: input.tier,
      publicationDate: new Date("2026-05-01T00:00:00.000Z").toISOString(),
      doi: input.doi,
      pdfLink: "https://example.com/publication.pdf",
      ...(input.tier === "UGC_CARE" ? { ugcCareReference: "UGC-REF-001" } : {}),
    },
    contributors: input.contributors,
  });
}

describe("database-first reward and correction scenarios", () => {
  test("verification generates expected split rewards and unique-key recurrence blocks duplicate payout rows", async () => {
    await withKraKpiScenarioDb(async (tracker) => {
      const fixture = await createPublicationRewardFixture(tracker);
      const secondAllocation = await createScenarioAllocation({
        fixture,
        kpiId: fixture.publication.kpi.id,
        assignedToUserId: fixture.users.facultyEce.id,
        targetValue: 1,
      });

      const first = await recordPublicationAchievement({
        fixture,
        allocationId: fixture.publication.allocation.id,
        reporterUserId: fixture.users.facultyCse.id,
        doi: "10.1000/db-first-q1",
        tier: "Q1",
        contributors: [
          {
            type: "INTERNAL",
            userId: fixture.users.facultyCse.id,
            contributorRoleId: fixture.publication.roles.leadAuthor.id,
            selectorTags: ["FIRST_AUTHOR"],
          },
          {
            type: "INTERNAL",
            userId: fixture.users.facultyEce.id,
            contributorRoleId: fixture.publication.roles.coAuthor.id,
          },
        ],
      });
      expect(first.status).toBe("success");

      expect(
        await submitForVerification(
          first.id!,
          fixture.tenant.id,
          fixture.users.facultyCse.id,
          "TENANT_USER",
          "Submitting the first publication for reward generation.",
        ),
      ).toMatchObject({ status: "success" });
      expect(
        await verifyAchievement(
          first.id!,
          fixture.tenant.id,
          true,
          "Verified for Q1 reward generation.",
          fixture.actor.id,
          "TENANT_OWNER",
        ),
      ).toMatchObject({ status: "success" });

      const firstRewards = await loadActiveRewards(first.id!);
      expect(firstRewards).toHaveLength(4);
      expect(
        firstRewards.find(
          (row) =>
            row.benefitType.code === "MONETARY"
            && row.contributorUserId === fixture.users.facultyCse.id,
        )?.finalAmount,
      ).toBe(24500);
      expect(
        firstRewards.find(
          (row) =>
            row.benefitType.code === "MONETARY"
            && row.contributorUserId === fixture.users.facultyEce.id,
        )?.finalAmount,
      ).toBe(10500);
      expect(
        firstRewards.find(
          (row) =>
            row.benefitType.code === "LEAVE_POINTS"
            && row.contributorUserId === fixture.users.facultyCse.id,
        )?.finalAmount,
      ).toBe(7);
      expect(
        firstRewards.find(
          (row) =>
            row.benefitType.code === "LEAVE_POINTS"
            && row.contributorUserId === fixture.users.facultyEce.id,
        )?.finalAmount,
      ).toBe(3);

      const second = await recordPublicationAchievement({
        fixture,
        allocationId: secondAllocation.id,
        reporterUserId: fixture.users.facultyEce.id,
        doi: "10.1000/db-first-q1",
        tier: "Q1",
        contributors: [
          {
            type: "INTERNAL",
            userId: fixture.users.facultyEce.id,
            contributorRoleId: fixture.publication.roles.leadAuthor.id,
            selectorTags: ["FIRST_AUTHOR"],
          },
        ],
      });
      expect(second.status).toBe("success");
      expect(
        await submitForVerification(
          second.id!,
          fixture.tenant.id,
          fixture.users.facultyEce.id,
          "TENANT_USER",
          "Submitting a duplicate DOI publication.",
        ),
      ).toMatchObject({ status: "success" });
      expect(
        await verifyAchievement(
          second.id!,
          fixture.tenant.id,
          true,
          "Verified but recurrence should block payout duplication.",
          fixture.actor.id,
          "TENANT_OWNER",
        ),
      ).toMatchObject({ status: "success" });

      const duplicateRewards = await prisma.contributorReward.findMany({
        where: { achievementId: second.id! },
      });
      expect(duplicateRewards).toHaveLength(0);

      const recurrenceRows = await prisma.contributorReward.findMany({
        where: { recurrenceKey: "doi=10.1000/db-first-q1" },
      });
      expect(recurrenceRows).toHaveLength(4);
    });
  });

  test("unreleased contributor corrections revoke superseded draft rows and create fresh draft replacements", async () => {
    await withKraKpiScenarioDb(async (tracker) => {
      const fixture = await createPublicationRewardFixture(tracker);
      const created = await recordPublicationAchievement({
        fixture,
        allocationId: fixture.publication.allocation.id,
        reporterUserId: fixture.users.facultyCse.id,
        doi: "10.1000/db-unreleased-correction",
        tier: "Q1",
        contributors: [
          {
            type: "INTERNAL",
            userId: fixture.users.facultyCse.id,
            contributorRoleId: fixture.publication.roles.leadAuthor.id,
            selectorTags: ["FIRST_AUTHOR"],
          },
          {
            type: "INTERNAL",
            userId: fixture.users.facultyEce.id,
            contributorRoleId: fixture.publication.roles.coAuthor.id,
          },
        ],
      });
      expect(created.status).toBe("success");
      await submitForVerification(
        created.id!,
        fixture.tenant.id,
        fixture.users.facultyCse.id,
        "TENANT_USER",
      );
      await verifyAchievement(
        created.id!,
        fixture.tenant.id,
        true,
        "Initial Q1 verification before correction.",
        fixture.actor.id,
        "TENANT_OWNER",
      );

      const correctionResult = await correctVerifiedAchievement(
        created.id!,
        fixture.tenant.id,
        {
          achievementFormData: {
            journalTier: "Q1",
            doi: "10.1000/db-unreleased-correction",
            publicationDate: new Date("2026-05-01T00:00:00.000Z").toISOString(),
          },
          contributors: [
            {
              type: "INTERNAL",
              userId: fixture.users.facultyCse.id,
              contributorRoleId: fixture.publication.roles.leadAuthor.id,
            },
            {
              type: "INTERNAL",
              userId: fixture.users.facultyEce.id,
              contributorRoleId: fixture.publication.roles.coAuthor.id,
              selectorTags: ["FIRST_AUTHOR"],
            },
          ],
          evidenceDescription: "Updated first-author attribution before disbursement.",
        },
        "Correcting unreleased rewards before any disbursement.",
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(correctionResult.status).toBe("success");

      const allRewards = await prisma.contributorReward.findMany({
        where: { achievementId: created.id! },
        include: { rewardTier: { select: { code: true } }, events: true },
      });
      expect(allRewards.filter((row) => row.state === "REVOKED")).toHaveLength(4);
      expect(allRewards.filter((row) => row.state === "DRAFT")).toHaveLength(4);
      expect(allRewards).toHaveLength(8);
      expect(allRewards.every((row) => row.rewardTier?.code === "Q1")).toBe(true);
      expect(
        allRewards
          .filter((row) => row.state === "REVOKED")
          .every((row) => row.events.some((event) => event.action === "REVOKED")),
      ).toBe(true);
      expect(
        allRewards
          .filter((row) => row.state === "DRAFT")
          .every((row) => row.events.some((event) => event.action === "CALCULATED")),
      ).toBe(true);

      const totalsByUser = new Map<string, number>();
      for (const reward of allRewards.filter((row) => row.state === "DRAFT")) {
        if (!reward.contributorUserId) continue;
        totalsByUser.set(
          reward.contributorUserId,
          (totalsByUser.get(reward.contributorUserId) ?? 0) + reward.finalAmount,
        );
      }
      expect(
        (totalsByUser.get(fixture.users.facultyEce.id) ?? 0)
          > (totalsByUser.get(fixture.users.facultyCse.id) ?? 0),
      ).toBe(true);
    });
  });

  test("released corrections revoke old rewards, create replacements, and preserve replacement linkage", async () => {
    await withKraKpiScenarioDb(async (tracker) => {
      const fixture = await createPublicationRewardFixture(tracker);
      const created = await recordPublicationAchievement({
        fixture,
        allocationId: fixture.publication.allocation.id,
        reporterUserId: fixture.users.facultyCse.id,
        doi: "10.1000/db-released-correction",
        tier: "Q1",
        contributors: [
          {
            type: "INTERNAL",
            userId: fixture.users.facultyCse.id,
            contributorRoleId: fixture.publication.roles.leadAuthor.id,
            selectorTags: ["FIRST_AUTHOR"],
          },
          {
            type: "INTERNAL",
            userId: fixture.users.facultyEce.id,
            contributorRoleId: fixture.publication.roles.coAuthor.id,
          },
        ],
      });
      expect(created.status).toBe("success");
      await submitForVerification(created.id!, fixture.tenant.id, fixture.users.facultyCse.id, "TENANT_USER");
      await verifyAchievement(
        created.id!,
        fixture.tenant.id,
        true,
        "Verified before release.",
        fixture.actor.id,
        "TENANT_OWNER",
      );

      const draftRewards = await loadActiveRewards(created.id!);
      const releaseResult = await transitionContributorRewards(
        fixture.tenant.id,
        draftRewards.map((row) => row.id),
        "RELEASED",
        fixture.actor.id,
        "TENANT_OWNER",
        { note: "Released in batch DB-001.", releaseReference: "DB-001" },
      );
      expect(releaseResult.updatedCount).toBe(draftRewards.length);
      expect(releaseResult.failed).toHaveLength(0);

      const correctionResult = await correctVerifiedAchievement(
        created.id!,
        fixture.tenant.id,
        {
          achievementFormData: {
            journalTier: "Q2",
            doi: "10.1000/db-released-correction",
            publicationDate: new Date("2026-05-01T00:00:00.000Z").toISOString(),
          },
          evidenceDescription: "Corrected after reclassification from Q1 to Q2.",
        },
        "Correcting after released incentives must be revoked and replaced.",
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(correctionResult.status).toBe("success");

      const rewards = await prisma.contributorReward.findMany({
        where: { achievementId: created.id! },
        include: {
          rewardTier: { select: { code: true } },
          events: { orderBy: { createdAt: "asc" } },
        },
      });
      const revoked = rewards.filter((row) => row.state === "REVOKED");
      const replacementDrafts = rewards.filter(
        (row) => row.state === "DRAFT" && row.supersedesRewardId != null,
      );

      expect(revoked).toHaveLength(4);
      expect(replacementDrafts).toHaveLength(4);
      expect(revoked.every((row) => row.rewardTier?.code === "Q1")).toBe(true);
      expect(replacementDrafts.every((row) => row.rewardTier?.code === "Q2")).toBe(true);
      expect(revoked.every((row) => row.replacedByRewardId != null)).toBe(true);
      expect(replacementDrafts.every((row) => row.events.some((event) => event.action === "CALCULATED"))).toBe(true);

      const rewardConsole = await listContributorRewards(fixture.tenant.id, {
        achievementId: created.id!,
        limit: 20,
      });
      expect(rewardConsole.totalRows).toBe(8);
      expect(rewardConsole.rewards.map((row) => row.state)).toEqual(
        expect.arrayContaining(["DRAFT", "REVOKED"]),
      );
    });
  });

  test("reward transitions require reasons, only one concurrent release wins, and snapshot filters stay stable after unit transfer", async () => {
    await withKraKpiScenarioDb(async (tracker) => {
      const fixture = await createPublicationRewardFixture(tracker);
      const created = await recordPublicationAchievement({
        fixture,
        allocationId: fixture.publication.allocation.id,
        reporterUserId: fixture.users.facultyCse.id,
        doi: "10.1000/db-single-author",
        tier: "Q1",
        contributors: [
          {
            type: "INTERNAL",
            userId: fixture.users.facultyCse.id,
            contributorRoleId: fixture.publication.roles.leadAuthor.id,
            selectorTags: ["FIRST_AUTHOR"],
          },
        ],
      });
      expect(created.status).toBe("success");
      await submitForVerification(created.id!, fixture.tenant.id, fixture.users.facultyCse.id, "TENANT_USER");
      await verifyAchievement(
        created.id!,
        fixture.tenant.id,
        true,
        "Verified before transition tests.",
        fixture.actor.id,
        "TENANT_OWNER",
      );

      const initialRewards = await loadActiveRewards(created.id!);
      expect(initialRewards).toHaveLength(2);
      expect(initialRewards.find((row) => row.benefitType.code === "MONETARY")?.finalAmount).toBe(
        35000,
      );
      expect(
        initialRewards.find((row) => row.benefitType.code === "LEAVE_POINTS")?.finalAmount,
      ).toBe(10);

      const revokeWithoutReason = await transitionContributorRewards(
        fixture.tenant.id,
        initialRewards.map((row) => row.id),
        "REVOKED",
        fixture.actor.id,
        "TENANT_OWNER",
      );
      expect(revokeWithoutReason.updatedCount).toBe(0);
      expect(revokeWithoutReason.failed).toHaveLength(initialRewards.length);
      expect(revokeWithoutReason.failed.every((row) => row.message.includes("requires a reason"))).toBe(
        true,
      );

      const targetRewardId = initialRewards[0]!.id;
      const concurrentRelease = await Promise.allSettled([
        transitionContributorRewards(
          fixture.tenant.id,
          [targetRewardId],
          "RELEASED",
          fixture.actor.id,
          "TENANT_OWNER",
          { note: "Primary release", releaseReference: "RACE-1" },
        ),
        transitionContributorRewards(
          fixture.tenant.id,
          [targetRewardId],
          "RELEASED",
          fixture.actor.id,
          "TENANT_OWNER",
          { note: "Concurrent release", releaseReference: "RACE-2" },
        ),
      ]);
      expect(concurrentRelease.filter((row) => row.status === "fulfilled")).toHaveLength(1);
      expect(concurrentRelease.filter((row) => row.status === "rejected")).toHaveLength(1);

      const releasedReward = await prisma.contributorReward.findUniqueOrThrow({
        where: { id: targetRewardId },
        include: { events: true },
      });
      expect(releasedReward.state).toBe("RELEASED");
      expect(releasedReward.events.filter((event) => event.action === "RELEASED")).toHaveLength(1);

      const consoleBeforeTransfer = await listContributorRewards(fixture.tenant.id, {
        kpiDefinitionId: fixture.publication.kpi.id,
        unitId: fixture.structure.cseUnitId,
        contributorUserId: fixture.users.facultyCse.id,
        limit: 20,
      });
      expect(consoleBeforeTransfer.rewards.length).toBeGreaterThan(0);

      await moveUserPrimaryUnit({
        versionId: fixture.structure.versionId,
        userId: fixture.users.facultyCse.id,
        toUnitId: fixture.structure.eceUnitId,
      });

      const consoleAfterTransfer = await listContributorRewards(fixture.tenant.id, {
        kpiDefinitionId: fixture.publication.kpi.id,
        unitId: fixture.structure.cseUnitId,
        contributorUserId: fixture.users.facultyCse.id,
        limit: 20,
      });
      const consoleWrongUnit = await listContributorRewards(fixture.tenant.id, {
        kpiDefinitionId: fixture.publication.kpi.id,
        unitId: fixture.structure.eceUnitId,
        contributorUserId: fixture.users.facultyCse.id,
        limit: 20,
      });

      expect(consoleAfterTransfer.rewards.length).toBe(consoleBeforeTransfer.rewards.length);
      expect(consoleWrongUnit.rewards).toHaveLength(0);
    });
  });
});
