import { Prisma, type Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  externalContributorCreditSumModeSchema,
  type EffectiveKpiContributorConfigView,
  type KpiContributorConfigView,
} from "./external-contrib-shared";
import { seedDefaultTemplates } from "./external-contrib-template-service";
import type { KraKpiActionResult } from "./shared";
import { hasTenantCapability } from "@/lib/tenant-permissions/service";

const tenantOwnerRole = "TENANT_OWNER" satisfies Role;
const tenantAdminRole = "TENANT_ADMIN" satisfies Role;

const setConfigSchema = z.object({
  externalContribTemplateId: z.string().trim().min(1).nullable().optional(),
  allowExternalContributors: z.boolean().optional(),
  duplicateCheckFields: z.array(z.string().trim().min(1)).max(20).optional(),
  creditSumMode: externalContributorCreditSumModeSchema.optional(),
});

export type SetKpiContributorConfigInput = z.input<typeof setConfigSchema>;

function isTenantAdmin(role: Role): boolean {
  return (
    role === tenantOwnerRole ||
    role === tenantAdminRole ||
    role === "SUPERADMIN"
  );
}

async function canManageKpiContributorConfig(
  tenantId: string,
  actorUserId: string,
  actorRole: Role,
) {
  return hasTenantCapability({
    tenantId,
    userId: actorUserId,
    baseRole: actorRole,
    capability: "MANAGE_KPI",
  });
}

