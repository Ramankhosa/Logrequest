import { AppShell } from "@/components/app-shell";
import { AccreditationManager } from "@/components/accreditation/accreditation-manager";
import { getShellIdentity } from "@/lib/auth/access";
import { requireSuperadmin } from "@/lib/auth/session";
import { superadminNavigationGroups } from "@/lib/navigation";

export default async function SuperadminAccreditationPage() {
  const context = await requireSuperadmin();

  return (
    <AppShell
      eyebrow="Superadmin"
      title="Accreditation"
      description="Manage the global accreditation registry, seed frameworks, versions, profiles, criteria, and scoring structure."
      navigationGroups={superadminNavigationGroups}
      userSummary={getShellIdentity(context)}
    >
      <section className="rounded-[1.75rem] border border-slate-200/80 bg-white/60 p-6">
        <AccreditationManager scope="superadmin" />
      </section>
    </AppShell>
  );
}
