import Link from "next/link";
import { ArrowLeft, Layers, Map as MapIcon, Scale } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Panel } from "@/components/panel";
import { requireTenantAdmin } from "@/lib/auth/session";
import { getShellIdentity } from "@/lib/auth/access";
import { tenantNavigationGroups } from "@/lib/navigation";
import {
  getOrgStructureSnapshot,
  type OrgStructureSnapshot,
} from "@/lib/org-structure/service";
import { StructureSummaryActions } from "@/components/tenant/structure-summary-actions";

export default async function StructurePage() {
  const context = await requireTenantAdmin();
  const tenantId = context.tenant?.id ?? "";
  const snapshot = tenantId ? await getOrgStructureSnapshot(tenantId) : null;

  return (
    <AppShell
      eyebrow="Organization"
      title="Structure"
      userSummary={getShellIdentity(context)}
      navigationGroups={tenantNavigationGroups}
      headerActions={
        <Link
          href="/tenant-admin/users"
          className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:border-slate-400"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to users
        </Link>
      }
    >
      <div className="space-y-6">
        <Panel eyebrow="Overview" title="Hierarchy summary">
          <div className="grid gap-4 md:grid-cols-3">
            <SummaryStat
              icon={<Layers className="h-4 w-4" />}
              label="Draft"
              value={snapshot?.draft?.name ?? "Not started"}
              hint={snapshot?.draft ? `v${snapshot.draft.versionNumber}` : "ready"}
            />
            <SummaryStat
              icon={<MapIcon className="h-4 w-4" />}
              label="Published units"
              value={snapshot?.published?.unitCount ?? 0}
              hint={
                snapshot?.published
                  ? snapshot.published.state
                  : "no published version"
              }
            />
            <SummaryStat
              icon={<Scale className="h-4 w-4" />}
              label="Draft units"
              value={snapshot?.draft?.unitCount ?? 0}
              hint={snapshot?.draft?.state ?? "pending"}
            />
          </div>
        </Panel>

        <Panel eyebrow="Details" title="Unit types & units">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                Unit types
              </div>
              {snapshot?.draftUnitTypes.length ? (
                <ul className="space-y-2">
                  {snapshot.draftUnitTypes.map((type) => (
                    <li
                      key={type.id}
                      className="flex items-center justify-between rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 text-sm font-semibold text-slate-900"
                    >
                      <span>{type.displayLabel}</span>
                      <span className="text-xs text-slate-500">
                        {type.typeKey}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-500">No types defined</p>
              )}
            </div>
            <div className="space-y-3">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                Units
              </div>
              {snapshot?.draftUnits.length ? (
                <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/80">
                  <div className="p-4">
                    <UnitTreeList nodes={buildUnitTree(snapshot.draftUnits)} />
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-500">No units added yet</p>
              )}
            </div>
          </div>
        </Panel>

        <Panel eyebrow="Actions" title="Manage">
          <StructureSummaryActions />
        </Panel>
      </div>
    </AppShell>
  );
}

type DraftUnit = OrgStructureSnapshot["draftUnits"][number];

type UnitNode = {
  unit: DraftUnit;
  children: UnitNode[];
};

function buildUnitTree(units: DraftUnit[]) {
  const nodes = new Map<string, UnitNode>();
  const roots: UnitNode[] = [];

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

function UnitTreeList({ nodes }: { nodes: UnitNode[] }) {
  return (
    <div className="space-y-3">
      {nodes.map((node) => (
        <UnitTreeNode key={node.unit.id} node={node} />
      ))}
    </div>
  );
}

function UnitTreeNode({ node }: { node: UnitNode }) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">
            {node.unit.name}
          </div>
          <div className="text-xs text-slate-500">{node.unit.code}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-slate-700">
              {node.unit.typeLabel}
            </span>
            <span className="text-xs uppercase tracking-[0.16em] text-slate-500">
              {node.unit.level === 0 ? "Root" : `Level ${node.unit.level}`}
            </span>
          </div>
        </div>
        <div className="text-xs uppercase tracking-[0.16em] text-slate-500">
          {node.unit.typeKey}
        </div>
      </div>
      {node.children.length ? (
        <div className="mt-3 border-l border-slate-200 pl-4">
          <UnitTreeList nodes={node.children} />
        </div>
      ) : null}
    </div>
  );
}

function SummaryStat({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  hint: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 text-sm text-slate-900">
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-2 text-slate-700">
        {icon}
      </div>
      <div>
        <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
          {label}
        </div>
        <div className="mt-1 text-xl font-semibold">{value}</div>
        <div className="text-xs text-slate-500">{hint}</div>
      </div>
    </div>
  );
}
