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
  Gift,
  Users,
  Handshake,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { MeasurementConfig } from "@/lib/kra-kpi/shared";
import { AssessmentPeriodList } from "@/components/tenant/kra-kpi/assessment-period-list";
import { KraCategoryList } from "@/components/tenant/kra-kpi/kra-category-list";
import { KraDefinitionList } from "@/components/tenant/kra-kpi/kra-definition-list";
import { KpiDefinitionList } from "@/components/tenant/kra-kpi/kpi-definition-list";
import { TargetAllocationTable } from "@/components/tenant/kra-kpi/target-allocation-table";
import { AchievementReviewList } from "@/components/tenant/kra-kpi/achievement-review-list";
import { AchievementForm } from "@/components/tenant/kra-kpi/achievement-form";
import { PeriodDashboard } from "@/components/tenant/kra-kpi/period-dashboard";
import { BenefitTypeManager } from "@/components/tenant/kra-kpi/benefit-type-manager";
import { ContributorRoleManager } from "@/components/tenant/kra-kpi/contributor-role-manager";
import { ExternalTemplateManager } from "@/components/tenant/kra-kpi/external-template-manager";

type Tab =
  | "periods"
  | "categories"
  | "benefitTypes"
  | "contributorRoles"
  | "externalContributors"
  | "kras"
  | "kpis"
  | "targets"
  | "achievements"
  | "dashboard";

const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: "periods", label: "Periods", icon: Calendar },
  { key: "categories", label: "Categories", icon: Tag },
  { key: "benefitTypes", label: "Benefit Types", icon: Gift },
  { key: "contributorRoles", label: "Contributor Roles", icon: Users },
  { key: "externalContributors", label: "External Contributors", icon: Handshake },
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
  state: string;
  activeKpiCount: number;
  activeKpiWeightageSum: number;
  draftKpiCount: number;
};

type KpiView = {
  id: string;
  title: string;
  measurementType: string;
  measurementConfig: MeasurementConfig | null;
  state: string;
  kraState: string;
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

  useEffect(() => {
    if (!selectedPeriodId) {
      if (selectedPeriodName !== null) {
        setSelectedPeriodName(null);
      }
      return;
    }

    const selectedPeriod = periods.find((period) => period.id === selectedPeriodId);
    if (!selectedPeriod) {
      setSelectedPeriodId(null);
      setSelectedPeriodName(null);
      setSelectedKraId(null);
      setSelectedKpiId(null);
      setKras([]);
      setKpis([]);
      setShowAchievementForm(false);
      return;
    }

    if (selectedPeriod.name !== selectedPeriodName) {
      setSelectedPeriodName(selectedPeriod.name);
    }
  }, [periods, selectedPeriodId, selectedPeriodName]);

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

  useEffect(() => {
    if (!selectedKraId) {
      return;
    }
    if (!kras.some((kra) => kra.id === selectedKraId)) {
      setSelectedKraId(null);
      setSelectedKpiId(null);
      setKpis([]);
      setShowAchievementForm(false);
    }
  }, [kras, selectedKraId]);

  useEffect(() => {
    if (!selectedKpiId) {
      return;
    }
    if (!kpis.some((kpi) => kpi.id === selectedKpiId)) {
      setSelectedKpiId(null);
      setShowAchievementForm(false);
    }
  }, [kpis, selectedKpiId]);

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
  const selectedKpiMeasurementConfig = selectedKpi?.measurementConfig ?? null;
  const isSelectedKpiLive =
    selectedKpi?.state === "ACTIVE" && selectedKpi.kraState === "ACTIVE";
  const selectableKpis = kpis.filter(
    (kpi) => kpi.state === "ACTIVE" && kpi.kraState === "ACTIVE",
  );

  useEffect(() => {
    if (selectedKraId) {
      void fetchKpis(selectedKraId);
    }
  }, [fetchKpis, kras, selectedKraId]);

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
                {selectableKpis.map((k: KpiView) => <option key={k.id} value={k.id}>{k.title}</option>)}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Tab content */}
      <section className="rounded-[1.75rem] border border-slate-200/80 bg-white/60 p-6">
        {activeTab === "periods" && (
          <AssessmentPeriodList
            onSelectPeriod={(periodId) => handleSelectPeriod(periodId, "kras")}
            onPeriodsChanged={setPeriods}
          />
        )}

        {activeTab === "categories" && (
          <KraCategoryList />
        )}

        {activeTab === "benefitTypes" && (
          <BenefitTypeManager />
        )}

        {activeTab === "contributorRoles" && (
          <ContributorRoleManager />
        )}

        {activeTab === "externalContributors" && (
          <ExternalTemplateManager />
        )}

        {activeTab === "kras" && selectedPeriodId && (
          <KraDefinitionList
            periodId={selectedPeriodId}
            periodName={selectedPeriodName ?? undefined}
            availablePeriods={periods}
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
            onKpisLoaded={setKpis}
          />
        )}
        {activeTab === "kpis" && !selectedKraId && (
          <div className="py-12 text-center text-sm text-slate-400">
            Select a period and KRA to view KPIs
          </div>
        )}

        {activeTab === "targets" && selectedPeriodId && selectedKpiId && isSelectedKpiLive && (
          <TargetAllocationTable
            periodId={selectedPeriodId}
            kpiDefinitionId={selectedKpiId}
            kpiTitle={selectedKpiTitle ?? undefined}
            measurementType={selectedKpiMeasurementType}
            measurementConfig={selectedKpiMeasurementConfig}
          />
        )}
        {activeTab === "targets" && (!selectedPeriodId || !selectedKpiId) && (
          <div className="py-12 text-center text-sm text-slate-400">
            Select a period, KRA, and KPI to view target allocations
          </div>
        )}
        {activeTab === "targets" && selectedPeriodId && selectedKpiId && !isSelectedKpiLive && (
          <div className="py-12 text-center text-sm text-slate-400">
            Select an ACTIVE KPI to manage target allocations
          </div>
        )}

        {activeTab === "achievements" && selectedPeriodId && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              {!showAchievementForm && selectedKpiId && isSelectedKpiLive && (
                <button
                  type="button"
                  onClick={() => setShowAchievementForm(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  <ClipboardCheck className="h-4 w-4" /> Record Achievement
                </button>
              )}
            </div>
            {showAchievementForm && selectedPeriodId && selectedKpiId && isSelectedKpiLive && (
              <AchievementForm
                periodId={selectedPeriodId}
                kpiDefinitionId={selectedKpiId}
                measurementType={selectedKpiMeasurementType}
                onDone={() => setShowAchievementForm(false)}
                onCancel={() => setShowAchievementForm(false)}
              />
            )}
            <AchievementReviewList periodId={selectedPeriodId} kpiDefinitionId={isSelectedKpiLive ? selectedKpiId ?? undefined : undefined} />
          </div>
        )}
        {activeTab === "achievements" && !selectedPeriodId && (
          <div className="py-12 text-center text-sm text-slate-400">
            Select a period to view achievements
          </div>
        )}

        {activeTab === "dashboard" && selectedPeriodId && (
          <div className="space-y-4">
            <div className="flex items-center justify-end">
              <a
                href="/tenant-admin/kra-kpi/dashboard"
                className="inline-flex items-center gap-1.5 rounded-xl bg-slate-950 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800"
              >
                <LayoutDashboard className="h-3.5 w-3.5" />
                Full Dashboard
              </a>
            </div>
            <PeriodDashboard periodId={selectedPeriodId} />
          </div>
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
