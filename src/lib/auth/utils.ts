import {
  MembershipStatus,
  Role,
  TenantEntitlementState,
  TenantLifecycleState,
  UserLifecycleState,
  type Membership,
  type Tenant,
  type TenantPolicy,
  type User,
} from "@prisma/client";

type MembershipWithTenant = Membership & {
  tenant: Tenant & {
    policy: TenantPolicy | null;
  };
};

const defaultLoginMethods = ["PASSWORD"];

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function parseLoginMethods(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).toUpperCase().trim())
      .filter(Boolean);
  }

  return defaultLoginMethods;
}

export function userAllowsLoginMethod(user: Pick<User, "allowedLoginMethods">, method: string) {
  return parseLoginMethods(user.allowedLoginMethods).includes(method.toUpperCase());
}

export function userAccessError(user: Pick<User, "lifecycleState" | "lockedUntil">) {
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return "Your account is temporarily locked. Try again later or reset your password.";
  }

  switch (user.lifecycleState) {
    case UserLifecycleState.ACTIVE:
      return null;
    case UserLifecycleState.PENDING_ACTIVATION:
    case UserLifecycleState.INVITED:
    case UserLifecycleState.DRAFT:
      return "Your account is not activated yet.";
    case UserLifecycleState.LOCKED:
      return "Your account is locked. Contact your administrator.";
    case UserLifecycleState.SUSPENDED:
      return "Your account is suspended. Contact your administrator.";
    case UserLifecycleState.REVOKED:
    case UserLifecycleState.ARCHIVED:
      return "Your account does not have access to the platform.";
    default:
      return "Your account cannot access the platform right now.";
  }
}

export function membershipAllowsAccess(membership: MembershipWithTenant) {
  return membership.status === MembershipStatus.ACTIVE && tenantAllowsAccess(membership.tenant);
}

export function tenantAllowsAccess(
  tenant: Tenant & {
    policy?: TenantPolicy | null;
  },
) {
  const allowGrace = tenant.policy?.allowGracePeriodAccess ?? true;

  const lifecycleAllowed =
    tenant.lifecycleState === TenantLifecycleState.ACTIVE ||
    (tenant.lifecycleState === TenantLifecycleState.GRACE_PERIOD && allowGrace);

  const entitlementAllowed =
    tenant.entitlementState === TenantEntitlementState.TRIAL_ACTIVE ||
    tenant.entitlementState === TenantEntitlementState.PAID_ACTIVE ||
    (tenant.entitlementState === TenantEntitlementState.GRACE_PERIOD && allowGrace);

  return lifecycleAllowed && entitlementAllowed;
}

export function providerAllowedByTenant(
  membership: MembershipWithTenant,
  provider: "GOOGLE" | "MICROSOFT",
) {
  if (!membershipAllowsAccess(membership)) {
    return false;
  }

  if (provider === "GOOGLE") {
    return membership.tenant.policy?.allowGoogleLogin ?? true;
  }

  return membership.tenant.policy?.allowMicrosoftLogin ?? true;
}

export function passwordAllowedByTenant(membership: MembershipWithTenant) {
  return membershipAllowsAccess(membership) && (membership.tenant.policy?.allowPasswordLogin ?? true);
}

export function selectMembership(
  memberships: MembershipWithTenant[],
  tenantCode?: string | null,
) {
  if (tenantCode) {
    const byCode = memberships.find(
      (membership) => membership.tenant.code.toLowerCase() === tenantCode.toLowerCase(),
    );

    if (byCode) {
      return byCode;
    }
  }

  return memberships[0] ?? null;
}

export function getAccessibleMemberships(memberships: MembershipWithTenant[]) {
  return memberships.filter(membershipAllowsAccess);
}

export function roleLandingPath(input: {
  isSuperadmin: boolean;
  role: Role | null;
}) {
  if (input.isSuperadmin) {
    return "/superadmin";
  }

  if (input.role === Role.TENANT_OWNER || input.role === Role.TENANT_ADMIN) {
    return "/tenant-admin";
  }

  return "/workspace";
}

export function formatRoleLabel(role: Role | null, isSuperadmin: boolean) {
  if (isSuperadmin) {
    return "Superadmin";
  }

  if (!role) {
    return "User";
  }

  return role
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}
