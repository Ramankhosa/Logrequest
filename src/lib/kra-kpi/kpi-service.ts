import type { Role, KpiDefinitionState } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type {
  KraKpiActionResult,
  KpiDefinitionView,
  KpiTargetUnitView,
  AchievementFormConfig,
  MeasurementConfig,
  ContributionRoleDefinition,
} from "./shared";
import {
  measurementConfigSchema,
  scoringConfigSchema,
  achievementFormConfigSchema,
  getMeasurementCapValue,
} from "./shared";
import { ensureApplicableRolesBaseline } from "./contributor-role-service";

// ── Constants ────────────────────────────────────────────────────────────────

const tenantOwnerRole = "TENANT_OWNER" satisfies Role;
const tenantAdminRole = "TENANT_ADMIN" satisfies Role;

const contributionRoleEntrySchema = z.object({
  role: z.string().trim().min(1).max(100),
  creditPercent: z.number().min(1).max(100),
  isDefault: z.boolean(),
});

export function validateContributionRolesJson(value: unknown): string | null {
  if (value == null) return null;
  const arr = contributionRoleEntrySchema.array().safeParse(value);
  if (!arr.success) {
    return arr.error.issues[0]?.message ?? "Invalid contribution roles.";
  }
  const roles = arr.data;
  const names = new Set<string>();
  let defaultCount = 0;
  for (const r of roles) {
    const key = r.role.toLowerCase();
    if (names.has(key)) {
      return "Duplicate contribution role names are not allowed.";
    }
    names.add(key);
    if (r.isDefault) defaultCount++;
  }
  if (defaultCount > 1) {
    return "At most one contribution role can be marked as default.";
  }
  return null;
}

export function parseContributionRoles(
  value: unknown,
): ContributionRoleDefinition[] | null {
  if (value == null) return null;
  const parsed = contributionRoleEntrySchema.array().safeParse(value);
  if (!parsed.success || parsed.data.length === 0) return null;
  return parsed.data;
}

export function lookupContributionCreditPercent(
  contributionRoles: unknown,
  roleName: string,
): number | null {
  const parsed = contributionRoleEntrySchema.array().safeParse(contributionRoles);
  if (!parsed.success) return null;
  const r = parsed.data.find((x) => x.role === roleName);
  return r?.creditPercent ?? null;
}

// ── Schemas ──────────────────────────────────────────────────────────────────

const createKpiSchema = z.object({
  kraDefinitionId: z.string().trim().min(1, "Select a KRA before creating a KPI."),
  title: z.string().trim().min(2, "KPI title must be at least 2 characters.").max(200),
  description: z.string().trim().max(1000).optional(),
  measurementType: z.enum([
    "NUMERIC",
    "PERCENTAGE",
    "CURRENCY",
    "BOOLEAN",
    "RATING",
    "MILESTONE",
    "DATE_TARGET",
    "GRADE",
  ]),
  unitLabel: z.string().trim().max(30).optional(),
  weightage: z.number().int().min(0).max(100).default(0),
  defaultTarget: z.number().optional(),
  measurementConfig: measurementConfigSchema.optional(),
  scoringMethod: z.enum(["LINEAR", "THRESHOLD", "SLAB"]).default("LINEAR"),
  scoringDirection: z.enum(["ASCENDING", "DESCENDING"]).default("ASCENDING"),
  scoringConfig: scoringConfigSchema.optional(),
  isPerCapita: z.boolean().default(false),
  allocationType: z.enum(["DEPARTMENT", "INDIVIDUAL", "BOTH"]).default("BOTH"),
  startingUnitId: z.string().trim().min(1, "Select a starting unit."),
  achievementTemplateKey: z.string().trim().max(50).optional(),
  achievementFormConfig: achievementFormConfigSchema.optional(),
  guidanceNotes: z.string().trim().max(2000).optional(),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  // R2 fields
  keyUnitId: z.string().trim().min(1).optional(),
  finalUnitId: z.string().trim().min(1).optional(),
  sopDescription: z.string().trim().max(5000).optional(),
  evidenceRequired: z.boolean().default(true),
  evidenceTypes: z.array(z.enum([
    "DOCUMENT", "URL", "CERTIFICATE", "SELF_DECLARATION", "SYSTEM_GENERATED", "NONE"
  ])).default([]),
  evidenceInstructions: z.string().trim().max(2000).optional(),
  isTeamKpi: z.boolean().default(false),
  teamCreditMethod: z.enum(["FULL_EACH", "EQUAL_SPLIT", "WEIGHTED_SPLIT", "PRIMARY_ONLY"]).default("FULL_EACH"),
  allowPartialCompletion: z.boolean().default(true),
  contributionRoles: z.array(contributionRoleEntrySchema).optional(),
});

