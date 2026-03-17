import Link from "next/link";
import { Plus } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Panel } from "@/components/panel";
import { UsersTable } from "@/components/users-table";
import { getShellIdentity } from "@/lib/auth/access";
import { tenantNavigationGroups } from "@/lib/navigation";
import { requireTenantAdmin } from "@/lib/auth/session";
import { getTenantDirectoryRows } from "@/lib/tenant-admin/service";

export default async function TenantUsersPage({
  searchParams,
}: {
  searchParams?: Promise<{ created?: string }>;
}) {
  const context = await requireTenantAdmin();
  const rows = await getTenantDirectoryRows(context.tenant?.id ?? "");
  const params = searchParams ? await searchParams : undefined;
  const showCreated = params?.created === "1";

  return (
    <AppShell
      eyebrow="Tenant"
      title="Users"
      navigationGroups={tenantNavigationGroups}
      userSummary={getShellIdentity(context)}
      headerActions={
        <Link
          className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
          href="/tenant-admin/users/new"
        >
          <Plus className="h-4 w-4" />
          New User
        </Link>
      }
    >
      {showCreated ? (
        <div className="rounded-2xl border border-brand/15 bg-brand-soft/70 px-4 py-3 text-sm text-brand">
          User created.
        </div>
      ) : null}

      <Panel eyebrow="Directory" title="Directory">
        <UsersTable data={rows} />
      </Panel>
    </AppShell>
  );
}
