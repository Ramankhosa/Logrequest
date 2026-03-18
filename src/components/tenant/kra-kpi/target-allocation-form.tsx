"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertCircle,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Loader2,
  Search,
  Square,
  X,
} from "lucide-react";

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

type TargetFormProps = {
  periodId: string;
  kpiDefinitionId: string;
  measurementType: string;
  units: UnitOption[];
  users: UserOption[];
  parentAllocationId?: string;
  initialAllocation?: EditableAllocation;
  onDone: () => void;
  onCancel: () => void;
};

type AssigneeType = "unit" | "user";

type Draft = {
  targetValue: string;
  targetDate: string;
  targetMilestone: string;
  targetGrade: string;
  targetBoolean: boolean | null;
  targetRating: string;
};

type UnitNode = { unit: UnitOption; children: UnitNode[] };

const emptyDraft = (): Draft => ({
  targetValue: "",
  targetDate: "",
  targetMilestone: "",
  targetGrade: "",
  targetBoolean: null,
  targetRating: "",
});

const milestoneOptions = [
  { value: "NOT_STARTED", label: "Not Started" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "COMPLETED", label: "Completed" },
];

const gradeOptions = [
  { value: "OUTSTANDING", label: "Outstanding" },
  { value: "VERY_GOOD", label: "Very Good" },
  { value: "GOOD", label: "Good" },
  { value: "SATISFACTORY", label: "Satisfactory" },
  { value: "NEEDS_IMPROVEMENT", label: "Needs Improvement" },
  { value: "POOR", label: "Poor" },
];

