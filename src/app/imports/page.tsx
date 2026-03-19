import { Clock3, FileSpreadsheet, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Panel } from "@/components/panel";
import { StatusBadge } from "@/components/status-badge";
import { getShellIdentity } from "@/lib/auth/access";
import { requireTenantAdmin } from "@/lib/auth/session";
import { tenantNavigationGroups } from "@/lib/navigation";
import { importRoadmap } from "@/lib/data";

export default async function ImportsPage() {
  const context = await requireTenantAdmin();

  return (
    <AppShell
      eyebrow="Bulk Import"
      title="Bulk-import workflow deferred, provisioning model preserved"
      description="The live Excel and CSV parser is intentionally postponed. The schema and UX lane remain in place so bulk-imported users can later flow into the same login, invitation, membership, and audit model as manually provisioned users."
      navigationGroups={tenantNavigationGroups}
      userSummary={getShellIdentity(context)}
    >
      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Panel
          eyebrow="Deferred lane"
          title="What is already prepared"
          description="This is not a dead end. The current foundation already carries the structures you need for staged uploads later."
        >
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-3xl border border-slate-200/80 bg-white/80 p-5">
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-soft text-brand">
                <FileSpreadsheet className="h-5 w-5" />
              </div>
              <div className="mb-2 text-sm font-semibold text-slate-900">
                Upload tables modeled
              </div>
              <p className="text-sm leading-7 text-slate-600">
                `UploadBatch` and `UploadRow` already exist in Prisma for staging,
                validation, partial acceptance, and audit traceability.
              </p>
            </div>
            <div className="rounded-3xl border border-slate-200/80 bg-white/80 p-5">
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-soft text-brand">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div className="mb-2 text-sm font-semibold text-slate-900">
                Same access pipeline
              </div>
              <p className="text-sm leading-7 text-slate-600">
                Imported users will still land in `User`, `Membership`,
                `Invitation`, and `AuditLog`, which keeps login behavior
                consistent.
              </p>
            </div>
            <div className="rounded-3xl border border-slate-200/80 bg-white/80 p-5">
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-50 text-amber-700">
                <Clock3 className="h-5 w-5" />
              </div>
              <div className="mb-2 text-sm font-semibold text-slate-900">
                Parser UI deferred
              </div>
              <p className="text-sm leading-7 text-slate-600">
                The actual Excel and CSV upload screen is deferred until you are
                ready to implement staged validation and preview UX.
              </p>
            </div>
          </div>
        </Panel>

        <Panel
          eyebrow="Roadmap"
          title="Deferred import milestones"
          description="These are the next implementation steps when you choose to switch the import lane on."
        >
          <div className="space-y-3">
            {importRoadmap.map((item) => (
              <div
                key={item.title}
                className="rounded-3xl border border-slate-200/80 bg-white/80 p-4"
              >
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-900">
                    {item.title}
                  </h3>
                  <StatusBadge label={item.state} />
                </div>
                <p className="text-sm leading-7 text-slate-600">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </Panel>
      </section>
    </AppShell>
  );
}
