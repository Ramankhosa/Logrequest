import { Prisma, type Role, type AssessmentPeriodState } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  createBulkNotifications,
  resolveAllocateeUserId,
} from "@/lib/notifications/notification-service";
import type {
  KraKpiActionResult,
  AssessmentPeriodView,
  ComputedReviewCycle,
  StoredReviewCycleView,
} from "./shared";

// ── Constants ────────────────────────────────────────────────────────────────

const tenantOwnerRole = "TENANT_OWNER" satisfies Role;
const tenantAdminRole = "TENANT_ADMIN" satisfies Role;

// ── Schemas ──────────────────────────────────────────────────────────────────

const createPeriodSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    code: z
      .string()
      .trim()
      .min(2)
      .max(30)
      .regex(/^[A-Za-z0-9_-]+$/, "Code must be alphanumeric with dashes or underscores"),
    periodType: z.enum(["CALENDAR_YEAR", "FINANCIAL_YEAR", "SPECIFIC_RANGE"]),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    reviewFrequency: z
      .enum(["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "HALF_YEARLY", "ANNUAL"])
      .default("ANNUAL"),
    targetSettingDeadline: z.coerce.date().optional(),
    achievementDeadline: z.coerce.date().optional(),
    reviewDeadline: z.coerce.date().optional(),
    description: z.string().trim().max(500).optional(),
  })
  .refine((d) => d.endDate >= d.startDate, {
    message: "End date must be on or after start date",
    path: ["endDate"],
  });

const updatePeriodSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  periodType: z.enum(["CALENDAR_YEAR", "FINANCIAL_YEAR", "SPECIFIC_RANGE"]).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  reviewFrequency: z
    .enum(["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "HALF_YEARLY", "ANNUAL"])
    .optional(),
  targetSettingDeadline: z.coerce.date().nullable().optional(),
  achievementDeadline: z.coerce.date().nullable().optional(),
  reviewDeadline: z.coerce.date().nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(),
});

export type CreatePeriodInput = z.input<typeof createPeriodSchema>;
export type UpdatePeriodInput = z.input<typeof updatePeriodSchema>;

// ── Helpers ──────────────────────────────────────────────────────────────────

function isAdminOrOwner(role: Role): boolean {
  return (
    role === tenantOwnerRole ||
    role === tenantAdminRole ||
    role === "SUPERADMIN"
  );
}

function mapPeriodView(
  p: Awaited<ReturnType<typeof prisma.assessmentPeriod.findFirst>> & {
    _count: { kraDefinitions: number; reviewCycles: number };
  }
): AssessmentPeriodView {
  return {
    id: p!.id,
    tenantId: p!.tenantId,
    name: p!.name,
    code: p!.code,
    periodType: p!.periodType,
    startDate: p!.startDate,
    endDate: p!.endDate,
    state: p!.state,
    reviewFrequency: p!.reviewFrequency,
    targetSettingDeadline: p!.targetSettingDeadline,
    achievementDeadline: p!.achievementDeadline,
    reviewDeadline: p!.reviewDeadline,
    description: p!.description,
    kraCount: p!._count.kraDefinitions,
    reviewCycleCount: p!._count.reviewCycles,
    createdAt: p!.createdAt,
  };
}

// ── List Periods ─────────────────────────────────────────────────────────────

export async function listPeriods(
  tenantId: string
): Promise<AssessmentPeriodView[]> {
  const periods = await prisma.assessmentPeriod.findMany({
    where: { tenantId },
    include: { _count: { select: { kraDefinitions: true, reviewCycles: true } } },
    orderBy: [{ startDate: "desc" }],
  });

  return periods.map((p) => mapPeriodView(p));
}

// ── Get Period ───────────────────────────────────────────────────────────────

export async function getPeriod(
  periodId: string,
  tenantId: string
): Promise<AssessmentPeriodView | null> {
  const period = await prisma.assessmentPeriod.findFirst({
    where: { id: periodId, tenantId },
    include: { _count: { select: { kraDefinitions: true, reviewCycles: true } } },
  });
  if (!period) return null;
  return mapPeriodView(period);
}

// ── Create Period ────────────────────────────────────────────────────────────