const updateKpiSchema = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  measurementType: z
    .enum([
      "NUMERIC",
      "PERCENTAGE",
      "CURRENCY",
      "BOOLEAN",
      "RATING",
      "MILESTONE",
      "DATE_TARGET",
      "GRADE",
    ])
    .optional(),
  unitLabel: z.string().trim().max(30).nullable().optional(),
  weightage: z.number().int().min(0).max(100).optional(),
  defaultTarget: z.number().nullable().optional(),
  measurementConfig: measurementConfigSchema.nullable().optional(),
  scoringMethod: z.enum(["LINEAR", "THRESHOLD", "SLAB"]).optional(),
  scoringDirection: z.enum(["ASCENDING", "DESCENDING"]).optional(),
  scoringConfig: scoringConfigSchema.nullable().optional(),
  isPerCapita: z.boolean().optional(),
  allocationType: z.enum(["DEPARTMENT", "INDIVIDUAL", "BOTH"]).optional(),
  startingUnitId: z.string().trim().min(1, "Select a starting unit.").optional(),
  achievementTemplateKey: z.string().trim().max(50).nullable().optional(),
  achievementFormConfig: achievementFormConfigSchema.nullable().optional(),
  guidanceNotes: z.string().trim().max(2000).nullable().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  // R2 fields
  keyUnitId: z.string().trim().min(1).nullable().optional(),
  finalUnitId: z.string().trim().min(1).nullable().optional(),
  sopDescription: z.string().trim().max(5000).nullable().optional(),
  evidenceRequired: z.boolean().optional(),
  evidenceTypes: z.array(z.enum([
    "DOCUMENT", "URL", "CERTIFICATE", "SELF_DECLARATION", "SYSTEM_GENERATED", "NONE"
  ])).optional(),
  evidenceInstructions: z.string().trim().max(2000).nullable().optional(),
  isTeamKpi: z.boolean().optional(),
  teamCreditMethod: z.enum(["FULL_EACH", "EQUAL_SPLIT", "WEIGHTED_SPLIT", "PRIMARY_ONLY"]).optional(),
  allowPartialCompletion: z.boolean().optional(),
  contributionRoles: z.array(contributionRoleEntrySchema).nullable().optional(),
});

const changeKpiStateSchema = z.object({
  state: z.enum(["DRAFT", "ACTIVE"]),
});

export type CreateKpiInput = z.input<typeof createKpiSchema>;
export type UpdateKpiInput = z.input<typeof updateKpiSchema>;
export type ChangeKpiStateInput = z.input<typeof changeKpiStateSchema>;

// ── Helpers ──────────────────────────────────────────────────────────────────

function isAdminOrOwner(role: Role): boolean {
  return (
    role === tenantOwnerRole ||
    role === tenantAdminRole ||
    role === "SUPERADMIN"
  );
}

