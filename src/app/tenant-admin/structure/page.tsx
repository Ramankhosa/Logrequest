import Link from "next/link";
import {
  Plus,
  Tag,
  CheckCircle2,
  FileEdit,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { requireTenantAdmin } from "@/lib/auth/session";
import { getShellIdentity } from "@/lib/auth/access";
import { tenantNavigationGroups } from "@/lib/navigation";
import {
  getOrgStructureSnapshot,
  type OrgStructureSnapshot,
} from "@/lib/org-structure/service";
import { StructureSummaryActions } from "@/components/tenant/structure-summary-actions";
import { OrgTreeBuilder } from "@/components/tenant/org-tree-builder";

export default async function StructurePage() {
  const context = await requireTenantAdmin();
  const tenantId = context.tenant?.id ?? "";
  const snapshot = tenantId ? await getOrgStructureSnapshot(tenantId) : null;

  const hasDraft = !!snapshot?.draft;
  const hasPublished = !!snapshot?.published;
  const typeColors = buildTypeColorMap(
    snapshot?.draftUnitTypes.map((t) => t.typeKey) ?? [],
  );

  return (
    <AppShell
      eyebrow="Organization"
      title="Structure"
      userSummary={getShellIdentity(context)}
      navigationGroups={tenantNavigationGroups}
      headerActions={
        <Link
          href="/tenant-admin/structure/types/new"
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
        >
          <Tag className="h-3.5 w-3.5" />
          New type
        </Link>
      }
    >
      {/* Version status cards */}
      <section className="grid gap-4 sm:grid-cols-2">
        <VersionCard
          icon={<FileEdit className="h-4 w-4" />}
          label="Draft version"
          name={snapshot?.draft?.name ?? "Not started"}
          version={snapshot?.draft ? `v${snapshot.draft.versionNumber}` : null}
          state={snapshot?.draft?.state ?? null}
          unitCount={snapshot?.draft?.unitCount ?? 0}
          empty={!hasDraft}
          tone="amber"
        />
        <VersionCard
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="Published version"
          name={snapshot?.published?.name ?? "No published version"}
          version={
            snapshot?.published
              ? `v${snapshot.published.versionNumber}`
              : null
          }
          state={snapshot?.published?.state ?? null}
          unitCount={snapshot?.published?.unitCount ?? 0}
          empty={!hasPublished}
          tone="brand"
        />
      </section>

      {/* Unit types & interactive tree */}
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

          {snapshot?.draftUnitTypes.length ? (
            <ul className="space-y-2">
              {snapshot.draftUnitTypes.map((type, i) => (
                <li
                  key={type.id}
                  className="flex items-center justify-between rounded-xl border border-slate-200/80 bg-white px-3 py-2.5"
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: typeColor(i) }}
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
            unitTypes={snapshot?.draftUnitTypes ?? []}
            units={snapshot?.draftUnits ?? []}
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
    </AppShell>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const PALETTE = [
  "#0f766e", "#0284c7", "#7c3aed", "#db2777",
  "#ea580c", "#65a30d", "#ca8a04", "#0891b2",
];

function typeColor(index: number) {
  return PALETTE[index % PALETTE.length];
}

function buildTypeColorMap(typeKeys: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  typeKeys.forEach((key, i) => {
    map[key] = typeColor(i);
  });
  return map;
}

// ── VersionCard ──────────────────────────────────────────────────────────────

function VersionCard({
  icon,
  label,
  name,
  version,
  state,
  unitCount,
  empty,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  name: string;
  version: string | null;
  state: string | null;
  unitCount: number;
  empty: boolean;
  tone: "brand" | "amber";
}) {
  const toneMap = {
    brand: {
      icon: "bg-brand/10 text-brand",
      badge: "bg-brand/10 text-brand",
    },
    amber: {
      icon: "bg-amber-50 text-amber-600",
      badge: "bg-amber-50 text-amber-600",
    },
  };
  const t = toneMap[tone];

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white/80 px-5 py-4">
      <div className="flex items-center gap-3">
        <div className={`rounded-xl p-2 ${t.icon}`}>{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
            {label}
          </div>
          <div className="mt-0.5 truncate text-sm font-semibold text-slate-900">
            {name}
          </div>
        </div>
        {version ? (
          <span className={`rounded-xl px-2.5 py-1 text-xs font-bold ${t.badge}`}>
            {version}
          </span>
        ) : null}
      </div>

      {!empty ? (
        <div className="mt-3 flex items-center gap-4 border-t border-slate-100 pt-3">
          <div className="text-xs text-slate-500">
            <span className="font-semibold text-slate-900">{unitCount}</span>{" "}
            units
          </div>
          {state ? (
            <div className="text-xs text-slate-500">
              State:{" "}
              <span className="font-semibold text-slate-700">{state}</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
