import { afterEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  recordAchievement,
  updateAchievement,
} from "@/lib/kra-kpi/achievement-service";
import { previewKpiRewards } from "@/lib/kra-kpi/reward-service";
import {
  cleanupTrackedData,
  newDbTracker,
  type DbTracker,
} from "../helpers/db";
import { createPublicationRewardFixture } from "../helpers/kra-kpi-db-scenarios";

let tracker: DbTracker | null = null;

afterEach(async () => {
  if (!tracker) {
    return;
  }

  const tenantIds = [...tracker.tenantIds];
  const userIds = [...tracker.userIds];

  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        {
          actorUserId: { in: userIds },
          targetType: { in: ["JournalCatalogRecord", "JournalImportBatch"] },
        },
        {
          tenantId: { in: tenantIds },
          targetType: { in: ["JournalCatalogRecord", "JournalImportBatch"] },
        },
      ],
    },
  });

  await prisma.journalCatalogRecord.deleteMany({
    where: {
      OR: [
        { createdByUserId: { in: userIds } },
        { tenantId: { in: tenantIds } },
      ],
    },
  });

  await cleanupTrackedData(tracker);
  tracker = null;
});

async function createJournalCatalogMatch(input: {
  actorUserId: string;
  sourceYear: number;
  issn: string;
  quartile: string;
  title?: string;
  policyStatus?: "ALLOWED" | "DISABLED" | "BLACKLISTED";
  policyNote?: string | null;
}) {
  return prisma.journalCatalogRecord.create({
    data: {
      scope: "GLOBAL",
      scopeTenantKey: "GLOBAL",
      sourceSystem: "SCIMAGO_RAW",
      sourceYear: input.sourceYear,
      sourceId: `SRC-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      identityKey: `ISSN:${input.issn.replace("-", "")}`,
      currentIdentityKey: `ISSN:${input.issn.replace("-", "")}`,
      title: input.title ?? "Matched Journal Record",
      normalizedTitle: (input.title ?? "Matched Journal Record")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim(),
      type: "journal",
      issnRaw: input.issn,
      issnPrimary: input.issn,
      issnList: [input.issn],
      issnNormalizedList: [input.issn.replace("-", "")],
      publisher: "Journal Catalog Press",
      sjrBestQuartile: input.quartile,
      policyStatus: input.policyStatus ?? "ALLOWED",
      policyNote: input.policyNote ?? null,
      isJournalEligible: true,
      createdByUserId: input.actorUserId,
    },
  });
}

function publicationFormData(overrides?: Record<string, unknown>) {
  return {
    paperTitle: "Auto Journal Match Paper",
    journalName: "Matched Journal",
    issn: "1234-5678",
    publicationDate: new Date("2026-05-10T00:00:00.000Z").toISOString(),
    pdfLink: "https://example.com/paper.pdf",
    doi: "10.1000/auto-journal-match",
    ...overrides,
  };
}

describe("publication journal enrichment", () => {
  test("reward preview matches quartile tiers from the journal catalog when journal tier fields are missing", async () => {
    tracker = newDbTracker();
    const fixture = await createPublicationRewardFixture(tracker);
    await createJournalCatalogMatch({
      actorUserId: fixture.actor.id,
      sourceYear: 2026,
      issn: "1234-5678",
      quartile: "Q1",
    });

    const preview = await previewKpiRewards(
      fixture.publication.kpi.id,
      fixture.tenant.id,
      {
        actualValue: 1,
        reportingDate: new Date("2026-05-10T00:00:00.000Z"),
        achievementFormData: publicationFormData(),
        contributors: [],
        systemMetrics: {},
      },
    );

    expect(preview).not.toBeNull();
    expect(preview?.matchedTiers.map((tier) => tier.code)).toContain("Q1");
    expect(
      preview?.components.some((component) => component.matchedTierCode === "Q1"),
    ).toBe(true);
  });

  test("recording a publication auto-fills missing journal fields from the catalog", async () => {
    tracker = newDbTracker();
    const fixture = await createPublicationRewardFixture(tracker);
    await createJournalCatalogMatch({
      actorUserId: fixture.actor.id,
      sourceYear: 2026,
      issn: "1234-5678",
      quartile: "Q1",
    });

    const result = await recordAchievement(
      fixture.tenant.id,
      {
        periodId: fixture.period.id,
        kpiDefinitionId: fixture.publication.kpi.id,
        targetAllocationId: fixture.publication.allocation.id,
        evidenceLinks: ["https://example.com/proof.pdf"],
        achievementFormData: publicationFormData(),
      },
      fixture.users.facultyCse.id,
      "TENANT_USER",
    );

    expect(result.status).toBe("success");

    const achievement = await prisma.achievement.findUnique({
      where: { id: result.id! },
      select: { achievementFormData: true },
    });
    const formData =
      (achievement?.achievementFormData as Record<string, unknown> | null) ?? {};

    expect(formData.journalTier).toBe("Q1");
    expect(formData.indexing).toEqual(["Scopus"]);
    expect(formData.__journalLookup).toMatchObject({
      quartile: "Q1",
      resolvedSourceYear: 2026,
      matchedExactly: true,
    });
  });

  test("manual journal tier overrides stay intact on edit even when the catalog resolves a different quartile", async () => {
    tracker = newDbTracker();
    const fixture = await createPublicationRewardFixture(tracker);
    await createJournalCatalogMatch({
      actorUserId: fixture.actor.id,
      sourceYear: 2026,
      issn: "1234-5678",
      quartile: "Q1",
    });

    const created = await recordAchievement(
      fixture.tenant.id,
      {
        periodId: fixture.period.id,
        kpiDefinitionId: fixture.publication.kpi.id,
        targetAllocationId: fixture.publication.allocation.id,
        evidenceLinks: ["https://example.com/proof.pdf"],
        achievementFormData: publicationFormData(),
      },
      fixture.users.facultyCse.id,
      "TENANT_USER",
    );

    expect(created.status).toBe("success");

    const updated = await updateAchievement(
      created.id!,
      fixture.tenant.id,
      {
        achievementFormData: {
          journalTier: "Q2",
        },
      },
      fixture.users.facultyCse.id,
      "TENANT_USER",
    );

    expect(updated.status).toBe("success");

    const achievement = await prisma.achievement.findUnique({
      where: { id: created.id! },
      select: { achievementFormData: true },
    });
    const formData =
      (achievement?.achievementFormData as Record<string, unknown> | null) ?? {};

    expect(formData.journalTier).toBe("Q2");
    expect(formData.indexing).toEqual(["Scopus"]);
  });

  test("journal lookup stores tenant policy warnings when a matched journal is blacklisted", async () => {
    tracker = newDbTracker();
    const fixture = await createPublicationRewardFixture(tracker);
    await createJournalCatalogMatch({
      actorUserId: fixture.actor.id,
      sourceYear: 2026,
      issn: "1234-5678",
      quartile: "Q1",
      policyStatus: "BLACKLISTED",
      policyNote: "Institution policy disallows claims for this journal.",
    });

    const result = await recordAchievement(
      fixture.tenant.id,
      {
        periodId: fixture.period.id,
        kpiDefinitionId: fixture.publication.kpi.id,
        targetAllocationId: fixture.publication.allocation.id,
        evidenceLinks: ["https://example.com/proof.pdf"],
        achievementFormData: publicationFormData(),
      },
      fixture.users.facultyCse.id,
      "TENANT_USER",
    );

    expect(result.status).toBe("success");

    const achievement = await prisma.achievement.findUnique({
      where: { id: result.id! },
      select: { achievementFormData: true },
    });
    const formData =
      (achievement?.achievementFormData as Record<string, unknown> | null) ?? {};
    const journalLookup = formData.__journalLookup as Record<string, unknown>;

    expect(journalLookup.policyStatus).toBe("BLACKLISTED");
    expect(journalLookup.policyNote).toBe(
      "Institution policy disallows claims for this journal.",
    );
    expect(journalLookup.warnings).toContain(
      "This journal is blacklisted by your institution: Institution policy disallows claims for this journal.",
    );
  });
});
