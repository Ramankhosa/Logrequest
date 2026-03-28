import type { ExternalContributorTemplate, Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  BASE_EXTERNAL_CONTRIBUTOR_FIELDS,
  DEFAULT_EXTERNAL_CONTRIBUTOR_TEMPLATE_SEEDS,
  type ExternalContributorTemplateView,
} from "./external-contrib-shared";
import {
  achievementFieldSchema,
  buildFormDataValidator,
  type AchievementFieldConfig,
  type KraKpiActionResult,
} from "./shared";

const tenantOwnerRole = "TENANT_OWNER" satisfies Role;
const tenantAdminRole = "TENANT_ADMIN" satisfies Role;
const defaultTemplateName = "Default External";

const createTemplateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).optional(),
  fields: z.array(achievementFieldSchema).min(2).max(30),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});

const updateTemplateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  fields: z.array(achievementFieldSchema).min(2).max(30).optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export type CreateExternalContributorTemplateInput = z.input<typeof createTemplateSchema>;
export type UpdateExternalContributorTemplateInput = z.input<typeof updateTemplateSchema>;

function isTenantAdmin(role: Role): boolean {
  return (
    role === tenantOwnerRole ||
    role === tenantAdminRole ||
    role === "SUPERADMIN"
  );
}

function cloneFields(fields: AchievementFieldConfig[]): AchievementFieldConfig[] {
  return fields.map((field) => ({
    ...field,
    options: field.options ? [...field.options] : undefined,
  }));
}

function normalizeTemplateFields(fields: AchievementFieldConfig[]): AchievementFieldConfig[] {
  return cloneFields(fields).map((field, index) => ({
    ...field,
    sortOrder: index,
  }));
}

function validateTemplateFields(fields: AchievementFieldConfig[]): string | null {
  const keySet = new Set<string>();
  for (const field of fields) {
    if (keySet.has(field.key)) {
      return `Duplicate field key "${field.key}" is not allowed.`;
    }
    keySet.add(field.key);

    if (
      (field.type === "SELECT" || field.type === "MULTI_SELECT") &&
      (!field.options || field.options.length === 0)
    ) {
      return `${field.label} must define at least one option.`;
    }

    if (field.type === "DECLARATION") {
      return "Declaration fields are not supported in external contributor templates.";
    }

    if (field.pattern) {
      try {
        void new RegExp(field.pattern);
      } catch {
        return `${field.label} has an invalid pattern.`;
      }
    }
  }

  for (const baseField of BASE_EXTERNAL_CONTRIBUTOR_FIELDS) {
    const existing = fields.find((field) => field.key === baseField.key);
    if (!existing) {
      return `Template must include required field "${baseField.key}".`;
    }
    if (existing.type !== baseField.type || existing.required !== true) {
      return `Field "${baseField.key}" must be a required ${baseField.type} field.`;
    }
  }

  return null;
}

