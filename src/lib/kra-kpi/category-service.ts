import type { Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { KraKpiActionResult, KraCategoryView } from "./shared";
import { hasTenantCapability } from "@/lib/tenant-permissions/service";

// ── Constants ────────────────────────────────────────────────────────────────

const CATEGORY_KEY_RE = /^[A-Z0-9_]{2,50}$/;

const tenantOwnerRole = "TENANT_OWNER" satisfies Role;
const tenantAdminRole = "TENANT_ADMIN" satisfies Role;

// ── Schemas ──────────────────────────────────────────────────────────────────

const createCategorySchema = z.object({
  categoryKey: z
    .string()
    .trim()
    .min(2)
    .max(50)
    .regex(
      CATEGORY_KEY_RE,
      "Category key must be 2-50 uppercase letters, numbers, or underscores"
    ),
  displayLabel: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
  iconName: z.string().trim().max(50).optional(),
  colorHex: z
    .string()
    .trim()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Must be a valid hex color")
    .optional(),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});

const updateCategorySchema = z.object({
  displayLabel: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  iconName: z.string().trim().max(50).nullable().optional(),
  colorHex: z
    .string()
    .trim()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Must be a valid hex color")
    .nullable()
    .optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
});

export type CreateCategoryInput = z.input<typeof createCategorySchema>;
export type UpdateCategoryInput = z.input<typeof updateCategorySchema>;

async function canManageCategories(
  tenantId: string,
  actorUserId: string,
  actorRole: Role,
) {
  return hasTenantCapability({
    tenantId,
    userId: actorUserId,
    baseRole: actorRole,
    capability: "MANAGE_KRA",
  });
}

// ── List Categories ──────────────────────────────────────────────────────────

/**
 * List KRA categories: merges global (superadmin) + tenant-specific.
 * Available to all authenticated tenant members.
 */
export async function listCategories(
  tenantId: string
): Promise<KraCategoryView[]> {
  const categories = await prisma.kraCategoryDefinition.findMany({
    where: {
      OR: [{ tenantId: null, scope: "GLOBAL" }, { tenantId }],
      isActive: true,
    },
    include: {
      _count: { select: { kraDefinitions: true } },
    },
    orderBy: [{ scope: "asc" }, { sortOrder: "asc" }, { displayLabel: "asc" }],
  });

  return categories.map((c) => ({
    id: c.id,
    tenantId: c.tenantId,
    scope: c.scope,
    categoryKey: c.categoryKey,
    displayLabel: c.displayLabel,
    description: c.description,
    iconName: c.iconName,
    colorHex: c.colorHex,
    sortOrder: c.sortOrder,
    isActive: c.isActive,
    kraCount: c._count.kraDefinitions,
    createdAt: c.createdAt,
  }));
}

/**
 * List all categories including inactive — for admin management.
 */
export async function listAllCategories(
  tenantId: string | null // null = superadmin listing global
): Promise<KraCategoryView[]> {
  const where = tenantId === null
    ? { tenantId: null, scope: "GLOBAL" as const }
    : { OR: [{ tenantId: null, scope: "GLOBAL" as const }, { tenantId }] };

  const categories = await prisma.kraCategoryDefinition.findMany({
    where,
    include: {
      _count: { select: { kraDefinitions: true } },
    },
    orderBy: [{ scope: "asc" }, { sortOrder: "asc" }, { displayLabel: "asc" }],
  });

  return categories.map((c) => ({
    id: c.id,
    tenantId: c.tenantId,
    scope: c.scope,
    categoryKey: c.categoryKey,
    displayLabel: c.displayLabel,
    description: c.description,
    iconName: c.iconName,
    colorHex: c.colorHex,
    sortOrder: c.sortOrder,
    isActive: c.isActive,
    kraCount: c._count.kraDefinitions,
    createdAt: c.createdAt,
  }));
}

// ── Create Category ──────────────────────────────────────────────────────────

/**
 * Create a KRA category.
 * - Superadmin: tenantId=null, scope=GLOBAL
 * - Tenant admin/owner: tenantId set, scope=TENANT
 */
export async function createCategory(
  tenantId: string | null, // null = global (superadmin)
  input: CreateCategoryInput,
  actorUserId: string,
  actorRole: Role
): Promise<KraKpiActionResult> {
  // Permission check
  if (tenantId === null && actorRole !== "SUPERADMIN") {
    return { status: "error", message: "Only superadmin can create global categories." };
  }
  if (
    tenantId !== null &&
    !(await canManageCategories(tenantId, actorUserId, actorRole))
  ) {
    return { status: "error", message: "Insufficient permissions to create categories." };
  }

  // Validate input
  const parsed = createCategorySchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;

  // Check duplicate key
  const existing = await prisma.kraCategoryDefinition.findUnique({
    where: { tenantId_categoryKey: { tenantId: tenantId ?? "", categoryKey: data.categoryKey } },
  });

  // For global categories, tenantId is null — need different check
  if (tenantId === null) {
    const existingGlobal = await prisma.kraCategoryDefinition.findFirst({
      where: { tenantId: null, categoryKey: data.categoryKey },
    });
    if (existingGlobal) {
      return { status: "error", message: `Category key "${data.categoryKey}" already exists.` };
    }
  } else if (existing) {
    return { status: "error", message: `Category key "${data.categoryKey}" already exists for this tenant.` };
  }

  await prisma.$transaction(async (tx) => {
    await tx.kraCategoryDefinition.create({
      data: {
        tenantId,
        scope: tenantId === null ? "GLOBAL" : "TENANT",
        categoryKey: data.categoryKey,
        displayLabel: data.displayLabel,
        description: data.description,
        iconName: data.iconName,
        colorHex: data.colorHex,
        sortOrder: data.sortOrder,
        createdByUserId: actorUserId,
      },
    });

    await tx.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorRole,
        targetType: "KraCategoryDefinition",
        targetId: data.categoryKey,
        action: "CREATE",
        newState: data as object,
      },
    });
  });

  return { status: "success", message: `Category "${data.displayLabel}" created successfully.` };
}

