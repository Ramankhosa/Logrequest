import { AppShell } from "@/components/app-shell";
import { JournalCatalogManager } from "@/components/journals/journal-catalog-manager";
import { getShellIdentity } from "@/lib/auth/access";
import { requireTenantAdmin } from "@/lib/auth/session";
import { tenantNavigationGroups } from "@/lib/navigation";

export default async function TenantJournalCatalogPage() {
  const context = await requireTenantAdmin();

  return (
    <AppShell
      eyebrow="KRA / KPI"
      title="Journal Catalog"
      description="Browse the effective journal catalog for this tenant, upload tenant additions or overrides, and maintain journal rows without changing the platform-wide source data."
      navigationGroups={tenantNavigationGroups}
      userSummary={getShellIdentity(context)}
    >
      <JournalCatalogManager scope="TENANT" />
    </AppShell>
  );
}
