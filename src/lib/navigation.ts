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
      { href: "/tenant-admin/users", label: "Users", icon: "users" },
      { href: "/tenant-admin/structure", label: "Organization", icon: "network" },
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

export const superadminNavigationGroups: NavigationGroup[] = [
  {
    label: "Superadmin",
    defaultOpen: true,
    items: [
      { href: "/superadmin", label: "Dashboard", icon: "layout-dashboard" },
      { href: "/superadmin/tenants/new", label: "New Tenant", icon: "building-2" },
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
