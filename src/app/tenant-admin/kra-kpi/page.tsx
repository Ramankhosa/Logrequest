import { AppShell } from "@/components/app-shell";
import { getShellIdentity } from "@/lib/auth/access";
import { requireTenantAnyCapability } from "@/lib/auth/session";
import { tenantNavigationGroups } from "@/lib/navigation";
import { getTenantPermissionAccessContext } from "@/lib/tenant-permissions/service";
import { KraKpiHub } from "./kra-kpi-hub";

export default async function KraKpiPage() {
  const context = await requireTenantAnyCapability([
    "MANAGE_KRA",
    "MANAGE_KPI",
    "MANAGE_TARGETS",
    "MANAGE_WORKFLOW",
    "MANAGE_REWARDS",
  ]);
  const accessContext = await getTenantPermissionAccessContext({
    tenantId: context.tenant!.id,
    userId: context.user.id,
    baseRole: context.role,
  });

  return (
    <AppShell
      eyebrow="KRA / KPI"
      title="Performance Framework"
      navigationGroups={tenantNavigationGroups}
      userSummary={getShellIdentity(context)}
    >
      <KraKpiHub capabilities={accessContext.capabilities} isFullAccess={accessContext.isFullAccess} />
    </AppShell>
  );
}
