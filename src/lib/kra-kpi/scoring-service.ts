import type {
  KpiMeasurementType,
  ScoringMethod,
  ScoringDirection,
  MilestoneStatus,
  GradeValue,
} from "@prisma/client";
import type { MeasurementConfig, ScoringConfig } from "./shared";
import { GRADE_SCORE_MAP, MILESTONE_SCORE_MAP } from "./shared";

// ── Types ────────────────────────────────────────────────────────────────────

type TargetActual = {
  targetValue?: number | null;
  targetDate?: Date | null;
  targetMilestone?: MilestoneStatus | null;
  targetGrade?: GradeValue | null;
  targetBoolean?: boolean | null;
  targetRating?: number | null;
  actualValue?: number | null;
  actualDate?: Date | null;
  actualMilestone?: MilestoneStatus | null;
  actualGrade?: GradeValue | null;
  actualBoolean?: boolean | null;
  actualRating?: number | null;
};

type KpiScoreInput = {
  kpiWeightage: number; // absolute weight out of 100
  score: number; // 0-100
};

// ── Core Scoring Engine ──────────────────────────────────────────────────────

/**
 * Compute a 0-100 score for any KPI measurement type + scoring method + direction.
 * Returns null if target or actual data is insufficient.
 */
export function computeScore(
  measurementType: KpiMeasurementType,
  scoringMethod: ScoringMethod,
  scoringDirection: ScoringDirection,
  scoringConfig: ScoringConfig | null,
  measurementConfig: MeasurementConfig | null,
  data: TargetActual
): number | null {
  // Step 1: Get a raw achievement percentage based on measurement type
  const rawPercent = computeRawPercent(measurementType, scoringDirection, data);
  if (rawPercent === null) return null;

  // Step 2: Apply scoring method to convert raw percent to final score
  return applyScoringMethod(scoringMethod, scoringConfig, rawPercent);
}

/**
 * Compute raw achievement percentage (actual/target * 100) for each measurement type.
 * For DESCENDING direction, the ratio is inverted (target/actual * 100).
 */
function computeRawPercent(
  type: KpiMeasurementType,
  direction: ScoringDirection,
  data: TargetActual
): number | null {
  switch (type) {
    case "NUMERIC":
    case "PERCENTAGE":
    case "CURRENCY": {
      const target = data.targetValue;
      const actual = data.actualValue;
      if (target == null || actual == null || target === 0) return null;
      if (direction === "DESCENDING") {
        // Lower is better: if target=15% and actual=10%, raw = 15/10 * 100 = 150%
        return (target / actual) * 100;
      }
      return (actual / target) * 100;
    }

    case "BOOLEAN": {
      if (data.targetBoolean == null || data.actualBoolean == null) return null;
      // Target true, actual true = 100%. Target true, actual false = 0%.
      // Target false (shouldn't happen), actual false = 100%.
      if (data.targetBoolean === data.actualBoolean) return 100;
      return 0;
    }

    case "RATING": {
      const target = data.targetRating;
      const actual = data.actualRating;
      if (target == null || actual == null || target === 0) return null;
      if (direction === "DESCENDING") {
        return (target / actual) * 100;
      }
      return (actual / target) * 100;
    }

    case "MILESTONE": {
      const target = data.targetMilestone;
      const actual = data.actualMilestone;
      if (target == null || actual == null) return null;
      const targetScore = MILESTONE_SCORE_MAP[target];
      const actualScore = MILESTONE_SCORE_MAP[actual];
      if (targetScore === 0) return actualScore > 0 ? 100 : 0;
      return (actualScore / targetScore) * 100;
    }

    case "DATE_TARGET": {
      const target = data.targetDate;
      const actual = data.actualDate;
      if (target == null || actual == null) return null;
      const targetMs = target.getTime();
      const actualMs = actual.getTime();
      if (actualMs <= targetMs) {
        // Completed on or before deadline
        return 100;
      }
      // Late: penalize proportionally (each day late = less score)
      const daysLate = (actualMs - targetMs) / (1000 * 60 * 60 * 24);
      // Lose 5% per day late, minimum 0%
      return Math.max(0, 100 - daysLate * 5);
    }

    case "GRADE": {
      const target = data.targetGrade;
      const actual = data.actualGrade;
      if (target == null || actual == null) return null;
      const targetScore = GRADE_SCORE_MAP[target];
      const actualScore = GRADE_SCORE_MAP[actual];
      if (targetScore === 0) return actualScore > 0 ? 100 : 0;
      if (direction === "DESCENDING") {
        return (targetScore / actualScore) * 100;
      }
      return (actualScore / targetScore) * 100;
    }

    default:
      return null;
  }
}

