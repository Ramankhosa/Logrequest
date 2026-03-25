import { beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  getMyDashboardSummary,
  getMyPendingCount,
  getMyReviewQueue,
} from "@/lib/kra-kpi/my-kpi-service";
import { listContributorRewards } from "@/lib/kra-kpi/reward-ops-service";

const DEMO_DOMAIN = "demo-university.local.test";
const TENANT_CODE = "DEMO_UNIV";
const PERIOD_CODE = "AY2025_26";
const R43_KPI_TITLE = "Seed: Publication Incentive Workflow";
const R43_ACHIEVEMENT_PREFIX = "Seed R4.3";

type SeededSmokeFixture = {
  tenantId: string;
  periodId: string;
  r43KpiId: string;
  facultyOneId: string;
  cseHeadId: string;
  eceHeadId: string;
};

let seed: SeededSmokeFixture;

function seededEmail(localPart: string) {
  return `${localPart}@${DEMO_DOMAIN}`;
}

async function loadSeedFixture(): Promise<SeededSmokeFixture> {
  const tenant = await prisma.tenant.findUnique({
    where: { code: TENANT_CODE },
    select: { id: true },
  });
  expect(tenant).toBeTruthy();

  const period = await prisma.assessmentPeriod.findUnique({
    where: {
      tenantId_code: {
        tenantId: tenant!.id,
        code: PERIOD_CODE,
      },
    },
    select: { id: true },
  });
  expect(period).toBeTruthy();

  const kpi = await prisma.kpiDefinition.findFirst({
    where: {
      kraDefinition: {
        tenantId: tenant!.id,
        periodId: period!.id,
      },
      title: R43_KPI_TITLE,
    },
    select: { id: true },
  });
  expect(kpi).toBeTruthy();

  const users = await prisma.user.findMany({
    where: {
      officialEmail: {
        in: [
          seededEmail("faculty1"),
          seededEmail("cse.head"),
          seededEmail("ece.head"),
        ],
      },
    },
    select: { id: true, officialEmail: true },
  });
  const userByEmail = new Map(users.map((user) => [user.officialEmail, user.id]));

  return {
    tenantId: tenant!.id,
    periodId: period!.id,
    r43KpiId: kpi!.id,
    facultyOneId: userByEmail.get(seededEmail("faculty1"))!,
    cseHeadId: userByEmail.get(seededEmail("cse.head"))!,
    eceHeadId: userByEmail.get(seededEmail("ece.head"))!,
  };
}

describe("database-first seeded smoke and regression scenarios", () => {
  beforeAll(async () => {
    seed = await loadSeedFixture();
  });

  test("seeded demo queues, pending counts, notifications, and dashboard summary stay aligned", async () => {
    const cseQueue = await getMyReviewQueue(seed.tenantId, seed.cseHeadId, seed.periodId);
    const eceQueue = await getMyReviewQueue(seed.tenantId, seed.eceHeadId, seed.periodId);

    expect(
      cseQueue.some((row) => row.achievementTitle === "Seed R4.3 Pending Verification"),
    ).toBe(true);
    expect(
      eceQueue.some((row) => row.achievementTitle === "Seed R4.3 Pending Recommendation"),
    ).toBe(true);

    expect(await getMyPendingCount(seed.tenantId, seed.cseHeadId)).toBeGreaterThan(0);
    expect(await getMyPendingCount(seed.tenantId, seed.eceHeadId)).toBeGreaterThan(0);

    const dashboard = await getMyDashboardSummary(
      seed.tenantId,
      seed.facultyOneId,
      seed.periodId,
    );
    expect(dashboard).toBeTruthy();
    if (!dashboard) {
      throw new Error("Expected seeded dashboard summary to be available.");
    }
    expect(dashboard.totalAllocations).toBeGreaterThan(0);
    expect(Object.keys(dashboard.statusCounts).length).toBeGreaterThan(0);

    const notifications = await prisma.notification.findMany({
      where: {
        tenantId: seed.tenantId,
        userId: { in: [seed.facultyOneId, seed.cseHeadId, seed.eceHeadId] },
        type: {
          in: [
            "ACHIEVEMENT_SUBMITTED",
            "ACHIEVEMENT_RECOMMENDED",
            "ACHIEVEMENT_REJECTED",
            "ACHIEVEMENT_CORRECTED",
            "REWARD_PENDING",
            "REWARD_RELEASED",
            "REWARD_REVOKED",
          ],
        },
      },
      select: { id: true, eventKey: true, type: true },
    });
    expect(notifications.length).toBeGreaterThan(0);
    const dedupedEventKeys = notifications
      .map((row) => row.eventKey)
      .filter((value): value is string => Boolean(value));
    expect(new Set(dedupedEventKeys).size).toBe(dedupedEventKeys.length);
  });

  test("seeded reward console exposes all lifecycle states and grouped benefit totals", async () => {
    const rewardConsole = await listContributorRewards(seed.tenantId, {
      kpiDefinitionId: seed.r43KpiId,
      state: "ALL",
      limit: 100,
    });

    expect(rewardConsole.totalRows).toBeGreaterThan(0);
    const states = new Set(rewardConsole.rewards.map((row) => row.state));
    expect(states.has("DRAFT")).toBe(true);
    expect(states.has("PENDING")).toBe(true);
    expect(states.has("RELEASED")).toBe(true);
    expect(states.has("REVOKED")).toBe(true);

    const benefitCodes = rewardConsole.totals.map((row) => row.benefitTypeCode).sort();
    expect(benefitCodes).toEqual(["LEAVE_POINTS", "MONETARY"]);
    expect(
      rewardConsole.totals.every((row) => row.totalAmount >= row.releasedAmount),
    ).toBe(true);
    expect(
      rewardConsole.rewards.some((row) => row.kpiTitle === R43_KPI_TITLE),
    ).toBe(true);
  });

  test("seeded workflow achievements and rewards remain unique after refresh", async () => {
    const achievements = await prisma.achievement.findMany({
      where: {
        tenantId: seed.tenantId,
        kpiDefinitionId: seed.r43KpiId,
        title: { startsWith: R43_ACHIEVEMENT_PREFIX },
      },
      select: { id: true, title: true },
    });
    const rewardCount = await prisma.contributorReward.count({
      where: {
        tenantId: seed.tenantId,
        kpiDefinitionId: seed.r43KpiId,
      },
    });

    expect(achievements.length).toBeGreaterThan(0);
    expect(new Set(achievements.map((row) => row.title)).size).toBe(achievements.length);
    expect(rewardCount).toBeGreaterThan(0);
  });
});
