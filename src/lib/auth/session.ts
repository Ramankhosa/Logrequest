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

export async function requireTenantUser() {
  return requireSessionContext();
}
