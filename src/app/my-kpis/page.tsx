import { AppShell } from "@/components/app-shell";
import { getShellIdentity } from "@/lib/auth/access";
import { getNavigationForRole } from "@/lib/navigation";
import { requireTenantUser } from "@/lib/auth/session";
import { MyKpiHub } from "./my-kpi-hub";

export default async function MyKpisPage() {
  const context = await requireTenantUser();

  return (
    <AppShell
      eyebrow="My KPIs"
      title="My Performance"
      navigationGroups={getNavigationForRole(context.role, context.isSuperadmin)}
      userSummary={getShellIdentity(context)}
    >
      <MyKpiHub />
    </AppShell>
  );
}
