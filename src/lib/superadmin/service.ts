import {
  InvitationStatus,
  MembershipStatus,
  Role,
  TenantEntitlementState,
  TenantLifecycleState,
  UserLifecycleState,
} from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getBaseUrl, sendAuthEmail } from "@/lib/auth/email";
import { hashPassword, validatePasswordPolicy } from "@/lib/auth/password";
import { normalizeEmail } from "@/lib/auth/utils";
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
    ownerPassword: z.string(),
    allowGracePeriodAccess: z.boolean(),
    notifyOwnerImmediately: z.boolean(),
    requireExactSocialMatch: z.boolean(),
  })
  .superRefine((value, context) => {
    const passwordError = validatePasswordPolicy(value.ownerPassword);

    if (passwordError) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ownerPassword"],
        message: passwordError,
      });
    }

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

  const ownerPasswordHash = await hashPassword(values.ownerPassword);
  const ownerNames = splitName(values.ownerName);
  const subscriptionStartDate = new Date(values.subscriptionStartDate);
  const subscriptionEndDate = new Date(values.subscriptionEndDate);
  const ownerCanSignIn = calculateTenantAccess({
    lifecycleState: values.lifecycleState,
    entitlementState: values.entitlementState,
    allowGracePeriodAccess: values.allowGracePeriodAccess,
  });

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
          passwordHash: ownerPasswordHash,
          emailVerifiedAt: new Date(),
          passwordSetAt: new Date(),
          passwordChangedAt: new Date(),
          lifecycleState: UserLifecycleState.ACTIVE,
          mustResetPassword: false,
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

      await tx.membership.create({
        data: {
          tenantId: tenant.id,
          userId: owner.id,
          role: Role.TENANT_OWNER,
          status: MembershipStatus.ACTIVE,
          invitationState: InvitationStatus.ACCEPTED,
          invitedAt: new Date(),
          activationTimestamp: new Date(),
          createdByUserId: input.actorUserId,
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
            ownerProvisioning: "password_based",
            ownerCanSignIn,
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

  let message = ownerCanSignIn
    ? "Tenant and owner account created. The owner can sign in now and provision tenant admins from the tenant workspace."
    : "Tenant and owner account created. Update the tenant lifecycle and entitlement state before the owner can sign in.";

  if (values.notifyOwnerImmediately) {
    const loginUrl = `${getBaseUrl()}/login`;

    try {
      await sendAuthEmail({
        to: created.ownerEmail,
        subject: `Your ${values.tenantName.trim()} owner account is ready`,
        text: ownerCanSignIn
          ? `Your tenant owner account is ready. Sign in at ${loginUrl} with your approved email.`
          : `Your tenant owner account is created, but sign-in will remain blocked until the tenant lifecycle and entitlement states allow access. Once enabled, sign in at ${loginUrl}.`,
        html: ownerCanSignIn
          ? `<p>Your tenant owner account is ready.</p><p>Sign in at <a href="${loginUrl}">${loginUrl}</a> with your approved email.</p><p>Tenant code: <strong>${created.tenantCode}</strong></p>`
          : `<p>Your tenant owner account is created, but sign-in is still blocked until the tenant lifecycle and entitlement states allow access.</p><p>Once enabled, sign in at <a href="${loginUrl}">${loginUrl}</a>.</p><p>Tenant code: <strong>${created.tenantCode}</strong></p>`,
      });
    } catch {
      message += " The tenant was saved, but the owner notification email could not be sent.";
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
