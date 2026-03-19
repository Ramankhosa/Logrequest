import { execFileSync } from "node:child_process";
import { prisma } from "@/lib/prisma";
import { recordAchievement, recommendAchievement, submitForVerification, verifyAchievement } from "@/lib/kra-kpi/achievement-service";
import { getMyAllocations, getMyReviewQueue } from "@/lib/kra-kpi/my-kpi-service";
import { transitionPeriodState } from "@/lib/kra-kpi/period-service";
import { createAllocation } from "@/lib/kra-kpi/target-service";

const TEST_PREFIX = "R11A_SEEDED_TEST";
const DEMO_DOMAIN = "demo-university.local.test";
const TENANT_CODE = "DEMO_UNIV";
const PERIOD_CODE = "AY2025_26";
const KPI_TITLE = "Seed: Indexed Publications";
const PARENT_ALLOCATION_NOTE = "seed-parent-cse-publications";

type SeedFixture = {
  tenantId: string;
  periodId: string;
  kpiId: string;
  parentAllocationId: string;
  ownerId: string;
  demoEmployeeId: string;
  facultyTwoId: string;
  cseHeadId: string;
  eceHeadId: string;
};

let seed: SeedFixture;
let currentPrefix = "";

function seededEmail(localPart: string) {
  return `${localPart}@${DEMO_DOMAIN}`;
}

function runSeedScripts() {
  execFileSync("node", ["prisma/seedscript.mjs"], {
    cwd: process.cwd(),
    stdio: "pipe",
  });
  execFileSync("node", ["prisma/seed.mjs"], {
    cwd: process.cwd(),
    stdio: "pipe",
  });
}

async function loadSeedFixture(): Promise<SeedFixture> {
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
      title: KPI_TITLE,
    },
    select: { id: true },
  });
  expect(kpi).toBeTruthy();

  const parentAllocation = await prisma.targetAllocation.findFirst({
    where: {
      tenantId: tenant!.id,
      notes: PARENT_ALLOCATION_NOTE,
    },
    select: { id: true },
  });
  expect(parentAllocation).toBeTruthy();

  const users = await prisma.user.findMany({
    where: {
      officialEmail: {
        in: [
          seededEmail("owner"),
          seededEmail("employee"),
          seededEmail("faculty2"),
          seededEmail("cse.head"),
          seededEmail("ece.head"),
        ],
      },
    },
    select: { id: true, officialEmail: true },
  });
  const userMap = new Map(users.map((user) => [user.officialEmail, user.id]));

  expect(userMap.get(seededEmail("owner"))).toBeTruthy();
  expect(userMap.get(seededEmail("employee"))).toBeTruthy();
  expect(userMap.get(seededEmail("faculty2"))).toBeTruthy();
  expect(userMap.get(seededEmail("cse.head"))).toBeTruthy();
  expect(userMap.get(seededEmail("ece.head"))).toBeTruthy();

  return {
    tenantId: tenant!.id,
    periodId: period!.id,
    kpiId: kpi!.id,
    parentAllocationId: parentAllocation!.id,
    ownerId: userMap.get(seededEmail("owner"))!,
    demoEmployeeId: userMap.get(seededEmail("employee"))!,
    facultyTwoId: userMap.get(seededEmail("faculty2"))!,
    cseHeadId: userMap.get(seededEmail("cse.head"))!,
    eceHeadId: userMap.get(seededEmail("ece.head"))!,
  };
}

async function cleanupArtifacts(prefix: string) {
  if (!prefix) return;

  const achievements = await prisma.achievement.findMany({
    where: {
      tenantId: seed.tenantId,
      OR: [
        { evidenceDescription: { startsWith: prefix } },
        { targetAllocation: { notes: { startsWith: prefix } } },
      ],
    },
    select: { id: true },
  });
  const achievementIds = achievements.map((achievement) => achievement.id);

  if (achievementIds.length > 0) {
    await prisma.auditLog.deleteMany({
      where: {
        tenantId: seed.tenantId,
        targetId: { in: achievementIds },
      },
    });
    await prisma.achievement.deleteMany({
      where: { id: { in: achievementIds } },
    });
  }

  const allocations = await prisma.targetAllocation.findMany({
    where: {
      tenantId: seed.tenantId,
      notes: { startsWith: prefix },
    },
    select: { id: true },
  });
  const allocationIds = allocations.map((allocation) => allocation.id);

  if (allocationIds.length > 0) {
    await prisma.auditLog.deleteMany({
      where: {
        tenantId: seed.tenantId,
        targetId: { in: allocationIds },
      },
    });
    await prisma.targetAllocation.deleteMany({
      where: { id: { in: allocationIds } },
    });
  }
}

