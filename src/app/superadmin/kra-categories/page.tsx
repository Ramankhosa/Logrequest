import { AppShell } from "@/components/app-shell";
import { getShellIdentity } from "@/lib/auth/access";
import { superadminNavigationGroups } from "@/lib/navigation";
import { requireSuperadmin } from "@/lib/auth/session";
import { SuperadminCategoryManager } from "./category-manager";

export default async function SuperadminKraCategoriesPage() {
  const context = await requireSuperadmin();

  return (
    <AppShell
      eyebrow="Superadmin"
      title="KRA Categories"
      navigationGroups={superadminNavigationGroups}
      userSummary={getShellIdentity(context)}
    >
      <section className="rounded-[1.75rem] border border-slate-200/80 bg-white/60 p-6">
        <SuperadminCategoryManager />
      </section>
    </AppShell>
  );
}
