import { AppShell } from "@/components/app-shell";
import { getShellIdentity } from "@/lib/auth/access";
import { tenantNavigationGroups } from "@/lib/navigation";
import { requireTenantAdmin } from "@/lib/auth/session";
import { KraKpiHub } from "./kra-kpi-hub";

export default async function KraKpiPage() {
  const context = await requireTenantAdmin();

  return (
    <AppShell
      eyebrow="KRA / KPI"
      title="Performance Framework"
      navigationGroups={tenantNavigationGroups}
      userSummary={getShellIdentity(context)}
    >
      <KraKpiHub />
    </AppShell>
  );
}
