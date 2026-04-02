import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRightLeft } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Panel } from "@/components/panel";
import { StatusBadge } from "@/components/status-badge";
import { getShellIdentity } from "@/lib/auth/access";
import { tenantNavigationGroups } from "@/lib/navigation";
import { requireTenantAnyCapability } from "@/lib/auth/session";
import {
  getUserPlacementSummary,
  getPersonnelTimeline,
  type PersonnelTimelineEntry,
} from "@/lib/personnel/service";
import type { PlacementSummaryUnit } from "@/lib/personnel/shared";

export default async function PersonnelDetailPage({
  params,
}: {
  params: Promise<{ membershipId: string }>;
}) {
  const context = await requireTenantAnyCapability(["MANAGE_PERSONNEL", "MANAGE_ACCESS"]);
  const tenantId = context.tenant?.id ?? "";
  const { membershipId } = await params;

  const [summary, timeline] = await Promise.all([
    getUserPlacementSummary(tenantId, membershipId),
    getPersonnelTimeline(tenantId, membershipId),
  ]);

  if (!summary) return notFound();

  return (
    <AppShell
      eyebrow="Personnel"
      title={summary.userName}
      navigationGroups={tenantNavigationGroups}
      userSummary={getShellIdentity(context)}
      headerActions={
        <>
          <Link
            href={`/tenant-admin/personnel/transfers?membershipId=${summary.membershipId}`}
            className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
          >
            <ArrowRightLeft className="h-4 w-4" />
            Transfers
          </Link>
          <Link
            href="/tenant-admin/personnel"
            className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Personnel
          </Link>
        </>
      }
    >
      {/* Profile header */}
      <section className="rounded-2xl border border-slate-200/80 bg-white/80 px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-brand/10 text-lg font-bold text-brand">
            {initials(summary.userName)}
          </div>

          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                {summary.userName}
              </h2>
              <p className="text-sm text-slate-500">{summary.userEmail}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <StatusBadge label={summary.personnelStatus} />
              <StatusBadge label={summary.membershipStatus} />
            </div>

            <div className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <ProfileField
                label="Employee ID"
                value={summary.employeeId}
              />
              <ProfileField
                label="Designation"
                value={summary.designation}
              />
              <ProfileField
                label="Date of Joining"
                value={summary.dateOfJoining ? formatDate(summary.dateOfJoining) : null}
              />
              <ProfileField
                label="Membership ID"
                value={summary.membershipId}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Panel eyebrow="Access" title="Permission Roles">
          {summary.permissionRoles.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {summary.permissionRoles.map((roleCode) => (
                <span
                  key={`${summary.membershipId}:${roleCode}`}
                  className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700"
                >
                  {roleCode}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">No tenant permission roles assigned.</p>
          )}
        </Panel>

        <Panel eyebrow="Workflow" title="Reviewer Warnings">
          {summary.workflowWarnings.length > 0 ? (
            <div className="space-y-2">
              {summary.workflowWarnings.map((warning, index) => (
                <div
                  key={`${summary.membershipId}:warning:${index}`}
                  className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700"
                >
                  {warning}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">No workflow ownership warnings.</p>
          )}
        </Panel>
      </section>

      {/* Unit assignments */}
      <Panel eyebrow="Placement" title="Unit Assignments">
        {summary.units.length ? (
          <div className="overflow-hidden rounded-[1.5rem] border border-slate-200/80 bg-white/80">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200/80 text-left">
                <thead className="bg-slate-50/80">
                  <tr>
                    <Th>Unit</Th>
                    <Th>Code</Th>
                    <Th>Type</Th>
                    <Th>Roles</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/80">
                  {summary.units.map((u) => (
                    <UnitRow key={u.assignmentId} unit={u} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">No unit assignments found.</p>
        )}
      </Panel>

      {/* Personnel timeline */}
      <Panel eyebrow="History" title="Personnel Timeline">
        {timeline.length ? (
          <ol className="relative border-l border-slate-200 pl-6">
            {timeline.map((entry) => (
              <TimelineItem key={entry.id} entry={entry} />
            ))}
          </ol>
        ) : (
          <p className="text-sm text-slate-500">No timeline entries yet.</p>
        )}
      </Panel>
    </AppShell>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function ProfileField({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
        {label}
      </dt>
      <dd className="mt-0.5 text-slate-700">
        {value ?? <span className="text-slate-400">—</span>}
      </dd>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
      {children}
    </th>
  );
}

function UnitRow({ unit }: { unit: PlacementSummaryUnit }) {
  const isPrimary = unit.isPrimary;

  return (
    <tr className={isPrimary ? "bg-brand-soft/30" : undefined}>
      <td className="px-4 py-4 text-sm font-semibold text-slate-900 whitespace-nowrap">
        <span>{unit.unitName}</span>
        {isPrimary ? (
          <span className="ml-2 inline-flex items-center rounded-full border border-brand/15 bg-brand-soft px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider text-brand">
            Primary
          </span>
        ) : (
          <span className="ml-2 inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider text-slate-600">
            Secondary
          </span>
        )}
      </td>
      <td className="px-4 py-4 text-sm text-slate-600 font-mono">
        {unit.unitCode}
      </td>
      <td className="px-4 py-4 text-sm text-slate-600">
        Level {unit.unitLevel}
        {unit.unitPath ? (
          <span className="ml-1 text-xs text-slate-400">({unit.unitPath})</span>
        ) : null}
      </td>
      <td className="px-4 py-4">
        {unit.roles.length ? (
          <div className="flex flex-wrap gap-1.5">
            {unit.roles.map((r) => (
              <span
                key={r.assignmentId}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  r.isActive
                    ? "border border-slate-200 bg-white text-slate-700"
                    : "border border-slate-100 bg-slate-50 text-slate-400 line-through"
                }`}
              >
                {r.roleName}
                {r.isUnitHead ? (
                  <span className="rounded-full bg-amber-100 px-1.5 py-px text-[0.6rem] font-bold text-amber-700">
                    Head
                  </span>
                ) : null}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-sm text-slate-400">—</span>
        )}
      </td>
    </tr>
  );
}

function TimelineItem({ entry }: { entry: PersonnelTimelineEntry }) {
  return (
    <li className="relative mb-6 last:mb-0">
      <div className="absolute -left-[1.56rem] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-slate-400" />
      <div className="rounded-xl border border-slate-200/80 bg-white/80 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-900">
            {formatActionType(entry.actionType)}
          </span>
          <span className="text-xs text-slate-400">
            {formatDate(new Date(entry.effectiveDate))}
          </span>
        </div>
        {entry.reason ? (
          <p className="mt-1 text-sm text-slate-600">{entry.reason}</p>
        ) : null}
        <p className="mt-1 text-xs text-slate-400">
          Recorded {formatDateTime(new Date(entry.createdAt))}
        </p>
      </div>
    </li>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function initials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function formatActionType(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(date: Date): string {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
