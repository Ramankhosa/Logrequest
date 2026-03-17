import Link from "next/link";
import {
  ArrowRight,
  Bot,
  Building2,
  FileClock,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { MetricCard } from "@/components/metric-card";
import { Panel } from "@/components/panel";
import { StatusBadge } from "@/components/status-badge";
import {
  integratedModules,
  moduleOneCoverage,
  overviewStats,
  routeCards,
} from "@/lib/data";

const routeIcons = {
  superadmin: Building2,
  imports: FileClock,
  insights: Sparkles,
};

export default function Home() {
  return (
    <main className="surface-grid min-h-screen px-6 py-8 text-slate-900 sm:px-10 lg:px-12">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <section className="glass-panel overflow-hidden rounded-[2rem] border px-6 py-8 sm:px-8 lg:px-10">
          <div className="grid gap-8 lg:grid-cols-[1.3fr_0.7fr]">
            <div className="space-y-6">
              <span className="section-title text-xs text-slate-500">
                Academic SaaS foundation
              </span>
              <div className="space-y-4">
                <h1 className="max-w-4xl font-[family-name:var(--font-geist-mono)] text-4xl leading-tight sm:text-5xl">
                  Identity, provisioning, and BI without a fatiguing dashboard.
                </h1>
                <p className="max-w-3xl text-base leading-8 text-slate-600 sm:text-lg">
                  This starter uses Next.js, Tailwind, Prisma, and PostgreSQL as
                  the foundation for your academic AI-powered platform. It is
                  structured around the SRS you shared: superadmin tenant
                  control, tenant admin user provisioning, deferred bulk-import
                  readiness, and readable business intelligence surfaces.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Link
                  className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
                  href="/superadmin"
                >
                  Open superadmin flow
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white/70 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
                  href="/login"
                >
                  Sign in
                </Link>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              <Panel
                eyebrow="Design principle"
                title="One primary action per screen"
                description="The shell keeps the next step visible, hides secondary complexity until needed, and promotes low-risk actions for admins."
              >
                <div className="flex flex-wrap gap-2">
                  <StatusBadge label="Pending activation" />
                  <StatusBadge label="Grace period" />
                  <StatusBadge label="Review required" />
                </div>
              </Panel>
              <Panel
                eyebrow="AI stance"
                title="Assistive, not noisy"
                description="The insights layer summarizes outliers, policy drift, and access risks instead of spamming the user with constant suggestions."
              >
                <div className="inline-flex items-center gap-2 rounded-full bg-brand-soft px-3 py-2 text-sm font-medium text-brand">
                  <Bot className="h-4 w-4" />
                  Summaries, validation, and explanations only
                </div>
              </Panel>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {overviewStats.map((stat) => (
            <MetricCard
              key={stat.label}
              label={stat.label}
              value={stat.value}
              description={stat.description}
              accent={stat.accent}
            />
          ))}
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <Panel
            eyebrow="Integrated now"
            title="Modules already wired into the starter"
            description="These libraries are in the app and mapped to the workflows from your Module 1 SRS."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {integratedModules.map((module) => (
                <div
                  key={module.name}
                  className="data-glow rounded-3xl border border-slate-200/80 bg-white/80 p-4"
                >
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
                    <ShieldCheck className="h-4 w-4 text-brand" />
                    {module.name}
                  </div>
                  <p className="text-sm leading-7 text-slate-600">
                    {module.summary}
                  </p>
                </div>
              ))}
            </div>
          </Panel>

          <Panel
            eyebrow="Module 1 coverage"
            title="Core trust-boundary states are explicit"
            description="Tenant access, user access, invitations, and future import staging are modeled separately so the workflows stay deterministic."
          >
            <div className="space-y-3">
              {moduleOneCoverage.map((item) => (
                <div
                  key={item.title}
                  className="rounded-3xl border border-slate-200/80 bg-white/75 p-4"
                >
                  <div className="mb-2 flex items-center justify-between gap-3">
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
          </Panel>
        </section>

        <section className="grid gap-4 xl:grid-cols-3">
          {routeCards.map((route) => {
            const Icon = routeIcons[route.key as keyof typeof routeIcons];

            return (
              <Link key={route.href} href={route.href} className="group">
                <Panel
                  eyebrow={route.eyebrow}
                  title={route.title}
                  description={route.description}
                  className="h-full transition group-hover:-translate-y-0.5"
                >
                  <div className="flex items-center justify-between">
                    <div className="rounded-2xl bg-slate-950 p-3 text-white">
                      <Icon className="h-5 w-5" />
                    </div>
                    <ArrowRight className="h-4 w-4 text-slate-400 transition group-hover:text-slate-900" />
                  </div>
                </Panel>
              </Link>
            );
          })}
        </section>
      </div>
    </main>
  );
}
