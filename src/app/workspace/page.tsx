import { BarChart3, Building2, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { MetricCard } from "@/components/metric-card";
import { Panel } from "@/components/panel";
import { StatusBadge } from "@/components/status-badge";
import { getShellIdentity } from "@/lib/auth/access";
import { requireTenantUser } from "@/lib/auth/session";

export default async function WorkspacePage() {
  const context = await requireTenantUser();

  return (
    <AppShell
      eyebrow="Workspace"
      title="Authenticated access is active"
      description="This page confirms that tenant user login, organization context, and route protection are working against the current membership state."
      userSummary={getShellIdentity(context)}
    >
      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard
          label="Signed-in user"
          value={context.payload.name}
          description="Authenticated from the current user record."
          accent="brand"
          icon={<ShieldCheck className="h-4 w-4" />}
        />
        <MetricCard
          label="Active organization"
          value={context.payload.tenantName ?? "Platform"}
          description="Resolved from the current accessible membership."
          accent="slate"
          icon={<Building2 className="h-4 w-4" />}
        />
        <MetricCard
          label="Current role"
          value={context.payload.role ?? "STANDARD"}
          description="Used for route protection and future workflow permissions."
          accent="amber"
          icon={<BarChart3 className="h-4 w-4" />}
        />
      </section>

      <Panel
        eyebrow="Access state"
        title="Current session posture"
        description="Authentication is live. Authorization still depends on organization and membership state checks."
      >
        <div className="flex flex-wrap gap-2">
          <StatusBadge label="Authenticated" />
          <StatusBadge label={context.payload.role ?? "User"} />
          {context.payload.tenantCode ? (
            <StatusBadge label={context.payload.tenantCode} tone="slate" />
          ) : null}
        </div>
      </Panel>
    </AppShell>
  );
}
