"use client";

import { useState } from "react";
import { LayoutDashboard, Database, BarChart3, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { useInstitutionalData } from "./institutional-data/use-institutional-data";
import { OverviewTab } from "./institutional-data/overview-tab";
import { SourcesTab } from "./institutional-data/sources-tab";
import { MetricsTab } from "./institutional-data/metrics-tab";
import { ReviewTab } from "./institutional-data/review-tab";

type TabId = "overview" | "sources" | "metrics" | "review";

const TABS: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
  { id: "overview", label: "Overview", icon: <LayoutDashboard className="h-4 w-4" /> },
  { id: "sources", label: "Data Sources", icon: <Database className="h-4 w-4" /> },
  { id: "metrics", label: "Metrics", icon: <BarChart3 className="h-4 w-4" /> },
  { id: "review", label: "Review Queue", icon: <Inbox className="h-4 w-4" /> },
];

export function InstitutionalDataManager() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const data = useInstitutionalData();

  const pendingCount = data.suggestions.length;

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
        {TABS.map((tab) => (
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
            {tab.id === "review" && pendingCount > 0 ? (
              <span className={cn(
                "ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold",
                activeTab === "review"
                  ? "bg-white/20 text-white"
                  : "bg-amber-100 text-amber-700",
              )}>
                {pendingCount}
              </span>
            ) : null}
          </button>
        ))}
      </nav>

      {/* Tab content */}
      {activeTab === "overview" ? (
        <OverviewTab
          loading={data.loading}
          saving={data.saving}
          summary={data.summary}
          gapItems={data.gapItems}
          seedCatalog={data.seedCatalog}
          onGoToSources={() => setActiveTab("sources")}
        />
      ) : null}

      {activeTab === "sources" ? (
        <SourcesTab
          saving={data.saving}
          sources={data.sources}
          selectedSourceId={data.selectedSourceId}
          setSelectedSourceId={data.setSelectedSourceId}
          selectedSource={data.selectedSource}
          domainOptions={data.domainOptions}
          adapterOptions={data.adapterOptions}
          importPreview={data.importPreview}
          clearImportPreview={data.clearImportPreview}
          createSource={data.createSource}
          updateSource={data.updateSource}
          refreshSource={data.refreshSource}
          saveManualSnapshot={data.saveManualSnapshot}
          previewImport={data.previewImport}
          applyImport={data.applyImport}
        />
      ) : null}

      {activeTab === "metrics" ? (
        <MetricsTab
          saving={data.saving}
          sources={data.sources}
          metrics={data.metrics}
          selectedSourceId={data.selectedSourceId}
          selectedMetricId={data.selectedMetricId}
          setSelectedMetricId={data.setSelectedMetricId}
          selectedMetric={data.selectedMetric}
          domainOptions={data.domainOptions}
          createMetric={data.createMetric}
          updateMetric={data.updateMetric}
          addMetricLink={data.addMetricLink}
        />
      ) : null}

      {activeTab === "review" ? (
        <ReviewTab
          loading={data.loading}
          saving={data.saving}
          suggestions={data.suggestions}
          resolveSuggestion={data.resolveSuggestion}
        />
      ) : null}
    </div>
  );
}
