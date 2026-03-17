import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { TenantWizard } from "@/components/tenant-wizard";
import { getShellIdentity } from "@/lib/auth/access";
import { superadminNavigationGroups } from "@/lib/navigation";
import { requireSuperadmin } from "@/lib/auth/session";

export default async function NewTenantPage() {
  const context = await requireSuperadmin();

  return (
    <AppShell
      eyebrow="Superadmin"
      title="Create a tenant"
      description="Tenant creation runs on a dedicated page so the workflow stays focused. Nothing is written to the database until the final submission succeeds."
      navigationGroups={superadminNavigationGroups}
      userSummary={getShellIdentity(context)}
    >
      <div>
        <Link
          className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
          href="/superadmin"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to superadmin
        </Link>
      </div>

      <TenantWizard />
    </AppShell>
  );
}
