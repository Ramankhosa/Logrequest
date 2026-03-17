import {
  InvitationStatus,
  MembershipStatus,
  Role,
  UserLifecycleState,
} from "@prisma/client";
import { addDays } from "date-fns";
import { z } from "zod";
import { getBaseUrl, sendAuthEmail } from "@/lib/auth/email";
import { createRawToken } from "@/lib/auth/password";
import { normalizeEmail } from "@/lib/auth/utils";
import { prisma } from "@/lib/prisma";
import type { MemberCreationResult } from "@/lib/tenant-admin/shared";

export type TenantDirectoryRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  invitation: string;
  lastAccess: string;
};

export type TenantWorkspaceCounts = {
  totalUsers: number;
  activeUsers: number;
  pendingInvites: number;
  tenantAdmins: number;
};

export type MemberCreationInput = {
  firstName: string;
  lastName: string;
  officialEmail: string;
  employeeId?: string;
  role: "TENANT_ADMIN" | "TENANT_USER";
};

const memberCreationSchema = z.object({
  firstName: z.string().trim().min(2),
  lastName: z.string().trim().min(2),
  officialEmail: z.string().trim().email(),
  employeeId: z.string().trim().optional(),
  role: z.enum(["TENANT_ADMIN", "TENANT_USER"]),
});

export async function getTenantWorkspaceCounts(
  tenantId: string,
): Promise<TenantWorkspaceCounts> {
  const [totalUsers, activeUsers, pendingInvites, tenantAdmins] =
    await Promise.all([
      prisma.membership.count({
        where: { tenantId },
      }),
      prisma.membership.count({
        where: {
          tenantId,
          status: MembershipStatus.ACTIVE,
        },
      }),
      prisma.membership.count({
        where: {
          tenantId,
          invitationState: InvitationStatus.PENDING,
        },
      }),
      prisma.membership.count({
        where: {
          tenantId,
          role: Role.TENANT_ADMIN,
        },
      }),
    ]);

  return {
    totalUsers,
    activeUsers,
    pendingInvites,
    tenantAdmins,
  };
}

export async function getTenantDirectoryRows(
  tenantId: string,
): Promise<TenantDirectoryRow[]> {
  const memberships = await prisma.membership.findMany({
    where: { tenantId },
    include: {
      user: true,
      invitations: {
        orderBy: {
          sentAt: "desc",
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return memberships.map((membership) => {
    const latestInvitation = membership.invitations[0] ?? null;

    return {
      id: membership.id,
      name: `${membership.user.firstName} ${membership.user.lastName}`.trim(),
      email: membership.user.officialEmail,
      role: membership.role,
      status: membership.status,
      invitation:
        latestInvitation?.status ?? membership.invitationState ?? "PENDING",
      lastAccess:
        membership.lastAccessTimestamp?.toISOString() ??
        membership.createdAt.toISOString(),
    };
  });
}

export async function createTenantMember(input: {
  actorUserId: string;
  actorRole: Role;
  tenantId: string;
  values: MemberCreationInput;
}): Promise<MemberCreationResult> {
  const parsedValues = memberCreationSchema.safeParse(input.values);

  if (!parsedValues.success) {
    return {
      status: "error",
      message: parsedValues.error.issues[0]?.message ?? "User details are invalid.",
    };
  }

  const values = parsedValues.data;
  const normalizedEmail = normalizeEmail(values.officialEmail);
  const trimmedEmployeeId = values.employeeId?.trim() || null;
  const role =
    values.role === "TENANT_ADMIN" ? Role.TENANT_ADMIN : Role.TENANT_USER;

  if (role === Role.TENANT_ADMIN && input.actorRole !== Role.TENANT_OWNER) {
    return {
      status: "error",
      message: "Only the tenant owner can create a tenant admin.",
    };
  }

  const existingUser = await prisma.user.findUnique({
    where: {
      officialEmail: normalizedEmail,
    },
    include: {
      memberships: {
        where: {
          tenantId: input.tenantId,
        },
      },
    },
  });

  if (existingUser?.memberships.length) {
    return {
      status: "error",
      message: "This email already belongs to a user in the tenant.",
    };
  }

  if (trimmedEmployeeId) {
    const employeeConflict = await prisma.membership.findUnique({
      where: {
        tenantId_employeeId: {
          tenantId: input.tenantId,
          employeeId: trimmedEmployeeId,
        },
      },
    });

    if (employeeConflict) {
      return {
        status: "error",
        message: "This UID is already assigned inside the tenant.",
      };
    }
  }

  const activationToken = createRawToken();
  const activationUrl = `${getBaseUrl()}/activate/${activationToken}`;

  const created = await prisma.$transaction(async (tx) => {
    const user =
      existingUser ??
      (await tx.user.create({
        data: {
          firstName: values.firstName.trim(),
          lastName: values.lastName.trim(),
          officialEmail: normalizedEmail,
          lifecycleState: UserLifecycleState.PENDING_ACTIVATION,
          allowedLoginMethods: ["PASSWORD", "GOOGLE", "MICROSOFT"],
        },
      }));

    const membership = await tx.membership.create({
      data: {
        tenantId: input.tenantId,
        userId: user.id,
        role,
        employeeId: trimmedEmployeeId,
        status: MembershipStatus.PENDING_ACTIVATION,
        invitationState: InvitationStatus.PENDING,
        invitedAt: new Date(),
        createdByUserId: input.actorUserId,
      },
    });

    await tx.invitation.create({
      data: {
        token: activationToken,
        tenantId: input.tenantId,
        userId: user.id,
        membershipId: membership.id,
        status: InvitationStatus.PENDING,
        invitedByUserId: input.actorUserId,
        expiresAt: addDays(new Date(), 7),
      },
    });

    await tx.auditLog.create({
      data: {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        targetType: "Membership",
        targetId: membership.id,
        action: "tenant.member.created",
        newState: {
          email: normalizedEmail,
          role,
          status: membership.status,
        },
      },
    });

    return {
      email: user.officialEmail,
    };
  });

  let message = role === Role.TENANT_ADMIN ? "Tenant admin created." : "User created.";

  try {
    await sendAuthEmail({
      to: created.email,
      subject: "Your account is ready",
      text: `Activate your account using this link: ${activationUrl}`,
      html: `<p>Activate your account:</p><p><a href="${activationUrl}">${activationUrl}</a></p>`,
    });
    message += " Invitation sent.";
  } catch {
    message += " Invitation email was not sent.";
  }

  return {
    status: "success",
    message,
  };
}
