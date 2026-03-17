import type { MembershipStatus, Role, UserLifecycleState } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type DbTracker = {
  tenantIds: Set<string>;
  userIds: Set<string>;
};

type CreateUserOptions = {
  firstName?: string;
  lastName?: string;
  lifecycleState?: UserLifecycleState;
};

type CreateTenantOptions = {
  name?: string;
  code?: string;
};

function randomToken(prefix: string) {
  const rand = Math.random().toString(36).slice(2, 10).toUpperCase();
  return `${prefix}_${Date.now()}_${rand}`;
}

export function newDbTracker(): DbTracker {
  return {
    tenantIds: new Set<string>(),
    userIds: new Set<string>(),
  };
}

export async function createTestTenant(
  tracker: DbTracker,
  options: CreateTenantOptions = {},
) {
  const code = options.code ?? randomToken("T");
  const tenant = await prisma.tenant.create({
    data: {
      name: options.name ?? `Tenant ${code}`,
      code,
      legalOrganizationName: options.name ?? `Legal ${code}`,
      organizationType: "UNIVERSITY",
      primaryDomains: [`${code.toLowerCase()}.example.edu`],
      subscriptionPlan: "TRIAL",
      lifecycleState: "ACTIVE",
    },
  });

  tracker.tenantIds.add(tenant.id);
  return tenant;
}

export async function createTestUser(
  tracker: DbTracker,
  options: CreateUserOptions = {},
) {
  const suffix = randomToken("U").toLowerCase();
  const user = await prisma.user.create({
    data: {
      firstName: options.firstName ?? "Test",
      lastName: options.lastName ?? "User",
      officialEmail: `${suffix}@example.com`,
      lifecycleState: options.lifecycleState ?? "ACTIVE",
    },
  });

  tracker.userIds.add(user.id);
  return user;
}

export async function createTestMembership(input: {
  tenantId: string;
  userId: string;
  role: Role;
  status?: MembershipStatus;
  createdByUserId?: string;
}) {
  return prisma.membership.create({
    data: {
      tenantId: input.tenantId,
      userId: input.userId,
      role: input.role,
      status: input.status ?? "ACTIVE",
      invitationState: "ACCEPTED",
      createdByUserId: input.createdByUserId ?? input.userId,
    },
  });
}

export async function createTenantActor(
  tracker: DbTracker,
  role: Role = "TENANT_OWNER",
) {
  const tenant = await createTestTenant(tracker);
  const actor = await createTestUser(tracker, {
    firstName: "Actor",
    lastName: role.replace("TENANT_", ""),
  });
  const membership = await createTestMembership({
    tenantId: tenant.id,
    userId: actor.id,
    role,
    createdByUserId: actor.id,
  });

  return { tenant, actor, membership };
}

export async function cleanupTrackedData(tracker: DbTracker) {
  const tenantIds = [...tracker.tenantIds];
  const userIdCandidates = new Set<string>(tracker.userIds);

  if (tenantIds.length) {
    const tenantMemberships = await prisma.membership.findMany({
      where: {
        tenantId: {
          in: tenantIds,
        },
      },
      select: {
        userId: true,
      },
    });
    for (const membership of tenantMemberships) {
      userIdCandidates.add(membership.userId);
    }

    await prisma.auditLog.deleteMany({
      where: {
        tenantId: {
          in: tenantIds,
        },
      },
    });
    await prisma.tenant.deleteMany({
      where: {
        id: {
          in: tenantIds,
        },
      },
    });
  }

  for (const userId of userIdCandidates) {
    const memberships = await prisma.membership.count({
      where: { userId },
    });
    if (memberships === 0) {
      await prisma.user.deleteMany({
        where: { id: userId },
      });
    }
  }
}
