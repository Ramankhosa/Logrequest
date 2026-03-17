import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Panel } from "@/components/panel";
import { PersonnelBulkUpload } from "@/components/tenant/personnel-bulk-upload";
import { getShellIdentity } from "@/lib/auth/access";
import { requireTenantAdmin } from "@/lib/auth/session";
import { tenantNavigationGroups } from "@/lib/navigation";

export default async function PersonnelBulkOnboardPage() {
  const context = await requireTenantAdmin();

  return (
    <AppShell
      eyebrow="Personnel"
      title="Bulk Onboarding"
      navigationGroups={tenantNavigationGroups}
      userSummary={getShellIdentity(context)}
      headerActions={
        <Link
          className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
          href="/tenant-admin/personnel"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
      }
    >
      <Panel eyebrow="Onboarding" title="Bulk Onboarding">
        <PersonnelBulkUpload />
      </Panel>
    </AppShell>
  );
}
