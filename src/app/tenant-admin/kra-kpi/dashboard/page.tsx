import { AppShell } from "@/components/app-shell";
import { getShellIdentity } from "@/lib/auth/access";
import { tenantNavigationGroups } from "@/lib/navigation";
import { requireTenantAdmin } from "@/lib/auth/session";
import { AdminDashboard } from "@/components/tenant/kra-kpi/admin-dashboard";

export default async function DashboardPage() {
  const context = await requireTenantAdmin();

  return (
    <AppShell
      eyebrow="KRA / KPI"
      title="Dashboard"
      navigationGroups={tenantNavigationGroups}
      userSummary={getShellIdentity(context)}
    >
      <AdminDashboard />
    </AppShell>
  );
}
