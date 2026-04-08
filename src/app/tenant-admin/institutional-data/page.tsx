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
      title="Build Data Bank"
      description="Set up guided institutional source packs, upload partial spreadsheets with warnings, and turn raw institutional data into reusable accreditation metrics."
      navigationGroups={tenantNavigationGroups}
      userSummary={getShellIdentity(context)}
    >
      <InstitutionalDataManager />
    </AppShell>
  );
}
