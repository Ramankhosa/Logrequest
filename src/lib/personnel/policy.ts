import type { Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { PersonnelActionResult } from "@/lib/personnel/shared";

// ── Schemas ──────────────────────────────────────────────────────────────────

const personnelPolicySchema = z.object({
  defaultNoticePeriodDays: z.number().int().min(0).max(365).optional(),
  allowResignationWithdrawal: z.boolean().optional(),
  withdrawalWindowDays: z.number().int().min(0).max(90).optional(),
  requireTransferApproval: z.boolean().optional(),
  requireLeaveApproval: z.boolean().optional(),
  allowMultiplePrimaryUnits: z.boolean().optional(),
  maxSecondaryUnits: z.number().int().min(0).max(50).optional(),
  autoDeactivateOnExit: z.boolean().optional(),
  requireHeadCoverageBeforeExit: z.boolean().optional(),
});

export type PersonnelPolicyInput = z.input<typeof personnelPolicySchema>;

const LEAVE_TYPE_KEY_RE = /^[A-Z0-9_]{2,50}$/;

const leaveTypeSchema = z.object({
  typeKey: z
    .string()
    .trim()
    .min(2)
    .max(50)
    .regex(LEAVE_TYPE_KEY_RE, "Key must be 2-50 uppercase letters, numbers, or underscores"),
  displayLabel: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
  maxDaysPerYear: z.number().int().min(1).max(365).nullable().optional(),
  requiresApproval: z.boolean().default(true),
  requiresActing: z.boolean().default(false),
  isPaid: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});

export type LeaveTypeInput = z.input<typeof leaveTypeSchema>;

const updateLeaveTypeSchema = z.object({
  displayLabel: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  maxDaysPerYear: z.number().int().min(1).max(365).nullable().optional(),
  requiresApproval: z.boolean().optional(),
  requiresActing: z.boolean().optional(),
  isPaid: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
});

export type UpdateLeaveTypeInput = z.input<typeof updateLeaveTypeSchema>;

// ── Helpers ──────────────────────────────────────────────────────────────────

function canManagePolicy(role: Role): boolean {
  return role === "TENANT_OWNER" || role === "TENANT_ADMIN";
}

// ── Personnel Policy CRUD ────────────────────────────────────────────────────

export async function getPersonnelPolicy(tenantId: string) {
  return prisma.tenantPersonnelPolicy.findUnique({ where: { tenantId } });
}

export async function upsertPersonnelPolicy(input: {
  tenantId: string;
  actorRole: Role;
  values: PersonnelPolicyInput;
}): Promise<PersonnelActionResult> {
  if (!canManagePolicy(input.actorRole)) {
    return { status: "error", message: "Permission denied." };
  }

  const parsed = personnelPolicySchema.safeParse(input.values);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  await prisma.tenantPersonnelPolicy.upsert({
    where: { tenantId: input.tenantId },
    create: { tenantId: input.tenantId, ...parsed.data },
    update: parsed.data,
  });

  return { status: "success", message: "Personnel policy updated." };
}

// ── Leave Type CRUD ──────────────────────────────────────────────────────────

export type LeaveTypeView = {
  id: string;
  typeKey: string;
  displayLabel: string;
  description: string | null;
  maxDaysPerYear: number | null;
  requiresApproval: boolean;
  requiresActing: boolean;
  isPaid: boolean;
  isActive: boolean;
  sortOrder: number;
  activeLeaveCount: number;
};

export async function listLeaveTypes(tenantId: string): Promise<LeaveTypeView[]> {
  const types = await prisma.leaveTypeDefinition.findMany({
    where: { tenantId },
    orderBy: [{ sortOrder: "asc" }, { displayLabel: "asc" }],
    include: {
      _count: {
        select: {
          leaveRecords: { where: { status: { in: ["SCHEDULED", "ACTIVE"] } } },
        },
      },
    },
  });

  return types.map((t) => ({
    id: t.id,
    typeKey: t.typeKey,
    displayLabel: t.displayLabel,
    description: t.description,
    maxDaysPerYear: t.maxDaysPerYear,
    requiresApproval: t.requiresApproval,
    requiresActing: t.requiresActing,
    isPaid: t.isPaid,
    isActive: t.isActive,
    sortOrder: t.sortOrder,
    activeLeaveCount: t._count.leaveRecords,
  }));
}

export async function createLeaveType(input: {
  tenantId: string;
  actorRole: Role;
  values: LeaveTypeInput;
}): Promise<PersonnelActionResult> {
  if (!canManagePolicy(input.actorRole)) {
    return { status: "error", message: "Permission denied." };
  }

  const parsed = leaveTypeSchema.safeParse(input.values);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const v = parsed.data;
  const normalizedKey = v.typeKey.toUpperCase();

  const existing = await prisma.leaveTypeDefinition.findUnique({
    where: { tenantId_typeKey: { tenantId: input.tenantId, typeKey: normalizedKey } },
  });
  if (existing) {
    return { status: "error", message: `Leave type "${normalizedKey}" already exists.` };
  }

  await prisma.leaveTypeDefinition.create({
    data: {
      tenantId: input.tenantId,
      typeKey: normalizedKey,
      displayLabel: v.displayLabel,
      description: v.description ?? null,
      maxDaysPerYear: v.maxDaysPerYear ?? null,
      requiresApproval: v.requiresApproval,
      requiresActing: v.requiresActing,
      isPaid: v.isPaid,
      sortOrder: v.sortOrder,
    },
  });

  return { status: "success", message: `Leave type "${v.displayLabel}" created.` };
}

export async function updateLeaveType(input: {
  tenantId: string;
  actorRole: Role;
  leaveTypeId: string;
  values: UpdateLeaveTypeInput;
}): Promise<PersonnelActionResult> {
  if (!canManagePolicy(input.actorRole)) {
    return { status: "error", message: "Permission denied." };
  }

  const parsed = updateLeaveTypeSchema.safeParse(input.values);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const existing = await prisma.leaveTypeDefinition.findFirst({
    where: { id: input.leaveTypeId, tenantId: input.tenantId },
  });
  if (!existing) {
    return { status: "error", message: "Leave type not found." };
  }

  // Guard: block deactivation if active/scheduled leaves exist
  if (parsed.data.isActive === false && existing.isActive) {
    const activeLeaves = await prisma.leaveRecord.count({
      where: {
        leaveTypeId: input.leaveTypeId,
        status: { in: ["SCHEDULED", "ACTIVE"] },
      },
    });
    if (activeLeaves > 0) {
      return {
        status: "error",
        message: `Cannot deactivate: ${activeLeaves} active/scheduled leave(s) use this type.`,
      };
    }
  }

  await prisma.leaveTypeDefinition.update({
    where: { id: input.leaveTypeId },
    data: parsed.data,
  });

  return { status: "success", message: "Leave type updated." };
}
