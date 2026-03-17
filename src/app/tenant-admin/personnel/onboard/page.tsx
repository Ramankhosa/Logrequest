import { Role } from "@prisma/client";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Panel } from "@/components/panel";
import { PersonnelOnboardForm } from "@/components/tenant/personnel-onboard-form";
import { getShellIdentity } from "@/lib/auth/access";
import { requireTenantAdmin } from "@/lib/auth/session";
import { getOnboardingOptions } from "@/lib/personnel/service";
import { tenantNavigationGroups } from "@/lib/navigation";

export default async function PersonnelOnboardPage() {
  const context = await requireTenantAdmin();
  const tenantId = context.tenant!.id;
  const canCreateAdmin = context.role === Role.TENANT_OWNER;
  const options = await getOnboardingOptions(tenantId);

  return (
    <AppShell
      eyebrow="Personnel"
      title="Onboard Member"
      navigationGroups={tenantNavigationGroups}
      userSummary={getShellIdentity(context)}
      headerActions={
        <Link
          className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
          href="/tenant-admin/personnel"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
      }
    >
      <Panel eyebrow="Onboarding" title="Onboard Member">
        <PersonnelOnboardForm
          canCreateAdmin={canCreateAdmin}
          units={options.units}
          roles={options.roles}
        />
      </Panel>
    </AppShell>
  );
}
