"use server";

import { compare } from "bcryptjs";
import { InvitationStatus, MembershipStatus, UserLifecycleState } from "@prisma/client";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { getBaseUrl, sendAuthEmail } from "@/lib/auth/email";
import { authOptions } from "@/lib/auth/options";
import {
  createRawToken,
  hashPassword,
  hashToken,
  validatePasswordPolicy,
} from "@/lib/auth/password";
import { normalizeEmail } from "@/lib/auth/utils";

export type AuthActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

export const initialAuthActionState: AuthActionState = {
  status: "idle",
  message: "",
};

export async function requestPasswordResetAction(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();

  if (!email) {
    return {
      status: "error",
      message: "Email is required.",
    };
  }

  const user = await prisma.user.findUnique({
    where: {
      officialEmail: normalizeEmail(email),
    },
  });

  if (user) {
    const rawToken = createRawToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    const resetUrl = `${getBaseUrl()}/reset-password?token=${rawToken}`;

    await sendAuthEmail({
      to: user.officialEmail,
      subject: "Reset your password",
      text: `Reset your password using this link: ${resetUrl}`,
      html: `<p>Reset your password using the link below:</p><p><a href="${resetUrl}">${resetUrl}</a></p>`,
    });
  }

  return {
    status: "success",
    message:
      "If that email is registered, a password reset link has been sent.",
  };
}

export async function resetPasswordAction(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!token) {
    return {
      status: "error",
      message: "Reset token is missing.",
    };
  }

  if (password !== confirmPassword) {
    return {
      status: "error",
      message: "Passwords do not match.",
    };
  }

  const passwordError = validatePasswordPolicy(password);

  if (passwordError) {
    return {
      status: "error",
      message: passwordError,
    };
  }

  const passwordResetToken = await prisma.passwordResetToken.findUnique({
    where: {
      tokenHash: hashToken(token),
    },
    include: {
      user: true,
    },
  });

  if (
    !passwordResetToken ||
    passwordResetToken.usedAt ||
    passwordResetToken.expiresAt < new Date()
  ) {
    return {
      status: "error",
      message: "This password reset link is invalid or expired.",
    };
  }

  await prisma.user.update({
    where: {
      id: passwordResetToken.userId,
    },
    data: {
      passwordHash: await hashPassword(password),
      passwordSetAt: new Date(),
      passwordChangedAt: new Date(),
      mustResetPassword: false,
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });

  await prisma.passwordResetToken.update({
    where: {
      id: passwordResetToken.id,
    },
    data: {
      usedAt: new Date(),
    },
  });

  return {
    status: "success",
    message: "Your password has been reset successfully. You can sign in now.",
  };
}

export async function changePasswordAction(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return {
      status: "error",
      message: "You must be signed in to change your password.",
    };
  }

  const currentPassword = String(formData.get("currentPassword") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (password !== confirmPassword) {
    return {
      status: "error",
      message: "Passwords do not match.",
    };
  }

  const passwordError = validatePasswordPolicy(password);

  if (passwordError) {
    return {
      status: "error",
      message: passwordError,
    };
  }

  const user = await prisma.user.findUnique({
    where: {
      id: session.user.id,
    },
  });

  if (!user?.passwordHash) {
    return {
      status: "error",
      message: "This account does not have a password yet.",
    };
  }

  const passwordMatches = await compare(currentPassword, user.passwordHash);

  if (!passwordMatches) {
    return {
      status: "error",
      message: "Current password is incorrect.",
    };
  }

  await prisma.user.update({
    where: {
      id: user.id,
    },
    data: {
      passwordHash: await hashPassword(password),
      passwordChangedAt: new Date(),
      mustResetPassword: false,
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });

  return {
    status: "success",
    message: "Your password has been changed successfully.",
  };
}

export async function activateInvitationAction(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!token) {
    return {
      status: "error",
      message: "Invitation token is missing.",
    };
  }

  if (password !== confirmPassword) {
    return {
      status: "error",
      message: "Passwords do not match.",
    };
  }

  const passwordError = validatePasswordPolicy(password);

  if (passwordError) {
    return {
      status: "error",
      message: passwordError,
    };
  }

  const invitation = await prisma.invitation.findUnique({
    where: {
      token,
    },
    include: {
      user: true,
      membership: true,
    },
  });

  if (!invitation) {
    return {
      status: "error",
      message: "Invitation link is invalid.",
    };
  }

  if (invitation.status !== InvitationStatus.PENDING) {
    return {
      status: "error",
      message: "Invitation link is expired or already used.",
    };
  }

  if (invitation.expiresAt < new Date()) {
    await prisma.$transaction(async (tx) => {
      await tx.invitation.update({
        where: {
          id: invitation.id,
        },
        data: {
          status: InvitationStatus.EXPIRED,
        },
      });

      if (
        invitation.membershipId &&
        invitation.membership?.invitationState === InvitationStatus.PENDING
      ) {
        await tx.membership.update({
          where: { id: invitation.membershipId },
          data: {
            invitationState: InvitationStatus.EXPIRED,
          },
        });
      }
    });

    return {
      status: "error",
      message: "Invitation link is expired or already used.",
    };
  }

  await prisma.user.update({
    where: { id: invitation.userId },
    data: {
      passwordHash: await hashPassword(password),
      passwordSetAt: new Date(),
      passwordChangedAt: new Date(),
      emailVerifiedAt: new Date(),
      lifecycleState: UserLifecycleState.ACTIVE,
      mustResetPassword: false,
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });

  if (invitation.membershipId) {
    await prisma.membership.update({
      where: { id: invitation.membershipId },
      data: {
        status: MembershipStatus.ACTIVE,
        invitationState: InvitationStatus.ACCEPTED,
        activationTimestamp: new Date(),
      },
    });
  }

  await prisma.invitation.update({
    where: {
      id: invitation.id,
    },
    data: {
      status: InvitationStatus.ACCEPTED,
      acceptedAt: new Date(),
    },
  });

  return {
    status: "success",
    message: "Your account is activated. You can sign in now.",
  };
}
