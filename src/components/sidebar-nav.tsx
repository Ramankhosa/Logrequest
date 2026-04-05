"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Award,
  BarChart3,
  LayoutDashboard,
  Users,
  Building2,
  BarChart2,
  ClipboardCheck,
  Upload,
  Home,
  ShieldCheck,
  Network,
  Contact,
  Database,
  Target,
  Tag,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavigationGroup } from "@/lib/navigation";

const iconMap: Record<string, LucideIcon> = {
  "layout-dashboard": LayoutDashboard,
  "clipboard-check": ClipboardCheck,
  "users": Users,
  "building-2": Building2,
  "bar-chart-2": BarChart2,
  "bar-chart-3": BarChart3,
  "upload": Upload,
  "home": Home,
  "shield-check": ShieldCheck,
  "network": Network,
  "contact": Contact,
  "database": Database,
  "target": Target,
  "tag": Tag,
  "award": Award,
};

export function SidebarNav({ groups }: { groups: NavigationGroup[] }) {
  const pathname = usePathname();
  const [enabledServices, setEnabledServices] = useState<string[]>([]);
  const hasServiceScopedItems = useMemo(
    () => groups.some((group) => group.items.some((item) => item.serviceCode)),
    [groups],
  );

  useEffect(() => {
    if (!hasServiceScopedItems) {
      setEnabledServices([]);
      return;
    }

    let cancelled = false;

    async function loadServices() {
      try {
        const response = await fetch("/api/tenant/services", { cache: "no-store" });
        if (!response.ok) {
          if (!cancelled) {
            setEnabledServices([]);
          }
          return;
        }
        const data = (await response.json()) as { enabledServices?: string[] };
        if (!cancelled) {
          setEnabledServices(Array.isArray(data.enabledServices) ? data.enabledServices : []);
        }
      } catch {
        if (!cancelled) {
          setEnabledServices([]);
        }
      }
    }

    void loadServices();

    return () => {
      cancelled = true;
    };
  }, [hasServiceScopedItems]);

  const visibleGroups = useMemo(
    () =>
      groups
        .map((group) => ({
          ...group,
          items: group.items.filter(
            (item) => !item.serviceCode || enabledServices.includes(item.serviceCode),
          ),
        }))
        .filter((group) => group.items.length > 0),
    [enabledServices, groups],
  );

  return (
    <div className="space-y-5">
      {visibleGroups.map((group) => (
        <div key={group.label}>
          <div className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            {group.label}
          </div>
          <nav className="space-y-0.5">
            {group.items.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/" && pathname.startsWith(item.href + "/")) ||
                (item.href !== "/" && pathname === item.href);
              const Icon = iconMap[item.icon] ?? LayoutDashboard;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150",
                    isActive
                      ? "bg-brand text-white shadow-sm shadow-brand/20"
                      : "text-slate-600 hover:bg-white hover:text-slate-900 hover:shadow-sm",
                  )}
                >
                  <Icon
                    className={cn(
                      "h-4 w-4 shrink-0 transition-colors",
                      isActive
                        ? "text-white/90"
                        : "text-slate-400 group-hover:text-slate-600",
                    )}
                  />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      ))}
    </div>
  );
}
