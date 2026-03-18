"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FileEdit,
  CheckCircle2,
  Clock,
  Upload,
  Plus,
  Tag,
  GitBranch,
  Shield,
  Users,
  Loader2,
  Pencil,
} from "lucide-react";
import { OrgTreeBuilder } from "@/components/tenant/org-tree-builder";
import { StructureSummaryActions } from "@/components/tenant/structure-summary-actions";
import { StructureUpload } from "@/components/tenant/structure-upload";
import { VersionHistoryList } from "@/components/tenant/version-history-list";
import { RoleDefinitionsList } from "@/components/tenant/role-definitions-list";
import { UserRoleUpload } from "@/components/tenant/user-role-upload";

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

type StructureTabsProps = {
  draftUnitTypes: UnitType[];
  draftUnits: DraftUnit[];
  draftTypeColors: Record<string, string>;
  publishedUnitTypes: UnitType[];
  publishedUnits: DraftUnit[];
  publishedTypeColors: Record<string, string>;
  hasDraft: boolean;
  hasPublished: boolean;
};

const TABS = [
  { key: "draft", label: "Draft", icon: FileEdit },
  { key: "published", label: "Published", icon: CheckCircle2 },
  { key: "roles", label: "Roles", icon: Shield },
  { key: "members", label: "Members", icon: Users },
  { key: "history", label: "History", icon: Clock },
  { key: "import", label: "Import", icon: Upload },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function StructureTabs({
  draftUnitTypes,
  draftUnits,
  draftTypeColors,
  publishedUnitTypes,
  publishedUnits,
  publishedTypeColors,
  hasDraft,
  hasPublished,
}: StructureTabsProps) {
  const [activeTab, setActiveTab] = useState<TabKey>(
    hasDraft ? "draft" : hasPublished ? "published" : "draft",
  );

  return (
    <div className="space-y-6">
      {/* Tab bar */}
      <div className="flex items-center gap-1 rounded-2xl border border-slate-200/80 bg-white/60 p-1.5">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                isActive
                  ? "bg-slate-950 text-white shadow-sm"
                  : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === "draft" ? (
        <DraftTab
          unitTypes={draftUnitTypes}
          units={draftUnits}
          typeColors={draftTypeColors}
        />
      ) : activeTab === "published" ? (
        <PublishedTab
          unitTypes={publishedUnitTypes}
          units={publishedUnits}
          typeColors={publishedTypeColors}
          hasDraft={hasDraft}
          hasPublished={hasPublished}
          onStartEditing={() => setActiveTab("draft")}
        />
      ) : activeTab === "roles" ? (
        <RolesTab />
      ) : activeTab === "members" ? (
        <MembersTab />
      ) : activeTab === "history" ? (
        <HistoryTab />
      ) : (
        <ImportTab />
      )}
    </div>
  );
}

// ── Draft Tab ────────────────────────────────────────────────────────────────

