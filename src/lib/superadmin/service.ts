import {
  InvitationStatus,
  MembershipStatus,
  Role,
  TenantEntitlementState,
  TenantLifecycleState,
  UserLifecycleState,
} from "@prisma/client";
import { addDays } from "date-fns";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getBaseUrl, sendAuthEmail } from "@/lib/auth/email";
import { createRawToken } from "@/lib/auth/password";
import { normalizeEmail } from "@/lib/auth/utils";
import { seedDefaultBenefitTypes } from "@/lib/kra-kpi/benefit-type-service";
import { seedDefaultContributorRoles } from "@/lib/kra-kpi/contributor-role-service";
import { prisma } from "@/lib/prisma";
import type { TenantCreationResult } from "@/lib/superadmin/shared";

const tenantCreationSchema = z
  .object({
    tenantName: z.string().trim().min(2),
    tenantCode: z.string().trim().min(3).regex(/^[A-Z0-9_-]+$/),
    legalOrganizationName: z.string().trim().min(3),
    organizationType: z.string().trim().min(2),
    primaryDomain: z.string().trim().min(3),
    subscriptionPlan: z.string().trim().min(2),
    subscriptionStartDate: z.string().trim().min(1),
    subscriptionEndDate: z.string().trim().min(1),
    lifecycleState: z.nativeEnum(TenantLifecycleState),
    entitlementState: z.nativeEnum(TenantEntitlementState),
    ownerName: z.string().trim().min(2),
    ownerEmail: z.string().trim().email(),
    allowGracePeriodAccess: z.boolean(),
    notifyOwnerImmediately: z.boolean(),
    requireExactSocialMatch: z.boolean(),
  })
  .superRefine((value, context) => {
    const startDate = new Date(value.subscriptionStartDate);
    const endDate = new Date(value.subscriptionEndDate);

    if (Number.isNaN(startDate.getTime())) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["subscriptionStartDate"],
        message: "Subscription start date is invalid.",
      });
    }

    if (Number.isNaN(endDate.getTime())) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["subscriptionEndDate"],
        message: "Subscription end date is invalid.",
      });
    }

    if (
      !Number.isNaN(startDate.getTime()) &&
      !Number.isNaN(endDate.getTime()) &&
      endDate < startDate
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["subscriptionEndDate"],
        message: "Subscription end date must be on or after the start date.",
      });
    }
  });

export type TenantCreationInput = z.infer<typeof tenantCreationSchema>;

