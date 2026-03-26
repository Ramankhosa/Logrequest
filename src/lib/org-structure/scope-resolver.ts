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
          version: { tenantId, state: { in: ["PUBLISHED", "VALIDATED"] } },
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