function mapTemplateView(
  row: ExternalContributorTemplate & {
    _count?: { kpiConfigs: number };
  },
): ExternalContributorTemplateView {
  const parsedFields = z.array(achievementFieldSchema).safeParse(row.fields);
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    description: row.description,
    fields: parsedFields.success ? parsedFields.data : [],
    isDefault: row.isDefault,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    kpiConfigCount: row._count?.kpiConfigs,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function seedDefaultTemplates(tenantId: string): Promise<void> {
  const existing = await prisma.externalContributorTemplate.findMany({
    where: { tenantId },
    select: { id: true, name: true, isDefault: true },
  });
  let hasDefault = existing.some((row) => row.isDefault);

  for (const seed of DEFAULT_EXTERNAL_CONTRIBUTOR_TEMPLATE_SEEDS) {
    const match = existing.find((row) => row.name === seed.name);
    if (match) continue;

    await prisma.externalContributorTemplate.create({
      data: {
        tenantId,
        name: seed.name,
        description: seed.description,
        fields: normalizeTemplateFields(seed.fields) as object,
        isDefault: seed.isDefault && !hasDefault,
        sortOrder: seed.sortOrder,
      },
    });
    if (seed.isDefault && !hasDefault) {
      hasDefault = true;
    }
  }

  if (!hasDefault) {
    const fallback = await prisma.externalContributorTemplate.findFirst({
      where: { tenantId, name: defaultTemplateName, isActive: true },
      select: { id: true },
    });
    if (fallback) {
      await prisma.externalContributorTemplate.update({
        where: { id: fallback.id },
        data: { isDefault: true },
      });
    }
  }
}

export async function listTemplates(
  tenantId: string,
  includeArchived = false,
): Promise<ExternalContributorTemplateView[]> {
  await seedDefaultTemplates(tenantId);
  const rows = await prisma.externalContributorTemplate.findMany({
    where: {
      tenantId,
      ...(includeArchived ? {} : { isActive: true }),
    },
    include: {
      _count: { select: { kpiConfigs: true } },
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return rows.map((row) => mapTemplateView(row));
}

export async function getTemplate(
  id: string,
  tenantId: string,
): Promise<ExternalContributorTemplateView | null> {
  const row = await prisma.externalContributorTemplate.findFirst({
    where: { id, tenantId },
    include: {
      _count: { select: { kpiConfigs: true } },
    },
  });
  return row ? mapTemplateView(row) : null;
}

export async function createTemplate(
  tenantId: string,
  input: CreateExternalContributorTemplateInput,
  actorUserId: string,
  actorRole: Role,
): Promise<KraKpiActionResult> {
  if (!isTenantAdmin(actorRole)) {
    return {
      status: "error",
      message: "Insufficient permissions.",
      code: "PERMISSION_DENIED",
    };
  }

  const parsed = createTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  const normalizedFields = normalizeTemplateFields(parsed.data.fields);
  const fieldError = validateTemplateFields(normalizedFields);
  if (fieldError) {
    return { status: "error", message: fieldError };
  }

  const created = await prisma.externalContributorTemplate.create({
    data: {
      tenantId,
      name: parsed.data.name,
      description: parsed.data.description,
      fields: normalizedFields as object,
      sortOrder: parsed.data.sortOrder,
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId,
      actorUserId,
      actorRole,
      targetType: "ExternalContributorTemplate",
      targetId: created.id,
      action: "CREATE",
      newState: { name: created.name, fieldCount: normalizedFields.length } as object,
    },
  });

  return {
    status: "success",
    message: "External contributor template created.",
    id: created.id,
  };
}

export async function updateTemplate(
  id: string,
  tenantId: string,
  input: UpdateExternalContributorTemplateInput,
  actorUserId: string,
  actorRole: Role,
): Promise<KraKpiActionResult> {
  if (!isTenantAdmin(actorRole)) {
    return {
      status: "error",
      message: "Insufficient permissions.",
      code: "PERMISSION_DENIED",
    };
  }

  const parsed = updateTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  const existing = await prisma.externalContributorTemplate.findFirst({
    where: { id, tenantId },
  });
  if (!existing) {
    return {
      status: "error",
      message: "External contributor template not found.",
      code: "EXTERNAL_TEMPLATE_NOT_FOUND",
    };
  }

  let normalizedFields: AchievementFieldConfig[] | undefined;
  if (parsed.data.fields) {
    normalizedFields = normalizeTemplateFields(parsed.data.fields);
    const fieldError = validateTemplateFields(normalizedFields);
    if (fieldError) {
      return { status: "error", message: fieldError };
    }
  }

  await prisma.externalContributorTemplate.update({
    where: { id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.description !== undefined
        ? { description: parsed.data.description }
        : {}),
      ...(normalizedFields ? { fields: normalizedFields as object } : {}),
      ...(parsed.data.sortOrder !== undefined ? { sortOrder: parsed.data.sortOrder } : {}),
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId,
      actorUserId,
      actorRole,
      targetType: "ExternalContributorTemplate",
      targetId: id,
      action: "UPDATE",
      newState: {
        ...parsed.data,
        fieldCount: normalizedFields?.length,
      } as object,
    },
  });

  return {
    status: "success",
    message: "External contributor template updated.",
    id,
  };
}

export async function archiveTemplate(
  id: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role,
): Promise<KraKpiActionResult> {
  if (!isTenantAdmin(actorRole)) {
    return {
      status: "error",
      message: "Insufficient permissions.",
      code: "PERMISSION_DENIED",
    };
  }

  const existing = await prisma.externalContributorTemplate.findFirst({
    where: { id, tenantId },
  });
  if (!existing) {
    return {
      status: "error",
      message: "External contributor template not found.",
      code: "EXTERNAL_TEMPLATE_NOT_FOUND",
    };
  }

  const inUse = await prisma.kpiContributorConfig.findFirst({
    where: { externalContribTemplateId: id, kpiDefinition: { kraDefinition: { tenantId } } },
    select: { id: true },
  });
  if (inUse) {
    return {
      status: "error",
      message: "This template is linked to one or more KPIs. Update those KPI configs first.",
      code: "EXTERNAL_TEMPLATE_IN_USE",
    };
  }

  let replacementDefaultId: string | null = null;
  if (existing.isDefault) {
    const replacement = await prisma.externalContributorTemplate.findFirst({
      where: {
        tenantId,
        id: { not: id },
        isActive: true,
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true },
    });
    if (!replacement) {
      return {
        status: "error",
        message: "Cannot archive the only active external contributor template.",
        code: "EXTERNAL_TEMPLATE_LAST_DEFAULT",
      };
    }
    replacementDefaultId = replacement.id;
  }

  await prisma.$transaction(async (tx) => {
    await tx.externalContributorTemplate.update({
      where: { id },
      data: { isActive: false, isDefault: false },
    });

    if (replacementDefaultId) {
      await tx.externalContributorTemplate.update({
        where: { id: replacementDefaultId },
        data: { isDefault: true },
      });
    }

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "ExternalContributorTemplate",
        targetId: id,
        action: "ARCHIVE",
        newState: {
          isActive: false,
          replacementDefaultId,
        } as object,
      },
    });
  });

  return {
    status: "success",
    message: replacementDefaultId
      ? "External contributor template archived and default reassigned."
      : "External contributor template archived.",
  };
}

