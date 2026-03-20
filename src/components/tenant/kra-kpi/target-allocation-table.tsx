"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Plus,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Lock,
  LockOpen,
  Trash2,
  GitBranch,
  Users,
  Building2,
  Pencil,
  Search,
  Check,
  CheckSquare,
  Square,
  ChevronDown,
  ChevronRight,
  X,
} from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import {
  getMeasurementCapValue,
  type MeasurementConfig,
  type KpiTargetUnitView,
} from "@/lib/kra-kpi/shared";
import { TargetCascadeForm } from "./target-cascade-form";
import { KpiTargetUnitsManager } from "./kpi-target-units-manager";

type AllocationView = {
  id: string;
  kpiDefinitionId: string;
  kpiTitle: string;
  assignedToUnitId: string | null;
  assignedToUnitName: string | null;
  assignedToUserId: string | null;
  assignedToUserName: string | null;
  targetValue: number | null;
  targetDate: string | null;
  targetMilestone: string | null;
  targetGrade: string | null;
  targetBoolean: boolean | null;
  targetRating: number | null;
  state: string;
  lockedAt: string | null;
  parentAllocationId: string | null;
  notes: string | null;
  childCount: number;
  achievementCount: number;
};

type KpiSetup = {
  startingUnitId: string;
  defaultTarget: number | null;
};

export type UnitOption = {
  id: string;
  name: string;
  code: string;
  parentId: string | null;
  level: number;
  typeKey: string;
  typeLabel: string;
  path?: string | null;
  state?: string | null;
};

export type UserOption = {
  id: string;
  name: string;
  email: string | null;
  employeeId: string | null;
  designation: string | null;
  role: string | null;
  status: string | null;
  primaryUnit: string | null;
  primaryUnitCode: string | null;
};

export type EditableAllocation = {
  id: string;
  assignedToUnitId: string | null;
  assignedToUnitName: string | null;
  assignedToUserId: string | null;
  assignedToUserName: string | null;
  targetValue: number | null;
  targetDate: string | null;
  targetMilestone: string | null;
  targetGrade: string | null;
  targetBoolean: boolean | null;
  targetRating: number | null;
  notes: string | null;
};

type Draft = {
  targetValue: string;
  targetDate: string;
  targetMilestone: string;
  targetGrade: string;
  targetBoolean: boolean | null;
  targetRating: string;
};

type UnitNode = { unit: UnitOption; children: UnitNode[] };

type AllocationFormProps = {
  periodId: string;
  kpiDefinitionId: string;
  measurementType: string;
  measurementConfig: MeasurementConfig | null;
  units: UnitOption[];
  users: UserOption[];
  parentAllocationId?: string;
  initialAllocation?: EditableAllocation;
  onDone: () => void;
  onCancel: () => void;
};

const emptyDraft = (): Draft => ({
  targetValue: "",
  targetDate: "",
  targetMilestone: "",
  targetGrade: "",
  targetBoolean: null,
  targetRating: "",
});

const MILESTONE_OPTIONS = [
  { value: "NOT_STARTED", label: "Not Started" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "COMPLETED", label: "Completed" },
];

const GRADE_OPTIONS = [
  { value: "OUTSTANDING", label: "Outstanding" },
  { value: "VERY_GOOD", label: "Very Good" },
  { value: "GOOD", label: "Good" },
  { value: "SATISFACTORY", label: "Satisfactory" },
  { value: "NEEDS_IMPROVEMENT", label: "Needs Improvement" },
  { value: "POOR", label: "Poor" },
];

