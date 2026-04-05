export type NavigationItem = {
  href: string;
  label: string;
  icon: string;
  serviceCode?: "ACCREDITATION";
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
      { href: "/tenant-admin/personnel/transfers", label: "Transfers", icon: "arrow-right-left" },
      { href: "/tenant-admin/access-control", label: "Access Control", icon: "shield-check" },
      { href: "/tenant-admin/kra-kpi", label: "KRA / KPI", icon: "target" },
      {
        href: "/tenant-admin/accreditation",
        label: "Accreditation",
        icon: "award",
        serviceCode: "ACCREDITATION",
      },
      {
        href: "/tenant-admin/institutional-data",
        label: "Institutional Data",
        icon: "database",
        serviceCode: "ACCREDITATION",
      },
      {
        href: "/workspace/accreditation",
        label: "My Accreditation",
        icon: "award",
        serviceCode: "ACCREDITATION",
      },
      { href: "/tenant-admin/kra-kpi/workflow", label: "Workflow", icon: "git-branch" },
      { href: "/tenant-admin/kra-kpi/journals", label: "Journal Catalog", icon: "tag" },
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
      {
        href: "/workspace/accreditation",
        label: "My Accreditation",
        icon: "award",
        serviceCode: "ACCREDITATION",
      },
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
      { href: "/superadmin/tenants", label: "Tenants", icon: "building-2" },
      { href: "/superadmin/tenants/new", label: "New Tenant", icon: "building-2" },
      { href: "/superadmin/kra-categories", label: "KRA Categories", icon: "tag" },
      { href: "/superadmin/journals", label: "Journal Catalog", icon: "tag" },
      { href: "/superadmin/accreditation", label: "Accreditation", icon: "award" },
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