function DraftTab({
  unitTypes,
  units,
  typeColors,
}: {
  unitTypes: UnitType[];
  units: DraftUnit[];
  typeColors: Record<string, string>;
}) {
  return (
    <div className="space-y-6">
      <section className="grid gap-6 lg:grid-cols-[260px_1fr]">
        {/* Unit types sidebar */}
        <div className="rounded-[1.75rem] border border-slate-200/80 bg-white/60 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">
              Unit types
            </h2>
            <Link
              href="/tenant-admin/structure/types/new"
              className="flex h-7 w-7 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:border-brand/30 hover:text-brand"
            >
              <Plus className="h-3.5 w-3.5" />
            </Link>
          </div>

          {unitTypes.length ? (
            <ul className="space-y-2">
              {unitTypes.map((type) => (
                <li
                  key={type.id}
                  className="flex items-center justify-between rounded-xl border border-slate-200/80 bg-white px-3 py-2.5"
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className="h-2 w-2 rounded-full"
                      style={{
                        backgroundColor: typeColors[type.typeKey] ?? "#94a3b8",
                      }}
                    />
                    <span className="text-sm font-medium text-slate-900">
                      {type.displayLabel}
                    </span>
                  </div>
                  <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    {type.typeKey}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-200 py-8 text-center">
              <Tag className="h-6 w-6 text-slate-300" />
              <p className="text-xs text-slate-500">No types defined yet</p>
              <Link
                href="/tenant-admin/structure/types/new"
                className="text-xs font-semibold text-brand hover:underline"
              >
                Create first type
              </Link>
            </div>
          )}
        </div>

        {/* Interactive hierarchy builder */}
        <div className="rounded-[1.75rem] border border-slate-200/80 bg-white/60 p-5">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-slate-900">
              Hierarchy
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Click + on any node to add children, or use the trash icon to
              remove
            </p>
          </div>

          <OrgTreeBuilder
            unitTypes={unitTypes}
            units={units}
            typeColors={typeColors}
          />
        </div>
      </section>

      {/* Draft management actions */}
      <section className="rounded-[1.75rem] border border-slate-200/80 bg-white/60 p-5">
        <div className="mb-4">
          <div className="section-title text-xs text-slate-400">
            Draft management
          </div>
          <h2 className="mt-1 text-sm font-semibold text-slate-900">
            Actions
          </h2>
        </div>
        <StructureSummaryActions />
      </section>
    </div>
  );
}

// ── Published Tab ────────────────────────────────────────────────────────────

function PublishedTab({
  unitTypes,
  units,
  typeColors,
  hasDraft,
  hasPublished,
  onStartEditing,
}: {
  unitTypes: UnitType[];
  units: DraftUnit[];
  typeColors: Record<string, string>;
  hasDraft: boolean;
  hasPublished: boolean;
  onStartEditing: () => void;
}) {
  const router = useRouter();
  const [startingEdit, setStartingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const handleStartEditing = async () => {
    setEditError(null);
    setStartingEdit(true);

    try {
      const res = await fetch("/api/tenant/structure/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();

      if (data.status === "success") {
        onStartEditing();
        router.refresh();
      } else {
        setEditError(data.message ?? "Failed to prepare an editable draft.");
      }
    } catch {
      setEditError("Failed to prepare an editable draft.");
    } finally {
      setStartingEdit(false);
    }
  };

  if (units.length === 0 && unitTypes.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-200 py-16 text-center">
        <CheckCircle2 className="h-10 w-10 text-slate-200" />
        <div>
          <p className="text-sm font-medium text-slate-500">
            No published structure yet
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Publish a draft to see the live structure here
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-6 lg:grid-cols-[260px_1fr]">
        {/* Unit types sidebar (read-only) */}
        <div className="rounded-[1.75rem] border border-slate-200/80 bg-white/60 p-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-900">
            Unit types
          </h2>
          {unitTypes.length ? (
            <ul className="space-y-2">
              {unitTypes.map((type) => (
                <li
                  key={type.id}
                  className="flex items-center justify-between rounded-xl border border-slate-200/80 bg-white px-3 py-2.5"
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className="h-2 w-2 rounded-full"
                      style={{
                        backgroundColor: typeColors[type.typeKey] ?? "#94a3b8",
                      }}
                    />
                    <span className="text-sm font-medium text-slate-900">
                      {type.displayLabel}
                    </span>
                  </div>
                  <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    {type.typeKey}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {/* Published tree (read-only) */}
        <div className="rounded-[1.75rem] border border-slate-200/80 bg-white/60 p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Published hierarchy
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                {hasDraft
                  ? "The published structure stays active while you work in draft."
                  : hasPublished
                    ? "Create a draft copy before making changes to the live hierarchy."
                    : "This view shows the active structure currently visible to your organization."}
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                void handleStartEditing();
              }}
              disabled={startingEdit}
              className="inline-flex items-center gap-2 rounded-xl border border-brand/20 bg-brand/5 px-3 py-2 text-xs font-semibold text-brand transition hover:border-brand/30 hover:bg-brand/10 disabled:opacity-50"
            >
              {startingEdit ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Pencil className="h-3.5 w-3.5" />
              )}
              {hasDraft ? "Open draft editor" : "Edit hierarchy"}
            </button>
          </div>

          {editError ? (
            <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {editError}
            </div>
          ) : null}

          {!hasDraft ? (
            <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
              The published version remains live until you validate and publish
              the new draft.
            </div>
          ) : null}

          <OrgTreeBuilder
            unitTypes={unitTypes}
            units={units}
            typeColors={typeColors}
            readOnly
          />
        </div>
      </section>
    </div>
  );
}

// ── History Tab ──────────────────────────────────────────────────────────────

function HistoryTab() {
  return (
    <div className="rounded-[1.75rem] border border-slate-200/80 bg-white/60 p-5">
      <div className="mb-5">
        <h2 className="text-sm font-semibold text-slate-900">
          Version history
        </h2>
        <p className="mt-0.5 text-xs text-slate-400">
          Browse past drafts and published versions of your org structure
        </p>
      </div>
      <VersionHistoryList />
    </div>
  );
}

// ── Roles Tab ────────────────────────────────────────────────────────────────

function RolesTab() {
  return (
    <div className="rounded-[1.75rem] border border-slate-200/80 bg-white/60 p-5">
      <RoleDefinitionsList />
    </div>
  );
}

// ── Members Tab ──────────────────────────────────────────────────────────────

function MembersTab() {
  return (
    <div className="rounded-[1.75rem] border border-slate-200/80 bg-white/60 p-5">
      <UserRoleUpload />
    </div>
  );
}

// ── Import Tab ───────────────────────────────────────────────────────────────

function ImportTab() {
  return (
    <div className="rounded-[1.75rem] border border-slate-200/80 bg-white/60 p-5">
      <StructureUpload />
    </div>
  );
}
