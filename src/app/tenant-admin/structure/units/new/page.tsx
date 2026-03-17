import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Panel } from "@/components/panel";
import { OrgUnitForm } from "@/components/tenant/org-unit-form";
import { requireTenantAdmin } from "@/lib/auth/session";
import { getShellIdentity } from "@/lib/auth/access";
import { getOrgStructureDraftContext } from "@/lib/org-structure/service";
import { tenantNavigationGroups } from "@/lib/navigation";

export default async function NewOrgUnitPage() {
  const context = await requireTenantAdmin();
  const tenantId = context.tenant?.id;
  const draftContext = tenantId
    ? await getOrgStructureDraftContext(tenantId)
    : { draft: null, unitTypes: [], units: [] };

  return (
    <AppShell
      eyebrow="Organization"
      title="New unit"
      navigationGroups={tenantNavigationGroups}
      userSummary={getShellIdentity(context)}
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
      <Panel eyebrow="Unit" title="Create unit">
        <OrgUnitForm types={draftContext.unitTypes} units={draftContext.units} />
      </Panel>
    </AppShell>
  );
}
