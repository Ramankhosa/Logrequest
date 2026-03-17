import { compare } from "bcryptjs";
import {
  AuthProvider,
  MembershipStatus,
  Role,
  UserLifecycleState,
  type Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  formatRoleLabel,
  getAccessibleMemberships,
  normalizeEmail,
  parseLoginMethods,
  passwordAllowedByTenant,
  providerAllowedByTenant,
  selectMembership,
  userAccessError,
} from "@/lib/auth/utils";

const accessInclude = {
  socialAccounts: true,
  memberships: {
    include: {
      tenant: {
        include: {
          policy: true,
        },
      },
    },
  },
} satisfies Prisma.UserInclude;

type UserWithAccess = Prisma.UserGetPayload<{
  include: typeof accessInclude;
}>;

export type SessionPayload = {
  id: string;
  email: string;
  name: string;
  firstName: string;
  lastName: string;
  isSuperadmin: boolean;
  role: Role | null;
  tenantId: string | null;
  tenantCode: string | null;
  tenantName: string | null;
};

export type AuthContext = {
  user: UserWithAccess;
  role: Role | null;
  isSuperadmin: boolean;
  tenant: UserWithAccess["memberships"][number]["tenant"] | null;
  membership: UserWithAccess["memberships"][number] | null;
  payload: SessionPayload;
};

export async function validateCredentialsLogin(input: {
  email: string;
  password: string;
  tenantCode?: string | null;
}) {
  const user = await prisma.user.findUnique({
    where: {
      officialEmail: normalizeEmail(input.email),
    },
    include: accessInclude,
  });

  if (!user) {
    return { ok: false as const, message: "Invalid email or password." };
  }

  const accessError = userAccessError(user);

  if (accessError) {
    return { ok: false as const, message: accessError };
  }

  if (!user.passwordHash) {
    return {
      ok: false as const,
      message: "Your account does not have a password yet. Use your invitation link or social login if enabled.",
    };
  }

  if (!parseLoginMethods(user.allowedLoginMethods).includes("PASSWORD")) {
    return {
      ok: false as const,
      message: "Password login is not enabled for this account.",
    };
  }

  const passwordMatches = await compare(input.password, user.passwordHash);

  if (!passwordMatches) {
    const nextFailedCount = user.failedLoginCount + 1;
    const lockedUntil =
      nextFailedCount >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;

    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: nextFailedCount,
        lockedUntil,
      },
    });

    return { ok: false as const, message: "Invalid email or password." };
  }

  const payload = resolveUserSessionPayload(user, input.tenantCode ?? null, "PASSWORD");

  if (!payload.ok) {
    return payload;
  }

  await recordSuccessfulLogin(user.id, payload.membership?.id ?? null);

  return {
    ok: true as const,
    payload: payload.payload,
  };
}

export async function validateSocialLogin(input: {
  email: string;
  provider: AuthProvider;
  providerAccountId: string;
}) {
  const user = await prisma.user.findUnique({
    where: {
      officialEmail: normalizeEmail(input.email),
    },
    include: accessInclude,
  });

  if (!user) {
    return {
      ok: false as const,
      message: "This social account is not pre-provisioned for the platform.",
    };
  }

  const accessError = userAccessError(user);

  if (accessError) {
    return { ok: false as const, message: accessError };
  }

  if (!parseLoginMethods(user.allowedLoginMethods).includes(input.provider)) {
    return {
      ok: false as const,
      message: "This social login method is not enabled for your account.",
    };
  }

  const payload = resolveUserSessionPayload(user, null, input.provider);

  if (!payload.ok) {
    return payload;
  }

  const existingBinding = await prisma.socialAccount.findUnique({
    where: {
      userId_provider: {
        userId: user.id,
        provider: input.provider,
      },
    },
  });

  const providerAccountOwner = await prisma.socialAccount.findUnique({
    where: {
      provider_providerAccountId: {
        provider: input.provider,
        providerAccountId: input.providerAccountId,
      },
    },
  });

  if (providerAccountOwner && providerAccountOwner.userId !== user.id) {
    return {
      ok: false as const,
      message: "This social account is already linked to another user.",
    };
  }

  if (existingBinding && existingBinding.providerAccountId !== input.providerAccountId) {
    return {
      ok: false as const,
      message: "Your configured social account does not match the approved identity.",
    };
  }

  if (!existingBinding) {
    await prisma.socialAccount.create({
      data: {
        userId: user.id,
        provider: input.provider,
        providerAccountId: input.providerAccountId,
        email: normalizeEmail(input.email),
      },
    });
  } else {
    await prisma.socialAccount.update({
      where: { id: existingBinding.id },
      data: {
        email: normalizeEmail(input.email),
        lastUsedAt: new Date(),
      },
    });
  }

  await recordSuccessfulLogin(user.id, payload.membership?.id ?? null);

  return {
    ok: true as const,
    payload: payload.payload,
  };
}

export async function getPayloadForUserId(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: accessInclude,
  });

  if (!user) {
    return null;
  }

  const payload = resolveUserSessionPayload(user, null, null);
  return payload.ok ? payload.payload : null;
}

export function getShellIdentity(context: AuthContext) {
  return {
    name: context.payload.name,
    email: context.payload.email,
    roleLabel: formatRoleLabel(context.role, context.isSuperadmin),
    tenantLabel: context.payload.tenantName,
  };
}

function resolveUserSessionPayload(
  user: UserWithAccess,
  tenantCode: string | null | undefined,
  provider: "PASSWORD" | AuthProvider | null,
) {
  if (user.isSuperadmin) {
    return {
      ok: true as const,
      membership: null,
      payload: buildPayload(user, null),
    };
  }

  const accessibleMemberships = getAccessibleMemberships(user.memberships).filter(
    (membership) => {
      if (!provider) {
        return true;
      }

      if (provider === "PASSWORD") {
        return passwordAllowedByTenant(membership);
      }

      return providerAllowedByTenant(membership, provider);
    },
  );

  if (!accessibleMemberships.length) {
    const pendingMembership = user.memberships.find(
      (membership) =>
        membership.status === MembershipStatus.INVITED ||
        membership.status === MembershipStatus.PENDING_ACTIVATION,
    );

    if (pendingMembership || user.lifecycleState === UserLifecycleState.PENDING_ACTIVATION) {
      return {
        ok: false as const,
        message: "Your account is not activated yet.",
      };
    }

    return {
      ok: false as const,
      message: "Your organization does not currently allow access.",
    };
  }

  const membership = selectMembership(accessibleMemberships, tenantCode);

  if (!membership) {
    return {
      ok: false as const,
      message: "This account is not active for the selected organization.",
    };
  }

  return {
    ok: true as const,
    membership,
    payload: buildPayload(user, membership),
  };
}

function buildPayload(
  user: UserWithAccess,
  membership: UserWithAccess["memberships"][number] | null,
) {
  return {
    id: user.id,
    email: user.officialEmail,
    name: `${user.firstName} ${user.lastName}`.trim(),
    firstName: user.firstName,
    lastName: user.lastName,
    isSuperadmin: user.isSuperadmin,
    role: membership?.role ?? null,
    tenantId: membership?.tenantId ?? null,
    tenantCode: membership?.tenant.code ?? null,
    tenantName: membership?.tenant.name ?? null,
  } satisfies SessionPayload;
}

async function recordSuccessfulLogin(userId: string, membershipId: string | null) {
  await prisma.user.update({
    where: { id: userId },
    data: {
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
    },
  });

  if (membershipId) {
    await prisma.membership.update({
      where: { id: membershipId },
      data: {
        lastAccessTimestamp: new Date(),
      },
    });
  }
}
