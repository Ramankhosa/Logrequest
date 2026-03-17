export type NavigationItem = {
  href: string;
  label: string;
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
      { href: "/", label: "Overview" },
      { href: "/superadmin", label: "Superadmin" },
      { href: "/tenant-admin", label: "Tenant" },
      { href: "/imports", label: "Imports" },
      { href: "/insights", label: "Insights" },
    ],
  },
];

export const tenantNavigationGroups: NavigationGroup[] = [
  {
    label: "Tenant",
    defaultOpen: true,
    items: [
      { href: "/tenant-admin", label: "Workspace" },
      { href: "/tenant-admin/users", label: "Users" },
      { href: "/tenant-admin/users/new", label: "New User" },
      { href: "/tenant-admin/structure", label: "Organization" },
      { href: "/tenant-admin/structure/types/new", label: "New Type" },
      { href: "/tenant-admin/structure/units/new", label: "New Unit" },
    ],
  },
  {
    label: "Platform",
    items: [
      { href: "/insights", label: "Insights" },
      { href: "/imports", label: "Imports" },
    ],
  },
];

export const superadminNavigationGroups: NavigationGroup[] = [
  {
    label: "Superadmin",
    defaultOpen: true,
    items: [
      { href: "/superadmin", label: "Dashboard" },
      { href: "/superadmin/tenants/new", label: "New Tenant" },
      { href: "/insights", label: "Insights" },
    ],
  },
  {
    label: "Platform",
    items: [
      { href: "/", label: "Overview" },
      { href: "/imports", label: "Imports" },
    ],
  },
];