function mapConfigView(row: {
  id: string;
  kpiDefinitionId: string;
  externalContribTemplateId: string | null;
  allowExternalContributors: boolean;
  duplicateCheckFields: unknown;
  creditSumMode: string;
  createdAt: Date;
  updatedAt: Date;
}): KpiContributorConfigView {
  const duplicateCheckFields = z.array(z.string()).safeParse(row.duplicateCheckFields);
  const creditSumMode = externalContributorCreditSumModeSchema.safeParse(row.creditSumMode);

  return {
    id: row.id,
    kpiDefinitionId: row.kpiDefinitionId,
    externalContribTemplateId: row.externalContribTemplateId,
    allowExternalContributors: row.allowExternalContributors,
    duplicateCheckFields: duplicateCheckFields.success ? duplicateCheckFields.data : [],
    creditSumMode: creditSumMode.success ? creditSumMode.data : "MUST_EQUAL_100",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function getKpiForConfig(kpiId: string, tenantId: string) {
  return prisma.kpiDefinition.findFirst({
    where: {
      id: kpiId,
      kraDefinition: { tenantId },
    },
    select: {
      id: true,
      achievementFormConfig: true,
      contributorConfig: {
        select: {
          id: true,
          kpiDefinitionId: true,
          externalContribTemplateId: true,
          allowExternalContributors: true,
          duplicateCheckFields: true,
          creditSumMode: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });
}

export async function setConfig(
  kpiId: string,
  tenantId: string,
  input: SetKpiContributorConfigInput,
  actorUserId: string,
  actorRole: Role,
): Promise<KraKpiActionResult> {
  if (!(await canManageKpiContributorConfig(tenantId, actorUserId, actorRole))) {
    return {
      status: "error",
      message: "Insufficient permissions.",
      code: "PERMISSION_DENIED",
    };
  }

  const parsed = setConfigSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  await seedDefaultTemplates(tenantId);

  const kpi = await getKpiForConfig(kpiId, tenantId);
  if (!kpi) {
    return {
      status: "error",
      message: "KPI not found.",
      code: "KPI_NOT_FOUND",
    };
  }

  if (
    parsed.data.externalContribTemplateId !== undefined &&
    parsed.data.externalContribTemplateId !== null
  ) {
    const template = await prisma.externalContributorTemplate.findUnique({
      where: { id: parsed.data.externalContribTemplateId },
      select: { id: true, tenantId: true, isActive: true },
    });
    if (!template) {
      return {
        status: "error",
        message: "External contributor template not found.",
        code: "EXTERNAL_TEMPLATE_NOT_FOUND",
      };
    }
    if (template.tenantId !== tenantId) {
      return {
        status: "error",
        message: "The selected template belongs to another tenant.",
        code: "EXTERNAL_TEMPLATE_WRONG_TENANT",
      };
    }
    if (!template.isActive) {
      return {
        status: "error",
        message: "Archived templates cannot be linked to a KPI.",
        code: "EXTERNAL_TEMPLATE_ARCHIVED",
      };
    }
  }

  const nextDuplicateCheckFields = [
    ...new Set(
      (
        parsed.data.duplicateCheckFields ??
        (kpi.contributorConfig
          ? mapConfigView(kpi.contributorConfig).duplicateCheckFields
          : [])
      ).map((value) => value.trim()).filter(Boolean),
    ),
  ];

  const achievementFormFields = z
    .object({
      fields: z.array(z.object({ key: z.string() })),
    })
    .safeParse(kpi.achievementFormConfig);

  const validFieldKeys = new Set(
    achievementFormFields.success ? achievementFormFields.data.fields.map((field) => field.key) : [],
  );
  const invalidDuplicateFields = nextDuplicateCheckFields.filter(
    (fieldKey) => !validFieldKeys.has(fieldKey),
  );

  const createData: Prisma.KpiContributorConfigCreateInput = {
    kpiDefinition: {
      connect: { id: kpiId },
    },
    allowExternalContributors: parsed.data.allowExternalContributors ?? true,
    duplicateCheckFields:
      nextDuplicateCheckFields.length > 0 ? nextDuplicateCheckFields : undefined,
    creditSumMode: parsed.data.creditSumMode ?? "MUST_EQUAL_100",
  };

  if (parsed.data.externalContribTemplateId) {
    createData.externalContribTemplate = {
      connect: { id: parsed.data.externalContribTemplateId },
    };
  }

  const updateData: Prisma.KpiContributorConfigUpdateInput = {
    ...(parsed.data.allowExternalContributors !== undefined
      ? { allowExternalContributors: parsed.data.allowExternalContributors }
      : {}),
    ...(parsed.data.duplicateCheckFields !== undefined
      ? {
          duplicateCheckFields:
            nextDuplicateCheckFields.length > 0 ? nextDuplicateCheckFields : Prisma.JsonNull,
        }
      : {}),
    ...(parsed.data.creditSumMode !== undefined
      ? { creditSumMode: parsed.data.creditSumMode }
      : {}),
  };

  if (parsed.data.externalContribTemplateId !== undefined) {
    updateData.externalContribTemplate = parsed.data.externalContribTemplateId
      ? {
          connect: { id: parsed.data.externalContribTemplateId },
        }
      : {
          disconnect: true,
        };
  }

  await prisma.kpiContributorConfig.upsert({
    where: { kpiDefinitionId: kpiId },
    create: createData,
    update: updateData,
  });

  await prisma.auditLog.create({
    data: {
      tenantId,
      actorUserId,
      actorRole,
      targetType: "KpiContributorConfig",
      targetId: kpiId,
      action: "UPSERT",
      newState: {
        ...parsed.data,
        duplicateCheckFields: nextDuplicateCheckFields,
      } as object,
    },
  });

  return {
    status: "success",
    message:
      invalidDuplicateFields.length > 0
        ? `Contributor config saved. Warning: these duplicate-check fields are not present on the KPI form: ${invalidDuplicateFields.join(", ")}.`
        : "Contributor config saved.",
    id: kpiId,
  };
}

export async function getConfig(
  kpiId: string,
  tenantId: string,
): Promise<KpiContributorConfigView | null> {
  const kpi = await getKpiForConfig(kpiId, tenantId);
  if (!kpi?.contributorConfig) return null;
  return mapConfigView(kpi.contributorConfig);
}

export async function getEffectiveConfig(
  kpiId: string,
  tenantId: string,
): Promise<EffectiveKpiContributorConfigView | null> {
  await seedDefaultTemplates(tenantId);

  const kpi = await getKpiForConfig(kpiId, tenantId);
  if (!kpi) return null;

  const rawConfig = kpi.contributorConfig ? mapConfigView(kpi.contributorConfig) : null;
  const templateIdFromConfig = rawConfig?.externalContribTemplateId ?? null;

  let explicitTemplate = null;
  if (templateIdFromConfig) {
    explicitTemplate = await prisma.externalContributorTemplate.findFirst({
      where: { id: templateIdFromConfig, tenantId, isActive: true },
      select: { id: true, name: true },
    });
  }

  const defaultTemplate = await prisma.externalContributorTemplate.findFirst({
    where: { tenantId, isDefault: true, isActive: true },
    select: { id: true, name: true },
  });

  const effectiveTemplate = explicitTemplate ?? defaultTemplate ?? null;

  return {
    id: rawConfig?.id ?? null,
    kpiDefinitionId: kpiId,
    externalContribTemplateId: effectiveTemplate?.id ?? null,
    externalContribTemplateName: effectiveTemplate?.name ?? null,
    allowExternalContributors: rawConfig?.allowExternalContributors ?? true,
    duplicateCheckFields: rawConfig?.duplicateCheckFields ?? [],
    creditSumMode: rawConfig?.creditSumMode ?? "MUST_EQUAL_100",
    inheritedTemplate: explicitTemplate == null,
  };
}
