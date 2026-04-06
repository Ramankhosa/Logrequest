"use client";

import { cn } from "@/lib/utils";
import { statusLabel, WORKSPACE_STATUS_LABELS, WORKSPACE_STATUS_CLASSES } from "./workspace-hub/constants";
import { useWorkspaceHub } from "./workspace-hub/use-workspace-hub";
import { WorkspaceOverview } from "./workspace-hub/workspace-overview";
import { SectionReviewPanel } from "./workspace-hub/section-review-panel";
import { DiscussionsPanel } from "./workspace-hub/discussions-panel";
import { ReadinessSidebar } from "./workspace-hub/readiness-sidebar";
import { WorkspaceReportingCopilotPanel } from "./workspace-reporting-copilot-panel";

export function WorkspaceCollaborationHub() {
  const data = useWorkspaceHub();

  return (
    <div className="space-y-6">
      {/* Status message banner */}
      {data.message ? (
        <div
          className={cn(
            "rounded-2xl px-4 py-3 text-sm",
            data.message.type === "success"
              ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border border-rose-200 bg-rose-50 text-rose-700",
          )}
        >
          {data.message.text}
        </div>
      ) : null}

      {/* Workspace picker + detail layout */}
      <section className="grid gap-6 lg:grid-cols-[20rem,1fr]">
        {/* Workspace sidebar */}
        <div className="rounded-[1.75rem] border border-slate-200/80 bg-white/85 p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.15em] text-slate-500">
            My Workspaces
          </h2>

          {data.loading ? (
            <div className="py-8 text-center text-sm text-slate-400">Loading workspaces...</div>
          ) : data.workspaces.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-500">
              No visible accreditation workspaces.
            </div>
          ) : (
            <div className="space-y-2">
              {data.workspaces.map((workspace) => {
                const isSelected = data.selectedWorkspaceId === workspace.id;
                const statusCls = WORKSPACE_STATUS_CLASSES[workspace.status] ?? "border-slate-200 bg-slate-50 text-slate-600";

                return (
                  <button
                    key={workspace.id}
                    type="button"
                    onClick={() => data.setSelectedWorkspaceId(workspace.id)}
                    className={cn(
                      "w-full rounded-2xl border px-4 py-3.5 text-left transition",
                      isSelected
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{workspace.title}</p>
                        <p className="mt-0.5 text-[11px] opacity-70">
                          {workspace.bodyCode} &middot; {workspace.versionCode}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold",
                          isSelected ? "border-white/20 bg-white/10 text-white" : statusCls,
                        )}
                      >
                        {statusLabel(WORKSPACE_STATUS_LABELS, workspace.status)}
                      </span>
                    </div>

                    {/* Mini progress bars */}
                    <div className="mt-3 space-y-1.5">
                      <ProgressRow label="Progress" value={workspace.progressPercent} isSelected={isSelected} />
                      <ProgressRow label="Approved" value={workspace.approvalPercent} isSelected={isSelected} color="emerald" />
                      <ProgressRow label="Data" value={workspace.dataCompleteness} isSelected={isSelected} color="indigo" />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Main content area */}
        <div className="space-y-6">
          {!data.detail ? (
            <div className="rounded-[1.75rem] border border-dashed border-slate-200 bg-white/55 px-6 py-16 text-center">
              <p className="text-sm text-slate-500">Select an accreditation workspace to review sections, discussions, and readiness.</p>
            </div>
          ) : (
            <>
              {/* Overview header */}
              <WorkspaceOverview
                detail={data.detail}
                saving={data.saving}
                freezeWorkspace={data.freezeWorkspace}
                unfreezeWorkspace={data.unfreezeWorkspace}
              />

              {/* Section review + readiness sidebar */}
              <div className="grid gap-6 xl:grid-cols-[1.3fr,0.7fr]">
                <div className="space-y-6">
                  <SectionReviewPanel
                    sections={data.detail.sections}
                    collaborators={data.collaboratorOptions}
                    currentUserRole={data.detail.currentUserRole}
                    saving={data.saving}
                    sectionAction={data.sectionAction}
                    assignSection={data.assignSection}
                  />

                  <DiscussionsPanel
                    threads={data.threads}
                    sections={data.sectionOptions}
                    collaborators={data.collaboratorOptions}
                    saving={data.saving}
                    createThread={data.createThread}
                    replyToThread={data.replyToThread}
                  />
                </div>

                <ReadinessSidebar
                  readiness={data.detail.readiness}
                  dataGaps={data.detail.dataGaps}
                  freezeLogs={data.detail.freezeLogs}
                />
              </div>

              {/* Reporting copilot panel */}
              <WorkspaceReportingCopilotPanel
                workspaceId={data.detail.id}
                workspaceStatus={data.detail.status}
              />
            </>
          )}
        </div>
      </section>
    </div>
  );
}

// ── Mini progress bar for workspace list items ──

function ProgressRow({
  label,
  value,
  isSelected,
  color = "slate",
}: {
  label: string;
  value: number;
  isSelected: boolean;
  color?: "slate" | "emerald" | "indigo";
}) {
  const barColor = {
    slate: "bg-slate-400",
    emerald: "bg-emerald-500",
    indigo: "bg-indigo-500",
  }[color];

  return (
    <div className="flex items-center gap-2">
      <span className={cn("w-14 text-[10px]", isSelected ? "text-white/60" : "text-slate-400")}>{label}</span>
      <div className={cn("h-1 flex-1 overflow-hidden rounded-full", isSelected ? "bg-white/10" : "bg-slate-100")}>
        <div className={cn("h-full rounded-full transition-all", isSelected ? "bg-white/50" : barColor)} style={{ width: `${value}%` }} />
      </div>
      <span className={cn("w-8 text-right text-[10px] font-medium", isSelected ? "text-white/70" : "text-slate-500")}>{value}%</span>
    </div>
  );
}
