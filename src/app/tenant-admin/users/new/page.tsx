import { Role } from "@prisma/client";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Panel } from "@/components/panel";
import { MemberCreateForm } from "@/components/tenant/member-create-form";
import { getShellIdentity } from "@/lib/auth/access";
import { requireTenantAdmin } from "@/lib/auth/session";
import { tenantNavigationGroups } from "@/lib/navigation";

export default async function NewTenantUserPage() {
  const context = await requireTenantAdmin();
  const canCreateTenantAdmin = context.role === Role.TENANT_OWNER;

  return (
    <AppShell
      eyebrow="Tenant"
      title="New User"
      navigationGroups={tenantNavigationGroups}
      userSummary={getShellIdentity(context)}
      headerActions={
        <Link
          className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
          href="/tenant-admin/users"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
      }
    >
      <Panel eyebrow="Create" title="Create User">
        <MemberCreateForm canCreateTenantAdmin={canCreateTenantAdmin} />
      </Panel>
    </AppShell>
  );
}