export async function setDefault(
  id: string,
  tenantId: string,
  actorUserId: string,
  actorRole: Role,
): Promise<KraKpiActionResult> {
  if (!isTenantAdmin(actorRole)) {
    return {
      status: "error",
      message: "Insufficient permissions.",
      code: "PERMISSION_DENIED",
    };
  }

  const existing = await prisma.externalContributorTemplate.findFirst({
    where: { id, tenantId },
    select: { id: true, isActive: true },
  });
  if (!existing) {
    return {
      status: "error",
      message: "External contributor template not found.",
      code: "EXTERNAL_TEMPLATE_NOT_FOUND",
    };
  }
  if (!existing.isActive) {
    return {
      status: "error",
      message: "Archived templates cannot be set as default.",
      code: "EXTERNAL_TEMPLATE_ARCHIVED",
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.externalContributorTemplate.updateMany({
      where: { tenantId, isDefault: true },
      data: { isDefault: false },
    });
    await tx.externalContributorTemplate.update({
      where: { id },
      data: { isDefault: true },
    });
    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "ExternalContributorTemplate",
        targetId: id,
        action: "SET_DEFAULT",
        newState: { isDefault: true } as object,
      },
    });
  });

  return {
    status: "success",
    message: "Default external contributor template updated.",
    id,
  };
}

export async function validateExternalData(
  templateId: string,
  tenantId: string,
  data: Record<string, unknown>,
): Promise<{ valid: boolean; errors: string[] }> {
  const template = await prisma.externalContributorTemplate.findFirst({
    where: { id: templateId, tenantId, isActive: true },
    select: { fields: true },
  });

  if (!template) {
    return {
      valid: false,
      errors: ["External contributor template not found."],
    };
  }

  const parsedFields = z.array(achievementFieldSchema).safeParse(template.fields);
  if (!parsedFields.success) {
    return {
      valid: false,
      errors: ["Template fields are invalid."],
    };
  }

  const validator = buildFormDataValidator(parsedFields.data, {
    unknownKeys: "strip",
  });
  const result = validator.safeParse(data);
  if (!result.success) {
    return {
      valid: false,
      errors: result.error.issues.map((issue) => issue.message),
    };
  }

  if (
    result.data.scope === "International" &&
    parsedFields.data.some((field) => field.key === "country") &&
    !result.data.country
  ) {
    return {
      valid: false,
      errors: ["Country is required for international external contributors."],
    };
  }

  return { valid: true, errors: [] };
}