export function TargetAllocationForm({
  periodId,
  kpiDefinitionId,
  measurementType,
  units,
  users,
  parentAllocationId,
  initialAllocation,
  onDone,
  onCancel,
}: TargetFormProps) {
  const isEditing = !!initialAllocation;
  const initialType: AssigneeType = initialAllocation?.assignedToUserId ? "user" : "unit";
  const [assignToType, setAssignToType] = useState<AssigneeType>(initialType);
  const [selectedUnitIds, setSelectedUnitIds] = useState<string[]>(initialAllocation?.assignedToUnitId ? [initialAllocation.assignedToUnitId] : []);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>(initialAllocation?.assignedToUserId ? [initialAllocation.assignedToUserId] : []);
  const [useSharedValue, setUseSharedValue] = useState(true);
  const [sharedDraft, setSharedDraft] = useState<Draft>(toDraft(initialAllocation));
  const [unitDrafts, setUnitDrafts] = useState<Record<string, Draft>>({});
  const [userDrafts, setUserDrafts] = useState<Record<string, Draft>>({});
  const [notes, setNotes] = useState(initialAllocation?.notes ?? "");
  const [unitTypeFilter, setUnitTypeFilter] = useState("ALL");
  const [unitSearch, setUnitSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set(units.map((u) => u.id)));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isEditing) return;
    setAssignToType(initialType);
    setSelectedUnitIds(initialAllocation?.assignedToUnitId ? [initialAllocation.assignedToUnitId] : []);
    setSelectedUserIds(initialAllocation?.assignedToUserId ? [initialAllocation.assignedToUserId] : []);
    setSharedDraft(toDraft(initialAllocation));
    setNotes(initialAllocation?.notes ?? "");
    setUseSharedValue(true);
  }, [initialAllocation, initialType, isEditing]);

  const labelCls = "mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500";
  const inputCls = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand focus:ring-1 focus:ring-brand/30";
  const selectedIds = assignToType === "unit" ? selectedUnitIds : selectedUserIds;
  const selectedCount = selectedIds.length;
  const typeOptions = useMemo(() => Array.from(new Map(units.map((u) => [u.typeKey, u.typeLabel])).entries()), [units]);
  const visibleUnitIds = useMemo(() => getVisibleUnitIds(units, unitTypeFilter, unitSearch), [units, unitTypeFilter, unitSearch]);
  const unitTree = useMemo(() => buildUnitTree(units, visibleUnitIds), [units, visibleUnitIds]);
  const filteredUsers = useMemo(() => filterUsers(users, userSearch), [users, userSearch]);
  const visibleUserIds = filteredUsers.map((user) => user.id);
  const labelMap = useMemo(() => new Map([
    ...units.map((unit) => [unit.id, `${unit.name}${unit.code ? ` (${unit.code})` : ""}`] as const),
    ...users.map((user) => [user.id, user.employeeId ? `${user.name} (${user.employeeId})` : user.name] as const),
  ]), [units, users]);

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
    setter((prev) => ({ ...prev, [id]: { ...(prev[id] ?? emptyDraft()), ...patch } }));
  };

  const toggleSelected = (id: string) => {
    if (isEditing) return;
    const setter = assignToType === "unit" ? setSelectedUnitIds : setSelectedUserIds;
    setter((prev) => prev.includes(id) ? prev.filter((current) => current !== id) : [...prev, id]);
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
        const validation = validateDraft(sharedDraft, measurementType);
        if (validation) {
          setError(validation);
          setSubmitting(false);
          return;
        }
        const res = await fetch(`/api/tenant/kra-kpi/targets/${initialAllocation.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...buildPayload(sharedDraft, measurementType), notes: notes.trim() || null }),
        });
        const data = await res.json();
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
        const validation = validateDraft(draft, measurementType);
        if (validation) throw new Error(`${labelMap.get(id) ?? id}: ${validation}`);
        return {
          ...(assignToType === "unit" ? { assignedToUnitId: id } : { assignedToUserId: id }),
          ...buildPayload(draft, measurementType),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
          ...(parentAllocationId ? { parentAllocationId } : {}),
        };
      });

      const res = await fetch("/api/tenant/kra-kpi/targets/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodId, kpiDefinitionId, allocations }),
      });
      const data = await res.json();
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
            <p className="mt-1 text-xs text-slate-400">Edit mode updates the target for this existing allocation without changing the assignee.</p>
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
                      {typeOptions.map(([typeKey, typeLabel]) => <option key={typeKey} value={typeKey}>{typeLabel}</option>)}
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
                    <UnitTreeView nodes={unitTree} expandedIds={expandedIds} selectedIds={selectedUnitIds} onToggleExpand={(id) => setExpandedIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(id)) next.delete(id); else next.add(id);
                      return next;
                    })} onToggleSelected={toggleSelected} />
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
            <TargetEditor title={isEditing ? "Edit target" : "Target for selected assignees"} draft={sharedDraft} measurementType={measurementType} inputCls={inputCls} labelCls={labelCls} onChange={(patch) => setDraftPatch(selectedIds[0] ?? "", patch)} />
          ) : (
            <div className="space-y-3">
              {selectedIds.map((id) => (
                <TargetEditor key={id} title={labelMap.get(id) ?? id} caption="Individual target" draft={currentDraft(id)} measurementType={measurementType} inputCls={inputCls} labelCls={labelCls} onChange={(patch) => setDraftPatch(id, patch)} />
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

      {error ? (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-rose-600">
          <AlertCircle className="h-3 w-3 shrink-0" />
          {error}
        </div>
      ) : null}
    </form>
  );
}

function SelectionToolbar({ selectedCount, visibleCount, label, onSelectAll, onClear }: { selectedCount: number; visibleCount: number; label: string; onSelectAll: () => void; onClear: () => void; }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-xs text-slate-500"><span className="font-semibold text-slate-800">{selectedCount}</span> selected out of <span className="font-semibold text-slate-800">{visibleCount}</span> visible {label}</p>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onSelectAll} disabled={visibleCount === 0} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-slate-300 disabled:opacity-50">Select visible</button>
        <button type="button" onClick={onClear} disabled={selectedCount === 0} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-slate-300 disabled:opacity-50">Clear</button>
      </div>
    </div>
  );
}

function SelectableRow({ selected, title, subtitle, onClick }: { selected: boolean; title: string; subtitle?: string; onClick: () => void; }) {
  return (
    <button type="button" onClick={onClick} className={`flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition ${selected ? "border-brand/30 bg-brand/5" : "border-slate-200 bg-white hover:border-slate-300"}`}>
      <div className="pt-0.5 text-brand">{selected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4 text-slate-400" />}</div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-900">{title}</p>
        {subtitle ? <p className="mt-1 text-xs text-slate-500">{subtitle}</p> : null}
      </div>
    </button>
  );
}

function UnitTreeView({ nodes, depth = 0, expandedIds, selectedIds, onToggleExpand, onToggleSelected }: { nodes: UnitNode[]; depth?: number; expandedIds: Set<string>; selectedIds: string[]; onToggleExpand: (id: string) => void; onToggleSelected: (id: string) => void; }) {
  return (
    <div className={depth > 0 ? "mt-1 space-y-1" : "space-y-1"}>
      {nodes.map((node) => {
        const expanded = expandedIds.has(node.unit.id);
        const selected = selectedIds.includes(node.unit.id);
        const hasChildren = node.children.length > 0;
        return (
          <div key={node.unit.id}>
            <div className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 transition ${selected ? "border-brand/30 bg-brand/5" : "border-slate-200 bg-white hover:border-slate-300"}`} style={{ marginLeft: depth * 16 }}>
              <button type="button" onClick={() => hasChildren && onToggleExpand(node.unit.id)} disabled={!hasChildren} className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-0">
                {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </button>
              <button type="button" onClick={() => onToggleSelected(node.unit.id)} className="mt-0.5 text-brand">{selected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4 text-slate-400" />}</button>
              <button type="button" onClick={() => onToggleSelected(node.unit.id)} className="min-w-0 flex-1 text-left">
                <p className="truncate text-sm font-medium text-slate-900">{node.unit.name}</p>
                <p className="mt-0.5 text-xs text-slate-500">{[node.unit.typeLabel, node.unit.code, node.unit.path].filter(Boolean).join(" | ")}</p>
              </button>
            </div>
            {hasChildren && expanded ? (
              <UnitTreeView nodes={node.children} depth={depth + 1} expandedIds={expandedIds} selectedIds={selectedIds} onToggleExpand={onToggleExpand} onToggleSelected={onToggleSelected} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function TargetEditor({ title, caption, draft, measurementType, labelCls, inputCls, onChange }: { title: string; caption?: string; draft: Draft; measurementType: string; labelCls: string; inputCls: string; onChange: (patch: Partial<Draft>) => void; }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-3">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        {caption ? <p className="text-xs text-slate-400">{caption}</p> : null}
      </div>
      <TargetFields draft={draft} measurementType={measurementType} labelCls={labelCls} inputCls={inputCls} onChange={onChange} />
    </div>
  );
}

function TargetFields({ draft, measurementType, labelCls, inputCls, onChange }: { draft: Draft; measurementType: string; labelCls: string; inputCls: string; onChange: (patch: Partial<Draft>) => void; }) {
  if (["NUMERIC", "PERCENTAGE", "CURRENCY"].includes(measurementType)) {
    return (
      <div>
        <label className={labelCls}>{measurementType === "CURRENCY" ? "Target amount" : measurementType === "PERCENTAGE" ? "Target percentage" : "Target value"}</label>
        <input type="number" step="any" min={measurementType === "PERCENTAGE" ? 0 : undefined} max={measurementType === "PERCENTAGE" ? 100 : undefined} value={draft.targetValue} onChange={(event) => onChange({ targetValue: event.target.value })} placeholder="0" className={inputCls} />
      </div>
    );
  }
  if (measurementType === "DATE_TARGET") {
    return <div><label className={labelCls}>Target date</label><input type="date" value={draft.targetDate} onChange={(event) => onChange({ targetDate: event.target.value })} className={inputCls} /></div>;
  }
  if (measurementType === "MILESTONE") {
    return <div><label className={labelCls}>Target milestone</label><select value={draft.targetMilestone} onChange={(event) => onChange({ targetMilestone: event.target.value })} className={inputCls}><option value="">Select milestone...</option>{milestoneOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>;
  }
  if (measurementType === "GRADE") {
    return <div><label className={labelCls}>Target grade</label><select value={draft.targetGrade} onChange={(event) => onChange({ targetGrade: event.target.value })} className={inputCls}><option value="">Select grade...</option>{gradeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>;
  }
  if (measurementType === "BOOLEAN") {
    return <div><label className={labelCls}>Target</label><div className="flex gap-2"><button type="button" onClick={() => onChange({ targetBoolean: true })} className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${draft.targetBoolean === true ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600"}`}>Yes</button><button type="button" onClick={() => onChange({ targetBoolean: false })} className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${draft.targetBoolean === false ? "bg-rose-600 text-white" : "bg-slate-100 text-slate-600"}`}>No</button></div></div>;
  }
  if (measurementType === "RATING") {
    return <div><label className={labelCls}>Target rating</label><input type="number" min={1} max={10} value={draft.targetRating} onChange={(event) => onChange({ targetRating: event.target.value })} placeholder="1-10" className={inputCls} /></div>;
  }
  return <div className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-500">Unsupported KPI measurement type: {measurementType}</div>;
}

function toDraft(initialAllocation?: EditableAllocation): Draft {
  if (!initialAllocation) return emptyDraft();
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
  return [user.email, user.designation, user.primaryUnit ? `${user.primaryUnit}${user.primaryUnitCode ? ` (${user.primaryUnitCode})` : ""}` : null, user.role, user.status].filter(Boolean).join(" | ");
}

function filterUsers(users: UserOption[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return users;
  return users.filter((user) => [user.name, user.employeeId, user.email, user.designation, user.role, user.status, user.primaryUnit, user.primaryUnitCode].filter(Boolean).some((value) => value!.toLowerCase().includes(normalized)));
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
  if (visible.size === 0 && typeFilter === "ALL" && !normalized) for (const unit of units) visible.add(unit.id);
  return Array.from(visible);
}

function buildUnitTree(units: UnitOption[], visibleIds: string[]) {
  const visible = new Set(visibleIds);
  const nodes = new Map<string, UnitNode>();
  const roots: UnitNode[] = [];
  for (const unit of units) if (visible.has(unit.id)) nodes.set(unit.id, { unit, children: [] });
  for (const unit of units) {
    const node = nodes.get(unit.id);
    if (!node) continue;
    if (unit.parentId && nodes.has(unit.parentId)) nodes.get(unit.parentId)?.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function validateDraft(draft: Draft, measurementType: string) {
  if (["NUMERIC", "PERCENTAGE", "CURRENCY"].includes(measurementType)) {
    if (!draft.targetValue.trim()) return "Enter a target value.";
    const value = Number(draft.targetValue);
    if (!Number.isFinite(value)) return "Enter a valid number.";
    if (measurementType === "PERCENTAGE" && (value < 0 || value > 100)) return "Percentage targets must be between 0 and 100.";
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
    return null;
  }
  return "Unsupported KPI measurement type.";
}

function buildPayload(draft: Draft, measurementType: string) {
  if (["NUMERIC", "PERCENTAGE", "CURRENCY"].includes(measurementType)) return { targetValue: Number(draft.targetValue) };
  if (measurementType === "DATE_TARGET") return { targetDate: draft.targetDate };
  if (measurementType === "MILESTONE") return { targetMilestone: draft.targetMilestone };
  if (measurementType === "GRADE") return { targetGrade: draft.targetGrade };
  if (measurementType === "BOOLEAN") return { targetBoolean: draft.targetBoolean === true };
  if (measurementType === "RATING") return { targetRating: Number(draft.targetRating) };
  return {};
}