async function createSeededTestAllocation(options: {
  assignedToUserId: string;
  targetValue?: number;
  noteSuffix: string;
}) {
  const notes = `${currentPrefix}:${options.noteSuffix}`;
  const createResult = await createAllocation(
    seed.tenantId,
    {
      periodId: seed.periodId,
      kpiDefinitionId: seed.kpiId,
      assignedToUserId: options.assignedToUserId,
      parentAllocationId: seed.parentAllocationId,
      ...(options.targetValue !== undefined && { targetValue: options.targetValue }),
      notes,
    },
    seed.ownerId,
    "TENANT_OWNER",
  );
  expect(createResult.status).toBe("success");

  const allocation = await prisma.targetAllocation.findFirst({
    where: {
      tenantId: seed.tenantId,
      notes,
    },
    orderBy: { createdAt: "desc" },
  });
  expect(allocation).toBeTruthy();

  return allocation!;
}

async function recordAndSubmitSeededAchievement(options: {
  reporterUserId: string;
  allocationId: string;
  actualValue: number;
}) {
  const recordResult = await recordAchievement(
    seed.tenantId,
    {
      periodId: seed.periodId,
      kpiDefinitionId: seed.kpiId,
      targetAllocationId: options.allocationId,
      actualValue: options.actualValue,
      evidenceDescription: `${currentPrefix}:evidence`,
    },
    options.reporterUserId,
    "TENANT_USER",
  );

  expect(recordResult.status).toBe("success");
  expect(recordResult.id).toBeTruthy();

  const achievementId = recordResult.id!;
  const submitResult = await submitForVerification(
    achievementId,
    seed.tenantId,
    options.reporterUserId,
    "TENANT_USER",
  );
  expect(submitResult.status).toBe("success");

  return achievementId;
}

