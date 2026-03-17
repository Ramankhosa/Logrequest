import Link from "next/link";
import {
  ArrowRight,
  Building2,
  ShieldCheck,
  UserRoundCog,
  WalletCards,
  Plus,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Circle,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { MetricCard } from "@/components/metric-card";
import { StatusBadge } from "@/components/status-badge";
import { getShellIdentity } from "@/lib/auth/access";
import { superadminNavigationGroups } from "@/lib/navigation";
import { requireSuperadmin } from "@/lib/auth/session";
import {
  superadminMetrics,
  superadminQueue,
  tenantLifecycleSnapshot,
} from "@/lib/data";

const metricIcons = [Building2, ShieldCheck, WalletCards, UserRoundCog];

const lifecycleColors: Record<string, string> = {
  Active:   "bg-brand",
  Pending:  "bg-amber-400",
  Suspended:"bg-rose-500",
  Expired:  "bg-slate-400",
};

export default async function SuperadminPage() {
  const context = await requireSuperadmin();

  return (
    <AppShell
      eyebrow="Superadmin"
      title="Dashboard"
      navigationGroups={superadminNavigationGroups}
      userSummary={getShellIdentity(context)}
      headerActions={
        <Link
          href="/superadmin/tenants/new"
          className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
        >
          <Plus className="h-4 w-4" />
          New Tenant
        </Link>
      }
    >
      {/* Metric cards */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {superadminMetrics.map((metric, index) => {
          const Icon = metricIcons[index];
          return (
            <MetricCard
              key={metric.label}
              label={metric.label}
              value={metric.value}
              description={metric.description}
              accent={metric.accent}
              icon={<Icon className="h-4 w-4" />}
            />
          );
        })}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        {/* Tenant lifecycle snapshot */}
        <div className="space-y-3 rounded-[1.75rem] border border-slate-200/80 bg-white/60 p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="section-title text-xs text-slate-400">
                Overview
              </div>
              <h2 className="mt-1 text-base font-semibold text-slate-900">
                Tenant lifecycle
              </h2>
            </div>
          </div>
          <div className="space-y-3">
            {tenantLifecycleSnapshot.map((item) => {
              const barColor =
                lifecycleColors[item.label] ?? "bg-slate-400";
              return (
                <div key={item.label} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-700">
                      {item.label}
                    </span>
                    <span className="font-semibold tabular-nums text-slate-900">
                      {item.value}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full transition-all ${barColor}`}
                      style={{ width: `${item.percent}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Review queue */}
        <div className="space-y-3 rounded-[1.75rem] border border-slate-200/80 bg-white/60 p-6">
          <div className="mb-4">
            <div className="section-title text-xs text-slate-400">
              Action needed
            </div>
            <h2 className="mt-1 text-base font-semibold text-slate-900">
              Review queue
            </h2>
          </div>
          <div className="space-y-3">
            {superadminQueue.map((item) => {
              const StatusIcon =
                item.status === "PENDING"
                  ? Clock
                  : item.status === "REVIEW"
                    ? AlertTriangle
                    : item.status === "ACCEPTED"
                      ? CheckCircle2
                      : Circle;
              return (
                <div
                  key={item.title}
                  className="flex items-start gap-3 rounded-2xl border border-slate-200/80 bg-white/80 p-4 transition hover:border-slate-300"
                >
                  <StatusIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-900">
                        {item.title}
                      </span>
                      <StatusBadge label={item.status} />
                    </div>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      {item.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="flex items-center justify-between gap-6 rounded-[1.75rem] border border-slate-200/80 bg-gradient-to-r from-slate-950 to-slate-800 p-6 text-white">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            Primary action
          </div>
          <h2 className="mt-1 text-lg font-semibold">
            Provision a new tenant
          </h2>
          <p className="mt-1 max-w-md text-sm text-slate-400">
            The 5-step wizard provisions the organisation, owner account and
            initial entitlements in a single transaction.
          </p>
        </div>
        <Link
          href="/superadmin/tenants/new"
          className="inline-flex shrink-0 items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-100"
        >
          Open wizard
          <ArrowRight className="h-4 w-4" />
        </Link>
      </section>
    </AppShell>
  );
}
