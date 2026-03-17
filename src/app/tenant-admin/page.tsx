import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Panel } from "@/components/panel";
import { UsersTable } from "@/components/users-table";
import { WorkspaceMenu } from "@/components/tenant/workspace-menu";
import { tenantNavigationGroups } from "@/lib/navigation";
import { getShellIdentity } from "@/lib/auth/access";
import { requireTenantAdmin } from "@/lib/auth/session";
import {
  getTenantDirectoryRows,
  getTenantWorkspaceCounts,
} from "@/lib/tenant-admin/service";

export default async function TenantAdminPage() {
  const context = await requireTenantAdmin();
  const tenantId = context.tenant?.id;
  const counts = tenantId ? await getTenantWorkspaceCounts(tenantId) : null;
  const directory = tenantId ? await getTenantDirectoryRows(tenantId) : [];

  return (
    <AppShell
      eyebrow="Tenant"
      title="Workspace"
      navigationGroups={tenantNavigationGroups}
      headerActions={
        <Link
          href="/tenant-admin/users/new"
          className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:border-slate-400"
        >
          Create user
        </Link>
      }
      userSummary={getShellIdentity(context)}
    >
      <div className="space-y-6">
        <Panel eyebrow="Summary" title="Tenant">
          <div className="grid gap-6 md:grid-cols-4">
            <Metric label="Total users" value={counts?.totalUsers ?? "-"} />
            <Metric label="Active users" value={counts?.activeUsers ?? "-"} />
            <Metric label="Pending invites" value={counts?.pendingInvites ?? "-"} />
            <Metric label="Tenant admins" value={counts?.tenantAdmins ?? "-"} />
          </div>
        </Panel>

        <Panel eyebrow="Users" title="Directory">
          <UsersTable data={directory} />
        </Panel>

        <Panel eyebrow="Menu" title="Actions">
          <WorkspaceMenu />
        </Panel>
      </div>
    </AppShell>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 text-sm font-semibold text-slate-900">
      <div className="text-xs uppercase tracking-[0.2em] text-slate-500">{label}</div>
      <div className="mt-2 text-2xl text-slate-900">{value}</div>
    </div>
  );
}
