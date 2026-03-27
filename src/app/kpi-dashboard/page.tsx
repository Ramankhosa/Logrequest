import { AppShell } from "@/components/app-shell";
import { DashboardHub } from "@/components/dashboard/dashboard-hub";
import { getShellIdentity } from "@/lib/auth/access";
import { requireTenantUser } from "@/lib/auth/session";
import { getNavigationForRole } from "@/lib/navigation";
import { resolveUserDashboardScope } from "@/lib/org-structure/scope-resolver";

export default async function KpiDashboardPage() {
  const context = await requireTenantUser();
  const tenantId = context.payload.tenantId;

  if (!tenantId) {
    throw new Error("Tenant context is required for the KPI dashboard.");
  }

  const scope = await resolveUserDashboardScope(tenantId, context.payload.id);

  return (
    <AppShell
      eyebrow="KPI Dashboard"
      title="Performance Hub"
      description="One place to track personal progress, pending reviews, unit health, and workflow signals without bouncing across separate KPI screens."
      navigationGroups={getNavigationForRole(context.role, context.isSuperadmin)}
      userSummary={getShellIdentity(context)}
    >
      <DashboardHub scope={scope} />
    </AppShell>
  );
}
