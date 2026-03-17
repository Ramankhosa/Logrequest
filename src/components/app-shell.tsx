import Link from "next/link";
import { ChevronDown, Workflow } from "lucide-react";
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
  return (
    <div className="surface-grid min-h-screen px-4 py-4 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto grid w-full max-w-7xl gap-4 lg:grid-cols-[280px_1fr]">
        <aside className="glass-panel rounded-[2rem] border p-5 lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)]">
          <div className="mb-8 flex items-center gap-3">
            <div className="rounded-2xl bg-slate-950 p-3 text-white">
              <Workflow className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900">
                Logrequest
              </div>
              <div className="text-xs text-slate-500">
                Multi-tenant workspace
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {navigationGroups.map((group) => (
              <MenuBlock
                key={group.label}
                defaultOpen={group.defaultOpen}
                title={group.label}
              >
                <nav className="space-y-2">
                  {group.items.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="block rounded-2xl border border-transparent bg-white/70 px-4 py-3 text-sm font-semibold text-slate-900 transition hover:border-slate-200 hover:bg-white"
                    >
                      {item.label}
                    </Link>
                  ))}
                </nav>
              </MenuBlock>
            ))}
          </div>
        </aside>

        <main className="glass-panel rounded-[2rem] border p-6 sm:p-8">
          <header className="mb-8 flex flex-col gap-6 border-b border-slate-200/80 pb-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-3">
                <span className="section-title text-xs text-slate-500">
                  {eyebrow}
                </span>
                <h1 className="font-[family-name:var(--font-geist-mono)] text-3xl leading-tight sm:text-4xl">
                  {title}
                </h1>
                {description ? (
                  <p className="max-w-3xl text-sm leading-7 text-slate-600">
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

            {userSummary ? (
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-[1.5rem] border border-slate-200/80 bg-white/80 p-4">
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    {userSummary.name}
                  </div>
                  <div className="text-sm text-slate-600">
                    {userSummary.email}
                  </div>
                  <div className="text-xs uppercase tracking-[0.14em] text-slate-500">
                    {userSummary.roleLabel}
                    {userSummary.tenantLabel ? ` | ${userSummary.tenantLabel}` : ""}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Link
                    className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
                    href="/change-password"
                  >
                    Change password
                  </Link>
                  <SignOutButton />
                </div>
              </div>
            ) : null}
          </header>

          <div className="space-y-6">{children}</div>
        </main>
      </div>
    </div>
  );
}

function MenuBlock({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      className="overflow-hidden rounded-[1.5rem] border border-slate-200/80 bg-white/70"
      open={defaultOpen}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4">
        <div className="text-sm font-semibold text-slate-900">{title}</div>
        <ChevronDown className="h-4 w-4 text-slate-500" />
      </summary>
      <div className="border-t border-slate-200/80 px-4 py-4">{children}</div>
    </details>
  );
}
