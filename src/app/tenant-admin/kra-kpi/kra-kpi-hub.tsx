"use client";

import { useState, useCallback, useEffect } from "react";
import {
  Calendar,
  Target,
  BarChart3,
  Crosshair,
  ClipboardCheck,
  LayoutDashboard,
  Tag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AssessmentPeriodList } from "@/components/tenant/kra-kpi/assessment-period-list";
import { KraCategoryList } from "@/components/tenant/kra-kpi/kra-category-list";
import { KraDefinitionList } from "@/components/tenant/kra-kpi/kra-definition-list";
import { KpiDefinitionList } from "@/components/tenant/kra-kpi/kpi-definition-list";
import { TargetAllocationTable } from "@/components/tenant/kra-kpi/target-allocation-table";
import { AchievementReviewList } from "@/components/tenant/kra-kpi/achievement-review-list";
import { AchievementForm } from "@/components/tenant/kra-kpi/achievement-form";
import { PeriodDashboard } from "@/components/tenant/kra-kpi/period-dashboard";

type Tab = "periods" | "categories" | "kras" | "kpis" | "targets" | "achievements" | "dashboard";

const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: "periods", label: "Periods", icon: Calendar },
  { key: "categories", label: "Categories", icon: Tag },
  { key: "kras", label: "KRAs", icon: Target },
  { key: "kpis", label: "KPIs", icon: BarChart3 },
  { key: "targets", label: "Targets", icon: Crosshair },
  { key: "achievements", label: "Achievements", icon: ClipboardCheck },
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
];

type KraView = {
  id: string;
  title: string;
  weightage: number;
  periodId: string;
};

type KpiView = {
  id: string;
  title: string;
  measurementType: string;
};

