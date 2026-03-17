import { AppShell } from "@/components/app-shell";
import { ChangePasswordForm } from "@/components/auth/change-password-form";
import { Panel } from "@/components/panel";
import { getShellIdentity } from "@/lib/auth/access";
import { requireTenantUser } from "@/lib/auth/session";

export default async function ChangePasswordPage() {
  const context = await requireTenantUser();

  return (
    <AppShell
      eyebrow="Account"
      title="Change your password"
      description="Update your password without losing access to your current organization context."
      userSummary={getShellIdentity(context)}
    >
      <Panel
        eyebrow="Security"
        title="Password management"
        description="Use a strong password with uppercase, lowercase, number, and special character."
        className="max-w-2xl"
      >
        <ChangePasswordForm />
      </Panel>
    </AppShell>
  );
}