function canModifyKpiInPeriodState(state: string): boolean {
  return state === "DRAFT" || state === "OPEN" || state === "UNDER_REVIEW";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapKpiView(k: any): KpiDefinitionView {
  return {
    id: k.id,
    kraDefinitionId: k.kraDefinitionId,
    kraTitle: k.kraDefinition.title,
    kraState: k.kraDefinition.state,
    title: k.title,
    description: k.description,
    measurementType: k.measurementType,
    unitLabel: k.unitLabel,
    weightage: k.weightage,
    defaultTarget: k.defaultTarget,
    measurementConfig: k.measurementConfig as KpiDefinitionView["measurementConfig"],
    scoringMethod: k.scoringMethod,
    scoringDirection: k.scoringDirection,
    scoringConfig: k.scoringConfig as KpiDefinitionView["scoringConfig"],
    isPerCapita: k.isPerCapita,
    allocationType: k.allocationType,
    startingUnitId: k.startingUnitId,
    startingUnitName: k.startingUnit.name,
    achievementTemplateKey: k.achievementTemplateKey,
    achievementFormConfig: k.achievementFormConfig as AchievementFormConfig | null,
    state: k.state,
    sortOrder: k.sortOrder,
    guidanceNotes: k.guidanceNotes,
    allocationCount: k._count.targetAllocations,
    keyUnitId: k.keyUnitId,
    keyUnitName: k.keyUnit?.name ?? null,
    finalUnitId: k.finalUnitId,
    finalUnitName: k.finalUnit?.name ?? null,
    targetUnitCount: k._count.targetUnits,
    evidenceRequired: k.evidenceRequired,
    evidenceTypes: k.evidenceTypes,
    evidenceInstructions: k.evidenceInstructions,
    sopDescription: k.sopDescription,
    isTeamKpi: k.isTeamKpi,
    teamCreditMethod: k.teamCreditMethod,
    allowPartialCompletion: k.allowPartialCompletion ?? true,
    contributionRoles: parseContributionRoles(k.contributionRoles),
    createdAt: k.createdAt,
  };
}

function validateMeasurementSettings(
  measurementType: string,
  measurementConfig: MeasurementConfig | null | undefined,
  defaultTarget: number | null | undefined,
): string | null {
  if (!measurementConfig) {
    return null;
  }

  if (measurementConfig.type !== measurementType) {
    return `Measurement config type "${measurementConfig.type}" does not match measurement type "${measurementType}".`;
  }

  switch (measurementConfig.type) {
    case "NUMERIC":
    case "PERCENTAGE":
    case "CURRENCY":
      if (
        measurementConfig.minValue != null &&
        measurementConfig.maxValue != null &&
        measurementConfig.maxValue < measurementConfig.minValue
      ) {
        return "Maximum cap cannot be lower than the configured minimum value.";
      }
      break;
    case "RATING":
      if (measurementConfig.maxRating < measurementConfig.minRating) {
        return "Maximum rating cap cannot be lower than the minimum rating.";
      }
      break;
    default:
      break;
  }

  const capValue = getMeasurementCapValue(measurementType, measurementConfig);
  if (capValue != null) {
    if (capValue < 0) {
      return "Maximum cap must be zero or greater.";
    }
    if (
      defaultTarget != null &&
      (measurementType === "NUMERIC" ||
        measurementType === "PERCENTAGE" ||
        measurementType === "CURRENCY") &&
      defaultTarget > capValue
    ) {
      return "Default target cannot exceed the configured maximum cap.";
    }
  }

  return null;
}

// ── List KPIs ────────────────────────────────────────────────────────────────

export async function listKpis(
  tenantId: string,
  kraDefinitionId?: string
): Promise<KpiDefinitionView[]> {
  const kpis = await prisma.kpiDefinition.findMany({
    where: {
      kraDefinition: { tenantId },
      ...(kraDefinitionId && { kraDefinitionId }),
    },
    include: {
      kraDefinition: { select: { title: true, tenantId: true, state: true } },
      startingUnit: { select: { name: true } },
      keyUnit: { select: { name: true } },
      finalUnit: { select: { name: true } },
      _count: { select: { targetAllocations: true, targetUnits: true } },
    },
    orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
  });

  return kpis.map((k) => mapKpiView(k));
}

// ── Get KPI ──────────────────────────────────────────────────────────────────

export async function getKpi(
  kpiId: string,
  tenantId: string
): Promise<KpiDefinitionView | null> {
  const k = await prisma.kpiDefinition.findFirst({
    where: { id: kpiId, kraDefinition: { tenantId } },
    include: {
      kraDefinition: { select: { title: true, tenantId: true, state: true } },
      startingUnit: { select: { name: true } },
      keyUnit: { select: { name: true } },
      finalUnit: { select: { name: true } },
      _count: { select: { targetAllocations: true, targetUnits: true } },
    },
  });
  if (!k) return null;

  return mapKpiView(k);
}

// ── Create KPI ───────────────────────────────────────────────────────────────

export async function createKpi(
  tenantId: string,
  input: CreateKpiInput,
  actorUserId: string,
  actorRole: Role
): Promise<KraKpiActionResult> {
  if (!isAdminOrOwner(actorRole)) {
    return { status: "error", message: "Insufficient permissions to create KPIs." };
  }

  const parsed = createKpiSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;

  // Verify KRA exists and belongs to tenant
  const kra = await prisma.kraDefinition.findFirst({
    where: { id: data.kraDefinitionId, tenantId },
    include: {
      period: { select: { state: true } },
      kpiDefinitions: {
        where: { state: { not: "ARCHIVED" } },
        select: { weightage: true },
      },
    },
  });
  if (!kra) {
    return { status: "error", message: "KRA not found." };
  }

  // Period must be editable
  if (!canModifyKpiInPeriodState(kra.period.state)) {
    return {
      status: "error",
      message: `Cannot add KPIs — period is in "${kra.period.state}" state.`,
    };
  }

  // KRA must not be archived
  if (kra.state === "ARCHIVED") {
    return { status: "error", message: "Cannot add KPIs to an archived KRA." };
  }

  // Verify starting unit exists
  const unit = await prisma.orgUnit.findFirst({
    where: { id: data.startingUnitId, tenantId },
  });
  if (!unit) {
    return { status: "error", message: "Starting unit not found." };
  }

  // Check KPI weightage sum won't exceed KRA's weightage
  const currentKpiSum = kra.kpiDefinitions.reduce((s, k) => s + k.weightage, 0);
  if (currentKpiSum + data.weightage > kra.weightage) {
    return {
      status: "error",
      message: `Adding weightage ${data.weightage} would exceed KRA weightage (${kra.weightage}). Current KPI sum: ${currentKpiSum}, remaining: ${kra.weightage - currentKpiSum}.`,
    };
  }

  const measurementSettingsError = validateMeasurementSettings(
    data.measurementType,
    data.measurementConfig as MeasurementConfig | undefined,
    data.defaultTarget,
  );
  if (measurementSettingsError) {
    return {
      status: "error",
      message: measurementSettingsError,
    };
  }

  // Validate scoringConfig matches scoringMethod
  if (data.scoringConfig) {
    if (data.scoringConfig.method !== data.scoringMethod) {
      return {
        status: "error",
        message: `Scoring config method "${data.scoringConfig.method}" does not match scoring method "${data.scoringMethod}".`,
      };
    }
  }

  // Validate R2 unit references
  if (data.keyUnitId) {
    const keyUnit = await prisma.orgUnit.findFirst({ where: { id: data.keyUnitId, tenantId } });
    if (!keyUnit) return { status: "error", message: "Key department not found." };
  }
  if (data.finalUnitId) {
    const finalUnit = await prisma.orgUnit.findFirst({ where: { id: data.finalUnitId, tenantId } });
    if (!finalUnit) return { status: "error", message: "Final department not found." };
  }

  const rolesError = validateContributionRolesJson(data.contributionRoles ?? null);
  if (rolesError) {
    return { status: "error", message: rolesError };
  }

  const created = await prisma.$transaction(async (tx) => {
    const kpi = await tx.kpiDefinition.create({
      data: {
        kraDefinitionId: data.kraDefinitionId,
        title: data.title,
        description: data.description,
        measurementType: data.measurementType,
        unitLabel: data.unitLabel,
        weightage: data.weightage,
        defaultTarget: data.defaultTarget,
        measurementConfig: data.measurementConfig as object | undefined,
        scoringMethod: data.scoringMethod,
        scoringDirection: data.scoringDirection,
        scoringConfig: data.scoringConfig as object | undefined,
        isPerCapita: data.isPerCapita,
        allocationType: data.allocationType,
        startingUnitId: data.startingUnitId,
        achievementTemplateKey: data.achievementTemplateKey,
        achievementFormConfig: data.achievementFormConfig as object | undefined,
        guidanceNotes: data.guidanceNotes,
        sortOrder: data.sortOrder,
        keyUnitId: data.keyUnitId,
        finalUnitId: data.finalUnitId,
        sopDescription: data.sopDescription,
        evidenceRequired: data.evidenceRequired,
        evidenceTypes: data.evidenceTypes,
        evidenceInstructions: data.evidenceInstructions,
        isTeamKpi: data.isTeamKpi,
        teamCreditMethod: !data.isTeamKpi ? "FULL_EACH" : data.teamCreditMethod,
        allowPartialCompletion: data.allowPartialCompletion,
        contributionRoles:
          data.contributionRoles && data.contributionRoles.length > 0
            ? (data.contributionRoles as object[])
            : undefined,
      },
    });

    await ensureApplicableRolesBaseline(
      kpi.id,
      tenantId,
      data.contributionRoles ?? null,
      tx,
    );

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "KpiDefinition",
        targetId: kpi.id,
        action: "CREATE",
        newState: {
          title: data.title,
          weightage: data.weightage,
          measurementType: data.measurementType,
        },
      },
    });

    return kpi;
  });

  return {
    status: "success",
    message: `KPI "${data.title}" created.`,
    id: created.id,
  };
}

