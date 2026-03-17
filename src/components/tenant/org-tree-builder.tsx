"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Trash2,
  ChevronRight,
  ChevronDown,
  GitBranch,
  Loader2,
  X,
  Tag,
  AlertCircle,
} from "lucide-react";
import type { OrgStructureActionResult } from "@/lib/org-structure/shared";

// ── Types ────────────────────────────────────────────────────────────────────

type UnitType = {
  id: string;
  typeKey: string;
  displayLabel: string;
  internalCategory: string;
  allowRoot: boolean;
};

type DraftUnit = {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  level: number;
  path: string | null;
  state: string;
  typeLabel: string;
  typeKey: string;
};

type TreeNode = {
  unit: DraftUnit;
  children: TreeNode[];
};

type OrgTreeBuilderProps = {
  unitTypes: UnitType[];
  units: DraftUnit[];
  typeColors: Record<string, string>;
};

// ── Main component ───────────────────────────────────────────────────────────

export function OrgTreeBuilder({
  unitTypes,
  units,
  typeColors,
}: OrgTreeBuilderProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    // Expand all by default
    return new Set(units.map((u) => u.id));
  });
  const [addingTo, setAddingTo] = useState<string | null>(null); // parentId or "__root__"
  const [feedback, setFeedback] = useState<OrgStructureActionResult | null>(
    null,
  );

  const tree = buildTree(units);
  const hasRoot = tree.length > 0;

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => setExpanded(new Set(units.map((u) => u.id)));

  const handleUnitCreated = (result: OrgStructureActionResult) => {
    setFeedback(result);
    setAddingTo(null);
    if (result.status === "success") {
      startTransition(() => router.refresh());
      setTimeout(() => setFeedback(null), 3000);
    }
  };

  const handleUnitDeleted = (result: OrgStructureActionResult) => {
    setFeedback(result);
    if (result.status === "success") {
      startTransition(() => router.refresh());
      setTimeout(() => setFeedback(null), 3000);
    }
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {!hasRoot && unitTypes.length > 0 ? (
          <button
            type="button"
            onClick={() => setAddingTo("__root__")}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            <Plus className="h-4 w-4" />
            Add root unit
          </button>
        ) : null}

        {hasRoot ? (
          <button
            type="button"
            onClick={expandAll}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:border-slate-300"
          >
            Expand all
          </button>
        ) : null}

        {isPending ? (
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <Loader2 className="h-3 w-3 animate-spin" />
            Refreshing…
          </div>
        ) : null}
      </div>

      {/* Feedback */}
      {feedback ? (
        <div
          className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm ${
            feedback.status === "success"
              ? "border-brand/20 bg-brand/5 text-brand"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {feedback.message}
        </div>
      ) : null}

      {/* Empty state */}
      {!hasRoot && unitTypes.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-200 py-12 text-center">
          <Tag className="h-8 w-8 text-slate-300" />
          <div>
            <p className="text-sm font-medium text-slate-600">
              Create a unit type first
            </p>
            <p className="mt-1 text-xs text-slate-400">
              You need at least one unit type before adding units to the tree
            </p>
          </div>
        </div>
      ) : null}

      {/* Root-level add form */}
      {addingTo === "__root__" ? (
        <InlineAddForm
          unitTypes={unitTypes.filter((t) => t.allowRoot)}
          parentId={null}
          onDone={handleUnitCreated}
          onCancel={() => setAddingTo(null)}
        />
      ) : null}

      {/* Tree */}
      {hasRoot ? (
        <div className="rounded-2xl border border-slate-200/80 bg-white/60 overflow-hidden">
          <ul className="divide-y divide-slate-100">
            {tree.map((node) => (
              <TreeNodeRow
                key={node.unit.id}
                node={node}
                depth={0}
                expanded={expanded}
                toggleExpand={toggleExpand}
                addingTo={addingTo}
                setAddingTo={setAddingTo}
                unitTypes={unitTypes}
                typeColors={typeColors}
                onUnitCreated={handleUnitCreated}
                onUnitDeleted={handleUnitDeleted}
              />
            ))}
          </ul>
        </div>
      ) : !addingTo ? (
        !hasRoot && unitTypes.length > 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-200 py-12 text-center">
            <GitBranch className="h-8 w-8 text-slate-300" />
            <div>
              <p className="text-sm font-medium text-slate-600">
                Start building your hierarchy
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Click &ldquo;Add root unit&rdquo; above to create the top-level
                node
              </p>
            </div>
          </div>
        ) : null
      ) : null}
    </div>
  );
}

// ── TreeNodeRow ──────────────────────────────────────────────────────────────

