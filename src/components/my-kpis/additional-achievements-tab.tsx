"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Clock,
  Eye,
  Pencil,
  Search,
  Undo2,
  XCircle,
} from "lucide-react";
import type {
  AchievementFormConfig,
  AchievementSubmissionConfig,
  AdditionalAchievementView,
} from "@/lib/kra-kpi/shared";
import { ACHIEVEMENT_TEMPLATES } from "@/lib/kra-kpi/shared";
import {
  MyAchievementForm,
  type AdditionalAchievementFormContext,
} from "./my-achievement-form";
import { MyAchievementTrail } from "./my-achievement-trail";

type AvailableKpiView = {
  kpiId: string;
  kpiTitle: string;
  kpiDescription: string | null;
  kpiWeightage: number;
  measurementType: string;
  unitLabel: string | null;
  achievementTemplateKey: string | null;
  achievementFormConfig: AchievementFormConfig | null;
  kraId: string;
  kraTitle: string;
  categoryKey: string | null;
  categoryLabel: string | null;
  startingUnitId: string;
  startingUnitName: string;
  defaultTarget: number | null;
  submissionConfig: AchievementSubmissionConfig;
};

type CategoryOption = {
  key: string;
  label: string;
};

type Props = {
  periodId: string;
  periodState: string;
  onRefresh?: () => void;
};

function formatDate(value: Date | string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatActual(achievement: AdditionalAchievementView) {
  if (achievement.actualValue != null) return String(achievement.actualValue);
  if (achievement.actualDate) return formatDate(achievement.actualDate);
  if (achievement.actualMilestone) return achievement.actualMilestone.replace(/_/g, " ");
  if (achievement.actualGrade) return achievement.actualGrade.replace(/_/g, " ");
  if (achievement.actualBoolean != null) return achievement.actualBoolean ? "Yes" : "No";
  if (achievement.actualRating != null) return `${achievement.actualRating}/10`;
  return "—";
}

function renderFormValue(value: unknown) {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function AchievementStateBadge({ state }: { state: string }) {
  switch (state) {
    case "DRAFT":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
          <Clock className="h-3 w-3" />
          Draft
        </span>
      );
    case "SUBMITTED":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
          <Clock className="h-3 w-3" />
          Submitted
        </span>
      );
    case "RECOMMENDED":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
          <CheckCircle2 className="h-3 w-3" />
          Recommended
        </span>
      );
    case "VERIFIED":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
          <CheckCircle2 className="h-3 w-3" />
          Verified
        </span>
      );
    case "REJECTED":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
          <XCircle className="h-3 w-3" />
          Not Approved
        </span>
      );
    default:
      return (
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
          {state}
        </span>
      );
  }
}

function toFormContextFromKpi(kpi: AvailableKpiView): AdditionalAchievementFormContext {
  return {
    periodId: "",
    kpiDefinitionId: kpi.kpiId,
    kpiTitle: kpi.kpiTitle,
    kraTitle: kpi.kraTitle,
    categoryLabel: kpi.categoryLabel,
    measurementType: kpi.measurementType as AdditionalAchievementFormContext["measurementType"],
    unitLabel: kpi.unitLabel,
    defaultTarget: kpi.defaultTarget,
    startingUnitName: kpi.startingUnitName,
    achievementTemplateKey: kpi.achievementTemplateKey,
    achievementFormConfig: kpi.achievementFormConfig,
    submissionConfig: kpi.submissionConfig,
    achievement: null,
  };
}

function toFormContextFromAchievement(
  achievement: AdditionalAchievementView,
): AdditionalAchievementFormContext {
  return {
    periodId: achievement.periodId,
    kpiDefinitionId: achievement.kpiDefinitionId,
    kpiTitle: achievement.kpiTitle,
    kraTitle: achievement.kraTitle,
    categoryLabel: achievement.categoryLabel,
    measurementType: achievement.measurementType,
    unitLabel: achievement.unitLabel,
    defaultTarget: achievement.defaultTarget,
    startingUnitName: achievement.startingUnitName,
    achievementTemplateKey: achievement.achievementTemplateKey,
    achievementFormConfig: achievement.achievementFormConfig,
    submissionConfig: achievement.submissionConfig,
    achievement,
  };
}

