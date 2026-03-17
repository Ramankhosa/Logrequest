"use client";

import Link from "next/link";

type MenuGroup = {
  label: string;
  links: {
    href: string;
    label: string;
  }[];
  defaultOpen?: boolean;
};

const groups: MenuGroup[] = [
  {
    label: "User operations",
    defaultOpen: true,
    links: [
      { href: "/tenant-admin/users", label: "Directory" },
      { href: "/tenant-admin/users/new", label: "Invite / create user" },
    ],
  },
  {
    label: "Organization",
    links: [
      { href: "/tenant-admin/structure", label: "Structure" },
      { href: "/tenant-admin/structure/types/new", label: "New type" },
      { href: "/tenant-admin/structure/units/new", label: "New unit" },
    ],
  },
];

export function WorkspaceMenu() {
  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <details
          key={group.label}
          className="overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white/80"
          open={group.defaultOpen}
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
            <span className="text-sm font-semibold text-slate-900">{group.label}</span>
            <span className="text-xs text-slate-500">Menu</span>
          </summary>
          <div className="border-t border-slate-200 px-4 py-3 space-y-2">
            {group.links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="block rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-900 transition hover:border-slate-300"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}
