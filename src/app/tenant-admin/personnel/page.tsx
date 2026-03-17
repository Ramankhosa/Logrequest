import Link from "next/link";
import { Plus, Upload, Users, UserCheck, Clock, AlertTriangle, UserX, UserPlus } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { MetricCard } from "@/components/metric-card";
import { Panel } from "@/components/panel";
import { StatusBadge } from "@/components/status-badge";
import { getShellIdentity } from "@/lib/auth/access";
import { tenantNavigationGroups } from "@/lib/navigation";
import { requireTenantAdmin } from "@/lib/auth/session";
import {
  getPersonnelDashboardCounts,
  getPersonnelDirectory,
} from "@/lib/personnel/service";

export default async function PersonnelPage({
  searchParams,
}: {
  searchParams?: Promise<{ onboarded?: string }>;
}) {
  const context = await requireTenantAdmin();
  const tenantId = context.tenant?.id ?? "";
  const [counts, directory] = await Promise.all([
    getPersonnelDashboardCounts(tenantId),
    getPersonnelDirectory(tenantId),
  ]);
  const params = searchParams ? await searchParams : undefined;
  const showOnboarded = params?.onboarded === "1";

  return (
    <AppShell
      eyebrow="Tenant"
      title="Personnel"
      navigationGroups={tenantNavigationGroups}
      userSummary={getShellIdentity(context)}
      headerActions={
        <>
          <Link
            className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
            href="/tenant-admin/personnel/onboard/bulk"
          >
            <Upload className="h-4 w-4" />
            Bulk Upload
          </Link>
          <Link
            className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
            href="/tenant-admin/personnel/onboard"
          >
            <Plus className="h-4 w-4" />
            Onboard
          </Link>
        </>
      }
    >
      {showOnboarded ? (
        <div className="rounded-2xl border border-brand/15 bg-brand-soft/70 px-4 py-3 text-sm text-brand">
          Member onboarded successfully.
        </div>
      ) : null}

      {/* Metric cards */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCard
          label="Total"
          value={String(counts.total)}
          description="All personnel records"
          accent="slate"
          icon={<Users className="h-4 w-4" />}
        />
        <MetricCard
          label="Active"
          value={String(counts.active)}
          description="Currently active members"
          accent="brand"
          icon={<UserCheck className="h-4 w-4" />}
        />
        <MetricCard
          label="On Leave"
          value={String(counts.onLeave)}
          description="Members on leave"
          accent="amber"
          icon={<Clock className="h-4 w-4" />}
        />
        <MetricCard
          label="Notice Period"
          value={String(counts.noticePeriod)}
          description="Serving notice period"
          accent="rose"
          icon={<AlertTriangle className="h-4 w-4" />}
        />
        <MetricCard
          label="Separated"
          value={String(counts.separated)}
          description="Exited the organization"
          accent="rose"
          icon={<UserX className="h-4 w-4" />}
        />
        <MetricCard
          label="Onboarding"
          value={String(counts.onboarding)}
          description="Pending activation"
          accent="amber"
          icon={<UserPlus className="h-4 w-4" />}
        />
      </section>

      {/* Directory table */}
      <Panel eyebrow="Personnel" title="Directory">
        <div className="overflow-hidden rounded-[1.5rem] border border-slate-200/80 bg-white/80">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200/80 text-left">
              <thead className="bg-slate-50/80">
                <tr>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Name
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Email
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Employee ID
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Designation
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Primary Unit
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Role
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Personnel Status
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Access Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/80">
                {directory.length ? (
                  directory.map((row) => (
                    <tr key={row.membershipId} className="align-top">
                      <td className="px-4 py-4 text-sm font-semibold whitespace-nowrap">
                        <Link
                          href={`/tenant-admin/personnel/${row.membershipId}`}
                          className="text-brand hover:underline"
                        >
                          {row.name}
                        </Link>
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-600">
                        {row.email}
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-600">
                        {row.employeeId ?? <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-600">
                        {row.designation ?? <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-600 whitespace-nowrap">
                        {row.primaryUnit ?? <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-600">
                        {row.appRole}
                      </td>
                      <td className="px-4 py-4">
                        <StatusBadge label={row.personnelStatus} />
                      </td>
                      <td className="px-4 py-4">
                        <StatusBadge label={row.membershipStatus} />
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-4 py-8 text-center text-sm text-slate-500"
                    >
                      No personnel records
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Panel>
    </AppShell>
  );
}
