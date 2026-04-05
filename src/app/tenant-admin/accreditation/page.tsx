import { AppShell } from "@/components/app-shell";
import { AccreditationManager } from "@/components/accreditation/accreditation-manager";
import { InstitutionalDataSummaryCard } from "@/components/accreditation/institutional-data-summary-card";
import { WorkspaceManager } from "@/components/accreditation/workspace-manager";
import { getShellIdentity } from "@/lib/auth/access";
import { requireTenantCapabilityAndService } from "@/lib/auth/session";
import { tenantNavigationGroups } from "@/lib/navigation";

export default async function TenantAccreditationPage({
  searchParams,
}: {
  searchParams?: Promise<{ kpiId?: string }>;
}) {
  const context = await requireTenantCapabilityAndService(
    "MANAGE_ACCREDITATION",
    "ACCREDITATION",
  );
  const params = searchParams ? await searchParams : undefined;

  return (
    <AppShell
      eyebrow="Tenant"
      title="Accreditation"
      description="Manage filing workspaces, framework setup, profiles, criteria, evidence, and KPI registry links."
      navigationGroups={tenantNavigationGroups}
      userSummary={getShellIdentity(context)}
    >
      <div className="space-y-6">
        <InstitutionalDataSummaryCard />
        <WorkspaceManager />
        <section className="rounded-[1.75rem] border border-slate-200/80 bg-white/60 p-6">
          <AccreditationManager scope="tenant" initialKpiId={params?.kpiId ?? null} />
        </section>
      </div>
    </AppShell>
  );
}