// ── Update KPI ───────────────────────────────────────────────────────────────

export async function updateKpi(
  kpiId: string,
  tenantId: string,
  input: UpdateKpiInput,
  actorUserId: string,
  actorRole: Role
): Promise<KraKpiActionResult> {
  if (!isAdminOrOwner(actorRole)) {
    return { status: "error", code: "PERMISSION_DENIED", message: "Insufficient permissions." };
  }

  const parsed = updateKpiSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;

  const kpi = await prisma.kpiDefinition.findFirst({
    where: { id: kpiId, kraDefinition: { tenantId } },
    include: {
      kraDefinition: {
        select: {
          weightage: true,
          period: { select: { state: true } },
          kpiDefinitions: {
            where: { state: { not: "ARCHIVED" } },
            select: { id: true, weightage: true },
          },
        },
      },
      applicableRoles: {
        select: { id: true },
        take: 1,
      },
    },
  });
  if (!kpi) {
    return { status: "error", message: "KPI not found." };
  }

  if (kpi.state === "ARCHIVED") {
    return { status: "error", message: "Cannot edit an archived KPI." };
  }

  const periodState = kpi.kraDefinition.period.state;
  if (!canModifyKpiInPeriodState(periodState)) {
    return {
      status: "error",
      message: `Cannot edit KPI — period is in "${periodState}" state.`,
    };
  }

  // Check weightage
  if (data.weightage !== undefined && data.weightage !== kpi.weightage) {
    const otherKpiSum = kpi.kraDefinition.kpiDefinitions
      .filter((k) => k.id !== kpiId)
      .reduce((s, k) => s + k.weightage, 0);
    if (otherKpiSum + data.weightage > kpi.kraDefinition.weightage) {
      return {
        status: "error",
        message: `Weightage ${data.weightage} would exceed KRA weightage (${kpi.kraDefinition.weightage}). Other KPIs sum to ${otherKpiSum}.`,
      };
    }
  }

  // Validate starting unit if changing
  if (data.startingUnitId) {
    const unit = await prisma.orgUnit.findFirst({
      where: { id: data.startingUnitId, tenantId },
    });
    if (!unit) {
      return { status: "error", message: "Starting unit not found." };
    }
  }

  if (data.keyUnitId) {
    const keyUnit = await prisma.orgUnit.findFirst({ where: { id: data.keyUnitId, tenantId } });
    if (!keyUnit) return { status: "error", message: "Key department not found." };
  }
  if (data.finalUnitId) {
    const finalUnit = await prisma.orgUnit.findFirst({ where: { id: data.finalUnitId, tenantId } });
    if (!finalUnit) return { status: "error", message: "Final department not found." };
  }

  const nextMeasurementType = data.measurementType ?? kpi.measurementType;
  const nextMeasurementConfig =
    data.measurementConfig !== undefined
      ? (data.measurementConfig as MeasurementConfig | null)
      : data.measurementType !== undefined &&
          data.measurementType !== kpi.measurementType
        ? null
      : (kpi.measurementConfig as MeasurementConfig | null);
  const nextDefaultTarget =
    data.defaultTarget !== undefined ? data.defaultTarget : kpi.defaultTarget;
  const measurementSettingsError = validateMeasurementSettings(
    nextMeasurementType,
    nextMeasurementConfig,
    nextDefaultTarget,
  );
  if (measurementSettingsError) {
    return {
      status: "error",
      message: measurementSettingsError,
    };
  }

  if (data.contributionRoles !== undefined) {
    const rolesError = validateContributionRolesJson(
      data.contributionRoles === null ? null : data.contributionRoles,
    );
    if (rolesError) {
      return { status: "error", message: rolesError };
    }
  }

  await prisma.$transaction(async (tx) => {
    // Build update payload — use Prisma's unchecked input to avoid relation type conflicts
    const updateData: Record<string, unknown> = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.measurementType !== undefined) updateData.measurementType = data.measurementType;
    if (data.unitLabel !== undefined) updateData.unitLabel = data.unitLabel;
    if (data.weightage !== undefined) updateData.weightage = data.weightage;
    if (data.defaultTarget !== undefined) updateData.defaultTarget = data.defaultTarget;
    if (data.measurementConfig !== undefined)
      updateData.measurementConfig = data.measurementConfig as object | null;
    if (data.scoringMethod !== undefined) updateData.scoringMethod = data.scoringMethod;
    if (data.scoringDirection !== undefined) updateData.scoringDirection = data.scoringDirection;
    if (data.scoringConfig !== undefined)
      updateData.scoringConfig = data.scoringConfig as object | null;
    if (data.isPerCapita !== undefined) updateData.isPerCapita = data.isPerCapita;
    if (data.allocationType !== undefined) updateData.allocationType = data.allocationType;
    if (data.startingUnitId !== undefined) updateData.startingUnitId = data.startingUnitId;
    if (data.achievementTemplateKey !== undefined)
      updateData.achievementTemplateKey = data.achievementTemplateKey;
    if (data.achievementFormConfig !== undefined)
      updateData.achievementFormConfig = data.achievementFormConfig as object | null;
    if (data.guidanceNotes !== undefined) updateData.guidanceNotes = data.guidanceNotes;
    if (data.sortOrder !== undefined) updateData.sortOrder = data.sortOrder;
    if (data.keyUnitId !== undefined) updateData.keyUnitId = data.keyUnitId;
    if (data.finalUnitId !== undefined) updateData.finalUnitId = data.finalUnitId;
    if (data.sopDescription !== undefined) updateData.sopDescription = data.sopDescription;
    if (data.evidenceRequired !== undefined) updateData.evidenceRequired = data.evidenceRequired;
    if (data.evidenceTypes !== undefined) updateData.evidenceTypes = data.evidenceTypes;
    if (data.evidenceInstructions !== undefined) updateData.evidenceInstructions = data.evidenceInstructions;
    if (data.isTeamKpi !== undefined) updateData.isTeamKpi = data.isTeamKpi;
    if (data.teamCreditMethod !== undefined) updateData.teamCreditMethod = data.teamCreditMethod;
    if (data.allowPartialCompletion !== undefined) {
      updateData.allowPartialCompletion = data.allowPartialCompletion;
    }
    if (data.contributionRoles !== undefined) {
      updateData.contributionRoles =
        data.contributionRoles === null || data.contributionRoles.length === 0
          ? null
          : (data.contributionRoles as object[]);
    }

    await tx.kpiDefinition.update({
      where: { id: kpiId },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: updateData as any,
    });

    if (
      data.contributionRoles !== undefined ||
      kpi.applicableRoles.length === 0
    ) {
      await ensureApplicableRolesBaseline(
        kpiId,
        tenantId,
        data.contributionRoles !== undefined
          ? data.contributionRoles
          : kpi.contributionRoles,
        tx,
      );
    }

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "KpiDefinition",
        targetId: kpiId,
        action: "UPDATE",
        previousState: { title: kpi.title, weightage: kpi.weightage },
        newState: data as object,
      },
    });
  });

  return { status: "success", message: "KPI updated." };
}

