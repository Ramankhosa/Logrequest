import type {
  KpiAllocationType,
  TargetAllocationState,
  AssessmentPeriodState,
} from "@prisma/client";
import type { MyKpiContext } from "./shared";

type AllocationInfo = {
  assignedToUnitId: string | null;
  assignedToUserId: string | null;
  allocationType: KpiAllocationType;
  state: TargetAllocationState;
  childCount: number;
  parentAllocationId: string | null;
};

/**
 * Whether the current user can record an achievement for this allocation.
 *
 * Rules per SRS §3:
 * - DEPARTMENT→dept: head can record
 * - INDIVIDUAL→dept: head CANNOT record (must cascade first)
 * - BOTH→dept (no children): head can record (if choosing "keep at dept")
 * - BOTH→dept (after cascade): recording disabled at parent
 * - Individual allocation (userId set): that user records
 */
export function canRecord(
  alloc: AllocationInfo,
  ctx: MyKpiContext,
  periodState: AssessmentPeriodState,
): boolean {
  if (periodState !== "IN_PROGRESS" && periodState !== "UNDER_REVIEW") {
    return false;
  }

  const isUnitHead = alloc.assignedToUnitId
    ? ctx.headOfUnits.some((u) => u.unitId === alloc.assignedToUnitId)
    : false;

  if (alloc.assignedToUserId) {
    return alloc.assignedToUserId === ctx.userId;
  }

  if (!isUnitHead) return false;

  if (alloc.allocationType === "DEPARTMENT") return true;
  if (alloc.allocationType === "INDIVIDUAL") return false;
  // BOTH — can record only if no children yet
  return alloc.childCount === 0;
}

/**
 * Whether the dept head CAN cascade this allocation.
 *
 * Allowed when:
 * 1. User is head of the allocation's unit
 * 2. allocationType is INDIVIDUAL or BOTH
 * 3. State is ACTIVE (not LOCKED)
 */
export function canCascade(
  alloc: AllocationInfo,
  ctx: MyKpiContext,
): boolean {
  if (!alloc.assignedToUnitId) return false;
  if (alloc.state === "LOCKED") return false;
  if (alloc.allocationType === "DEPARTMENT") return false;

  return ctx.headOfUnits.some((u) => u.unitId === alloc.assignedToUnitId);
}

/**
 * Whether the dept head MUST cascade before anything else.
 * True for INDIVIDUAL type with no children.
 */
export function mustCascade(
  alloc: AllocationInfo,
  ctx: MyKpiContext,
): boolean {
  if (!alloc.assignedToUnitId) return false;
  if (alloc.allocationType !== "INDIVIDUAL") return false;
  if (alloc.childCount > 0) return false;

  return ctx.headOfUnits.some((u) => u.unitId === alloc.assignedToUnitId);
}

/**
 * Whether a BOTH-type allocation shows the choice UI
 * (record at dept vs distribute).
 */
export function showBothChoiceUI(
  alloc: AllocationInfo,
  ctx: MyKpiContext,
): boolean {
  if (!alloc.assignedToUnitId) return false;
  if (alloc.allocationType !== "BOTH") return false;
  if (alloc.state === "LOCKED") return false;
  if (alloc.childCount > 0) return false;

  return ctx.headOfUnits.some((u) => u.unitId === alloc.assignedToUnitId);
}

/**
 * Whether user can see the review queue (they head at least one unit).
 */
export function hasReviewRole(ctx: MyKpiContext): boolean {
  return ctx.headOfUnits.length > 0;
}