/**
 * Apply scoring method (LINEAR, THRESHOLD, SLAB) to a raw achievement percentage.
 * Returns a final score between 0-100.
 */
function applyScoringMethod(
  method: ScoringMethod,
  config: ScoringConfig | null,
  rawPercent: number
): number {
  switch (method) {
    case "LINEAR": {
      const capAt100 =
        config && config.method === "LINEAR" ? config.capAt100 : true;
      const score = rawPercent;
      return capAt100 ? Math.min(100, Math.max(0, score)) : Math.max(0, score);
    }

    case "THRESHOLD": {
      if (!config || config.method !== "THRESHOLD") {
        // Fallback: treat 100% as threshold
        return rawPercent >= 100 ? 100 : 0;
      }
      const threshold = config.thresholdValue;
      return rawPercent >= threshold ? config.aboveScore : config.belowScore;
    }

    case "SLAB": {
      if (!config || config.method !== "SLAB" || config.slabs.length === 0) {
        // Fallback to linear
        return Math.min(100, Math.max(0, rawPercent));
      }
      // Find matching slab
      for (const slab of config.slabs) {
        if (rawPercent >= slab.minPercent && rawPercent <= slab.maxPercent) {
          return slab.score;
        }
      }
      // If above all slabs, return highest slab score. If below, return 0.
      const sorted = [...config.slabs].sort(
        (a, b) => a.minPercent - b.minPercent
      );
      if (rawPercent > sorted[sorted.length - 1].maxPercent) {
        return sorted[sorted.length - 1].score;
      }
      return 0;
    }

    default:
      return Math.min(100, Math.max(0, rawPercent));
  }
}

// ── Weighted Overall Score ───────────────────────────────────────────────────

/**
 * Compute the weighted overall score from individual KPI scores.
 * Each KPI's weightage is absolute (out of 100), so:
 * Overall = sum(kpiScore * kpiWeightage / 100)
 *
 * Example: KPI1 (weight=15, score=80) + KPI2 (weight=10, score=60)
 * = (80 * 15/100) + (60 * 10/100) = 12 + 6 = 18 out of 25 possible
 */
export function computeWeightedOverallScore(
  kpiScores: KpiScoreInput[]
): number {
  if (kpiScores.length === 0) return 0;
  return kpiScores.reduce((sum, kpi) => {
    return sum + (kpi.score * kpi.kpiWeightage) / 100;
  }, 0);
}

/**
 * Compute max possible score from the given KPI weightages.
 * If all KPIs score 100, this is the maximum overall score.
 */
export function computeMaxPossibleScore(
  kpiScores: KpiScoreInput[]
): number {
  return kpiScores.reduce((sum, kpi) => sum + kpi.kpiWeightage, 0);
}

/**
 * Compute overall score as a percentage of what's possible.
 * overall / maxPossible * 100
 */
export function computeOverallPercentage(
  kpiScores: KpiScoreInput[]
): number {
  const max = computeMaxPossibleScore(kpiScores);
  if (max === 0) return 0;
  const overall = computeWeightedOverallScore(kpiScores);
  return Math.round((overall / max) * 100 * 100) / 100; // 2 decimal places
}
