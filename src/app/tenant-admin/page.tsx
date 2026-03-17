import Link from "next/link";
import {
  Users,
  Network,
  BarChart2,
  UserPlus,
  ArrowRight,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { UsersTable } from "@/components/users-table";
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
      userSummary={getShellIdentity(context)}
      headerActions={
        <Link
          href="/tenant-admin/users/new"
          className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
        >
          <UserPlus className="h-4 w-4" />
          Invite user
        </Link>
      }
    >
      {/* Metrics */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Total users"
          value={counts?.totalUsers ?? 0}
          icon={<Users className="h-4 w-4" />}
          tone="default"
        />
        <MetricCard
          label="Active users"
          value={counts?.activeUsers ?? 0}
          icon={<Users className="h-4 w-4" />}
          tone="brand"
        />
        <MetricCard
          label="Pending invites"
          value={counts?.pendingInvites ?? 0}
          icon={<UserPlus className="h-4 w-4" />}
          tone="amber"
        />
        <MetricCard
          label="Tenant admins"
          value={counts?.tenantAdmins ?? 0}
          icon={<Users className="h-4 w-4" />}
          tone="default"
        />
      </section>

      {/* Quick actions */}
      <section className="grid gap-4 sm:grid-cols-3">
        <QuickAction
          href="/tenant-admin/users"
          icon={<Users className="h-5 w-5" />}
          label="User directory"
          description="Browse and manage all workspace members"
        />
        <QuickAction
          href="/tenant-admin/structure"
          icon={<Network className="h-5 w-5" />}
          label="Organization"
          description="Build and publish your org hierarchy"
        />
        <QuickAction
          href="/insights"
          icon={<BarChart2 className="h-5 w-5" />}
          label="Insights"
          description="Usage stats and activity reports"
        />
      </section>

      {/* Directory */}
      <section className="rounded-[1.75rem] border border-slate-200/80 bg-white/60 p-6">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <div className="section-title text-xs text-slate-400">Users</div>
            <h2 className="mt-1 text-base font-semibold text-slate-900">
              Directory
            </h2>
          </div>
          <Link
            href="/tenant-admin/users"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-brand transition hover:text-brand/80"
          >
            View all
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <UsersTable data={directory} />
      </section>
    </AppShell>
  );
}

function MetricCard({
  label,
  value,
  icon,
  tone = "default",
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone?: "default" | "brand" | "amber";
}) {
  const toneClasses = {
    default: "bg-slate-100 text-slate-600",
    brand: "bg-brand/10 text-brand",
    amber: "bg-amber-50 text-amber-600",
  };

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white/80 px-5 py-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
          {label}
        </span>
        <div className={`rounded-xl p-2 ${toneClasses[tone]}`}>{icon}</div>
      </div>
      <div className="mt-3 text-3xl font-bold tabular-nums text-slate-900">
        {value}
      </div>
    </div>
  );
}

function QuickAction({
  href,
  icon,
  label,
  description,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-start gap-4 rounded-2xl border border-slate-200/80 bg-white/80 p-5 transition hover:border-brand/30 hover:bg-white hover:shadow-sm"
    >
      <div className="mt-0.5 rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-slate-600 transition group-hover:border-brand/20 group-hover:bg-brand/5 group-hover:text-brand">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-slate-900">{label}</div>
        <div className="mt-0.5 text-xs leading-5 text-slate-500">
          {description}
        </div>
      </div>
      <ArrowRight className="ml-auto mt-1 h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-brand" />
    </Link>
  );
}