export function TargetAllocationTable({
  periodId,
  kpiDefinitionId,
  kpiTitle,
  measurementType,
  measurementConfig,
}: {
  periodId: string;
  kpiDefinitionId: string;
  kpiTitle?: string;
  measurementType: string;
  measurementConfig: MeasurementConfig | null;
}) {
  const [allocations, setAllocations] = useState<AllocationView[]>([]);
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [kpiSetup, setKpiSetup] = useState<KpiSetup | null>(null);
  const [targetUnits, setTargetUnits] = useState<KpiTargetUnitView[]>([]);
  const [autoAllocationDraft, setAutoAllocationDraft] = useState<Draft>(emptyDraft());
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [cascadingId, setCascadingId] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [autoAllocating, setAutoAllocating] = useState(false);
  const [allocatedFilterMode, setAllocatedFilterMode] = useState<"all" | "unit" | "user">("all");
  const [allocatedUnitTypeFilter, setAllocatedUnitTypeFilter] = useState("ALL");
  const [allocatedUnitSearch, setAllocatedUnitSearch] = useState("");
  const [allocatedUserSearch, setAllocatedUserSearch] = useState("");
  const [selectedAllocatedUnitIds, setSelectedAllocatedUnitIds] = useState<string[]>([]);
  const [selectedAllocatedUserIds, setSelectedAllocatedUserIds] = useState<string[]>([]);
  const [allocatedExpandedIds, setAllocatedExpandedIds] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    try {
      const [allocRes, unitsRes, usersRes, kpiRes, targetUnitsRes] = await Promise.all([
        fetch(`/api/tenant/kra-kpi/targets?periodId=${periodId}&kpiDefinitionId=${kpiDefinitionId}`),
        fetch("/api/tenant/structure/units"),
        fetch("/api/tenant/users"),
        fetch(`/api/tenant/kra-kpi/kpis/${kpiDefinitionId}`),
        fetch(`/api/tenant/kra-kpi/kpis/${kpiDefinitionId}/target-units`),
      ]);
      const [allocData, unitsData, usersData, kpiData, targetUnitsData] = await Promise.all([
        allocRes.json(),
        unitsRes.json(),
        usersRes.json(),
        kpiRes.json(),
        targetUnitsRes.json(),
      ]);

      setAllocations(Array.isArray(allocData) ? allocData : []);
      setUnits(
        Array.isArray(unitsData)
          ? unitsData.map((unit: UnitOption) => ({
              id: unit.id,
              name: unit.name,
              code: unit.code ?? "",
              parentId: unit.parentId ?? null,
              level: unit.level ?? 0,
              typeKey: unit.typeKey ?? "UNKNOWN",
              typeLabel: unit.typeLabel ?? "Unknown",
              path: unit.path ?? null,
              state: unit.state ?? null,
            }))
          : [],
      );
      setUsers(
        Array.isArray(usersData)
          ? usersData.map((user: UserOption) => ({
              id: user.id,
              name: user.name,
              email: user.email ?? null,
              employeeId: user.employeeId ?? null,
              designation: user.designation ?? null,
              role: user.role ?? null,
              status: user.status ?? null,
              primaryUnit: user.primaryUnit ?? null,
              primaryUnitCode: user.primaryUnitCode ?? null,
            }))
          : [],
      );
      setKpiSetup(
        kpiRes.ok
          ? {
              startingUnitId: kpiData.startingUnitId ?? "",
              defaultTarget: kpiData.defaultTarget ?? null,
            }
          : null,
      );
      setTargetUnits(
        targetUnitsRes.ok && Array.isArray(targetUnitsData.targetUnits)
          ? targetUnitsData.targetUnits
          : [],
      );
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [periodId, kpiDefinitionId]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  useEffect(() => {
    setAutoAllocationDraft(
      buildAutoAllocationDraft(
        measurementType,
        kpiSetup?.defaultTarget ?? null,
      ),
    );
  }, [kpiDefinitionId, measurementType, kpiSetup?.defaultTarget]);

  useEffect(() => {
    setAllocatedFilterMode("all");
    setAllocatedUnitTypeFilter("ALL");
    setAllocatedUnitSearch("");
    setAllocatedUserSearch("");
    setSelectedAllocatedUnitIds([]);
    setSelectedAllocatedUserIds([]);
  }, [kpiDefinitionId]);

  const showFeedback = (type: "success" | "error", message: string) => {
    setFeedback({ type, message });
    setTimeout(() => setFeedback(null), 3500);
  };

  const handleLock = async (id: string) => {
    if (!window.confirm("Lock this allocation?")) return;
    setActionId(id);
    try {
      const res = await fetch(`/api/tenant/kra-kpi/targets/${id}/lock`, { method: "POST" });
      const data = await res.json();
      if (data.status === "success") {
        showFeedback("success", data.message);
        void fetchData();
      } else {
        showFeedback("error", data.message);
      }
    } catch { showFeedback("error", "Lock failed."); }
    finally { setActionId(null); }
  };

  const handleUnlock = async (id: string, openEditor = false) => {
    if (!window.confirm("Unlock this allocation so it can be corrected?")) return;
    setActionId(id);
    try {
      const res = await fetch(`/api/tenant/kra-kpi/targets/${id}/unlock`, { method: "POST" });
      const data = await res.json();
      if (data.status === "success") {
        if (openEditor) setEditingId(id);
        showFeedback("success", data.message);
        void fetchData();
      } else {
        showFeedback("error", data.message);
      }
    } catch { showFeedback("error", "Unlock failed."); }
    finally { setActionId(null); }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this allocation?")) return;
    setActionId(id);
    try {
      const res = await fetch(`/api/tenant/kra-kpi/targets/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.status === "success") {
        showFeedback("success", data.message);
        void fetchData();
      } else {
        showFeedback("error", data.message);
      }
    } catch { showFeedback("error", "Delete failed."); }
    finally { setActionId(null); }
  };

  const handleAutoAllocate = async () => {
    const validation = validateDraft(
      autoAllocationDraft,
      measurementType,
      measurementConfig,
    );
    if (validation) {
      showFeedback("error", validation);
      return;
    }

    setAutoAllocating(true);
    try {
      const response = await fetch(
        `/api/tenant/kra-kpi/kpis/${kpiDefinitionId}/allocate-to-targets`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            periodId,
            ...buildPayload(autoAllocationDraft, measurementType),
          }),
        },
      );
      const data = await response.json();

      if (!response.ok || data.status === "error") {
        showFeedback("error", data.message ?? "Auto-allocation failed.");
        setAutoAllocating(false);
        return;
      }

      showFeedback("success", data.message ?? "Targets allocated.");
      void fetchData();
    } catch {
      showFeedback("error", "Auto-allocation failed.");
    } finally {
      setAutoAllocating(false);
    }
  };

  const rootAllocations = useMemo(
    () => allocations.filter((allocation) => !allocation.parentAllocationId),
    [allocations],
  );
  const configuredCap = getMeasurementCapValue(measurementType, measurementConfig);
  const topLevelAllocatedTotal = rootAllocations.reduce(
    (sum, allocation) => sum + (allocation.targetValue ?? 0),
    0,
  );
  const childrenMap = useMemo(() => buildChildrenMap(allocations), [allocations]);
  const childrenOf = useCallback(
    (parentId: string) => childrenMap.get(parentId) ?? [],
    [childrenMap],
  );
  const allocatedUnitIds = useMemo(
    () =>
      Array.from(
        new Set(
          allocations
            .map((allocation) => allocation.assignedToUnitId)
            .filter((unitId): unitId is string => !!unitId),
        ),
      ),
    [allocations],
  );
  const allocatedUserIds = useMemo(
    () =>
      Array.from(
        new Set(
          allocations
            .map((allocation) => allocation.assignedToUserId)
            .filter((userId): userId is string => !!userId),
        ),
      ),
    [allocations],
  );
  const allocatedUnits = useMemo(
    () => units.filter((unit) => allocatedUnitIds.includes(unit.id)),
    [allocatedUnitIds, units],
  );
  const allocatedUsers = useMemo(
    () => users.filter((user) => allocatedUserIds.includes(user.id)),
    [allocatedUserIds, users],
  );
  const allocatedUnitTypeOptions = useMemo(
    () =>
      Array.from(
        new Map(
          allocatedUnits.map((unit) => [unit.typeKey, unit.typeLabel]),
        ).entries(),
      ),
    [allocatedUnits],
  );
  const visibleAllocatedUnitIds = useMemo(
    () =>
      getVisibleUnitIds(
        allocatedUnits,
        allocatedUnitTypeFilter,
        allocatedUnitSearch,
      ),
    [allocatedUnitSearch, allocatedUnitTypeFilter, allocatedUnits],
  );
  const allocatedUnitTree = useMemo(
    () => buildUnitTree(allocatedUnits, visibleAllocatedUnitIds),
    [allocatedUnits, visibleAllocatedUnitIds],
  );
  const filteredAllocatedUsers = useMemo(
    () => filterUsers(allocatedUsers, allocatedUserSearch),
    [allocatedUserSearch, allocatedUsers],
  );
  const visibleAllocatedUserIds = useMemo(
    () => filteredAllocatedUsers.map((user) => user.id),
    [filteredAllocatedUsers],
  );
  const visibleAllocationIds = useMemo(
    () =>
      buildVisibleAllocationIds({
        allocations,
        mode: allocatedFilterMode,
        visibleUnitIds: visibleAllocatedUnitIds,
        selectedUnitIds: selectedAllocatedUnitIds,
        visibleUserIds: visibleAllocatedUserIds,
        selectedUserIds: selectedAllocatedUserIds,
      }),
    [
      allocations,
      allocatedFilterMode,
      selectedAllocatedUnitIds,
      selectedAllocatedUserIds,
      visibleAllocatedUnitIds,
      visibleAllocatedUserIds,
    ],
  );
  const visibleRootAllocations = useMemo(
    () =>
      rootAllocations.filter((allocation) => visibleAllocationIds.has(allocation.id)),
    [rootAllocations, visibleAllocationIds],
  );

  useEffect(() => {
    setAllocatedExpandedIds(new Set(allocatedUnits.map((unit) => unit.id)));
  }, [allocatedUnits]);

  useEffect(() => {
    setSelectedAllocatedUnitIds((current) =>
      current.filter((id) => allocatedUnitIds.includes(id)),
    );
  }, [allocatedUnitIds]);

  useEffect(() => {
    setSelectedAllocatedUserIds((current) =>
      current.filter((id) => allocatedUserIds.includes(id)),
    );
  }, [allocatedUserIds]);

  const editingAllocation = useMemo(
    () => allocations.find((allocation) => allocation.id === editingId) ?? null,
    [allocations, editingId],
  );
  const editingInitial = editingAllocation ? toEditableAllocation(editingAllocation) : undefined;
  const allocatedSelectionCount =
    allocatedFilterMode === "unit"
      ? selectedAllocatedUnitIds.length
      : allocatedFilterMode === "user"
        ? selectedAllocatedUserIds.length
        : 0;

  const toggleAllocatedUnitSelected = (id: string) => {
    setSelectedAllocatedUnitIds((current) =>
      current.includes(id)
        ? current.filter((currentId) => currentId !== id)
        : [...current, id],
    );
  };

  const toggleAllocatedUserSelected = (id: string) => {
    setSelectedAllocatedUserIds((current) =>
      current.includes(id)
        ? current.filter((currentId) => currentId !== id)
        : [...current, id],
    );
  };

  const selectAllVisibleAllocated = () => {
    if (allocatedFilterMode === "unit") {
      setSelectedAllocatedUnitIds(visibleAllocatedUnitIds);
      return;
    }
    if (allocatedFilterMode === "user") {
      setSelectedAllocatedUserIds(visibleAllocatedUserIds);
    }
  };

  const clearAllocatedSelection = () => {
    if (allocatedFilterMode === "unit") {
      setSelectedAllocatedUnitIds([]);
      return;
    }
    if (allocatedFilterMode === "user") {
      setSelectedAllocatedUserIds([]);
    }
  };

  function formatTarget(a: AllocationView): string {
    if (a.targetValue != null) return String(a.targetValue);
    if (a.targetDate) return new Date(a.targetDate).toLocaleDateString();
    if (a.targetMilestone) return a.targetMilestone.replace(/_/g, " ");
    if (a.targetGrade) return a.targetGrade.replace(/_/g, " ");
    if (a.targetBoolean != null) return a.targetBoolean ? "Yes" : "No";
    if (a.targetRating != null) return `${a.targetRating}/10`;
    return "—";
  }

  if (loading) return <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>;

  const renderRow = (a: AllocationView, depth: number) => {
    if (!visibleAllocationIds.has(a.id)) {
      return null;
    }

    return (
    <div key={a.id}>
      <div className={`group flex items-center gap-3 rounded-lg border border-slate-200/70 bg-white px-3 py-2.5 transition hover:border-slate-300`} style={{ marginLeft: depth * 24 }}>
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
          {a.assignedToUserId ? <Users className="h-3.5 w-3.5" /> : <Building2 className="h-3.5 w-3.5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-900">
              {a.assignedToUserName ?? a.assignedToUnitName ?? "Unassigned"}
            </span>
            <StatusBadge label={a.state} />
          </div>
          <div className="mt-0.5 flex items-center gap-3 text-[11px] text-slate-400">
            <span className="font-semibold text-slate-600">Target: {formatTarget(a)}</span>
            {a.childCount > 0 && <span>{a.childCount} child(ren)</span>}
            {a.achievementCount > 0 && <span>{a.achievementCount} achievement(s)</span>}
            {a.notes && <span className="truncate">{a.notes}</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {a.state === "ACTIVE" && (
            <>
              <button type="button" onClick={() => setEditingId((current) => (current === a.id ? null : a.id))} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:border-brand hover:text-brand" title="Edit target">
                <Pencil className="h-3 w-3" /> Edit
              </button>
              <button type="button" onClick={() => handleLock(a.id)} disabled={actionId === a.id} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:border-amber-200 hover:text-amber-700 disabled:opacity-50" title="Lock">
                {actionId === a.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Lock className="h-3 w-3" />} Lock
              </button>
              {!a.assignedToUserId && (
                <button type="button" onClick={() => setCascadingId(a.id)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:border-brand hover:text-brand" title="Cascade">
                  <GitBranch className="h-3 w-3" /> Cascade
                </button>
              )}
              <button type="button" onClick={() => handleDelete(a.id)} disabled={actionId === a.id} className="flex h-6 w-6 items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:border-rose-200 hover:text-rose-600 disabled:opacity-50">
                {actionId === a.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
              </button>
            </>
          )}
          {a.state === "LOCKED" && (
            <button
              type="button"
              onClick={() => handleUnlock(a.id, true)}
              disabled={actionId === a.id}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:border-emerald-200 hover:text-emerald-700 disabled:opacity-50"
              title="Unlock and edit target"
            >
              {actionId === a.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <LockOpen className="h-3 w-3" />} Unlock & Edit
            </button>
          )}
        </div>
      </div>
      {editingId === a.id && (
        <div className="mt-1" style={{ marginLeft: (depth + 1) * 24 }}>
          <AllocationForm
            periodId={periodId}
            kpiDefinitionId={kpiDefinitionId}
            measurementType={measurementType}
            measurementConfig={measurementConfig}
            units={units}
            users={users}
            initialAllocation={editingInitial}
            onDone={() => { setEditingId(null); showFeedback("success", "Target updated."); void fetchData(); }}
            onCancel={() => setEditingId(null)}
          />
        </div>
      )}
      {cascadingId === a.id && (
        <div className="mt-1" style={{ marginLeft: (depth + 1) * 24 }}>
          <TargetCascadeForm
            parentAllocationId={a.id}
            parentTargetValue={a.targetValue}
            measurementType={measurementType}
            units={units.map((unit) => ({ id: unit.id, name: unit.name }))}
            users={users.map((user) => ({ id: user.id, name: user.name }))}
            onDone={() => { setCascadingId(null); showFeedback("success", "Target cascaded."); void fetchData(); }}
            onCancel={() => setCascadingId(null)}
          />
        </div>
      )}
      {childrenOf(a.id)
        .filter((child) => visibleAllocationIds.has(child.id))
        .map((child) => renderRow(child, depth + 1))}
    </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-900">
          Target Allocations {kpiTitle && <span className="font-normal text-slate-400">— {kpiTitle}</span>}
        </h4>
        {!addingNew && (
          <button type="button" onClick={() => setAddingNew(true)} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-950 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800">
            <Plus className="h-3.5 w-3.5" /> Allocate
          </button>
        )}
      </div>

      {configuredCap != null && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          KPI cap enabled: {configuredCap}
          {measurementType !== "RATING" && (
            <span className="ml-2">
              Top-level allocated total: {topLevelAllocatedTotal}/{configuredCap}
            </span>
          )}
        </div>
      )}

      {feedback && (
        <div className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm ${feedback.type === "success" ? "border-brand/20 bg-brand/5 text-brand" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
          {feedback.type === "success" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
          {feedback.message}
        </div>
      )}

      {kpiSetup ? (
        <KpiTargetUnitsManager
          kpiId={kpiDefinitionId}
          startingUnitId={kpiSetup.startingUnitId}
          units={units.map((unit) => ({ id: unit.id, name: unit.name }))}
          targetUnits={targetUnits}
          onChanged={() => void fetchData()}
        />
      ) : null}

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h5 className="text-sm font-semibold text-slate-900">
              Allocate To Configured Departments
            </h5>
            <p className="mt-1 text-xs text-slate-500">
              Use the configured target departments above to create department allocations directly from this tab.
            </p>
          </div>
          {kpiSetup?.defaultTarget != null ? (
            <button
              type="button"
              onClick={() =>
                setAutoAllocationDraft(
                  buildAutoAllocationDraft(
                    measurementType,
                    kpiSetup.defaultTarget,
                  ),
                )
              }
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-600 transition hover:border-slate-300"
            >
              Use KPI default
            </button>
          ) : null}
        </div>

        {targetUnits.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
            Add one or more target departments first. Then this action will create allocations for them using the target value entered here.
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              {getAutoAllocationHint(measurementType)}
            </div>

            <TargetEditor
              title="Allocation target"
              caption={
                kpiSetup?.defaultTarget != null &&
                (measurementType === "NUMERIC" ||
                  measurementType === "PERCENTAGE" ||
                  measurementType === "CURRENCY" ||
                  measurementType === "RATING")
                  ? `Default KPI target: ${kpiSetup.defaultTarget}`
                  : "Enter the target that should be applied to the configured departments."
              }
              draft={autoAllocationDraft}
              measurementType={measurementType}
              measurementConfig={measurementConfig}
              inputCls="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand focus:ring-1 focus:ring-brand/30"
              labelCls="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500"
              onChange={(patch) =>
                setAutoAllocationDraft((current) => ({ ...current, ...patch }))
              }
            />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-slate-500">
                Existing allocations for configured departments are skipped automatically.
              </p>
              <button
                type="button"
                onClick={() => void handleAutoAllocate()}
                disabled={autoAllocating || targetUnits.length === 0}
                className="inline-flex items-center gap-1.5 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {autoAllocating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Allocate To Targets
              </button>
            </div>
          </div>
        )}
      </div>

      {addingNew && (
        <AllocationForm
          periodId={periodId}
          kpiDefinitionId={kpiDefinitionId}
          measurementType={measurementType}
          measurementConfig={measurementConfig}
          units={units}
          users={users}
          onDone={() => { setAddingNew(false); showFeedback("success", "Target allocated."); void fetchData(); }}
          onCancel={() => setAddingNew(false)}
        />
      )}

      {allocations.length > 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h5 className="text-sm font-semibold text-slate-900">
                Filter Allocated Entities
              </h5>
              <p className="mt-1 text-xs text-slate-500">
                Narrow the current allocation tree by already allocated departments or users for review and verification.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setAllocatedFilterMode("all")}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  allocatedFilterMode === "all"
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setAllocatedFilterMode("unit")}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  allocatedFilterMode === "unit"
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                Units
              </button>
              <button
                type="button"
                onClick={() => setAllocatedFilterMode("user")}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  allocatedFilterMode === "user"
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                Users
              </button>
            </div>
          </div>

          {allocatedFilterMode === "all" ? (
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Showing the full allocation tree.
            </div>
          ) : null}

          {allocatedFilterMode === "unit" ? (
            <div className="mt-4 space-y-3">
              <div className="grid gap-3 md:grid-cols-[220px_1fr]">
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Unit type filter
                  </label>
                  <select
                    value={allocatedUnitTypeFilter}
                    onChange={(event) =>
                      setAllocatedUnitTypeFilter(event.target.value)
                    }
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand focus:ring-1 focus:ring-brand/30"
                  >
                    <option value="ALL">All unit types</option>
                    {allocatedUnitTypeOptions.map(([typeKey, typeLabel]) => (
                      <option key={typeKey} value={typeKey}>
                        {typeLabel}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Search allocated units
                  </label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                    <input
                      type="text"
                      value={allocatedUnitSearch}
                      onChange={(event) =>
                        setAllocatedUnitSearch(event.target.value)
                      }
                      placeholder="Search by unit name, code, path, or type"
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 pl-9 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand focus:ring-1 focus:ring-brand/30"
                    />
                  </div>
                </div>
              </div>

              <SelectionToolbar
                selectedCount={allocatedSelectionCount}
                visibleCount={visibleAllocatedUnitIds.length}
                label="units"
                onSelectAll={selectAllVisibleAllocated}
                onClear={clearAllocatedSelection}
              />

              {allocatedUnitTree.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-400">
                  No allocated units match the current filters.
                </div>
              ) : (
                <div className="max-h-80 overflow-auto rounded-2xl border border-slate-200 bg-slate-50/60 p-3">
                  <UnitTree
                    nodes={allocatedUnitTree}
                    expandedIds={allocatedExpandedIds}
                    selectedIds={selectedAllocatedUnitIds}
                    onToggleExpand={(id) =>
                      setAllocatedExpandedIds((current) => {
                        const next = new Set(current);
                        if (next.has(id)) next.delete(id);
                        else next.add(id);
                        return next;
                      })
                    }
                    onToggleSelected={toggleAllocatedUnitSelected}
                  />
                </div>
              )}
            </div>
          ) : null}

          {allocatedFilterMode === "user" ? (
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Search allocated users
                </label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    value={allocatedUserSearch}
                    onChange={(event) => setAllocatedUserSearch(event.target.value)}
                    placeholder="Search by name, employee ID, email, designation, role, or unit"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 pl-9 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand focus:ring-1 focus:ring-brand/30"
                  />
                </div>
              </div>

              <SelectionToolbar
                selectedCount={allocatedSelectionCount}
                visibleCount={visibleAllocatedUserIds.length}
                label="users"
                onSelectAll={selectAllVisibleAllocated}
                onClear={clearAllocatedSelection}
              />

              {filteredAllocatedUsers.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-400">
                  No allocated users match the current filters.
                </div>
              ) : (
                <div className="max-h-80 space-y-2 overflow-auto rounded-2xl border border-slate-200 bg-slate-50/60 p-3">
                  {filteredAllocatedUsers.map((user) => (
                    <SelectableRow
                      key={user.id}
                      selected={selectedAllocatedUserIds.includes(user.id)}
                      onClick={() => toggleAllocatedUserSelected(user.id)}
                      title={
                        user.employeeId
                          ? `${user.name} (${user.employeeId})`
                          : user.name
                      }
                      subtitle={buildUserSummary(user)}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {allocations.length === 0 && !addingNew ? (
        <div className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">
          No allocations yet
        </div>
      ) : visibleRootAllocations.length === 0 && !addingNew ? (
        <div className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">
          No allocations match the current allocated-entity filters
        </div>
      ) : (
        <div className="space-y-1">
          {visibleRootAllocations.map((allocation) => renderRow(allocation, 0))}
        </div>
      )}
    </div>
  );
}

function toEditableAllocation(allocation: AllocationView): EditableAllocation {
  return {
    id: allocation.id,
    assignedToUnitId: allocation.assignedToUnitId,
    assignedToUnitName: allocation.assignedToUnitName,
    assignedToUserId: allocation.assignedToUserId,
    assignedToUserName: allocation.assignedToUserName,
    targetValue: allocation.targetValue,
    targetDate: allocation.targetDate,
    targetMilestone: allocation.targetMilestone,
    targetGrade: allocation.targetGrade,
    targetBoolean: allocation.targetBoolean,
    targetRating: allocation.targetRating,
    notes: allocation.notes,
  };
}

function AllocationForm({
  periodId,
  kpiDefinitionId,
  measurementType,
  measurementConfig,
  units,
  users,
  parentAllocationId,
  initialAllocation,
  onDone,
  onCancel,
}: AllocationFormProps) {
  const isEditing = !!initialAllocation;
  const initialType: "unit" | "user" = initialAllocation?.assignedToUserId ? "user" : "unit";
  const [assignToType, setAssignToType] = useState<"unit" | "user">(initialType);
  const [selectedUnitIds, setSelectedUnitIds] = useState<string[]>(
    initialAllocation?.assignedToUnitId ? [initialAllocation.assignedToUnitId] : [],
  );
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>(
    initialAllocation?.assignedToUserId ? [initialAllocation.assignedToUserId] : [],
  );
  const [useSharedValue, setUseSharedValue] = useState(true);
  const [sharedDraft, setSharedDraft] = useState<Draft>(toDraft(initialAllocation));
  const [unitDrafts, setUnitDrafts] = useState<Record<string, Draft>>({});
  const [userDrafts, setUserDrafts] = useState<Record<string, Draft>>({});
  const [notes, setNotes] = useState(initialAllocation?.notes ?? "");
  const [unitTypeFilter, setUnitTypeFilter] = useState("ALL");
  const [unitSearch, setUnitSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setExpandedIds(new Set(units.map((unit) => unit.id)));
  }, [units]);

  useEffect(() => {
    if (!isEditing) return;
    setAssignToType(initialType);
    setSelectedUnitIds(initialAllocation?.assignedToUnitId ? [initialAllocation.assignedToUnitId] : []);
    setSelectedUserIds(initialAllocation?.assignedToUserId ? [initialAllocation.assignedToUserId] : []);
    setSharedDraft(toDraft(initialAllocation));
    setNotes(initialAllocation?.notes ?? "");
    setUseSharedValue(true);
  }, [initialAllocation, initialType, isEditing]);

  useEffect(() => {
    if (selectedUnitIds.length <= 1 && selectedUserIds.length <= 1) {
      setUseSharedValue(true);
    }
  }, [selectedUnitIds.length, selectedUserIds.length]);

  const selectedIds = assignToType === "unit" ? selectedUnitIds : selectedUserIds;
  const selectedCount = selectedIds.length;
  const labelCls = "mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500";
  const inputCls = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand focus:ring-1 focus:ring-brand/30";
  const unitTypeOptions = useMemo(
    () => Array.from(new Map(units.map((unit) => [unit.typeKey, unit.typeLabel])).entries()),
    [units],
  );
  const visibleUnitIds = useMemo(
    () => getVisibleUnitIds(units, unitTypeFilter, unitSearch),
    [units, unitTypeFilter, unitSearch],
  );
  const unitTree = useMemo(() => buildUnitTree(units, visibleUnitIds), [units, visibleUnitIds]);
  const filteredUsers = useMemo(() => filterUsers(users, userSearch), [users, userSearch]);
  const visibleUserIds = filteredUsers.map((user) => user.id);
  const labelMap = useMemo(
    () =>
      new Map([
        ...units.map((unit) => [unit.id, `${unit.name}${unit.code ? ` (${unit.code})` : ""}`] as const),
        ...users.map((user) => [user.id, user.employeeId ? `${user.name} (${user.employeeId})` : user.name] as const),
      ]),
    [units, users],
  );

  const toggleSelected = (id: string) => {
    if (isEditing) return;
    const setter = assignToType === "unit" ? setSelectedUnitIds : setSelectedUserIds;
    setter((prev) => (prev.includes(id) ? prev.filter((current) => current !== id) : [...prev, id]));
  };

  const selectAll = () => {
    if (isEditing) return;
    if (assignToType === "unit") setSelectedUnitIds(visibleUnitIds);
    else setSelectedUserIds(visibleUserIds);
  };

  const clearSelected = () => {
    if (isEditing) return;
    if (assignToType === "unit") setSelectedUnitIds([]);
    else setSelectedUserIds([]);
  };

  const currentDraft = (id: string) => {
    if (isEditing || useSharedValue) return sharedDraft;
    return (assignToType === "unit" ? unitDrafts[id] : userDrafts[id]) ?? emptyDraft();
  };

  const setDraftPatch = (id: string, patch: Partial<Draft>) => {
    if (isEditing || useSharedValue) {
      setSharedDraft((prev) => ({ ...prev, ...patch }));
      return;
    }
    const setter = assignToType === "unit" ? setUnitDrafts : setUserDrafts;
    setter((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] ?? emptyDraft()),
        ...patch,
      },
    }));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!selectedCount) {
      setError(`Select at least one ${assignToType}.`);
      return;
    }

    setSubmitting(true);

    try {
      if (isEditing && initialAllocation) {
        const validation = validateDraft(sharedDraft, measurementType, measurementConfig);
        if (validation) {
          setError(validation);
          setSubmitting(false);
          return;
        }

        const response = await fetch(`/api/tenant/kra-kpi/targets/${initialAllocation.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...buildPayload(sharedDraft, measurementType),
            notes: notes.trim() || null,
          }),
        });
        const data = await response.json();
        if (data.status === "error") {
          setError(data.message);
          setSubmitting(false);
          return;
        }
        onDone();
        return;
      }

      const allocations = selectedIds.map((id) => {
        const draft = currentDraft(id);
        const validation = validateDraft(draft, measurementType, measurementConfig);
        if (validation) throw new Error(`${labelMap.get(id) ?? id}: ${validation}`);
        return {
          ...(assignToType === "unit" ? { assignedToUnitId: id } : { assignedToUserId: id }),
          ...buildPayload(draft, measurementType),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
          ...(parentAllocationId ? { parentAllocationId } : {}),
        };
      });

      const response = await fetch("/api/tenant/kra-kpi/targets/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodId, kpiDefinitionId, allocations }),
      });
      const data = await response.json();
      if (data.status === "error") {
        setError(data.message);
        setSubmitting(false);
        return;
      }
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed.");
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-brand/20 bg-brand/5 p-4">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-xs font-semibold text-brand">{isEditing ? "Edit target allocation" : "New target allocation"}</span>
        <button type="button" onClick={onCancel} className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 hover:text-slate-700">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-4">
        {isEditing ? (
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Assigned to</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">{initialAllocation?.assignedToUserName ?? initialAllocation?.assignedToUnitName ?? "Unassigned"}</p>
            <p className="mt-1 text-xs text-slate-400">Edit mode updates the target without changing the assignee.</p>
          </div>
        ) : (
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-2">
              <span className={labelCls}>Assign to</span>
              <button type="button" onClick={() => setAssignToType("unit")} className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${assignToType === "unit" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>Unit</button>
              <button type="button" onClick={() => setAssignToType("user")} className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${assignToType === "user" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>User</button>
            </div>

            {assignToType === "unit" ? (
              <div className="space-y-3">
                <div className="grid gap-3 md:grid-cols-[220px_1fr]">
                  <div>
                    <label className={labelCls}>Unit type filter</label>
                    <select value={unitTypeFilter} onChange={(event) => setUnitTypeFilter(event.target.value)} className={inputCls}>
                      <option value="ALL">All unit types</option>
                      {unitTypeOptions.map(([typeKey, typeLabel]) => <option key={typeKey} value={typeKey}>{typeLabel}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Search units</label>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                      <input type="text" value={unitSearch} onChange={(event) => setUnitSearch(event.target.value)} placeholder="Search by unit name, code, path, or type" className={`${inputCls} pl-9`} />
                    </div>
                  </div>
                </div>

                <SelectionToolbar selectedCount={selectedCount} visibleCount={visibleUnitIds.length} label="units" onSelectAll={selectAll} onClear={clearSelected} />

                {unitTree.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-3 text-sm text-slate-400">No units match the current filters.</div>
                ) : (
                  <div className="max-h-80 overflow-auto rounded-2xl border border-slate-200 bg-slate-50/60 p-3">
                    <UnitTree nodes={unitTree} expandedIds={expandedIds} selectedIds={selectedUnitIds} onToggleExpand={(id) => setExpandedIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; })} onToggleSelected={toggleSelected} />
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className={labelCls}>Find users</label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                    <input type="text" value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="Search by name, employee ID, email, designation, role, or unit" className={`${inputCls} pl-9`} />
                  </div>
                </div>

                <SelectionToolbar selectedCount={selectedCount} visibleCount={visibleUserIds.length} label="users" onSelectAll={selectAll} onClear={clearSelected} />

                {filteredUsers.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-3 text-sm text-slate-400">No users match the current filters.</div>
                ) : (
                  <div className="max-h-80 space-y-2 overflow-auto rounded-2xl border border-slate-200 bg-slate-50/60 p-3">
                    {filteredUsers.map((user) => (
                      <SelectableRow key={user.id} selected={selectedUserIds.includes(user.id)} onClick={() => toggleSelected(user.id)} title={user.employeeId ? `${user.name} (${user.employeeId})` : user.name} subtitle={buildUserSummary(user)} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {!isEditing && selectedCount > 1 ? (
          <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Apply the same target to all selected {assignToType === "unit" ? "units" : "users"}?</p>
              <p className="text-xs text-slate-400">Turn this off to enter a separate target for each selected assignee.</p>
            </div>
            <button type="button" onClick={() => setUseSharedValue((prev) => !prev)} className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${useSharedValue ? "bg-brand text-white" : "bg-slate-100 text-slate-600"}`}>
              {useSharedValue ? "Shared value on" : "Individual values on"}
            </button>
          </div>
        ) : null}

        {selectedCount > 0 ? (
          isEditing || useSharedValue ? (
            <TargetEditor title={isEditing ? "Edit target" : "Target for selected assignees"} draft={sharedDraft} measurementType={measurementType} measurementConfig={measurementConfig} inputCls={inputCls} labelCls={labelCls} onChange={(patch) => setDraftPatch(selectedIds[0] ?? "", patch)} />
          ) : (
            <div className="space-y-3">
              {selectedIds.map((id) => (
                <TargetEditor key={id} title={labelMap.get(id) ?? id} caption="Individual target" draft={currentDraft(id)} measurementType={measurementType} measurementConfig={measurementConfig} inputCls={inputCls} labelCls={labelCls} onChange={(patch) => setDraftPatch(id, patch)} />
              ))}
            </div>
          )
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-400">Select one or more {assignToType === "unit" ? "units" : "users"} to continue.</div>
        )}

        <div>
          <label className={labelCls}>Notes</label>
          <input type="text" placeholder="Optional" value={notes} onChange={(event) => setNotes(event.target.value)} className={inputCls} />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button type="submit" disabled={submitting} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand/90 disabled:opacity-50">
          {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          {isEditing ? "Save target" : "Allocate"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300">Cancel</button>
      </div>

      {error ? <div className="mt-2 flex items-center gap-1.5 text-xs text-rose-600"><AlertCircle className="h-3 w-3 shrink-0" /> {error}</div> : null}
    </form>
  );
}

function SelectionToolbar({
  selectedCount,
  visibleCount,
  label,
  onSelectAll,
  onClear,
}: {
  selectedCount: number;
  visibleCount: number;
  label: string;
  onSelectAll: () => void;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-xs text-slate-500">
        <span className="font-semibold text-slate-800">{selectedCount}</span> selected out of{" "}
        <span className="font-semibold text-slate-800">{visibleCount}</span> visible {label}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onSelectAll}
          disabled={visibleCount === 0}
          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-slate-300 disabled:opacity-50"
        >
          Select visible
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={selectedCount === 0}
          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-slate-300 disabled:opacity-50"
        >
          Clear
        </button>
      </div>
    </div>
  );
}

function SelectableRow({
  selected,
  title,
  subtitle,
  onClick,
}: {
  selected: boolean;
  title: string;
  subtitle?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition ${
        selected ? "border-brand/30 bg-brand/5" : "border-slate-200 bg-white hover:border-slate-300"
      }`}
    >
      <div className="pt-0.5 text-brand">
        {selected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4 text-slate-400" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-900">{title}</p>
        {subtitle ? <p className="mt-1 text-xs text-slate-500">{subtitle}</p> : null}
      </div>
    </button>
  );
}

function UnitTree({
  nodes,
  depth = 0,
  expandedIds,
  selectedIds,
  onToggleExpand,
  onToggleSelected,
}: {
  nodes: UnitNode[];
  depth?: number;
  expandedIds: Set<string>;
  selectedIds: string[];
  onToggleExpand: (id: string) => void;
  onToggleSelected: (id: string) => void;
}) {
  return (
    <div className={depth > 0 ? "mt-1 space-y-1" : "space-y-1"}>
      {nodes.map((node) => {
        const expanded = expandedIds.has(node.unit.id);
        const selected = selectedIds.includes(node.unit.id);
        const hasChildren = node.children.length > 0;

        return (
          <div key={node.unit.id}>
            <div
              className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 transition ${
                selected ? "border-brand/30 bg-brand/5" : "border-slate-200 bg-white hover:border-slate-300"
              }`}
              style={{ marginLeft: depth * 16 }}
            >
              <button
                type="button"
                onClick={() => hasChildren && onToggleExpand(node.unit.id)}
                disabled={!hasChildren}
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-0"
              >
                {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </button>
              <button type="button" onClick={() => onToggleSelected(node.unit.id)} className="mt-0.5 text-brand">
                {selected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4 text-slate-400" />}
              </button>
              <button type="button" onClick={() => onToggleSelected(node.unit.id)} className="min-w-0 flex-1 text-left">
                <p className="truncate text-sm font-medium text-slate-900">{node.unit.name}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {[node.unit.typeLabel, node.unit.code, node.unit.path].filter(Boolean).join(" | ")}
                </p>
              </button>
            </div>
            {hasChildren && expanded ? (
              <UnitTree
                nodes={node.children}
                depth={depth + 1}
                expandedIds={expandedIds}
                selectedIds={selectedIds}
                onToggleExpand={onToggleExpand}
                onToggleSelected={onToggleSelected}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function TargetEditor({
  title,
  caption,
  draft,
  measurementType,
  measurementConfig,
  inputCls,
  labelCls,
  onChange,
}: {
  title: string;
  caption?: string;
  draft: Draft;
  measurementType: string;
  measurementConfig: MeasurementConfig | null;
  inputCls: string;
  labelCls: string;
  onChange: (patch: Partial<Draft>) => void;
}) {
  const configuredCap = getMeasurementCapValue(measurementType, measurementConfig);
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-3">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        {caption ? <p className="text-xs text-slate-400">{caption}</p> : null}
        {configuredCap != null && (
          <p className="mt-1 text-xs text-amber-700">Cap: {configuredCap}</p>
        )}
      </div>
      <TargetFields
        draft={draft}
        measurementType={measurementType}
        measurementConfig={measurementConfig}
        inputCls={inputCls}
        labelCls={labelCls}
        onChange={onChange}
      />
    </div>
  );
}

function TargetFields({
  draft,
  measurementType,
  measurementConfig,
  inputCls,
  labelCls,
  onChange,
}: {
  draft: Draft;
  measurementType: string;
  measurementConfig: MeasurementConfig | null;
  inputCls: string;
  labelCls: string;
  onChange: (patch: Partial<Draft>) => void;
}) {
  const configuredCap = getMeasurementCapValue(measurementType, measurementConfig);

  if (["NUMERIC", "PERCENTAGE", "CURRENCY"].includes(measurementType)) {
    return (
      <div>
        <label className={labelCls}>Target value</label>
        <input
          type="number"
          step="any"
          min={measurementType === "PERCENTAGE" ? 0 : undefined}
          max={
            configuredCap != null
              ? configuredCap
              : measurementType === "PERCENTAGE"
                ? 100
                : undefined
          }
          value={draft.targetValue}
          onChange={(event) => onChange({ targetValue: event.target.value })}
          placeholder="0"
          className={inputCls}
        />
      </div>
    );
  }
  if (measurementType === "DATE_TARGET") {
    return (
      <div>
        <label className={labelCls}>Target date</label>
        <input
          type="date"
          value={draft.targetDate}
          onChange={(event) => onChange({ targetDate: event.target.value })}
          className={inputCls}
        />
      </div>
    );
  }
  if (measurementType === "MILESTONE") {
    return (
      <div>
        <label className={labelCls}>Target milestone</label>
        <select
          value={draft.targetMilestone}
          onChange={(event) => onChange({ targetMilestone: event.target.value })}
          className={inputCls}
        >
          <option value="">Select milestone...</option>
          {MILESTONE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    );
  }
  if (measurementType === "GRADE") {
    return (
      <div>
        <label className={labelCls}>Target grade</label>
        <select
          value={draft.targetGrade}
          onChange={(event) => onChange({ targetGrade: event.target.value })}
          className={inputCls}
        >
          <option value="">Select grade...</option>
          {GRADE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    );
  }
  if (measurementType === "BOOLEAN") {
    return (
      <div>
        <label className={labelCls}>Target</label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onChange({ targetBoolean: true })}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              draft.targetBoolean === true ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600"
            }`}
          >
            Yes
          </button>
          <button
            type="button"
            onClick={() => onChange({ targetBoolean: false })}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              draft.targetBoolean === false ? "bg-rose-600 text-white" : "bg-slate-100 text-slate-600"
            }`}
          >
            No
          </button>
        </div>
      </div>
    );
  }
  if (measurementType === "RATING") {
    return (
      <div>
        <label className={labelCls}>Target rating</label>
        <input
          type="number"
          min={1}
          max={configuredCap ?? 10}
          value={draft.targetRating}
          onChange={(event) => onChange({ targetRating: event.target.value })}
          placeholder={`1-${configuredCap ?? 10}`}
          className={inputCls}
        />
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-500">
      Unsupported KPI measurement type: {measurementType}
    </div>
  );
}

function toDraft(initialAllocation?: EditableAllocation): Draft {
  if (!initialAllocation) return {
    targetValue: "",
    targetDate: "",
    targetMilestone: "",
    targetGrade: "",
    targetBoolean: null,
    targetRating: "",
  };
  return {
    targetValue: initialAllocation.targetValue != null ? String(initialAllocation.targetValue) : "",
    targetDate: initialAllocation.targetDate?.slice(0, 10) ?? "",
    targetMilestone: initialAllocation.targetMilestone ?? "",
    targetGrade: initialAllocation.targetGrade ?? "",
    targetBoolean: initialAllocation.targetBoolean,
    targetRating: initialAllocation.targetRating != null ? String(initialAllocation.targetRating) : "",
  };
}

function buildUserSummary(user: UserOption) {
  return [
    user.email,
    user.designation,
    user.primaryUnit ? `${user.primaryUnit}${user.primaryUnitCode ? ` (${user.primaryUnitCode})` : ""}` : null,
    user.role,
    user.status,
  ]
    .filter(Boolean)
    .join(" | ");
}

function filterUsers(users: UserOption[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return users;
  return users.filter((user) =>
    [user.name, user.employeeId, user.email, user.designation, user.role, user.status, user.primaryUnit, user.primaryUnitCode]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(normalized)),
  );
}

function getVisibleUnitIds(units: UnitOption[], typeFilter: string, query: string) {
  const normalized = query.trim().toLowerCase();
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const visible = new Set<string>();

  for (const unit of units) {
    const matchesType = typeFilter === "ALL" || unit.typeKey === typeFilter;
    const matchesQuery = !normalized || [unit.name, unit.code, unit.path, unit.typeKey, unit.typeLabel].filter(Boolean).some((value) => value!.toLowerCase().includes(normalized));
    if (!matchesType || !matchesQuery) continue;

    let current: UnitOption | undefined = unit;
    while (current) {
      visible.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
  }

  if (visible.size === 0 && typeFilter === "ALL" && !normalized) {
    for (const unit of units) visible.add(unit.id);
  }

  return Array.from(visible);
}

function buildUnitTree(units: UnitOption[], visibleIds: string[]) {
  const visible = new Set(visibleIds);
  const nodes = new Map<string, UnitNode>();
  const roots: UnitNode[] = [];

  for (const unit of units) {
    if (visible.has(unit.id)) {
      nodes.set(unit.id, { unit, children: [] });
    }
  }

  for (const unit of units) {
    const node = nodes.get(unit.id);
    if (!node) continue;
    if (unit.parentId && nodes.has(unit.parentId)) {
      nodes.get(unit.parentId)?.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

function validateDraft(
  draft: Draft,
  measurementType: string,
  measurementConfig: MeasurementConfig | null,
) {
  const configuredCap = getMeasurementCapValue(measurementType, measurementConfig);
  if (["NUMERIC", "PERCENTAGE", "CURRENCY"].includes(measurementType)) {
    if (!draft.targetValue.trim()) return "Enter a target value.";
    const value = Number(draft.targetValue);
    if (!Number.isFinite(value)) return "Enter a valid number.";
    if (measurementType === "PERCENTAGE" && (value < 0 || value > 100)) {
      return "Percentage targets must be between 0 and 100.";
    }
    if (configuredCap != null && value > configuredCap) {
      return `Target value cannot exceed the KPI cap (${configuredCap}).`;
    }
    return null;
  }
  if (measurementType === "DATE_TARGET") return draft.targetDate ? null : "Select a target date.";
  if (measurementType === "MILESTONE") return draft.targetMilestone ? null : "Select a milestone.";
  if (measurementType === "GRADE") return draft.targetGrade ? null : "Select a grade.";
  if (measurementType === "BOOLEAN") return draft.targetBoolean === null ? "Choose Yes or No." : null;
  if (measurementType === "RATING") {
    if (!draft.targetRating.trim()) return "Enter a target rating.";
    const rating = Number(draft.targetRating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 10) return "Rating targets must be an integer from 1 to 10.";
    if (configuredCap != null && rating > configuredCap) {
      return `Target rating cannot exceed the KPI cap (${configuredCap}).`;
    }
    return null;
  }
  return "Unsupported KPI measurement type.";
}

function buildPayload(draft: Draft, measurementType: string) {
  if (["NUMERIC", "PERCENTAGE", "CURRENCY"].includes(measurementType)) return { targetValue: Number(draft.targetValue) };
  if (measurementType === "DATE_TARGET") return { targetDate: draft.targetDate };
  if (measurementType === "MILESTONE") return { targetMilestone: draft.targetMilestone };
  if (measurementType === "GRADE") return { targetGrade: draft.targetGrade };
  if (measurementType === "BOOLEAN") return { targetBoolean: draft.targetBoolean };
  if (measurementType === "RATING") return { targetRating: Number(draft.targetRating) };
  return {};
}

function buildAutoAllocationDraft(
  measurementType: string,
  defaultTarget: number | null,
): Draft {
  if (
    defaultTarget != null &&
    (measurementType === "NUMERIC" ||
      measurementType === "PERCENTAGE" ||
      measurementType === "CURRENCY")
  ) {
    return {
      ...emptyDraft(),
      targetValue: String(defaultTarget),
    };
  }

  if (defaultTarget != null && measurementType === "RATING") {
    return {
      ...emptyDraft(),
      targetRating: String(defaultTarget),
    };
  }

  return emptyDraft();
}

function getAutoAllocationHint(measurementType: string) {
  if (measurementType === "NUMERIC" || measurementType === "CURRENCY") {
    return "Numeric and currency targets are split using the configured department shares. If no shares are set, the total is split equally.";
  }
  if (measurementType === "PERCENTAGE") {
    return "Percentage targets are replicated to each configured department. A 90% target means each department must reach 90%, not a split of 90.";
  }
  if (measurementType === "BOOLEAN") {
    return "Boolean targets are replicated to each configured department.";
  }
  if (measurementType === "RATING") {
    return "Rating targets are replicated to each configured department.";
  }
  if (measurementType === "DATE_TARGET") {
    return "Date targets are replicated to each configured department.";
  }
  if (measurementType === "MILESTONE") {
    return "Milestone targets are replicated to each configured department.";
  }
  if (measurementType === "GRADE") {
    return "Grade targets are replicated to each configured department.";
  }
  return "The configured target will be applied to the selected departments.";
}

function buildChildrenMap(allocations: AllocationView[]) {
  const map = new Map<string, AllocationView[]>();

  for (const allocation of allocations) {
    if (!allocation.parentAllocationId) continue;
    const existing = map.get(allocation.parentAllocationId) ?? [];
    existing.push(allocation);
    map.set(allocation.parentAllocationId, existing);
  }

  return map;
}

function buildVisibleAllocationIds({
  allocations,
  mode,
  visibleUnitIds,
  selectedUnitIds,
  visibleUserIds,
  selectedUserIds,
}: {
  allocations: AllocationView[];
  mode: "all" | "unit" | "user";
  visibleUnitIds: string[];
  selectedUnitIds: string[];
  visibleUserIds: string[];
  selectedUserIds: string[];
}) {
  if (mode === "all") {
    return new Set(allocations.map((allocation) => allocation.id));
  }

  const childrenMap = buildChildrenMap(allocations);
  const roots = allocations.filter((allocation) => !allocation.parentAllocationId);
  const unitScope = new Set(
    selectedUnitIds.length > 0 ? selectedUnitIds : visibleUnitIds,
  );
  const userScope = new Set(
    selectedUserIds.length > 0 ? selectedUserIds : visibleUserIds,
  );
  const visible = new Set<string>();

  const visit = (allocation: AllocationView): boolean => {
    const children = childrenMap.get(allocation.id) ?? [];
    const childMatched = children.some((child) => visit(child));
    const ownMatched =
      mode === "unit"
        ? !!allocation.assignedToUnitId && unitScope.has(allocation.assignedToUnitId)
        : !!allocation.assignedToUserId && userScope.has(allocation.assignedToUserId);

    if (ownMatched || childMatched) {
      visible.add(allocation.id);
      return true;
    }

    return false;
  };

  for (const root of roots) {
    visit(root);
  }

  return visible;
}