function TreeNodeRow({
  node,
  depth,
  expanded,
  toggleExpand,
  addingTo,
  setAddingTo,
  unitTypes,
  typeColors,
  onUnitCreated,
  onUnitDeleted,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  toggleExpand: (id: string) => void;
  addingTo: string | null;
  setAddingTo: (id: string | null) => void;
  unitTypes: UnitType[];
  typeColors: Record<string, string>;
  onUnitCreated: (r: OrgStructureActionResult) => void;
  onUnitDeleted: (r: OrgStructureActionResult) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const isExpanded = expanded.has(node.unit.id);
  const hasChildren = node.children.length > 0;
  const isAddingChild = addingTo === node.unit.id;
  const color = typeColors[node.unit.typeKey] ?? "#94a3b8";

  const handleDelete = async () => {
    const msg =
      hasChildren
        ? `Delete "${node.unit.name}" and all its children?`
        : `Delete "${node.unit.name}"?`;
    if (!window.confirm(msg)) return;

    setDeleting(true);
    try {
      const res = await fetch(
        `/api/tenant/structure/units/${node.unit.id}`,
        { method: "DELETE" },
      );
      const data = (await res.json()) as OrgStructureActionResult;
      onUnitDeleted(data);
    } catch {
      onUnitDeleted({ status: "error", message: "Delete request failed." });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <li className="list-none">
      {/* Node row */}
      <div
        className="group flex items-center gap-2 px-4 py-3 transition hover:bg-slate-50/80"
        style={{ paddingLeft: `${16 + depth * 24}px` }}
      >
        {/* Expand toggle */}
        <button
          type="button"
          onClick={() => hasChildren && toggleExpand(node.unit.id)}
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg transition ${
            hasChildren
              ? "text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              : "text-transparent"
          }`}
          disabled={!hasChildren}
          tabIndex={hasChildren ? 0 : -1}
        >
          {hasChildren ? (
            isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )
          ) : (
            <div className="h-1.5 w-1.5 rounded-full bg-slate-300" />
          )}
        </button>

        {/* Color dot */}
        <div
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />

        {/* Name & code */}
        <div className="min-w-0 flex-1">
          <span className="text-sm font-medium text-slate-900">
            {node.unit.name}
          </span>
          <span className="ml-2 text-xs text-slate-400">
            {node.unit.code}
          </span>
        </div>

        {/* Type badge */}
        <span
          className="shrink-0 rounded-lg px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
          style={{ backgroundColor: color }}
        >
          {node.unit.typeLabel}
        </span>

        {/* Level */}
        <span className="shrink-0 rounded-lg bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
          {node.unit.level === 0 ? "Root" : `L${node.unit.level}`}
        </span>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={() =>
              setAddingTo(isAddingChild ? null : node.unit.id)
            }
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-brand/30 hover:text-brand"
            title="Add child unit"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-rose-200 hover:text-rose-600 disabled:opacity-50"
            title="Delete unit"
          >
            {deleting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Inline add form */}
      {isAddingChild ? (
        <div style={{ paddingLeft: `${16 + (depth + 1) * 24}px` }} className="px-4 pb-3">
          <InlineAddForm
            unitTypes={unitTypes}
            parentId={node.unit.id}
            onDone={onUnitCreated}
            onCancel={() => setAddingTo(null)}
          />
        </div>
      ) : null}

      {/* Children */}
      {hasChildren && isExpanded ? (
        <ul className="relative">
          <div
            className="absolute bottom-0 top-0 border-l border-slate-200"
            style={{ left: `${28 + depth * 24}px` }}
          />
          {node.children.map((child) => (
            <TreeNodeRow
              key={child.unit.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              toggleExpand={toggleExpand}
              addingTo={addingTo}
              setAddingTo={setAddingTo}
              unitTypes={unitTypes}
              typeColors={typeColors}
              onUnitCreated={onUnitCreated}
              onUnitDeleted={onUnitDeleted}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

// ── InlineAddForm ────────────────────────────────────────────────────────────

function InlineAddForm({
  unitTypes,
  parentId,
  onDone,
  onCancel,
}: {
  unitTypes: UnitType[];
  parentId: string | null;
  onDone: (r: OrgStructureActionResult) => void;
  onCancel: () => void;
}) {
  const [typeId, setTypeId] = useState(unitTypes[0]?.id ?? "");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!typeId) {
      setError("Select a unit type.");
      return;
    }
    if (name.trim().length < 2) {
      setError("Name must be at least 2 characters.");
      return;
    }
    if (!/^[A-Z0-9_-]{2,}$/.test(code.trim().toUpperCase())) {
      setError("Code must be 2+ uppercase letters/numbers/dashes.");
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch("/api/tenant/structure/units", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          typeId,
          name: name.trim(),
          code: code.trim().toUpperCase(),
          parentId: parentId ?? undefined,
        }),
      });
      const data = (await res.json()) as OrgStructureActionResult;

      if (data.status === "error") {
        setError(data.message);
        setSubmitting(false);
      } else {
        onDone(data);
      }
    } catch {
      setError("Request failed.");
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-brand/20 bg-brand/5 p-3"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-brand">
          {parentId ? "Add child unit" : "Add root unit"}
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white hover:text-slate-700"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
        {/* Type selector */}
        <select
          value={typeId}
          onChange={(e) => setTypeId(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand focus:ring-1 focus:ring-brand/30"
        >
          {unitTypes.length === 0 ? (
            <option value="">No types available</option>
          ) : null}
          {unitTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.displayLabel}
            </option>
          ))}
        </select>

        {/* Name */}
        <input
          type="text"
          placeholder="Unit name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand focus:ring-1 focus:ring-brand/30"
          autoFocus
        />

        {/* Code */}
        <input
          type="text"
          placeholder="CODE"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 uppercase outline-none placeholder:text-slate-400 focus:border-brand focus:ring-1 focus:ring-brand/30"
        />

        {/* Submit */}
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand/90 disabled:opacity-50"
        >
          {submitting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          Add
        </button>
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildTree(units: DraftUnit[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  for (const unit of units) {
    nodes.set(unit.id, { unit, children: [] });
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
