"use client";

import { useState } from "react";
import { Building2, Blocks, Users, Bot, TreePine, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAccreditationManager } from "./accreditation-bodies/use-accreditation-manager";
import { BodiesVersionsTab } from "./accreditation-bodies/bodies-versions-tab";
import { TemplateBlocksTab } from "./accreditation-bodies/template-blocks-tab";
import { ProfilesTab } from "./accreditation-bodies/profiles-tab";
import { CopilotTab } from "./accreditation-bodies/copilot-tab";
import { CriteriaKpiTab } from "./accreditation-bodies/criteria-kpi-tab";

type TabId = "frameworks" | "blocks" | "profiles" | "copilot" | "criteria";

type TabDef = { id: TabId; label: string; icon: React.ReactNode; tenantOnly?: boolean };

const ALL_TABS: TabDef[] = [
  { id: "frameworks", label: "Frameworks", icon: <Building2 className="h-4 w-4" /> },
  { id: "blocks", label: "Template Blocks", icon: <Blocks className="h-4 w-4" /> },
  { id: "profiles", label: "Profiles", icon: <Users className="h-4 w-4" /> },
  { id: "copilot", label: "Copilot", icon: <Bot className="h-4 w-4" /> },
  { id: "criteria", label: "Criteria & KPIs", icon: <TreePine className="h-4 w-4" />, tenantOnly: true },
];

export function AccreditationManager({
  scope,
  initialKpiId,
}: {
  scope: "tenant" | "superadmin";
  initialKpiId?: string | null;
}) {
  const [activeTab, setActiveTab] = useState<TabId>("frameworks");
  const data = useAccreditationManager(scope, initialKpiId);

  const visibleTabs = ALL_TABS.filter((t) => !t.tenantOnly || scope === "tenant");

  if (data.loading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white/80 py-12 text-sm text-slate-500">
        Loading accreditation data...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Message banner */}
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

      {/* Tab navigation */}
      <nav className="flex gap-1 rounded-2xl border border-slate-200/80 bg-white/85 p-1">
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "relative flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition",
              activeTab === tab.id
                ? "bg-slate-900 text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Tab content */}
      {activeTab === "frameworks" ? (
        <BodiesVersionsTab
          scope={data.scope}
          submitting={data.submitting}
          bodies={data.bodies}
          selectedBodyId={data.selectedBodyId}
          setSelectedBodyId={data.setSelectedBodyId}
          selectedBody={data.selectedBody}
          versions={data.versions}
          selectedVersionId={data.selectedVersionId}
          setSelectedVersionId={data.setSelectedVersionId}
          selectedVersion={data.selectedVersion}
          canEditSelectedBody={data.canEditSelectedBody}
          canEditRuntimeCriteria={data.canEditRuntimeCriteria}
          createBody={data.createBody}
          toggleBodyActive={data.toggleBodyActive}
          createVersion={data.createVersion}
          toggleVersionActive={data.toggleVersionActive}
          changeVersionLifecycleStatus={data.changeVersionLifecycleStatus}
          forkVersion={data.forkVersion}
        />
      ) : null}

      {activeTab === "blocks" ? (
        <TemplateBlocksTab
          submitting={data.submitting}
          selectedVersion={data.selectedVersion}
          flatBlocks={data.flatBlocks}
          selectedBlockId={data.selectedBlockId}
          setSelectedBlockId={data.setSelectedBlockId}
          selectedBlock={data.selectedBlock}
          flatCriteria={data.flatCriteria}
          canEditSelectedVersionBlocks={data.canEditSelectedVersionBlocks}
          canEditAssistantRules={data.canEditAssistantRules}
          createBlock={data.createBlock}
          updateBlock={data.updateBlock}
          toggleBlockActive={data.toggleBlockActive}
          validateDraft={data.validateDraft}
          publishVersion={data.publishVersion}
        />
      ) : null}

      {activeTab === "profiles" ? (
        <ProfilesTab
          submitting={data.submitting}
          selectedVersion={data.selectedVersion}
          profiles={data.profiles}
          selectedProfileId={data.selectedProfileId}
          setSelectedProfileId={data.setSelectedProfileId}
          selectedProfile={data.selectedProfile}
          selectedProfileWeightMap={data.selectedProfileWeightMap}
          leafCriteria={data.leafCriteria}
          canEditSelectedBody={data.canEditSelectedBody}
          createProfile={data.createProfile}
          saveProfileWeights={data.saveProfileWeights}
        />
      ) : null}

      {activeTab === "copilot" ? (
        <CopilotTab
          scope={data.scope}
          submitting={data.submitting}
          selectedVersion={data.selectedVersion}
          copilotConfig={data.copilotConfig}
          availableLlmProfiles={data.availableLlmProfiles}
          tenantCopilotEnabled={data.tenantCopilotEnabled}
          canEditSelectedVersionCopilot={data.canEditSelectedVersionCopilot}
          saveCopilotSettings={data.saveCopilotSettings}
        />
      ) : null}

      {activeTab === "criteria" && scope === "tenant" ? (
        <CriteriaKpiTab
          submitting={data.submitting}
          selectedVersion={data.selectedVersion}
          flatCriteria={data.flatCriteria}
          leafCriteria={data.leafCriteria}
          selectedCriterionId={data.selectedCriterionId}
          setSelectedCriterionId={data.setSelectedCriterionId}
          selectedCriterion={data.selectedCriterion}
          blockKpis={data.blockKpis}
          kpis={data.kpis}
          selectedKpiId={data.selectedKpiId}
          setSelectedKpiId={data.setSelectedKpiId}
          links={data.links}
          canEditSelectedBody={data.canEditSelectedBody}
          canEditRuntimeCriteria={data.canEditRuntimeCriteria}
          toggleBlockActive={data.toggleBlockActive}
          createKpiLink={data.createKpiLink}
          deleteKpiLink={data.deleteKpiLink}
        />
      ) : null}
    </div>
  );
}
