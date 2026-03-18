import type { Role, AssessmentPeriodState } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type {
  KraKpiActionResult,
  AssessmentPeriodView,
  ComputedReviewCycle,
} from "./shared";
import { ASSESSMENT_PERIOD_TRANSITIONS } from "./shared";

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
  .refine((d) => d.endDate > d.startDate, {
    message: "End date must be after start date",
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
    _count: { kraDefinitions: number };
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
    createdAt: p!.createdAt,
  };
}

// ── List Periods ─────────────────────────────────────────────────────────────

export async function listPeriods(
  tenantId: string
): Promise<AssessmentPeriodView[]> {
  const periods = await prisma.assessmentPeriod.findMany({
    where: { tenantId },
    include: { _count: { select: { kraDefinitions: true } } },
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
    include: { _count: { select: { kraDefinitions: true } } },
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

  await prisma.$transaction(async (tx) => {
    await tx.assessmentPeriod.create({
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
        targetId: data.code,
        action: "CREATE",
        newState: { name: data.name, code: data.code, periodType: data.periodType },
      },
    });
  });

  return { status: "success", message: `Assessment period "${data.name}" created.` };
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
  if (effectiveEnd <= effectiveStart) {
    return { status: "error", message: "End date must be after start date." };
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

  const allowedNext = ASSESSMENT_PERIOD_TRANSITIONS[period.state];
  if (!allowedNext.includes(newState)) {
    return {
      status: "error",
      message: `Cannot transition from "${period.state}" to "${newState}". Allowed: ${allowedNext.join(", ") || "none"}.`,
    };
  }

  // Business rules for specific transitions
  if (newState === "OPEN") {
    // Validate KRA weightages sum to 100 before opening
    const kraSum = await prisma.kraDefinition.aggregate({
      where: { periodId, tenantId, state: { not: "ARCHIVED" } },
      _sum: { weightage: true },
    });
    // Allow opening even with 0 KRAs (they can be added while OPEN)
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
  const now = new Date();
  let current = new Date(startDate);
  let cycleNum = 1;

  while (current < endDate) {
    const cycleStart = new Date(current);
    let cycleEnd: Date;

    switch (frequency) {
      case "DAILY":
        cycleEnd = new Date(current);
        cycleEnd.setDate(cycleEnd.getDate() + 1);
        break;
      case "WEEKLY":
        cycleEnd = new Date(current);
        cycleEnd.setDate(cycleEnd.getDate() + 7);
        break;
      case "MONTHLY":
        cycleEnd = new Date(current);
        cycleEnd.setMonth(cycleEnd.getMonth() + 1);
        break;
      case "QUARTERLY":
        cycleEnd = new Date(current);
        cycleEnd.setMonth(cycleEnd.getMonth() + 3);
        break;
      case "HALF_YEARLY":
        cycleEnd = new Date(current);
        cycleEnd.setMonth(cycleEnd.getMonth() + 6);
        break;
      case "ANNUAL":
      default:
        cycleEnd = new Date(current);
        cycleEnd.setFullYear(cycleEnd.getFullYear() + 1);
        break;
    }

    // Cap at period end
    if (cycleEnd > endDate) {
      cycleEnd = new Date(endDate);
    }

    const isCurrent = now >= cycleStart && now < cycleEnd;

    cycles.push({
      cycleNumber: cycleNum,
      label: generateCycleLabel(frequency, cycleNum, cycleStart),
      startDate: cycleStart,
      endDate: cycleEnd,
      isCurrent,
    });

    current = cycleEnd;
    cycleNum++;

    // Safety: max 366 cycles (daily for a year)
    if (cycleNum > 366) break;
  }

  return cycles;
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
      return start.toLocaleDateString("en-US", { month: "short", year: "numeric" });
    case "QUARTERLY":
      return `Q${num}`;
    case "HALF_YEARLY":
      return `H${num}`;
    case "ANNUAL":
    default:
      return `Year ${num}`;
  }
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
