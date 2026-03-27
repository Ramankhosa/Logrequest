import type { KpiMeasurementType } from "@prisma/client";

type TargetLike = {
  targetValue: number | null;
  targetDate: Date | null;
  targetMilestone: string | null;
  targetGrade: string | null;
  targetBoolean: boolean | null;
  targetRating: number | null;
};

type ActualLike = {
  actualValue: number | null;
  actualDate: Date | null;
  actualMilestone: string | null;
  actualGrade: string | null;
  actualBoolean: boolean | null;
  actualRating: number | null;
};

function formatDate(value: Date | null) {
  if (!value) return "--";
  return value.toISOString().slice(0, 10);
}

function formatNumber(
  value: number,
  measurementType: KpiMeasurementType,
  unitLabel?: string | null,
) {
  const formatter = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  });

  if (measurementType === "PERCENTAGE") {
    return `${formatter.format(value)}%`;
  }

  if (measurementType === "CURRENCY") {
    return unitLabel ? `${unitLabel} ${formatter.format(value)}` : formatter.format(value);
  }

  return unitLabel ? `${formatter.format(value)} ${unitLabel}` : formatter.format(value);
}

export function formatTargetDisplay(
  measurementType: KpiMeasurementType,
  target: TargetLike,
  unitLabel?: string | null,
) {
  switch (measurementType) {
    case "DATE_TARGET":
      return formatDate(target.targetDate);
    case "MILESTONE":
      return target.targetMilestone ?? "--";
    case "GRADE":
      return target.targetGrade ?? "--";
    case "BOOLEAN":
      return target.targetBoolean == null ? "--" : target.targetBoolean ? "Yes" : "No";
    case "RATING":
      return target.targetRating == null ? "--" : String(target.targetRating);
    case "NUMERIC":
    case "PERCENTAGE":
    case "CURRENCY":
    default:
      return target.targetValue == null
        ? "--"
        : formatNumber(target.targetValue, measurementType, unitLabel);
  }
}

export function formatActualDisplay(
  measurementType: KpiMeasurementType,
  actual: ActualLike,
  unitLabel?: string | null,
) {
  switch (measurementType) {
    case "DATE_TARGET":
      return formatDate(actual.actualDate);
    case "MILESTONE":
      return actual.actualMilestone ?? "--";
    case "GRADE":
      return actual.actualGrade ?? "--";
    case "BOOLEAN":
      return actual.actualBoolean == null ? "--" : actual.actualBoolean ? "Yes" : "No";
    case "RATING":
      return actual.actualRating == null ? "--" : String(actual.actualRating);
    case "NUMERIC":
    case "PERCENTAGE":
    case "CURRENCY":
    default:
      return actual.actualValue == null
        ? "--"
        : formatNumber(actual.actualValue, measurementType, unitLabel);
  }
}