export async function createPeriod(
  tenantId: string,
  input: CreatePeriodInput,
  actorUserId: string,
  actorRole: Role
): Promise<KraKpiActionResult> {
  if (!isAdminOrOwner(actorRole)) {
    return { status: "error", message: "Insufficient permissions to create assessment periods." };
  }

  const parsed = createPeriodSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;

  // Check duplicate code
  const existing = await prisma.assessmentPeriod.findUnique({
    where: { tenantId_code: { tenantId, code: data.code } },
  });
  if (existing) {
    return { status: "error", message: `Period code "${data.code}" already exists.` };
  }

  const created = await prisma.$transaction(async (tx) => {
    const period = await tx.assessmentPeriod.create({
      data: {
        tenantId,
        name: data.name,
        code: data.code,
        periodType: data.periodType,
        startDate: data.startDate,
        endDate: data.endDate,
        reviewFrequency: data.reviewFrequency,
        targetSettingDeadline: data.targetSettingDeadline,
        achievementDeadline: data.achievementDeadline,
        reviewDeadline: data.reviewDeadline,
        description: data.description,
        createdByUserId: actorUserId,
      },
    });

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "AssessmentPeriod",
        targetId: period.id,
        action: "CREATE",
        newState: { name: data.name, code: data.code, periodType: data.periodType },
      },
    });

    return period;
  });

  return {
    status: "success",
    message: `Assessment period "${data.name}" created.`,
    id: created.id,
    code: created.code,
  };
}

// ── Update Period ────────────────────────────────────────────────────────────

export async function updatePeriod(
  periodId: string,
  tenantId: string,
  input: UpdatePeriodInput,
  actorUserId: string,
  actorRole: Role
): Promise<KraKpiActionResult> {
  if (!isAdminOrOwner(actorRole)) {
    return { status: "error", message: "Insufficient permissions to update assessment periods." };
  }

  const parsed = updatePeriodSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;

  const period = await prisma.assessmentPeriod.findFirst({
    where: { id: periodId, tenantId },
  });
  if (!period) {
    return { status: "error", message: "Assessment period not found." };
  }

  // Only allow edits in DRAFT or OPEN state
  if (period.state !== "DRAFT" && period.state !== "OPEN") {
    return {
      status: "error",
      message: `Cannot edit period in "${period.state}" state. Only DRAFT and OPEN periods can be modified.`,
    };
  }

  // Validate dates if both provided
  const effectiveStart = data.startDate ?? period.startDate;
  const effectiveEnd = data.endDate ?? period.endDate;
  if (effectiveEnd < effectiveStart) {
    return {
      status: "error",
      code: "INVALID_DATE_RANGE",
      message: "End date must be on or after start date.",
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.assessmentPeriod.update({
      where: { id: periodId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.periodType !== undefined && { periodType: data.periodType }),
        ...(data.startDate !== undefined && { startDate: data.startDate }),
        ...(data.endDate !== undefined && { endDate: data.endDate }),
        ...(data.reviewFrequency !== undefined && { reviewFrequency: data.reviewFrequency }),
        ...(data.targetSettingDeadline !== undefined && {
          targetSettingDeadline: data.targetSettingDeadline,
        }),
        ...(data.achievementDeadline !== undefined && {
          achievementDeadline: data.achievementDeadline,
        }),
        ...(data.reviewDeadline !== undefined && { reviewDeadline: data.reviewDeadline }),
        ...(data.description !== undefined && { description: data.description }),
      },
    });

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "AssessmentPeriod",
        targetId: periodId,
        action: "UPDATE",
        previousState: { name: period.name, state: period.state },
        newState: data as object,
      },
    });
  });

  return { status: "success", message: "Assessment period updated." };
}

// ── Transition State ─────────────────────────────────────────────────────────

export async function transitionPeriodState(
  periodId: string,
  tenantId: string,
  newState: AssessmentPeriodState,
  actorUserId: string,
  actorRole: Role
): Promise<KraKpiActionResult> {
  if (!isAdminOrOwner(actorRole)) {
    return { status: "error", message: "Insufficient permissions to change period state." };
  }

  const period = await prisma.assessmentPeriod.findFirst({
    where: { id: periodId, tenantId },
  });
  if (!period) {
    return { status: "error", message: "Assessment period not found." };
  }

  if (newState === period.state) {
    return {
      status: "error",
      message: `Period is already in "${newState}" state.`,
    };
  }

  // Admins can explicitly move periods between stages from the UI.
  if (newState === "OPEN") {
    // Allow reopening even with 0 KRAs so setup can continue.
  }

  await prisma.$transaction(async (tx) => {
    await tx.assessmentPeriod.update({
      where: { id: periodId },
      data: { state: newState },
    });

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "AssessmentPeriod",
        targetId: periodId,
        action: "STATE_TRANSITION",
        previousState: { state: period.state },
        newState: { state: newState },
      },
    });
  });

  if (newState === "IN_PROGRESS") {
    try {
      await generateReviewCycles(periodId, tenantId, actorUserId, actorRole);
    } catch (err) {
      console.warn("[period-service] Auto-generate review cycles failed:", err);
    }
  }

  try {
    const allocations = await prisma.targetAllocation.findMany({
      where: { tenantId, periodId },
      select: {
        assignedToUserId: true,
        assignedToUnitId: true,
      },
    });

    const recipientIds = new Set<string>();
    for (const allocation of allocations) {
      const recipientId = await resolveAllocateeUserId(tenantId, allocation);
      if (recipientId && recipientId !== actorUserId) {
        recipientIds.add(recipientId);
      }
    }

    if (recipientIds.size > 0) {
      await createBulkNotifications(
        tenantId,
        [...recipientIds],
        "PERIOD_STATE_CHANGED",
        undefined,
        "Assessment period state changed",
        `Assessment period '${period.name}' is now ${newState}.`,
        "AssessmentPeriod",
        periodId,
        "/my-kpis",
      );
    }
  } catch (err) {
    console.warn("[period-service] transitionPeriodState notification failed:", err);
  }

  return { status: "success", message: `Period transitioned to "${newState}".` };
}