describe("R1.1a seeded integration", () => {
  beforeAll(async () => {
    runSeedScripts();
    seed = await loadSeedFixture();
    await cleanupArtifacts(TEST_PREFIX);
  }, 120_000);

  beforeEach(async () => {
    currentPrefix = `${TEST_PREFIX}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    await prisma.assessmentPeriod.update({
      where: { id: seed.periodId },
      data: { state: "IN_PROGRESS" },
    });
  });

  afterEach(async () => {
    await cleanupArtifacts(currentPrefix);
    await prisma.assessmentPeriod.update({
      where: { id: seed.periodId },
      data: { state: "IN_PROGRESS" },
    });
  });

  test("routes same-department seeded submissions directly to verification", async () => {
    const allocation = await createSeededTestAllocation({
      assignedToUserId: seed.demoEmployeeId,
      targetValue: 2,
      noteSuffix: "same-department",
    });

    const achievementId = await recordAndSubmitSeededAchievement({
      reporterUserId: seed.demoEmployeeId,
      allocationId: allocation.id,
      actualValue: 2,
    });

    const cseHeadQueue = await getMyReviewQueue(
      seed.tenantId,
      seed.cseHeadId,
      seed.periodId,
    );
    const queueItem = cseHeadQueue.find((item) => item.achievementId === achievementId);

    expect(queueItem).toMatchObject({
      achievementId,
      reviewLevel: "VERIFY",
      achievementState: "SUBMITTED",
    });

    const recommendResult = await recommendAchievement(
      achievementId,
      seed.tenantId,
      true,
      `${currentPrefix}:recommend`,
      seed.cseHeadId,
      "TENANT_USER",
    );
    expect(recommendResult.status).toBe("error");
    expect(recommendResult.message).toContain("verified directly");

    const verifyResult = await verifyAchievement(
      achievementId,
      seed.tenantId,
      true,
      `${currentPrefix}:verify`,
      seed.cseHeadId,
      "TENANT_USER",
    );
    expect(verifyResult.status).toBe("success");

    const stored = await prisma.achievement.findUnique({
      where: { id: achievementId },
      select: { state: true, verifiedByUserId: true },
    });
    expect(stored).toMatchObject({
      state: "VERIFIED",
      verifiedByUserId: seed.cseHeadId,
    });
  });

  test("routes cross-department seeded submissions through recommend then verify", async () => {
    const allocation = await createSeededTestAllocation({
      assignedToUserId: seed.facultyTwoId,
      targetValue: 2,
      noteSuffix: "cross-department",
    });

    const achievementId = await recordAndSubmitSeededAchievement({
      reporterUserId: seed.facultyTwoId,
      allocationId: allocation.id,
      actualValue: 2,
    });

    const eceHeadQueue = await getMyReviewQueue(
      seed.tenantId,
      seed.eceHeadId,
      seed.periodId,
    );
    const beforeRecommend = eceHeadQueue.find((item) => item.achievementId === achievementId);
    expect(beforeRecommend).toMatchObject({
      achievementId,
      reviewLevel: "RECOMMEND",
      achievementState: "SUBMITTED",
    });

    const cseHeadQueueBeforeRecommend = await getMyReviewQueue(
      seed.tenantId,
      seed.cseHeadId,
      seed.periodId,
    );
    expect(
      cseHeadQueueBeforeRecommend.some((item) => item.achievementId === achievementId),
    ).toBe(false);

    const recommendResult = await recommendAchievement(
      achievementId,
      seed.tenantId,
      true,
      `${currentPrefix}:recommend`,
      seed.eceHeadId,
      "TENANT_USER",
    );
    expect(recommendResult.status).toBe("success");

    const cseHeadQueueAfterRecommend = await getMyReviewQueue(
      seed.tenantId,
      seed.cseHeadId,
      seed.periodId,
    );
    const verifyItem = cseHeadQueueAfterRecommend.find(
      (item) => item.achievementId === achievementId,
    );
    expect(verifyItem).toMatchObject({
      achievementId,
      reviewLevel: "VERIFY",
      achievementState: "RECOMMENDED",
    });

    const verifyResult = await verifyAchievement(
      achievementId,
      seed.tenantId,
      true,
      `${currentPrefix}:verify`,
      seed.cseHeadId,
      "TENANT_USER",
    );
    expect(verifyResult.status).toBe("success");

    const stored = await prisma.achievement.findUnique({
      where: { id: achievementId },
      select: {
        state: true,
        recommendedByUserId: true,
        verifiedByUserId: true,
      },
    });
    expect(stored).toMatchObject({
      state: "VERIFIED",
      recommendedByUserId: seed.eceHeadId,
      verifiedByUserId: seed.cseHeadId,
    });
  });

  test("keeps pending seeded submissions verifiable after the period is closed", async () => {
    const allocation = await createSeededTestAllocation({
      assignedToUserId: seed.demoEmployeeId,
      targetValue: 1,
      noteSuffix: "closed-period",
    });

    const achievementId = await recordAndSubmitSeededAchievement({
      reporterUserId: seed.demoEmployeeId,
      allocationId: allocation.id,
      actualValue: 1,
    });

    const closeResult = await transitionPeriodState(
      seed.periodId,
      seed.tenantId,
      "CLOSED",
      seed.ownerId,
      "TENANT_OWNER",
    );
    expect(closeResult.status).toBe("success");

    const queue = await getMyReviewQueue(seed.tenantId, seed.cseHeadId, seed.periodId);
    expect(queue.find((item) => item.achievementId === achievementId)).toMatchObject({
      achievementId,
      reviewLevel: "VERIFY",
    });

    const verifyResult = await verifyAchievement(
      achievementId,
      seed.tenantId,
      true,
      `${currentPrefix}:closed-verify`,
      seed.cseHeadId,
      "TENANT_USER",
    );
    expect(verifyResult.status).toBe("success");
  });

  test("shows seeded assignees null-target allocations but blocks recording against them", async () => {
    const notes = `${currentPrefix}:null-target`;
    const allocation = await prisma.targetAllocation.create({
      data: {
        tenantId: seed.tenantId,
        periodId: seed.periodId,
        kpiDefinitionId: seed.kpiId,
        assignedToUserId: seed.demoEmployeeId,
        allocatedByUserId: seed.ownerId,
        parentAllocationId: seed.parentAllocationId,
        notes,
      },
    });

    const allocations = await getMyAllocations(
      seed.tenantId,
      seed.demoEmployeeId,
      seed.periodId,
    );
    const visibleAllocation = allocations.find((item) => item.id === allocation.id);
    expect(visibleAllocation).toBeTruthy();
    expect(visibleAllocation?.targetValue).toBeNull();

    const recordResult = await recordAchievement(
      seed.tenantId,
      {
        periodId: seed.periodId,
        kpiDefinitionId: seed.kpiId,
        targetAllocationId: allocation.id,
        actualValue: 1,
        evidenceDescription: `${currentPrefix}:null-target-evidence`,
      },
      seed.demoEmployeeId,
      "TENANT_USER",
    );

    expect(recordResult.status).toBe("error");
    expect(recordResult.message).toContain("Target not set yet");
  });
});
