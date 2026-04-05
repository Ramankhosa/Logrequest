import {
  Prisma,
  Role,
  TenantFeatureCode,
  TenantFeatureEntitlementStatus,
  TenantServiceCode,
  TenantServiceEntitlementStatus,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type TenantServiceEntitlementView = {
  id: string;
  tenantId: string;
  serviceCode: TenantServiceCode;
  status: TenantServiceEntitlementStatus;
  enabledAt: Date | null;
  enabledByUserId: string | null;
  disabledAt: Date | null;
  disabledByUserId: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type TenantFeatureEntitlementView = {
  id: string;
  tenantId: string;
  featureCode: TenantFeatureCode;
  status: TenantFeatureEntitlementStatus;
  enabledAt: Date | null;
  enabledByUserId: string | null;
  disabledAt: Date | null;
  disabledByUserId: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const FEATURE_PARENT_SERVICE: Record<TenantFeatureCode, TenantServiceCode> = {
  [TenantFeatureCode.ACCREDITATION_COPILOT]: TenantServiceCode.ACCREDITATION,
};

export async function listTenantServiceEntitlements(
  tenantId: string,
): Promise<TenantServiceEntitlementView[]> {
  const rows = await prisma.tenantServiceEntitlement.findMany({
    where: { tenantId },
    orderBy: { serviceCode: "asc" },
  });

  return rows.map((row) => ({
    id: row.id,
    tenantId: row.tenantId,
    serviceCode: row.serviceCode,
    status: row.status,
    enabledAt: row.enabledAt,
    enabledByUserId: row.enabledByUserId ?? null,
    disabledAt: row.disabledAt,
    disabledByUserId: row.disabledByUserId ?? null,
    notes: row.notes ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

export async function listEnabledTenantServiceCodes(tenantId: string): Promise<TenantServiceCode[]> {
  const rows = await prisma.tenantServiceEntitlement.findMany({
    where: {
      tenantId,
      status: TenantServiceEntitlementStatus.ENABLED,
    },
    orderBy: { serviceCode: "asc" },
    select: { serviceCode: true },
  });

  return rows.map((row) => row.serviceCode);
}

export async function listTenantFeatureEntitlements(
  tenantId: string,
): Promise<TenantFeatureEntitlementView[]> {
  const rows = await prisma.tenantFeatureEntitlement.findMany({
    where: { tenantId },
    orderBy: { featureCode: "asc" },
  });

  return rows.map((row) => ({
    id: row.id,
    tenantId: row.tenantId,
    featureCode: row.featureCode,
    status: row.status,
    enabledAt: row.enabledAt,
    enabledByUserId: row.enabledByUserId ?? null,
    disabledAt: row.disabledAt,
    disabledByUserId: row.disabledByUserId ?? null,
    notes: row.notes ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

export async function listEnabledTenantFeatureCodes(
  tenantId: string,
): Promise<TenantFeatureCode[]> {
  const rows = await prisma.tenantFeatureEntitlement.findMany({
    where: {
      tenantId,
      status: TenantFeatureEntitlementStatus.ENABLED,
    },
    orderBy: { featureCode: "asc" },
    select: { featureCode: true },
  });

  const enabledServices = new Set(await listEnabledTenantServiceCodes(tenantId));
  return rows
    .map((row) => row.featureCode)
    .filter((featureCode) => enabledServices.has(FEATURE_PARENT_SERVICE[featureCode]));
}

export async function hasTenantServiceEnabled(
  tenantId: string,
  serviceCode: TenantServiceCode,
): Promise<boolean> {
  const row = await prisma.tenantServiceEntitlement.findUnique({
    where: {
      tenantId_serviceCode: {
        tenantId,
        serviceCode,
      },
    },
    select: { status: true },
  });

  return row?.status === TenantServiceEntitlementStatus.ENABLED;
}

export async function hasTenantFeatureEnabled(
  tenantId: string,
  featureCode: TenantFeatureCode,
): Promise<boolean> {
  const [featureRow, parentServiceEnabled] = await Promise.all([
    prisma.tenantFeatureEntitlement.findUnique({
      where: {
        tenantId_featureCode: {
          tenantId,
          featureCode,
        },
      },
      select: { status: true },
    }),
    hasTenantServiceEnabled(tenantId, FEATURE_PARENT_SERVICE[featureCode]),
  ]);

  return parentServiceEnabled && featureRow?.status === TenantFeatureEntitlementStatus.ENABLED;
}

export async function setTenantServiceEntitlement(input: {
  tenantId: string;
  serviceCode: TenantServiceCode;
  enabled: boolean;
  actorUserId: string;
  actorRole: Role;
  notes?: string | null;
}) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: input.tenantId },
    select: { id: true, code: true, name: true },
  });

  if (!tenant) {
    return { status: "error" as const, message: "Tenant not found." };
  }

  const nextStatus = input.enabled
    ? TenantServiceEntitlementStatus.ENABLED
    : TenantServiceEntitlementStatus.DISABLED;

  const existing = await prisma.tenantServiceEntitlement.findUnique({
    where: {
      tenantId_serviceCode: {
        tenantId: input.tenantId,
        serviceCode: input.serviceCode,
      },
    },
  });

  const now = new Date();

  const entitlement = await prisma.$transaction(async (tx) => {
    const saved = await tx.tenantServiceEntitlement.upsert({
      where: {
        tenantId_serviceCode: {
          tenantId: input.tenantId,
          serviceCode: input.serviceCode,
        },
      },
      create: {
        tenantId: input.tenantId,
        serviceCode: input.serviceCode,
        status: nextStatus,
        enabledAt: input.enabled ? now : null,
        enabledByUserId: input.enabled ? input.actorUserId : null,
        disabledAt: input.enabled ? null : now,
        disabledByUserId: input.enabled ? null : input.actorUserId,
        notes: input.notes ?? null,
      },
      update: {
        status: nextStatus,
        enabledAt: input.enabled ? now : existing?.enabledAt ?? now,
        enabledByUserId: input.enabled ? input.actorUserId : existing?.enabledByUserId ?? null,
        disabledAt: input.enabled ? null : now,
        disabledByUserId: input.enabled ? null : input.actorUserId,
        notes: input.notes ?? null,
      },
    });

    await tx.auditLog.create({
      data: {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        targetType: "TenantServiceEntitlement",
        targetId: saved.id,
        action: input.enabled ? "tenant.service.enabled" : "tenant.service.disabled",
        previousState: existing
          ? {
              status: existing.status,
              notes: existing.notes,
              enabledAt: existing.enabledAt?.toISOString() ?? null,
              disabledAt: existing.disabledAt?.toISOString() ?? null,
            }
          : Prisma.JsonNull,
        newState: {
          serviceCode: saved.serviceCode,
          status: saved.status,
          notes: saved.notes,
          enabledAt: saved.enabledAt?.toISOString() ?? null,
          disabledAt: saved.disabledAt?.toISOString() ?? null,
        },
        metadata: {
          tenantCode: tenant.code,
          tenantName: tenant.name,
        },
      },
    });

    return saved;
  });

  return {
    status: "success" as const,
    message: `${input.serviceCode} service ${input.enabled ? "enabled" : "disabled"} for ${tenant.name}.`,
    entitlement: {
      id: entitlement.id,
      tenantId: entitlement.tenantId,
      serviceCode: entitlement.serviceCode,
      status: entitlement.status,
      enabledAt: entitlement.enabledAt,
      enabledByUserId: entitlement.enabledByUserId ?? null,
      disabledAt: entitlement.disabledAt,
      disabledByUserId: entitlement.disabledByUserId ?? null,
      notes: entitlement.notes ?? null,
      createdAt: entitlement.createdAt,
      updatedAt: entitlement.updatedAt,
    } satisfies TenantServiceEntitlementView,
  };
}

export async function setTenantFeatureEntitlement(input: {
  tenantId: string;
  featureCode: TenantFeatureCode;
  enabled: boolean;
  actorUserId: string;
  actorRole: Role;
  notes?: string | null;
}) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: input.tenantId },
    select: { id: true, code: true, name: true },
  });

  if (!tenant) {
    return { status: "error" as const, message: "Tenant not found." };
  }

  const nextStatus = input.enabled
    ? TenantFeatureEntitlementStatus.ENABLED
    : TenantFeatureEntitlementStatus.DISABLED;

  const existing = await prisma.tenantFeatureEntitlement.findUnique({
    where: {
      tenantId_featureCode: {
        tenantId: input.tenantId,
        featureCode: input.featureCode,
      },
    },
  });

  const now = new Date();

  const entitlement = await prisma.$transaction(async (tx) => {
    const saved = await tx.tenantFeatureEntitlement.upsert({
      where: {
        tenantId_featureCode: {
          tenantId: input.tenantId,
          featureCode: input.featureCode,
        },
      },
      create: {
        tenantId: input.tenantId,
        featureCode: input.featureCode,
        status: nextStatus,
        enabledAt: input.enabled ? now : null,
        enabledByUserId: input.enabled ? input.actorUserId : null,
        disabledAt: input.enabled ? null : now,
        disabledByUserId: input.enabled ? null : input.actorUserId,
        notes: input.notes ?? null,
      },
      update: {
        status: nextStatus,
        enabledAt: input.enabled ? now : existing?.enabledAt ?? now,
        enabledByUserId: input.enabled ? input.actorUserId : existing?.enabledByUserId ?? null,
        disabledAt: input.enabled ? null : now,
        disabledByUserId: input.enabled ? null : input.actorUserId,
        notes: input.notes ?? null,
      },
    });

    await tx.auditLog.create({
      data: {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        targetType: "TenantFeatureEntitlement",
        targetId: saved.id,
        action: input.enabled ? "tenant.feature.enabled" : "tenant.feature.disabled",
        previousState: existing
          ? {
              status: existing.status,
              notes: existing.notes,
              enabledAt: existing.enabledAt?.toISOString() ?? null,
              disabledAt: existing.disabledAt?.toISOString() ?? null,
            }
          : Prisma.JsonNull,
        newState: {
          featureCode: saved.featureCode,
          status: saved.status,
          notes: saved.notes,
          enabledAt: saved.enabledAt?.toISOString() ?? null,
          disabledAt: saved.disabledAt?.toISOString() ?? null,
        },
        metadata: {
          tenantCode: tenant.code,
          tenantName: tenant.name,
          parentService: FEATURE_PARENT_SERVICE[input.featureCode],
        },
      },
    });

    return saved;
  });

  return {
    status: "success" as const,
    message: `${input.featureCode} feature ${input.enabled ? "enabled" : "disabled"} for ${tenant.name}.`,
    entitlement: {
      id: entitlement.id,
      tenantId: entitlement.tenantId,
      featureCode: entitlement.featureCode,
      status: entitlement.status,
      enabledAt: entitlement.enabledAt,
      enabledByUserId: entitlement.enabledByUserId ?? null,
      disabledAt: entitlement.disabledAt,
      disabledByUserId: entitlement.disabledByUserId ?? null,
      notes: entitlement.notes ?? null,
      createdAt: entitlement.createdAt,
      updatedAt: entitlement.updatedAt,
    } satisfies TenantFeatureEntitlementView,
  };
}