export async function changeKpiState(
  kpiId: string,
  tenantId: string,
  input: ChangeKpiStateInput,
  actorUserId: string,
  actorRole: Role,
): Promise<KraKpiActionResult> {
  if (!isAdminOrOwner(actorRole)) {
    return { status: "error", message: "Insufficient permissions." };
  }

  const parsed = changeKpiStateSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const nextState = parsed.data.state as KpiDefinitionState;
  const kpi = await prisma.kpiDefinition.findFirst({
    where: { id: kpiId, kraDefinition: { tenantId } },
    include: {
      kraDefinition: {
        select: {
          state: true,
          period: { select: { state: true } },
        },
      },
      _count: {
        select: {
          targetAllocations: true,
          achievements: true,
        },
      },
    },
  });
  if (!kpi) {
    return { status: "error", message: "KPI not found." };
  }

  if (kpi.state === "ARCHIVED") {
    return { status: "error", message: "Cannot change the state of an archived KPI." };
  }
  if (kpi.kraDefinition.state === "ARCHIVED") {
    return { status: "error", message: "Cannot change KPI state under an archived KRA." };
  }
  if (!canModifyKpiInPeriodState(kpi.kraDefinition.period.state)) {
    return {
      status: "error",
      message: `Cannot change KPI state while the period is in "${kpi.kraDefinition.period.state}" state.`,
    };
  }
  if (kpi.state === nextState) {
    return { status: "error", message: `KPI is already in "${nextState}" state.` };
  }
  if (nextState === "ACTIVE" && kpi.kraDefinition.state !== "ACTIVE") {
    return {
      status: "error",
      message: "Activate the parent KRA before activating this KPI.",
    };
  }
  if (
    nextState === "DRAFT" &&
    (kpi._count.targetAllocations > 0 || kpi._count.achievements > 0)
  ) {
    return {
      status: "error",
      message: "Cannot move KPI back to DRAFT once targets or achievements exist. Remove them first.",
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.kpiDefinition.update({
      where: { id: kpiId },
      data: { state: nextState },
    });

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "KpiDefinition",
        targetId: kpiId,
        action: "STATE_CHANGE",
        previousState: { state: kpi.state },
        newState: { state: nextState },
      },
    });
  });

  return {
    status: "success",
    message: `KPI "${kpi.title}" moved to ${nextState}.`,
  };
}

