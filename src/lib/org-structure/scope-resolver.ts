import { prisma } from "@/lib/prisma";
import { getUserAssignments } from "@/lib/org-structure/roles-service";
import {
  getPublishedVersionId,
  getDescendantUnitIds,
} from "@/lib/org-structure/hierarchy-utils";

// ── Types ────────────────────────────────────────────────────────────────────

export type UserDashboardScope = {
  userId: string;
  tenantId: string;
  isTenantAdmin: boolean;
  headOfUnits: {
    unitId: string;
    unitName: string;
    unitCode: string;
    scope: "NODE" | "DESCENDANTS";
    hasChildUnits: boolean;
  }[];
  memberOfUnits: { unitId: string; unitName: string; unitCode: string }[];
  hasApprovalAuthority: boolean;
  visibleUnitIds: string[] | "ALL";
  rootScopeUnits: {
    unitId: string;
    unitName: string;
    unitCode: string;
    category: string;
  }[];
};

export type DashboardUnitRoot = {
  unitId: string;
  unitName: string;
  unitCode: string;
};

export type DashboardUnitSelection = {
  scopeMode: "NODE" | "DESCENDANTS";
  rootUnit: DashboardUnitRoot;
  effectiveUnitIds: string[];
};

export type DashboardOrgUnitRef = {
  unitId: string;
  unitName: string;
  unitCode: string;
  category: string;
  level: number;
};

export type DashboardOrgNodeSelection = {
  entryRoots: DashboardOrgUnitRef[];
  currentNode: DashboardOrgUnitRef | null;
  breadcrumb: DashboardOrgUnitRef[];
  visibleChildren: DashboardOrgUnitRef[];
  effectiveUnitIds: string[];
};

export class DashboardUnitSelectionError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "DashboardUnitSelectionError";
    this.status = status;
  }
}

export class DashboardOrgSelectionError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "DashboardOrgSelectionError";
    this.status = status;
  }
}

type PublishedScopeUnit = {
  id: string;
  name: string;
  code: string;
  parentId: string | null;
  level: number;
  path: string | null;
  sortOrder: number;
  type: { displayLabel: string };
};

function toOrgUnitRef(unit: PublishedScopeUnit): DashboardOrgUnitRef {
  return {
    unitId: unit.id,
    unitName: unit.name,
    unitCode: unit.code,
    category: unit.type.displayLabel,
    level: unit.level,
  };
}

function sortPublishedUnits(units: PublishedScopeUnit[]) {
  return [...units].sort((left, right) =>
    left.level === right.level
      ? left.sortOrder === right.sortOrder
        ? left.name.localeCompare(right.name)
        : left.sortOrder - right.sortOrder
      : left.level - right.level,
  );
}

function buildPublishedUnitMap(units: PublishedScopeUnit[]) {
  return new Map(units.map((unit) => [unit.id, unit]));
}

function buildPublishedChildrenMap(units: PublishedScopeUnit[]) {
  const map = new Map<string | null, PublishedScopeUnit[]>();
  for (const unit of sortPublishedUnits(units)) {
    const siblings = map.get(unit.parentId) ?? [];
    siblings.push(unit);
    map.set(unit.parentId, siblings);
  }
  return map;
}

function collectDescendantIdsFromMap(
  rootUnitId: string,
  childrenMap: Map<string | null, PublishedScopeUnit[]>,
) {
  const ids = new Set<string>();
  const queue = [rootUnitId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (ids.has(current)) continue;
    ids.add(current);
    for (const child of childrenMap.get(current) ?? []) {
      queue.push(child.id);
    }
  }

  return ids;
}

function isAncestorOrSelf(
  ancestorUnitId: string,
  descendantUnitId: string,
  unitMap: Map<string, PublishedScopeUnit>,
) {
  let currentId: string | null = descendantUnitId;
  const visited = new Set<string>();

  while (currentId) {
    if (currentId === ancestorUnitId) return true;
    if (visited.has(currentId)) break;
    visited.add(currentId);
    currentId = unitMap.get(currentId)?.parentId ?? null;
  }

  return false;
}

