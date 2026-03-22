"use client";

import { useState, useCallback, useEffect } from "react";
import {
  Plus,
  Trash2,
  Pencil,
  GripVertical,
  Check,
  X,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

type KpiStageView = {
  id: string;
  kpiDefinitionId: string;
  stageOrder: number;
  title: string;
  description: string | null;
  isMandatory: boolean;
  weight: number;
  evidenceRequired: boolean;
  evidenceTypes: string[];
  evidenceInstructions: string | null;
  deadline: string | null;
  completedProgressCount: number;
};

type ContributionRole = {
  role: string;
  creditPercent: number;
  isDefault: boolean;
};

type Props = {
  kpiId: string;
  contributionRoles: ContributionRole[] | null;
  allowPartialCompletion: boolean;
  onUpdate: () => void;
};

const EVIDENCE_TYPE_OPTIONS = [
  { value: "DOCUMENT", label: "Document" },
  { value: "URL", label: "URL" },
  { value: "CERTIFICATE", label: "Certificate" },
  { value: "SELF_DECLARATION", label: "Self Declaration" },
];

const labelCls =
  "mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500";
const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand focus:ring-1 focus:ring-brand/30";

export function KpiStageManager({ kpiId, contributionRoles, allowPartialCompletion, onUpdate }: Props) {
  const [stages, setStages] = useState<KpiStageView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  // Form state
  const [formTitle, setFormTitle] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formWeight, setFormWeight] = useState(0);
  const [formIsMandatory, setFormIsMandatory] = useState(true);
  const [formEvidenceRequired, setFormEvidenceRequired] = useState(false);
  const [formEvidenceTypes, setFormEvidenceTypes] = useState<string[]>([]);
  const [formEvidenceInstructions, setFormEvidenceInstructions] = useState("");
  const [formDeadline, setFormDeadline] = useState("");
  const [saving, setSaving] = useState(false);

  // Roles state
  const [roles, setRoles] = useState<ContributionRole[]>(contributionRoles ?? []);
  const [showAddRole, setShowAddRole] = useState(false);
  const [roleForm, setRoleForm] = useState({ role: "", creditPercent: 50, isDefault: false });
  const [savingRoles, setSavingRoles] = useState(false);

  const fetchStages = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tenant/kra-kpi/kpis/${kpiId}/stages`);
      if (!res.ok) throw new Error();
      setStages(await res.json());
      setError(null);
    } catch {
      setError("Failed to load stages.");
    } finally {
      setLoading(false);
    }
  }, [kpiId]);

  useEffect(() => {
    void fetchStages();
  }, [fetchStages]);

  const totalWeight = stages.reduce((s, x) => s + x.weight, 0);

  function resetForm() {
    setFormTitle("");
    setFormDescription("");
    setFormWeight(0);
    setFormIsMandatory(true);
    setFormEvidenceRequired(false);
    setFormEvidenceTypes([]);
    setFormEvidenceInstructions("");
    setFormDeadline("");
  }

  function loadStageIntoForm(stage: KpiStageView) {
    setFormTitle(stage.title);
    setFormDescription(stage.description ?? "");
    setFormWeight(stage.weight);
    setFormIsMandatory(stage.isMandatory);
    setFormEvidenceRequired(stage.evidenceRequired);
    setFormEvidenceTypes(stage.evidenceTypes);
    setFormEvidenceInstructions(stage.evidenceInstructions ?? "");
    setFormDeadline(stage.deadline ? stage.deadline.slice(0, 10) : "");
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    const payload = {
      title: formTitle,
      description: formDescription || undefined,
      weight: formWeight,
      isMandatory: formIsMandatory,
      evidenceRequired: formEvidenceRequired,
      evidenceTypes: formEvidenceRequired ? formEvidenceTypes : [],
      evidenceInstructions: formEvidenceInstructions || undefined,
      deadline: formDeadline || undefined,
    };

    try {
      const isEdit = editingId !== null;
      const url = isEdit
        ? `/api/tenant/kra-kpi/kpis/${kpiId}/stages/${editingId}`
        : `/api/tenant/kra-kpi/kpis/${kpiId}/stages`;
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "Failed to save stage.");
        return;
      }
      resetForm();
      setEditingId(null);
      setShowAdd(false);
      await fetchStages();
      onUpdate();
    } catch {
      setError("Failed to save stage.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(stageId: string) {
    if (!window.confirm("Delete this stage?")) return;
    try {
      const res = await fetch(`/api/tenant/kra-kpi/kpis/${kpiId}/stages/${stageId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "Failed to delete stage.");
        return;
      }
      await fetchStages();
      onUpdate();
    } catch {
      setError("Failed to delete stage.");
    }
  }

  async function handleReorder(fromIndex: number, direction: "up" | "down") {
    const toIndex = direction === "up" ? fromIndex - 1 : fromIndex + 1;
    if (toIndex < 0 || toIndex >= stages.length) return;
    const ordered = [...stages];
    [ordered[fromIndex], ordered[toIndex]] = [ordered[toIndex], ordered[fromIndex]];
    try {
      const res = await fetch(`/api/tenant/kra-kpi/kpis/${kpiId}/stages/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds: ordered.map((s) => s.id) }),
      });
      if (res.ok) {
        await fetchStages();
      }
    } catch {
      // silently ignore reorder failure
    }
  }

  async function handleSaveRoles() {
    setSavingRoles(true);
    try {
      const res = await fetch(`/api/tenant/kra-kpi/kpis/${kpiId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contributionRoles: roles.length > 0 ? roles : null }),
      });
      if (res.ok) onUpdate();
    } catch {
      setError("Failed to save roles.");
    } finally {
      setSavingRoles(false);
    }
  }

  async function handleTogglePartialCompletion() {
    try {
      const res = await fetch(`/api/tenant/kra-kpi/kpis/${kpiId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowPartialCompletion: !allowPartialCompletion }),
      });
      if (res.ok) onUpdate();
    } catch {
      setError("Failed to update setting.");
    }
  }

  function toggleEvidenceType(type: string) {
    setFormEvidenceTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const isFormOpen = showAdd || editingId !== null;

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {/* ── Stages Table ─────────────────────────────────────────── */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">
            Stages{" "}
            <span className="ml-2 text-xs font-normal text-slate-400">
              Total Weight: {totalWeight}
            </span>
          </h3>
          {!isFormOpen && (
            <button
              onClick={() => {
                resetForm();
                setShowAdd(true);
              }}
              className="flex items-center gap-1 rounded-lg bg-brand/10 px-3 py-1.5 text-xs font-medium text-brand hover:bg-brand/20"
            >
              <Plus className="h-3.5 w-3.5" /> Add Stage
            </button>
          )}
        </div>

        {stages.length === 0 && !isFormOpen && (
          <p className="text-xs text-slate-400">No stages defined. Add stages to enable milestone tracking.</p>
        )}

        {stages.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="w-8 px-2 py-2">#</th>
                  <th className="px-3 py-2">Title</th>
                  <th className="px-3 py-2 text-right">Weight</th>
                  <th className="px-3 py-2 text-center">Evidence</th>
                  <th className="px-3 py-2">Deadline</th>
                  <th className="px-3 py-2 text-right">Done</th>
                  <th className="w-28 px-3 py-2 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {stages.map((stage, idx) => (
                  <tr key={stage.id} className="hover:bg-slate-50/50">
                    <td className="px-2 py-2 text-center text-slate-400">{stage.stageOrder}</td>
                    <td className="px-3 py-2 font-medium text-slate-700">
                      {stage.title}
                      {stage.description && (
                        <p className="mt-0.5 text-[10px] text-slate-400">{stage.description}</p>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{stage.weight}</td>
                    <td className="px-3 py-2 text-center">
                      {stage.evidenceRequired ? (
                        <span className="text-green-600">Yes</span>
                      ) : (
                        <span className="text-slate-300">No</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {stage.deadline
                        ? new Date(stage.deadline).toLocaleDateString("en-IN", {
                            month: "short",
                            day: "numeric",
                          })
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                      {stage.completedProgressCount}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => handleReorder(idx, "up")}
                          disabled={idx === 0}
                          className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-30"
                          title="Move up"
                        >
                          <ChevronUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleReorder(idx, "down")}
                          disabled={idx === stages.length - 1}
                          className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-30"
                          title="Move down"
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => {
                            setEditingId(stage.id);
                            setShowAdd(false);
                            loadStageIntoForm(stage);
                          }}
                          className="rounded p-1 text-slate-400 hover:bg-blue-50 hover:text-blue-600"
                          title="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => void handleDelete(stage.id)}
                          className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Stage Form (Add/Edit) ───────────────────────────────── */}
      {isFormOpen && (
        <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-3">
          <h4 className="text-xs font-semibold text-slate-600">
            {editingId ? "Edit Stage" : "Add Stage"}
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Title</label>
              <input
                type="text"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder="e.g. Topic Selection"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Weight</label>
              <input
                type="number"
                value={formWeight}
                onChange={(e) => setFormWeight(Number(e.target.value))}
                min={0}
                step="any"
                className={inputCls}
              />
            </div>
          </div>
          <div>
            <label className={labelCls}>Description</label>
            <textarea
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              placeholder="Optional"
              rows={2}
              className={`${inputCls} resize-none`}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Deadline</label>
              <input
                type="date"
                value={formDeadline}
                onChange={(e) => setFormDeadline(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="flex items-end gap-4">
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={formIsMandatory}
                  onChange={(e) => setFormIsMandatory(e.target.checked)}
                  className="rounded border-slate-300"
                />
                Mandatory
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={formEvidenceRequired}
                  onChange={(e) => setFormEvidenceRequired(e.target.checked)}
                  className="rounded border-slate-300"
                />
                Evidence Required
              </label>
            </div>
          </div>

          {formEvidenceRequired && (
            <div className="space-y-2">
              <label className={labelCls}>Evidence Types</label>
              <div className="flex flex-wrap gap-2">
                {EVIDENCE_TYPE_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className="flex items-center gap-1.5 text-xs text-slate-600"
                  >
                    <input
                      type="checkbox"
                      checked={formEvidenceTypes.includes(opt.value)}
                      onChange={() => toggleEvidenceType(opt.value)}
                      className="rounded border-slate-300"
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
              <label className={labelCls}>Evidence Instructions</label>
              <textarea
                value={formEvidenceInstructions}
                onChange={(e) => setFormEvidenceInstructions(e.target.value)}
                placeholder="Optional instructions"
                rows={2}
                className={`${inputCls} resize-none`}
              />
            </div>
          )}

          <div className="flex items-center gap-2 pt-2">
            <button
              onClick={() => void handleSave()}
              disabled={!formTitle.trim() || saving}
              className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-1.5 text-xs font-medium text-white hover:bg-brand/90 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {editingId ? "Update" : "Add"}
            </button>
            <button
              onClick={() => {
                setShowAdd(false);
                setEditingId(null);
                resetForm();
              }}
              className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50"
            >
              <X className="h-3.5 w-3.5" /> Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Contribution Roles ───────────────────────────────────── */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">Contribution Roles</h3>
          {!showAddRole && (
            <button
              onClick={() => setShowAddRole(true)}
              className="flex items-center gap-1 rounded-lg bg-brand/10 px-3 py-1.5 text-xs font-medium text-brand hover:bg-brand/20"
            >
              <Plus className="h-3.5 w-3.5" /> Add Role
            </button>
          )}
        </div>

        {roles.length === 0 && !showAddRole && (
          <p className="text-xs text-slate-400">
            No contribution roles. All achievements count at 100% credit.
          </p>
        )}

        {roles.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2 text-right">Credit %</th>
                  <th className="px-3 py-2 text-center">Default</th>
                  <th className="w-16 px-3 py-2 text-center">Remove</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {roles.map((r, i) => (
                  <tr key={i} className="hover:bg-slate-50/50">
                    <td className="px-3 py-2 font-medium text-slate-700">{r.role}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.creditPercent}%</td>
                    <td className="px-3 py-2 text-center">
                      {r.isDefault ? (
                        <Check className="mx-auto h-3.5 w-3.5 text-green-600" />
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => {
                          const next = roles.filter((_, j) => j !== i);
                          setRoles(next);
                        }}
                        className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {showAddRole && (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/50 p-3 space-y-2">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>Role Name</label>
                <input
                  type="text"
                  value={roleForm.role}
                  onChange={(e) => setRoleForm({ ...roleForm, role: e.target.value })}
                  placeholder="e.g. First Author"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Credit %</label>
                <input
                  type="number"
                  value={roleForm.creditPercent}
                  onChange={(e) => setRoleForm({ ...roleForm, creditPercent: Number(e.target.value) })}
                  min={1}
                  max={100}
                  className={inputCls}
                />
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={roleForm.isDefault}
                    onChange={(e) => setRoleForm({ ...roleForm, isDefault: e.target.checked })}
                    className="rounded border-slate-300"
                  />
                  Default
                </label>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  if (!roleForm.role.trim()) return;
                  // If setting new default, unset previous default
                  const updated = roleForm.isDefault
                    ? roles.map((r) => ({ ...r, isDefault: false }))
                    : [...roles];
                  updated.push({ ...roleForm });
                  setRoles(updated);
                  setRoleForm({ role: "", creditPercent: 50, isDefault: false });
                  setShowAddRole(false);
                }}
                disabled={!roleForm.role.trim()}
                className="flex items-center gap-1 rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90 disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" /> Add
              </button>
              <button
                onClick={() => setShowAddRole(false)}
                className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50"
              >
                <X className="h-3.5 w-3.5" /> Cancel
              </button>
            </div>
          </div>
        )}

        {roles.length > 0 && (
          <div className="mt-2 flex justify-end">
            <button
              onClick={() => void handleSaveRoles()}
              disabled={savingRoles}
              className="flex items-center gap-1 rounded-lg bg-brand/10 px-3 py-1.5 text-xs font-medium text-brand hover:bg-brand/20 disabled:opacity-50"
            >
              {savingRoles ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Save Roles
            </button>
          </div>
        )}
      </div>

      {/* ── Settings ─────────────────────────────────────────────── */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Settings</h3>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={allowPartialCompletion}
            onChange={() => void handleTogglePartialCompletion()}
            className="rounded border-slate-300"
          />
          Allow Partial Completion (submit before all stages done)
        </label>
      </div>
    </div>
  );
}
