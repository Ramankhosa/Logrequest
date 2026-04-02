import { AppShell } from "@/components/app-shell";
import { Panel } from "@/components/panel";
import { WorkflowResponsibilitiesManager } from "@/components/tenant/kra-kpi/workflow-responsibilities-manager";
import { getShellIdentity } from "@/lib/auth/access";
import { requireTenantAnyCapability } from "@/lib/auth/session";
import {
  listKpiWorkflowResponsibilities,
  listOpenWorkflowAssignments,
  listWorkflowReviewerOptions,
} from "@/lib/kra-kpi/workflow-service";
import { tenantNavigationGroups } from "@/lib/navigation";
import { getTenantPermissionAccessContext } from "@/lib/tenant-permissions/service";

export default async function KpiWorkflowPage() {
  const context = await requireTenantAnyCapability(["MANAGE_KPI", "MANAGE_WORKFLOW"]);
  const tenantId = context.tenant!.id;
  const actorUserId = context.user.id;
  const actorRole = context.role;
  const accessContext = await getTenantPermissionAccessContext({
    tenantId,
    userId: actorUserId,
    baseRole: actorRole,
  });
  const canManageLiveWorkflow =
    accessContext.isFullAccess || accessContext.capabilities.includes("MANAGE_WORKFLOW");

  const [responsibilities, reviewerOptions, assignments] = await Promise.all([
    listKpiWorkflowResponsibilities({
      tenantId,
      actorUserId,
      actorRole,
    }),
    listWorkflowReviewerOptions(tenantId),
    canManageLiveWorkflow
      ? listOpenWorkflowAssignments({
          tenantId,
          actorUserId,
          actorRole,
        })
      : Promise.resolve([]),
  ]);

  return (
    <AppShell
      eyebrow="KRA / KPI"
      title="Workflow Responsibilities"
      navigationGroups={tenantNavigationGroups}
      userSummary={getShellIdentity(context)}
    >
      <Panel eyebrow="Workflow" title="KPI Routing And Ownership">
        <WorkflowResponsibilitiesManager
          initialResponsibilities={responsibilities}
          reviewerOptions={reviewerOptions}
          initialAssignments={assignments}
          canManageLiveWorkflow={canManageLiveWorkflow}
        />
      </Panel>
    </AppShell>
  );
}