function collectAncestorChainFromMap(
  unitMap: Map<string, PublishedScopeUnit>,
  unitId: string,
) {
  const chain: PublishedScopeUnit[] = [];
  const visited = new Set<string>();
  let currentId: string | null = unitId;

  while (currentId) {
    if (visited.has(currentId)) break;
    visited.add(currentId);
    const unit = unitMap.get(currentId);
    if (!unit) break;
    chain.unshift(unit);
    currentId = unit.parentId;
  }

  return chain;
}

async function getPublishedScopeUnits(tenantId: string) {
  const versionId = await getPublishedVersionId(tenantId);
  if (!versionId) {
    return { versionId: null, units: [] as PublishedScopeUnit[] };
  }

  const units = await prisma.orgUnit.findMany({
    where: { tenantId, versionId },
    select: {
      id: true,
      name: true,
      code: true,
      parentId: true,
      level: true,
      path: true,
      sortOrder: true,
      type: { select: { displayLabel: true } },
    },
    orderBy: [{ level: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
  });

  return { versionId, units };
}

function collapseCoveredOrgRoots(
  roots: PublishedScopeUnit[],
  unitMap: Map<string, PublishedScopeUnit>,
) {
  const kept: PublishedScopeUnit[] = [];
  for (const unit of sortPublishedUnits(roots)) {
    if (kept.some((root) => isAncestorOrSelf(root.id, unit.id, unitMap))) {
      continue;
    }
    kept.push(unit);
  }
  return kept;
}

// ── Resolver ─────────────────────────────────────────────────────────────────

/**
 * Build the full dashboard scope for a user: which units they can see,
 * whether they're a tenant admin, which units they head, etc.
 */
export async function resolveUserDashboardScope(
  tenantId: string,
  userId: string,
): Promise<UserDashboardScope> {
  const [assignments, membership, versionId] = await Promise.all([
    getUserAssignments(tenantId, userId),
    prisma.membership.findFirst({
      where: { tenantId, userId, status: "ACTIVE" },
      select: { role: true },
    }),
    getPublishedVersionId(tenantId),
  ]);

  const isTenantAdmin =
    membership?.role === "TENANT_OWNER" || membership?.role === "TENANT_ADMIN";

  const hasApprovalAuthority = assignments.some((a) => a.approvalAuthority);

  // Also query UserOrgAssignment for units where user belongs but may hold no org role (Finding 2)
  const userOrgUnits = versionId
    ? await prisma.userOrgAssignment.findMany({
        where: {
          userId,
          versionId,
        },
        select: {
          unitId: true,
          unit: { select: { name: true, code: true } },
        },
      })
    : [];

  if (isTenantAdmin) {
    // Tenant admins see everything; rootScopeUnits = level-0 root units (Finding 7)
    const rootUnits = versionId
      ? await prisma.orgUnit.findMany({
          where: { tenantId, versionId, level: 0 },
          select: {
            id: true,
            name: true,
            code: true,
            type: { select: { displayLabel: true } },
          },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        })
      : [];

    return {
      userId,
      tenantId,
      isTenantAdmin: true,
      headOfUnits: [],
      memberOfUnits: userOrgUnits.map((u) => ({
        unitId: u.unitId,
        unitName: u.unit.name,
        unitCode: u.unit.code,
      })),
      hasApprovalAuthority,
      visibleUnitIds: "ALL",
      rootScopeUnits: rootUnits.map((u) => ({
        unitId: u.id,
        unitName: u.name,
        unitCode: u.code,
        category: u.type.displayLabel,
      })),
    };
  }

  // Non-admin user: build scope from assignments
  const headAssignments = assignments.filter((a) => a.isUnitHead);

  const headOfUnits: UserDashboardScope["headOfUnits"] = [];
  const visibleSet = new Set<string>();

  for (const a of headAssignments) {
    const childCount = versionId
      ? await prisma.orgUnit.count({ where: { parentId: a.unitId, versionId } })
      : 0;

    headOfUnits.push({
      unitId: a.unitId,
      unitName: a.unitName,
      unitCode: a.unitCode,
      scope: a.scope as "NODE" | "DESCENDANTS",
      hasChildUnits: childCount > 0,
    });

    if (a.scope === "DESCENDANTS") {
      const descendantIds = await getDescendantUnitIds(tenantId, a.unitId, true);
      for (const id of descendantIds) visibleSet.add(id);
    } else {
      visibleSet.add(a.unitId);
    }
  }

  // Include all units from UserOrgAssignment (Finding 2)
  for (const u of userOrgUnits) {
    visibleSet.add(u.unitId);
  }

  // Also add units from role assignments where user is member but not head
  for (const a of assignments) {
    visibleSet.add(a.unitId);
  }

  const memberOfUnits = [
    ...new Map(
      [
        ...assignments.map((a) => ({
          unitId: a.unitId,
          unitName: a.unitName,
          unitCode: a.unitCode,
        })),
        ...userOrgUnits.map((u) => ({
          unitId: u.unitId,
          unitName: u.unit.name,
          unitCode: u.unit.code,
        })),
      ].map((u) => [u.unitId, u]),
    ).values(),
  ];

  // rootScopeUnits = the head-of-units entries (top-level drill-down entry points)
  const rootScopeUnits: UserDashboardScope["rootScopeUnits"] = [];
  if (versionId) {
    for (const h of headOfUnits) {
      const unit = await prisma.orgUnit.findFirst({
        where: { id: h.unitId, versionId },
        select: { type: { select: { displayLabel: true } } },
      });
      rootScopeUnits.push({
        unitId: h.unitId,
        unitName: h.unitName,
        unitCode: h.unitCode,
        category: unit?.type.displayLabel ?? "",
      });
    }
  }

  return {
    userId,
    tenantId,
    isTenantAdmin: false,
    headOfUnits,
    memberOfUnits,
    hasApprovalAuthority,
    visibleUnitIds: [...visibleSet],
    rootScopeUnits,
  };
}

export async function resolveDashboardUnitSelection(
  tenantId: string,
  userId: string,
  requestedUnitId?: string,
): Promise<DashboardUnitSelection> {
  const scope = await resolveUserDashboardScope(tenantId, userId);

  if (scope.isTenantAdmin) {
    const versionId = await getPublishedVersionId(tenantId);
    if (!versionId) {
      throw new DashboardUnitSelectionError(
        404,
        "No published organization structure is available.",
      );
    }

    const requestedUnit = requestedUnitId
      ? await prisma.orgUnit.findFirst({
          where: { tenantId, versionId, id: requestedUnitId },
          select: { id: true, name: true, code: true },
        })
      : null;

    const fallbackRoot = scope.rootScopeUnits[0];
    const selectedRoot =
      requestedUnit
      ?? (fallbackRoot
        ? {
            id: fallbackRoot.unitId,
            name: fallbackRoot.unitName,
            code: fallbackRoot.unitCode,
          }
        : null);

    if (!selectedRoot) {
      throw new DashboardUnitSelectionError(
        404,
        "No unit is available for dashboard selection.",
      );
    }

    return {
      scopeMode: "DESCENDANTS",
      rootUnit: {
        unitId: selectedRoot.id,
        unitName: selectedRoot.name,
        unitCode: selectedRoot.code,
      },
      effectiveUnitIds: await getDescendantUnitIds(tenantId, selectedRoot.id, true),
    };
  }

  if (scope.headOfUnits.length === 0) {
    throw new DashboardUnitSelectionError(
      403,
      "You do not head any units in the current dashboard scope.",
    );
  }

  const selectedHead = requestedUnitId
    ? scope.headOfUnits.find((unit) => unit.unitId === requestedUnitId) ?? null
    : null;

  if (requestedUnitId && !selectedHead) {
    throw new DashboardUnitSelectionError(
      403,
      "You do not have access to the requested unit.",
    );
  }

  const rootUnit = selectedHead ?? scope.headOfUnits[0]!;
  const effectiveUnitIds =
    rootUnit.scope === "DESCENDANTS"
      ? await getDescendantUnitIds(tenantId, rootUnit.unitId, true)
      : [rootUnit.unitId];

  return {
    scopeMode: rootUnit.scope,
    rootUnit: {
      unitId: rootUnit.unitId,
      unitName: rootUnit.unitName,
      unitCode: rootUnit.unitCode,
    },
    effectiveUnitIds: [...new Set(effectiveUnitIds)],
  };
}

export async function resolveDashboardOrgNodeSelection(
  tenantId: string,
  userId: string,
  requestedUnitId?: string,
): Promise<DashboardOrgNodeSelection> {
  const [scope, published] = await Promise.all([
    resolveUserDashboardScope(tenantId, userId),
    getPublishedScopeUnits(tenantId),
  ]);

  if (!published.versionId) {
    throw new DashboardOrgSelectionError(
      404,
      "No published organization structure is available.",
    );
  }

  const unitMap = buildPublishedUnitMap(published.units);
  const childrenMap = buildPublishedChildrenMap(published.units);
  const rootUnits = sortPublishedUnits(published.units.filter((unit) => unit.level === 0));

  let entryRoots: PublishedScopeUnit[];
  let allowedVisibleUnitIds: Set<string>;

  if (scope.isTenantAdmin) {
    entryRoots = rootUnits;
    allowedVisibleUnitIds = new Set(published.units.map((unit) => unit.id));
  } else {
    const descendantRoots = collapseCoveredOrgRoots(
      scope.headOfUnits
        .filter((unit) => unit.scope === "DESCENDANTS")
        .map((unit) => unitMap.get(unit.unitId))
        .filter((unit): unit is PublishedScopeUnit => Boolean(unit)),
      unitMap,
    );

    if (descendantRoots.length === 0) {
      throw new DashboardOrgSelectionError(
        403,
        "You do not have organization drill-down access in the current dashboard scope.",
      );
    }

    entryRoots = descendantRoots;
    allowedVisibleUnitIds = new Set<string>();
    for (const root of descendantRoots) {
      for (const unitId of collectDescendantIdsFromMap(root.id, childrenMap)) {
        allowedVisibleUnitIds.add(unitId);
      }
    }
  }

  if (requestedUnitId) {
    const requestedUnit = unitMap.get(requestedUnitId);
    if (!requestedUnit) {
      throw new DashboardOrgSelectionError(404, "Unit not found.");
    }

    if (!scope.isTenantAdmin && !allowedVisibleUnitIds.has(requestedUnitId)) {
      throw new DashboardOrgSelectionError(
        403,
        "You do not have access to the requested organization node.",
      );
    }

    const rawDescendants = collectDescendantIdsFromMap(requestedUnit.id, childrenMap);
    const effectiveUnitIds = [...rawDescendants].filter((unitId) =>
      scope.isTenantAdmin ? true : allowedVisibleUnitIds.has(unitId),
    );
    const breadcrumbUnits = collectAncestorChainFromMap(unitMap, requestedUnit.id);
    const trimmedBreadcrumb = scope.isTenantAdmin
      ? breadcrumbUnits
      : (() => {
          const firstVisibleIndex = breadcrumbUnits.findIndex((unit) =>
            entryRoots.some((root) => root.id === unit.id),
          );
          return firstVisibleIndex >= 0
            ? breadcrumbUnits.slice(firstVisibleIndex)
            : [requestedUnit];
        })();

    return {
      entryRoots: entryRoots.map(toOrgUnitRef),
      currentNode: toOrgUnitRef(requestedUnit),
      breadcrumb: trimmedBreadcrumb.map(toOrgUnitRef),
      visibleChildren: (childrenMap.get(requestedUnit.id) ?? [])
        .filter((unit) => scope.isTenantAdmin || allowedVisibleUnitIds.has(unit.id))
        .map(toOrgUnitRef),
      effectiveUnitIds,
    };
  }

  return {
    entryRoots: entryRoots.map(toOrgUnitRef),
    currentNode: null,
    breadcrumb: [],
    visibleChildren: entryRoots.map(toOrgUnitRef),
    effectiveUnitIds: [...allowedVisibleUnitIds],
  };
}

// ── Filter helper ────────────────────────────────────────────────────────────

/**
 * Append a unit-scope filter to a Prisma `where` clause.
 * No-op when scope covers all units.
 */
export function applyScopeFilter<T extends Record<string, unknown>>(
  baseWhere: T,
  scope: UserDashboardScope,
  unitIdField: string,
): T & Record<string, unknown> {
  if (scope.visibleUnitIds === "ALL") return baseWhere;
  return { ...baseWhere, [unitIdField]: { in: scope.visibleUnitIds } };
}