// ── Delete KPI ───────────────────────────────────────────────────────────────

export async function deleteKpi(
  kpiId: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role
): Promise<KraKpiActionResult> {
  if (!isAdminOrOwner(actorRole)) {
    return { status: "error", message: "Insufficient permissions." };
  }

  const kpi = await prisma.kpiDefinition.findFirst({
    where: { id: kpiId, kraDefinition: { tenantId } },
    include: { _count: { select: { targetAllocations: true } } },
  });
  if (!kpi) {
    return { status: "error", message: "KPI not found." };
  }

  if (kpi._count.targetAllocations > 0) {
    return {
      status: "error",
      message: "Cannot delete KPI with target allocations. Archive it instead.",
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.kpiDefinition.delete({ where: { id: kpiId } });

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "KpiDefinition",
        targetId: kpiId,
        action: "DELETE",
        previousState: { title: kpi.title, weightage: kpi.weightage },
      },
    });
  });

  return { status: "success", message: `KPI "${kpi.title}" deleted.` };
}

// ── Validate KPI Weightages ──────────────────────────────────────────────────

export async function validateKpiWeightages(
  kraDefinitionId: string,
  tenantId: string
): Promise<{ valid: boolean; sum: number; kraWeightage: number; remaining: number }> {
  const kra = await prisma.kraDefinition.findFirst({
    where: { id: kraDefinitionId, tenantId },
    include: {
      kpiDefinitions: {
        where: { state: { not: "ARCHIVED" } },
        select: { weightage: true },
      },
    },
  });

  if (!kra) {
    return { valid: false, sum: 0, kraWeightage: 0, remaining: 0 };
  }

  const sum = kra.kpiDefinitions.reduce((s, k) => s + k.weightage, 0);
  return {
    valid: sum === kra.weightage,
    sum,
    kraWeightage: kra.weightage,
    remaining: kra.weightage - sum,
  };
}

