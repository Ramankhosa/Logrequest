import { AppShell } from "@/components/app-shell";
import { InstitutionalDataManager } from "@/components/accreditation/institutional-data-manager";
import { getShellIdentity } from "@/lib/auth/access";
import { requireTenantCapabilityAndService } from "@/lib/auth/session";
import { tenantNavigationGroups } from "@/lib/navigation";

export default async function TenantInstitutionalDataPage() {
  const context = await requireTenantCapabilityAndService(
    "MANAGE_ACCREDITATION",
    "ACCREDITATION",
  );

  return (
    <AppShell
      eyebrow="Tenant"
      title="Institutional Data"
      description="Manage institutional sources, reusable metrics, adapter refreshes, imports, and metric-source resolution for accreditation."
      navigationGroups={tenantNavigationGroups}
      userSummary={getShellIdentity(context)}
    >
      <InstitutionalDataManager />
    </AppShell>
  );
}
