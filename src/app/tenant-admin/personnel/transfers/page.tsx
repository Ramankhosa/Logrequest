import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PersonnelTransfersPageClient } from "@/components/tenant/personnel-transfers-page";
import { getShellIdentity } from "@/lib/auth/access";
import { tenantNavigationGroups } from "@/lib/navigation";
import { requireTenantCapability } from "@/lib/auth/session";
import {
  getTransferSetupOptions,
  listTransfers,
} from "@/lib/personnel/transfer-service";

export default async function PersonnelTransfersPage({
  searchParams,
}: {
  searchParams?: Promise<{ membershipId?: string }>;
}) {
  const context = await requireTenantCapability("MANAGE_PERSONNEL");
  const tenantId = context.tenant?.id ?? "";
  const params = searchParams ? await searchParams : undefined;
  const [setup, transfers] = await Promise.all([
    getTransferSetupOptions(tenantId),
    listTransfers(tenantId, {
      membershipId: params?.membershipId,
    }),
  ]);

  return (
    <AppShell
      eyebrow="Personnel"
      title="Department Transfers"
      navigationGroups={tenantNavigationGroups}
      userSummary={getShellIdentity(context)}
      headerActions={
        <Link
          href="/tenant-admin/personnel"
          className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Personnel
        </Link>
      }
    >
      <PersonnelTransfersPageClient
        setup={setup}
        initialTransfers={transfers}
        initialMembershipId={params?.membershipId}
      />
    </AppShell>
  );
}
