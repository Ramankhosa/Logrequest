import { AlertTriangle, Bot, ChartColumnIncreasing, ShieldAlert } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { InsightsCharts } from "@/components/insights-charts";
import { MetricCard } from "@/components/metric-card";
import { Panel } from "@/components/panel";
import { aiBriefing, insightMetrics, riskAlerts } from "@/lib/data";
import { getShellIdentity } from "@/lib/auth/access";
import { requireTenantUser } from "@/lib/auth/session";
import { getNavigationForRole } from "@/lib/navigation";

const metricIcons = [ChartColumnIncreasing, ShieldAlert, AlertTriangle, Bot];

export default async function InsightsPage() {
  const context = await requireTenantUser();

  return (
    <AppShell
      eyebrow="Intelligent Dashboards"
      title="Business intelligence with readable next actions"
      description="The dashboard layer highlights entitlement drift, adoption trends, and access risks. AI support is framed as explanation and summarization, not interruption."
      navigationGroups={getNavigationForRole(context.role, context.isSuperadmin)}
      userSummary={getShellIdentity(context)}
    >
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {insightMetrics.map((metric, index) => {
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

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <InsightsCharts />

        <div className="space-y-4">
          <Panel
            eyebrow="AI briefing"
            title="Assistive narrative"
            description="These summaries are written in the tone the platform should use for academic admins: direct, readable, and operational."
          >
            <div className="space-y-3">
              {aiBriefing.map((item) => (
                <div
                  key={item.title}
                  className="rounded-3xl border border-slate-200/80 bg-white/80 p-4"
                >
                  <div className="mb-2 text-sm font-semibold text-slate-900">
                    {item.title}
                  </div>
                  <p className="text-sm leading-7 text-slate-600">
                    {item.summary}
                  </p>
                </div>
              ))}
            </div>
          </Panel>

          <Panel
            eyebrow="Risk surface"
            title="Explain why access is blocked"
            description="Operational BI should point directly to the blocking state, not bury it under generic failure messaging."
          >
            <div className="space-y-3">
              {riskAlerts.map((alert) => (
                <div
                  key={alert.title}
                  className="rounded-3xl border border-slate-200/80 bg-white/80 p-4"
                >
                  <div className="mb-2 text-sm font-semibold text-slate-900">
                    {alert.title}
                  </div>
                  <p className="text-sm leading-7 text-slate-600">
                    {alert.summary}
                  </p>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </section>
    </AppShell>
  );
}
