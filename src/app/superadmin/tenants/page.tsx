import Link from "next/link";
import { Plus } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { TenantServicesManager } from "@/components/accreditation/tenant-services-manager";
import { getShellIdentity } from "@/lib/auth/access";
import { requireSuperadmin } from "@/lib/auth/session";
import { superadminNavigationGroups } from "@/lib/navigation";
import { listSuperadminTenantsWithServiceStates } from "@/lib/accreditation/service";

export default async function SuperadminTenantsPage() {
  const context = await requireSuperadmin();
  const tenants = await listSuperadminTenantsWithServiceStates();

  return (
    <AppShell
      eyebrow="Superadmin"
      title="Tenants"
      description="Review tenant lifecycle state alongside module-level service enablement."
      navigationGroups={superadminNavigationGroups}
      userSummary={getShellIdentity(context)}
      headerActions={
        <Link
          href="/superadmin/tenants/new"
          className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
        >
          <Plus className="h-4 w-4" />
          New Tenant
        </Link>
      }
    >
      <TenantServicesManager initialTenants={tenants} />
    </AppShell>
  );
}