export function KraKpiHub() {
  const [activeTab, setActiveTab] = useState<Tab>("periods");

  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const [selectedPeriodName, setSelectedPeriodName] = useState<string | null>(null);

  const [selectedKraId, setSelectedKraId] = useState<string | null>(null);

  const [selectedKpiId, setSelectedKpiId] = useState<string | null>(null);

  const [showAchievementForm, setShowAchievementForm] = useState(false);

  const [periods, setPeriods] = useState<{ id: string; name: string }[]>([]);
  const [kras, setKras] = useState<KraView[]>([]);
  const [kpis, setKpis] = useState<KpiView[]>([]);

  const fetchPeriods = useCallback(async () => {
    try {
      const res = await fetch("/api/tenant/kra-kpi/periods");
      const data = await res.json();
      setPeriods(data.map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })));
    } catch { /* ignore */ }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void fetchPeriods(); }, [fetchPeriods]);

  const fetchKras = useCallback(async (periodId: string) => {
    try {
      const res = await fetch(`/api/tenant/kra-kpi/kras?periodId=${periodId}`);
      setKras(await res.json());
    } catch { /* ignore */ }
  }, []);

  const fetchKpis = useCallback(async (kraId: string) => {
    try {
      const res = await fetch(`/api/tenant/kra-kpi/kpis?kraDefinitionId=${kraId}`);
      setKpis(await res.json());
    } catch { /* ignore */ }
  }, []);

  const handleSelectPeriod = (periodId: string, nextTab?: Tab) => {
    const period = periods.find((p) => p.id === periodId);
    setSelectedPeriodId(periodId);
    setSelectedPeriodName(period?.name ?? null);
    setSelectedKraId(null);
    setSelectedKpiId(null);
    setKras([]);
    setKpis([]);
    setShowAchievementForm(false);
    void fetchKras(periodId);
    if (nextTab) {
      setActiveTab(nextTab);
    }
  };

  const handleSelectKra = (kraId: string, nextTab?: Tab) => {
    setSelectedKraId(kraId);
    setSelectedKpiId(null);
    setKpis([]);
    setShowAchievementForm(false);
    void fetchKpis(kraId);
    if (nextTab) {
      setActiveTab(nextTab);
    }
  };

  const handleSelectKpi = (kpiId: string, nextTab?: Tab) => {
    setSelectedKpiId(kpiId);
    setShowAchievementForm(false);
    if (nextTab) {
      setActiveTab(nextTab);
    }
  };

  const selectedKra = selectedKraId ? kras.find((kra) => kra.id === selectedKraId) ?? null : null;
  const selectedKpi = selectedKpiId ? kpis.find((kpi) => kpi.id === selectedKpiId) ?? null : null;
  const selectedKraTitle = selectedKra?.title ?? null;
  const selectedKraWeightage = selectedKra?.weightage ?? 0;
  const selectedKpiTitle = selectedKpi?.title ?? null;
  const selectedKpiMeasurementType = selectedKpi?.measurementType ?? "NUMERIC";

  const selectCls = "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 outline-none focus:border-brand focus:ring-1 focus:ring-brand/30";

  return (
    <div className="space-y-6">
      {/* Tab bar */}
      <div className="flex flex-wrap gap-1 rounded-2xl border border-slate-200/80 bg-white/60 p-1.5">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={cn(
              "inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition",
              activeTab === key
                ? "bg-slate-950 text-white shadow-sm"
                : "text-slate-500 hover:bg-slate-100 hover:text-slate-900",
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Context selectors */}
      {["kras", "kpis", "targets", "achievements", "dashboard"].includes(activeTab) && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200/80 bg-white/60 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Period</span>
            <select
              value={selectedPeriodId ?? ""}
              onChange={(e) => e.target.value && handleSelectPeriod(e.target.value)}
              className={selectCls}
            >
              <option value="">Select period...</option>
              {periods.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          {["kpis", "targets", "achievements"].includes(activeTab) && selectedPeriodId && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">KRA</span>
              <select
                value={selectedKraId ?? ""}
                onChange={(e) => e.target.value && handleSelectKra(e.target.value)}
                className={selectCls}
              >
                <option value="">Select KRA...</option>
                {kras.map((k: KraView) => <option key={k.id} value={k.id}>{k.title} (w:{k.weightage})</option>)}
              </select>
            </div>
          )}

          {["targets", "achievements"].includes(activeTab) && selectedKraId && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">KPI</span>
              <select
                value={selectedKpiId ?? ""}
                onChange={(e) => {
                  if (e.target.value) handleSelectKpi(e.target.value);
                }}
                className={selectCls}
              >
                <option value="">Select KPI...</option>
                {kpis.map((k: KpiView) => <option key={k.id} value={k.id}>{k.title}</option>)}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Tab content */}
      <section className="rounded-[1.75rem] border border-slate-200/80 bg-white/60 p-6">
        {activeTab === "periods" && (
          <AssessmentPeriodList onSelectPeriod={(periodId) => handleSelectPeriod(periodId, "kras")} />
        )}

        {activeTab === "categories" && (
          <KraCategoryList />
        )}

        {activeTab === "kras" && selectedPeriodId && (
          <KraDefinitionList
            periodId={selectedPeriodId}
            periodName={selectedPeriodName ?? undefined}
            onSelectKra={(kraId) => handleSelectKra(kraId, "kpis")}
            onKrasLoaded={setKras}
            onBack={() => setActiveTab("periods")}
          />
        )}
        {activeTab === "kras" && !selectedPeriodId && (
          <div className="py-12 text-center text-sm text-slate-400">
            Select an assessment period to view KRAs
          </div>
        )}

        {activeTab === "kpis" && selectedKraId && (
          <KpiDefinitionList
            kraDefinitionId={selectedKraId}
            kraTitle={selectedKraTitle ?? undefined}
            kraWeightage={selectedKraWeightage}
            onBack={() => setActiveTab("kras")}
          />
        )}
        {activeTab === "kpis" && !selectedKraId && (
          <div className="py-12 text-center text-sm text-slate-400">
            Select a period and KRA to view KPIs
          </div>
        )}

        {activeTab === "targets" && selectedPeriodId && selectedKpiId && (
          <TargetAllocationTable
            periodId={selectedPeriodId}
            kpiDefinitionId={selectedKpiId}
            kpiTitle={selectedKpiTitle ?? undefined}
            measurementType={selectedKpiMeasurementType}
          />
        )}
        {activeTab === "targets" && (!selectedPeriodId || !selectedKpiId) && (
          <div className="py-12 text-center text-sm text-slate-400">
            Select a period, KRA, and KPI to view target allocations
          </div>
        )}

        {activeTab === "achievements" && selectedPeriodId && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              {!showAchievementForm && selectedKpiId && (
                <button
                  type="button"
                  onClick={() => setShowAchievementForm(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  <ClipboardCheck className="h-4 w-4" /> Record Achievement
                </button>
              )}
            </div>
            {showAchievementForm && selectedPeriodId && selectedKpiId && (
              <AchievementForm
                periodId={selectedPeriodId}
                kpiDefinitionId={selectedKpiId}
                measurementType={selectedKpiMeasurementType}
                onDone={() => setShowAchievementForm(false)}
                onCancel={() => setShowAchievementForm(false)}
              />
            )}
            <AchievementReviewList periodId={selectedPeriodId} kpiDefinitionId={selectedKpiId ?? undefined} />
          </div>
        )}
        {activeTab === "achievements" && !selectedPeriodId && (
          <div className="py-12 text-center text-sm text-slate-400">
            Select a period to view achievements
          </div>
        )}

        {activeTab === "dashboard" && selectedPeriodId && (
          <PeriodDashboard periodId={selectedPeriodId} />
        )}
        {activeTab === "dashboard" && !selectedPeriodId && (
          <div className="py-12 text-center text-sm text-slate-400">
            Select a period to view the dashboard
          </div>
        )}
      </section>
    </div>
  );
}
