import { AccreditationScope, CopilotMode, Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { bodyVersionCopilotConfigInputSchema, parseBodyVersionLlmConfig } from "./copilot-config";
import { hasTenantCapability } from "@/lib/tenant-permissions/service";
import { hasTenantServiceEnabled } from "@/lib/tenant-services/service";
import { listActiveProfileOptions } from "@/lib/llm/model-registry";

type ServiceResult<T extends object = Record<string, never>> =
  | ({ status: "success" } & T)
  | { status: "error"; message: string };

function toNullableJsonInput(value: unknown) {
  if (value === null || value === undefined) {
    return Prisma.JsonNull;
  }
  return value as Prisma.InputJsonValue;
}

function mapLockState(version: {
  body: { scope: AccreditationScope };
  sourceVersionId: string | null;
  sourceVersion: { id: string; versionCode: string; body: { scope: AccreditationScope; code: string } } | null;
}) {
  const inheritedFromGlobal =
    version.body.scope === AccreditationScope.TENANT &&
    !!version.sourceVersionId &&
    version.sourceVersion?.body.scope === AccreditationScope.GLOBAL;

  return {
    isLocked: inheritedFromGlobal,
    reason: inheritedFromGlobal
      ? `Inherited from global version ${version.sourceVersion?.body.code ?? ""} ${version.sourceVersion?.versionCode ?? ""}`.trim()
      : null,
  };
}

function mapVersionConfig(version: {
  id: string;
  assistantPackKey: string | null;
  copilotMode: CopilotMode;
  llmProfileId: string | null;
  llmConfig: unknown;
  llmProfile: {
    id: string;
    key: string;
    displayName: string;
    primaryModel: { displayName: string; code: string; provider: string };
  } | null;
  body: { scope: AccreditationScope; code: string };
  sourceVersionId: string | null;
  sourceVersion: { id: string; versionCode: string; body: { scope: AccreditationScope; code: string } } | null;
}) {
  const lockState = mapLockState(version);
  return {
    versionId: version.id,
    copilotMode: version.copilotMode,
    assistantPackKey: version.assistantPackKey,
    llmProfileId: version.llmProfileId,
    llmProfile: version.llmProfile
      ? {
          id: version.llmProfile.id,
          key: version.llmProfile.key,
          displayName: version.llmProfile.displayName,
          primaryModel: version.llmProfile.primaryModel,
        }
      : null,
    llmConfig: parseBodyVersionLlmConfig(version.llmConfig as never),
    lockState,
    effectiveSource:
      version.sourceVersion && lockState.isLocked
        ? {
            type: "GLOBAL_INHERITED",
            versionId: version.sourceVersion.id,
            versionCode: version.sourceVersion.versionCode,
            bodyCode: version.sourceVersion.body.code,
          }
        : {
            type: version.body.scope === AccreditationScope.GLOBAL ? "GLOBAL_OWNED" : "TENANT_OWNED",
            versionId: version.id,
            versionCode: version.sourceVersion?.versionCode ?? null,
            bodyCode: version.body.code,
          },
  };
}

async function getVersionForTenantAccess(tenantId: string, versionId: string) {
  return prisma.accreditationBodyVersion.findFirst({
    where: {
      id: versionId,
      body: {
        OR: [{ scope: AccreditationScope.GLOBAL, tenantId: null }, { scope: AccreditationScope.TENANT, tenantId }],
      },
    },
    include: {
      body: { select: { scope: true, code: true, tenantId: true } },
      sourceVersion: {
        select: {
          id: true,
          versionCode: true,
          body: { select: { scope: true, code: true } },
        },
      },
      llmProfile: {
        include: {
          primaryModel: { select: { displayName: true, code: true, provider: true } },
        },
      },
    },
  });
}

async function ensureTenantReadAccess(tenantId: string) {
  return (await hasTenantServiceEnabled(tenantId, "ACCREDITATION"))
    ? null
    : "Accreditation service is not enabled for this tenant.";
}

async function ensureTenantManageAccess(tenantId: string, actorUserId: string, actorRole: Role) {
  if (!(await hasTenantServiceEnabled(tenantId, "ACCREDITATION"))) {
    return "Accreditation service is not enabled for this tenant.";
  }

  const allowed = await hasTenantCapability({
    tenantId,
    userId: actorUserId,
    baseRole: actorRole,
    capability: "MANAGE_ACCREDITATION",
  });

  return allowed ? null : "Insufficient permissions to manage accreditation.";
}

export async function getSuperadminVersionCopilotConfig(versionId: string): Promise<ServiceResult<{
  config: ReturnType<typeof mapVersionConfig>;
  availableProfiles: Awaited<ReturnType<typeof listActiveProfileOptions>>;
}>> {
  const version = await prisma.accreditationBodyVersion.findFirst({
    where: {
      id: versionId,
      body: { scope: AccreditationScope.GLOBAL },
    },
    include: {
      body: { select: { scope: true, code: true } },
      sourceVersion: {
        select: {
          id: true,
          versionCode: true,
          body: { select: { scope: true, code: true } },
        },
      },
      llmProfile: {
        include: {
          primaryModel: { select: { displayName: true, code: true, provider: true } },
        },
      },
    },
  });
  if (!version) {
    return { status: "error", message: "Version not found." };
  }

  return {
    status: "success",
    config: mapVersionConfig(version),
    availableProfiles: await listActiveProfileOptions(),
  };
}

export async function getTenantVersionCopilotConfig(
  tenantId: string,
  versionId: string,
): Promise<ServiceResult<{
  config: ReturnType<typeof mapVersionConfig>;
  availableProfiles: Awaited<ReturnType<typeof listActiveProfileOptions>>;
}>> {
  const accessError = await ensureTenantReadAccess(tenantId);
  if (accessError) {
    return { status: "error", message: accessError };
  }

  const version = await getVersionForTenantAccess(tenantId, versionId);
  if (!version) {
    return { status: "error", message: "Version not found." };
  }

  return {
    status: "success",
    config: mapVersionConfig(version),
    availableProfiles: await listActiveProfileOptions(),
  };
}

export async function updateSuperadminVersionCopilotConfig(versionId: string, input: unknown) {
  const parsed = bodyVersionCopilotConfigInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error" as const, message: parsed.error.issues[0]?.message ?? "Invalid copilot config." };
  }

  const version = await prisma.accreditationBodyVersion.findFirst({
    where: {
      id: versionId,
      body: { scope: AccreditationScope.GLOBAL },
    },
  });
  if (!version) {
    return { status: "error" as const, message: "Version not found." };
  }

  const updated = await prisma.accreditationBodyVersion.update({
    where: { id: versionId },
    data: {
      copilotMode: parsed.data.copilotMode,
      assistantPackKey: parsed.data.assistantPackKey ?? null,
      llmProfileId: parsed.data.llmProfileId ?? null,
      llmConfig: toNullableJsonInput(parsed.data.llmConfig),
    },
    include: {
      body: { select: { scope: true, code: true } },
      sourceVersion: {
        select: {
          id: true,
          versionCode: true,
          body: { select: { scope: true, code: true } },
        },
      },
      llmProfile: {
        include: {
          primaryModel: { select: { displayName: true, code: true, provider: true } },
        },
      },
    },
  });

  return { status: "success" as const, config: mapVersionConfig(updated) };
}

