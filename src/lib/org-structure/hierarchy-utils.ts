import { prisma } from "@/lib/prisma";

// ── Shared version resolvers ─────────────────────────────────────────────────
// Extracted from roles-service.ts so all hierarchy/scope modules can share them.

/** Returns the latest PUBLISHED org-structure version id, or null. */
export async function getPublishedVersionId(tenantId: string): Promise<string | null> {
  const v = await prisma.orgStructureVersion.findFirst({
    where: { tenantId, state: "PUBLISHED" },
    orderBy: { versionNumber: "desc" },
    select: { id: true },
  });
  return v?.id ?? null;
}

/** Returns the latest version in any active state (DRAFT, VALIDATED, PUBLISHED). */
export async function getActiveVersionId(tenantId: string): Promise<string | null> {
  const v = await prisma.orgStructureVersion.findFirst({
    where: {
      tenantId,
      state: { in: ["DRAFT", "VALIDATED", "PUBLISHED"] },
    },
    orderBy: { versionNumber: "desc" },
    select: { id: true },
  });
  return v?.id ?? null;
}

/** Prefers PUBLISHED; falls back to any active version. */
export async function getRuntimeVersionId(tenantId: string): Promise<string | null> {
  const publishedVersionId = await getPublishedVersionId(tenantId);
  if (publishedVersionId) return publishedVersionId;
  return getActiveVersionId(tenantId);
}

// ── Hierarchy utilities ──────────────────────────────────────────────────────

/**
 * Get all descendant unit IDs under a root unit in the published org structure.
 * Uses path-based lookup when available (fast), BFS fallback otherwise.
 */
export async function getDescendantUnitIds(
  tenantId: string,
  rootUnitId: string,
  includeRoot = true,
): Promise<string[]> {
  const versionId = await getPublishedVersionId(tenantId);
  if (!versionId) return includeRoot ? [rootUnitId] : [];

  const rootUnit = await prisma.orgUnit.findFirst({
    where: { id: rootUnitId, versionId },
    select: { id: true, path: true },
  });
  if (!rootUnit) return includeRoot ? [rootUnitId] : [];

  if (rootUnit.path) {
    const descendants = await prisma.orgUnit.findMany({
      where: {
        tenantId,
        versionId,
        path: { startsWith: `${rootUnit.path}/` },
      },
      select: { id: true },
    });
    const ids = descendants.map((u) => u.id);
    return includeRoot ? [rootUnitId, ...ids] : ids;
  }

  // BFS fallback when path is null
  const ids: string[] = [];
  const queue = [rootUnitId];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    if (current !== rootUnitId || includeRoot) {
      ids.push(current);
    }

    const children = await prisma.orgUnit.findMany({
      where: { parentId: current, versionId },
      select: { id: true },
    });
    for (const child of children) {
      queue.push(child.id);
    }
  }

  return ids;
}

/**
 * Union of descendants across multiple root units, deduplicated.
 */
export async function getSubtreeUnitIds(
  tenantId: string,
  rootUnitIds: string[],
): Promise<string[]> {
  const allIds = new Set<string>();
  for (const rootId of rootUnitIds) {
    const descendantIds = await getDescendantUnitIds(tenantId, rootId, true);
    for (const id of descendantIds) {
      allIds.add(id);
    }
  }
  return [...allIds];
}

/**
 * Walk up the tree via parentId from the given unit to root.
 * Returns array ordered root → ... → unit (for breadcrumb display).
 */
export async function getAncestorChain(
  tenantId: string,
  unitId: string,
): Promise<{ id: string; name: string; code: string; level: number; category: string }[]> {
  const versionId = await getPublishedVersionId(tenantId);
  if (!versionId) return [];

  const chain: { id: string; name: string; code: string; level: number; category: string }[] = [];
  const visited = new Set<string>();
  let currentId: string | null = unitId;

  while (currentId) {
    if (visited.has(currentId)) break;
    visited.add(currentId);

    const row: {
      id: string;
      name: string;
      code: string;
      level: number;
      parentId: string | null;
      type: { displayLabel: string };
    } | null = await prisma.orgUnit.findFirst({
      where: { id: currentId, versionId },
      select: {
        id: true,
        name: true,
        code: true,
        level: true,
        parentId: true,
        type: { select: { displayLabel: true } },
      },
    });
    if (!row) break;

    chain.unshift({
      id: row.id,
      name: row.name,
      code: row.code,
      level: row.level,
      category: row.type.displayLabel,
    });

    currentId = row.parentId;
  }

  return chain;
}

/**
 * Find sibling units (same parentId), excluding the given unit.
 */
export async function getSiblingUnits(
  tenantId: string,
  unitId: string,
): Promise<{ id: string; name: string; code: string; category: string }[]> {
  const versionId = await getPublishedVersionId(tenantId);
  if (!versionId) return [];

  const unit = await prisma.orgUnit.findFirst({
    where: { id: unitId, versionId },
    select: { parentId: true },
  });
  if (!unit) return [];

  const siblings = await prisma.orgUnit.findMany({
    where: {
      versionId,
      parentId: unit.parentId,
      id: { not: unitId },
    },
    select: {
      id: true,
      name: true,
      code: true,
      type: { select: { displayLabel: true } },
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  return siblings.map((s) => ({
    id: s.id,
    name: s.name,
    code: s.code,
    category: s.type.displayLabel,
  }));
}
