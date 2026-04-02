import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PersonnelTransferDetailClient } from "@/components/tenant/personnel-transfer-detail";
import { getShellIdentity } from "@/lib/auth/access";
import { tenantNavigationGroups } from "@/lib/navigation";
import { requireTenantCapability } from "@/lib/auth/session";
import {
  getTransferSetupOptions,
  getTransferWithDetails,
  getTransferableTargets,
} from "@/lib/personnel/transfer-service";

export default async function PersonnelTransferDetailPage({
  params,
}: {
  params: Promise<{ transferId: string }>;
}) {
  const context = await requireTenantCapability("MANAGE_PERSONNEL");
  const tenantId = context.tenant?.id ?? "";
  const { transferId } = await params;

  const transfer = await getTransferWithDetails(tenantId, transferId);
  if (!transfer) return notFound();

  const [setup, preview] = await Promise.all([
    getTransferSetupOptions(tenantId),
    getTransferableTargets({
      tenantId,
      membershipId: transfer.membershipId,
      sourceUnitId: transfer.sourceUnitId,
      effectiveDate: transfer.effectiveDate,
    }),
  ]);

  return (
    <AppShell
      eyebrow="Personnel"
      title={transfer.userName}
      navigationGroups={tenantNavigationGroups}
      userSummary={getShellIdentity(context)}
      headerActions={
        <Link
          href="/tenant-admin/personnel/transfers"
          className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Transfers
        </Link>
      }
    >
      <PersonnelTransferDetailClient
        transfer={transfer}
        setup={setup}
        previewTargets={preview.targets}
      />
    </AppShell>
  );
}
