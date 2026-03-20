import type { Role } from "@prisma/client";
import { afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createPeriod,
  transitionPeriodState,
  generateReviewCycles,
  listReviewCycles,
  updateCurrentCycle,
  computeReviewCycles,
  isDateWithinInclusiveUtcRange,
} from "@/lib/kra-kpi/period-service";
import {
  cleanupTrackedData,
  createTenantActor,
  newDbTracker,
  type DbTracker,
} from "../helpers/db";

let tracker: DbTracker;
let tenantId: string;
let actorUserId: string;
const actorRole: Role = "TENANT_ADMIN";

beforeAll(async () => {
  tracker = newDbTracker();
  const ta = await createTenantActor(tracker, actorRole);
  tenantId = ta.tenant.id;
  actorUserId = ta.actor.id;
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await cleanupTrackedData(tracker);
});

describe("R2.1 Review Cycles", () => {
  let periodId: string;

  beforeAll(async () => {
    const result = await createPeriod(
      tenantId,
      {
        name: "RC Test Period",
        code: "RC_TEST_2026",
        periodType: "SPECIFIC_RANGE",
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-12-31"),
        reviewFrequency: "QUARTERLY",
      },
      actorUserId,
      actorRole,
    );
    expect(result.status).toBe("success");
    const period = await prisma.assessmentPeriod.findFirst({
      where: { tenantId, code: "RC_TEST_2026" },
    });
    periodId = period!.id;
  });

  it("generateReviewCycles creates inclusive quarterly boundaries", async () => {
    const result = await generateReviewCycles(periodId, tenantId, actorUserId, actorRole);
    expect(result.status).toBe("success");
    expect(result.data).toHaveLength(4);
    expect(result.data?.map((cycle) => cycle.label)).toEqual(["Q1", "Q2", "Q3", "Q4"]);
    expect(result.data?.map((cycle) => cycle.startDate.toISOString().slice(0, 10))).toEqual([
      "2026-01-01",
      "2026-04-01",
      "2026-07-01",
      "2026-10-01",
    ]);
    expect(result.data?.map((cycle) => cycle.endDate.toISOString().slice(0, 10))).toEqual([
      "2026-03-31",
      "2026-06-30",
      "2026-09-30",
      "2026-12-31",
    ]);
  });

  it("listReviewCycles returns ordered cycles", async () => {
    const cycles = await listReviewCycles(periodId, tenantId);
    expect(cycles).toHaveLength(4);
    expect(cycles.map((cycle) => cycle.cycleNumber)).toEqual([1, 2, 3, 4]);
  });

  it("regeneration is idempotent and replaces old IDs", async () => {
    const result1 = await generateReviewCycles(periodId, tenantId, actorUserId, actorRole);
    expect(result1.status).toBe("success");
    const ids1 = result1.data!.map((cycle) => cycle.id);

    const result2 = await generateReviewCycles(periodId, tenantId, actorUserId, actorRole);
    expect(result2.status).toBe("success");
    const ids2 = result2.data!.map((cycle) => cycle.id);

    expect(ids1).not.toEqual(ids2);

    const allCycles = await prisma.reviewCycle.findMany({
      where: { periodId },
      orderBy: { cycleNumber: "asc" },
    });
    expect(allCycles).toHaveLength(4);
    expect(allCycles.map((cycle) => cycle.cycleNumber)).toEqual([1, 2, 3, 4]);
  });

  it("non-admin cannot generate cycles", async () => {
    const result = await generateReviewCycles(periodId, tenantId, actorUserId, "TENANT_USER");
    expect(result.status).toBe("error");
    expect(result.code).toBe("PERMISSION_DENIED");
  });

  it("period not found returns a typed error", async () => {
    const result = await generateReviewCycles("nonexistent-id", tenantId, actorUserId, actorRole);
    expect(result.status).toBe("error");
    expect(result.code).toBe("PERIOD_NOT_FOUND");
  });

  it("updateCurrentCycle enforces a single inclusive current cycle", async () => {
    await prisma.reviewCycle.updateMany({
      where: { periodId },
      data: { isCurrent: true },
    });

    const result = await updateCurrentCycle(periodId, tenantId);
    expect(result.status).toBe("success");

    const cycles = await listReviewCycles(periodId, tenantId);
    const expectedCurrentCycles = cycles
      .filter((cycle) => isDateWithinInclusiveUtcRange(new Date(), cycle.startDate, cycle.endDate))
      .map((cycle) => cycle.cycleNumber);
    expect(cycles.filter((cycle) => cycle.isCurrent).map((cycle) => cycle.cycleNumber)).toEqual(expectedCurrentCycles);
  });

  describe("computeReviewCycles pure function", () => {
    it("MONTHLY: Jan-Jun yields 6 inclusive cycles", () => {
      const cycles = computeReviewCycles(
        new Date("2026-01-01T00:00:00.000Z"),
        new Date("2026-06-30T00:00:00.000Z"),
        "MONTHLY",
      );

      expect(cycles).toHaveLength(6);
      expect(cycles[0]?.startDate.toISOString()).toBe("2026-01-01T00:00:00.000Z");
      expect(cycles[0]?.endDate.toISOString()).toBe("2026-01-31T00:00:00.000Z");
      expect(cycles[5]?.startDate.toISOString()).toBe("2026-06-01T00:00:00.000Z");
      expect(cycles[5]?.endDate.toISOString()).toBe("2026-06-30T00:00:00.000Z");
    });

    it("QUARTERLY full-year boundaries align to calendar quarters", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-20T12:00:00.000Z"));

      const cycles = computeReviewCycles(
        new Date("2026-01-01T00:00:00.000Z"),
        new Date("2026-12-31T00:00:00.000Z"),
        "QUARTERLY",
      );

      expect(cycles).toHaveLength(4);
      expect(cycles.map((cycle) => cycle.label)).toEqual(["Q1", "Q2", "Q3", "Q4"]);
      expect(cycles[3]?.endDate.toISOString()).toBe("2026-12-31T00:00:00.000Z");
      expect(cycles.map((cycle) => cycle.isCurrent)).toEqual([true, false, false, false]);
    });

    it("HALF_YEARLY yields 2 cycles", () => {
      const cycles = computeReviewCycles(
        new Date("2026-01-01T00:00:00.000Z"),
        new Date("2026-12-31T00:00:00.000Z"),
        "HALF_YEARLY",
      );

      expect(cycles).toHaveLength(2);
      expect(cycles[0]?.endDate.toISOString()).toBe("2026-06-30T00:00:00.000Z");
      expect(cycles[1]?.endDate.toISOString()).toBe("2026-12-31T00:00:00.000Z");
    });

    it("ANNUAL full-year range yields 1 cycle", () => {
      const cycles = computeReviewCycles(
        new Date("2026-01-01T00:00:00.000Z"),
        new Date("2026-12-31T00:00:00.000Z"),
        "ANNUAL",
      );

      expect(cycles).toHaveLength(1);
      expect(cycles[0]?.startDate.toISOString()).toBe("2026-01-01T00:00:00.000Z");
      expect(cycles[0]?.endDate.toISOString()).toBe("2026-12-31T00:00:00.000Z");
    });

    it("WEEKLY creates a trailing partial cycle", () => {
      const cycles = computeReviewCycles(
        new Date("2026-01-01T00:00:00.000Z"),
        new Date("2026-01-31T00:00:00.000Z"),
        "WEEKLY",
      );

      expect(cycles).toHaveLength(5);
      expect(cycles[4]?.startDate.toISOString()).toBe("2026-01-29T00:00:00.000Z");
      expect(cycles[4]?.endDate.toISOString()).toBe("2026-01-31T00:00:00.000Z");
    });

    it("DAILY full-year range yields 365 cycles", () => {
      const cycles = computeReviewCycles(
        new Date("2026-01-01T00:00:00.000Z"),
        new Date("2026-12-31T00:00:00.000Z"),
        "DAILY",
      );

      expect(cycles).toHaveLength(365);
      expect(cycles[0]?.label).toBe("2026-01-01");
      expect(cycles[364]?.label).toBe("2026-12-31");
    });

    it("DAILY leap-year range yields 366 cycles and includes Feb 29", () => {
      const cycles = computeReviewCycles(
        new Date("2028-01-01T00:00:00.000Z"),
        new Date("2028-12-31T00:00:00.000Z"),
        "DAILY",
      );

      expect(cycles).toHaveLength(366);
      expect(cycles.some((cycle) => cycle.label === "2028-02-29")).toBe(true);
    });

    it("uneven quarterly range caps the last cycle at the period end", () => {
      const cycles = computeReviewCycles(
        new Date("2026-01-01T00:00:00.000Z"),
        new Date("2026-10-31T00:00:00.000Z"),
        "QUARTERLY",
      );

      expect(cycles).toHaveLength(4);
      expect(cycles[3]?.startDate.toISOString()).toBe("2026-10-01T00:00:00.000Z");
      expect(cycles[3]?.endDate.toISOString()).toBe("2026-10-31T00:00:00.000Z");
    });

    it("same-day periods generate one daily cycle", () => {
      const cycles = computeReviewCycles(
        new Date("2026-01-01T00:00:00.000Z"),
        new Date("2026-01-01T00:00:00.000Z"),
        "DAILY",
      );

      expect(cycles).toHaveLength(1);
      expect(cycles[0]?.startDate.toISOString()).toBe("2026-01-01T00:00:00.000Z");
      expect(cycles[0]?.endDate.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    });

    it("sets no current cycle when today is outside the period", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-20T12:00:00.000Z"));

      const cycles = computeReviewCycles(
        new Date("2026-06-01T00:00:00.000Z"),
        new Date("2026-12-31T00:00:00.000Z"),
        "QUARTERLY",
      );

      expect(cycles.some((cycle) => cycle.isCurrent)).toBe(false);
    });
  });

  it("supports same-day periods through the service layer", async () => {
    const createResult = await createPeriod(
      tenantId,
      {
        name: "Same Day Period",
        code: "SAME_DAY_PERIOD",
        periodType: "SPECIFIC_RANGE",
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-01-01"),
        reviewFrequency: "DAILY",
      },
      actorUserId,
      actorRole,
    );
    expect(createResult.status).toBe("success");

    const period = await prisma.assessmentPeriod.findFirst({
      where: { tenantId, code: "SAME_DAY_PERIOD" },
    });
    const generateResult = await generateReviewCycles(period!.id, tenantId, actorUserId, actorRole);

    expect(generateResult.status).toBe("success");
    expect(generateResult.data).toHaveLength(1);
    expect(generateResult.data?.[0]?.startDate.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(generateResult.data?.[0]?.endDate.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("concurrent regeneration leaves exactly one valid cycle set", async () => {
    const [left, right] = await Promise.allSettled([
      generateReviewCycles(periodId, tenantId, actorUserId, actorRole),
      generateReviewCycles(periodId, tenantId, actorUserId, actorRole),
    ]);

    expect(left.status).toBe("fulfilled");
    expect(right.status).toBe("fulfilled");

    const returnedStatuses = [left, right]
      .filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof generateReviewCycles>>> => result.status === "fulfilled")
      .map((result) => result.value.status);
    expect(returnedStatuses.every((status) => status === "success" || status === "error")).toBe(true);

    const cycles = await prisma.reviewCycle.findMany({
      where: { periodId },
      orderBy: { cycleNumber: "asc" },
    });
    expect(cycles).toHaveLength(4);
    expect(cycles.map((cycle) => cycle.cycleNumber)).toEqual([1, 2, 3, 4]);
    expect(new Set(cycles.map((cycle) => cycle.cycleNumber)).size).toBe(4);
  });

  it("auto-generates cycles on IN_PROGRESS transition", async () => {
    const freshResult = await createPeriod(
      tenantId,
      {
        name: "Auto RC Period",
        code: "AUTO_RC_2026",
        periodType: "SPECIFIC_RANGE",
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-12-31"),
        reviewFrequency: "QUARTERLY",
      },
      actorUserId,
      actorRole,
    );
    expect(freshResult.status).toBe("success");

    const fresh = await prisma.assessmentPeriod.findFirst({
      where: { tenantId, code: "AUTO_RC_2026" },
    });

    await transitionPeriodState(fresh!.id, tenantId, "OPEN", actorUserId, actorRole);
    await transitionPeriodState(fresh!.id, tenantId, "IN_PROGRESS", actorUserId, actorRole);

    const cycles = await listReviewCycles(fresh!.id, tenantId);
    expect(cycles).toHaveLength(4);
  });
});