// ── Target Unit Management (R2) ─────────────────────────────────────────────

export async function addTargetUnit(
  kpiId: string,
  tenantId: string,
  unitId: string,
  targetShare: number | null,
  notes: string | null,
  actorUserId: string,
  actorRole: Role
): Promise<KraKpiActionResult> {
  if (!isAdminOrOwner(actorRole)) {
    return { status: "error", message: "Insufficient permissions." };
  }

  const kpi = await prisma.kpiDefinition.findFirst({
    where: { id: kpiId, kraDefinition: { tenantId } },
    select: { id: true, state: true, startingUnitId: true },
  });
  if (!kpi) return { status: "error", code: "KPI_NOT_FOUND", message: "KPI not found." };
  if (kpi.state === "ARCHIVED") {
    return { status: "error", code: "KPI_ARCHIVED", message: "Cannot add targets to an archived KPI." };
  }

  const unit = await prisma.orgUnit.findFirst({
    where: { id: unitId, tenantId },
    select: { id: true },
  });
  if (!unit) return { status: "error", code: "UNIT_NOT_FOUND", message: "Unit not found." };

  if (unitId === kpi.startingUnitId) {
    return {
      status: "error",
      code: "TARGET_UNIT_ORIGIN_CONFLICT",
      message: "Starting unit cannot be a target unit (it's the originator).",
    };
  }

  if (targetShare !== null && targetShare !== undefined) {
    if (targetShare <= 0 || targetShare > 100) {
      return { status: "error", code: "TARGET_SHARE_INVALID", message: "Target share must be between 0 and 100." };
    }
  }

  const existing = await prisma.kpiTargetUnit.findUnique({
    where: { kpiDefinitionId_unitId: { kpiDefinitionId: kpiId, unitId } },
  });
  if (existing) {
    return { status: "error", code: "DUPLICATE_TARGET_UNIT", message: "This unit is already a target for this KPI." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.kpiTargetUnit.create({
      data: {
        kpiDefinitionId: kpiId,
        unitId,
        targetShare,
        notes,
      },
    });

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "KpiTargetUnit",
        targetId: kpiId,
        action: "ADD",
        metadata: { unitId, targetShare },
      },
    });
  });

  return { status: "success", message: "Target unit added." };
}