// ── Compute Review Cycles ────────────────────────────────────────────────────

/**
 * Compute review cycles from period dates + frequency.
 * No DB table in R1 — this is a pure computation.
 */
export function computeReviewCycles(
  startDate: Date,
  endDate: Date,
  frequency: string
): ComputedReviewCycle[] {
  const cycles: ComputedReviewCycle[] = [];
  const now = normalizeUtcDate(new Date());
  const normalizedStart = normalizeUtcDate(startDate);
  const normalizedEnd = normalizeUtcDate(endDate);
  let current = normalizedStart;
  let cycleNum = 1;

  while (current.getTime() <= normalizedEnd.getTime()) {
    const cycleStart = current;
    const nextCycleStart = advanceCycleStart(current, frequency);
    const cycleEnd = minUtcDate(addUtcDays(nextCycleStart, -1), normalizedEnd);
    const isCurrent = isDateWithinInclusiveUtcRange(now, cycleStart, cycleEnd);

    cycles.push({
      cycleNumber: cycleNum,
      label: generateCycleLabel(frequency, cycleNum, cycleStart),
      startDate: cycleStart,
      endDate: cycleEnd,
      isCurrent,
    });

    current = addUtcDays(cycleEnd, 1);
    cycleNum++;

    // Safety: max 366 cycles (daily for a leap year)
    if (cycleNum > 367) break;
  }

  return cycles;
}