export async function updateTenantVersionCopilotConfig(
  tenantId: string,
  versionId: string,
  input: unknown,
  actorUserId: string,
  actorRole: Role,
) {
  const permissionError = await ensureTenantManageAccess(tenantId, actorUserId, actorRole);
  if (permissionError) {
    return { status: "error" as const, message: permissionError };
  }

  const parsed = bodyVersionCopilotConfigInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error" as const, message: parsed.error.issues[0]?.message ?? "Invalid copilot config." };
  }

  const version = await getVersionForTenantAccess(tenantId, versionId);
  if (!version) {
    return { status: "error" as const, message: "Version not found." };
  }

  const lockState = mapLockState(version);
  if (lockState.isLocked) {
    return { status: "error" as const, message: "Body-level copilot settings are inherited from the global source version and cannot be edited on this tenant fork." };
  }
  if (version.body.scope !== AccreditationScope.TENANT || version.body.tenantId !== tenantId) {
    return { status: "error" as const, message: "Only tenant-owned versions can update copilot settings." };
  }

  const updated = await prisma.accreditationBodyVersion.update({
    where: { id: versionId },
    data: {
      copilotMode: parsed.data.copilotMode,
      assistantPackKey: parsed.data.assistantPackKey ?? null,
      llmProfileId: parsed.data.llmProfileId ?? null,
      llmConfig: toNullableJsonInput(parsed.data.llmConfig),
    },
    include: {
      body: { select: { scope: true, code: true } },
      sourceVersion: {
        select: {
          id: true,
          versionCode: true,
          body: { select: { scope: true, code: true } },
        },
      },
      llmProfile: {
        include: {
          primaryModel: { select: { displayName: true, code: true, provider: true } },
        },
      },
    },
  });

  return { status: "success" as const, config: mapVersionConfig(updated) };
}