export async function removeTargetUnit(
  kpiId: string,
  tenantId: string,
  unitId: string,
  actorUserId: string,
  actorRole: Role
): Promise<KraKpiActionResult> {
  if (!isAdminOrOwner(actorRole)) {
    return { status: "error", code: "PERMISSION_DENIED", message: "Insufficient permissions." };
  }

  const kpi = await prisma.kpiDefinition.findFirst({
    where: { id: kpiId, kraDefinition: { tenantId } },
    select: { id: true, state: true },
  });
  if (!kpi) return { status: "error", code: "KPI_NOT_FOUND", message: "KPI not found." };
  if (kpi.state === "ARCHIVED") {
    return { status: "error", code: "KPI_ARCHIVED", message: "Cannot modify an archived KPI." };
  }

  const record = await prisma.kpiTargetUnit.findUnique({
    where: { kpiDefinitionId_unitId: { kpiDefinitionId: kpi.id, unitId } },
  });
  if (!record) return { status: "error", code: "TARGET_UNIT_NOT_FOUND", message: "Target unit not found." };

  const activeAllocations = await prisma.targetAllocation.count({
    where: { kpiDefinitionId: kpi.id, assignedToUnitId: unitId, tenantId },
  });
  if (activeAllocations > 0) {
    return {
      status: "error",
      code: "TARGET_UNIT_HAS_ALLOCATIONS",
      message: "Cannot remove target unit with existing allocations. Delete allocations first.",
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.kpiTargetUnit.delete({
      where: { kpiDefinitionId_unitId: { kpiDefinitionId: kpi.id, unitId } },
    });

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "KpiTargetUnit",
        targetId: kpi.id,
        action: "REMOVE",
        metadata: { unitId },
      },
    });
  });

  return { status: "success", message: "Target unit removed." };
}

export async function listTargetUnits(
  kpiId: string,
  tenantId: string
): Promise<KpiTargetUnitView[]> {
  const kpi = await prisma.kpiDefinition.findFirst({
    where: { id: kpiId, kraDefinition: { tenantId } },
    select: { id: true },
  });
  if (!kpi) return [];

  const records = await prisma.kpiTargetUnit.findMany({
    where: { kpiDefinitionId: kpiId },
    include: { unit: { select: { name: true, code: true } } },
    orderBy: { createdAt: "asc" },
  });

  return records.map((r) => ({
    id: r.id,
    kpiDefinitionId: r.kpiDefinitionId,
    unitId: r.unitId,
    unitName: r.unit.name,
    unitCode: r.unit.code,
    targetShare: r.targetShare,
    notes: r.notes,
    createdAt: r.createdAt,
  }));
}

export async function updateTargetUnit(
  kpiId: string,
  tenantId: string,
  unitId: string,
  targetShare: number | null,
  notes: string | null,
  actorUserId: string,
  actorRole: Role
): Promise<KraKpiActionResult> {
  if (!isAdminOrOwner(actorRole)) {
    return { status: "error", code: "PERMISSION_DENIED", message: "Insufficient permissions." };
  }

  const kpi = await prisma.kpiDefinition.findFirst({
    where: { id: kpiId, kraDefinition: { tenantId } },
    select: { id: true, state: true },
  });
  if (!kpi) return { status: "error", code: "KPI_NOT_FOUND", message: "KPI not found." };
  if (kpi.state === "ARCHIVED") {
    return { status: "error", code: "KPI_ARCHIVED", message: "Cannot modify an archived KPI." };
  }

  const record = await prisma.kpiTargetUnit.findUnique({
    where: { kpiDefinitionId_unitId: { kpiDefinitionId: kpi.id, unitId } },
  });
  if (!record) return { status: "error", code: "TARGET_UNIT_NOT_FOUND", message: "Target unit not found." };

  if (targetShare !== null && targetShare !== undefined) {
    if (targetShare <= 0 || targetShare > 100) {
      return { status: "error", code: "TARGET_SHARE_INVALID", message: "Target share must be between 0 and 100." };
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.kpiTargetUnit.update({
      where: { kpiDefinitionId_unitId: { kpiDefinitionId: kpi.id, unitId } },
      data: { targetShare, notes },
    });

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "KpiTargetUnit",
        targetId: kpi.id,
        action: "UPDATE",
        metadata: { unitId, targetShare },
      },
    });
  });

  return { status: "success", message: "Target unit updated." };
}