export function normalizeUtcDate(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function isDateWithinInclusiveUtcRange(
  date: Date,
  start: Date,
  end: Date,
): boolean {
  const ts = normalizeUtcDate(date).getTime();
  return ts >= normalizeUtcDate(start).getTime() && ts <= normalizeUtcDate(end).getTime();
}

function addUtcDays(date: Date, days: number): Date {
  const result = normalizeUtcDate(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function addUtcMonths(date: Date, months: number): Date {
  const normalized = normalizeUtcDate(date);
  const desiredDay = normalized.getUTCDate();
  const firstOfTargetMonth = new Date(
    Date.UTC(normalized.getUTCFullYear(), normalized.getUTCMonth() + months, 1),
  );
  const lastDayOfTargetMonth = new Date(
    Date.UTC(
      firstOfTargetMonth.getUTCFullYear(),
      firstOfTargetMonth.getUTCMonth() + 1,
      0,
    ),
  ).getUTCDate();

  return new Date(
    Date.UTC(
      firstOfTargetMonth.getUTCFullYear(),
      firstOfTargetMonth.getUTCMonth(),
      Math.min(desiredDay, lastDayOfTargetMonth),
    ),
  );
}

function advanceCycleStart(current: Date, frequency: string): Date {
  switch (frequency) {
    case "DAILY":
      return addUtcDays(current, 1);
    case "WEEKLY":
      return addUtcDays(current, 7);
    case "MONTHLY":
      return addUtcMonths(current, 1);
    case "QUARTERLY":
      return addUtcMonths(current, 3);
    case "HALF_YEARLY":
      return addUtcMonths(current, 6);
    case "ANNUAL":
    default:
      return addUtcMonths(current, 12);
  }
}

function minUtcDate(left: Date, right: Date): Date {
  return left.getTime() <= right.getTime() ? left : right;
}

function generateCycleLabel(
  frequency: string,
  num: number,
  start: Date
): string {
  switch (frequency) {
    case "DAILY":
      return start.toISOString().slice(0, 10);
    case "WEEKLY":
      return `Week ${num}`;
    case "MONTHLY":
      return start.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
    case "QUARTERLY":
      return `Q${num}`;
    case "HALF_YEARLY":
      return `H${num}`;
    case "ANNUAL":
    default:
      return `Year ${num}`;
  }
}

// ── Stored Review Cycles (R2) ────────────────────────────────────────────────

export async function generateReviewCycles(
  periodId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role
): Promise<KraKpiActionResult & { data?: StoredReviewCycleView[] }> {
  if (!isAdminOrOwner(actorRole)) {
    return { status: "error", code: "PERMISSION_DENIED", message: "Insufficient permissions." };
  }

  const period = await prisma.assessmentPeriod.findFirst({
    where: { id: periodId, tenantId },
  });
  if (!period) {
    return { status: "error", code: "PERIOD_NOT_FOUND", message: "Assessment period not found." };
  }

  const computed = computeReviewCycles(
    period.startDate,
    period.endDate,
    period.reviewFrequency
  );

  if (computed.length === 0) {
    return {
      status: "error",
      code: "INVALID_DATE_RANGE",
      message: "No review cycles could be generated for this period's date range and frequency.",
    };
  }

  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      await tx.reviewCycle.deleteMany({ where: { periodId } });

      const cycles = [];
      for (const c of computed) {
        const cycle = await tx.reviewCycle.create({
          data: {
            periodId,
            cycleNumber: c.cycleNumber,
            label: c.label,
            startDate: c.startDate,
            endDate: c.endDate,
            isCurrent: c.isCurrent,
          },
        });
        cycles.push(cycle);
      }

      await tx.auditLog.create({
        data: {
          tenantId,
          actorUserId,
          actorRole,
          targetType: "ReviewCycle",
          targetId: periodId,
          action: "GENERATE",
          metadata: { cycleCount: cycles.length, frequency: period.reviewFrequency },
        },
      });

      return cycles;
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2002" || error.code === "P2034")
    ) {
      return {
        status: "error",
        code: "REVIEW_CYCLE_CONFLICT",
        message: "Review cycles were regenerated concurrently. Refresh and try again.",
      };
    }

    throw error;
  }

  return {
    status: "success",
    message: `${created.length} review cycle(s) generated.`,
    data: created.map((c) => ({
      id: c.id,
      periodId: c.periodId,
      cycleNumber: c.cycleNumber,
      label: c.label,
      startDate: c.startDate,
      endDate: c.endDate,
      reviewDeadline: c.reviewDeadline,
      isCurrent: c.isCurrent,
      createdAt: c.createdAt,
    })),
  };
}

export async function listReviewCycles(
  periodId: string,
  tenantId: string
): Promise<StoredReviewCycleView[]> {
  const period = await prisma.assessmentPeriod.findFirst({
    where: { id: periodId, tenantId },
    select: { id: true },
  });
  if (!period) return [];

  const cycles = await prisma.reviewCycle.findMany({
    where: { periodId },
    orderBy: { cycleNumber: "asc" },
  });

  return cycles.map((c) => ({
    id: c.id,
    periodId: c.periodId,
    cycleNumber: c.cycleNumber,
    label: c.label,
    startDate: c.startDate,
    endDate: c.endDate,
    reviewDeadline: c.reviewDeadline,
    isCurrent: c.isCurrent,
    createdAt: c.createdAt,
  }));
}

export async function updateCurrentCycle(
  periodId: string,
  tenantId: string
): Promise<KraKpiActionResult> {
  const period = await prisma.assessmentPeriod.findFirst({
    where: { id: periodId, tenantId },
    select: { id: true },
  });
  if (!period) {
    return { status: "error", code: "PERIOD_NOT_FOUND", message: "Period not found." };
  }

  const now = new Date();
  const cycles = await prisma.reviewCycle.findMany({
    where: { periodId },
    orderBy: { cycleNumber: "asc" },
  });

  await prisma.$transaction(async (tx) => {
    for (const cycle of cycles) {
      const shouldBeCurrent = isDateWithinInclusiveUtcRange(now, cycle.startDate, cycle.endDate);
      if (cycle.isCurrent !== shouldBeCurrent) {
        await tx.reviewCycle.update({
          where: { id: cycle.id },
          data: { isCurrent: shouldBeCurrent },
        });
      }
    }
  });

  return { status: "success", message: "Current cycle updated." };
}

// ── Auto-Lock Targets ────────────────────────────────────────────────────────

/**
 * Bulk-lock all ACTIVE targets for a period when transitioning to IN_PROGRESS.
 */
export async function bulkLockTargets(
  periodId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role
): Promise<KraKpiActionResult> {
  if (!isAdminOrOwner(actorRole)) {
    return { status: "error", message: "Insufficient permissions." };
  }

  const result = await prisma.targetAllocation.updateMany({
    where: { periodId, tenantId, state: "ACTIVE" },
    data: { state: "LOCKED", lockedAt: new Date() },
  });

  await prisma.auditLog.create({
    data: {
      tenantId,
      actorUserId,
      actorRole,
      targetType: "TargetAllocation",
      targetId: periodId,
      action: "BULK_LOCK",
      metadata: { count: result.count },
    },
  });

  return {
    status: "success",
    message: `${result.count} target(s) locked for period.`,
  };
}