export async function createTenantForSuperadmin(input: {
  actorUserId: string;
  values: TenantCreationInput;
}): Promise<TenantCreationResult> {
  const parsedInput = tenantCreationSchema.safeParse(input.values);

  if (!parsedInput.success) {
    return {
      status: "error",
      message: parsedInput.error.issues[0]?.message ?? "Tenant details are invalid.",
    };
  }

  const values = parsedInput.data;
  const normalizedCode = values.tenantCode.trim().toUpperCase();
  const normalizedEmail = normalizeEmail(values.ownerEmail);
  const normalizedDomain = values.primaryDomain.trim().toLowerCase();

  const existingTenant = await prisma.tenant.findFirst({
    where: {
      OR: [
        {
          code: normalizedCode,
        },
        {
          primaryDomains: {
            has: normalizedDomain,
          },
        },
      ],
    },
  });

  if (existingTenant?.code === normalizedCode) {
    return {
      status: "error",
      message: "Tenant code already exists. Use a different code.",
    };
  }

  if (existingTenant?.primaryDomains.includes(normalizedDomain)) {
    return {
      status: "error",
      message: "Primary domain is already assigned to another tenant.",
    };
  }

  const existingOwner = await prisma.user.findUnique({
    where: {
      officialEmail: normalizedEmail,
    },
  });

  if (existingOwner) {
    return {
      status: "error",
      message: "Owner email already exists. Use a different owner identity.",
    };
  }

  const ownerNames = splitName(values.ownerName);
  const subscriptionStartDate = new Date(values.subscriptionStartDate);
  const subscriptionEndDate = new Date(values.subscriptionEndDate);
  const ownerCanSignIn = calculateTenantAccess({
    lifecycleState: values.lifecycleState,
    entitlementState: values.entitlementState,
    allowGracePeriodAccess: values.allowGracePeriodAccess,
  });
  const activationToken = createRawToken();
  const activationUrl = `${getBaseUrl()}/activate/${activationToken}`;
  const invitationExpiresAt = addDays(new Date(), 7);

  let created:
    | {
        tenantId: string;
        tenantCode: string;
        ownerEmail: string;
      }
    | null = null;

  try {
    created = await prisma.$transaction(async (tx) => {
      const owner = await tx.user.create({
        data: {
          firstName: ownerNames.firstName,
          lastName: ownerNames.lastName,
          officialEmail: normalizedEmail,
          lifecycleState: UserLifecycleState.PENDING_ACTIVATION,
          allowedLoginMethods: ["PASSWORD", "GOOGLE", "MICROSOFT"],
        },
      });

      const tenant = await tx.tenant.create({
        data: {
          name: values.tenantName.trim(),
          code: normalizedCode,
          legalOrganizationName: values.legalOrganizationName.trim(),
          organizationType: values.organizationType.trim(),
          primaryDomains: [normalizedDomain],
          subscriptionPlan: values.subscriptionPlan.trim(),
          subscriptionStartDate,
          subscriptionEndDate,
          entitlementState: values.entitlementState,
          lifecycleState: values.lifecycleState,
          ownerUserId: owner.id,
          createdByUserId: input.actorUserId,
        },
      });

      await tx.tenantPolicy.create({
        data: {
          tenantId: tenant.id,
          exactSocialEmailMatchOnly: values.requireExactSocialMatch,
          allowPasswordLogin: true,
          allowGoogleLogin: true,
          allowMicrosoftLogin: true,
          allowGracePeriodAccess: values.allowGracePeriodAccess,
        },
      });

      const membership = await tx.membership.create({
        data: {
          tenantId: tenant.id,
          userId: owner.id,
          role: Role.TENANT_OWNER,
          status: MembershipStatus.PENDING_ACTIVATION,
          invitationState: InvitationStatus.PENDING,
          invitedAt: new Date(),
          createdByUserId: input.actorUserId,
        },
      });

      await tx.invitation.create({
        data: {
          token: activationToken,
          tenantId: tenant.id,
          userId: owner.id,
          membershipId: membership.id,
          status: InvitationStatus.PENDING,
          invitedByUserId: input.actorUserId,
          expiresAt: invitationExpiresAt,
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: tenant.id,
          actorUserId: input.actorUserId,
          actorRole: Role.SUPERADMIN,
          targetType: "Tenant",
          targetId: tenant.id,
          action: "tenant.created",
          newState: {
            code: tenant.code,
            lifecycleState: tenant.lifecycleState,
            entitlementState: tenant.entitlementState,
            ownerEmail: normalizedEmail,
          },
          metadata: {
            ownerProvisioning: "invite_based",
            ownerCanSignIn,
            ownerInvitationExpiresAt: invitationExpiresAt.toISOString(),
          },
        },
      });

      return {
        tenantId: tenant.id,
        tenantCode: tenant.code,
        ownerEmail: owner.officialEmail,
      };
    });
  } catch {
    return {
      status: "error",
      message: "Tenant creation failed. No tenant data was saved.",
    };
  }

  if (created) {
    await seedDefaultBenefitTypes(created.tenantId);
    await seedDefaultContributorRoles(created.tenantId);
  }

  let message = ownerCanSignIn
    ? "Tenant created and owner invited to activate their account. After activation, the owner can sign in and provision tenant admins from the tenant workspace."
    : "Tenant created and owner invited to activate their account. Access remains blocked until tenant lifecycle and entitlement states allow sign-in.";

  if (values.notifyOwnerImmediately) {
    try {
      await sendAuthEmail({
        to: created.ownerEmail,
        subject: `Activate your ${values.tenantName.trim()} owner account`,
        text: ownerCanSignIn
          ? `Activate your tenant owner account using this link: ${activationUrl}. After activation, you can sign in with your approved email.`
          : `Activate your tenant owner account using this link: ${activationUrl}. Sign-in will remain blocked until tenant lifecycle and entitlement states allow access.`,
        html: ownerCanSignIn
          ? `<p>Activate your tenant owner account using the link below.</p><p><a href="${activationUrl}">${activationUrl}</a></p><p>After activation, you can sign in with your approved email.</p><p>Tenant code: <strong>${created.tenantCode}</strong></p>`
          : `<p>Activate your tenant owner account using the link below.</p><p><a href="${activationUrl}">${activationUrl}</a></p><p>Sign-in will remain blocked until tenant lifecycle and entitlement states allow access.</p><p>Tenant code: <strong>${created.tenantCode}</strong></p>`,
      });
      message += " Invitation sent.";
    } catch {
      message += " The tenant was saved, but the owner invitation email could not be sent.";
    }
  }

  revalidatePath("/superadmin");
  revalidatePath("/superadmin/tenants/new");

  return {
    status: "success",
    message,
    tenantId: created.tenantId,
    tenantCode: created.tenantCode,
    ownerEmail: created.ownerEmail,
    ownerCanSignIn,
  };
}

function splitName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const firstName = parts.shift() ?? "Tenant";
  const lastName = parts.join(" ") || "Owner";

  return {
    firstName,
    lastName,
  };
}

function calculateTenantAccess(input: {
  lifecycleState: TenantLifecycleState;
  entitlementState: TenantEntitlementState;
  allowGracePeriodAccess: boolean;
}) {
  const lifecycleAllowed =
    input.lifecycleState === TenantLifecycleState.ACTIVE ||
    (input.lifecycleState === TenantLifecycleState.GRACE_PERIOD &&
      input.allowGracePeriodAccess);

  const entitlementAllowed =
    input.entitlementState === TenantEntitlementState.TRIAL_ACTIVE ||
    input.entitlementState === TenantEntitlementState.PAID_ACTIVE ||
    (input.entitlementState === TenantEntitlementState.GRACE_PERIOD &&
      input.allowGracePeriodAccess);

  return lifecycleAllowed && entitlementAllowed;
}
