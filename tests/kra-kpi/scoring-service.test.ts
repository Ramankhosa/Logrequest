import {
  computeMaxPossibleScore,
  computeOverallPercentage,
  computeScore,
  computeWeightedOverallScore,
} from "@/lib/kra-kpi/scoring-service";
import { computeReviewCycles } from "@/lib/kra-kpi/period-service";

describe("KRA/KPI scoring", () => {
  test("caps ascending numeric LINEAR scores at 100 by default", () => {
    const score = computeScore(
      "NUMERIC",
      "LINEAR",
      "ASCENDING",
      { method: "LINEAR", capAt100: true },
      null,
      {
        targetValue: 10,
        actualValue: 12,
      },
    );

    expect(score).toBe(100);
  });

  test("supports descending numeric THRESHOLD scoring", () => {
    const score = computeScore(
      "NUMERIC",
      "THRESHOLD",
      "DESCENDING",
      {
        method: "THRESHOLD",
        thresholdValue: 120,
        belowScore: 0,
        aboveScore: 100,
      },
      null,
      {
        targetValue: 10,
        actualValue: 8,
      },
    );

    expect(score).toBe(100);
  });

  test("maps milestone progress proportionally", () => {
    const score = computeScore(
      "MILESTONE",
      "LINEAR",
      "ASCENDING",
      { method: "LINEAR", capAt100: true },
      null,
      {
        targetMilestone: "COMPLETED",
        actualMilestone: "IN_PROGRESS",
      },
    );

    expect(score).toBe(50);
  });

  test("penalizes late DATE_TARGET achievements", () => {
    const score = computeScore(
      "DATE_TARGET",
      "LINEAR",
      "ASCENDING",
      { method: "LINEAR", capAt100: true },
      null,
      {
        targetDate: new Date("2026-01-10T00:00:00.000Z"),
        actualDate: new Date("2026-01-12T00:00:00.000Z"),
      },
    );

    expect(score).toBe(90);
  });

  test("uses SLAB scoring ranges when configured", () => {
    const score = computeScore(
      "NUMERIC",
      "SLAB",
      "ASCENDING",
      {
        method: "SLAB",
        slabs: [
          { minPercent: 0, maxPercent: 79.99, score: 40 },
          { minPercent: 80, maxPercent: 99.99, score: 70 },
          { minPercent: 100, maxPercent: 200, score: 100 },
        ],
      },
      null,
      {
        targetValue: 10,
        actualValue: 8,
      },
    );

    expect(score).toBe(70);
  });

  test("computes weighted overall score helpers", () => {
    const kpiScores = [
      { kpiWeightage: 60, score: 90 },
      { kpiWeightage: 40, score: 50 },
    ];

    expect(computeWeightedOverallScore(kpiScores)).toBe(74);
    expect(computeMaxPossibleScore(kpiScores)).toBe(100);
    expect(computeOverallPercentage(kpiScores)).toBe(74);
  });

  test("computes monthly review cycles and caps the final partial cycle", () => {
    const cycles = computeReviewCycles(
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-04-15T00:00:00.000Z"),
      "MONTHLY",
    );

    expect(cycles).toHaveLength(4);
    expect(cycles[0]?.startDate.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(cycles[0]?.endDate.toISOString()).toBe("2026-01-31T00:00:00.000Z");
    expect(cycles[3]?.startDate.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(cycles[3]?.endDate.toISOString()).toBe("2026-04-15T00:00:00.000Z");
  });
});
