import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Panel } from "@/components/panel";
import { OrgUnitTypeForm } from "@/components/tenant/org-unit-type-form";
import { requireTenantAdmin } from "@/lib/auth/session";
import { getShellIdentity } from "@/lib/auth/access";
import { tenantNavigationGroups } from "@/lib/navigation";

export default async function NewOrgTypePage() {
  const context = await requireTenantAdmin();

  return (
    <AppShell
      eyebrow="Organization"
      title="New unit type"
      userSummary={getShellIdentity(context)}
      navigationGroups={tenantNavigationGroups}
      headerActions={
        <Link
          href="/tenant-admin/structure"
          className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:border-slate-400"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
      }
    >
      <Panel eyebrow="Type" title="Create type">
        <OrgUnitTypeForm />
      </Panel>
    </AppShell>
  );
}