export function AdditionalAchievementsTab({ periodId, periodState, onRefresh }: Props) {
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [kpis, setKpis] = useState<AvailableKpiView[]>([]);
  const [myAchievements, setMyAchievements] = useState<AdditionalAchievementView[]>([]);
  const [loadingKpis, setLoadingKpis] = useState(true);
  const [loadingAchievements, setLoadingAchievements] = useState(true);
  const [kpiReloadKey, setKpiReloadKey] = useState(0);
  const [achievementReloadKey, setAchievementReloadKey] = useState(0);
  const [formContext, setFormContext] = useState<AdditionalAchievementFormContext | null>(null);
  const [expandedAchievementId, setExpandedAchievementId] = useState<string | null>(null);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const canRecord = periodState === "IN_PROGRESS" || periodState === "UNDER_REVIEW";

  useEffect(() => {
    let cancelled = false;

    async function loadKpis() {
      const params = new URLSearchParams({ periodId });
      if (search) params.set("search", search);
      if (categoryFilter) params.set("category", categoryFilter);

      try {
        const response = await fetch(
          `/api/tenant/kra-kpi/my/available-kpis?${params.toString()}`,
        );
        if (!response.ok) return;
        const data = (await response.json()) as AvailableKpiView[];
        if (!cancelled) {
          setKpis(data);
        }
      } finally {
        if (!cancelled) {
          setLoadingKpis(false);
        }
      }
    }

    void loadKpis();
    return () => {
      cancelled = true;
    };
  }, [periodId, search, categoryFilter, kpiReloadKey]);

  useEffect(() => {
    let cancelled = false;

    async function loadAchievements() {
      try {
        const response = await fetch(
          `/api/tenant/kra-kpi/my/additional-achievements?periodId=${periodId}`,
        );
        if (!response.ok) return;
        const data = (await response.json()) as AdditionalAchievementView[];
        if (!cancelled) {
          setMyAchievements(data);
        }
      } finally {
        if (!cancelled) {
          setLoadingAchievements(false);
        }
      }
    }

    void loadAchievements();
    return () => {
      cancelled = true;
    };
  }, [periodId, achievementReloadKey]);

  const categoriesMap = new Map<string, CategoryOption>();
  for (const kpi of kpis) {
    if (!kpi.categoryKey || !kpi.categoryLabel) continue;
    categoriesMap.set(kpi.categoryKey, {
      key: kpi.categoryKey,
      label: kpi.categoryLabel,
    });
  }
  const categories = [...categoriesMap.values()].sort((a, b) =>
    a.label.localeCompare(b.label),
  );

  const kraMap = new Map<string, { kraTitle: string; kpis: AvailableKpiView[] }>();
  for (const kpi of kpis) {
    const existing = kraMap.get(kpi.kraId);
    if (existing) {
      existing.kpis.push(kpi);
    } else {
      kraMap.set(kpi.kraId, { kraTitle: kpi.kraTitle, kpis: [kpi] });
    }
  }

  const handleDone = () => {
    setFormContext(null);
    setActionError(null);
    setLoadingKpis(true);
    setLoadingAchievements(true);
    setKpiReloadKey((value) => value + 1);
    setAchievementReloadKey((value) => value + 1);
    onRefresh?.();
  };

  const handleSearchSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setLoadingKpis(true);
    setSearch(searchInput.trim());
  };

  const handleCategoryChange = (nextValue: string) => {
    setLoadingKpis(true);
    setCategoryFilter(nextValue);
  };

  const handleWithdraw = async (achievementId: string) => {
    setActionError(null);
    setWithdrawingId(achievementId);

    try {
      const response = await fetch("/api/tenant/kra-kpi/my/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ achievementId }),
      });
      const data = (await response.json()) as { status: string; message: string };
      if (data.status === "error") {
        setActionError(data.message);
        setWithdrawingId(null);
        return;
      }

      setWithdrawingId(null);
      setLoadingAchievements(true);
      setAchievementReloadKey((value) => value + 1);
      onRefresh?.();
    } catch {
      setActionError("Failed to withdraw the submission.");
      setWithdrawingId(null);
    }
  };

  if (formContext) {
    const nextContext = { ...formContext, periodId };
    return (
      <MyAchievementForm
        additionalContext={nextContext}
        onDone={handleDone}
        onCancel={() => setFormContext(null)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-[linear-gradient(135deg,#ffffff_0%,#f8fafc_52%,#eef6ff_100%)] p-5 shadow-[0_24px_80px_-52px_rgba(15,23,42,0.4)]">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-2">
            <div className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
              Additional achievements
            </div>
            <div>
              <h3 className="text-xl font-semibold tracking-tight text-slate-950">Capture extra contributions</h3>
              <p className="mt-1 max-w-2xl text-sm text-slate-600">
                Search eligible KPIs, open a draft quickly, and continue editing saved submissions without losing progress.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[420px]">
            <div className="rounded-2xl border border-white/80 bg-white/85 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Available KPIs</div>
              <div className="mt-1 text-2xl font-semibold text-slate-950">{kpis.length}</div>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white/85 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">My drafts</div>
              <div className="mt-1 text-2xl font-semibold text-slate-950">
                {myAchievements.filter((achievement) => achievement.state === "DRAFT").length}
              </div>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white/85 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Pending review</div>
              <div className="mt-1 text-2xl font-semibold text-slate-950">
                {myAchievements.filter((achievement) => achievement.state === "SUBMITTED" || achievement.state === "RECOMMENDED").length}
              </div>
            </div>
          </div>
        </div>

        <form onSubmit={handleSearchSubmit} className="mt-5 flex flex-wrap items-center gap-3 rounded-[24px] border border-slate-200 bg-white/80 p-4">
          <div className="relative min-w-48 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search KPIs..."
              className="w-full rounded-xl border border-slate-300 py-2.5 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            type="submit"
            className="rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Search
          </button>
          {search && (
            <button
              type="button"
              onClick={() => {
                setLoadingKpis(true);
                setSearch("");
                setSearchInput("");
              }}
              className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Clear
            </button>
          )}
          {categories.length > 0 && (
            <div className="relative">
              <select
                value={categoryFilter}
                onChange={(event) => handleCategoryChange(event.target.value)}
                className="appearance-none rounded-xl border border-slate-300 py-2.5 pl-3 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Categories</option>
                {categories.map((category) => (
                  <option key={category.key} value={category.key}>
                    {category.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            </div>
          )}
        </form>
      </section>

      {!canRecord && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertCircle className="mr-1 inline h-4 w-4" />
          Recording additional achievements is not available during {periodState}.
        </div>
      )}

      {actionError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {actionError}
        </div>
      )}

      <section className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-600">
          Available KPIs
        </h3>

        {loadingKpis ? (
          <div className="py-8 text-center text-sm text-gray-500">Loading KPIs...</div>
        ) : kpis.length === 0 ? (
          <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50 py-10 text-center">
            <p className="text-sm text-gray-500">
              {search || categoryFilter
                ? "No KPIs match your search."
                : "No KPIs available for additional achievements in the current cycle."}
            </p>
          </div>
        ) : (
          [...kraMap.entries()].map(([kraId, group]) => (
            <div key={kraId} className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                {group.kraTitle}
              </h4>
              {group.kpis.map((kpi) => (
                <div
                  key={kpi.kpiId}
                  className="flex flex-wrap items-start justify-between gap-4 rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_18px_50px_-38px_rgba(15,23,42,0.3)]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">{kpi.kpiTitle}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{kpi.measurementType}</span>
                      {kpi.categoryLabel && (
                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                          {kpi.categoryLabel}
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      Dept: {kpi.startingUnitName} · Wt: {kpi.kpiWeightage}
                      {kpi.defaultTarget != null && (
                        <span className="ml-2 text-slate-400">Default target: {kpi.defaultTarget}</span>
                      )}
                      {kpi.achievementTemplateKey && (
                        <span className="ml-2 text-slate-400">
                          Template:{" "}
                          {ACHIEVEMENT_TEMPLATES[kpi.achievementTemplateKey]?.label ??
                            kpi.achievementTemplateKey}
                        </span>
                      )}
                    </p>
                    {kpi.kpiDescription && (
                      <p className="mt-2 line-clamp-2 text-xs text-slate-500">
                        {kpi.kpiDescription}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() =>
                      setFormContext({
                        ...toFormContextFromKpi(kpi),
                        periodId,
                      })
                    }
                    disabled={!canRecord}
                    className="inline-flex items-center rounded-full bg-blue-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    Record Achievement
                  </button>
                </div>
              ))}
            </div>
          ))
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-600">
          My Additional Achievements
        </h3>

        {loadingAchievements ? (
          <div className="py-4 text-center text-sm text-gray-500">Loading...</div>
        ) : myAchievements.length === 0 ? (
          <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50 py-8 text-center">
            <p className="text-sm text-gray-500">No additional achievements recorded yet.</p>
          </div>
        ) : (
          myAchievements.map((achievement) => {
            const isExpanded = expandedAchievementId === achievement.id;
            const canEdit = achievement.state === "DRAFT" || achievement.state === "REJECTED";
            const canWithdraw = achievement.state === "SUBMITTED";

            return (
              <div
                key={achievement.id}
                className="space-y-3 rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_18px_50px_-38px_rgba(15,23,42,0.3)]"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">
                        {achievement.kpiTitle}
                      </span>
                      <AchievementStateBadge state={achievement.state} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                      <span>Actual: {formatActual(achievement)}</span>
                      {achievement.computedScore != null && (
                        <span className="font-medium text-green-600">
                          Score: {Math.round(achievement.computedScore)}%
                        </span>
                      )}
                      <span>Recorded: {formatDate(achievement.reportingDate)}</span>
                    </div>
                    {achievement.rejectionReason && (
                      <p className="mt-1 text-xs text-red-600">
                        Reason: {achievement.rejectionReason}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedAchievementId(isExpanded ? null : achievement.id)
                      }
                      className="inline-flex items-center gap-1 rounded-full border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      View
                    </button>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => setFormContext(toFormContextFromAchievement(achievement))}
                        className="inline-flex items-center gap-1 rounded-full bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit
                      </button>
                    )}
                    {canWithdraw && (
                      <button
                        type="button"
                        onClick={() => void handleWithdraw(achievement.id)}
                        disabled={withdrawingId === achievement.id}
                        className="inline-flex items-center gap-1 rounded-full bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                      >
                        <Undo2 className="h-3.5 w-3.5" />
                        {withdrawingId === achievement.id ? "Withdrawing..." : "Withdraw"}
                      </button>
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <div className="space-y-3 border-t border-slate-100 pt-3">
                    {(achievement.submissionTrail.length > 0 || achievement.verificationLog.length > 0) && (
                      <MyAchievementTrail
                        trail={achievement.submissionTrail}
                        log={achievement.verificationLog}
                      />
                    )}

                    {achievement.achievementFormData &&
                      Object.keys(achievement.achievementFormData).length > 0 && (
                        <div className="space-y-1 rounded-2xl bg-slate-50 p-3 text-xs text-slate-600">
                          <div className="font-medium text-slate-700">Details</div>
                          {Object.entries(achievement.achievementFormData).map(([key, value]) => (
                            <div key={key}>
                              <span className="font-medium">{key}:</span> {renderFormValue(value)}
                            </div>
                          ))}
                        </div>
                      )}

                    {achievement.evidenceDescription && (
                      <div className="rounded-2xl bg-slate-50 p-3 text-xs text-slate-600">
                        <span className="font-medium text-slate-700">Notes:</span>{" "}
                        {achievement.evidenceDescription}
                      </div>
                    )}

                    {achievement.evidenceLinks.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {achievement.evidenceLinks.map((link) => (
                          <a
                            key={link}
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs text-blue-700 hover:bg-blue-100"
                          >
                            {link}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
