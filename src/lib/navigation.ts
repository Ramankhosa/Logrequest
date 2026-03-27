export type NavigationItem = {
  href: string;
  label: string;
  icon: string;
};

export type NavigationGroup = {
  label: string;
  items: NavigationItem[];
  defaultOpen?: boolean;
};

export const defaultNavigationGroups: NavigationGroup[] = [
  {
    label: "Platform",
    defaultOpen: true,
    items: [
      { href: "/", label: "Overview", icon: "home" },
      { href: "/superadmin", label: "Superadmin", icon: "shield-check" },
      { href: "/tenant-admin", label: "Tenant", icon: "building-2" },
      { href: "/imports", label: "Imports", icon: "upload" },
      { href: "/insights", label: "Insights", icon: "bar-chart-2" },
    ],
  },
];

export const tenantNavigationGroups: NavigationGroup[] = [
  {
    label: "Workspace",
    defaultOpen: true,
    items: [
      { href: "/tenant-admin", label: "Dashboard", icon: "layout-dashboard" },
      { href: "/my-kpis", label: "My KPIs", icon: "clipboard-check" },
      { href: "/tenant-admin/users", label: "Users", icon: "users" },
      { href: "/tenant-admin/structure", label: "Organization", icon: "network" },
      { href: "/tenant-admin/personnel", label: "Personnel", icon: "contact" },
      { href: "/tenant-admin/kra-kpi", label: "KRA / KPI", icon: "target" },
      { href: "/kpi-dashboard", label: "KPI Dashboard", icon: "bar-chart-3" },
    ],
  },
  {
    label: "Platform",
    items: [
      { href: "/insights", label: "Insights", icon: "bar-chart-2" },
      { href: "/imports", label: "Imports", icon: "upload" },
    ],
  },
];

export const userNavigationGroups: NavigationGroup[] = [
  {
    label: "My Work",
    defaultOpen: true,
    items: [
      { href: "/workspace", label: "Dashboard", icon: "layout-dashboard" },
      { href: "/my-kpis", label: "My KPIs", icon: "clipboard-check" },
      { href: "/kpi-dashboard", label: "KPI Dashboard", icon: "bar-chart-3" },
    ],
  },
  {
    label: "Platform",
    items: [
      { href: "/insights", label: "Insights", icon: "bar-chart-2" },
    ],
  },
];

/**
 * Returns the right navigation groups for the given role context.
 * Use this when the page is accessible to multiple roles.
 */
export function getNavigationForRole(role: string | null, isSuperadmin: boolean): NavigationGroup[] {
  if (isSuperadmin) return superadminNavigationGroups;
  if (role === "TENANT_OWNER" || role === "TENANT_ADMIN") return tenantNavigationGroups;
  return userNavigationGroups;
}

export const superadminNavigationGroups: NavigationGroup[] = [
  {
    label: "Superadmin",
    defaultOpen: true,
    items: [
      { href: "/superadmin", label: "Dashboard", icon: "layout-dashboard" },
      { href: "/superadmin/tenants/new", label: "New Tenant", icon: "building-2" },
      { href: "/superadmin/kra-categories", label: "KRA Categories", icon: "tag" },
      { href: "/insights", label: "Insights", icon: "bar-chart-2" },
    ],
  },
  {
    label: "Platform",
    items: [
      { href: "/", label: "Overview", icon: "home" },
      { href: "/imports", label: "Imports", icon: "upload" },
    ],
  },
];
