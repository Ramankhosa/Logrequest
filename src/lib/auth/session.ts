import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth/options";
import {
  type AuthContext,
  getPayloadForUserId,
} from "@/lib/auth/access";
import {
  hasAnyTenantCapability,
  hasTenantCapability,
  type TenantCapability,
} from "@/lib/tenant-permissions/service";
import { hasTenantServiceEnabled } from "@/lib/tenant-services/service";
import {
  getAccessibleMemberships,
  roleLandingPath,
  selectMembership,
} from "@/lib/auth/utils";

export async function requireSessionContext() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/login");
  }

  const payload = await getPayloadForUserId(session.user.id);

  if (!payload) {
    redirect("/login?error=Your%20session%20is%20no%20longer%20valid");
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.id },
    include: {
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
    },
  });

  if (!user) {
    redirect("/login");
  }

  const selectedMembership = selectMembership(
    getAccessibleMemberships(user.memberships),
    payload.tenantCode,
  );

  return {
    user,
    isSuperadmin: user.isSuperadmin,
    role: selectedMembership?.role ?? null,
    membership: selectedMembership,
    tenant: selectedMembership?.tenant ?? null,
    payload,
  } satisfies AuthContext;
}

export async function requireSuperadmin() {
  const context = await requireSessionContext();

  if (!context.isSuperadmin) {
    redirect(roleLandingPath(context));
  }

  return context;
}

export async function requireTenantAdmin() {
  const context = await requireSessionContext();

  if (
    context.isSuperadmin ||
    context.role === Role.TENANT_OWNER ||
    context.role === Role.TENANT_ADMIN
  ) {
    return context;
  }

  redirect(roleLandingPath(context));
}

export async function requireTenantCapability(capability: TenantCapability) {
  const context = await requireSessionContext();

  if (!context.user.id || !context.tenant?.id) {
    redirect(roleLandingPath(context));
  }

  const allowed = await hasTenantCapability({
    tenantId: context.tenant.id,
    userId: context.user.id,
    baseRole: context.role,
    capability,
  });

  if (allowed) {
    return context;
  }

  redirect(roleLandingPath(context));
}

export async function requireTenantAnyCapability(capabilities: TenantCapability[]) {
  const context = await requireSessionContext();

  if (!context.user.id || !context.tenant?.id) {
    redirect(roleLandingPath(context));
  }

  const allowed = await hasAnyTenantCapability({
    tenantId: context.tenant.id,
    userId: context.user.id,
    baseRole: context.role,
    capabilities,
  });

  if (allowed) {
    return context;
  }

  redirect(roleLandingPath(context));
}

export async function requireTenantService(serviceCode: "ACCREDITATION") {
  const context = await requireSessionContext();

  if (!context.user.id || !context.tenant?.id) {
    redirect(roleLandingPath(context));
  }

  const enabled = await hasTenantServiceEnabled(context.tenant.id, serviceCode);

  if (enabled) {
    return context;
  }

  redirect(roleLandingPath(context));
}

export async function requireTenantCapabilityAndService(
  capability: TenantCapability,
  serviceCode: "ACCREDITATION",
) {
  const context = await requireTenantCapability(capability);
  const enabled = await hasTenantServiceEnabled(context.tenant!.id, serviceCode);

  if (enabled) {
    return context;
  }

  redirect(roleLandingPath(context));
}

export async function requireTenantUser() {
  return requireSessionContext();
}
