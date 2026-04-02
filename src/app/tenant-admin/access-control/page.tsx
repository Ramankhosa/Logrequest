import { AppShell } from "@/components/app-shell";
import { Panel } from "@/components/panel";
import { AccessControlManager } from "@/components/tenant/access-control-manager";
import { getShellIdentity } from "@/lib/auth/access";
import { requireTenantCapability } from "@/lib/auth/session";
import { tenantNavigationGroups } from "@/lib/navigation";
import {
  listTenantPermissionAssignments,
  listTenantPermissionRoleDefinitions,
} from "@/lib/tenant-permissions/service";

export default async function AccessControlPage() {
  const context = await requireTenantCapability("MANAGE_ACCESS");
  const tenantId = context.tenant!.id;
  const [assignments, roleDefinitions] = await Promise.all([
    listTenantPermissionAssignments(tenantId),
    Promise.resolve(listTenantPermissionRoleDefinitions()),
  ]);

  return (
    <AppShell
      eyebrow="Tenant"
      title="Access Control"
      navigationGroups={tenantNavigationGroups}
      userSummary={getShellIdentity(context)}
    >
      <Panel eyebrow="Permissions" title="Tenant Access Roles">
        <AccessControlManager
          initialAssignments={assignments}
          roleDefinitions={roleDefinitions}
        />
      </Panel>
    </AppShell>
  );
}
