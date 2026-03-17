import Link from "next/link";
import { Workflow, LogOut, KeyRound } from "lucide-react";
import { SidebarNav } from "@/components/sidebar-nav";
import { SignOutButton } from "@/components/auth/sign-out-button";
import {
  defaultNavigationGroups,
  type NavigationGroup,
} from "@/lib/navigation";

type AppShellProps = {
  eyebrow: string;
  title: string;
  description?: string;
  children: React.ReactNode;
  navigationGroups?: NavigationGroup[];
  headerActions?: React.ReactNode;
  userSummary?: {
    name: string;
    email: string;
    roleLabel: string;
    tenantLabel?: string | null;
  };
};

export function AppShell({
  eyebrow,
  title,
  description,
  children,
  navigationGroups = defaultNavigationGroups,
  headerActions,
  userSummary,
}: AppShellProps) {
  const initials = userSummary
    ? userSummary.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : null;

  return (
    <div className="surface-grid min-h-screen px-4 py-4 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto grid w-full max-w-7xl gap-4 lg:grid-cols-[260px_1fr]">
        {/* ── Sidebar ── */}
        <aside className="glass-panel flex flex-col gap-4 rounded-[2rem] border p-4 lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)]">
          {/* Brand */}
          <div className="flex items-center gap-3 px-2 py-1">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-white shadow-lg shadow-slate-950/20">
              <Workflow className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-bold tracking-tight text-slate-900">
                Logrequest
              </div>
              <div className="truncate text-xs text-slate-400">
                Admin Platform
              </div>
            </div>
          </div>

          {/* Divider */}
          <div className="h-px bg-slate-200/80" />

          {/* Navigation */}
          <div className="flex-1 overflow-y-auto">
            <SidebarNav groups={navigationGroups} />
          </div>

          {/* User profile */}
          {userSummary ? (
            <div className="mt-auto rounded-2xl border border-slate-200/80 bg-white/60 p-3">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-xs font-bold text-brand">
                  {initials}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-slate-900">
                    {userSummary.name}
                  </div>
                  <div className="truncate text-xs text-slate-400">
                    {userSummary.roleLabel}
                    {userSummary.tenantLabel
                      ? ` · ${userSummary.tenantLabel}`
                      : ""}
                  </div>
                </div>
              </div>

              <div className="mt-3 flex gap-2">
                <Link
                  href="/change-password"
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
                >
                  <KeyRound className="h-3 w-3" />
                  Password
                </Link>
                <SignOutButton className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:border-rose-200 hover:text-rose-700" />
              </div>
            </div>
          ) : null}
        </aside>

        {/* ── Main content ── */}
        <main className="glass-panel min-h-[calc(100vh-2rem)] rounded-[2rem] border p-6 sm:p-8">
          <header className="mb-8 border-b border-slate-200/60 pb-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1.5">
                <span className="section-title text-xs text-slate-400">
                  {eyebrow}
                </span>
                <h1 className="font-[family-name:var(--font-geist-mono)] text-2xl font-semibold leading-tight text-slate-900 sm:text-3xl">
                  {title}
                </h1>
                {description ? (
                  <p className="max-w-2xl text-sm leading-7 text-slate-500">
                    {description}
                  </p>
                ) : null}
              </div>

              {headerActions ? (
                <div className="flex flex-wrap items-center gap-3">
                  {headerActions}
                </div>
              ) : null}
            </div>
          </header>

          <div className="space-y-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
