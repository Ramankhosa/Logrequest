import { AppShell } from "@/components/app-shell";
import { JournalCatalogManager } from "@/components/journals/journal-catalog-manager";
import { getShellIdentity } from "@/lib/auth/access";
import { requireSuperadmin } from "@/lib/auth/session";
import { superadminNavigationGroups } from "@/lib/navigation";

export default async function SuperadminJournalsPage() {
  const context = await requireSuperadmin();

  return (
    <AppShell
      eyebrow="Superadmin"
      title="Journal Catalog"
      description="Manage the global SCImago yearly catalog, preview imports before confirm, and maintain row-level journal data with full auditability."
      navigationGroups={superadminNavigationGroups}
      userSummary={getShellIdentity(context)}
    >
      <JournalCatalogManager scope="GLOBAL" />
    </AppShell>
  );
}