// ── Update Category ──────────────────────────────────────────────────────────

export async function updateCategory(
  categoryId: string,
  input: UpdateCategoryInput,
  actorUserId: string,
  actorRole: Role
): Promise<KraKpiActionResult> {
  const parsed = updateCategorySchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;

  const category = await prisma.kraCategoryDefinition.findUnique({
    where: { id: categoryId },
  });
  if (!category) {
    return { status: "error", message: "Category not found." };
  }

  // Permission: global = superadmin, tenant = owner/admin
  if (category.scope === "GLOBAL" && actorRole !== "SUPERADMIN") {
    return { status: "error", message: "Only superadmin can update global categories." };
  }
  if (
    category.scope === "TENANT" &&
    !(await canManageCategories(category.tenantId ?? "", actorUserId, actorRole))
  ) {
    return { status: "error", message: "Insufficient permissions to update this category." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.kraCategoryDefinition.update({
      where: { id: categoryId },
      data: {
        ...(data.displayLabel !== undefined && { displayLabel: data.displayLabel }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.iconName !== undefined && { iconName: data.iconName }),
        ...(data.colorHex !== undefined && { colorHex: data.colorHex }),
        ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    });

    await tx.auditLog.create({
      data: {
        tenantId: category.tenantId,
        actorUserId,
        actorRole,
        targetType: "KraCategoryDefinition",
        targetId: categoryId,
        action: "UPDATE",
        previousState: {
          displayLabel: category.displayLabel,
          isActive: category.isActive,
        },
        newState: data as object,
      },
    });
  });

  return { status: "success", message: "Category updated successfully." };
}

// ── Delete Category ──────────────────────────────────────────────────────────

export async function deleteCategory(
  categoryId: string,
  actorUserId: string,
  actorRole: Role
): Promise<KraKpiActionResult> {
  const category = await prisma.kraCategoryDefinition.findUnique({
    where: { id: categoryId },
    include: { _count: { select: { kraDefinitions: true } } },
  });
  if (!category) {
    return { status: "error", message: "Category not found." };
  }

  // Permission check
  if (category.scope === "GLOBAL" && actorRole !== "SUPERADMIN") {
    return { status: "error", message: "Only superadmin can delete global categories." };
  }
  if (
    category.scope === "TENANT" &&
    !(await canManageCategories(category.tenantId ?? "", actorUserId, actorRole))
  ) {
    return { status: "error", message: "Insufficient permissions to delete this category." };
  }

  // Guard: cannot delete if KRAs reference this category
  if (category._count.kraDefinitions > 0) {
    return {
      status: "error",
      message: `Cannot delete category "${category.displayLabel}" — it is referenced by ${category._count.kraDefinitions} KRA(s). Deactivate it instead.`,
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.kraCategoryDefinition.delete({ where: { id: categoryId } });

    await tx.auditLog.create({
      data: {
        tenantId: category.tenantId,
        actorUserId,
        actorRole,
        targetType: "KraCategoryDefinition",
        targetId: categoryId,
        action: "DELETE",
        previousState: {
          categoryKey: category.categoryKey,
          displayLabel: category.displayLabel,
        },
      },
    });
  });

  return { status: "success", message: `Category "${category.displayLabel}" deleted.` };
}
