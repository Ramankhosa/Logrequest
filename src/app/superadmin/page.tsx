import Link from "next/link";
import { ArrowRight, Building2, ChevronDown, ShieldCheck, UserRoundCog, WalletCards } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { MetricCard } from "@/components/metric-card";
import { Panel } from "@/components/panel";
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

export default async function SuperadminPage() {
  const context = await requireSuperadmin();

  return (
    <AppShell
      eyebrow="Superadmin"
      title="Tenant provisioning and entitlement control"
      description="Open the dedicated tenant creation page when you are ready to provision a new organization. The dashboard stays focused on oversight and review."
      navigationGroups={superadminNavigationGroups}
      userSummary={getShellIdentity(context)}
    >
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Panel
          eyebrow="Primary action"
          title="Create a new tenant on a dedicated page"
          description="The wizard no longer sits inside the dashboard. Step data remains local to the page and the database is written only once after the final submission succeeds."
        >
          <div className="space-y-4">
            <div className="rounded-3xl border border-slate-200/80 bg-slate-50 p-5">
              <div className="mb-2 text-sm font-semibold text-slate-900">
                What changed
              </div>
              <p className="text-sm leading-7 text-slate-600">
                Tenant creation now runs on its own route, separate from the
                monitoring surface. This reduces clutter and avoids accidental
                confusion about draft state versus committed state.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <CompactNote
                title="No draft writes"
                body="Form data stays in the browser until the final create action is submitted."
              />
              <CompactNote
                title="Single commit path"
                body="The server validates the full payload first, then creates the tenant and owner in one transaction."
              />
            </div>

            <Link
              className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
              href="/superadmin/tenants/new"
            >
              Open tenant creation
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel
            eyebrow="Superadmin menus"
            title="Secondary features stay compact"
            description="Monitoring and review controls remain available, but they no longer compete visually with tenant creation."
          >
            <div className="space-y-3">
              <MenuSection
                defaultOpen
                title="Tenant lifecycle snapshot"
                description="Lifecycle and entitlement stay separate so the reason for access or blockage remains easy to explain."
              >
                <div className="space-y-3">
                  {tenantLifecycleSnapshot.map((item) => (
                    <div
                      key={item.label}
                      className="rounded-3xl border border-slate-200/80 bg-white/80 p-4"
                    >
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <span className="text-sm font-semibold text-slate-900">
                          {item.label}
                        </span>
                        <span className="text-sm font-semibold text-slate-700">
                          {item.value}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                        <div
                          className="h-full rounded-full bg-slate-900"
                          style={{ width: `${item.percent}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </MenuSection>

              <MenuSection
                title="Review queue"
                description="High-impact actions stay review-first, but the detail is hidden until needed."
              >
                <div className="space-y-3">
                  {superadminQueue.map((item) => (
                    <div
                      key={item.title}
                      className="rounded-3xl border border-slate-200/80 bg-white/80 p-4"
                    >
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <h3 className="text-sm font-semibold text-slate-900">
                          {item.title}
                        </h3>
                        <StatusBadge label={item.status} />
                      </div>
                      <p className="text-sm leading-7 text-slate-600">
                        {item.description}
                      </p>
                    </div>
                  ))}
                </div>
              </MenuSection>

              <MenuSection
                title="Owner rights"
                description="Superadmin provisions the owner. The owner signs in and handles tenant-admin creation inside the tenant workspace."
              >
                <div className="space-y-3">
                  <CompactNote
                    title="Owner account scope"
                    body="Tenant owners can enter the tenant workspace immediately when lifecycle and entitlement states allow access."
                  />
                  <CompactNote
                    title="Admin creation path"
                    body="Superadmin no longer enters tenant-admin credentials during tenant creation. That responsibility moves to the tenant owner after sign-in."
                  />
                  <CompactNote
                    title="Safer separation"
                    body="This keeps superadmin focused on organization and commercial setup while owner-level operational control stays inside the tenant boundary."
                  />
                </div>
              </MenuSection>
            </div>
          </Panel>
        </div>
      </section>
    </AppShell>
  );
}

function MenuSection({
  title,
  description,
  children,
  defaultOpen = false,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      className="overflow-hidden rounded-3xl border border-slate-200/80 bg-slate-50"
      open={defaultOpen}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4">
        <div>
          <div className="text-sm font-semibold text-slate-900">{title}</div>
          <div className="text-xs leading-6 text-slate-500">{description}</div>
        </div>
        <ChevronDown className="h-4 w-4 text-slate-500" />
      </summary>
      <div className="border-t border-slate-200/80 px-4 py-4">{children}</div>
    </details>
  );
}

function CompactNote({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-3xl border border-slate-200/80 bg-white/80 p-4">
      <div className="mb-2 text-sm font-semibold text-slate-900">{title}</div>
      <p className="text-sm leading-7 text-slate-600">{body}</p>
    </div>
  );
}
