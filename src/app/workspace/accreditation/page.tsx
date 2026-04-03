import { AppShell } from "@/components/app-shell";
import { WorkspaceCollaborationHub } from "@/components/accreditation/workspace-collaboration-hub";
import { getShellIdentity } from "@/lib/auth/access";
import { requireTenantService } from "@/lib/auth/session";
import { getNavigationForRole } from "@/lib/navigation";

export default async function WorkspaceAccreditationPage() {
  const context = await requireTenantService("ACCREDITATION");

  return (
    <AppShell
      eyebrow="Workspace"
      title="Accreditation Workspaces"
      description="Collaborate on accreditation sections, review status, evidence readiness, and shared discussion threads."
      navigationGroups={getNavigationForRole(context.role, context.isSuperadmin)}
      userSummary={getShellIdentity(context)}
    >
      <WorkspaceCollaborationHub />
    </AppShell>
  );
}
